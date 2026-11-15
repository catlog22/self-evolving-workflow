import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fixture } from './evolve-workflow-support.mjs';
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
