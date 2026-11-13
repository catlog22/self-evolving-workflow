// Adapts the TencentDB Agent Memory Wiki manager and per-wiki index (MIT).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { UndirectedGraph } from 'graphology';
import { InputError, NotFoundError, openDb, requireText, searchLimit, transaction } from './common.js';
import { parseFrontmatter, readSources } from './upstream/frontmatter.js';
import { graphMultiHopSearch } from './upstream/graph-search.js';
import { slugify } from './upstream/slug.js';
import { tokenizeWiki } from './wiki-tokens.js';
import { appliesToContext, readWikiEntryMetadata, type WikiContext, type WikiEntryMetadata } from './wiki-entry.js';
import type { WikiIngestOptions } from './wiki-ingest.js';

interface Page {
  id: string;
  title: string;
  type: string;
  path: string;
  snippet: string;
  sources: string[];
  entry?: WikiEntryMetadata;
}

interface PageFile extends Page {
  body: string;
  links: string[];
}

export interface WikiSearchOptions {
  limit?: number;
  hop?: number;
  decay?: number;
  includeHistory?: boolean;
}

export interface WikiHit extends Page {
  score: number;
  hop: number;
  via?: string;
  related: Array<{ title: string; path: string; direction: 'in' | 'out' | 'both' }>;
}

export const structuralPages = new Set(['wiki/index.md', 'wiki/schema.md', 'wiki/purpose.md', 'wiki/log.md', 'wiki/overview.md']);

