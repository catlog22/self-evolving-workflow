import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError, openDb } from './common.js';
import type { MemoryHost } from './memory-config.js';
import type { ConversationMessage, MemoryStore } from './memory.js';
import type { LlmClient } from './upstream/llm.js';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function projectContains(root: string, cwd: unknown): boolean {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  const path = relative(root, existsSync(cwd) ? realpathSync(cwd) : cwd);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function* transcriptRows(path: string, from: number, size: number) {
  if (from >= size) return;
  let offset = from;
  let parts: Buffer[] = [];
  const stream = createReadStream(path, { start: from, end: size - 1 });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let start = 0;
    for (let end = chunk.indexOf(10, start); end >= 0; end = chunk.indexOf(10, start)) {
      parts.push(chunk.subarray(start, end));
      const line = Buffer.concat(parts);
      const text = line.toString('utf8').replace(/^\uFEFF/, '');
      const rowOffset = offset;
      offset += line.length + 1;
      parts = [];
      start = end + 1;
      if (!text.trim()) continue;
      let row: Record<string, unknown> | undefined;
      try {
        row = object(JSON.parse(text));
      } catch {
        throw new InputError(`Invalid transcript JSON at byte ${rowOffset}`);
      }
      yield { row, start: rowOffset, end: offset };
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  }
  // 活跃会话可能还在写入最后一行，下一次从已提交的位置重新读取。
}

interface ImportOptions {
  root: string;
  memory: MemoryStore;
  model: () => LlmClient;
}

interface Transcript {
  path: string;
  session?: string;
  lastAssistant?: string;
}

function readableText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function messageText(parts: unknown, kind: string): string {
  if (!Array.isArray(parts)) return '';
  return parts.flatMap(part => {
    if (part?.type !== kind || !readableText(part.text)) return [];
    if (kind === 'input_text' && /^(?:# AGENTS\.md instructions for |<(?:environment_context|recommended_plugins)>)/.test(part.text.trimStart())) return [];
    return [part.text];
  }).join('\n');
}

async function codexSession({ path, session }: Transcript, root: string, size: number) {
  for await (const { row } of transcriptRows(path, 0, size)) {
    const header = row?.type === 'session_meta' ? object(row.payload) : undefined;
    if (header && readableText(header.id) && (session === undefined || session === header.id) &&
        projectContains(root, header.cwd) && object(header.source)?.subagent === undefined) return header.id;
    return;
  }
}

async function* codexTurns({ path, lastAssistant }: Transcript, session: string, offset: number, size: number) {
  let messages: ConversationMessage[] = [];
  for await (const { row, start, end } of transcriptRows(path, offset, size)) {
    const payload = object(row?.payload);
    if (!payload || !row) continue;
    let final = '';
    if (row.type === 'event_msg') {
      if (payload.type === 'task_started' || payload.type === 'turn_aborted') messages = [];
      if (payload.type === 'task_complete' && !payload.error && readableText(payload.last_agent_message)) {
        final = payload.last_agent_message;
      }
    } else if (row.type === 'response_item' && payload.type === 'message') {
      if (payload.role === 'user') {
        const content = messageText(payload.content, 'input_text');
        if (content && readableText(row.timestamp)) {
          messages.push({ id: `codex:${session}:${start}`, role: 'user', timestamp: row.timestamp, content });
        }
      } else if (payload.role === 'assistant' && payload.phase !== 'commentary') {
        const content = messageText(payload.content, 'output_text');
        if (payload.phase === 'final_answer' || content === lastAssistant) final = content;
      }
    }
    if (!final || !messages.length || !readableText(row.timestamp)) continue;
    messages.push({ id: `codex:${session}:${start}`, role: 'assistant', timestamp: row.timestamp, content: final });
    yield { end, messages };
    messages = [];
  }
}

function claudeChat(row: Record<string, unknown> | undefined) {
  if (!row || (row.type !== 'user' && row.type !== 'assistant') ||
      row.isSidechain || row.isMeta || row.isCompactSummary || row.isApiErrorMessage) return;
  const message = object(row.message);
  if (message?.role === row.type) return { role: row.type, message } as const;
}

async function claudeSession({ path, session }: Transcript, root: string, size: number) {
  for await (const { row } of transcriptRows(path, 0, size)) {
    if (!row || !claudeChat(row) || !readableText(row.sessionId) || !readableText(row.cwd)) continue;
    if ((session === undefined || row.sessionId === session) && projectContains(root, row.cwd)) return row.sessionId;
    return;
  }
}

async function* claudeTurns({ path, lastAssistant }: Transcript, session: string, offset: number, size: number) {
  let users: ConversationMessage[] = [];
  let reply: { key: unknown; messages: ConversationMessage[]; end: number; complete: boolean } | undefined;
  const ready = () => reply?.complete || (reply && reply.messages.map(message => message.content).join('\n') === lastAssistant);
  for await (const { row, start, end } of transcriptRows(path, offset, size)) {
    const chat = row?.sessionId === session ? claudeChat(row) : undefined;
    if (!chat || !readableText(row?.timestamp)) continue;
    const parts = chat.message.content;
    const content = typeof parts === 'string' ? parts : messageText(parts, 'text');
    const hasToolData = Array.isArray(parts) && parts.some(part => ['tool_result', 'tool_use', 'server_tool_use'].includes(part?.type));
    if (chat.role === 'user' && (hasToolData || !content.trim())) continue;
    if (chat.role === 'user' || (reply && reply.key !== chat.message.id)) {
      if (reply && users.length && ready()) {
        yield { end: reply.end, messages: [...users, ...reply.messages] };
        users = [];
      }
      reply = undefined;
    }
    const id = `claude:${session}:${readableText(row.uuid) ? row.uuid : start}`;
    const item = { id, role: chat.role, timestamp: row.timestamp, content };
    if (chat.role === 'user') {
      users.push(item);
      continue;
    }
    if (hasToolData || chat.message.stop_reason === 'tool_use') {
      reply = undefined;
      continue;
    }
    if (!content.trim() || !users.length) continue;
    reply ??= { key: chat.message.id, messages: [], end, complete: false };
    reply.messages.push(item);
    reply.end = end;
    reply.complete ||= ['end_turn', 'stop_sequence'].includes(String(chat.message.stop_reason));
  }
  if (reply && users.length && ready()) yield { end: reply.end, messages: [...users, ...reply.messages] };
}

async function* agyTurns({ path }: Transcript, session: string, offset: number, size: number) {
  let messages: ConversationMessage[] = [];
  for await (const { row } of transcriptRows(path, 0, size)) {
    if (!row || typeof row.step_index !== 'number' || !Number.isSafeInteger(row.step_index) ||
        row.step_index < offset || row.status !== 'DONE' || !readableText(row.created_at) || !readableText(row.content)) continue;
    const id = `agy:${session}:${row.step_index}`;
    if (row.type === 'USER_INPUT' && row.source === 'USER_EXPLICIT') {
      messages.push({ id, role: 'user', timestamp: row.created_at, content: row.content });
    } else if (row.type === 'PLANNER_RESPONSE' && row.source === 'MODEL' && messages.length &&
        !(Array.isArray(row.tool_calls) && row.tool_calls.length)) {
      messages.push({ id, role: 'assistant', timestamp: row.created_at, content: row.content });
      yield { end: row.step_index + 1, messages };
      messages = [];
    }
  }
}

const turnReaders = { codex: codexTurns, claude: claudeTurns, agy: agyTurns };

async function importTranscript(host: MemoryHost, transcript: Transcript, { root, memory, model }: ImportOptions) {
  const info = statSync(transcript.path);
  if (!info.isFile()) throw new InputError('Transcript must be a file');
  const session = host === 'codex' ? await codexSession(transcript, root, info.size)
    : host === 'claude' ? await claudeSession(transcript, root, info.size) : transcript.session;
  if (!session) return;
  let offset = memory.extractionOffset(host, session);
  if (host !== 'agy' && offset > info.size) throw new InputError('Transcript is shorter than its saved extraction offset');
  let remembered = 0;
  let processed = 0;
  for await (const turn of turnReaders[host](transcript, session, offset, info.size)) {
    if (memory.extractionOffset(host, session) === offset) {
      const records = await memory.extractIncremental(turn.messages, {
        source: host, from: offset, to: turn.end, llm: model(), session, mode: 'code',
      });
      if (records) {
        remembered += records.length;
        processed++;
      }
    }
    offset = turn.end;
  }
  return { session, processed, remembered };
}

export async function handleMemoryHook(host: MemoryHost, input: unknown, options: ImportOptions) {
  const event = object(input);
  const root = realpathSync(options.root);
  if (host === 'agy') {
    if (readableText(event?.conversationId) && readableText(event.transcriptPath) && !event.error &&
        projectContains(root, event.cwd ?? (Array.isArray(event.workspacePaths) ? event.workspacePaths[0] : undefined))) {
      await importTranscript(host, { path: event.transcriptPath, session: event.conversationId }, { ...options, root });
    }
    return { decision: 'stop' };
  }
  if (event?.hook_event_name === 'Stop' && readableText(event.transcript_path) && readableText(event.session_id) &&
      projectContains(root, event.cwd)) {
    await importTranscript(host, { path: event.transcript_path, session: event.session_id,
      lastAssistant: readableText(event.last_assistant_message) ? event.last_assistant_message : undefined }, { ...options, root });
  }
  return {};
}

function workspacePath(uri: string): string | undefined {
  if (!uri.startsWith('file:')) return;
  try {
    return fileURLToPath(uri);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // 宿主可能保留其他平台上的路径，当前系统只能导入能解析的工作区。
    return;
  }
}

function* agyTranscripts(root: string, session: string | undefined): Generator<Transcript> {
  const home = join(homedir(), '.gemini', 'antigravity-cli');
  const index = join(home, 'conversation_summaries.db');
  if (!existsSync(index)) return;
  const db = openDb(index, true);
  try {
    const select = db.prepare(`SELECT conversation_id, workspace_uris FROM conversation_summaries
      WHERE coalesce(parent_conversation_id, '') = ''${session === undefined ? '' : ' AND conversation_id = ?'}`);
    for (const row of select.iterate(...(session === undefined ? [] : [session]))) {
      const { conversation_id: id, workspace_uris: raw } = row;
      if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || !readableText(raw)) continue;
      const uris: unknown = JSON.parse(raw);
      if (!Array.isArray(uris) || typeof uris[0] !== 'string' || !projectContains(root, workspacePath(uris[0]))) continue;
      const path = join(home, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
      if (existsSync(path)) yield { path, session: id };
    }
  } finally {
    db.close();
  }
}

function* savedTranscripts(host: MemoryHost, root: string, session?: string): Generator<Transcript> {
  if (host === 'agy') return yield* agyTranscripts(root, session);
  if (host === 'claude') {
    const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
    if (!existsSync(projects)) return;
    for (const project of readdirSync(projects, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const directory = join(projects, project.name);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl') && (!session || basename(entry.name, '.jsonl') === session)) {
          yield { path: join(directory, entry.name), session: session ?? basename(entry.name, '.jsonl') };
        }
      }
    }
    return;
  }
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  for (const name of ['sessions', 'archived_sessions']) {
    const directory = join(home, name);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name) && (!session || entry.name.endsWith(`-${session}.jsonl`))) {
        yield { path: join(entry.parentPath, entry.name), session };
      }
    }
  }
}

export async function syncMemoryHost(host: MemoryHost, options: ImportOptions, session?: string) {
  const root = realpathSync(options.root);
  const sessions = new Set<string>();
  const failures: { path: string; error: string }[] = [];
  let processed = 0;
  let remembered = 0;
  try {
    for (const transcript of savedTranscripts(host, root, session)) {
      try {
        const result = await importTranscript(host, transcript, { ...options, root });
        if (!result) continue;
        sessions.add(result.session);
        processed += result.processed;
        remembered += result.remembered;
      } catch (error) {
        failures.push({ path: transcript.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    failures.push({ path: host, error: error instanceof Error ? error.message : String(error) });
  }
  return { sessions: sessions.size, processed, remembered, failures };
}
