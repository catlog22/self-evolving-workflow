import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const time = '2026-11-15T00:00:00Z';
const row = (type, payload) => JSON.stringify({ timestamp: time, type, payload }) + '\r\n';
const meta = (id, cwd) => row('session_meta', { id, cwd, source: 'cli' });
const event = (type, fields = {}) => row('event_msg', { type, ...fields });
const message = (role, text, phase) => row('response_item', {
  type: 'message', role, phase, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
});
const turn = (text, reply) => event('task_started') + message('user', text) + message('assistant', reply, 'final_answer');

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
  async function invoke(args, input, expectedCode = 0) {
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
