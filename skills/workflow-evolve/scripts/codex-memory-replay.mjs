import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { id, input, entry, commit } = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
const root = process.cwd();
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
const memoryCli = process.env.AGENT_MEMORY_CLI || resolve(root, 'dist/cli.js');
const skillPath = resolve(root, entry ?? '');
const skillMatch = /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/i.exec((entry ?? '').replaceAll('\\', '/'));
if (!skillMatch || !commit || typeof input?.task !== 'string' || !input.task.trim() ||
    typeof input.expected !== 'string' || !input.expected.trim()) {
  throw new Error(`Codex memory replay scenario ${id ?? 'unknown'} requires a Skill entry, commit, task and expected output`);
}

const db = process.env.AGENT_MEMORY_DB || join(root, '.agent-memory', 'memory.db');
const session = `codex-memory-replay-${randomUUID()}`;
const statePath = join(root, `.codex-memory-replay-${session}.json`);
mkdirSync(join(root, '.agent-memory'), { recursive: true });
writeFileSync(statePath, JSON.stringify({ reads: [], searches: [], memoryReads: [] }) + '\n');
execFileSync(process.execPath, [memoryCli, '--root', root, '--db', db, 'memory', 'put',
  'Before changing staging data, verify the intended environment and follow the selected Skill guidance.',
  '--id', 'workflow-evolve-staging-preflight', '--type', 'work_method', '--scene', 'workflow-evolve', '--session', session], {
  cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});

const server = fileURLToPath(new URL('./memory-codex-mcp.mjs', import.meta.url));
const prompt = [
  'You are running one isolated workflow-evolve task.',
  'Use the memory_search tool before reading the Skill. Then call read_skill and follow its instructions.',
  'Use memory_get when a search result provides a stable memory ID and the task needs its full guidance.',
  'Return only the requested task output, with no Markdown fences or commentary.',
  '',
  input.task,
].join('\n');
const stdout = execFileSync(codex, ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
  '--skip-git-repo-check', '--json', '--sandbox', 'read-only', '-C', root,
  '-c', `mcp_servers.workflow_evolve_memory.command=${JSON.stringify(process.execPath)}`,
  '-c', `mcp_servers.workflow_evolve_memory.args=${JSON.stringify([server, memoryCli, root, db, entry.replaceAll('\\', '/'), statePath])}`,
  '-c', 'mcp_servers.workflow_evolve_memory.required=true',
  '-c', 'mcp_servers.workflow_evolve_memory.default_tools_approval_mode="writes"', '-'], {
  input: prompt, cwd: root, env: { ...process.env, AGENT_MEMORY_DB: db }, encoding: 'utf8', windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'], timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(codex),
});
writeFileSync(join(root, `.codex-memory-replay-${session}.jsonl`), stdout);
const events = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const answer = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text;
if (!events.some(event => event.type === 'turn.completed') || typeof answer !== 'string') {
  throw new Error(`Codex did not complete memory replay scenario ${id}`);
}
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const loaded = [...new Map(state.reads.map(read => [read.path, read])).values()];
const memoryReads = [
  ...state.searches.flatMap(item => item.result?.knowledge_reads?.reads ?? []),
  ...state.memoryReads.flatMap(item => item.result?.knowledge_reads?.reads ?? []),
];
const memorySearches = state.searches.flatMap(item => item.result?.knowledge_reads?.searches ?? []);
if (!loaded.some(read => read.path === entry.replaceAll('\\', '/')) || !memorySearches.length) {
  throw new Error(`Codex must read ${entry} and search Agent Memory for scenario ${id}`);
}
const knowledgeReads = {
  schema_version: 'knowledge-reads/1.0',
  searches: memorySearches,
  reads: memoryReads,
  constraints_bound: [],
};
console.log(JSON.stringify({
  passed: answer.trim() === input.expected.trim(),
  loaded,
  knowledge_reads: knowledgeReads,
  transcript: events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').map(event => event.item.text),
  answer: answer.trim(),
  commit,
}));
