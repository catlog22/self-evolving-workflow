import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { stringify } from 'yaml';
import { InputError, requireText } from './common.js';
import { parseFrontmatter } from './upstream/frontmatter.js';
import { isRepositoryId, isWikiCategory, readWikiEntryMetadata, type WikiCategory, type WikiEntryMetadata } from './wiki-entry.js';
import type { Wiki } from './wiki.js';

interface LegacyEntry {
  origin: string;
  oldId: string;
  title: string;
  body: string;
  mode: WikiEntryMetadata['mode'];
  metadata: Record<string, unknown>;
  category?: WikiCategory;
  repositories?: unknown;
}

const legacySpecFiles: Partial<Record<string, WikiCategory>> = {
  'coding-conventions.md': 'coding', 'architecture-constraints.md': 'arch', 'debug-notes.md': 'debug',
  'test-conventions.md': 'test', 'review-standards.md': 'review', 'quality-rules.md': 'review',
  'learnings.md': 'learning', 'ui-conventions.md': 'ui',
};

function legacyRepositories(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  const list = typeof raw === 'string' ? raw.split(',').map(id => id.trim()).filter(Boolean) : raw;
  if (!Array.isArray(list) || !list.length || !list.every(isRepositoryId)) return null;
  return [...new Set(list)].sort();
}

