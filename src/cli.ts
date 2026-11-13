#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CodeGraph } from './code.js';
import { InputError, requireText } from './common.js';
import { createSearchServer } from './http.js';
import { MemoryStore, type ConversationMessage } from './memory.js';
import { parseScope, search, type SearchScope, type SearchSources } from './search.js';
import type { LlmClient } from './upstream/llm.js';
import { Wiki } from './wiki.js';

const help = `Usage: agent-memory <command> [options]

  code build|sync                          Build or update the project's code graph
  code search <query>                      Find code symbols
  code callers|callees <symbol-id>         Follow call edges (--depth 1)
  code trace <from-id> <to-id>             Find a path between code symbols
  wiki build                               Index Markdown pages under wiki/
  wiki ingest <file.md|file.txt>            Generate and merge wiki pages
  wiki search <query>                      Search wiki pages (--hop 0)
  wiki get <id>                            Read a Wiki entry, including history
  wiki constraints                         Resolve active constraints (--skill, --task, --path)
  memory put <text>                        Save a memory (--id, --type, --scene, --session, --priority)
  memory extract <messages.json>           Extract L1 memories (--session required, --mode chat|code)
  memory get|delete <id>                   Read or delete a memory
  memory search <query>                    Search memory (--type, --scene, --session)
  search <query>                           Search available indexes (--scope all|code|wiki|memory)
  serve                                    Serve GET /search on 127.0.0.1 (--port 4310)

Options:
  --root <dir>         Code project root and parent of wiki/ (default current directory)
  --wiki-root <dir>    Override the parent of wiki/
  --db <path>          Memory DB (default <root>/.agent-memory/memory.db)
  --namespace <name>   Memory namespace (default default)
  --limit <n>          Maximum results per source (default 10)
  --help               Show this message

Ingest and extract use AGENT_MEMORY_LLM_BASE_URL, AGENT_MEMORY_LLM_MODEL and optional
AGENT_MEMORY_LLM_API_KEY for an OpenAI-compatible chat endpoint. Message files contain
an array of {id, role, timestamp, content}. Commands return JSON on stdout.
`;

