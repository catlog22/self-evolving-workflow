import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = mkdtempSync(join(tmpdir(), 'evolve-native-replay-'));
const repo = join(fixture, 'repo');
const folder = 'skills/replay-fixture';
const entry = folder + '/SKILL.md';
const reference = folder + '/references/check.md';
const baseline = '---\nname: replay-fixture\nrequired_links: [references/check.md]\n---\n[Checks](references/check.md)\n[Outside](../../outside.md)\n';
const guidance = 'Follow the fixture checks.\n';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const runner = fileURLToPath(new URL('../skills/workflow-evolve/scripts/codex-replay.mjs', import.meta.url));
const fakeCodex = join(fixture, 'fake-codex.mjs');
const sha256 = data => createHash('sha256').update(data).digest('hex');

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repo, encoding: 'utf8', windowsHide: true, ...options }).trim();
}

try {
  mkdirSync(join(repo, folder, 'references'), { recursive: true });
  writeFileSync(join(repo, entry), baseline);
  writeFileSync(join(repo, reference), guidance);
  writeFileSync(join(repo, 'outside.md'), 'Outside the Skill package');
  run('git', ['init', '-q']);
  run('git', ['config', 'user.name', 'Native replay fixture']);
  run('git', ['config', 'user.email', 'replay@example.invalid']);
  run('git', ['config', 'core.autocrlf', 'false']);
  run('git', ['add', '.']);
  run('git', ['commit', '-qm', 'Replay fixture']);
  const commit = run('git', ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, entry), 'Uncommitted content');
  writeFileSync(join(repo, reference), 'Uncommitted content');

  writeFileSync(fakeCodex, [
    "import assert from 'node:assert/strict';",
    "import { execFileSync } from 'node:child_process';",
    "const setting = name => JSON.parse(process.argv.find(arg => arg.startsWith('mcp_servers.evolve_replay.' + name + '=')).split('=').slice(1).join('='));",
    "const request = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });",
    "const { FIXTURE_ENTRY, FIXTURE_OMIT_LINK } = process.env;",
    "const calls = [request(1, 'memory_search', { query: 'staging' }), request(2, 'memory_search', { query: 'migration' }), request(3, 'memory_get', { id: 'migration-check' }), request(4, 'read_skill'), request(5, 'read_skill', { from: FIXTURE_ENTRY, destination: '../../outside.md' })];",
    "if (!FIXTURE_OMIT_LINK) calls.push(request(6, 'read_skill', { from: FIXTURE_ENTRY, destination: 'references/check.md' }));",
    "process.stdin.resume();",
    "process.stdin.on('end', () => {",
    "  const output = execFileSync(setting('command'), setting('args'), { input: calls.map(call => JSON.stringify(call)).join('\\n') + '\\n', encoding: 'utf8' });",
    "  const results = output.trim().split(/\\r?\\n/).map(line => JSON.parse(line).result);",
    "  assert.ok(results[4].isError);",
    "  assert.ok(results.filter((_, index) => index !== 4).every(result => !result.isError));",
    "  assert.match(JSON.parse(results[3].content[0].text).markdown, /\\[Checks\\]/);",
    "  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'fixture result' } }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');",
    "});",
  ].join('\n'));
  const db = join(fixture, 'memory.db');
  run(process.execPath, [cli, 'memory', 'put', 'Staging migration checks', '--db', db, '--id', 'migration-check']);
  const env = { ...process.env, CODEX_REPLAY_EXECUTABLE: fakeCodex, AGENT_MEMORY_DB: db, FIXTURE_ENTRY: entry,
    MAESTRO_REPLAY_CLI: join(fixture, 'unused-host.js'), AGENT_MEMORY_REPLAY_CLI: join(fixture, 'unused-alias.js') };
  const replay = (options = {}) => run(process.execPath, [runner], {
    env: { ...env, ...options.env },
    input: JSON.stringify({
      id: 'native-replay-contract', input: { task: 'Prepare staging migration.', expected: 'fixture result' },
      entry, commit: options.commit ?? commit,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const result = JSON.parse(replay());
  assert.equal(result.passed, true);
  assert.deepEqual(result.loaded, [
    { path: entry, sha256: sha256(baseline) }, { path: reference, sha256: sha256(guidance) },
  ]);
  assert.deepEqual(result.knowledge_reads.searches.map(search => search.search_id), ['search-1', 'search-2']);
  assert.equal(result.knowledge_reads.reads[0].id, 'migration-check');
  assert.equal(result.knowledge_reads.reads[0].from_search_id, 'search-2');
  assert.throws(() => replay({ env: { FIXTURE_OMIT_LINK: '1' } }), /needs Skill reads/);
  assert.throws(() => replay({ commit: 'a'.repeat(40) }), /checkout must match/);
  console.log('Native replay verified Git-bound Skill reads and Agent Memory search provenance.');
} finally {
  // 临时目录由本次验收独占。
  rmSync(fixture, { recursive: true, force: true });
}
