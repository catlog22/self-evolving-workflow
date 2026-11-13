import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const maestro = process.env.MAESTRO_REPLAY_CLI;
assert.ok(maestro && isAbsolute(maestro), 'Set MAESTRO_REPLAY_CLI to the built Maestro JavaScript entry.');
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
const server = fileURLToPath(new URL('../skills/workflow-evolve/scripts/read-skill-mcp.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'evolve-codex-campaigns-'));
const packages = ['maestro-odyssey', 'team-swarm'];
const env = { ...process.env, MAESTRO_HOME: join(root, '.maestro-home'), MAESTRO_PLATFORM: 'codex' };
for (const name of ['MAESTRO_PROJECT_SKILLS', 'MAESTRO_ANALYZE_SKILL', 'MAESTRO_EVOLVE_CLI', 'MAESTRO_EVOLVE_CONSTRAINTS',
  'MAESTRO_SESSION_ID', 'AGENT_MEMORY_LLM_API_KEY']) delete env[name];
const actor = ['--actor', 'campaign-fixture'];

const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true });
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function cli(session, ...args) {
  const result = spawnSync(process.execPath, [maestro, ...args, ...(session ? ['--session', session] : []), '--workflow-root', root, '--json'], {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  const value = JSON.parse(result.stdout);
  if (Object.hasOwn(value, 'ok')) assert.equal(value.ok, true, JSON.stringify(value.error));
  return value.result ?? value;
}

function start(session, command) {
  const open = cli(undefined, 'session', 'open', `Verify ${command}`, '--id', session, '--chain', command, ...actor);
  return cli(session, 'run', 'next', ...actor, '--expected-orchestration-revision', String(open.orchestration_revision));
}

async function host(session, run, links, task, context) {
  const args = ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--json', '--sandbox', 'read-only',
    '-c', `mcp_servers.evolve_replay.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.evolve_replay.args=${JSON.stringify([server, maestro, root, session, run.run_id])}`,
    '-c', 'mcp_servers.evolve_replay.required=true', '-c', 'mcp_servers.evolve_replay.default_tools_approval_mode="writes"', '-'];
  const prompt = [
    'You are executing a bounded role in a Maestro campaign acceptance fixture.',
    'First open the bound Skill with evolve_replay read_skill. For each document below use the specified from and destination arguments.',
    JSON.stringify(links),
    'The fixture owns all file writes, script execution, CLI lifecycle and worker coordination. Return only the requested JSON.',
    task, JSON.stringify(context),
  ].join('\n');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(codex, args, { cwd: tmpdir(), env, windowsHide: true, signal: AbortSignal.timeout(160_000) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Codex host exited with ${code} for ${session}: ${stderr.trim()}`));
    });
    child.stdin.end(prompt);
  });
  const events = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const result = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text;
  assert.ok(events.some(event => event.type === 'turn.completed') && result);
  const loaded = events.flatMap(event => {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'mcp_tool_call' || item.server !== 'evolve_replay' ||
        item.tool !== 'read_skill' || item.status !== 'completed' || item.result?.isError) return [];
    const text = item.result?.content?.[0]?.text;
    return typeof text === 'string' ? [JSON.parse(text).path] : [];
  });
  assert.ok(loaded.includes('SKILL.md'));
  for (const { from, destination } of links) assert.ok(loaded.includes(posix.join(posix.dirname(from), destination)), destination);
  return JSON.parse(result.trim().replace(/^```(?:json)?\s*([\s\S]+?)\s*```$/i, '$1'));
}

const entryLinks = (...destinations) => destinations.map(destination => ({ from: 'SKILL.md', destination }));
const save = (run, file, value) => writeFileSync(join(run.run_dir, 'outputs', file), `${JSON.stringify(value, null, 2)}\n`);

function seal(session, run, summary) {
  const checked = cli(session, 'run', 'check', run.run_id, '--summary', summary);
  assert.equal(checked.completion_preflight.ready, true, JSON.stringify(checked.completion_preflight));
  assert.deepEqual(checked.skill_reads.missing, []);
  for (const read of checked.skill_reads.reads) {
    assert.equal(read.sha256, hash(git('show', `${run.skill_ref.commit}:${run.skill_ref.package_path}/${read.path}`)));
  }
  const sealed = cli(session, 'run', 'complete', run.run_id, ...actor, '--summary', summary, '--advance',
    '--expected-orchestration-revision', String(run.continuation.revision_requirements.expected_orchestration_revision),
    '--expected-run-revision', String(run.revision));
  assert.equal(sealed.status, 'sealed');
  assert.deepEqual(sealed.skill_reads.reads, checked.skill_reads.reads);
  assert.equal(cli(session, 'session', 'complete', ...actor,
    '--expected-orchestration-revision', String(sealed.orchestration_revision)).status, 'completed');
  return sealed.artifact_publication;
}

async function odyssey(run, session) {
  const brief = cli(session, 'run', 'brief', run.run_id);
  assert.equal(brief.task.command, 'odyssey-review');
  assert.deepEqual(brief.skill_ref, run.skill_ref);
  assert.equal(brief.goal_mode.platform, 'codex');
  const answer = await host(session, brief, [
    ...entryLinks(...brief.skill_required_links),
    ...entryLinks('references/odyssey-review.codex.md'),
    { from: 'references/odyssey-review.codex.md', destination: 'odyssey-base-codex.md' },
  ], [
    'Apply the review workflow to the one-line change. Review correctness, security, performance, and architecture.',
    'This audit-only fixture has no pending fixes. Return {dimensions, findings, remaining_actionable}; dimensions are strings.',
    'Record only findings supported by the supplied diff or context.',
  ].join(' '), { diff: '-export const limit = 2;\n+export const limit = 3;', target: 'limit.mjs:1', requirement: 'Set the fixed item limit to 3.' });
  assert.deepEqual(answer.dimensions.map(value => value.toLowerCase()).sort(), ['architecture', 'correctness', 'performance', 'security']);
  assert.deepEqual(answer.findings, []);
  assert.equal(answer.remaining_actionable, 0);
  save(run, 'session.json', { ...answer, target: 'limit.mjs', current_state: 'END',
    _meta: { kind: 'session', schema: 'session/1.0', role: 'primary', alias: 'review-session' } });
  const publication = seal(session, run, 'Odyssey reviewed the four dimensions against the fixture diff');
  const artifact = publication.artifacts[publication.aliases['review-session']];
  assert.equal(artifact?.kind, 'session');
  assert.equal(artifact?.status, 'sealed');
  console.log('Codex resumed Odyssey review on its original Skill tree and sealed the typed session artifact.');
}

async function swarm(run, session) {
  const controller = join(run.run_dir, 'work', 'controller');
  const state = join(run.run_dir, 'work', 'team');
  mkdirSync(controller, { recursive: true });
  mkdirSync(state, { recursive: true });
  const bundled = file => git('show', `${run.skill_ref.commit}:${run.skill_ref.package_path}/${file}`);
  for (const file of ['aco.py', 'pheromone.py', 'scoring.py']) writeFileSync(join(controller, file), bundled(`scripts/${file}`));
  const config = JSON.parse(bundled('specs/swarm-config-template.json'));
  config.swarm.n_ants = 2;
  config.convergence.max_iterations = 1;
  config.task_space.nodes = ['limit-a.mjs', 'limit-b.mjs'];
  config.task_space.max_path_length = 2;
  config.ant_prompt.objective = 'Find the source file declaring the larger limit.';
  writeFileSync(join(state, 'swarm-config.json'), JSON.stringify(config));
  const aco = (...args) => JSON.parse(execFileSync(process.env.PYTHON || 'python', [
    '-B', join(controller, 'aco.py'), '--session', state, '--run-dir', run.run_dir, ...args,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
  assert.equal(aco('init').status, 'ok');
  const { assignments } = aco('select', '--iter', '1');
  assert.equal(assignments.length, 2);
  const ants = await Promise.allSettled(assignments.map(assignment => host(session, run,
    entryLinks('roles/ant/role.md', 'specs/ant-output-schema.md'),
    'Act as the assigned ant. Return the ant output JSON per its schema. Visit both nodes from the assigned start, cite the winning file at line 1, and set candidate_solution.summary to the winning filename.',
    { assignment, sources: { 'limit-a.mjs': 'export const limit = 2;', 'limit-b.mjs': 'export const limit = 3;' } },
  )));
  for (const [index, ant] of ants.entries()) {
    if (ant.status === 'rejected') throw ant.reason;
    assert.equal(ant.value.ant_id, assignments[index].ant_id);
    assert.equal(ant.value.candidate_solution.summary, 'limit-b.mjs');
    assert.ok(ant.value.evidence.includes('limit-b.mjs:1'));
    save(run, `ant-1-${index + 1}.json`, ant.value);
  }
  const updated = aco('update', '--iter', '1');
  assert.equal(updated.status, 'ok');
  const brief = cli(session, 'run', 'brief', run.run_id);
  assert.deepEqual(brief.skill_ref, run.skill_ref);
  assert.deepEqual(aco('update', '--iter', '1'), updated);
  assert.equal(aco('converged').converged, true);
  const report = aco('report');
  assert.equal(report.iterations_completed, 1);
  save(run, 'swarm-report.json', report);
  const synthesis = await host(session, brief, [
    ...entryLinks(...brief.skill_required_links, 'roles/analyst/role.md'),
    { from: 'roles/coordinator/role.md', destination: 'commands/converge.md' },
  ], 'Resume the completed iteration and synthesize the winner. Return {file, value, evidence}. Use the actual controller report and supplied source evidence.',
  { report, source: 'limit-b.mjs:1 export const limit = 3;', ants: ants.map(item => item.value) });
  assert.equal(synthesis.file, 'limit-b.mjs');
  assert.equal(synthesis.value, 3);
  assert.ok(JSON.stringify(synthesis.evidence).includes('limit-b.mjs:1'));
  writeFileSync(join(run.run_dir, 'outputs', 'best-solution.md'),
    `---\nkind: swarm-best-solution\nschema: swarm-best-solution/1.0\nrole: primary\n---\n# Swarm result\n\n${synthesis.file} declares limit ${synthesis.value}. Evidence ${JSON.stringify(synthesis.evidence)}.\n`);
  const publication = seal(session, run, 'Swarm converged after a replayed update and verified the winning source');
  const artifacts = Object.values(publication.artifacts);
  assert.ok(artifacts.every(item => item.status === 'sealed'));
  assert.deepEqual(artifacts.map(item => item.kind).sort(), ['swarm-ant-result', 'swarm-ant-result', 'swarm-best-solution', 'swarm-report']);
  console.log('Codex ants and analyst used the bound Swarm roles. The controller resumed one committed update and Maestro sealed four typed artifacts.');
}

try {
  mkdirSync(join(root, '.workflow'));
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Campaign fixture');
  git('config', 'user.email', 'campaign@example.invalid');
  const historical = start('historical-review', 'odyssey-review');
  assert.ok(historical.guidance.workflow_hash);
  const legacySwarm = start('historical-swarm', 'team-swarm');
  assert.equal(legacySwarm.skill_ref, undefined);
  assert.deepEqual(cli(undefined, 'skills', 'install', ...packages).skills, packages);
  assert.equal(cli(undefined, 'skills', 'install', ...packages).files_added, 0);
  git('add', '--', 'skills');
  git('commit', '-qm', 'Bind shipped campaign Skills');
  const commit = git('rev-parse', 'HEAD').toString().trim();
  env.MAESTRO_PROJECT_SKILLS = packages.join(',');
  const review = start('bound-review', 'odyssey-review');
  const colony = start('bound-swarm', 'team-swarm');
  for (const run of [review, colony]) {
    assert.equal(run.skill_ref.commit, commit);
    assert.equal(run.guidance, null);
  }
  const workflow = 'skills/maestro-odyssey/references/odyssey-review.md';
  writeFileSync(join(root, workflow), '# New default for later Runs\n');
  git('add', '--', workflow);
  git('commit', '-qm', 'Change Odyssey guidance after dispatch');
  const oldReview = cli('historical-review', 'run', 'brief', historical.run_id);
  assert.equal(oldReview.task.command, 'odyssey-review');
  assert.deepEqual(oldReview.guidance, historical.guidance);
  const results = await Promise.allSettled([odyssey(review, 'bound-review'), swarm(colony, 'bound-swarm')]);
  for (const result of results) if (result.status === 'rejected') console.error(result.reason);
  assert.ok(results.every(result => result.status === 'fulfilled'), 'Campaign acceptance failed');
} finally {
  assert.match(realpathSync(root), /[\\/]evolve-codex-campaigns-[a-zA-Z0-9]+$/);
  rmSync(root, { recursive: true, force: true });
}
