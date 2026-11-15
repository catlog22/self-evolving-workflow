import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const maestro = process.env.MAESTRO_REPLAY_CLI;
assert.ok(maestro && isAbsolute(maestro), 'Set MAESTRO_REPLAY_CLI to the built Maestro JavaScript entry.');
const codex = process.env.CODEX_REPLAY_EXECUTABLE || (process.platform === 'win32' ? 'codex.exe' : 'codex');
const server = fileURLToPath(new URL('./fixtures/legacy-skill-read-mcp.mjs', import.meta.url));
const debugServer = fileURLToPath(new URL('./odyssey-debug-mcp.mjs', import.meta.url));
const maestroServer = join(dirname(maestro), 'mcp', 'server.js');
const requireMaestro = createRequire(maestro);
const { Client } = requireMaestro('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMaestro('@modelcontextprotocol/sdk/client/stdio.js');
const packages = ['maestro-odyssey', 'team-swarm'];
const campaignNames = ['review', 'debug', 'security', 'defensive', 'swarm'];
const selected = new Set(process.argv.length > 2 ? process.argv.slice(2) : campaignNames);
assert.ok([...selected].every(name => campaignNames.includes(name)), `Choose from ${campaignNames.join(', ')}`);
const root = mkdtempSync(join(tmpdir(), 'evolve-codex-campaigns-'));
const env = { ...process.env, MAESTRO_HOME: join(root, '.maestro-home'), MAESTRO_PLATFORM: 'codex' };
for (const name of ['MAESTRO_PROJECT_SKILLS', 'MAESTRO_ANALYZE_SKILL', 'MAESTRO_EVOLVE_CLI', 'MAESTRO_EVOLVE_CONSTRAINTS',
  'MAESTRO_SESSION_ID', 'AGENT_MEMORY_LLM_API_KEY']) delete env[name];
const actor = ['--actor', 'campaign-fixture'];
const repoId = '11111111-1111-4111-8111-111111111111';
const teamEnv = {
  MAESTRO_PROJECT_ROOT: root,
  MAESTRO_REPO_ID: repoId,
  MAESTRO_HOME: env.MAESTRO_HOME,
  MAESTRO_ENABLED_TOOLS: 'team_msg,team_task,team_agent',
};

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

function start(session, command, objective = `Verify ${command}`) {
  const open = cli(undefined, 'session', 'open', objective, '--id', session, '--chain', command, ...actor);
  return cli(session, 'run', 'next', ...actor, '--expected-orchestration-revision', String(open.orchestration_revision));
}

async function host(session, run, links, task, context, {
  calls: expectedMessages = [], tool: teamTool = 'team_msg', debugPhase, requireEntry = true, allowRetries = false,
} = {}) {
  const args = ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--json', '--sandbox', 'read-only',
    '-c', 'model_reasoning_effort="low"',
    '-c', `mcp_servers.evolve_replay.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.evolve_replay.args=${JSON.stringify([server, maestro, root, session, run.run_id])}`,
    '-c', 'mcp_servers.evolve_replay.required=true', '-c', 'mcp_servers.evolve_replay.default_tools_approval_mode="writes"'];
  if (expectedMessages.length) args.push(
    '-c', `mcp_servers.maestro.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.maestro.args=${JSON.stringify([maestroServer])}`,
    '-c', `mcp_servers.maestro.env={ ${Object.entries(teamEnv).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(', ')} }`,
    '-c', 'mcp_servers.maestro.required=true', '-c', `mcp_servers.maestro.enabled_tools=${JSON.stringify([teamTool])}`,
    '-c', `mcp_servers.maestro.tools.${teamTool}.approval_mode="approve"`,
    '-c', 'mcp_servers.maestro.tool_timeout_sec=130',
  );
  if (debugPhase) args.push(
    '-c', `mcp_servers.debug_fixture.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.debug_fixture.args=${JSON.stringify([debugServer, maestro, root, debugPhase, run.run_id])}`,
    '-c', 'mcp_servers.debug_fixture.required=true',
    ...(debugPhase === 'repair' ? ['-c', 'mcp_servers.debug_fixture.tools.replace_source.approval_mode="approve"'] : []),
  );
  args.push('-');
  const prompt = [
    'You are executing a bounded role in a Maestro campaign acceptance fixture.',
    'Before analyzing the task, call evolve_replay read_skill with no arguments. Do not produce an answer until that tool call succeeds. For each document below use the specified from and destination arguments.',
    JSON.stringify(links),
    debugPhase ? 'Use debug_fixture check for the requested Git and Node operations. The fixture owns the Maestro lifecycle and campaign artifacts. Return only the requested JSON.'
      : 'The fixture owns artifacts, script execution, CLI lifecycle and worker coordination. Return only the requested JSON.',
    ...(expectedMessages.length ? [
      `Also call maestro ${teamTool} with each of these exact argument objects. The fixture has authorized these calls.`,
      JSON.stringify(expectedMessages.map(message => ({ session_id: run.run_id, ...message }))),
    ] : []),
    task, JSON.stringify(context),
  ].join('\n');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(codex, args, { cwd: tmpdir(), env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(`Codex host timed out for ${session}: ${stderr.trim().slice(-1500)}\n${stdout.trim().split(/\r?\n/).slice(-4).join('\n').slice(-2500)}`));
    }, 160_000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Codex host exited with ${code} for ${session}: ${stderr.trim()}`));
    });
    child.on('exit', code => {
      // A Windows grandchild can hold the pipe after Codex reports a successful turn.
      if (code !== 0 || !stdout.includes('"type":"turn.completed"')) return;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(stdout);
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
  if (requireEntry) assert.ok(loaded.includes('SKILL.md'), `Skill reads: ${JSON.stringify(loaded)}\nAnswer: ${result}`);
  for (const { from, destination } of links) assert.ok(loaded.includes(posix.join(posix.dirname(from), destination)), `${destination}; reads=${JSON.stringify(loaded)} answer=${result}`);
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' &&
    event.item.server === 'maestro' && event.item.tool === teamTool).map(event => event.item);
  if (allowRetries) assert.ok(calls.length >= expectedMessages.length);
  else assert.equal(calls.length, expectedMessages.length);
  for (const message of expectedMessages) {
    const expected = { session_id: run.run_id, ...message };
    const matched = calls.some(item => isDeepStrictEqual(item.arguments, expected) ||
      (teamTool === 'team_agent' && expected.operation === 'spawn_agent' &&
       item.arguments?.session_id === expected.session_id && item.arguments.operation === 'spawn_agent' &&
       item.arguments.tool === expected.tool && item.arguments.mode === expected.mode &&
       item.arguments.role === expected.role && typeof item.arguments.prompt === 'string' &&
       item.arguments.prompt.includes(`Assignment: ${JSON.stringify(message.prompt.split('Assignment: ').at(-1) ? JSON.parse(message.prompt.split('Assignment: ').at(-1)) : {})}`)) ||
      (teamTool === 'team_agent' && expected.operation === 'wait' &&
       item.arguments?.session_id === expected.session_id && item.arguments.operation === 'wait' &&
       isDeepStrictEqual(item.arguments.roles, expected.roles) && item.arguments.timeout_ms === expected.timeout_ms));
    assert.ok(matched, JSON.stringify({ expected, calls }));
  }
  for (const call of calls) {
    assert.equal(call.status, 'completed', JSON.stringify(call));
    assert.ok(call.result && !call.result.isError, JSON.stringify(call));
  }
  const answer = JSON.parse(result.trim().replace(/^```(?:json)?\s*([\s\S]+?)\s*```$/i, '$1'));
  if (!debugPhase) return answer;
  const commands = events.flatMap(event => {
    const item = event.item;
    return event.type === 'item.completed' && item?.type === 'mcp_tool_call' && item.server === 'debug_fixture'
      && item.tool === 'check' && item.status === 'completed' && !item.result?.isError
      ? [JSON.parse(item.result.content[0].text)] : [];
  });
  const edits = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call'
    && event.item.server === 'debug_fixture' && event.item.tool === 'replace_source').map(event => event.item);
  return { answer, commands, edits };
}

const entryLinks = (...destinations) => destinations.map(destination => ({ from: 'SKILL.md', destination }));
const save = (run, file, value) => writeFileSync(join(run.run_dir, 'outputs', file), `${JSON.stringify(value, null, 2)}\n`);

function seal(session, run, summary, extraReads = []) {
  const checked = cli(session, 'run', 'check', run.run_id, '--summary', summary);
  assert.equal(checked.completion_preflight.ready, true, JSON.stringify(checked.completion_preflight));
  assert.deepEqual(checked.skill_reads.missing, []);
  for (const path of extraReads) assert.ok(checked.skill_reads.reads.some(read => read.path === path), path);
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

const securityFile = 'security-handler.mjs';
const defensiveFile = 'defensive-decision.mjs';

function securityFixture() {
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'security-fixture', private: true, dependencies: { 'fixture-safe-lib': '1.0.0' },
  }, null, 2) + '\n');
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: 'security-fixture', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'security-fixture', dependencies: { 'fixture-safe-lib': '1.0.0' } },
      'node_modules/fixture-safe-lib': { version: '1.0.0', resolved: 'https://registry.invalid/fixture-safe-lib-1.0.0.tgz', integrity: 'sha512-fixture' } },
  }, null, 2) + '\n');
  writeFileSync(join(root, securityFile), [
    "import { exec } from 'node:child_process';",
    'export function checkHost(request) {',
    "  const host = request.query.host;",
    "  if (typeof host !== 'string') throw new TypeError('host required');",
    "  return exec('ping ' + host);",
    '}', '',
  ].join('\n'));
}

function defensiveFixture() {
  writeFileSync(join(root, defensiveFile), [
    'export function approveOrder(order, readUsage) {',
    '  let observedUsage;',
    '  try {',
    '    observedUsage = readUsage(order.accountId);',
    '  } catch {',
    '    observedUsage = 0;',
    '  }',
    '  return observedUsage + order.amount <= order.approvedLimit;',
    '}', '',
  ].join('\n'));
}

function auditLinks(run, mode) {
  return [
    ...entryLinks(...run.skill_required_links, `references/odyssey-${mode}.md`),
    { from: `references/prepare/odyssey-${mode}.md`, destination: '../audit-artifacts.md' },
  ];
}

function assertAuditReadOnly(files) {
  const changed = git('diff', '--name-only', '--', ...files).toString().trim();
  assert.equal(changed, '', `Audit changed source files: ${changed}`);
}

async function odysseySecurity(run, session) {
  const source = readFileSync(join(root, securityFile), 'utf8');
  const links = auditLinks(run, 'security');
  const recon = await host(session, run, links, [
    'Execute the Odyssey Security read-only workflow through S_SCAN on this isolated repository.',
    'Do not run commands and do not modify any file. The fixture provided the complete source and package metadata.',
    'Perform a quick tier audit with OWASP A01-A10 coverage and a dependency lockfile check.',
    'Return exactly JSON shaped as {recon:{techStack,entryPoints,dataFlow},coverage:{owasp:[string],dependency:string},findings:[{category,title,severity,file,line,cwe,evidence,remediation}]}.' ,
    'Every OWASP category must appear in coverage. Use no_evidence for categories without evidence. Keep the one proven injection finding tied to the supplied line.',
  ].join(' '), { target: securityFile, tier: 'quick', source: `${securityFile}\n${source}`, packageJson: readFileSync(join(root, 'package.json'), 'utf8'), lockfile: readFileSync(join(root, 'package-lock.json'), 'utf8') });
  assert.match(JSON.stringify(recon.recon.techStack), /node/i);
  assert.ok(JSON.stringify(recon.recon.entryPoints).length > 2);
  for (const category of ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']) {
    assert.match(JSON.stringify(recon.coverage.owasp), new RegExp(category));
  }
  assert.match(recon.coverage.dependency, /clean|lockfile|no .*vulnerability|no evidence/i);
  const injection = recon.findings.find(finding => /A03|injection/i.test(finding.category));
  assert.ok(injection, JSON.stringify(recon));
  assert.equal(injection.file, securityFile);
  assert.ok([5, 6].includes(injection.line));
  assert.match(injection.cwe, /CWE-78/);
  assert.match(injection.evidence, /exec|host/i);
  assert.match(injection.remediation, /spawn|shell|allowlist|validation/i);

  const evidence = [
    { _meta: { kind: 'evidence', schema: 'evidence/1.0', role: 'evidence', alias: 'security-evidence' },
      phase: 'recon', target: securityFile, tier: 'quick' },
    ...recon.findings.map(finding => ({ phase: 'scan', ...finding })),
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(join(run.run_dir, 'outputs', 'evidence.ndjson'), evidence);
  save(run, 'session.json', { _meta: { kind: 'security-audit-result', schema: 'security-audit-result/1.0', role: 'primary', alias: 'security-session' },
    target: securityFile, tier: 'quick', scan_phases: ['owasp', 'dependency'], current_state: 'S_REPORT', findings: recon.findings });

  const resumed = cli(session, 'run', 'brief', run.run_id);
  assert.deepEqual(resumed.skill_ref, run.skill_ref);
  const report = await host(session, resumed, links, [
    'Resume the same Odyssey Security audit from the supplied checkpoint and produce S_REPORT.',
    'Remain read-only. Use the supplied scan findings and source evidence, do not invent additional vulnerabilities.',
    'Return exactly JSON shaped as {severityMatrix:[{ref,severity,file,line,category,remediation}],summary:{critical,high,medium,low},generalization:string,currentState:string}. Set currentState to END after completing the report and generalization steps.',
    'The shell injection is at least HIGH. Keep the dependency check clean and state that no secret values were logged.',
  ].join(' '), { checkpoint: readFileSync(join(run.run_dir, 'outputs', 'session.json'), 'utf8'), evidence, source }, { requireEntry: false });
  assert.equal(report.currentState, 'END');
  const reported = report.severityMatrix.find(finding => finding.file === securityFile);
  assert.ok(reported);
  assert.match(reported.severity, /critical|high/i);
  assert.ok([5, 6].includes(reported.line));
  assert.match(reported.remediation, /spawn|shell|allowlist|validation/i);
  assert.ok(report.generalization.trim());
  save(run, 'session.json', { _meta: { kind: 'security-audit-result', schema: 'security-audit-result/1.0', role: 'primary', alias: 'security-session' },
    target: securityFile, tier: 'quick', scan_phases: ['owasp', 'dependency'], current_state: 'END', findings: recon.findings, report });
  writeFileSync(join(run.run_dir, 'outputs', 'understanding.md'), `---\nkind: security-report\nschema: security-report/1.0\nrole: primary\nalias: security-understanding\n---\n\n# Security report\n\n${report.severityMatrix.map(finding => `- ${finding.ref}: ${finding.severity} ${finding.file}:${finding.line} — ${finding.remediation}`).join('\n')}\n\n${report.generalization}\n`);
  const publication = seal(session, run, 'Completed a read-only quick security audit with OWASP and dependency coverage');
  for (const [alias, kind] of Object.entries({ 'security-session': 'security-audit-result', 'security-evidence': 'evidence', 'security-understanding': 'security-report' })) {
    const artifact = publication.artifacts[publication.aliases[alias]];
    assert.equal(artifact?.kind, kind);
    assert.equal(artifact?.status, 'sealed');
  }
  assertAuditReadOnly([securityFile, 'package.json', 'package-lock.json']);
  console.log('Codex completed Odyssey Security recon, scan and report from the fixed Skill tree without source changes.');
}

