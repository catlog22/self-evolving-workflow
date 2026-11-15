import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cli = fileURLToPath(new URL('../dist/workflow-cli.js', import.meta.url));
export const memory = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

export function fixture(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const sentinel = join(root, 'maestro-invoked');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const trap = join(bin, process.platform === 'win32' ? 'maestro.cmd' : 'maestro');
  writeFileSync(trap, process.platform === 'win32'
    ? '@echo called>"' + sentinel + '"\r\n@exit /b 91\r\n'
    : '#!/bin/sh\nprintf called > "' + sentinel + '"\nexit 91\n', { mode: 0o755 });
  const env = { ...process.env, PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH,
    MAESTRO_REPLAY_CLI: trap, MAESTRO_HOME: join(root, 'empty-maestro-home') };
  const run = (command, args, input) => execFileSync(command, args, {
    cwd: root, env, input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const git = (...args) => run('git', args);
  const evolve = (...args) => JSON.parse(run(process.execPath, [cli, ...args]));
  const agent = (...args) => JSON.parse(run(process.execPath, [memory, ...args]));
  const write = (path, body) => {
    const filename = join(root, path);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, body);
  };
  const open = (session, chain, objective = session) => evolve('session', 'open', objective, '--id', session, '--actor', 'test',
    ...(chain ? ['--chain', chain] : []));
  const status = session => evolve('session', 'status', '--session', session);
  const fence = (session, revision = status(session).revision, actor = 'test') =>
    ['--session', session, '--actor', actor, '--expected-orchestration-revision', String(revision)];
  const next = (session, revision, ...args) => evolve('run', 'next', ...fence(session, revision), ...args);
  const finish = (session, run, summary, additional = [], revision) => evolve('run', 'complete', run.run_id,
    ...fence(session, revision), '--expected-run-revision', String(run.revision), '--summary', summary, ...additional);
  const sealSession = session => evolve('session', 'complete', ...fence(session));
  const saveArtifact = (run, path, body) => {
    const slot = run.skill_ref.produces.find(item => item.path === 'outputs/' + path);
    assert.ok(slot, path);
    const { kind, schema, role, alias } = slot;
    const filename = join(run.run_dir, 'outputs', path);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, JSON.stringify({ ...body, _meta: { kind, schema, role, alias } }) + '\n');
  };
  try {
    const names = ['maestro', 'maestro-odyssey', 'team-swarm'];
    assert.deepEqual(evolve('skills', 'install', ...names).installed, names);
    assert.deepEqual(evolve('skills', 'install', ...names).installed, []);
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    git('config', 'user.name', 'Evolve fixture');
    git('config', 'user.email', 'evolve@example.invalid');
    write('.gitignore', '.agent-memory/\nbin/\n');
    git('add', '.');
    git('commit', '-qm', 'Commit shipped Evolve Skills');
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { root, env, sentinel, run, git, evolve, agent, write, open, status, fence, next, finish, sealSession, saveArtifact,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
