import { createHash } from 'node:crypto';
import {
  createAgentMemoryEnvelope,
  type AgentMemoryContextScope,
  type AgentMemoryEnvelope,
} from './context-envelope.js';
import type { CodeGraph } from './code.js';
import { InputError, NotFoundError, requireText, searchLimit } from './common.js';
import type { MemorySearchOptions, MemoryStore } from './memory.js';
import type { Wiki, WikiSearchOptions } from './wiki.js';
import type { WikiContext } from './wiki-entry.js';

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

export interface ContextOptions {
  limit?: number;
  context?: WikiContext;
  wiki?: Omit<WikiSearchOptions, 'limit'>;
  memory?: Omit<MemorySearchOptions, 'limit'>;
  contextScope?: AgentMemoryContextScope;
  includeWorkingMemory?: boolean;
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

export async function context(
  sources: SearchSources, query: string, options: ContextOptions = {},
): Promise<AgentMemoryEnvelope> {
  const text = requireText(query, 'query');
  const limit = searchLimit(options.limit);
  const wikiContext = options.context ?? {};
  const constraints = sources.wiki?.constraints(wikiContext).slice(0, limit) ?? [];
  const references = sources.wiki?.references(text, wikiContext, { ...options.wiki, limit }).results ?? [];
  const workingMemories = options.includeWorkingMemory && sources.memory
    ? (await sources.memory.search(text, { ...options.memory, limit })).results
    : [];
  return createAgentMemoryEnvelope({
    contextScope: options.contextScope,
    constraints: constraints.map(page => ({
      knowledge_id: page.id,
      title: page.title,
      mode: 'constraint' as const,
      authority: 'binding' as const,
      scope: page.entry?.scope ?? [],
      ...(page.entry?.categories ? { categories: page.entry.categories } : {}),
      content: page.body,
      content_sha256: `sha256:${createHash('sha256').update(page.body).digest('hex')}`,
      sources: page.sources,
      source_count: page.sources.length,
    })),
    references: references.map(hit => ({
      knowledge_id: hit.id,
      title: hit.title,
      mode: 'reference' as const,
      authority: 'advisory' as const,
      score: hit.score,
      hop: hit.hop,
      snippet: hit.snippet,
      sources: hit.sources,
      related_knowledge_ids: hit.related.map(related => related.id),
    })),
    workingMemories: workingMemories.map(memory => ({
      memory_id: memory.id,
      session_id: memory.session,
      type: memory.type,
      authority: 'unverified_episodic' as const,
      content: memory.content,
      source_ids: memory.sourceMessageIds,
      linked_knowledge_id: null,
    })),
  });
}
