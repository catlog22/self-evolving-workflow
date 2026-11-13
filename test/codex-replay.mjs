import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const runner = fileURLToPath(new URL('../skills/workflow-evolve/scripts/codex-replay.mjs', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'evolve-codex-replay-'));
const repo = join(fixture, 'repo');
const packagePath = 'skills/migration-preflight';
const entry = `${packagePath}/SKILL.md`;
const baseline = [
  '---', 'name: migration-preflight', 'description: Select a synthetic migration command for a request.',
  'contract:', '  contract_version: 2.1', '  produces: []', '  consumes: []', '---', '',
  '# Migration preflight', '',
  'For a migration request, return exactly `migrate staging` unless an applicable learning changes it.',
  'For a status request, return exactly `migrate status`.', '',
].join('\n');
const migration = { task: 'Prepare a migration request for the staging database.', expected: 'migrate staging --dry-run' };
const status = { task: 'Handle a status request for the migration tracker.', expected: 'migrate status' };
const invoke = (command, args, input) => execFileSync(command, args, {
  cwd: repo, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
});
const git = (...args) => invoke('git', args).trim();
const agent = (...args) => JSON.parse(invoke(process.execPath, [cli, '--root', repo, ...args]));

try {
  mkdirSync(join(repo, packagePath), { recursive: true });
  writeFileSync(join(repo, entry), baseline);
  git('init', '-q');
  git('config', 'user.name', 'Evolve replay fixture');
  git('config', 'user.email', 'evolve-replay@example.invalid');
  git('config', 'core.autocrlf', 'false');
  git('add', entry);
  git('commit', '-qm', 'Migration preflight fixture');

  const draft = join(fixture, 'draft.json');
  const cases = join(fixture, 'cases.json');
  writeFileSync(draft, JSON.stringify(agent('evolve', 'draft', entry,
    'For migration requests targeting staging, return exactly `migrate staging --dry-run`.',
    '--priority', 'normal', '--when', 'handling a migration request for staging',
    '--evidence', 'fixture:staging-preflight-correction')));
  writeFileSync(cases, JSON.stringify([
    { id: 'staging-preflight', input: migration, baseline: false },
    { id: 'status-regression', input: status, baseline: true },
  ]));
  const receipt = agent('evolve', 'replay', draft, '--runner', runner, '--scenarios', cases);
  assert.deepEqual(receipt.scenarios.map(item => [item.baseline.passed, item.candidate.passed]), [[false, true], [true, true]]);
  const learning = receipt.files.find(path => path.includes('/references/learnings/'));
  assert.ok(learning);
  assert.ok(receipt.scenarios[0].candidate.loaded.some(file => file.path === learning));
  assert.ok(!receipt.scenarios[1].candidate.loaded.some(file => file.path === learning));
  console.log('Codex replay passed the staging regression and preserved the status case.');

  assert.equal(agent('evolve', 'apply', receipt.id).commit, receipt.candidate);
  const applied = JSON.parse(invoke(process.execPath, [runner], JSON.stringify({
    id: 'verify-applied', input: migration, entry, commit: git('rev-parse', 'HEAD'),
  })));
  assert.equal(applied.passed, true);
  assert.deepEqual(applied.loaded, receipt.scenarios[0].candidate.loaded);
  agent('evolve', 'rollback', receipt.id);
  assert.equal(readFileSync(join(repo, entry), 'utf8'), baseline);
  const rolledBack = JSON.parse(invoke(process.execPath, [runner], JSON.stringify({
    id: 'verify-rollback', input: migration, entry, commit: git('rev-parse', 'HEAD'),
  })));
  assert.deepEqual(rolledBack, receipt.scenarios[0].baseline);
  console.log('Codex loaded the applied revision and reproduced the baseline after rollback.');
} finally {
  assert.match(realpathSync(fixture), /[\\/]evolve-codex-replay-[a-zA-Z0-9]+$/);
  rmSync(fixture, { recursive: true, force: true });
}
