import { posix } from 'node:path';
import { InputError, requireText } from './common.js';
import { isRepositoryId, isWikiCategory, type WikiContext } from './wiki-entry.js';
import { workflowRecord, workflowStrings } from './workflow-skills.js';

export type WikiLookupScope = Pick<WikiContext, 'repository' | 'task' | 'paths' | 'categories'>;

export interface WikiPrior {
  id: string;
  title: string;
  mode: 'constraint' | 'reference';
  content: string;
  scope: string[];
  categories?: string[];
  repositories?: string[];
  sources: string[];
  lookup_scope: WikiLookupScope;
  source_search_id: string;
  content_sha256: string;
}

export function wikiLookupScope(value: unknown = {}): WikiLookupScope {
  const input = workflowRecord(value, 'Wiki lookup scope');
  const field = Object.keys(input).find(key => !['repository', 'task', 'paths', 'categories'].includes(key));
  if (field) throw new InputError('Unknown Wiki scope field: ' + field);
  const { repository, task, paths, categories } = input;
  if (repository !== undefined && !isRepositoryId(repository)) throw new InputError('Expected a persisted repository UUID');
  const normalizedPaths = paths === undefined ? [] : workflowStrings(paths, 'Wiki paths')
    .map(path => posix.normalize(path.replaceAll('\\', '/')));
  const normalizedCategories = categories === undefined ? [] : workflowStrings(categories, 'Wiki categories');
  if (!normalizedCategories.every(isWikiCategory)) throw new InputError('Unknown Wiki context category');
  return {
    ...(repository === undefined ? {} : { repository }),
    ...(task === undefined ? {} : { task: requireText(task, 'Wiki task') }),
    ...(normalizedPaths.length ? { paths: [...new Set(normalizedPaths)].sort() } : {}),
    ...(normalizedCategories.length ? { categories: [...new Set(normalizedCategories)].sort() } : {}),
  };
}
