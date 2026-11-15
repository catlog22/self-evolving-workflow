import { randomUUID } from 'node:crypto';
import {
  createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError } from './common.js';
import type { ConversationMessage, MemoryStore } from './memory.js';
import type { LlmClient } from './upstream/llm.js';

const source = 'codex';
const statusMessage = 'Extracting Agent Memory from Codex';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function projectContains(root: string, cwd: unknown): boolean {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  const path = relative(root, existsSync(cwd) ? realpathSync(cwd) : cwd);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function quoteCommand(args: string[]): string {
  if (process.platform === 'win32') return '& ' + args.map(arg => `'${arg.replaceAll("'", "''")}'`).join(' ');
  return args.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

export function installCodexMemoryHook(root: string) {
  const directory = join(root, '.codex');
  const path = join(directory, 'hooks.json');
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const config = previous === undefined ? {} : object(JSON.parse(previous.replace(/^\uFEFF/, '')));
  const hooks = config?.hooks === undefined ? {} : object(config.hooks);
  const stop = hooks?.Stop ?? [];
  if (!config || !hooks || !Array.isArray(stop)) throw new InputError('Invalid Codex hooks configuration');

  const entry = {
    type: 'command',
    command: quoteCommand([process.execPath, fileURLToPath(new URL('./cli.js', import.meta.url)), 'memory', 'codex-hook', '--root', root]),
    timeout: 150,
    statusMessage,
  };
  const ownEntries = stop.flatMap(group => Array.isArray(group?.hooks) ? group.hooks.filter(isMemoryHook) : []);
  if (ownEntries.length === 1 && JSON.stringify(ownEntries[0]) === JSON.stringify(entry)) return { path, changed: false };
  const otherGroups = stop.flatMap(group => {
    if (!Array.isArray(group?.hooks) || !group.hooks.some(isMemoryHook)) return [group];
    const remaining = group.hooks.filter((hook: unknown) => !isMemoryHook(hook));
    return remaining.length ? [{ ...group, hooks: remaining }] : [];
  });
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    const updated = { ...config, hooks: { ...hooks, Stop: [...otherGroups, { hooks: [entry] }] } };
    writeFileSync(temporary, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx' });
    if ((existsSync(path) ? readFileSync(path, 'utf8') : undefined) !== previous) {
      throw new InputError('Codex hooks configuration changed during installation');
    }
    renameSync(temporary, path);
    return { path, changed: true };
  } finally {
    rmSync(temporary, { force: true });
  }
}

function isMemoryHook(value: unknown): boolean {
  const hook = object(value);
  return hook?.statusMessage === statusMessage && typeof hook.command === 'string' && hook.command.includes('codex-hook');
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
        throw new InputError(`Invalid Codex transcript JSON at byte ${rowOffset}`);
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
    if (kind === 'input_text' && /^(?:# AGENTS\.md instructions for |<environment_context>)/.test(part.text.trimStart())) return [];
    return [part.text];
  }).join('\n');
}

async function importTranscript(path: string, options: ImportOptions) {
  const info = statSync(path);
  if (!info.isFile()) throw new InputError('Codex transcript must be a file');
  let header: Record<string, unknown> | undefined;
  for await (const { row } of transcriptRows(path, 0, info.size)) {
    if (row?.type === 'session_meta') header = object(row.payload);
    break;
  }
  const session = header?.id;
  if (!header || !readableText(session) || (options.session !== undefined && options.session !== session) ||
      !projectContains(options.root, header.cwd) || object(header.source)?.subagent !== undefined) return;

  let offset = options.memory.extractionOffset(source, session);
  if (offset > info.size) throw new InputError('Codex transcript is shorter than its saved extraction offset');
  let messages: ConversationMessage[] = [];
  let remembered = 0;
  let processed = 0;
  for await (const { row, start, end } of transcriptRows(path, offset, info.size)) {
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
        if (payload.phase === 'final_answer' || content === options.lastAssistant) final = content;
      }
    }
    if (!final || !messages.length || !readableText(row.timestamp)) continue;
    messages.push({ id: `codex:${session}:${start}`, role: 'assistant', timestamp: row.timestamp, content: final });
    if (options.memory.extractionOffset(source, session) === offset) {
      const records = await options.memory.extractIncremental(messages, {
        source, from: offset, to: end, llm: options.model(), session, mode: 'code',
      });
      if (records) {
        remembered += records.length;
        processed++;
      }
    }
    offset = end;
    messages = [];
  }
  return { session, processed, remembered };
}

export async function handleCodexMemoryHook(input: unknown, options: ImportOptions): Promise<void> {
  const event = object(input);
  if (event?.hook_event_name !== 'Stop' || !readableText(event.transcript_path) || !readableText(event.session_id)) return;
  const root = realpathSync(options.root);
  if (!projectContains(root, event.cwd)) return;
  await importTranscript(event.transcript_path, {
    ...options, root, session: event.session_id,
    lastAssistant: readableText(event.last_assistant_message) ? event.last_assistant_message : undefined,
  });
}

export async function syncCodexMemory(options: ImportOptions) {
  const root = realpathSync(options.root);
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const sessions = new Set<string>();
  const failures: { path: string; error: string }[] = [];
  let processed = 0;
  let remembered = 0;
  for (const name of ['sessions', 'archived_sessions']) {
    const directory = join(home, name);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
      if (options.session && !entry.name.endsWith(`-${options.session}.jsonl`)) continue;
      const path = join(entry.parentPath, entry.name);
      try {
        const result = await importTranscript(path, { ...options, root });
        if (!result) continue;
        sessions.add(result.session);
        processed += result.processed;
        remembered += result.remembered;
      } catch (error) {
        failures.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { sessions: sessions.size, processed, remembered, failures };
}