async function odysseyDefensive(run, session) {
  const source = readFileSync(join(root, defensiveFile), 'utf8');
  const links = auditLinks(run, 'defensive');
  const anchors = await host(session, run, links, [
    'Execute the Odyssey Defensive read-only workflow through S_PROPAGATE on this isolated repository.',
    'Do not run commands and do not modify any file. Use the complete source snapshot supplied by the fixture.',
    'Use standard tier coverage and attempt all eight patterns P1 broad_catch, P2 exception_swallow, P3 default, P4 null_fallback, P5 auto_correct, P6 silent_convert, P7 dup_constraint, P8 dup_default.',
    'Return exactly JSON shaped as {anchors:[{name,file,line,layer}],slice:[{criticalVar,chain}],coverage:[string],candidates:[{pattern,file,line,originalFailureType,stateTransform,sink,reachesCriticalSink,q4DownstreamAware,scores:{S,P,B,H},riskLevel,exceptionClass}]}.' ,
    'The supplied function is an approval decision. A storage failure is unavailable usage and must fail closed. Identify the broad catch/default at the exact source line and follow it to the approval sink.',
  ].join(' '), { target: defensiveFile, tier: 'standard', source: `${defensiveFile}\n${source}`, businessRule: 'Storage-unavailable usage must not authorize an order.' });
  assert.ok(anchors.anchors.some(anchor => anchor.file === defensiveFile),
    JSON.stringify(anchors));
  assert.ok(anchors.slice.some(item => /observedUsage|approveOrder/.test(JSON.stringify(item)) && /approval decision|approvedLimit/.test(JSON.stringify(item))));
  for (const pattern of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']) {
    assert.ok(anchors.coverage.some(item => String(item).startsWith(pattern)), JSON.stringify(anchors.coverage));
  }
  const candidate = anchors.candidates.find(item => /broad|default|swallow/i.test(item.pattern));
  assert.ok(candidate, JSON.stringify(anchors));
  assert.equal(candidate.file, defensiveFile);
  assert.ok([5, 6].includes(candidate.line));
  assert.match(candidate.stateTransform, /Exception.*(Numeric|Default)|Missing.*Default/i);
  assert.equal(candidate.reachesCriticalSink, true);
  assert.equal(candidate.q4DownstreamAware, false);
  for (const key of ['S', 'P', 'B', 'H']) assert.ok(Number(candidate.scores[key]) > 0);
  assert.match(candidate.riskLevel, /critical|high/i);
  assert.match(candidate.exceptionClass, /^[A-D]$/);

  const evidence = [
    { _meta: { kind: 'evidence', schema: 'evidence/1.0', role: 'evidence', alias: 'defensive-evidence' },
      phase: 'anchor', target: defensiveFile, tier: 'standard' },
    ...anchors.candidates.map(candidate => ({ phase: 'scan', ...candidate })),
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(join(run.run_dir, 'outputs', 'evidence.ndjson'), evidence);
  save(run, 'session.json', { _meta: { kind: 'defensive-audit-result', schema: 'defensive-audit-result/1.0', role: 'primary', alias: 'defensive-session' },
    target: defensiveFile, tier: 'standard', current_state: 'S_REPORT', anchors: anchors.anchors, candidates: anchors.candidates });
  const resumed = cli(session, 'run', 'brief', run.run_id);
  assert.deepEqual(resumed.skill_ref, run.skill_ref);
  const report = await host(session, resumed, links, [
    'Resume the same Odyssey Defensive audit from the supplied checkpoint and produce S_REPORT.',
    'Remain read-only. Preserve the local slice and all eight pattern coverage entries.',
    'Return exactly JSON shaped as {propagation:[{findingRef,stateTransform,chain,sink,reachesCriticalSink,q4DownstreamAware}],riskMatrix:[{findingRef,riskLevel,scores:{S,P,B,H},exceptionClass,remediation}],summary:{critical,high,medium,low},generalization:string,currentState:string}. Set currentState to END after completing the report and generalization steps.',
    'The report must explain why an unavailable usage read cannot become numeric zero in an approval decision, and must recommend fail-closed behavior.',
  ].join(' '), { checkpoint: readFileSync(join(run.run_dir, 'outputs', 'session.json'), 'utf8'), evidence, source }, { requireEntry: false });
  assert.equal(report.currentState, 'END');
  const propagated = report.propagation.find(item => item.reachesCriticalSink === true);
  assert.ok(propagated);
  assert.equal(propagated.q4DownstreamAware, false);
  assert.match(propagated.stateTransform, /Exception.*(Numeric|Default)|Missing.*Default/i);
  const risk = report.riskMatrix.find(item => item.findingRef === propagated.findingRef) ?? report.riskMatrix[0];
  assert.ok(risk);
  assert.match(risk.riskLevel, /critical|high/i);
  assert.match(risk.remediation, /fail.?closed|deny|unavailable|error/i);
  assert.ok(report.generalization.trim());
  save(run, 'session.json', { _meta: { kind: 'defensive-audit-result', schema: 'defensive-audit-result/1.0', role: 'primary', alias: 'defensive-session' },
    target: defensiveFile, tier: 'standard', current_state: 'END', anchors: anchors.anchors, candidates: anchors.candidates, report });
  writeFileSync(join(run.run_dir, 'outputs', 'understanding.md'), `---\nkind: defensive-report\nschema: defensive-report/1.0\nrole: primary\nalias: defensive-understanding\n---\n\n# Defensive report\n\n${report.riskMatrix.map(finding => `- ${finding.findingRef}: ${finding.riskLevel} — ${finding.remediation}`).join('\n')}\n\n${report.generalization}\n`);
  const publication = seal(session, run, 'Completed a read-only defensive audit with local slicing and propagation scoring');
  for (const [alias, kind] of Object.entries({ 'defensive-session': 'defensive-audit-result', 'defensive-evidence': 'evidence', 'defensive-understanding': 'defensive-report' })) {
    const artifact = publication.artifacts[publication.aliases[alias]];
    assert.equal(artifact?.kind, kind);
    assert.equal(artifact?.status, 'sealed');
  }
  assertAuditReadOnly([defensiveFile]);
  console.log('Codex completed Odyssey Defensive anchor, slice, propagation and report phases without source changes.');
}

const debugFile = 'debug-limits.mjs';
const debugTest = 'debug-limits.test.mjs';
const debugReview = 'debug-limits.review.mjs';
const debugIssue = 'MAX_ITEMS=0 should disable items. Missing, blank and invalid values should keep the default of 10.';

function debugFixture() {
  writeFileSync(join(root, debugFile), [
    'export function itemLimit(env) {',
    '  return Number(env.MAX_ITEMS) || 10;',
    '}', '',
  ].join('\n'));
  writeFileSync(join(root, debugTest), [
    'import assert from "node:assert/strict";',
    `import { itemLimit } from "./${debugFile}";`,
    'for (const value of [undefined, "", " ", "missing"]) assert.equal(itemLimit({ MAX_ITEMS: value }), 10);',
    'assert.equal(itemLimit({ MAX_ITEMS: "7" }), 7);',
    'console.log("DEBUG_DEFAULTS_PASS");',
    'assert.equal(itemLimit({ MAX_ITEMS: "0" }), 0, "DEBUG_ZERO_REGRESSION");',
    'console.log("DEBUG_REPRO_PASS");', '',
  ].join('\n'));
  writeFileSync(join(root, debugReview), [
    'import assert from "node:assert/strict";',
    `import { itemLimit } from "./${debugFile}";`,
    'for (const value of [" 0 ", "0.0", "00"]) assert.equal(itemLimit({ MAX_ITEMS: value }), 0);',
    'assert.equal(itemLimit({ MAX_ITEMS: "  " }), 10);',
    'assert.equal(itemLimit({ MAX_ITEMS: "3.5" }), 3.5);',
    'console.log("DEBUG_REVIEW_PASS");', '',
  ].join('\n'));
  git('add', '--', debugFile, debugTest, debugReview);
  git('commit', '-qm', 'Add a reproducible zero limit regression');
  return git('rev-parse', 'HEAD').toString().trim();
}

function verifyDebugCommand(commands, name, code, marker) {
  const command = commands.find(item => item.check === name && item.exitCode === code && item.output.includes(marker));
  assert.ok(command, `Missing executed ${name} with exit ${code} and ${marker}: ${JSON.stringify(commands)}`);
  return command;
}

async function odysseyDebug(run, session, sourceCommit) {
  const links = [
    ...entryLinks(...run.skill_required_links, 'references/odyssey-debug.codex.md'),
    { from: 'references/odyssey-debug.codex.md', destination: 'odyssey-base-codex.md' },
  ];
  const diagnosis = await host(session, run, links, [
    'Execute the archaeology, discovery and diagnosis phases of the loaded Odyssey Debug workflow on this small repository.',
    'Call debug_fixture check once with check=archaeology and once with check=reproduce. Inspect the supplied source snapshot.',
    'Test two plausible hypotheses about the bug. Use the actual command output for their disposition.',
    'Return {rootCause, anchor, hypotheses}, where anchor is project-relative file:line and the hypotheses array has {hypothesis, result, observation}.',
    'Use result confirmed for the single root cause and disproved for the other hypothesis.',
  ].join(' '), { issue: debugIssue, filename: debugFile, source: readFileSync(join(root, debugFile), 'utf8') }, { debugPhase: 'diagnosis' });
  const before = verifyDebugCommand(diagnosis.commands, 'reproduce', 1, 'DEBUG_ZERO_REGRESSION');
  assert.ok(before.output.includes('DEBUG_DEFAULTS_PASS'));
  verifyDebugCommand(diagnosis.commands, 'archaeology', 0, sourceCommit.slice(0, 7));
  assert.match(diagnosis.answer.anchor, /^debug-limits\.mjs:2$/);
  assert.deepEqual(diagnosis.answer.hypotheses.map(item => item.result).sort(), ['confirmed', 'disproved']);
  assert.ok(diagnosis.answer.hypotheses.every(item => item.observation.trim()));
  const meta = { kind: 'session', schema: 'session/1.0', role: 'primary', alias: 'debug-session' };
  const checkpoint = { _meta: meta, issue: debugIssue, current_state: 'S_FIX', root_cause: diagnosis.answer,
    phase_goals: [{ id: 'G1', status: 'done' }, { id: 'G2', status: 'done' }, { id: 'G3', status: 'pending' }] };
  const evidencePath = join(run.run_dir, 'outputs', 'evidence.ndjson');
  const initialEvidence = [
    { _meta: { kind: 'evidence', schema: 'evidence/1.0', role: 'evidence', alias: 'debug-evidence' },
      phase: 'archaeology', sha: sourceCommit, relevance: 'Introduced the original limit parser and failing reproduction' },
    { phase: 'explore', category: 'call_chain', detail: `${debugFile}:2 converts MAX_ITEMS for itemLimit` },
    ...diagnosis.answer.hypotheses.map(item => ({ phase: 'diagnosis', ...item, reproduction: before })),
  ].map(item => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(evidencePath, initialEvidence);
  save(run, 'session.json', checkpoint);

  const resumed = cli(session, 'run', 'brief', run.run_id);
  assert.equal(resumed.task.command, 'odyssey-debug');
  assert.deepEqual(resumed.skill_ref, run.skill_ref);
  const repair = await host(session, resumed, links, [
    'Call debug_fixture check with check=checkpoint to read the saved domain state and resume that phase.',
    `Use debug_fixture replace_source to apply your fix. Pass before with the provided source and after with your completed implementation. Treat numeric zero including "0.0" as a valid limit.`,
    'Call debug_fixture check with check=verify after editing. Return {resumedFrom, changedFile, verification} where verification is the observed final marker.',
  ].join(' '), { issue: debugIssue, source: readFileSync(join(root, debugFile), 'utf8') }, { debugPhase: 'repair' });
  assert.equal(repair.edits.filter(edit => edit.status === 'completed' && !edit.result?.isError).length, 1, JSON.stringify(repair.edits));
  assert.equal(repair.answer.resumedFrom, 'S_FIX');
  assert.equal(repair.answer.changedFile, debugFile, JSON.stringify(repair));
  assert.equal(repair.answer.verification, 'DEBUG_REPRO_PASS');
  verifyDebugCommand(repair.commands, 'checkpoint', 0, '"S_FIX"');
  const after = verifyDebugCommand(repair.commands, 'verify', 0, 'DEBUG_REPRO_PASS');
  const diff = git('diff', '--', debugFile).toString();
  assert.ok(diff.includes(`a/${debugFile}`) && diff.includes(`b/${debugFile}`));
  assert.equal(git('diff', '--name-only', 'HEAD').toString().trim(), debugFile);

  const confirmed = await host(session, resumed, links, [
    'Act as the independent review for the Odyssey Debug CONFIRM phase. Call debug_fixture check with check=diff and check=review.',
    'Assess missing, blank, numeric zero and non-zero behavior.',
    'Check for plausible siblings of this failure using text, semantic and structural checks in this small app.',
    'Return {verdict, findings, regressionRisk, generalization}, with generalization an object with syntax, semantic, structural summaries.',
    'Use verdict confirmed only if evidence supports it. findings contains actionable issues only.',
  ].join(' '), { issue: debugIssue, filename: debugFile, source: readFileSync(join(root, debugFile), 'utf8') }, { debugPhase: 'review' });
  verifyDebugCommand(confirmed.commands, 'diff', 0, `a/${debugFile}`);
  const independentlyChecked = verifyDebugCommand(confirmed.commands, 'review', 0, 'DEBUG_REVIEW_PASS');
  assert.equal(confirmed.answer.verdict, 'confirmed');
  assert.deepEqual(confirmed.answer.findings, []);
  for (const layer of ['syntax', 'semantic', 'structural']) assert.ok(confirmed.answer.generalization[layer].trim());
  git('add', '--', debugFile);
  git('commit', '-qm', 'Repair the zero limit in the debug fixture');
  const fixCommit = git('rev-parse', 'HEAD').toString().trim();
  const evidence = [
    { phase: 'fix', commit: fixCommit, command: after },
    { phase: 'confirmation', execution: independentlyChecked, verdict: confirmed.answer.verdict },
    { phase: 'discovery', generalization: confirmed.answer.generalization },
  ];
  appendFileSync(evidencePath, `${evidence.map(item => JSON.stringify(item)).join('\n')}\n`);
  assert.ok(readFileSync(evidencePath, 'utf8').startsWith(initialEvidence));
  save(run, 'explore.json', {
    _meta: { kind: 'exploration', schema: 'exploration/1.0', role: 'evidence', alias: 'debug-explore' },
    call_chains: [diagnosis.answer.anchor], recent_changes: [sourceCommit], error_gaps: [],
    similar_patterns: confirmed.answer.generalization, cli_tool: 'codex', timestamp: new Date().toISOString(),
  });
  save(run, 'session.json', { ...checkpoint, current_state: 'END', fix_commit: fixCommit,
    phase_goals: checkpoint.phase_goals.map(item => ({ ...item, status: 'done' })),
    confirmation: { test_result: repair.answer.verification, cli_review: confirmed.answer, overall: 'confirmed' } });
  const sections = [
    ['Issue & Scope', debugIssue], ['Archaeology', sourceCommit], ['Exploration', diagnosis.answer.anchor],
    ['Hypotheses', diagnosis.answer.hypotheses.map(item => `${item.hypothesis} (${item.result})`).join('\n\n')],
    ['Root Cause', diagnosis.answer.rootCause], ['Fix & Confirmation', `${fixCommit}\n\n${after.output.trim()}\n\n${independentlyChecked.output.trim()}`],
    ['Generalization', Object.entries(confirmed.answer.generalization).map(([key, value]) => `${key} — ${value}`).join('\n\n')],
    ['Discoveries', 'Independent review reported no actionable findings for this fixture.'], ['Learnings', 'The fixture has local execution evidence.'],
  ];
  writeFileSync(join(run.run_dir, 'outputs', 'understanding.md'),
    `---\nkind: diagnosis-report\nschema: diagnosis-report/1.0\nrole: primary\nalias: debug-understanding\n---\n\n${sections.map(([title, body]) => `## ${title}\n\n${body}`).join('\n\n')}\n`);
  const publication = seal(session, run, 'Reproduced the zero limit regression, repaired it and independently verified numeric zero variants');
  for (const [alias, kind] of Object.entries({ 'debug-session': 'session', 'debug-evidence': 'evidence',
    'debug-explore': 'exploration', 'debug-understanding': 'diagnosis-report' })) {
    const artifact = publication.artifacts[publication.aliases[alias]];
    assert.equal(artifact?.kind, kind);
    assert.equal(artifact?.status, 'sealed');
  }
  console.log('Codex reproduced Odyssey Debug, resumed into an applied repair, ran an independent review, and sealed four artifacts.');
}

async function swarm(run, session) {
  let client;
  async function reconnect() {
    await client?.close();
    client = new Client({ name: 'campaign-fixture', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [maestroServer],
      cwd: root, env: teamEnv, stderr: 'inherit' }));
  }
  try {
    await reconnect();
    await swarmCampaign(run, session, (...args) => client.callTool(...args), reconnect);
  } finally {
    await client?.close();
  }
}

async function swarmCampaign(run, session, callTool, reconnect) {
  async function native(name, args) {
    const reply = await callTool({ name, arguments: { session_id: run.run_id, ...args } });
    assert.ok(!reply.isError, JSON.stringify(reply));
    return JSON.parse(reply.content[0].text);
  }

  async function finishedMembers(roles) {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const { members } = await native('team_agent', { operation: 'members' });
      const selected = members.filter(member => roles.includes(member.role));
      const unsuccessful = selected.find(member => ['failed', 'cancelled'].includes(member.job_status));
      if (unsuccessful) {
        const history = join(env.MAESTRO_HOME, 'cli-history', `${unsuccessful.exec_id}.jsonl`);
        throw new Error(`Swarm member ${unsuccessful.role} ${unsuccessful.job_status}\n${existsSync(history) ? readFileSync(history, 'utf8').slice(-3500) : ''}`);
      }
      if (selected.length === roles.length && selected.every(member => member.job_status === 'completed')) return selected;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Swarm members: ${JSON.stringify(selected)}`);
      await delay(1_000);
    }
  }

  const controller = join(run.run_dir, 'work', 'controller');
  const state = join(run.run_dir, 'work', 'team');
  mkdirSync(controller, { recursive: true });
  mkdirSync(state, { recursive: true });
  const bundled = file => git('show', `${run.skill_ref.commit}:${run.skill_ref.package_path}/${file}`);
  for (const file of ['aco.py', 'pheromone.py', 'scoring.py']) writeFileSync(join(controller, file), bundled(`scripts/${file}`));
  const config = JSON.parse(bundled('specs/swarm-config-template.json'));
  config.swarm.n_ants = 2;
  config.swarm.max_iterations = 2;
  config.convergence.max_iterations = 2;
  for (const name of ['entropy_floor', 'stagnation', 'target_score']) config.convergence[name].enabled = false;
  config.scoring.mode = 'llm';
  config.scoring.rubric = 'For each ant, award 0.8 if its conclusion identifies limit-b.mjs and cites line 1 of both files; otherwise award 0.2. Apply the same threshold to each ant.';
  config.task_space.nodes = ['limit-a.mjs', 'limit-b.mjs'];
  config.task_space.max_path_length = 2;
  config.ant_prompt.objective = 'Find the source file declaring the larger limit.';
  writeFileSync(join(state, 'swarm-config.json'), JSON.stringify(config));
  const sourceSnapshots = Object.fromEntries(['limit-a.mjs', 'limit-b.mjs'].map(file =>
    [file, readFileSync(join(root, file), 'utf8')]));
  const aco = (...args) => JSON.parse(execFileSync(process.env.PYTHON || 'python', [
    '-B', join(controller, 'aco.py'), '--session', state, '--run-dir', run.run_dir, ...args,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
  assert.equal(aco('init').status, 'ok');
  const readSkill = `Use maestro_run run_skill_read with session_id=${session}, run_id=${run.run_id}. Open the entry with these IDs, then use from=SKILL.md and link for each destination.`;
  const allAnts = [];
  let brief = run;
  for (const iteration of [1, 2]) {
    const result = await iterationWithScorer(iteration);
    allAnts.push(...result.ants);
    brief = result.brief;
  }
  const report = aco('report');
  assert.equal(report.iterations_completed, 2);
  assert.deepEqual(report.convergence_curve.map(item => item.iteration), [1, 2]);
  assert.equal(report.top_k.length, 4);
  assert.ok(report.top_k.every(item => item.source === 'verified_llm'));
  save(run, 'swarm-report.json', report);
  const synthesis = await host(session, brief, [
    ...entryLinks(...brief.skill_required_links, 'roles/analyst/role.md'),
    { from: 'roles/coordinator/role.md', destination: 'commands/converge.md' },
  ], 'Synthesize the winner. Return {file, value, evidence, iteration, phase}. Take iteration and phase from the coordinator state returned by team_msg. Use the controller report and the source evidence.',
  { report, source: 'limit-b.mjs:1 export const limit = 3;', ants: allAnts }, { calls: [
    { operation: 'get_state', role: 'coordinator' },
    { operation: 'list', to: 'coordinator', type: 'task_complete' },
  ] });
  assert.equal(synthesis.file, 'limit-b.mjs');
  assert.ok(synthesis.value === 3 || /(?:^|\D)3(?:\D|$)/.test(String(synthesis.value)));
  assert.equal(synthesis.iteration, 2);
  assert.equal(synthesis.phase, 'converged');
  assert.ok(JSON.stringify(synthesis.evidence).includes('limit-b.mjs:1'));
  writeFileSync(join(run.run_dir, 'outputs', 'best-solution.md'),
    `---\nkind: swarm-best-solution\nschema: swarm-best-solution/1.0\nrole: primary\n---\n# Swarm result\n\n${synthesis.file} declares limit ${synthesis.value}. Evidence ${JSON.stringify(synthesis.evidence)}.\n`);
  const publication = seal(session, run, 'Swarm converged after two verified scoring rounds',
    ['references/mcp-coordination.md', 'roles/ant/role.md', 'roles/scorer/role.md', 'specs/ant-output-schema.md']);
  const artifacts = Object.values(publication.artifacts);
  assert.ok(artifacts.every(item => item.status === 'sealed'));
  assert.deepEqual(artifacts.map(item => item.kind).sort(), [
    ...Array(4).fill('swarm-ant-result'), 'swarm-best-solution', 'swarm-report',
  ]);
  assert.equal(existsSync(join(root, '.workflow', '.team', run.run_id)), false);
  console.log('Codex Swarm completed two recovered batches with independent scorer jobs and sealed six artifacts.');

  async function dispatch(orders, links) {
    const roles = orders.map(order => order.role);
    await host(session, run, [...entryLinks(...run.skill_required_links, 'references/mcp-coordination.md'), ...links],
      'Dispatch the supplied assignments first, then wait for the listed roles. Return {} after the tool receipts.', {},
      { calls: [...orders, { operation: 'wait', roles, timeout_ms: 110_000 }], tool: 'team_agent', allowRetries: true });
    await reconnect();
    return finishedMembers(roles);
  }

  async function iterationWithScorer(iteration) {
    const iterationArg = String(iteration);
    const selected = aco('select', '--iter', iterationArg);
    const { assignments } = selected;
    assert.equal(assignments.length, 2);
    await native('team_msg', { operation: 'log', from: 'coordinator', type: 'state_update',
      data: { iteration, n_ants: assignments.length, status: 'ants_running' } });
    const tasks = [];
    for (const { ant_id } of assignments) {
      const task = await native('team_task', { operation: 'create', title: ant_id, owner: ant_id });
      await native('team_task', { operation: 'update', task_id: task.id, owner: ant_id, status: 'assigned' });
      await native('team_task', { operation: 'update', task_id: task.id, status: 'in_progress' });
      tasks.push(task);
    }
    const callbacks = assignments.map(({ ant_id }, index) => ({
      operation: 'log', from: ant_id, to: 'coordinator', type: 'task_complete', delivery_method: 'poll',
      summary: `${ant_id} has a result`, data: {
        iteration, ant_id, task_id: tasks[index].id, artifact_path: `outputs/ant-${iteration}-${index + 1}.json`,
      },
    }));
    const spawnAnts = assignments.map((assignment, index) => ({
      operation: 'spawn_agent', tool: 'codex', mode: 'write', role: assignment.ant_id,
      prompt: [
        'Execute one Swarm ant assignment in this temporary workspace. The coordinator owns the Run and completion.',
        readSkill,
        'Read the bound Skill entry, then roles/ant/role.md and specs/ant-output-schema.md from its links.',
        `This bounded fixture contains two one-line source snapshots and has no prior wisdom or sibling tasks. The objective is to find the source file declaring the larger limit. Use these exact snapshots instead of shell access: ${JSON.stringify(sourceSnapshots)}. Use project-relative file:line evidence strings and set candidate_solution.summary to the winning filename.`,
        `Write the ant JSON as UTF-8 without a BOM to ${JSON.stringify(join(run.run_dir, callbacks[index].data.artifact_path))} and re-read it once.`,
        `Immediately report completion with maestro_run team_msg using ${JSON.stringify({ ...callbacks[index], session_id: run.run_id })}. Return only a brief completion notice.`,
        `Assignment: ${JSON.stringify(assignment)}`,
      ].join(' '),
    }));
    await dispatch(spawnAnts, [{ from: 'roles/coordinator/role.md', destination: 'commands/iterate.md' }]);
    assert.deepEqual(aco('select', '--iter', iterationArg), selected);
    const ants = callbacks.map(({ data }) => JSON.parse(readFileSync(join(run.run_dir, data.artifact_path), 'utf8')));
    for (const [index, ant] of ants.entries()) {
      assert.equal(ant.ant_id, assignments[index].ant_id);
      assert.equal(ant.candidate_solution.summary, 'limit-b.mjs');
      assert.ok(ant.evidence.some(anchor => typeof anchor === 'string' && /(?:^|[/\\])limit-b\.mjs:1$/.test(anchor)), JSON.stringify(ant.evidence));
    }
    const inbox = await native('team_msg', { operation: 'read_mailbox', role: 'coordinator' });
    assert.equal(inbox.count, callbacks.length);
    // Interrupt after acknowledging the inbox and before updating the controller.
    await reconnect();
    const brief = cli(session, 'run', 'brief', run.run_id);
    assert.deepEqual(brief.skill_ref, run.skill_ref);
    const dispatchState = await native('team_msg', { operation: 'get_state', role: 'coordinator' });
    assert.equal(dispatchState.state.status, 'ants_running');
    assert.equal(dispatchState.state.iteration, iteration);
    assert.equal((await native('team_msg', { operation: 'read_mailbox', role: 'coordinator' })).count, 0);
    const history = await native('team_msg', { operation: 'list', to: 'coordinator', type: 'task_complete' });
    const current = history.messages.filter(message => message.data.iteration === iteration);
    assert.equal(current.length, callbacks.length);
    assert.ok(current.every(message => message.dispatch_status === 'delivered'));
    assert.equal(new Set(current.map(message => message.id)).size, callbacks.length);
    assert.deepEqual(current.map(message => message.data).sort((a, b) => a.ant_id.localeCompare(b.ant_id)),
      callbacks.map(callback => callback.data).sort((a, b) => a.ant_id.localeCompare(b.ant_id)));
    for (const { data } of current) {
      await native('team_task', { operation: 'update', task_id: data.task_id, status: 'pending_review' });
      await native('team_task', { operation: 'update', task_id: data.task_id, status: 'done' });
    }
    const completed = await native('team_task', { operation: 'list', status: 'done' });
    assert.ok(tasks.every(task => completed.tasks.some(item => item.id === task.id)));
    const scorer = `SCORE-${iteration}`;
    const scoresPath = `work/team/scores/iter-${iteration}-scores.json`;
    const scoreCallback = { operation: 'log', session_id: run.run_id, from: scorer, to: 'coordinator', type: 'scoring_complete',
      delivery_method: 'poll', data: { iteration, artifact_path: scoresPath, n_ants_scored: ants.length } };
    await native('team_msg', { operation: 'log', from: 'coordinator', type: 'state_update',
      data: { status: 'scoring', iteration, scorer } });
    await dispatch([{ operation: 'spawn_agent', tool: 'codex', mode: 'write', role: scorer, prompt: [
      `Score iteration ${iteration} using the bound Skill. ${readSkill}`,
      'Open roles/scorer/role.md and specs/ant-output-schema.md. Use the supplied ant artifact snapshots and do not modify them.',
      `Ant files: ${JSON.stringify(callbacks.map(item => join(run.run_dir, item.data.artifact_path)))}`,
      `Ant artifact snapshots: ${JSON.stringify(ants)}`,
      `Scoring rubric: ${config.scoring.rubric} Fixed rubric ties are valid in this fixture.`,
      `Write the complete llm score JSON with both IDs and each nonempty rationale, UTF-8 without BOM, to ${JSON.stringify(join(run.run_dir, scoresPath))}. Re-read it once.`,
      `Immediately call maestro_run team_msg with ${JSON.stringify(scoreCallback)}, then return a brief completion notice.`,
    ].join(' ') }], [{ from: 'roles/coordinator/role.md', destination: 'commands/iterate.md' }]);
    const scorerState = await native('team_msg', { operation: 'get_state', role: 'coordinator' });
    assert.equal(scorerState.state.status, 'scoring');
    assert.equal(scorerState.state.scorer, scorer);
    const scoreInbox = await native('team_msg', { operation: 'read_mailbox', role: 'coordinator' });
    assert.equal(scoreInbox.count, 1);
    assert.equal(scoreInbox.messages[0].from, scorer);
    assert.equal(scoreInbox.messages[0].type, 'scoring_complete');
    assert.deepEqual(scoreInbox.messages[0].data, scoreCallback.data);
    const scores = JSON.parse(readFileSync(join(run.run_dir, scoresPath), 'utf8'));
    assert.deepEqual(Object.keys(scores.scores).sort(), assignments.map(item => item.ant_id).sort());
    assert.ok(Object.values(scores.scores).every(item => item.verified_score === 0.8 && item.rationale.trim()));
    const updated = aco('update', '--iter', iterationArg);
    assert.equal(updated.status, 'ok');
    assert.equal(updated.n_ants_processed, assignments.length);
    const trails = readFileSync(join(state, 'trails', `${iteration}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(trails.length, assignments.length);
    assert.ok(trails.every(trail => trail.source === 'verified_llm'));
    assert.deepEqual(aco('update', '--iter', iterationArg), updated);
    const convergence = aco('converged');
    assert.equal(convergence.iteration, iteration);
    assert.equal(convergence.converged, iteration === 2);
    await native('team_msg', { operation: 'log', from: 'coordinator', type: 'state_update',
      data: { iteration, status: convergence.converged ? 'converged' : 'iteration_complete', best_score: updated.best_score } });
    console.log(`Swarm round ${iteration} recovered and committed both verified scores.`);
    return { ants, brief };
  }
}

try {
  mkdirSync(join(root, '.workflow'));
  mkdirSync(join(root, '.maestro'));
  writeFileSync(join(root, '.maestro', 'cli-tools.json'), JSON.stringify({
    tools: { codex: { enabled: true, primaryModel: process.env.CODEX_REPLAY_MODEL || 'gpt-6-sol', reasoningEffort: 'low', tags: [], type: 'builtin' } },
  }));
  writeFileSync(join(root, 'limit-a.mjs'), 'export const limit = 2;\n');
  writeFileSync(join(root, 'limit-b.mjs'), 'export const limit = 3;\n');
  securityFixture();
  defensiveFixture();
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Campaign fixture');
  git('config', 'user.email', 'campaign@example.invalid');
  writeFileSync(join(root, '.workflow', 'repository.json'), JSON.stringify({
    schema_version: 'repository-identity/1.0', repo_id: repoId, repo_name: 'campaign-fixture', created_at: new Date().toISOString(),
  }));
  const historical = start('historical-review', 'odyssey-review');
  assert.ok(historical.guidance.workflow_hash);
  const legacySwarm = start('historical-swarm', 'team-swarm');
  assert.equal(legacySwarm.skill_ref, undefined);
  assert.deepEqual(cli(undefined, 'skills', 'install', ...packages).skills, packages);
  assert.equal(cli(undefined, 'skills', 'install', ...packages).files_added, 0);
  git('add', '--', 'skills', securityFile, defensiveFile, 'package.json', 'package-lock.json');
  git('commit', '-qm', 'Bind shipped campaign Skills');
  const debugSource = selected.has('debug') ? debugFixture() : undefined;
  const commit = git('rev-parse', 'HEAD').toString().trim();
  env.MAESTRO_PROJECT_SKILLS = packages.join(',');
  const campaigns = [
    { name: 'review', session: 'bound-review', command: 'odyssey-review', runCampaign: odyssey },
    { name: 'debug', session: 'bound-debug', command: 'odyssey-debug', objective: debugIssue,
      runCampaign: (run, session) => odysseyDebug(run, session, debugSource) },
    { name: 'security', session: 'bound-security', command: 'odyssey-security', objective: `Audit ${securityFile} in quick read-only mode`,
      runCampaign: odysseySecurity },
    { name: 'defensive', session: 'bound-defensive', command: 'odyssey-defensive', objective: `Audit ${defensiveFile} in standard read-only mode`,
      runCampaign: odysseyDefensive },
    { name: 'swarm', session: 'bound-swarm', command: 'team-swarm', runCampaign: swarm },
  ].filter(item => selected.has(item.name));
  for (const campaign of campaigns) {
    const run = start(campaign.session, campaign.command, campaign.objective);
    assert.equal(run.skill_ref.commit, commit);
    assert.equal(run.guidance, null);
    campaign.run = run;
  }
  const workflows = ['odyssey-review', 'odyssey-debug', 'odyssey-security', 'odyssey-defensive']
    .map(mode => `skills/maestro-odyssey/references/${mode}.md`);
  for (const workflow of workflows) writeFileSync(join(root, workflow), '# New default for later Runs\n');
  git('add', '--', ...workflows);
  git('commit', '-qm', 'Change Odyssey guidance after dispatch');
  const oldReview = cli('historical-review', 'run', 'brief', historical.run_id);
  assert.equal(oldReview.task.command, 'odyssey-review');
  assert.deepEqual(oldReview.guidance, historical.guidance);
  const results = await Promise.allSettled(campaigns.map(item => item.runCampaign(item.run, item.session)));
  for (const result of results) if (result.status === 'rejected') console.error(result.reason);
  assert.ok(results.every(result => result.status === 'fulfilled'), 'Campaign acceptance failed');
} finally {
  assert.match(realpathSync(root), /[\\/]evolve-codex-campaigns-[a-zA-Z0-9]+$/);
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
