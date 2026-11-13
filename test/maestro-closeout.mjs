import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const maestro = process.env.MAESTRO_REPLAY_CLI;
assert.ok(maestro && isAbsolute(maestro), 'Set MAESTRO_REPLAY_CLI to the built Maestro JavaScript entry.');
const memory = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'evolve-maestro-closeout-'));
const project = 'closeout-fixture';
const skill = 'migration-preflight';
const workflow = join(root, '.workflow');
const database = join(root, 'staging.json');
const migrate = join(root, 'migrate.mjs');
const original = '{"schema":1,"records":3}\n';
const correction = 'User correction: run migration preflight against staging with --dry-run before attempting to apply.';
const method = 'Before attempting to apply a staging migration, run preflight with --dry-run and confirm the validation succeeds.';
const harvests = new Map();
let networkAttempts = 0;
const model = createServer(async (request, response) => {
  try {
    if (request.url === '/transient') {
      response.writeHead(++networkAttempts === 1 ? 503 : 200).end('Fixture response');
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const [{ content: system }, { content: prompt }] = JSON.parse(Buffer.concat(chunks).toString()).messages;
    const items = [];
    if (system.startsWith('Extract reusable work methods')) {
      const kind = prompt.includes('Temporary network error') ? 'transient' : 'preflight';
      harvests.set(kind, (harvests.get(kind) ?? 0) + 1);
      if (kind === 'preflight') {
        assert.ok(prompt.includes(correction));
        assert.match(prompt, /migration preflight verified: schema 1, records 3/);
        const anchor = /\[(transcript:[^\]]+:correction:[a-f0-9]{16})\]/.exec(prompt)?.[1];
        const summary = /\[(run:[^\]]+:summary)\]/.exec(prompt)?.[1];
        assert.ok(anchor && summary);
        items.push({ memories: [{ type: 'work_method', content: method, source_message_ids: [anchor, summary] }] });
      }
    } else if (system.startsWith('Review a Session timeline')) {
      const anchor = /\[(transcript:[^\]]+:correction:[a-f0-9]{16})\]/.exec(prompt)?.[1];
      if (anchor) {
        assert.match(prompt, /became failed.*Dry-run flag required/);
        assert.match(prompt, /retries run-/);
        assert.match(prompt, /opened Skill documents: SKILL.md/);
        items.push({ memories: [{ type: 'correction', content: correction, source_message_ids: [anchor] }] });
      }
    } else {
      assert.match(system, /^Compare a proposed Wiki method/);
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items) } }] }));
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Fixture assertion failed');
  }
});

async function invoke(command, args, env) {
  try {
    return (await execute(command, args, { cwd: root, env, windowsHide: true, encoding: 'utf8' })).stdout;
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.stdout?.trim() || error.message, { cause: error });
  }
}

const git = (...args) => invoke('git', args);
const cli = async (entry, args, env) => JSON.parse(await invoke(process.execPath, [entry, ...args], env));

