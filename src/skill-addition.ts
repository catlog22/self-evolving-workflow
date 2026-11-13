import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { InputError, requireText } from './common.js';

export type SkillPriority = 'high' | 'normal' | 'low';

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
  const relative = `references/learnings/${id}.md`;
  const details = `# Skill learning\n\n${when ? `When: ${when}\n\n` : ''}${instruction}\n\n## Evidence\n\n${sources.map(source => `- ${source}`).join('\n')}\n`;
  const changes = input.priority === 'high' ? [] : [{ path: resolve(dirname(entry), relative), content: details }];
  if (input.priority !== 'low') {
    const body = input.priority === 'high' ? instruction
      : `[Read the workflow learning](${relative}) when ${when ?? 'the documented conditions apply'}.`;
    const addition = `${start}\n${body}\n${end}\n`;
    if (baseline.includes(start) && !baseline.includes(addition.trim())) {
      throw new InputError('Existing Skill learning block differs from this draft');
    }
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(baseline)?.[0] ?? '';
    const content = baseline.includes(start) ? baseline
      : input.priority === 'high'
        ? frontmatter + '\n' + addition + '\n' + baseline.slice(frontmatter.length)
        : baseline.trimEnd() + '\n\n' + addition;
    changes.unshift({ path: entry, content });
  }
  return {
    id, priority: input.priority, sources, instruction, ...(when ? { when } : {}),
    baseline: { path: entry, sha256: createHash('sha256').update(baseline).digest('hex') },
    changes,
  };
}

export type SkillAddition = ReturnType<typeof draftSkillAddition>;
