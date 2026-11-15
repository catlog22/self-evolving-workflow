import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { cli, fixture } from './evolve-workflow-support.mjs';
import { evolveSessionReceipt, readEvolveSessions, workflowDbPath } from '../dist/workflow-runtime.js';
import { parseReceipt } from '../dist/closeout.js';

function readBound(f, session, run) {
  f.evolve('run', 'skill-read', run.run_id, '--session', session);
  for (const path of run.skill_ref.required_links.filter(path => path !== run.skill_ref.entry)) {
    f.evolve('run', 'skill-read', run.run_id, path, '--from', run.skill_ref.entry, '--session', session);
  }
}

test('Evolve pins each attempt, fences retries and publishes bytes with the request receipt atomically', () => {
  const f = fixture('evolve-runtime-');
  try {
    const session = 'pin-and-publish';
    const opened = f.open(session, 'ew-analyze,ew-plan');
    const attempt = f.next(session, opened.orchestration_revision, '--request-id', 'first');
    assert.deepEqual(f.next(session, opened.orchestration_revision, '--request-id', 'first'), attempt);
    assert.throws(() => f.next(session, 1, '--request-id', 'first'), /IDEMPOTENCY_PAYLOAD_MISMATCH/);
    assert.throws(() => f.next(session, 0), /REVISION_CONFLICT/);
    assert.throws(() => f.evolve('run', 'skill-read', attempt.run_id, 'references/workflow.md',
      '--from', 'SKILL.md', '--session', session), /Read the source document first/);

    const guide = 'skills/ew-orchestrate/steps/ew-analyze/references/workflow.md';
    f.write(guide, '# Changed after the first dispatch\n');
    f.git('add', guide);
    f.git('commit', '-qm', 'Update the analysis procedure');
    readBound(f, session, attempt);
    const fixed = f.evolve('run', 'skill-read', attempt.run_id, 'references/workflow.md', '--from', 'SKILL.md', '--session', session);
    assert.notEqual(fixed.markdown, '# Changed after the first dispatch\n');
    const failure = f.evolve('run', 'transition', attempt.run_id, 'failed', ...f.fence(session),
      '--expected-run-revision', String(attempt.revision), '--reason', 'Reproducer found a failure');
    const run = f.next(session, failure.orchestration_revision);
    assert.equal(run.retry_of_run_id, attempt.run_id);
    assert.notEqual(run.skill_ref.commit, attempt.skill_ref.commit);
    readBound(f, session, run);
    f.saveArtifact(run, 'findings.json', { verified: 'original calculation reproduced' });
    const gates = run.gates.exit.flatMap(gate => ['--gate', gate]);
    assert.throws(() => f.finish(session, run, 'Missing exit gates'), /Required exit gate/);
    const db = new DatabaseSync(workflowDbPath(f.root));
    try {
      db.exec("CREATE TRIGGER break_receipt BEFORE INSERT ON requests WHEN NEW.id = 'forced-failure' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
      const revision = f.status(session).revision;
      assert.throws(() => f.finish(session, run, 'Trigger rollback', [...gates, '--request-id', 'forced-failure'], revision), /fixture write failure/);
      assert.equal(db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 0);
      assert.equal(f.status(session).revision, revision);
      assert.deepEqual(f.status(session).aliases, {});
      db.exec('DROP TRIGGER break_receipt');

      const sealed = f.finish(session, run, 'Seal verified findings', [...gates, '--request-id', 'verified'], revision);
      assert.deepEqual(f.finish(session, run, 'Seal verified findings', [...gates, '--request-id', 'verified'], revision), sealed);
      assert.equal(db.prepare('SELECT count(*) AS n FROM artifacts').get().n, 1);
      writeFileSync(join(run.run_dir, 'outputs', 'findings.json'), '{"modified":true}');
      const plan = f.next(session);
      const bound = f.evolve('run', 'artifact-read', plan.run_id, 'current-analysis', '--session', session);
      assert.equal(JSON.parse(bound.content).verified, 'original calculation reproduced');
      readBound(f, session, plan);
      f.saveArtifact(plan, 'plan.json', { description: 'Fix the reproduced defect' });
      f.finish(session, plan, 'Verified and approved the plan', plan.gates.exit.flatMap(gate => ['--gate', gate]));
      assert.equal(f.sealSession(session).status, 'completed');
      const [native] = readEvolveSessions(f.root, session);
      const receipt = parseReceipt(evolveSessionReceipt(native));
      assert.ok(receipt.messages.some(message => message.content.includes(attempt.run_id)));
    } finally {
      db.close();
    }
    assert.equal(existsSync(f.sentinel), false);
  } finally {
    f.cleanup();
  }
});

test('All shipped step and mode contracts resolve in the installed Git packages', () => {
  const f = fixture('evolve-runtime-contracts-');
  try {
    const names = f.evolve('skills').map(item => item.command);
    assert.equal(names.length, 14);
    assert.equal(names.filter(name => name.startsWith('ew-')).length, 13);
    for (const name of names) {
      const binding = f.evolve('skills', 'validate', name);
      assert.match(binding.commit, /^[0-9a-f]{40}$/);
      assert.equal(binding.entry, 'SKILL.md');
      if (name.startsWith('ew-odyssey-')) {
        assert.equal(binding.skill_id, 'ew-odyssey');
        assert.ok(binding.required_links.includes('references/prepare/' + name.slice(3) + '.md'));
        assert.ok(binding.produces.some(slot => slot.path === 'outputs/session.json' && slot.required));
      } else {
        assert.equal(binding.skill_id, name);
      }
    }
    const session = 'readonly-audit';
    f.open(session, '');
    assert.throws(() => f.evolve('session', 'chain', 'insert', ...f.fence(session), '--step-id', 'audit',
      '--command', 'ew-odyssey-security', '--arg=--fix'), /read-only audit/);
    assert.equal(existsSync(f.sentinel), false);
  } finally {
    f.cleanup();
  }
});

test('Run recovery still reads the original revision after an EW package rename', () => {
  const f = fixture('evolve-runtime-renames-');
  try {
    const current = f.git('rev-parse', 'HEAD');
    f.git('mv', 'skills/ew-orchestrate', 'skills/maestro');
    f.git('mv', 'skills/maestro/steps/ew-analyze', 'skills/maestro/steps/analyze');
    const legacyEntry = 'skills/maestro/steps/analyze/SKILL.md';
    f.write(legacyEntry, readFileSync(join(f.root, legacyEntry), 'utf8').replace('name: ew-analyze', 'name: analyze'));
    f.git('add', legacyEntry);
    f.git('commit', '-qm', 'Record a legacy Skill revision');

    const session = 'resume-old-name';
    f.open(session, 'analyze');
    const oldRun = f.next(session);
    assert.equal(oldRun.task.command, 'ew-analyze');
    assert.equal(oldRun.skill_ref.skill_id, 'analyze');
    f.git('checkout', '--detach', current);
    const original = f.evolve('run', 'skill-read', oldRun.run_id, '--session', session);
    assert.match(original.markdown, /^name: analyze$/m);
    const currentBinding = f.evolve('skills', 'validate', 'analyze');
    assert.equal(currentBinding.skill_id, 'ew-analyze');
    assert.notEqual(currentBinding.commit, oldRun.skill_ref.commit);
  } finally {
    f.cleanup();
  }
});

test('Wiki MCP pins observed bodies, checks lookup scope and seals or rejects reuse evidence atomically', () => {
  const f = fixture('evolve-wiki-priors-');
  try {
    const session = 'wiki-handoff';
    const selected = 'entries/handoff-selected';
    const unopened = 'entries/handoff-unopened';
    const constraint = 'entries/handoff-rule';
    for (const [entry, mode, body] of [
      [selected, 'reference', 'Record the selected handoff method.'],
      [unopened, 'reference', 'An unopened handoff example.'],
      [constraint, 'constraint', 'Keep the handoff source traceable.'],
    ]) {
      f.write('wiki-draft.json', JSON.stringify({ operation: 'create', entry, title: entry, mode, body }));
      f.agent('wiki', 'apply', f.agent('wiki', 'propose', 'wiki-draft.json', '--evidence', 'fixture:handoff').id);
    }
    const tool = (run, name, args) => {
      const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      const result = JSON.parse(f.run(process.execPath, [cli, 'mcp', '--session', session, '--run', run.run_id], request + '\n')).result;
      return result.isError ? result.content[0].text : JSON.parse(result.content[0].text);
    };
    const opened = f.open(session, 'ew-analyze,ew-plan');
    const analyze = f.next(session, opened.orchestration_revision);
    assert.match(tool(analyze, 'wiki_reference', { id: selected }), /returned by wiki_context/);
    assert.ok(tool(analyze, 'wiki_context', { query: 'handoff' }).references.some(hit => hit.id === unopened));
    const search = tool(analyze, 'wiki_context', { query: 'handoff selected' });
    const initial = tool(analyze, 'wiki_reference', { id: selected });
    assert.deepEqual(tool(analyze, 'wiki_reference', { id: selected }), initial);
    const selectedPath = 'wiki/' + selected + '.md';
    f.write(selectedPath, readFileSync(join(f.root, selectedPath), 'utf8').replace('selected handoff method', 'changed handoff method'));
    assert.match(tool(analyze, 'wiki_reference', { id: selected }), /Wiki evidence changed/);
    const unopenedPath = 'wiki/' + unopened + '.md';
    f.write(unopenedPath, readFileSync(join(f.root, unopenedPath), 'utf8').replace('  - project', '  - task:review'));
    assert.match(tool(analyze, 'wiki_reference', { id: unopened }), /no longer available in the recorded scope/);

    readBound(f, session, analyze);
    f.saveArtifact(analyze, 'findings.json', { finding: initial.body });
    assert.throws(() => f.finish(session, analyze, 'Fail without gates', [], analyze.orchestration_revision), /Required exit gate/);
    assert.deepEqual(f.status(session).aliases, {});
    const gates = analyze.gates.exit.flatMap(gate => ['--gate', gate]);
    const sealed = f.finish(session, analyze, 'Publish pinned Wiki', gates, analyze.orchestration_revision);
    assert.equal(sealed.knowledge_reads.reads.length, 1);
    assert.equal(sealed.knowledge_reads.reads[0].from_search_id, search.search_id);
    const plan = f.next(session, sealed.orchestration_revision);
    assert.match(tool(plan, 'read_artifact', { id: 'session-priors', scope: { task: 'review' } }), /outside session-priors/);
    const priors = tool(plan, 'read_artifact', { id: 'session-priors' });
    const snapshot = JSON.parse(priors.content);
    assert.deepEqual(snapshot.lookup_scopes, [{}]);
    assert.deepEqual(snapshot.wiki.map(item => item.id), [constraint, selected]);
    assert.equal(snapshot.wiki[1].content, initial.body);
    assert.equal(snapshot.wiki[1].content_sha256, sealed.knowledge_reads.reads[0].content_sha256);

    readBound(f, session, plan);
    f.saveArtifact(plan, 'plan.json', { verified: true });
    const tracePath = join(plan.run_dir, 'knowledge-reads.json');
    const trace = { schema_version: 'knowledge-reads/1.0', reads: [], searches: [], constraints_bound: [] };
    const reuse = [{ artifact_id: priors.id, producer_run_id: analyze.run_id, content_sha256: priors.sha256 }];
    const planGates = plan.gates.exit.flatMap(gate => ['--gate', gate]);
    writeFileSync(tracePath, JSON.stringify({ ...trace, priors_reuse: reuse }));
    assert.throws(() => f.finish(session, plan, 'Reject caller-authored priors', planGates, plan.orchestration_revision), /bound artifact reads/);
    writeFileSync(tracePath, JSON.stringify(trace));
    const completed = f.finish(session, plan, 'Record verified prior reuse', planGates, plan.orchestration_revision);
    assert.deepEqual(completed.knowledge_reads, { ...trace, priors_reuse: reuse });
    assert.equal(f.sealSession(session).status, 'completed');
  } finally {
    f.cleanup();
  }
});
