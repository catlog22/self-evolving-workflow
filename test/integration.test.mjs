import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CodeGraph, MemoryStore, Wiki, createSearchServer, search } from 'evolve-agent-memory';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

async function temp(t, close = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-'));
  t.after(async () => {
    await close();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function cliJson(root, ...args) {
  const { stdout } = await run(process.execPath, [cli, '--root', root, ...args], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

test('CodeGraph indexes real TypeScript, resolves call edges, and syncs edits', async t => {
  const root = await temp(t);
  const path = join(root, 'billing.ts');
  await writeFile(path, 'export function computeTax(value: number) { return value * .06; }\nexport function invoiceTotal(value: number) { return value + computeTax(value); }\n');
  const stats = await cliJson(root, 'code', 'build');
  assert.equal(stats.filesErrored, 0);
  const [tax] = await cliJson(root, 'code', 'search', 'computeTax');
  assert.equal(tax.node.name, 'computeTax');
  assert.equal(tax.node.filePath, 'billing.ts');
  const graph = new CodeGraph(root);
  const [{ node: invoice }] = await graph.neighbors(tax.node.id, 'callers');
  assert.equal(invoice.name, 'invoiceTotal');
  assert.equal((await graph.neighbors(invoice.id, 'callees'))[0].node.id, tax.node.id);
  assert.deepEqual((await graph.trace(invoice.id, tax.node.id, ['calls'])).map(step => step.node.id), [invoice.id, tax.node.id]);
  await writeFile(path, 'export function newBillingTotal() { return 42; }\n');
  await graph.sync();
  assert.equal((await graph.search('newBillingTotal'))[0].node.name, 'newBillingTotal');
  assert.equal((await graph.search('computeTax')).some(hit => hit.node.name === 'computeTax'), false);
  await rm(path);
  assert.equal((await graph.build()).fileCount, 0);
  assert.deepEqual(await graph.search('newBillingTotal'), []);
});

test('Wiki searches CRLF Chinese Markdown, follows links, and removes stale pages', async t => {
  const root = await temp(t);
  await mkdir(join(root, 'wiki', 'concepts'), { recursive: true });
  await writeFile(join(root, 'wiki', 'concepts', 'pump.md'), [
    '---', 'type: concept', 'title: 冷却回路', 'sources: [notes.md]', '---', '', '测试回路压力。[[Heat Exchanger#Design|换热器]]',
  ].join('\r\n'));
  const exchanger = join(root, 'wiki', 'exchanger.md');
  await writeFile(exchanger, '# Heat Exchanger\n\nUses a plate assembly. [[concepts/pump]]\n');
  const wiki = new Wiki(root);
  assert.deepEqual(await cliJson(root, 'wiki', 'build'), { pages: 2, edges: 2 });
  const { results, links } = await cliJson(root, 'wiki', 'search', '回路压力', '--hop', '1');
  assert.equal(results[0].path, 'wiki/concepts/pump.md');
  assert.deepEqual(results[0].sources, ['notes.md']);
  assert.equal(results[0].related[0].direction, 'both');
  assert.equal(results[1].via, '冷却回路');
  assert.equal(results[1].hop, 1);
  assert.equal(links.length, 2);
  await rm(exchanger);
  assert.deepEqual(wiki.build(), { pages: 1, edges: 0 });
  assert.equal(wiki.search('回路压力', { hop: 1 }).results.length, 1);
});

test('managed Wiki entries resolve active scopes independently of search and preserve history', async t => {
  const root = await temp(t);
  const directory = join(root, 'wiki', 'entries');
  await mkdir(directory, { recursive: true });
  const entry = (title, mode, status, scope, aliases = []) => [
    '---', `title: ${title}`, `mode: ${mode}`, `status: ${status}`, `scope: ${JSON.stringify(scope)}`,
    'sources: [receipt-1]', `aliases: ${JSON.stringify(aliases)}`, '---',
    'Calibration preflight. [[entries/retired]]',
  ].join('\n');
  await writeFile(join(directory, 'required.md'), entry('Calibration', 'constraint', 'active', ['skill:analyze'], ['legacy:spec:S-42']));
  await writeFile(join(directory, 'retired.md'), entry('Old calibration', 'constraint', 'deprecated', ['project']));
  await writeFile(join(directory, 'reference.md'), entry('Calibration notes', 'reference', 'active', ['project']));
  const wiki = new Wiki(root);
  assert.deepEqual(wiki.constraints(), []);
  assert.deepEqual((await cliJson(root, 'wiki', 'constraints', '--skill', 'analyze')).map(page => page.id), ['entries/required']);
  assert.equal(wiki.getEntry('legacy:spec:S-42').id, 'entries/required');
  assert.equal(wiki.getEntry('retired').entry.status, 'deprecated');
  wiki.build();
  assert.equal(wiki.search('calibration', { hop: 1 }).results.some(hit => hit.id === 'entries/retired'), false);
  assert.equal(wiki.search('calibration', { includeHistory: true }).results.some(hit => hit.id === 'entries/retired'), true);
});

test('Wiki ingest preserves source attribution and locked pages', async t => {
  const root = await temp(t);
  const source = join(root, 'notes.md');
  await writeFile(source, 'The storage controller holds the calibration.');
  const wiki = new Wiki(root);
  const candidate = [
    '<<<FILE path="wiki/concepts/storage-controller.md">>>',
    '---', 'title: Storage Controller', 'type: concept', '---', '',
    'Retains calibration.', '<<<END>>>',
  ].join('\n');
  const calls = [];
  const llm = { async chat({ label }) {
    calls.push(label);
    return label === 'wiki-analysis' ? 'Create a controller page.' : candidate;
  } };
  const { written } = await wiki.ingest(source, { llm });
  assert.deepEqual(calls, ['wiki-analysis', 'wiki-generate']);
  assert.deepEqual(written, ['wiki/concepts/storage-controller.md']);
  assert.deepEqual(wiki.search('calibration').results[0].sources, ['notes.md']);
  const page = join(root, ...written[0].split('/'));
  const locked = '---\ntitle: Storage Controller\ntype: concept\nlocked: true\n---\n\nHandwritten calibration.\n';
  await writeFile(page, locked);
  assert.deepEqual((await wiki.ingest(source, { llm, mode: 'single-stage' })).written, []);
  assert.equal(await readFile(page, 'utf8'), locked);
});

test('Memory persists scoped records and fuses keyword and vector rankings', async t => {
  let a, b;
  const root = await temp(t, () => { a?.close(); b?.close(); });
  const db = join(root, 'memory.db');
  a = new MemoryStore(db, { namespace: 'a' });
  b = new MemoryStore(db, { namespace: 'b' });
  const input = { id: 'x', content: '用户偏好使用水力计算', type: 'persona', session: 's1', embedding: [1, 1] };
  await a.put(input);
  assert.equal((await a.put(input)).version, 1);
  await a.put({ id: 'y', content: 'Engineering simulation', type: 'work_fact', embedding: [1, 0] });
  await b.put({ id: 'x', content: '水力计算', type: 'persona', embedding: [1, 1] });
  assert.equal((await a.search('水力计算', { embedding: [1, 0] })).strategy, 'hybrid');
  assert.deepEqual((await a.search('水力计算', { embedding: [1, 0] })).results.map(hit => hit.id), ['x', 'y']);
  assert.deepEqual((await a.search('水力计算', { session: 'wrong' })).results, []);
  assert.equal((await cliJson(root, 'memory', 'search', '水力计算', '--db', db, '--namespace', 'b')).results[0].content, '水力计算');
  assert.equal((await a.put({ ...input, content: 'Updated preference' })).version, 2);
  assert.deepEqual((await a.search('水力计算')).results, []);
  assert.equal(a.delete('x'), true);
  assert.equal(b.get('x').content, '水力计算');
});

test('L1 extraction is traceable and retryable with a supplied model', async t => {
  const memory = new MemoryStore(':memory:');
  t.after(() => memory.close());
  const messages = [{ id: 'm1', role: 'user', timestamp: 0, content: 'Prefer blue charts.' }];
  const llm = { async chat({ prompt }) {
    assert.match(prompt, /\[m1\].*Prefer blue charts/);
    return '<think>[draft]</think>' + JSON.stringify([{
      scene_name: 'Charts',
      memories: [{ content: 'Prefer blue charts.', type: 'persona', source_message_ids: ['m1', 'hallucinated'] }],
    }]);
  } };
  const options = { session: 'charts', llm };
  const [stored] = await memory.extract(messages, options);
  assert.deepEqual(stored.sourceMessageIds, ['m1']);
  assert.deepEqual(await memory.extract(messages, options), [stored]);
  assert.equal((await memory.search('charts', { session: 'charts' })).results[0].id, stored.id);
  await assert.rejects(memory.extract(messages, { ...options, llm: { chat: async () => 'invalid' } }), /JSON array/);
});

test('Shared module API, CLI and HTTP return the same scoped search', async t => {
  let server, memory;
  const root = await temp(t, async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    memory?.close();
  });
  const db = join(root, 'memory.db');
  await writeFile(join(root, 'recall.ts'), 'export function recallEvidence() { return true; }');
  await mkdir(join(root, 'wiki'));
  await writeFile(join(root, 'wiki', 'recall.md'), '# Recall\n\nEvidence for recall.\n');
  await cliJson(root, 'code', 'build');
  await cliJson(root, 'wiki', 'build');
  await cliJson(root, 'memory', 'put', 'recall evidence', '--db', db, '--id', 'test');
  memory = new MemoryStore(db);
  const sources = { code: new CodeGraph(root), wiki: new Wiki(root), memory };
  server = createSearchServer(sources);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/search`;
  const expected = JSON.parse(JSON.stringify(await search(sources, 'recall')));
  assert.deepEqual(await cliJson(root, 'search', 'recall', '--db', db), expected);
  assert.ok(expected.code.length && expected.wiki.results.length && expected.memory.results.length);
  const response = await fetch(url + '?q=recall');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.deepEqual(await (await fetch(url + '?q=recall&scope=memory')).json(), { memory: expected.memory });
  assert.equal((await fetch(url + '?q=recall&limit=-1')).status, 400);
  assert.equal((await fetch(url + '/missing?q=recall')).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('CLI ingestion and memory extraction use an OpenAI-compatible endpoint', async t => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
    const content = [
      'Create a concept.',
      '<<<FILE path="wiki/concepts/fixture.md">>>\n---\ntype: concept\ntitle: Fixture\n---\n\nFixture reference.\n<<<END>>>',
      '[{"scene_name":"Fixture","memories":[{"content":"Fixture preference","type":"persona","source_message_ids":["m1"]}]}]',
    ][requests.length - 1];
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const root = await temp(t, () => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = {
    ...process.env,
    AGENT_MEMORY_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    AGENT_MEMORY_LLM_MODEL: 'fixture-model',
    AGENT_MEMORY_LLM_API_KEY: 'fixture-key',
  };
  const file = join(root, 'source.txt');
  const messages = join(root, 'messages.json');
  await writeFile(file, 'This is a fixture.');
  await writeFile(messages, JSON.stringify([{ id: 'm1', role: 'user', timestamp: 0, content: 'Remember my fixture preference.' }]));
  const invoke = async (...args) => JSON.parse((await run(process.execPath, [cli, '--root', root, ...args], { env })).stdout);
  assert.deepEqual((await invoke('wiki', 'ingest', file)).written, ['wiki/concepts/fixture.md']);
  const [memory] = await invoke('memory', 'extract', messages, '--session', 'fixture');
  assert.equal(memory.content, 'Fixture preference');
  assert.deepEqual(memory.sourceMessageIds, ['m1']);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.path, '/v1/chat/completions');
    assert.equal(request.auth, 'Bearer fixture-key');
    assert.equal(request.body.model, 'fixture-model');
  }
});
