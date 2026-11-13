import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { id, input, entry, commit } = JSON.parse(readFileSync(0, 'utf8'));
const skill = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(entry)?.[1];
const maestro = process.env.MAESTRO_REPLAY_CLI;
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
if (!skill || !maestro || !isAbsolute(maestro)) {
  throw new Error('Codex replay requires skills/<id>/SKILL.md and an absolute MAESTRO_REPLAY_CLI JavaScript path');
}
if (typeof input?.task !== 'string' || !input.task.trim() ||
    typeof input.expected !== 'string' || !input.expected.trim()) {
  throw new Error(`Codex replay scenario ${id} requires input.task and input.expected strings`);
}

const root = process.cwd();
const session = `evolve-replay-${randomUUID()}`;
const actor = ['--actor', 'evolve-replay'];
const env = { ...process.env, MAESTRO_PROJECT_SKILLS: skill };
delete env.MAESTRO_ANALYZE_SKILL;
delete env.MAESTRO_EVOLVE_CLI;
delete env.MAESTRO_EVOLVE_CONSTRAINTS;
mkdirSync(join(root, '.workflow'), { recursive: true });

function runMaestro(...args) {
  const stdout = execFileSync(process.execPath, [maestro, ...args, '--workflow-root', root, '--json'], {
    env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const envelope = JSON.parse(stdout);
  if (!envelope.ok) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}

const opened = runMaestro('session', 'open', `Replay ${skill}: ${id}`, '--id', session, '--chain', skill, ...actor);
const run = runMaestro('run', 'next', '--session', session, ...actor,
  '--expected-orchestration-revision', String(opened.orchestration_revision));
if (run.skill_ref?.commit !== commit || `${run.skill_ref.package_path}/${run.skill_ref.entry}` !== entry) {
  throw new Error(`Maestro bound a different version of ${entry}`);
}

const server = fileURLToPath(new URL('./read-skill-mcp.mjs', import.meta.url));
const prompt = [
  'You are running one isolated replay of a Maestro Skill. The task and project files in this checkout are replay inputs.',
  'First call the evolve_replay read_skill tool with no arguments to read the bound entry.',
  'Use the markdown returned by the tool. To open a declared link, pass its destination and the source document path as from.',
  'Load each required_links document and follow conditional links when their described conditions match the task.',
  'Use Maestro for all Skill Markdown reads. Leave Session/Run lifecycle and receipts to the caller.',
  'Return only the task output, without Markdown fences, labels, or commentary.',
  '',
  input.task,
].join('\n');
const stdout = execFileSync(codex, ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json',
  '-c', `mcp_servers.evolve_replay.command=${JSON.stringify(process.execPath)}`,
  '-c', `mcp_servers.evolve_replay.args=${JSON.stringify([server, maestro, root, session, run.run_id])}`,
  '-c', 'mcp_servers.evolve_replay.required=true',
  '-c', 'mcp_servers.evolve_replay.default_tools_approval_mode="writes"', '--sandbox', 'read-only', '-'], {
  input: prompt, cwd: tmpdir(), env, encoding: 'utf8', windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'], timeout: 110_000, maxBuffer: 8 * 1024 * 1024,
});
const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
const answer = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text;
if (!events.some(event => event.type === 'turn.completed') || typeof answer !== 'string') {
  throw new Error(`Codex did not complete replay scenario ${id}`);
}
const checked = runMaestro('run', 'check', run.run_id, '--session', session);
const proof = checked.skill_reads;
if (proof?.reference?.commit !== commit || proof.missing.length || !proof.reads.some(read => read.path === run.skill_ref.entry)) {
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call');
  const outcomes = calls.map(({ item }) => {
    const message = item.error?.message ?? (item.result?.isError ? item.result.content?.[0]?.text : '');
    return `${item.server}.${item.tool}=${item.status}${message ? `: ${message}` : ''}`;
  }).join(', ') || 'none';
  throw new Error(`Codex did not open the required Skill documents for ${id} (tool calls: ${outcomes})`);
}
const loaded = [...new Map(proof.reads.map(({ path, sha256 }) => [
  path, { path: `${run.skill_ref.package_path}/${path}`, sha256: sha256.replace(/^sha256:/, '') },
])).values()];
console.log(JSON.stringify({ passed: answer.trim() === input.expected.trim(), loaded }));