try {
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const origin = `http://127.0.0.1:${model.address().port}`;
  const env = {
    ...process.env, MAESTRO_PROJECT_SKILLS: skill,
    MAESTRO_EVOLVE_CONSTRAINTS: '1', MAESTRO_EVOLVE_CLI: memory,
    MAESTRO_EVOLVE_PROJECT: project, MAESTRO_EVOLVE_WIKI_ROOT: root,
    AGENT_MEMORY_LLM_BASE_URL: `${origin}/v1`, AGENT_MEMORY_LLM_MODEL: 'fixture',
  };
  delete env.MAESTRO_ANALYZE_SKILL;
  delete env.AGENT_MEMORY_LLM_API_KEY;
  const flow = (...args) => cli(maestro, [...args, '--workflow-root', root, '--json'], env);
  const agent = (...args) => cli(memory, ['--root', root, ...args], env);
  const closeout = (...args) => agent('closeout', ...args, '--project', project);

  await mkdir(join(root, 'skills', skill), { recursive: true });
  const skillEntry = join(root, 'skills', skill, 'SKILL.md');
  await writeFile(skillEntry, [
    '---', `name: ${skill}`, 'description: Check the staging database migration.',
    'contract:', '  contract_version: 2.1', '  produces: []', '  consumes: []', '---',
    '# Migration preflight', '', 'Use the staging database for migration preflight.', '',
  ].join('\n'));
  await writeFile(database, original);
  await writeFile(migrate, [
    "import { readFileSync } from 'node:fs';",
    "if (!process.argv.includes('--dry-run')) {",
    "  process.stderr.write('Dry-run flag required.');",
    '  process.exit(2);',
    '}',
    'const { schema, records } = JSON.parse(readFileSync(process.argv[2], "utf8"));',
    'if (schema !== 1 || !Number.isInteger(records)) process.exit(3);',
    'console.log(`migration preflight verified: schema ${schema}, records ${records}`);',
  ].join('\n'));
  await git('init', '-q');
  await git('add', '--', 'skills', 'migrate.mjs', 'staging.json');
  await git('-c', 'user.name=Closeout fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Preflight fixture');
  await mkdir(join(workflow, 'specs'), { recursive: true });
  await mkdir(join(workflow, 'knowhow'));
  await writeFile(join(workflow, 'specs', 'runtime.md'),
    '<spec-entry sid="S-1" title="Use staging">\nUse staging for migration checks.\n</spec-entry>\n');
  await writeFile(join(workflow, 'knowhow', 'K-1.md'), '---\ntitle: Inventory\n---\n\nRead the staging inventory.\n');
  const migrated = await agent('wiki', 'migrate', root, '--project', project, '--apply');
  assert.equal(migrated.length, 2);
  assert.ok((await agent('wiki', 'migrate', root, '--project', project, '--apply')).every(item => item.existing));
  const constraintId = (await agent('wiki', 'get', `${project}:spec:S-1`)).id;

  async function start(session) {
    const opened = await flow('session', 'open', 'Verify migration preflight', '--id', session, '--chain', skill, '--actor', 'fixture');
    const birth = await flow('run', 'next', '--session', session, '--actor', 'fixture',
      '--expected-orchestration-revision', String(opened.result.orchestration_revision));
    assert.deepEqual(birth.result.wiki_constraints.map(item => item.id), [constraintId]);
    return birth.result;
  }

  async function readSkill(id, run) {
    const read = await flow('run', 'skill-read', run.run_id, '--session', id);
    assert.equal(read.result.recorded, true);
  }

  async function retry(id, run, reason, anchor) {
    const failed = await flow('run', 'transition', run.run_id, 'failed', '--session', id, '--actor', 'fixture',
      '--expected-orchestration-revision', String(run.continuation.revision_requirements.expected_orchestration_revision),
      '--expected-run-revision', String(run.revision), '--reason', reason, ...(anchor ? ['--evidence', anchor] : []));
    const birth = await flow('run', 'create', skill, '--session', id, '--actor', 'fixture',
      '--step', run.step_id, '--run', `retry-${id}`, '--retry-of-run', run.run_id,
      '--expected-orchestration-revision', String(failed.result.orchestration_revision));
    assert.equal(birth.result.retry_of_run_id, run.run_id);
    await readSkill(id, birth.result);
    return birth.result;
  }

  async function finish(id, run, summary) {
    const sealed = await flow('run', 'complete', run.run_id, '--session', id, '--actor', 'fixture',
      '--expected-run-revision', String(run.revision), '--summary', summary, '--advance',
      '--expected-orchestration-revision', String(run.continuation.revision_requirements.expected_orchestration_revision));
    const args = ['session', 'complete', '--session', id, '--actor', 'fixture',
      '--expected-orchestration-revision', String(sealed.result.orchestration_revision)];
    const complete = await flow(...args);
    const receipt = complete.replay.transition_id;
    assert.deepEqual(complete.result.evolve_closeout, { status: 'dispatched', receipt });
    // Observe the detached worker's durable result before redelivering the event.
    const deadline = Date.now() + 20_000;
    let harvest;
    while (harvest === undefined) {
      try {
        harvest = await closeout('show', receipt);
      } catch (error) {
        if (Date.now() >= deadline || !/Completion has not been harvested/.test(error.message)) throw error;
        await delay(100);
      }
    }
    const replay = await flow(...args);
    assert.equal(replay.replay.transition_id, receipt);
    assert.equal(replay.replay.status, 'replayed');
    assert.deepEqual(await closeout('session', id, '--receipt', receipt), { ...harvest, replayed: true });
    return { receipt, candidates: harvest.candidates, id: harvest.id };
  }

  const session = 'preflight';
  const first = await start(session);
  await readSkill(session, first);
  await assert.rejects(invoke(process.execPath, [migrate, database]), /Dry-run flag required/);
  const descriptor = join(root, 'correction.json');
  await writeFile(descriptor, JSON.stringify({
    host_kind: 'fixture', host_session_id: 'migration', entry_id: 'correction', quote: correction,
  }));
  const { result: { ref } } = await flow('session', 'evidence', descriptor, '--session', session);
  const fixed = await retry(session, first, 'Dry-run flag required.', ref);
  const verified = (await invoke(process.execPath, [migrate, database, '--dry-run'])).trim();
  assert.equal(verified, 'migration preflight verified: schema 1, records 3');
  assert.equal(await readFile(database, 'utf8'), original);
  const harvest = await finish(session, fixed, verified);
  assert.equal(harvest.candidates.length, 1);
  assert.ok(harvest.candidates[0].sources.includes(`receipt:${project}:${harvest.receipt}#${ref}`));
  assert.equal(harvests.get('preflight'), 1);
  const reviewed = await agent('session', 'review', session);
  const signal = reviewed.signals.find(item => item.kind === 'correction');
  assert.deepEqual(signal.runIds, [first.run_id]);
  assert.deepEqual(signal.sources, [ref]);
  assert.equal(reviewed.runs.find(item => item.id === first.run_id).skillRef.skill_id, skill);
  const draft = await agent('evolve', 'draft', skillEntry, 'Run the staging migration check with --dry-run.',
    '--priority', 'normal', '--when', 'checking a staging migration', '--evidence', signal.sources[0]);
  assert.equal(draft.changes.length, 2);
  assert.match(draft.changes[0].content, /references\/learnings\//);
  const published = await agent('closeout', 'publish', harvest.id, harvest.candidates[0].id, 'Staging migration preflight');
  const reference = await agent('wiki', 'get', published.id);
  assert.equal(reference.entry.mode, 'reference');
  assert.equal(reference.body.trim(), method);
  assert.deepEqual(reference.sources, harvest.candidates[0].sources);
  assert.equal((await agent('wiki', 'search', 'migration preflight')).results[0].id, published.id);

  const transient = await start('transient');
  await readSkill('transient', transient);
  await assert.rejects(invoke(process.execPath, ['-e',
    "fetch(process.argv[1]).then(r => { if (!r.ok) { console.error('HTTP ' + r.status); process.exitCode = 1; } })",
    `${origin}/transient`]), /HTTP 503/);
  const resumed = await retry('transient', transient, 'Temporary network error HTTP 503.');
  assert.equal((await fetch(`${origin}/transient`)).status, 200);
  const empty = await finish('transient', resumed, 'Temporary network error HTTP 503 resolved on retry.');
  assert.deepEqual(empty.candidates, []);
  assert.equal(harvests.get('transient'), 1);
  assert.deepEqual((await agent('session', 'review', 'transient')).signals, []);
  const constraints = await agent('wiki', 'constraints', '--skill', skill);
  assert.deepEqual(constraints.map(item => item.id), [constraintId]);

  await rm(join(root, 'index.db'));
  await agent('wiki', 'build');
  assert.deepEqual(await agent('wiki', 'constraints', '--skill', skill), constraints);
  assert.deepEqual(await agent('wiki', 'get', published.id), reference);
  assert.equal((await agent('wiki', 'get', `${project}:spec:S-1`)).id, constraintId);
  assert.equal((await closeout('show', harvest.receipt)).id, harvest.id);
  console.log('Maestro preflight, evidence capture, Memory closeout, Wiki publication and index rebuild passed.');
} finally {
  if (model.listening) await new Promise(resolve => model.close(resolve));
  assert.match(await realpath(root), /[\\/]evolve-maestro-closeout-[a-zA-Z0-9]+$/);
  await rm(root, { recursive: true, force: true });
}
