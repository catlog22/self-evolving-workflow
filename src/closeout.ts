import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { InputError, openDb, requireText, transaction } from './common.js';
import { extractMemoryInputs, type ConversationMessage } from './memory.js';
import type { LlmClient } from './upstream/llm.js';
import type { Wiki } from './wiki.js';
import { parseFrontmatter, readSources } from './upstream/frontmatter.js';

interface Completion {
  id: string;
  session: string;
  timestamp: string;
  messages: ConversationMessage[];
}

interface Candidate {
  id: string;
  content: string;
  sources: string[];
  matched_entry: string | null;
}

function appendReferenceSources(wiki: Wiki, candidate: Candidate): boolean {
  if (!candidate.matched_entry) return false;
  const entry = wiki.getEntry(candidate.matched_entry);
  if (!entry || entry.entry?.mode !== 'reference' || entry.entry.status !== 'active' ||
      entry.body.trim() !== candidate.content.trim()) return false;

  const file = join(wiki.root, entry.path);
  if (!lstatSync(file).isFile()) throw new InputError(`Invalid Wiki entry file: ${entry.id}`);
  const original = readFileSync(file, 'utf8');
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(original);
  if (!hasFrontmatter || frontmatter.locked === true || frontmatter.mode !== 'reference' ||
      frontmatter.status !== 'active' || body.trim() !== candidate.content.trim()) return false;
  const sources = readSources(original);
  const merged = [...new Set([...sources, ...candidate.sources])];
  if (merged.length === sources.length) return true;
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `---\n${stringify({ ...frontmatter, sources: merged })}---\n${body}`, { flag: 'wx' });
    if (readFileSync(file, 'utf8') !== original) throw new InputError(`Wiki entry changed: ${entry.id}`);
    renameSync(temporary, file);
    return true;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid completion record');
  return value as Record<string, unknown>;
}

function parseReceipt(value: unknown): Completion {
  const receipt = object(value);
  if (receipt.schema_version === 'skill-completion/1.0') {
    if (!['succeeded', 'failed', 'cancelled'].includes(String(receipt.status)) || !Array.isArray(receipt.messages)) {
      throw new InputError('Invalid Skill completion');
    }
    return {
      id: requireText(receipt.id, 'completion ID'),
      session: requireText(receipt.execution_id, 'execution ID'),
      timestamp: requireText(receipt.recorded_at, 'completion time'),
      messages: receipt.messages,
    };
  }
  const result = object(receipt.result);
  if (receipt.schema_version !== 'transition-receipt/2.0' ||
      receipt.target_type !== 'orchestration' || result.status !== 'completed') {
    throw new InputError('Expected a Maestro Session completion receipt');
  }
  const id = requireText(receipt.transition_id, 'transition ID');
  const session = requireText(receipt.session_id, 'Session ID');
  if (receipt.target_id !== session) throw new InputError('Session completion target does not match');
  const timestamp = requireText(receipt.recorded_at, 'completion time');
  const messages: ConversationMessage[] = Array.isArray(result.evolve_evidence)
    ? result.evolve_evidence.map((value, index) => {
      const evidence = object(value);
      return {
        id: requireText(evidence.id, `evidence ID ${index}`),
        role: 'tool',
        timestamp,
        content: requireText(evidence.content, `evidence content ${index}`),
      };
    }) : [];
  return { id, session, timestamp, messages };
}

export function readCompletionReceipts(sourceRoot: string): unknown[] {
  const sessions = join(sourceRoot, '.workflow', 'sessions');
  const receipts: unknown[] = [];
  for (const session of readdirSync(sessions, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const directory = join(sessions, session.name, 'receipts', 'transitions');
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names.sort()) {
      if (!/^\d{12}-tr_[a-z0-9-]+\.json$/i.test(name)) continue;
      const receipt = object(JSON.parse(readFileSync(join(directory, name), 'utf8')));
      if (receipt.target_type !== 'orchestration') continue;
      const result = object(receipt.result);
      if (result.status === 'completed' && receipt.session_id === session.name) receipts.push(receipt);
    }
  }
  return receipts;
}

