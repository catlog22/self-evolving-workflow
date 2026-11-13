import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const [maestro, root, session, run] = process.argv.slice(2);
const tool = {
  name: 'read_skill',
  description: 'Read the bound Skill entry with no arguments. To follow a declared Markdown link, supply its destination and the source document path.',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: { destination: { type: 'string' }, from: { type: 'string' } },
    additionalProperties: false,
  },
};

function result(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'evolve-replay', version: '1.0.0' },
      };
    case 'ping': return {};
    case 'tools/list': return { tools: [tool] };
    case 'tools/call': {
      const { destination, from } = params.arguments ?? {};
      const entry = from === undefined && destination === undefined;
      const link = typeof from === 'string' && typeof destination === 'string' &&
        from.length > 0 && destination.length > 0 && !from.startsWith('-') && !destination.startsWith('-');
      try {
        if (params.name !== tool.name || (!entry && !link)) {
          throw new Error('Provide either no arguments, or a declared destination and its source document.');
        }
        const command = spawnSync(process.execPath, [
          maestro, 'run', 'skill-read', run, ...(link ? [destination, '--from', from] : []),
          '--session', session, '--workflow-root', root, '--json',
        ], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
        if (command.error) throw command.error;
        if (!command.stdout) throw new Error(command.stderr.trim() || 'Maestro returned no read result.');
        const response = JSON.parse(command.stdout);
        if (!response.ok) throw new Error(response.error.message);
        if (!response.result.recorded) throw new Error('No Skill read was recorded.');
        const { path, markdown } = response.result;
        return { content: [{ type: 'text', text: JSON.stringify({ path, markdown }) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    }
    default: return undefined;
  }
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  const value = result(method, params);
  const response = value === undefined ? { error: { code: -32601, message: 'Method not found' } } : { result: value };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...response }) + '\n');
}
