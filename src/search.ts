import type { CodeGraph } from './code.js';
import { InputError, NotFoundError, requireText, searchLimit } from './common.js';
import type { MemorySearchOptions, MemoryStore } from './memory.js';
import type { Wiki, WikiSearchOptions } from './wiki.js';

export interface SearchSources {
  code?: CodeGraph;
  wiki?: Wiki;
  memory?: MemoryStore;
}

export type SearchScope = keyof SearchSources | 'all';

export interface SearchOptions {
  scope?: SearchScope;
  limit?: number;
  wiki?: Omit<WikiSearchOptions, 'limit'>;
  memory?: Omit<MemorySearchOptions, 'limit'>;
}

export interface SearchResults {
  code?: Awaited<ReturnType<CodeGraph['search']>>;
  wiki?: ReturnType<Wiki['search']>;
  memory?: Awaited<ReturnType<MemoryStore['search']>>;
}

export function parseScope(scope: string): SearchScope {
  if (scope === 'all' || scope === 'code' || scope === 'wiki' || scope === 'memory') return scope;
  throw new InputError('scope must be all, code, wiki or memory');
}

export async function search(sources: SearchSources, query: string, options: SearchOptions = {}): Promise<SearchResults> {
  const text = requireText(query, 'query');
  const limit = searchLimit(options.limit);
  const scope = parseScope(options.scope ?? 'all');
  if (scope !== 'all' && !sources[scope]) throw new NotFoundError(`Search source is not configured: ${scope}`);
  const wiki = scope === 'all' || scope === 'wiki' ? sources.wiki?.search(text, { ...options.wiki, limit }) : undefined;
  const [code, memory] = await Promise.all([
    scope === 'all' || scope === 'code' ? sources.code?.search(text, limit) : undefined,
    scope === 'all' || scope === 'memory' ? sources.memory?.search(text, { ...options.memory, limit }) : undefined,
  ]);
  return { ...(code && { code }), ...(wiki && { wiki }), ...(memory && { memory }) };
}
