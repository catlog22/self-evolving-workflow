import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AgentMemoryPrompt } from './agent-memory-prompts.js';
import { InputError, openDb, requireText, searchLimit, transaction } from './common.js';
import { formatExtractionPrompt, getExtractMemoriesAgentPrompt } from './upstream/l1-extraction.js';
import type { LlmClient } from './upstream/llm.js';
import { rrfMerge } from './upstream/search-utils.js';
import { bm25RankToScore, buildFtsQuery, tokenizeForFts } from './upstream/tokenize.js';
import type { KnowledgeReads } from './knowledge-reads.js';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  timestamp: number | string;
  content: string;
}

export interface MemoryInput {
  id?: string;
  content: string;
  type?: string;
  scene?: string;
  session?: string;
  priority?: number;
  sourceMessageIds?: string[];
  embedding?: ArrayLike<number>;
}

export interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  scene: string;
  session: string;
  priority: number;
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemorySearchOptions {
  limit?: number;
  type?: string;
  scene?: string;
  session?: string;
  embedding?: ArrayLike<number>;
}

export interface MemoryStoreOptions {
  namespace?: string;
  embed?: (text: string) => Promise<ArrayLike<number>>;
}

interface ExtractionOptions {
  llm: LlmClient;
  session: string;
  mode?: 'chat' | 'code';
  agentMemoryPrompt?: AgentMemoryPrompt;
  systemPrompt?: string;
}

type Row = Omit<MemoryRecord, 'sourceMessageIds'> & { sourceMessageIds: string; vector: string | null };
type Hit = MemoryRecord & { score: number };

const recordFields = `m.id, m.content, m.type, m.scene, m.session, m.priority,
  m.source_ids AS sourceMessageIds, m.created_at AS createdAt, m.updated_at AS updatedAt, m.version`;

function record(row: Row): MemoryRecord {
  const { vector, sourceMessageIds, ...fields } = row;
  return { ...fields, sourceMessageIds: JSON.parse(sourceMessageIds) };
}

function normalized(values: ArrayLike<number>): number[] {
  const vector = Array.from(values);
  let scale = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new InputError('embedding must contain finite numbers');
    scale = Math.max(scale, Math.abs(value));
  }
  if (scale === 0) {
    throw new InputError('embedding must be a non-zero vector of finite numbers');
  }
  const scaled = vector.map(value => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value ** 2, 0));
  return scaled.map(value => value / norm);
}

export class MemoryStore {
  private readonly db: DatabaseSync;
  private readonly namespace: string;
  private readonly embed?: MemoryStoreOptions['embed'];