export function readWikiPages(root: string): PageFile[] {
  const pages: PageFile[] = [];
  function walk(dir: string, prefix: string) {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'media') walk(full, path);
      if (!entry.isFile() || !/\.md$/i.test(entry.name) || structuralPages.has(path.toLowerCase())) continue;
      const content = readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
      const { frontmatter, body } = parseFrontmatter(content);
      const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : body.match(/^#\s+(.+)$/m)?.[1].trim() || basename(entry.name).replace(/\.md$/i, '').replaceAll('-', ' ');
      const snippet = typeof frontmatter.description === 'string' && frontmatter.description.trim()
        ? frontmatter.description.trim()
        : [...body.replace(/^#+\s+.*$/gm, '').trim()].slice(0, 160).join('').replace(/\s+/g, ' ');
      pages.push({
        id: path.slice(5, -3), title, type: frontmatter.type.toLowerCase(), path, snippet,
        sources: readSources(content), body,
        ...(path.startsWith('wiki/entries/') ? { entry: readWikiEntryMetadata(path, frontmatter) } : {}),
        links: [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(link => link[1].trim()),
      });
    }
  }
  walk(join(root, 'wiki'), 'wiki');
  return pages;
}

function resolveEdges(pages: PageFile[]) {
  const visible = pages.filter(page => page.type !== 'query');
  const byId = new Map(visible.map(page => [page.id.toLowerCase(), page.id]));
  const aliases = new Map<string, string | undefined>();
  const stableAliases = new Map<string, string>();
  for (const page of visible) {
    for (const key of new Set([slugify(page.title), slugify(page.id.split('/').at(-1)!)])) {
      if (key) aliases.set(key, aliases.has(key) ? undefined : page.id);
    }
    for (const alias of page.entry?.aliases ?? []) {
      const key = alias.toLowerCase();
      const previous = byId.get(key) ?? byId.get(`entries/${key}`) ?? stableAliases.get(key);
      if (previous && previous !== page.id) throw new InputError(`Duplicate Wiki alias: ${alias}`);
      stableAliases.set(key, page.id);
    }
  }
  return visible.flatMap(page => {
    const targets = new Set<string>();
    for (const link of page.links) {
      const key = link.replaceAll('\\', '/').replace(/^wiki\//i, '').replace(/\.md$/i, '');
      const target = byId.get(key.toLowerCase()) ?? stableAliases.get(key.toLowerCase()) ?? aliases.get(slugify(key));
      if (target && target !== page.id) targets.add(target);
    }
    return [...targets].map(target => ({ source: page.id, target }));
  });
}

export class Wiki {
  readonly root: string;
  readonly indexPath: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.indexPath = join(this.root, 'index.db');
  }

  async ingest(source: string, options: WikiIngestOptions) {
    const { ingestWiki } = await import('./wiki-ingest.js');
    return ingestWiki(this, source, options);
  }

  constraints(context: WikiContext = {}) {
    if (!existsSync(join(this.root, 'wiki'))) return [];
    return readWikiPages(this.root).filter(page =>
      page.entry?.mode === 'constraint' && page.entry.status === 'active' && appliesToContext(page.entry, context)
    ).map(({ links: _links, ...page }) => page);
  }

  getEntry(id: string) {
    if (!existsSync(join(this.root, 'wiki'))) return null;
    const key = requireText(id, 'wiki entry ID').toLowerCase();
    const matches = readWikiPages(this.root).filter(page => page.entry && (
      page.id.toLowerCase() === key || page.id.toLowerCase() === `entries/${key}` ||
      page.entry.aliases.some(alias => alias.toLowerCase() === key)
    ));
    if (matches.length > 1) throw new InputError(`Ambiguous Wiki entry ID: ${id}`);
    const page = matches[0];
    if (!page) return null;
    const { links: _links, ...entry } = page;
    return entry;
  }

  getEntryByExactBody(body: string) {
    if (!existsSync(join(this.root, 'wiki'))) return null;
    const normalized = body.trim().replace(/\s+/g, ' ');
    const matches = readWikiPages(this.root).filter(page =>
      page.entry?.status === 'active' && page.body.trim().replace(/\s+/g, ' ') === normalized
    );
    return matches.length === 1 ? matches[0] : null;
  }

  build() {
    if (!existsSync(join(this.root, 'wiki'))) throw new NotFoundError('Missing wiki/ directory');
    const db = openDb(this.indexPath);
    try {
      return transaction(db, () => {
        const pages = readWikiPages(this.root);
        const edges = resolveEdges(pages);
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
            page_id UNINDEXED, title_tok, content_tok, tokenize='unicode61 remove_diacritics 0'
          );
          CREATE TABLE IF NOT EXISTS page_meta (
            page_id TEXT PRIMARY KEY, title TEXT, type TEXT, rel_path TEXT, snippet TEXT
          );
          CREATE TABLE IF NOT EXISTS page_sources (page_id TEXT PRIMARY KEY, sources TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS wiki_entries (
            page_id TEXT PRIMARY KEY, status TEXT NOT NULL, metadata TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS graph_edge (
            source_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY (source_id, target_id)
          );
          DELETE FROM wiki_fts;
          DELETE FROM page_meta;
          DELETE FROM page_sources;
          DELETE FROM wiki_entries;
          DELETE FROM graph_edge;
        `);
        const fts = db.prepare('INSERT INTO wiki_fts(page_id, title_tok, content_tok) VALUES (?, ?, ?)');
        const meta = db.prepare('INSERT INTO page_meta(page_id, title, type, rel_path, snippet) VALUES (?, ?, ?, ?, ?)');
        const source = db.prepare('INSERT INTO page_sources(page_id, sources) VALUES (?, ?)');
        const edge = db.prepare('INSERT INTO graph_edge(source_id, target_id) VALUES (?, ?)');
        const entry = db.prepare('INSERT INTO wiki_entries(page_id, status, metadata) VALUES (?, ?, ?)');
        for (const page of pages) {
          fts.run(page.id, tokenizeWiki(page.title).join(' '), tokenizeWiki(page.body).join(' '));
          meta.run(page.id, page.title, page.type, page.path, page.snippet);
          source.run(page.id, JSON.stringify(page.sources));
          if (page.entry) entry.run(page.id, page.entry.status, JSON.stringify(page.entry));
        }
        for (const { source, target } of edges) edge.run(source, target);
        return { pages: pages.length, edges: edges.length };
      });
    } finally {
      db.close();
    }
  }

  search(query: string, options: WikiSearchOptions = {}): {
    results: WikiHit[];
    links: Array<{ source: string; target: string }>;
  } {
    const tokens = [...new Set(tokenizeWiki(requireText(query, 'query')))];
    const limit = searchLimit(options.limit);
    const { hop = 0, decay = 0.5 } = options;
    if (!Number.isInteger(hop) || hop < 0 || hop > 5) {
      throw new InputError('hop must be an integer between 0 and 5');
    }
    if (!Number.isFinite(decay) || decay <= 0 || decay > 1) {
      throw new InputError('decay must be greater than 0 and at most 1');
    }
    if (!existsSync(this.indexPath)) throw new NotFoundError('Wiki index missing. Run wiki build first.');
    if (!tokens.length) return { results: [], links: [] };
    const expression = tokens.map(token => '"' + token.replaceAll('"', '""') + '"*').join(' OR ');
    const db = openDb(this.indexPath, true);
    try {
      db.exec('BEGIN');
      const entries = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wiki_entries'").get();
      const visibility = entries && !options.includeHistory
        ? "AND page_id NOT IN (SELECT page_id FROM wiki_entries WHERE status <> 'active')"
        : '';
      const seeds = db.prepare(`
        SELECT page_id AS id, -bm25(wiki_fts, 0.0, 5.0, 1.0) AS score
        FROM wiki_fts WHERE wiki_fts MATCH ? ${visibility} ORDER BY score DESC, page_id LIMIT ?
      `).all(expression, hop ? limit * 2 : limit) as Array<{ id: string; score: number }>;
      if (!seeds.length) return { results: [], links: [] };
      return readHits(db, seeds, limit, hop, decay, Boolean(entries), Boolean(options.includeHistory));
    } finally {
      db.close();
    }
  }
}

function readHits(db: DatabaseSync, seeds: { id: string; score: number }[], limit: number, hop: number, decay: number, hasEntries: boolean, includeHistory: boolean) {
  const hasSources = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_sources'").get();
  const rows = db.prepare(`SELECT m.page_id AS id, m.title, m.type, m.rel_path AS path, m.snippet,
    ${hasSources ? "COALESCE(s.sources, '[]')" : "'[]'"} AS sources,
    ${hasEntries ? 'e.metadata' : 'NULL'} AS metadata
    FROM page_meta m ${hasSources ? 'LEFT JOIN page_sources s USING(page_id)' : ''}
    ${hasEntries ? 'LEFT JOIN wiki_entries e USING(page_id)' : ''}
    ${hasEntries && !includeHistory ? "WHERE e.status IS NULL OR e.status = 'active'" : ''}`)
    .all() as (Omit<Page, 'sources' | 'entry'> & { sources: string; metadata: string | null })[];
  const pages = new Map(rows.map(({ metadata, ...row }) => [row.id, {
    ...row, path: row.path.replaceAll('\\', '/'), sources: JSON.parse(row.sources) as string[],
    ...(metadata ? { entry: JSON.parse(metadata) as WikiEntryMetadata } : {}),
  }]));
  const graph = new UndirectedGraph();
  const outgoing = new Map<string, Set<string>>();
  for (const page of pages.values()) {
    graph.addNode(page.id, { label: page.title });
    outgoing.set(page.id, new Set());
  }
  const edges = db.prepare('SELECT source_id AS source, target_id AS target FROM graph_edge ORDER BY source_id, target_id')
    .all() as Array<{ source: string; target: string }>;
  for (const { source, target } of edges) {
    if (source === target || !graph.hasNode(source) || !graph.hasNode(target)) continue;
    graph.mergeUndirectedEdge(source, target);
    outgoing.get(source)!.add(target);
  }
  const expanded = graphMultiHopSearch(graph, seeds, { hop, decay, minScore: 0 }).slice(0, limit);
  const results: WikiHit[] = expanded.map(({ id, score, hop, via }) => ({
    ...pages.get(id)!, score, hop, via,
    related: graph.neighbors(id).sort((a, b) => graph.degree(b) - graph.degree(a) || a.localeCompare(b)).slice(0, 10)
      .map(neighbor => ({
        title: pages.get(neighbor)!.title,
        path: pages.get(neighbor)!.path,
        direction: outgoing.get(id)!.has(neighbor) ? (outgoing.get(neighbor)!.has(id) ? 'both' : 'out') : 'in',
      })),
  }));
  const included = new Set(results.map(result => result.id));
  const links = edges.filter(({ source, target }) => included.has(source) && included.has(target))
    .map(({ source, target }) => ({ source: pages.get(source)!.path, target: pages.get(target)!.path }));
  return { results, links };
}