function parseSpecs(source: string, origin: string): LegacyEntry[] {
  const document = parseFrontmatter(source);
  if (source.startsWith('---\n') || source.startsWith('---\r\n')) {
    if (!document.hasFrontmatter) throw new InputError(`Invalid Spec frontmatter: ${origin}`);
  }
  const firstLine = source.slice(0, source.length - document.body.length).split('\n').length;
  const matches = [...document.body.matchAll(/<spec-entry\b\s*([^>]*)>([\s\S]*?)<\/spec-entry>/g)];
  const specs = new Map<number, LegacyEntry>();
  const fileMetadata: Record<string, unknown> = document.hasFrontmatter ? document.frontmatter : {};
  const category = legacySpecFiles[basename(origin)] ??
    [fileMetadata.category, basename(origin, '.md')].find(isWikiCategory);
  const fileRepositories = fileMetadata.appliesToRepoIds ?? fileMetadata['applies-to-repo-ids'];
  for (const match of matches) {
    const body = match[2].trim();
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')]));
    const title = attributes.title || body.match(/^#{2,6}\s+(.+)$/m)?.[1] ||
      [...(body.split(/\r?\n/, 1)[0] ?? '')].slice(0, 100).join('');
    if (!title || !body) throw new InputError(`Unrecognized Spec entry in ${origin}`);
    const line = firstLine + document.body.slice(0, match.index).split('\n').length - 1;
    const entryRepositories = attributes.appliesToRepoIds ?? attributes['applies-to-repo-ids'];
    specs.set(line, {
      origin: `${origin}#L${line}`, oldId: attributes.sid || '', title, body, mode: 'constraint',
      metadata: { ...fileMetadata, ...attributes },
      category, repositories: entryRepositories?.trim() ? entryRepositories : fileRepositories,
    });
  }
  const remaining = document.body.replace(/<spec-entry\b\s*[^>]*>[\s\S]*?<\/spec-entry>/g, match => match.replace(/[^\r\n]/g, ' '));
  if (/<\/?spec-entry\b/.test(remaining)) throw new InputError(`Unclosed Spec entry in ${origin}`);
  const headings = [...remaining.matchAll(/^###\s+(?:\[[\w-]+\]\s+)?\[\d{4}-\d{2}-\d{2}(?:[ \t][\d:]+)?\][ \t]*([^\r\n]+)\r?$/gm)];
  for (const [index, heading] of headings.entries()) {
    const line = firstLine + remaining.slice(0, heading.index).split('\n').length - 1;
    const next = headings[index + 1]?.index ?? remaining.length;
    const body = remaining.slice(heading.index, next).trim();
    if (body === heading[0].trim()) continue;
    specs.set(line, {
      origin: `${origin}#L${line}`, oldId: '', title: heading[1], body, mode: 'constraint', metadata: fileMetadata,
      category, repositories: fileRepositories,
    });
  }
  if (!specs.size && document.body.replace(/^#+\s+.*$/gm, '').replace(/^---+$/gm, '').trim()) {
    const title = typeof document.frontmatter.title === 'string' && document.frontmatter.title.trim()
      ? document.frontmatter.title.trim() : document.body.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(origin, '.md');
    specs.set(firstLine, {
      origin, oldId: '', title, body: document.body, mode: 'constraint', metadata: fileMetadata,
      category, repositories: fileRepositories,
    });
  }
  return [...specs.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry);
}

function collectLegacy(sourceRoot: string): LegacyEntry[] {
  const entries: LegacyEntry[] = [];
  const workflow = join(sourceRoot, '.workflow');
  if (!lstatSync(workflow, { throwIfNoEntry: false })?.isDirectory()) {
    throw new InputError(`Legacy project has no regular .workflow directory: ${workflow}`);
  }
  for (const folder of ['specs', 'knowhow'] as const) {
    const directory = join(workflow, folder);
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info) continue;
    if (!info.isDirectory()) throw new InputError(`Invalid legacy knowledge directory: ${directory}`);
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
      entries.push({ origin, oldId, title, body: parsed.body, mode: 'reference', metadata: parsed.frontmatter,
        repositories: parsed.frontmatter.appliesToRepoIds ?? parsed.frontmatter['applies-to-repo-ids'] });
    }
  }
  return entries;
}

function statusFor(entry: LegacyEntry): WikiEntryMetadata['status'] {
  const status = entry.metadata.lifecycleStatus ?? entry.metadata['lifecycle-status'] ?? entry.metadata.status;
  if (status === 'deprecated' || status === 'superseded') return 'deprecated';
  if (entry.metadata['conflict-marker'] || entry.metadata.confidence === 'contested' ||
      legacyRepositories(entry.repositories) === null ||
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
  const knowhowPaths = new Map<string, string>();
  const writes = sources.map(entry => {
    const kind = entry.mode === 'constraint' ? 'spec' : 'knowhow';
    const key = `${project}:${kind}:${entry.oldId || entry.origin}`;
    const id = `legacy-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    if (entry.oldId) {
      const oldKey = `${kind}:${entry.oldId.toLowerCase()}`;
      if (oldIds.has(oldKey)) throw new InputError(`Duplicate legacy Wiki ID: ${entry.oldId}`);
      oldIds.set(oldKey, id);
    }
    if (kind === 'knowhow') knowhowPaths.set(entry.origin.slice('.workflow/'.length).toLowerCase(), id);
    return { entry, id, key, kind, status: statusFor(entry) };
  });
  const planned = writes.map(({ entry, id, key, kind, status }) => {
    const relations: string[] = [];
    const issues: string[] = [];
    for (const [field, label] of [
      [entry.metadata.supersededBy ?? entry.metadata['superseded-by'], 'Superseding entry'],
      [entry.metadata.supersedes, 'Earlier entry'],
    ] as const) {
      if (field === undefined) continue;
      const target = typeof field === 'string' ? oldIds.get(`${kind}:${field.toLowerCase()}`) : undefined;
      if (target && target !== id) relations.push(`[[entries/${target}|${label}]]`);
      else issues.push(`Unresolved ${label.toLowerCase()}`);
    }
    const ref = entry.metadata.ref;
    if (kind === 'spec' && ref !== undefined) {
      const refPath = typeof ref === 'string' ? posix.normalize(ref.replaceAll('\\', '/')).toLowerCase() : '';
      const target = knowhowPaths.get(refPath);
      if (target) relations.push(`[[entries/${target}|Legacy reference]]`);
      else issues.push('Unresolved legacy reference');
    }
    const effectiveStatus = issues.length && status === 'active' ? 'needs_review' : status;
    if (status === 'needs_review') issues.push('Review legacy lifecycle, conflict, or repository scope');
    const repositories = legacyRepositories(entry.repositories);
    const sources = [`legacy:${project}:${entry.origin}`];
    for (const source of [
      entry.metadata.sourceRef, entry.metadata['source-ref'], entry.metadata.source,
      ...(Array.isArray(entry.metadata.sources) ? entry.metadata.sources : []),
    ]) {
      if (typeof source === 'string' && source.trim() && !sources.includes(source)) sources.push(source);
    }
    const data = {
      title: entry.title,
      mode: kind === 'spec' && typeof ref === 'string' && ref.trim() ? 'reference' : entry.mode,
      status: effectiveStatus,
      scope: ['project'],
      ...(kind === 'spec' ? { categories: entry.category ? [entry.category] : [] } : {}),
      ...(repositories ? { repositories } : {}),
      sources,
      aliases: [key],
      legacy: entry.metadata,
      ...(issues.length ? { migration_issues: issues } : {}),
    };
    const body = entry.body.trim() + (relations.length ? `\n\n${relations.join('\n')}` : '');
    const content = `---\n${stringify(data)}---\n\n${body}\n`;
    readWikiEntryMetadata(`wiki/entries/${id}.md`, { type: 'other', ...data });
    const path = join(destination, `${id}.md`);
    const existing = lstatSync(path, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || readFileSync(path, 'utf8') !== content)) {
      throw new InputError(`Migration would overwrite an existing entry: ${id}`);
    }
    return { id, origin: entry.origin, alias: key, status: effectiveStatus, path, content, existing: Boolean(existing), issues };
  });
  if (apply && planned.length) {
    mkdirSync(destination, { recursive: true });
    for (const item of planned) {
      if (!item.existing) writeFileSync(item.path, item.content, { encoding: 'utf8', flag: 'wx' });
    }
    wiki.build();
  }
  return planned.map(({ id, origin, alias, status, existing, issues }) => ({
    id, origin, alias, status, existing, ...(issues.length ? { issues } : {}),
  }));
}
