import { posix } from 'node:path';
import { InputError } from './common.js';
import type { PageFrontmatter } from './upstream/frontmatter.js';

export interface WikiEntryMetadata {
  mode: 'constraint' | 'reference';
  status: 'active' | 'deprecated' | 'needs_review';
  scope: string[];
  aliases: string[];
}

export interface WikiContext {
  skill?: string;
  task?: string;
  paths?: string[];
}

function stringList(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new InputError(`Wiki entry ${path} requires a list of strings in ${field}`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

export function readWikiEntryMetadata(path: string, frontmatter: PageFrontmatter): WikiEntryMetadata | undefined {
  if (!path.startsWith('wiki/entries/')) return undefined;
  if (!/^wiki\/entries\/[a-z0-9][a-z0-9_-]*\.md$/.test(path)) {
    throw new InputError(`Invalid stable Wiki entry path: ${path}`);
  }
  const { title, mode, status } = frontmatter;
  if (typeof title !== 'string' || !title.trim()) throw new InputError(`Wiki entry ${path} needs a title`);
  if (mode !== 'reference' && mode !== 'constraint') throw new InputError(`Invalid Wiki entry mode: ${path}`);
  if (status !== 'active' && status !== 'deprecated' && status !== 'needs_review') {
    throw new InputError(`Invalid Wiki entry status: ${path}`);
  }
  const scope = stringList(frontmatter.scope, 'scope', path);
  if (!scope.length || scope.some(item => item !== 'project' && !/^(?:skill|task|path):\S/.test(item))) {
    throw new InputError(`Invalid Wiki entry scope: ${path}`);
  }
  if (!stringList(frontmatter.sources, 'sources', path).length) {
    throw new InputError(`Wiki entry ${path} needs at least one source`);
  }
  const aliases = frontmatter.aliases === undefined ? [] : stringList(frontmatter.aliases, 'aliases', path);
  return { mode, status, scope, aliases };
}

export function appliesToContext(entry: WikiEntryMetadata, context: WikiContext): boolean {
  return entry.scope.some(scope => {
    if (scope === 'project') return true;
    if (scope.startsWith('skill:')) return scope.slice(6) === context.skill;
    if (scope.startsWith('task:')) return scope.slice(5) === context.task;
    return (context.paths ?? []).some(path => posix.matchesGlob(path.replaceAll('\\', '/'), scope.slice(5)));
  });
}
