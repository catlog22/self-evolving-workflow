import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = mkdtempSync(join(tmpdir(), 'evolve-external-replay-'));
const repo = join(fixture, 'repo');
const packagePath = 'skills/replay-fixture';
const entry = packagePath + '/SKILL.md';
const host = join(fixture, 'session-host.mjs');
const fakeCodex = join(fixture, 'fake-codex.mjs');
const wrapper = join(fixture, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.sh');
const script = fileURLToPath(new URL('../skills/workflow-evolve/scripts/codex-replay.mjs', import.meta.url));
const baseline = '---\nname: replay-fixture\n---\n\n# Replay fixture\n';

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repo, encoding: 'utf8', windowsHide: true, ...options }).trim();
}

try {
  mkdirSync(join(repo, packagePath), { recursive: true });
  writeFileSync(join(repo, entry), baseline);
  run('git', ['init', '-q']);
  run('git', ['config', 'user.name', 'External replay fixture']);
  run('git', ['config', 'user.email', 'external-replay@example.invalid']);
  run('git', ['config', 'core.autocrlf', 'false']);
  run('git', ['add', entry]);
  run('git', ['commit', '-qm', 'Replay fixture']);

  writeFileSync(host, [
    "import { execFileSync } from 'node:child_process';",
    "import { createHash } from 'node:crypto';",
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const args = process.argv.slice(2);",
    "const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };",
    "const root = value('--workflow-root');",
    "const command = args.slice(0, 2).join(' ');",
    "const statePath = join(root, '.replay-host.json');",
    "const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();",
    "const reply = result => process.stdout.write(JSON.stringify({ ok: true, result }));",
    "if (command === 'session open') { const state = { skill: value('--chain'), session: value('--id') }; writeFileSync(statePath, JSON.stringify(state)); reply({ orchestration_revision: 0 }); }",
    "else if (command === 'run next') { const state = JSON.parse(readFileSync(statePath, 'utf8')); const commit = git('rev-parse', 'HEAD'); const tree = git('rev-parse', 'HEAD:skills/' + state.skill); writeFileSync(statePath, JSON.stringify({ ...state, run: 'run-external', commit, tree })); reply({ run_id: 'run-external', skill_ref: { skill_id: state.skill, commit, tree, package_path: 'skills/' + state.skill, entry: 'SKILL.md' } }); }",
    "else if (command === 'run check') { const state = JSON.parse(readFileSync(statePath, 'utf8')); const path = join(root, 'skills/' + state.skill + '/SKILL.md'); const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex'); reply({ skill_reads: { reference: { skill_id: state.skill, commit: state.commit, tree: state.tree, package_path: 'skills/' + state.skill, entry: 'SKILL.md' }, missing: [], reads: [{ path: 'SKILL.md', sha256: 'sha256:' + sha256 }] }, knowledge_reads: { schema_version: 'knowledge-reads/1.0', searches: [], reads: [], constraints_bound: [] } }); }",
    "else throw new Error('unsupported host command: ' + command);",
  ].join('\n'));
  writeFileSync(fakeCodex, [
    "process.stdin.resume();",
    "process.stdin.on('end', () => {",
    "  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'migrate staging --dry-run' } }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');",
    "});",
  ].join('\n'));
  if (process.platform === 'win32') {
    writeFileSync(wrapper, '@echo off\n"' + process.execPath + '" "' + fakeCodex + '" %*\n');
  } else {
    writeFileSync(wrapper, '#!/bin/sh\nexec "' + process.execPath + '" "' + fakeCodex + '" "$@"\n');
    execFileSync('chmod', ['+x', wrapper], { cwd: fixture, windowsHide: true });
  }

  const commit = run('git', ['rev-parse', 'HEAD']);
  const output = execFileSync(process.execPath, [script], {
    cwd: repo,
    input: JSON.stringify({
      id: 'external-replay-contract',
      input: { task: 'Prepare a staging migration request.', expected: 'migrate staging --dry-run' },
      entry, commit,
    }),
    env: { ...process.env, AGENT_MEMORY_REPLAY_CLI: host, CODEX_REPLAY_EXECUTABLE: wrapper },
    encoding: 'utf8', windowsHide: true,
  });
  const result = JSON.parse(output);
  assert.equal(result.passed, true);
  assert.deepEqual(result.loaded.map(file => file.path), [entry]);
  assert.deepEqual(result.knowledge_reads, { schema_version: 'knowledge-reads/1.0', searches: [], reads: [], constraints_bound: [] });
  console.log('External Session/Run and Codex adapter replay contract passed.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
