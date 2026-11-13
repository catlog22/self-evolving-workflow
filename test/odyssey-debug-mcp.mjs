import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [maestro, root, phase, runId] = process.argv.slice(2);
if (!/[\\/]evolve-codex-campaigns-[a-zA-Z0-9]+$/.test(root)) throw new Error('Expected isolated campaign fixture');
const requireMaestro = createRequire(maestro);
const { Server } = requireMaestro('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = requireMaestro('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = requireMaestro('@modelcontextprotocol/sdk/types.js');
const nodeTest = filename => [process.execPath, '--permission', `--allow-fs-read=${root}`, filename];
const checks = {
  diagnosis: {
    archaeology: ['git', 'log', '--oneline', '-1', '--', 'debug-limits.mjs'],
    reproduce: nodeTest('debug-limits.test.mjs'),
  },
  repair: { checkpoint: null, verify: nodeTest('debug-limits.test.mjs') },
  review: {
    diff: ['git', 'diff', '--', 'debug-limits.mjs'],
    review: nodeTest('debug-limits.review.mjs'),
  },
}[phase];
if (!checks) throw new Error('Unknown debug fixture phase');

const server = new Server({ name: 'odyssey-debug-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
const checkTool = {
  name: 'check', description: 'Execute one fixed Git or Node check in the isolated Odyssey Debug fixture.',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { type: 'object', properties: { check: { type: 'string', enum: Object.keys(checks) } },
    required: ['check'], additionalProperties: false },
};
const repairTool = {
  name: 'replace_source', description: 'Replace the exact current contents of debug-limits.mjs in the isolated fixture.',
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' } },
    required: ['before', 'after'], additionalProperties: false },
};
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [checkTool, ...(phase === 'repair' ? [repairTool] : [])] }));
server.setRequestHandler(CallToolRequestSchema, request => {
  const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const failure = text => ({ isError: true, content: [{ type: 'text', text }] });
  if (phase === 'repair' && request.params.name === repairTool.name) {
    const { before, after } = request.params.arguments ?? {};
    const path = join(root, 'debug-limits.mjs');
    const original = readFileSync(path, 'utf8');
    if (typeof before !== 'string' || before.trimEnd() !== original.trimEnd() || typeof after !== 'string' ||
      Buffer.byteLength(after) > 2000 || !after.trim() || after.trimEnd() === original.trimEnd()) {
      return failure('Supply the original source and a changed replacement of at most 2000 bytes.');
    }
    writeFileSync(path, `${after.trimEnd()}\n`);
    return response({ changedFile: 'debug-limits.mjs' });
  }
  const check = request.params.arguments?.check;
  if (request.params.name !== 'check' || !Object.hasOwn(checks, check)) {
    return failure('Unknown debug fixture check');
  }
  if (check === 'checkpoint') {
    if (!/^run-[a-z0-9-]+$/.test(runId)) return failure('Invalid debug Run ID');
    const output = readFileSync(join(root, '.workflow', 'sessions', 'bound-debug', 'runs', runId, 'outputs', 'session.json'), 'utf8');
    return response({ check, exitCode: 0, output });
  }
  const [executable, ...args] = checks[check];
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (result.error) return failure(result.error.message);
  return response({ check, exitCode: result.status, output: result.stdout + result.stderr });
});
await server.connect(new StdioServerTransport());
