import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const time = '2026-11-15T00:00:00Z';
const row = (type, payload) => JSON.stringify({ timestamp: time, type, payload }) + '\r\n';
const meta = (id, cwd) => row('session_meta', { id, cwd, source: 'cli' });
const event = (type, fields = {}) => row('event_msg', { type, ...fields });
const message = (role, text, phase) => row('response_item', {
  type: 'message', role, phase, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
});
const turn = (text, reply) => event('task_started') + message('user', text) + message('assistant', reply, 'final_answer');

async function runMemoryCli(root, env, args, input, expectedCode = 0) {
  const child = spawn(process.execPath, [cli, '--root', root, ...args], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  const [code] = await once(child, 'close');
  assert.equal(code, expectedCode, stderr + stdout);
  return stdout ? JSON.parse(stdout) : stderr;
}

test('Codex Stop extracts project chat incrementally and historical sync shares its progress', async t => {
  const base = await mkdtemp(join(tmpdir(), 'codex-memory-'));
  const root = join(base, "project's files");
  const cwd = join(root, 'subdirectory');
  const other = join(base, "project's files-other");
  const codexHome = join(base, 'codex');
  const sessions = join(codexHome, 'sessions', '2026', '11', '15');
  const archived = join(codexHome, 'archived_sessions');
  const transcript = join(sessions, 'rollout-2026-11-15-live.jsonl');
  const config = join(root, '.codex', 'hooks.json');
  const requests = [];
  let fail = false;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).messages.at(-1).content;
    requests.push(prompt);
    if (fail) {
      response.writeHead(503).end();
      return;
    }
    const source = prompt.match(/\[(codex:[^\]]+)] \[user]/)?.[1];
    const fact = prompt.match(/remember (\S+)/)?.[1];
    const content = JSON.stringify(fact ? [{ scene_name: 'project', memories: [
      { content: `${fact} project preference (${requests.length})`, source_message_ids: [source] },
    ] }] : []);
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  });
  await Promise.all([cwd, other, sessions, archived, join(root, '.codex')].map(path => mkdir(path, { recursive: true })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = { ...process.env, CODEX_HOME: codexHome, AGENT_MEMORY_LLM_MODEL: 'fixture',
    AGENT_MEMORY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
  delete env.AGENT_MEMORY_LLM_API_KEY;
  const invoke = (...args) => runMemoryCli(root, env, ...args);
  const hook = (payload = {}, code = 0) => invoke(['memory', 'codex-hook'], {
    hook_event_name: 'Stop', session_id: 'live', transcript_path: transcript, cwd, ...payload,
  }, code);
  const search = async (text, session) => (await invoke(['memory', 'search', text, '--session', session])).results;

  const existingHandler = { type: 'command', command: 'independent-hook' };
  await writeFile(config, JSON.stringify({ hooks: { SessionStart: [{ hooks: [existingHandler] }] } }));
  assert.equal((await invoke(['memory', 'codex-install'])).changed, true);
  const installed = JSON.parse(await readFile(config, 'utf8'));
  assert.deepEqual(installed.hooks.SessionStart, [{ hooks: [existingHandler] }]);
  assert.match(installed.hooks.Stop[0].hooks[0].command, /codex-hook/);
  assert.equal((await invoke(['memory', 'codex-install'])).changed, false);

  const reply = message('assistant', '保存了。', 'final_answer');
  await writeFile(transcript, meta('live', cwd) + event('task_started') +
    message('developer', 'INJECTED_CONFIGURATION') + message('assistant', 'UNFINISHED_COMMENT', 'commentary') +
    row('response_item', { type: 'function_call_output', output: 'PRIVATE_TOOL_OUTPUT' }) +
    message('user', 'remember 水力基准') + reply.slice(0, -5));
  await hook();
  assert.equal(requests.length, 0);
  await appendFile(transcript, reply.slice(-5));
  await hook({ session_id: 'wrong' });
  await hook({ cwd: other });
  assert.equal(requests.length, 0);
  await hook();
  await hook();
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0], /INJECTED_CONFIGURATION|UNFINISHED_COMMENT|PRIVATE_TOOL_OUTPUT/);
  const [first] = await search('水力基准', 'live');
  assert.match(first.sourceMessageIds[0], /^codex:live:\d+$/);

  await appendFile(transcript, turn('remember retryable', 'Saved.'));
  fail = true;
  assert.match(await hook({}, 1), /HTTP 503/);
  assert.deepEqual(await search('retryable', 'live'), []);
  fail = false;
  await Promise.all([hook(), hook()]);
  assert.equal((await search('retryable', 'live')).length, 1);

  await appendFile(transcript, turn('Nothing to remember here', 'No preference.'));
  await hook();
  const requestCount = requests.length;
  await hook();
  assert.equal(requests.length, requestCount);

  await writeFile(join(archived, 'rollout-2026-11-15-history.jsonl'), meta('history', root) +
    event('task_started') + message('user', 'remember archived') + message('assistant', 'Legacy reply') +
    event('task_complete', { last_agent_message: 'Legacy reply' }));
  await writeFile(join(archived, 'rollout-2026-11-15-unrelated.jsonl'), meta('unrelated', other) + turn('remember unrelated', 'Saved.'));
  assert.deepEqual(await invoke(['memory', 'codex-sync', '--session', 'history']), {
    sessions: 1, processed: 1, remembered: 1, failures: [],
  });
  assert.deepEqual(await invoke(['memory', 'codex-sync']), { sessions: 2, processed: 0, remembered: 0, failures: [] });
  assert.equal((await search('archived', 'history')).length, 1);
  assert.deepEqual(await search('unrelated', 'unrelated'), []);
});