const options = {
  root: { type: 'string' },
  'wiki-root': { type: 'string' },
  db: { type: 'string' },
  namespace: { type: 'string' },
  scope: { type: 'string' },
  limit: { type: 'string' },
  depth: { type: 'string' },
  hop: { type: 'string' },
  type: { type: 'string' },
  scene: { type: 'string' },
  session: { type: 'string' },
  id: { type: 'string' },
  priority: { type: 'string' },
  port: { type: 'string' },
  mode: { type: 'string' },
  skill: { type: 'string' },
  task: { type: 'string' },
  path: { type: 'string', multiple: true },
  history: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function modelClient(): LlmClient {
  const url = new URL(requireText(process.env.AGENT_MEMORY_LLM_BASE_URL, 'AGENT_MEMORY_LLM_BASE_URL'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new InputError('LLM endpoint must use HTTP or HTTPS');
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  const model = requireText(process.env.AGENT_MEMORY_LLM_MODEL, 'AGENT_MEMORY_LLM_MODEL');
  const key = process.env.AGENT_MEMORY_LLM_API_KEY;
  return {
    async chat({ system, prompt }) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status})`);
      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      return requireText(data.choices?.[0]?.message?.content, 'LLM response content');
    },
  };
}

async function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  if (values.help || !positionals.length) {
    process.stdout.write(help);
    return;
  }
  const [command, action, ...args] = positionals;
  const root = resolve(values.root ?? '.');
  const wiki = new Wiki(values['wiki-root'] ?? root);
  const db = values.db ?? join(root, '.agent-memory', 'memory.db');
  const openMemory = () => new MemoryStore(db, { namespace: values.namespace });
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  const wikiOptions = { limit, hop: values.hop === undefined ? undefined : Number(values.hop), includeHistory: values.history };
  const memoryOptions = { limit, type: values.type, scene: values.scene, session: values.session };
  const print = (result: unknown) => process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  function sourcesFor(scope: SearchScope): SearchSources {
    return {
      code: scope === 'code' || (scope === 'all' && CodeGraph.hasIndex(root)) ? new CodeGraph(root) : undefined,
      wiki: scope === 'wiki' || (scope === 'all' && existsSync(wiki.indexPath)) ? wiki : undefined,
      memory: scope === 'memory' || (scope === 'all' && (db === ':memory:' || existsSync(db))) ? openMemory() : undefined,
    };
  }

  if (command === 'serve') {
    const port = Number(values.port ?? '4310');
    if (action !== undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
      throw new InputError('Usage: agent-memory serve [--port 0..65535]');
    }
    const sources = sourcesFor(parseScope(values.scope ?? 'all'));
    const server = createSearchServer(sources);
    server.on('searchError', (error: unknown) => console.error(error));
    server.on('close', () => sources.memory?.close());
    server.on('error', error => {
      console.error(error.message);
      process.exitCode = 1;
      server.close();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') print({ url: `http://127.0.0.1:${address.port}/search` });
    });
    return;
  }
  if (command === 'search') {
    const query = requireText([action, ...args].join(' '), 'query');
    const scope = parseScope(values.scope ?? 'all');
    const sources = sourcesFor(scope);
    try {
      print(await search(sources, query, { scope, limit, wiki: wikiOptions, memory: memoryOptions }));
    } finally {
      sources.memory?.close();
    }
    return;
  }
  if (command === 'code') {
    const code = new CodeGraph(root);
    switch (action) {
      case 'build': return print(await code.build());
      case 'sync': return print(await code.sync());
      case 'search': return print(await code.search(args.join(' '), limit));
      case 'callers':
      case 'callees': return print(await code.neighbors(requireText(args[0], 'symbol id'), action, Number(values.depth ?? '1')));
      case 'trace': return print(await code.trace(requireText(args[0], 'from id'), requireText(args[1], 'to id')));
    }
  }
  if (command === 'wiki') {
    switch (action) {
      case 'build': return print(wiki.build());
      case 'search': return print(wiki.search(args.join(' '), wikiOptions));
      case 'get': return print(wiki.getEntry(requireText(args[0], 'wiki entry ID')));
      case 'constraints': return print(wiki.constraints({ skill: values.skill, task: values.task, paths: values.path }));
      case 'ingest': return print(await wiki.ingest(requireText(args[0], 'source file'), { llm: modelClient() }));
    }
  }
  if (command === 'memory' && ['put', 'get', 'delete', 'search', 'extract'].includes(action)) {
    const memory = openMemory();
    try {
      switch (action) {
        case 'put': return print(await memory.put({
          content: args.join(' '), id: values.id, type: values.type, scene: values.scene, session: values.session,
          priority: values.priority === undefined ? undefined : Number(values.priority),
        }));
        case 'get': return print(memory.get(requireText(args[0], 'id')) ?? null);
        case 'delete': return print({ deleted: memory.delete(requireText(args[0], 'id')) });
        case 'search': return print(await memory.search(args.join(' '), memoryOptions));
        case 'extract': {
          const messages: unknown = JSON.parse(readFileSync(requireText(args[0], 'messages file'), 'utf8').replace(/^\uFEFF/, ''));
          if (!Array.isArray(messages)) throw new InputError('Messages file must contain a JSON array');
          const mode = values.mode ?? 'chat';
          if (mode !== 'chat' && mode !== 'code') throw new InputError('mode must be chat or code');
          return print(await memory.extract(messages as ConversationMessage[], {
            session: requireText(values.session, 'session'), mode, llm: modelClient(),
          }));
        }
      }
    } finally {
      memory.close();
    }
  }
  throw new InputError('Unknown command. Run agent-memory --help');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