export async function harvestCompletion(wiki: Wiki, project: string, value: unknown, model: () => LlmClient) {
  project = requireText(project, 'source project ID');
  const completion = parseReceipt(value);
  if (!Number.isFinite(Date.parse(completion.timestamp))) throw new InputError('Invalid completion time');
  const identity = createHash('sha256').update(JSON.stringify([project, completion.id])).digest('hex');
  const payloadHash = createHash('sha256').update(JSON.stringify(completion)).digest('hex');
  const ledger = join(wiki.root, '.agent-memory', 'closeout.db');
  mkdirSync(dirname(ledger), { recursive: true });
  const db = openDb(ledger);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS closeouts (
      id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, candidates TEXT NOT NULL
    )`);
    const lookup = db.prepare('SELECT payload_hash, candidates FROM closeouts WHERE id = ?');
    const previous = () => {
      const row = lookup.get(identity);
      if (!row) return undefined;
      if (row.payload_hash !== payloadHash) throw new InputError(`Completion receipt changed: ${completion.id}`);
      return JSON.parse(String(row.candidates)) as Candidate[];
    };
    const saved = previous();
    if (saved) return { id: identity, replayed: true, candidates: saved };
    const extracted = completion.messages.length ? await extractMemoryInputs(completion.messages, {
      llm: model(), session: completion.session, mode: 'code',
    }) : [];
    const candidates: Candidate[] = [];
    for (const item of extracted) {
      if (!item.sourceMessageIds?.length) continue;
      const match = wiki.getEntryByExactBody(item.content);
      candidates.push({
        id: createHash('sha256').update(JSON.stringify([identity, item.id])).digest('hex'),
        content: item.content,
        sources: item.sourceMessageIds.map(source => `receipt:${project}:${completion.id}#${source}`),
        matched_entry: match?.id ?? null,
      });
    }
    const result = transaction(db, () => {
      const replay = previous();
      if (replay) return { id: identity, replayed: true, candidates: replay };
      const pending = candidates.filter(candidate => !appendReferenceSources(wiki, candidate));
      if (pending.length !== candidates.length) wiki.build();
      db.prepare('INSERT INTO closeouts VALUES (?, ?, ?)').run(identity, payloadHash, JSON.stringify(pending));
      return { id: identity, replayed: false, candidates: pending };
    });
    return result;
  } finally {
    db.close();
  }
}

export function publishReference(wiki: Wiki, closeoutId: string, candidateId: string, title: string) {
  if (!/^[a-f0-9]{64}$/.test(closeoutId) || !/^[a-f0-9]{64}$/.test(candidateId)) {
    throw new InputError('Expected exact closeout and candidate IDs');
  }
  title = requireText(title, 'reference title');
  const ledger = join(wiki.root, '.agent-memory', 'closeout.db');
  const db = openDb(ledger, true);
  let candidate: Candidate | undefined;
  try {
    const row = db.prepare('SELECT candidates FROM closeouts WHERE id = ?').get(closeoutId);
    if (row) candidate = (JSON.parse(String(row.candidates)) as Candidate[]).find(item => item.id === candidateId);
  } finally {
    db.close();
  }
  if (!candidate) throw new InputError('Candidate does not belong to the selected closeout');
  const id = `entries/${candidateId}`;
  const match = wiki.getEntryByExactBody(candidate.content);
  if (candidate.matched_entry || (match && match.id !== id)) {
    throw new InputError('Candidate already matches a Wiki entry');
  }

  const wikiDirectory = join(wiki.root, 'wiki');
  const entries = join(wikiDirectory, 'entries');
  for (const directory of [wikiDirectory, entries]) {
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (info && !info.isDirectory()) throw new InputError(`Invalid Wiki directory: ${directory}`);
  }
  const path = join(entries, `${candidateId}.md`);
  const metadata = { title, mode: 'reference', status: 'active', scope: ['project'], sources: candidate.sources };
  const content = `---\n${stringify(metadata)}---\n\n${candidate.content}\n`;
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && (!info.isFile() || readFileSync(path, 'utf8') !== content)) {
    throw new InputError(`Published Wiki entry differs: ${id}`);
  }
  if (!info) {
    mkdirSync(entries, { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
  }
  wiki.build();
  return { id, replayed: Boolean(info) };
}