test('Memory configuration enables all project hosts and shared sync imports Claude and Agy histories', async t => {
  const base = await mkdtemp(join(tmpdir(), 'memory-hosts-'));
  const root = join(base, 'project');
  const other = join(base, 'other');
  const claudeHome = join(base, 'claude-home');
  const claudeFolder = join(claudeHome, 'projects', 'encoded-project');
  const agyHome = join(base, '.gemini', 'antigravity-cli');
  const agyFolder = join(agyHome, 'brain', 'agy-session', '.system_generated', 'logs');
  const claudePath = join(claudeFolder, 'claude-session.jsonl');
  const agyPath = join(agyFolder, 'transcript.jsonl');
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const prompt = input.messages.at(-1).content;
    requests.push({ prompt, model: input.model });
    const id = prompt.match(/\[((?:claude|agy):[^\]]+)] \[user]/)?.[1];
    const fact = prompt.match(/remember (\w+)/)?.[1];
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify([
      { scene_name: 'project', memories: [{ content: `${fact} preference`, source_message_ids: [id] }] },
    ]) } }] }));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  });
  await Promise.all([other, claudeFolder, agyFolder, join(root, '.claude'), join(root, '.agents')]
    .map(path => mkdir(path, { recursive: true })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = { ...process.env, HOME: base, USERPROFILE: base, CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: join(base, 'codex') };
  for (const key of Object.keys(env)) if (key.startsWith('AGENT_MEMORY_LLM_')) delete env[key];
  const invoke = (...args) => runMemoryCli(root, env, ...args);

  const claudeConfig = join(root, '.claude', 'settings.local.json');
  const agyConfig = join(root, '.agents', 'hooks.json');
  const independentHandler = { type: 'command', command: 'independent-hook' };
  await writeFile(claudeConfig, JSON.stringify({ hooks: { Stop: [{ hooks: [independentHandler] }] }, permissions: { allow: [] } }));
  await writeFile(agyConfig, JSON.stringify({ independent: { Stop: [independentHandler] } }));
  const configured = await invoke(['memory', 'config', '--yes', '--host', 'all', '--base-url',
    `http://127.0.0.1:${server.address().port}/v1`, '--model', 'memory-fixture']);
  assert.equal(configured.model_configured, true);
  assert.deepEqual(configured.hosts.map(item => [item.host, item.configured]), [['codex', true], ['claude', true], ['agy', true]]);
  assert.equal(JSON.parse(await readFile(claudeConfig, 'utf8')).hooks.Stop.length, 2);
  assert.equal(JSON.parse(await readFile(agyConfig, 'utf8'))['evolve-agent-memory'].Stop.length, 1);

  const claude = (type, uuid, content, extra = {}) => JSON.stringify({ type, uuid, cwd: root, sessionId: 'claude-session',
    timestamp: time, message: { role: type, content, ...extra } }) + '\n';
  const agy = (step_index, type, source, content, extra = {}) => JSON.stringify({ step_index, type, source, content,
    status: 'DONE', created_at: time, ...extra }) + '\n';
  const text = content => [{ type: 'text', text: content }];
  await writeFile(claudePath, claude('user', 'u1', 'remember claude') +
    claude('assistant', 'tool', [{ type: 'text', text: 'IGNORE_TOOL_CHAT' }, { type: 'tool_use' }], { stop_reason: 'tool_use' }) +
    claude('user', 'result', [{ type: 'tool_result', content: 'PRIVATE_TOOL_RESULT' }]) +
    claude('assistant', 'a1', text('confirmed'), { id: 'final', stop_reason: null }) +
    claude('assistant', 'a2', text('second block'), { id: 'final', stop_reason: 'end_turn' }));
  const firstAgyTurn = agy(0, 'USER_INPUT', 'USER_EXPLICIT', 'remember agy') +
    agy(2, 'PLANNER_RESPONSE', 'MODEL', 'IGNORE_TOOL_CHAT', { tool_calls: [{}] }) +
    agy(3, 'PLANNER_RESPONSE', 'MODEL', 'confirmed');
  await writeFile(agyPath, firstAgyTurn);
  const db = new DatabaseSync(join(agyHome, 'conversation_summaries.db'));
  db.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, workspace_uris TEXT, parent_conversation_id TEXT)');
  db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('agy-session', JSON.stringify([pathToFileURL(root).href]), '');
  db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?)').run('unrelated', JSON.stringify([pathToFileURL(other).href]), '');
  db.close();

  const initial = await invoke(['memory', 'sync']);
  assert.deepEqual(initial.hosts.map(item => [item.host, item.sessions, item.processed, item.remembered]),
    [['codex', 0, 0, 0], ['claude', 1, 1, 1], ['agy', 1, 1, 1]]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].prompt, /second block/);
  assert.doesNotMatch(requests.map(request => request.prompt).join('\n'), /IGNORE_TOOL_CHAT|PRIVATE_TOOL_RESULT/);
  assert.ok(requests.every(request => request.model === 'memory-fixture'));

  await appendFile(claudePath, claude('user', 'u2', 'remember claudenew') + claude('assistant', 'a3', text('confirmed'), { stop_reason: 'end_turn' }));
  await writeFile(agyPath, '  ' + firstAgyTurn + agy(4, 'USER_INPUT', 'USER_EXPLICIT', 'remember agynew') +
    agy(5, 'PLANNER_RESPONSE', 'MODEL', 'confirmed'));
  const claudeEvent = { hook_event_name: 'Stop', session_id: 'claude-session', cwd: root, transcript_path: claudePath };
  const agyEvent = { terminationReason: 'model_stop', conversationId: 'agy-session', workspacePaths: [root], transcriptPath: agyPath };
  assert.deepEqual(await invoke(['memory', 'host-hook', '--host', 'claude'], { ...claudeEvent, cwd: other }), {});
  assert.deepEqual(await invoke(['memory', 'host-hook', '--host', 'agy'], { ...agyEvent, workspacePaths: [other] }), { decision: 'stop' });
  assert.equal(requests.length, 2);
  await invoke(['memory', 'host-hook', '--host', 'claude'], claudeEvent);
  await invoke(['memory', 'host-hook', '--host', 'agy'], { ...agyEvent, cwd: root, workspacePaths: [] });
  const repeated = await invoke(['memory', 'sync', '--host', 'claude,agy']);
  assert.deepEqual(repeated.hosts.map(item => item.processed), [0, 0]);
  const [agyMemory] = (await invoke(['memory', 'search', 'agynew', '--session', 'agy-session'])).results;
  assert.deepEqual(agyMemory.sourceMessageIds, ['agy:agy-session:4']);
  const [claudeMemory] = (await invoke(['memory', 'search', 'claudenew', '--session', 'claude-session'])).results;
  assert.deepEqual(claudeMemory.sourceMessageIds, ['claude:claude-session:u2']);

  const off = await invoke(['memory', 'config', '--yes', '--host', 'off']);
  assert.ok(off.hosts.every(item => !item.configured));
  assert.deepEqual(JSON.parse(await readFile(claudeConfig, 'utf8')), { hooks: { Stop: [{ hooks: [independentHandler] }] }, permissions: { allow: [] } });
  assert.deepEqual(JSON.parse(await readFile(agyConfig, 'utf8')), { independent: { Stop: [independentHandler] } });
});
