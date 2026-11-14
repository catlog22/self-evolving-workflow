import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  captureHostTranscript,
  writeHostTranscriptEvidence,
} from 'evolve-agent-memory';
import { readTranscriptSnapshots } from '../dist/transcript-evidence.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('Codex, Agy and Claude transcript adapters produce the same evidence contract', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-host-adapters-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = {
    codex: { type: 'message', id: 'codex-user', role: 'user', content: 'Codex request.' },
    agy: { message: { id: 'agy-user', role: 'user', text: 'Agy request.' } },
    claude: { type: 'assistant', message: { id: 'claude-assistant', role: 'assistant', content: [{ type: 'text', text: 'Claude answer.' }] } },
  };
  for (const [host, fixture] of Object.entries(fixtures)) {
    const source = join(root, `${host}.jsonl`);
    const sessionDirectory = join(root, host);
    const output = join(sessionDirectory, 'transcript-evidence');
    await writeFile(source, `${JSON.stringify(fixture)}\n`);
    const capture = captureHostTranscript({
      hostKind: host,
      session: `${host}-session`,
      source,
      capturedAt: '2026-11-14T00:00:00Z',
    });
    assert.equal(capture.messages.length, 1);
    assert.match(capture.refs[0], new RegExp(`^transcript:${host}:${host}-session:`));
    writeHostTranscriptEvidence(output, capture);
    const messages = readTranscriptSnapshots(sessionDirectory, capture.refs);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, fixture.message?.content?.[0]?.text ?? fixture.message?.text ?? fixture.content);
  }
});

test('CLI transcript capture writes normalized evidence files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-host-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'codex.jsonl');
  const output = join(root, 'evidence');
  await writeFile(source, JSON.stringify({ type: 'message', id: 'turn-1', role: 'assistant', content: 'Done.' }) + '\n');
  const { stdout } = await run(process.execPath, [cli, '--root', root, 'transcript', 'capture', 'codex', source,
    '--session', 'codex-session', '--output', output, '--captured-at', '2026-11-14T00:00:00Z']);
  const result = JSON.parse(stdout);
  assert.equal(result.messages, 1);
  assert.equal(result.refs.length, 1);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0], /[0-9a-f]{64}-[0-9a-f]{16}\.json$/);
});
