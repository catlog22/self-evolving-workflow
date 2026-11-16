import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const { id, input, entry: rawEntry, commit } = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
const entry = rawEntry?.replaceAll('\\', '/');
if (!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(entry) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) ||
    typeof input?.task !== 'string' || !input.task.trim() ||
    typeof input.expected !== 'string' || !input.expected.trim()) {
  throw new Error('Replay requires a Skill entry, Git commit, task and expected output');
}

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
if (git('rev-parse', 'HEAD').trim() !== commit) throw new Error('Replay checkout must match the requested commit');
const markdown = git('show', commit + ':' + entry);
const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown.replace(/^\uFEFF/, ''));
const required = (header ? parse(header[1])?.required_links : undefined) ?? [];
if (!Array.isArray(required) || required.some(link => typeof link !== 'string' || !link.trim())) {
  throw new Error('Skill required_links must contain Markdown destinations');
}

function resolveWindowsCodex() {
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = join(dir, 'codex' + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'codex.exe';
}

const defaultCli = fileURLToPath(new URL('../../../dist/cli.js', import.meta.url));
const memoryCli = realpathSync(process.env.AGENT_MEMORY_CLI || defaultCli);
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? resolveWindowsCodex() : 'codex');
const codexEntry = /\.[cm]?js$/i.test(codex) ? [resolve(codex)] : [];
const server = fileURLToPath(new URL('./memory-codex-mcp.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'evolve-codex-task-'));
try {
  const db = process.env.AGENT_MEMORY_DB ? resolve(process.env.AGENT_MEMORY_DB) : join(scratch, 'memory.db');
  const loadedPath = join(scratch, 'skill-reads.json');
  const tracePath = join(scratch, 'knowledge-reads.json');
  const prompt = [
    'Run one Skill replay. First use memory_search for the task, then read_skill with no arguments.',
    'Use memory_get for relevant IDs returned by the search. Treat memory results as evidence.',
    'Follow required_links and applicable conditional links through read_skill. Pass the returned source path as from and the declared link as destination.',
    'Return the requested task output as plain text.',
    '',
    input.task,
  ].join('\n');
  const stdout = execFileSync(codexEntry.length ? process.execPath : codex, [...codexEntry, '-a', 'never', 'exec', '--ephemeral', '--ignore-user-config',
    '--skip-git-repo-check', '--json', '--sandbox', 'read-only',
    '-c', 'mcp_servers.evolve_replay.command=' + JSON.stringify(process.execPath),
    '-c', 'mcp_servers.evolve_replay.args=' + JSON.stringify([server, memoryCli, root, db, entry, commit, loadedPath, tracePath]),
    '-c', 'mcp_servers.evolve_replay.required=true',
    '-c', 'mcp_servers.evolve_replay.default_tools_approval_mode="writes"', '-'], {
    input: prompt, cwd: scratch, encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 110_000, maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(codex),
  });
  const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const answer = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text;
  if (typeof answer !== 'string' || !events.some(event => event.type === 'turn.completed')) {
    throw new Error('Codex replay did not complete: ' + id);
  }
  const loaded = existsSync(loadedPath) ? JSON.parse(readFileSync(loadedPath, 'utf8')) : [];
  const expected = [entry, ...required.map(link => posix.join(posix.dirname(entry), link.split('#', 1)[0]))];
  const missing = expected.filter(path => !loaded.some(read => read.path === path));
  if (missing.length) throw new Error('Codex replay needs Skill reads for: ' + missing.join(', '));
  const knowledgeReads = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8')) : undefined;
  if (!knowledgeReads?.searches.some(search => search.source === 'memory')) {
    throw new Error('Codex replay needs an Agent Memory search for: ' + id);
  }
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  console.log(JSON.stringify({
    passed: answer.trim() === input.expected.trim(), loaded, knowledge_reads: knowledgeReads,
    transcript: calls.map(event => event.item.text), answer: answer.trim(),
  }));
} finally {
  // 临时目录由本次回放独占。
  rmSync(scratch, { recursive: true, force: true });
}
