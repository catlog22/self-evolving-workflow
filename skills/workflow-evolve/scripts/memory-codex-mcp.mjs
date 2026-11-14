import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [memoryCli, root, db, entry, statePath] = process.argv.slice(2);
if (!memoryCli || !root || !db || !entry || !statePath) {
  throw new Error('memory-codex-mcp requires memory CLI, root, database, entry and state paths');
}

const toolDefinitions = [
  {
    name: 'read_skill',
    description: 'Read the selected Skill Markdown entry from the bound checkout.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory_search',
    description: 'Search Agent Memory for guidance relevant to the current task.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'memory_get',
    description: 'Read one Agent Memory item returned by memory_search.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
    },
  },
];

function callMemory(...args) {
  const output = execFileSync(process.execPath, [memoryCli, '--root', root, '--db', db, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { reads: [], searches: [], memoryReads: [] }; }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function readSkill() {
  const path = resolve(root, entry);
  const markdown = readFileSync(path, 'utf8');
  const state = readState();
  if (!state.reads.some(item => item.path === entry)) {
    state.reads.push({ path: entry, sha256: createHash('sha256').update(markdown).digest('hex') });
    writeState(state);
  }
  return { path: entry, markdown };
}

function searchMemory(query) {
  const result = callMemory('memory', 'search', query, '--trace');
  const state = readState();
  state.searches.push({ query, result });
  writeState(state);
  return result;
}

function getMemory(id) {
  const result = callMemory('memory', 'get', id, '--trace');
  const state = readState();
  state.memoryReads.push({ id, result });
  writeState(state);
  return result;
}

async function handle(line) {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  try {
    let value;
    switch (request.method) {
      case 'initialize':
        value = { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'workflow-evolve-memory', version: '1.0.0' } };
        break;
      case 'ping': value = {}; break;
      case 'tools/list': value = { tools: toolDefinitions }; break;
      case 'tools/call': {
        const name = request.params?.name;
        const args = request.params?.arguments ?? {};
        if (name === 'read_skill') value = readSkill();
        else if (name === 'memory_search' && typeof args.query === 'string' && args.query.trim()) value = searchMemory(args.query);
        else if (name === 'memory_get' && typeof args.id === 'string' && args.id.trim()) value = getMemory(args.id);
        else throw new Error(`Unsupported memory tool call: ${name}`);
        break;
      }
      default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n'); return;
    }
    const result = request.method === 'tools/call'
      ? { content: [{ type: 'text', text: JSON.stringify(value) }] }
      : value;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method === 'tools/call') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        result: { isError: true, content: [{ type: 'text', text: message }] } }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: -32000, message } }) + '\n');
    }
  }
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) await handle(line.replace(/^\uFEFF/, ''));
