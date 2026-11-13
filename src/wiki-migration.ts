import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { stringify } from 'yaml';
import { InputError, requireText } from './common.js';
import { parseFrontmatter } from './upstream/frontmatter.js';
import type { WikiEntryMetadata } from './wiki-entry.js';
import type { Wiki } from './wiki.js';

interface LegacyEntry {
  origin: string;
  oldId: string;
  title: string;
  body: string;
  mode: WikiEntryMetadata['mode'];
  metadata: Record<string, unknown>;
}

function parseSpecs(source: string, origin: string): LegacyEntry[] {
  const matches = [...source.matchAll(/<spec-entry\b\s*([^>]*)>([\s\S]*?)<\/spec-entry>/g)];
  const specs = new Map<number, LegacyEntry>();
  for (const match of matches) {
    const body = match[2].trim();
    const metadata = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')]));
    const title = metadata.title || body.match(/^#{2,6}\s+(.+)$/m)?.[1] ||
      [...(body.split(/\r?\n/, 1)[0] ?? '')].slice(0, 100).join('');
    if (!title || !body) throw new InputError(`Unrecognized Spec entry in ${origin}`);
    const line = source.slice(0, match.index).split('\n').length;
    specs.set(line, { origin: `${origin}#L${line}`, oldId: metadata.sid || '', title, body, mode: 'constraint', metadata });
  }
  const remaining = source.replace(/<spec-entry\b\s*[^>]*>[\s\S]*?<\/spec-entry>/g, match => match.replace(/[^\r\n]/g, ' '));
  if (/<\/?spec-entry\b/.test(remaining)) throw new InputError(`Unclosed Spec entry in ${origin}`);
  const headings = [...remaining.matchAll(/^###\s+(?:\[[\w-]+\]\s+)?\[\d{4}-\d{2}-\d{2}(?:[ \t][\d:]+)?\][ \t]*([^\r\n]+)\r?$/gm)];
  for (const [index, heading] of headings.entries()) {
    const line = remaining.slice(0, heading.index).split('\n').length;
    const next = headings[index + 1]?.index ?? remaining.length;
    const body = remaining.slice(heading.index, next).trim();
    if (body === heading[0].trim()) continue;
    specs.set(line, { origin: `${origin}#L${line}`, oldId: '', title: heading[1], body, mode: 'constraint', metadata: {} });
  }
  return [...specs.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry);
}

function collectLegacy(sourceRoot: string): LegacyEntry[] {
  const entries: LegacyEntry[] = [];
  for (const folder of ['specs', 'knowhow'] as const) {
    const directory = join(sourceRoot, '.workflow', folder);
    for (const file of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const source = readFileSync(join(directory, file.name), 'utf8').replace(/^\uFEFF/, '');
      const origin = `.workflow/${folder}/${file.name}`;
      if (folder === 'specs') {
        entries.push(...parseSpecs(source, origin));
        continue;
      }
      const parsed = parseFrontmatter(source);
      if (source.startsWith('---') && !parsed.hasFrontmatter) throw new InputError(`Invalid Knowhow frontmatter: ${origin}`);
      const oldId = typeof parsed.frontmatter.id === 'string' ? parsed.frontmatter.id : basename(file.name, '.md');
      const title = parsed.frontmatter.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || oldId;
      entries.push({ origin, oldId, title, body: parsed.body, mode: 'reference', metadata: parsed.frontmatter });
    }
  }
  return entries;
}

function statusFor(entry: LegacyEntry): WikiEntryMetadata['status'] {
  const status = entry.metadata.lifecycleStatus ?? entry.metadata['lifecycle-status'] ?? entry.metadata.status;
  if (status === 'deprecated' || status === 'superseded') return 'deprecated';
  const applicability = entry.metadata.appliesToRepoIds ?? entry.metadata['applies-to-repo-ids'];
  if (entry.metadata['conflict-marker'] || entry.metadata.confidence === 'contested' ||
      Boolean(Array.isArray(applicability) ? applicability.length : applicability) ||
      (status && !['active', 'accepted'].includes(String(status)))) return 'needs_review';
  return 'active';
}

export function migrateLegacyWiki(wiki: Wiki, sourceRoot: string, project: string, apply = false) {
  project = requireText(project, 'legacy project ID');
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(project)) throw new InputError('Legacy project ID must be a stable slug');
  const destination = join(wiki.root, 'wiki', 'entries');
  for (const path of [join(wiki.root, 'wiki'), destination]) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (info && !info.isDirectory()) throw new InputError(`Invalid Wiki migration directory: ${path}`);
  }
  const sources = collectLegacy(sourceRoot);
  const oldIds = new Map<string, string>();
  const writes = sources.map(entry => {
    const kind = entry.mode === 'constraint' ? 'spec' : 'knowhow';
    const key = `${project}:${kind}:${entry.oldId || entry.origin}`;
    const id = `legacy-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    if (entry.oldId) {
      const oldKey = `${kind}:${entry.oldId.toLowerCase()}`;
      if (oldIds.has(oldKey)) throw new InputError(`Duplicate legacy Wiki ID: ${entry.oldId}`);
      oldIds.set(oldKey, id);
    }
    return { entry, id, key, kind, status: statusFor(entry) };
  });
  const planned = writes.map(({ entry, id, key, kind, status }) => {
    const raw = entry.metadata.supersededBy ?? entry.metadata['superseded-by'];
    const replacement = typeof raw === 'string' ? oldIds.get(`${kind}:${raw.toLowerCase()}`) : undefined;
    const effectiveStatus = raw && !replacement && status === 'active' ? 'needs_review' : status;
    const sources = [`legacy:${project}:${entry.origin}`];
    for (const source of [
      entry.metadata.sourceRef, entry.metadata['source-ref'], entry.metadata.source,
      ...(Array.isArray(entry.metadata.sources) ? entry.metadata.sources : []),
    ]) {
      if (typeof source === 'string' && source.trim() && !sources.includes(source)) sources.push(source);
    }
    const data = {
      title: entry.title,
      mode: entry.mode,
      status: effectiveStatus,
      scope: ['project'],
      sources,
      aliases: [key],
      legacy: entry.metadata,
    };
    const body = entry.body.trim() + (replacement ? `\n\n[[entries/${replacement}|Superseding entry]]` : '');
    const content = `---\n${stringify(data)}---\n\n${body}\n`;
    const path = join(destination, `${id}.md`);
    const existing = lstatSync(path, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || readFileSync(path, 'utf8') !== content)) {
      throw new InputError(`Migration would overwrite an existing entry: ${id}`);
    }
    return { id, origin: entry.origin, alias: key, status: effectiveStatus, path, content, existing: Boolean(existing) };
  });
  if (apply && planned.length) {
    mkdirSync(destination, { recursive: true });
    for (const item of planned) {
      if (!item.existing) writeFileSync(item.path, item.content, { encoding: 'utf8', flag: 'wx' });
    }
    wiki.build();
  }
  return planned.map(({ id, origin, alias, status, existing }) => ({ id, origin, alias, status, existing }));
}
