import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { InputError, requireText } from './common.js';
import type { ConversationMessage } from './memory.js';

export type HostKind = 'codex' | 'agy' | 'claude';

export interface HostTranscriptAdapter {
  kind: HostKind;
  parse(value: unknown, index: number, capturedAt: string): ConversationMessage | undefined;
}

export interface HostTranscriptCapture {
  host_kind: HostKind;
  host_session_id: string;
  messages: ConversationMessage[];
  snapshots: TranscriptEvidenceSnapshot[];
  refs: string[];
}

export interface TranscriptEvidenceSnapshot {
  schema_version: 'transcript-evidence/1.0';
  sha256: string;
  normalized_sha256: string;
  host_kind: HostKind;
  host_session_id: string;
  entry_id: string;
  quote: string;
  captured_at: string;
  file_name: string;
  ref: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map(text).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('\n') : undefined;
  }
  const record = object(value);
  if (!record) return undefined;
  for (const key of ['text', 'value', 'output_text', 'content']) {
    const valueText = text(record[key]);
    if (valueText) return valueText;
  }
  return undefined;
}

function nestedRecord(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['message', 'item', 'event']) {
    const nested = object(value[key]);
    if (nested) return { ...value, ...nested };
  }
  return value;
}

function role(value: Record<string, unknown>): ConversationMessage['role'] {
  const candidate = value.role;
  if (candidate === 'user' || candidate === 'assistant' || candidate === 'system' || candidate === 'tool') {
    return candidate;
  }
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : '';
  if (type.includes('user')) return 'user';
  if (type.includes('assistant') || type.includes('response')) return 'assistant';
  return 'tool';
}

function safePart(value: unknown, label: string): string {
  const textValue = requireText(value, label);
  if (/[:\p{Cc}]/u.test(textValue)) throw new InputError(`${label} contains a colon or control character`);
  return textValue;
}

function parseHostMessage(value: unknown, kind: HostKind, index: number, capturedAt: string): ConversationMessage | undefined {
  const record = object(value);
  if (!record) return undefined;
  const merged = nestedRecord(record);
  const content = text(merged.content ?? merged.text ?? merged.output_text);
  if (!content) return undefined;
  const rawId = merged.id ?? merged.message_id ?? `${kind}-${index + 1}`;
  const id = safePart(String(rawId).replace(/[:\p{Cc}]/gu, '-'), 'transcript entry ID');
  const timestamp = typeof merged.timestamp === 'string' || typeof merged.timestamp === 'number'
    ? merged.timestamp : capturedAt;
  return {
    id,
    role: role(merged),
    timestamp,
    content,
  };
}

function adapter(kind: HostKind): HostTranscriptAdapter {
  return { kind, parse: (value, index, capturedAt) => parseHostMessage(value, kind, index, capturedAt) };
}

export const hostTranscriptAdapters: Record<HostKind, HostTranscriptAdapter> = {
  codex: adapter('codex'),
  agy: adapter('agy'),
  claude: adapter('claude'),
};

export function isHostKind(value: unknown): value is HostKind {
  return value === 'codex' || value === 'agy' || value === 'claude';
}

function locatorHash(hostKind: HostKind, session: string, entry: string): string {
  return createHash('sha256').update([hostKind, session, entry].join('\0')).digest('hex').slice(0, 16);
}

function snapshotFor(hostKind: HostKind, session: string, message: ConversationMessage, capturedAt: string): TranscriptEvidenceSnapshot {
  const quote = requireText(message.content, 'transcript quote');
  const sha256 = createHash('sha256').update(quote).digest('hex');
  const suffix = locatorHash(hostKind, session, message.id);
  return {
    schema_version: 'transcript-evidence/1.0',
    sha256,
    normalized_sha256: sha256,
    host_kind: hostKind,
    host_session_id: session,
    entry_id: message.id,
    quote,
    captured_at: capturedAt,
    file_name: `${sha256}-${suffix}.json`,
    ref: `transcript:${hostKind}:${session}:${message.id}:${sha256.slice(0, 16)}`,
  };
}

export function captureHostTranscript(input: {
  hostKind: HostKind;
  session: string;
  source: string;
  capturedAt?: string;
}): HostTranscriptCapture {
  const adapter = hostTranscriptAdapters[input.hostKind];
  const session = safePart(input.session, 'host session');
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const messages: ConversationMessage[] = [];
  const lines = readFileSync(input.source, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new InputError(`Invalid ${input.hostKind} transcript JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const message = adapter.parse(value, index, capturedAt);
    if (message) messages.push(message);
  }
  const ids = new Set(messages.map(message => message.id));
  if (ids.size !== messages.length) throw new InputError(`Duplicate ${input.hostKind} transcript entry ID`);
  const snapshots = messages.map(message => snapshotFor(input.hostKind, session, message, capturedAt));
  return { host_kind: input.hostKind, host_session_id: session, messages, snapshots, refs: snapshots.map(snapshot => snapshot.ref) };
}

export function writeHostTranscriptEvidence(directory: string, capture: HostTranscriptCapture): string[] {
  mkdirSync(directory, { recursive: true });
  const paths: string[] = [];
  for (const snapshot of capture.snapshots) {
    const target = join(directory, snapshot.file_name);
    const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
    const { file_name: _fileName, ref: _ref, ...payload } = snapshot;
    const serialized = `${JSON.stringify(payload)}\n`;
    if (existsSync(target)) {
      if (readFileSync(target, 'utf8') !== serialized) throw new InputError(`Transcript evidence changed: ${snapshot.file_name}`);
      paths.push(target);
      continue;
    }
    try {
      writeFileSync(temporary, serialized, { flag: 'wx' });
      renameSync(temporary, target);
      paths.push(target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return paths;
}
