import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { InputError, requireText } from './common.js';
import { MemoryStore } from './memory.js';
import { WorkflowStore } from './workflow-runtime.js';

const text = { type: 'string' };
function definition(name: string, description: string, properties: object, required: string[] = []) {
  return { name, description, annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

const tools = [
  definition('read_skill', 'Open the committed Skill entry. Use from and destination for a declared Markdown link.', { from: text, destination: text }),
  definition('read_artifact', 'Read the sealed bytes of a bound Run input by alias or artifact ID.', { id: text }, ['id']),
  definition('memory_search', 'Search the local Agent Memory store and record the search for this Run.', { query: text }, ['query']),
  definition('memory_get', 'Read the exact Memory record selected from this Run’s search results.', { id: text }, ['id']),
];

export async function serveWorkflowRun(store: WorkflowStore, session: string, run: string, db?: string) {
  store.brief(session, run);
  const memory = new MemoryStore(db ?? join(store.root, '.agent-memory', 'memory.db'));
  try {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      const req = JSON.parse(line);
      if (req.id === undefined) continue;
      let value: unknown;
      try {
        switch (req.method) {
          case 'initialize': value = {
            protocolVersion: req.params.protocolVersion, capabilities: { tools: {} },
            serverInfo: { name: 'evolve-workflow', version: '1.0.0' },
          }; break;
          case 'ping': value = {}; break;
          case 'tools/list': value = { tools }; break;
          case 'tools/call': {
            const { name, arguments: args = {} } = req.params;
            let result: unknown;
            switch (name) {
              case 'read_skill':
                result = store.readSkill(session, run, args.from, args.destination);
                break;
              case 'read_artifact':
                result = store.readArtifact(session, run, requireText(args.id, 'artifact ID'));
                break;
              case 'memory_search': {
                const query = requireText(args.query, 'search query');
                const found = await memory.search(query);
                const trace = store.recordKnowledge(session, run, receipt => receipt.recordSearch({
                  source: 'memory', query, returnedIds: found.results.map(item => item.id),
                }));
                result = { ...found, search_id: trace.searches.at(-1)?.search_id };
                break;
              }
              case 'memory_get': {
                const id = requireText(args.id, 'memory ID');
                const item = memory.get(id);
                if (!item) throw new InputError('Memory is unavailable: ' + id);
                store.recordKnowledge(session, run, receipt => {
                  const search = receipt.toJSON().searches.findLast(item => item.returned_ids.includes(id));
                  if (!search) throw new InputError('Select an ID from this Run’s search results');
                  receipt.recordRead({ kind: 'memory', id, fromSearchId: search.search_id, content: item.content, version: item.version });
                });
                result = item;
                break;
              }
              default: throw new InputError('Unknown workflow tool: ' + name);
            }
            value = { content: [{ type: 'text', text: JSON.stringify(result) }] };
            break;
          }
          default:
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
            continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (req.method !== 'tools/call') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message } }) + '\n');
          continue;
        }
        value = { isError: true, content: [{ type: 'text', text: message }] };
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: value }) + '\n');
    }
  } finally {
    memory.close();
  }
}
