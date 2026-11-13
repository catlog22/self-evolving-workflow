import { posix } from 'node:path';
import { InputError } from './common.js';
import type { PageFrontmatter } from './upstream/frontmatter.js';

export const wikiCategories = ['coding', 'arch', 'debug', 'test', 'review', 'learning', 'ui'] as const;
export type WikiCategory = typeof wikiCategories[number];
const repositoryIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WikiEntryMetadata {
  mode: 'constraint' | 'reference';
  status: 'active' | 'deprecated' | 'needs_review';
  scope: string[];
  aliases: string[];
  categories?: WikiCategory[];
  repositories?: string[];
}

export interface WikiContext {
  skill?: string;
  task?: string;
  paths?: string[];
  categories?: WikiCategory[];
  repository?: string;
  includePathScoped?: boolean;
}

function stringList(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new InputError(`Wiki entry ${path} requires a list of strings in ${field}`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

export function isWikiCategory(value: unknown): value is WikiCategory {
  return wikiCategories.some(category => category === value);
}

export function isRepositoryId(value: unknown): value is string {
  return typeof value === 'string' && repositoryIdPattern.test(value);
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
  const categories = frontmatter.categories === undefined ? undefined : stringList(frontmatter.categories, 'categories', path);
  if (categories && !categories.every(isWikiCategory)) throw new InputError(`Invalid Wiki entry category: ${path}`);
  const repositories = frontmatter.repositories === undefined ? undefined : stringList(frontmatter.repositories, 'repositories', path);
  if (repositories && !repositories.every(isRepositoryId)) throw new InputError(`Invalid Wiki repository ID: ${path}`);
  return { mode, status, scope, aliases, ...(categories ? { categories } : {}), ...(repositories ? { repositories } : {}) };
}

export function appliesToContext(entry: WikiEntryMetadata, context: WikiContext): boolean {
  if (entry.repositories && (!context.repository || !entry.repositories.includes(context.repository))) return false;
  const categories = context.categories;
  if (entry.categories && categories?.length && !entry.categories.some(category => categories.includes(category))) return false;
  return entry.scope.some(scope => {
    if (scope === 'project') return true;
    if (scope.startsWith('skill:')) return scope.slice(6) === context.skill;
    if (scope.startsWith('task:')) return scope.slice(5) === context.task;
    return context.includePathScoped || (context.paths ?? []).some(path => posix.matchesGlob(path.replaceAll('\\', '/'), scope.slice(5)));
  });
}