  constructor(path: string, options: MemoryStoreOptions = {}) {
    this.namespace = requireText(options.namespace ?? 'default', 'namespace');
    this.embed = options.embed;
    const file = path === ':memory:' ? path : resolve(path);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = openDb(file);
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_records (
          key INTEGER PRIMARY KEY,
          namespace TEXT NOT NULL,
          id TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          scene TEXT NOT NULL,
          session TEXT NOT NULL,
          priority INTEGER NOT NULL,
          source_ids TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL,
          vector TEXT,
          dimensions INTEGER,
          UNIQUE (namespace, id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(tokens, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS memory_extraction_offsets (
          namespace TEXT NOT NULL,
          source TEXT NOT NULL,
          session TEXT NOT NULL,
          offset INTEGER NOT NULL,
          PRIMARY KEY (namespace, source, session)
        );
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  async put(input: MemoryInput): Promise<MemoryRecord> {
    return (await this.putMany([input]))[0];
  }

  async putMany(inputs: MemoryInput[]): Promise<MemoryRecord[]> {
    return (await this.writeMany(inputs))!;
  }

  private async writeMany(inputs: MemoryInput[], advance?: () => boolean): Promise<MemoryRecord[] | undefined> {
    const prepared = await Promise.all(inputs.map(async input => {
      const content = requireText(input.content, 'content');
      const priority = input.priority ?? 50;
      if (!Number.isInteger(priority) || priority < -1 || priority > 100) {
        throw new InputError('priority must be an integer between -1 and 100');
      }
      const embedding = input.embedding ?? await this.embed?.(content);
      return {
        id: requireText(input.id ?? randomUUID(), 'id'), content, priority,
        type: requireText(input.type ?? 'episodic', 'type'),
        scene: input.scene ?? '', session: input.session ?? '',
        sourceIds: JSON.stringify(input.sourceMessageIds ?? []),
        vector: embedding === undefined ? null : normalized(embedding),
      };
    }));
    const now = new Date().toISOString();
    return transaction(this.db, () => advance && !advance() ? undefined : prepared.map(input => {
      const row = this.db.prepare(`
        INSERT INTO memory_records (
          namespace, id, content, type, scene, session, priority, source_ids, created_at, updated_at, version, vector, dimensions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT (namespace, id) DO UPDATE SET
          content=excluded.content, type=excluded.type, scene=excluded.scene, session=excluded.session,
          priority=excluded.priority, source_ids=excluded.source_ids, updated_at=excluded.updated_at,
          version=memory_records.version+1, vector=excluded.vector, dimensions=excluded.dimensions
        WHERE (memory_records.content, memory_records.type, memory_records.scene, memory_records.session,
          memory_records.priority, memory_records.source_ids, memory_records.vector)
          IS NOT (excluded.content, excluded.type, excluded.scene, excluded.session,
          excluded.priority, excluded.source_ids, excluded.vector)
        RETURNING key
      `).get(this.namespace, input.id, input.content, input.type, input.scene, input.session,
        input.priority, input.sourceIds, now, now,
        input.vector && JSON.stringify(input.vector), input.vector?.length ?? null);
      if (row) {
        const key = Number(row.key);
        this.db.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(key);
        this.db.prepare('INSERT INTO memory_fts(rowid, tokens) VALUES (?, ?)').run(key, tokenizeForFts(input.content));
      }
      return this.get(input.id)!;
    }));
  }

  get(id: string, options: { knowledgeReads?: KnowledgeReads; fromSearchId?: string } = {}): MemoryRecord | undefined {
    const row = this.db.prepare(`SELECT ${recordFields} FROM memory_records m WHERE namespace = ? AND id = ?`)
      .get(this.namespace, id) as Row | undefined;
    const result = row && record(row);
    if (result && options.knowledgeReads) {
      options.knowledgeReads.recordRead({
        kind: 'memory', id: result.id, fromSearchId: options.fromSearchId,
        content: result.content, version: result.version,
      });
    }
    return result;
  }

  delete(id: string): boolean {
    return transaction(this.db, () => {
      const row = this.db.prepare('DELETE FROM memory_records WHERE namespace = ? AND id = ? RETURNING key')
        .get(this.namespace, id);
      if (!row) return false;
      this.db.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(Number(row.key));
      return true;
    });
  }

  async search(query: string, options: MemorySearchOptions = {}) {
    const text = requireText(query, 'query');
    const limit = searchLimit(options.limit);
    const embedding = options.embedding ?? await this.embed?.(text);
    const vector = embedding === undefined ? undefined : normalized(embedding);
    const expression = buildFtsQuery(text);
    const clauses = ['m.namespace = ?'];
    const args: SQLInputValue[] = [this.namespace];
    for (const field of ['type', 'scene', 'session'] as const) {
      if (options[field] !== undefined) {
        clauses.push(`m.${field} = ?`);
        args.push(options[field]);
      }
    }
    const where = clauses.join(' AND ');
    const candidates = vector ? limit * 3 : limit;
    const keyword: Hit[] = expression ? (this.db.prepare(`
      SELECT ${recordFields}, bm25(memory_fts) AS rank FROM memory_fts
      JOIN memory_records m ON m.key = memory_fts.rowid
      WHERE memory_fts MATCH ? AND ${where} ORDER BY rank, m.id LIMIT ?
    `).all(expression, ...args, candidates) as (Row & { rank: number })[]).map(({ rank, ...row }) => ({
      ...record(row), score: bm25RankToScore(rank),
    })) : [];
    const semantic: Hit[] = [];
    if (vector) {
      const statement = this.db.prepare(`
        SELECT ${recordFields}, m.vector FROM memory_records m WHERE ${where} AND m.dimensions = ? ORDER BY m.id
      `);
      for (const row of statement.iterate(...args, vector.length) as Iterable<Row>) {
        const other: number[] = JSON.parse(row.vector!);
        const score = vector.reduce((sum, value, i) => sum + value * other[i], 0);
        if (score > 0) semantic.push({ ...record(row), score });
      }
      semantic.sort((a, b) => b.score - a.score);
      semantic.length = Math.min(candidates, semantic.length);
    }
    if (keyword.length && semantic.length) {
      const results = rrfMerge([keyword, semantic], item => item.id)
        .slice(0, limit).map(({ rrfScore, ...item }) => ({ ...item, score: rrfScore }));
      return { strategy: 'hybrid' as const, results };
    }
    if (semantic.length) return { strategy: 'embedding' as const, results: semantic.slice(0, limit) };
    return { strategy: 'fts' as const, results: keyword.slice(0, limit) };
  }

  async extract(messages: ConversationMessage[], options: ExtractionOptions): Promise<MemoryRecord[]> {
    return this.putMany(await extractMemoryInputs(messages, options));
  }

  extractionOffset(source: string, session: string): number {
    const row = this.db.prepare(`SELECT offset FROM memory_extraction_offsets
      WHERE namespace = ? AND source = ? AND session = ?`).get(this.namespace, source, session);
    return Number(row?.offset ?? 0);
  }

  async extractIncremental(messages: ConversationMessage[], options: ExtractionOptions & {
    source: string;
    from: number;
    to: number;
  }): Promise<MemoryRecord[] | undefined> {
    const { source, session, from, to } = options;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) {
      throw new InputError('Invalid memory extraction offsets');
    }
    if (this.extractionOffset(source, session) !== from) return;
    const inputs = await extractMemoryInputs(messages, options);
    return this.writeMany(inputs, () => {
      if (this.extractionOffset(source, session) !== from) return false;
      this.db.prepare(`INSERT INTO memory_extraction_offsets (namespace, source, session, offset) VALUES (?, ?, ?, ?)
        ON CONFLICT (namespace, source, session) DO UPDATE SET offset = excluded.offset`)
        .run(this.namespace, source, session, to);
      return true;
    });
  }
}

export async function extractMemoryInputs(messages: ConversationMessage[], options: ExtractionOptions): Promise<MemoryInput[]> {
  const session = requireText(options.session, 'session');
  if (!messages.length) return [];
  const ids = validateConversationMessages(messages);
  const agentMemoryPrompt = options.agentMemoryPrompt ?? getExtractMemoriesAgentPrompt(options.mode);
  const raw = await options.llm.chat({
    system: options.systemPrompt ?? agentMemoryPrompt.system,
    prompt: formatExtractionPrompt({ newMessages: messages }),
    label: agentMemoryPrompt.label,
  });
  return parseExtraction(raw, session, ids);
}

export function validateConversationMessages(messages: readonly ConversationMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const id = requireText(message?.id, 'message id');
    if (ids.has(id)) throw new InputError(`Duplicate message id: ${id}`);
    if (!['user', 'assistant', 'system', 'tool'].includes(message.role) ||
        (typeof message.timestamp !== 'number' && typeof message.timestamp !== 'string') ||
        !Number.isFinite(new Date(message.timestamp).getTime())) {
      throw new InputError(`Invalid role or timestamp for message: ${id}`);
    }
    requireText(message.content, 'message content');
    if (id !== message.id) throw new InputError('message id cannot have surrounding whitespace');
    ids.add(id);
  }
  return ids;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} in memory extraction response`);
  }
  return value as Record<string, unknown>;
}

function parseExtraction(raw: string, session: string, messageIds: Set<string>): MemoryInput[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  const json = text.match(/\[[\s\S]*\]/)?.[0];
  if (!json) throw new Error('Memory extraction response must contain a JSON array');
  const scenes: unknown = JSON.parse(json);
  if (!Array.isArray(scenes)) throw new Error('Memory extraction response must be an array');
  return scenes.flatMap(value => {
    const scene = object(value, 'scene');
    if (!Array.isArray(scene.memories)) throw new Error('Memory extraction scene requires a memories array');
    return scene.memories.map(value => {
      const memory = object(value, 'memory');
      const content = requireText(memory.content, 'memory content');
      const type = requireText(memory.type ?? 'episodic', 'memory type');
      const sourceIds = memory.source_message_ids ?? scene.message_ids;
      const sourceMessageIds = Array.isArray(sourceIds)
        ? [...new Set(sourceIds.map(String).filter(id => messageIds.has(id)))].sort()
        : [];
      const id = createHash('sha256').update(JSON.stringify([session, type, content, sourceMessageIds])).digest('hex');
      return {
        id, content, type, session, sourceMessageIds,
        scene: typeof scene.scene_name === 'string' ? scene.scene_name : '',
        priority: typeof memory.priority === 'number' ? memory.priority : undefined,
      };
    });
  });
}
