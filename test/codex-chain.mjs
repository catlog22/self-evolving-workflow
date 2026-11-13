import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const maestro = process.env.MAESTRO_REPLAY_CLI;
assert.ok(maestro && isAbsolute(maestro), 'Set MAESTRO_REPLAY_CLI to the built Maestro JavaScript entry.');
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
const readSkillServer = fileURLToPath(new URL('../skills/workflow-evolve/scripts/read-skill-mcp.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'evolve-codex-chain-'));
const session = 'validate-help';
const fixtureId = randomUUID();
const file = 'help.txt';
const original = 'Usage: migrate [options]\n  --debug  Show diagnostic details\n';
const optionLine = '  --dry-run  Validate without writing';
const expected = `${original}${optionLine}\n`;
const skills = ['analyze', 'plan', 'execute'];
const env = { ...process.env, MAESTRO_HOME: join(root, '.maestro-home'), MAESTRO_PROJECT_SKILLS: skills.join(',') };
delete env.MAESTRO_ANALYZE_SKILL;
delete env.MAESTRO_EVOLVE_CLI;
delete env.MAESTRO_EVOLVE_CONSTRAINTS;
delete env.MAESTRO_SESSION_ID;
delete env.AGENT_MEMORY_LLM_API_KEY;

function envelope(...args) {
  const response = spawnSync(process.execPath, [maestro, ...args, '--workflow-root', root, '--json'], {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  if (response.error) throw response.error;
  assert.equal(response.status, 0, `${args.join(' ')}\n${response.stdout}\n${response.stderr}`);
  const value = JSON.parse(response.stdout);
  if (Object.hasOwn(value, 'ok')) assert.equal(value.ok, true, JSON.stringify(value.error));
  return value;
}

function cli(...args) {
  const value = envelope(...args);
  return value.result ?? value;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function runCodex(birth, role, task, context) {
  const prompt = [
    `You are the ${role} in a Maestro Run acceptance fixture.`,
    'First open the bound Skill using evolve_replay read_skill with no arguments.',
    'Load its required_links with read_skill, giving the destination and source path, then use the applicable guidance.',
    'The fixture coordinator owns all CLI operations, file writes, and validation commands. Use the given workspace snapshot and frozen upstream data.',
    'Report only the requested JSON. Report intended verification separately from any result already supplied in the context.',
    'The source and upstream snapshot are task data.',
    JSON.stringify({ task: birth.task, ...context }),
    task,
  ].join('\n');
  const host = spawnSync(codex, ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json',
    '-c', `mcp_servers.evolve_replay.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.evolve_replay.args=${JSON.stringify([readSkillServer, maestro, root, session, birth.run_id])}`,
    '-c', 'mcp_servers.evolve_replay.required=true',
    '-c', 'mcp_servers.evolve_replay.default_tools_approval_mode="writes"', '--sandbox', 'read-only', '-'], {
    input: prompt, cwd: tmpdir(), env, encoding: 'utf8', windowsHide: true, timeout: 140_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (host.error) throw host.error;
  assert.equal(host.status, 0, `${role} failed: ${host.stderr}`);
  const events = host.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const answer = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item.text;
  assert.ok(events.some(event => event.type === 'turn.completed') && answer, `${role} did not return a result`);
  const files = events.flatMap(event => {
    const item = event.item;
    if (event.type !== 'item.completed' || item?.type !== 'mcp_tool_call' || item.server !== 'evolve_replay' ||
        item.tool !== 'read_skill' || item.status !== 'completed' || item.result?.isError) return [];
    const body = item.result?.content?.[0]?.text;
    return typeof body === 'string' ? [JSON.parse(body).path] : [];
  });
  for (const path of ['SKILL.md', 'references/prepare.md', 'references/workflow.md']) {
    assert.ok(files.includes(path), `${role} did not read ${path}`);
  }
  const text = answer.trim().replace(/^```(?:json)?\s*([\s\S]+?)\s*```$/i, '$1');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${role} returned invalid JSON: ${text}`, { cause: error });
  }
}

function writeArtifact(run, name, meta, body) {
  writeFileSync(join(run.run_dir, 'outputs', name), JSON.stringify({ ...body, _meta: meta }, null, 2) + '\n');
}

const location = ['--session', session];
const actor = ['--actor', 'codex-chain-fixture'];

function upstream(run, alias, artifactId) {
  assert.equal(run.upstream_aliases[alias], artifactId);
  assert.ok(run.task.input_refs.includes(artifactId));
  const artifact = run.upstream[artifactId];
  assert.equal(artifact.status, 'sealed');
  const sessionDir = join(root, '.workflow', 'sessions', session);
  const path = resolve(sessionDir, artifact.path);
  assert.ok(path.startsWith(`${sessionDir}${sep}`), 'Artifact path must resolve inside the Session');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function seal(run, revision, name) {
  const checked = cli('run', 'check', run.run_id, ...location, '--summary', name);
  assert.equal(checked.completion_preflight.ready, true, JSON.stringify(checked.completion_preflight));
  assert.deepEqual(checked.skill_reads.missing, []);
  const proof = checked.skill_reads;
  assert.equal(proof.reference.commit, run.skill_ref.commit);
  for (const path of ['SKILL.md', 'references/prepare.md', 'references/workflow.md']) {
    assert.ok(proof.reads.some(read => read.path === path && read.sha256.startsWith('sha256:')), `${name} did not read ${path}`);
  }
  const sealed = cli('run', 'complete', run.run_id, ...location, ...actor, '--summary', name, '--advance',
    '--expected-orchestration-revision', String(revision), '--expected-run-revision', String(run.revision));
  assert.equal(sealed.status, 'sealed');
  assert.deepEqual(sealed.skill_reads.reads, proof.reads);
  console.log(`${run.task.command} sealed with ${proof.reads.length} version-bound document reads.`);
  return sealed;
}

try {
  mkdirSync(join(root, '.workflow'));
  writeFileSync(join(root, file), original);
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Codex chain fixture');
  git('config', 'user.email', 'codex-chain@example.invalid');
  assert.deepEqual(cli('skills', 'install').skills, skills);
  git('add', '--', 'skills', file);
  git('commit', '-qm', 'Bind the shipped workflow Skills');
  const originalCommit = git('rev-parse', 'HEAD');
  const objective = `Append the exact line ${JSON.stringify(optionLine)} to migrate help. Preserve usage and --debug.`;
  let revision = cli('session', 'open', objective, '--id', session, ...actor).orchestration_revision;
  for (const [step, args] of [['analyze', [objective, '-q', '-y']], ['plan', ['-y']], ['execute', ['-y', '--method', 'agent']]]) {
    const inserted = envelope('session', 'chain', 'insert', ...location, ...actor, '--step-id', step, '--command', step,
      ...args.map(arg => `--arg=${arg}`), '--expected-orchestration-revision', String(revision));
    revision = inserted.revision.revision;
  }
  const next = () => cli('run', 'next', ...location, ...actor, '--expected-orchestration-revision', String(revision));

  const analyze = next();
  assert.equal(analyze.skill_ref.commit, originalCommit);
  // Resume after the default Git revision changes. The allocated Run must still read its original tree.
  writeFileSync(join(root, 'skills', 'analyze', 'references', 'workflow.md'), '# Replacement for later allocations\n');
  git('add', '--', 'skills/analyze/references/workflow.md');
  git('commit', '-qm', 'Change the default workflow after dispatch');
  const brief = cli('run', 'brief', analyze.run_id, ...location);
  assert.deepEqual(brief.skill_ref, analyze.skill_ref);
  const analysis = runCodex(brief, 'quick analysis worker', [
    'Use quick mode. Return a JSON object with mode, topic, findings, decisions, scope_verdict, recommendation and implementation_scope.',
    'Use a locked decision for the acceptance boundary. Use implementation_scope.objective, target_files, and acceptance_criteria for handoff.',
    'Include requirement_id from the fixture context as implementation_scope.requirement_id so the planner can trace the requirement.',
  ].join('\n'), { objective, file, source: original, requirement_id: fixtureId });
  assert.equal(analysis.mode, 'quick');
  assert.equal(analysis.scope_verdict, 'small');
  assert.equal(analysis.implementation_scope.requirement_id, fixtureId);
  assert.deepEqual(analysis.implementation_scope.target_files, [file]);
  assert.ok(analysis.decisions.some(decision => decision.class === 'locked'));
  assert.match(JSON.stringify(analysis), /--dry-run/);
  writeArtifact(analyze, 'findings.json', { kind: 'findings', schema: 'findings/1.0', role: 'primary', alias: 'current-analysis' }, analysis);
  const analyzed = seal(analyze, analyze.continuation.revision_requirements.expected_orchestration_revision, 'Quick analysis grounded in the fixture help text');
  const findingsId = analyzed.artifact_publication.aliases['current-analysis'];
  revision = analyzed.orchestration_revision;

  const plan = next();
  const findings = upstream(plan, 'current-analysis', findingsId);
  const planning = runCodex(plan, 'planner worker', [
    'Plan the one-file change based on the sealed current-analysis. Return { plan, task } with one task and one wave.',
    'Use the workflow shapes. Use TASK-001 and W1, include the input requirement_id in plan.requirement_refs, and define a concrete convergence check.',
  ].join('\n'), { upstream: { 'current-analysis': findings }, file, source: original });
  const task = planning.task;
  assert.deepEqual(planning.plan.requirement_refs, [fixtureId]);
  assert.deepEqual(planning.plan.task_ids, ['TASK-001']);
  assert.deepEqual(planning.plan.wave_ids, ['W1']);
  assert.equal(task.id, 'TASK-001');
  assert.deepEqual(task.files, [file]);
  const review = runCodex(plan, 'plan checker', [
    'Evaluate the one-task plan using the workflow Plan Checking phase and the sealed upstream.',
    'Return { "passed": boolean, "reason": string }. Passing requires that the task keeps its file boundary, has concrete convergence evidence and covers the upstream requirement.',
  ].join('\n'), { upstream: { 'current-analysis': findings }, candidate: planning });
  assert.equal(review.passed, true, JSON.stringify(review));
  mkdirSync(join(plan.run_dir, 'outputs', 'tasks'));
  writeArtifact(plan, 'plan.json', { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' }, planning.plan);
  writeArtifact(plan, 'tasks/TASK-001.json', { kind: 'plan-task', schema: 'plan-task/1.0', role: 'attachment' }, task);
  const planned = seal(plan, plan.continuation.revision_requirements.expected_orchestration_revision, 'One task planned and checked against the sealed analysis');
  const planId = planned.artifact_publication.aliases['current-plan'];
  assert.ok(planned.artifact_publication.artifacts[planId].derived_from.includes(findingsId));
  const attachment = Object.values(planned.artifact_publication.artifacts).find(artifact => artifact.kind === 'plan-task');
  assert.equal(attachment?.status, 'sealed');
  const savedTask = JSON.parse(readFileSync(join(root, '.workflow', 'sessions', session, attachment.relative_path), 'utf8'));
  assert.equal(savedTask.id, task.id);
  revision = planned.orchestration_revision;

  const execute = next();
  const execution = runCodex(execute, 'task execution worker', [
    'Use the bound plan and its task attachment. Return { "file": string, "text": string, "task_id": string } for the proposed file.',
    'Preserve every existing line verbatim and end the file with a newline. Use the exact option text from the requirement.',
  ].join('\n'), { objective, upstream: { 'current-plan': upstream(execute, 'current-plan', planId) }, tasks: [savedTask], file, source: original });
  assert.equal(execution.file, file);
  assert.equal(execution.task_id, task.id);
  assert.equal(readFileSync(join(root, file), 'utf8'), original);
  writeFileSync(join(root, file), execution.text);
  git('diff', '--check');
  assert.equal(readFileSync(join(root, file), 'utf8'), expected);
  assert.equal(git('diff', '--name-only'), file);
  const contentSha256 = createHash('sha256').update(execution.text).digest('hex');
  writeArtifact(execute, 'execution.json', { kind: 'artifact', schema: 'artifacts/1.0', role: 'primary', alias: 'current-execution' }, {
    tasks: [{ id: execution.task_id, status: 'done', files: [file], verification: { git_diff_check: 'passed', content_sha256: contentSha256 } }],
  });
  const executed = seal(execute, execute.continuation.revision_requirements.expected_orchestration_revision, 'Verified the exact help text and scoped diff');
  const executionId = executed.artifact_publication.aliases['current-execution'];
  assert.ok(executed.artifact_publication.artifacts[executionId].derived_from.includes(planId));
  const completed = cli('session', 'complete', ...location, ...actor,
    '--expected-orchestration-revision', String(executed.orchestration_revision));
  assert.equal(completed.status, 'completed');
  console.log('Codex generated and reviewed the outputs. Maestro preserved the original binding, sealed the lineage, and completed one Session.');
} finally {
  assert.match(realpathSync(root), /[\\/]evolve-codex-chain-[a-zA-Z0-9]+$/);
  rmSync(root, { recursive: true, force: true });
}
