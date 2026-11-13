import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { InputError, requireText } from './common.js';

export type SkillPriority = 'high' | 'normal' | 'low';

export const learningIndex = 'references/learnings/index.md';

export function learningDocument(id: string) {
  return `references/learnings/${id}.md`;
}

function readOptionalDocument(path: string) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw new InputError(`Expected a regular Skill Markdown file: ${path}`);
  return info ? readFileSync(path, 'utf8') : undefined;
}

function appendBlock(baseline: string, marker: string, block: string) {
  if (!baseline.includes(marker)) return `${baseline.trimEnd()}\n\n${block}\n`;
  if (!baseline.replace(/\r\n/g, '\n').includes(block)) {
    throw new InputError('Existing Skill learning block differs from this draft');
  }
  return baseline;
}

export function draftSkillAddition(input: {
  entry: string;
  priority: SkillPriority;
  instruction: string;
  sources: string[];
  when?: string;
}) {
  const entry = resolve(input.entry);
  if (!lstatSync(entry, { throwIfNoEntry: false })?.isFile()) throw new InputError('Expected a regular Skill Markdown file');
  const baseline = readFileSync(entry, 'utf8');
  const instruction = requireText(input.instruction, 'Skill instruction');
  const when = input.when === undefined ? undefined : requireText(input.when, 'learning trigger');
  const sources = [...new Set(input.sources.map(source => requireText(source, 'evidence reference')))].sort();
  if (!sources.length) throw new InputError('At least one evidence reference is required');
  if (/[\r\n]/.test(sources.join('')) || /<!--\s*\/?evolve:learning\b/.test(instruction)) {
    throw new InputError('Evidence references must use one line and instructions must omit learning markers');
  }
  if (when && (/[\r\n]/.test(when) || /<!--/.test(when))) throw new InputError('A learning trigger must use one line');
  if (input.priority === 'high' && (/[\r\n]/.test(instruction) || [...instruction].length > 280)) {
    throw new InputError('A high-priority inline addition must be one instruction under 281 characters');
  }
  const id = createHash('sha256').update(JSON.stringify([input.priority, instruction, sources, when])).digest('hex').slice(0, 20);
  const start = `<!-- evolve:learning:${id} -->`;
  const end = '<!-- /evolve:learning -->';
  const relative = learningDocument(id);
  const details = `# Skill learning\n\n${when ? `When: ${when}\n\n` : ''}${instruction}\n\n## Evidence\n\n${sources.map(source => `- ${source}`).join('\n')}\n`;
  const packageRoot = dirname(entry);
  const changes: Array<{ path: string; content: string }> = [];
  if (input.priority !== 'high') {
    for (const directory of ['references', 'references/learnings']) {
      const info = lstatSync(resolve(packageRoot, directory), { throwIfNoEntry: false });
      if (info && !info.isDirectory()) throw new InputError(`Expected a regular Skill reference directory: ${directory}`);
    }
    const path = resolve(packageRoot, relative);
    const existing = readOptionalDocument(path);
    if (existing !== undefined && existing.replace(/\r\n/g, '\n') !== details) {
      throw new InputError(`Existing Skill learning document differs from this draft: ${relative}`);
    }
    changes.push({ path, content: details });
  }
  if (input.priority === 'low') {
    const indexPath = resolve(packageRoot, learningIndex);
    const index = readOptionalDocument(indexPath) ?? '# Optional Skill references\n';
    const title = [...(when ?? instruction).split(/\r?\n/, 1)[0]].slice(0, 100).join('').replace(/[&<>()[\]\\`*_]/g, '\\$&');
    const indexContent = appendBlock(index, start, `${start}\n- [${title}](./${id}.md)\n${end}`);
    const indexMarker = '<!-- evolve:learning:index -->';
    const entryContent = appendBlock(baseline, indexMarker,
      `${indexMarker}\n[Optional Skill references](${learningIndex}) for tasks that explicitly need additional examples or troubleshooting.\n${end}`);
    if (indexContent !== index) changes.push({ path: indexPath, content: indexContent });
    if (entryContent !== baseline) changes.unshift({ path: entry, content: entryContent });
  } else {
    const body = input.priority === 'high' ? instruction
      : `[Read the workflow learning](${relative}) when ${when ?? 'the documented conditions apply'}.`;
    const addition = `${start}\n${body}\n${end}`;
    let content = appendBlock(baseline, start, addition);
    if (input.priority === 'high' && content !== baseline) {
      const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(baseline)?.[0] ?? '';
      content = `${frontmatter}\n${addition}\n\n${baseline.slice(frontmatter.length)}`;
    }
    changes.unshift({ path: entry, content });
  }
  return {
    id, priority: input.priority, sources, instruction, ...(when ? { when } : {}),
    baseline: { path: entry, sha256: createHash('sha256').update(baseline).digest('hex') },
    changes,
  };
}

export type SkillAddition = ReturnType<typeof draftSkillAddition>;
