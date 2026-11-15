#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CodeGraph } from './code.js';
import { InputError, requireText } from './common.js';
import { createSearchServer } from './http.js';
import { MemoryStore, type ConversationMessage } from './memory.js';
import { context as buildContext, parseScope, search, type SearchScope, type SearchSources } from './search.js';
import type { LlmClient } from './upstream/llm.js';
import { Wiki } from './wiki.js';
import {
  harvestCompletion, publishReference, readCloseoutCandidate, readCompletionReceipts,
  readHarvest, readSkillCompletions, recordSkillCompletion,
} from './closeout.js';
import { reviewSession, reviewSkillExecution } from './retrospective.js';
import { draftSkillAddition } from './skill-addition.js';
import { changeSkillVersion, replaySkillAddition } from './skill-replay.js';
import { migrateLegacyWiki, validateWikiMemberUid } from './wiki-migration.js';
import { isRepositoryId, isWikiCategory, type WikiContext } from './wiki-entry.js';
import { applyWikiChange, listWikiChanges, proposeWikiChange } from './wiki-change.js';
import { KnowledgeReads, validateKnowledgeReads } from './knowledge-reads.js';
import { decideSkillRoute } from './skill-route.js';
import { evolveSessionReceipt, readEvolveSessions, workflowDbPath } from './workflow-runtime.js';
import {
  applySkillDesign, createSkillDesignTask, readSkillDesignTask, replaySkillDesign,
  reviewSkillDesign, runSkillDesign,
} from './skill-design.js';

const help = `Usage: agent-memory <command> [options]

  code build|sync                          Build or update the project's code graph
  code search <query>                      Find code symbols
  code callers|callees <symbol-id>         Follow call edges (--depth 1)
  code trace <from-id> <to-id>             Find a path between code symbols
  wiki build                               Index Markdown pages under wiki/
  wiki ingest <file.md|file.txt>            Generate and merge wiki pages
  wiki search <query>                      Search wiki pages (--hop 0)
  wiki get <id>                            Read a Wiki entry, including history (--resolved for scoped reference)
  wiki references <query>                  Search active applicable references (--repository, --task, --path)
  wiki reference <id>                      Compatibility alias for wiki get <id> --resolved
  wiki constraints                         Resolve active constraints (--task, --path, --category, --repository, --keyword)
  wiki migrate <legacy-root>               Preview legacy Wiki migration (--project, --scope project|global|team|personal, --uid, --knowhow-only, --apply)
  wiki propose <change.json>               Stage create, update, promote, or retire (--evidence or --closeout and --candidate)
  wiki changes [change-id]                 Read change previews and application receipts (--entry)
  wiki apply <change-id>                   Apply an approved Wiki change
  closeout harvest <receipt.json|id>       Extract Wiki candidates from a receipt or recorded Skill completion (--project)
  closeout session <id>                    Harvest a committed Session receipt (--project, --receipt)
  closeout skill <execution-id>            Record and harvest a standalone Skill completion
                                          (--skill, --skill-version, --status, --transcript, --knowledge-receipt, --project, --record-only)
  closeout resume <receipt-id>             Compatibility alias for closeout harvest <receipt-id>
  closeout scan [source-project-root]      Reconcile committed Session and standalone Skill receipts (--project)
  closeout show <receipt-id>                Show harvested candidates (--project)
  closeout route <closeout-id> <candidate-id> Decide Wiki, Skill addition, or meta Skill design
  closeout publish <closeout-id> <candidate-id> <title>
                                          Publish a reviewed reference
  session review <id>                      Review Session signals (--transcript <messages.json>)
  evolve review <execution-id>             Review a standalone Skill receipt (--project <id>)
  evolve draft <SKILL.md> <instruction>    Draft a Skill addition (--priority high|normal|low, --evidence <ref>, --when)
  evolve replay <draft.json>               Compare baseline and candidate (--runner <script>, --scenarios <json>)
  evolve apply|rollback <receipt-id>       Apply a validated version or revert it
  skill-design task <task-id>              Read a generated meta Skill design task
  skill-design run <task-id>                Run the explicit meta Skill design runner (--runner)
  skill-design review <design-id>           Review the generated design against its baseline
  skill-design replay <design-id>           Replay the reviewed design (--runner, --scenarios)
  skill-design apply|rollback <design-id>  Apply or roll back the replayed design
  memory put <text>                        Save a memory (--id, --type, --scene, --session, --priority)
  memory extract <messages.json>           Extract L1 memories (--session required, --mode chat|code)
  memory get|delete <id>                   Read or delete a memory
  memory search <query>                    Search memory (--type, --scene, --session)
  search <query>                           Search available indexes (--scope all|code|wiki|memory)
  context <query>                          Build Agent Memory context envelope (--scope all|code|wiki|memory, --include-memory)
  serve                                    Serve GET /search on 127.0.0.1 (--port 4310)

Options:
  --root <dir>         Code project root and parent of wiki/ (default current directory)
  --wiki-root <dir>    Override the parent of wiki/
  --db <path>          Memory DB (default <root>/.agent-memory/memory.db)
  --namespace <name>   Memory namespace (default default)
  --memory-session <id> Memory session filter (context uses this instead of its context session)
  --context-file <path> Load shared task, path and Wiki filters from JSON
  --trace               Include knowledge_reads search/read evidence in the result
  --reads <path>        Load and persist a knowledge_reads receipt across CLI calls
  --trace-file <path>   Compatibility alias for --reads
  --from-search <id>    Associate an exact read with an earlier search ID
  --resolved            Read Wiki references using the active scope context
  --json                Compatibility flag. Agent Memory output is always JSON
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
  'memory-session': { type: 'string' },
  'context-file': { type: 'string' },
  id: { type: 'string' },
  priority: { type: 'string' },
  port: { type: 'string' },
  mode: { type: 'string' },
  skill: { type: 'string' }, // 收尾路由和执行回执的 Skill 标识，旧查询也可携带。
  task: { type: 'string' },
  category: { type: 'string', multiple: true },
  keyword: { type: 'string' },
  repository: { type: 'string' },
  'include-path-scoped': { type: 'boolean' },
  'include-memory': { type: 'boolean' },
  trace: { type: 'boolean' },
  'trace-file': { type: 'string' },
  reads: { type: 'string' },
  'from-search': { type: 'string' },
  resolved: { type: 'boolean' },
  path: { type: 'string', multiple: true },
  history: { type: 'boolean' },
  project: { type: 'string' },
  uid: { type: 'string' },
  'knowhow-only': { type: 'boolean' },
  apply: { type: 'boolean' },
  transcript: { type: 'string' },
  'knowledge-receipt': { type: 'string' },
  receipt: { type: 'string' },
  'skill-version': { type: 'string' },
  'repeat-count': { type: 'string' },
  'step-count': { type: 'string' },
  'signal-kind': { type: 'string', multiple: true },
  'cross-skill': { type: 'boolean' },
  'new-contract': { type: 'boolean' },
  'new-artifacts': { type: 'boolean' },
  'requires-routing': { type: 'boolean' },
  'skill-intent': { type: 'boolean' },
  status: { type: 'string' },
  'record-only': { type: 'boolean' },
  evidence: { type: 'string', multiple: true },
  entry: { type: 'string' },
  closeout: { type: 'string' },
  candidate: { type: 'string' },
  when: { type: 'string' },
  runner: { type: 'string' },
  scenarios: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  json: { type: 'boolean' },
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

interface CliWikiContext {
  skill?: string;
  task?: string;
  paths?: string[];
  categories?: string[];
  repository?: string;
  keyword?: string;
  includePathScoped?: boolean;
}

function readContextFile(path: string): CliWikiContext {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Context file must contain a JSON object');
  const input = value as Record<string, unknown>;
  const list = (field: 'paths' | 'categories'): string[] | undefined => {
    if (input[field] === undefined) return undefined;
    if (!Array.isArray(input[field]) || input[field].some(item => typeof item !== 'string' || !item.trim())) {
      throw new InputError(`Context file ${field} must be a list of non-empty strings`);
    }
    return [...new Set((input[field] as string[]).map(item => item.trim()))];
  };
  const text = (field: 'task' | 'repository' | 'keyword'): string | undefined => {
    if (input[field] === undefined) return undefined;
    if (typeof input[field] !== 'string' || !input[field].trim()) throw new InputError(`Context file ${field} must be a non-empty string`);
    return input[field].trim();
  };
  if (input.includePathScoped !== undefined && typeof input.includePathScoped !== 'boolean') {
    throw new InputError('Context file includePathScoped must be boolean');
  }
  return {
    task: text('task'), paths: list('paths'), categories: list('categories'),
    repository: text('repository'), keyword: text('keyword'),
    ...(input.includePathScoped === undefined ? {} : { includePathScoped: input.includePathScoped as boolean }),
  };
}

function cliWikiContext(values: Record<string, unknown>): CliWikiContext {
  const file = typeof values['context-file'] === 'string' ? readContextFile(values['context-file']) : {};
  const paths = Array.isArray(values.path) ? values.path as string[] : file.paths;
  const categories = Array.isArray(values.category) ? values.category as string[] : file.categories;
  return {
    task: typeof values.task === 'string' ? values.task : file.task,
    paths, categories,
    repository: typeof values.repository === 'string' ? values.repository : file.repository,
    keyword: typeof values.keyword === 'string' ? values.keyword : file.keyword,
    includePathScoped: typeof values['include-path-scoped'] === 'boolean'
      ? values['include-path-scoped'] : file.includePathScoped,
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
  const contextValues = cliWikiContext(values as Record<string, unknown>);
  const wiki = new Wiki(values['wiki-root'] ?? root);
  const db = values.db ?? join(root, '.agent-memory', 'memory.db');
  const openMemory = () => new MemoryStore(db, { namespace: values.namespace });
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  const wikiOptions = { limit, hop: values.hop === undefined ? undefined : Number(values.hop), includeHistory: values.history };
  const memorySession = values['memory-session'] ?? (command === 'memory' || command === 'search' ? values.session : undefined);
  const memoryOptions = { limit, type: values.type, scene: values.scene, session: memorySession };
  if (values.reads !== undefined && values['trace-file'] !== undefined && values.reads !== values['trace-file']) {
    throw new InputError('Use either --reads or --trace-file, not both');
  }
  const traceFile = values.reads ?? values['trace-file'];
  const initialTrace = traceFile && existsSync(traceFile)
    ? validateKnowledgeReads(JSON.parse(readFileSync(traceFile, 'utf8').replace(/^\uFEFF/, '')))
    : undefined;
  const knowledgeReads = values.trace || traceFile
    ? new KnowledgeReads(initialTrace)
    : undefined;
  const print = (result: unknown) => process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  const withTrace = (result: unknown) => {
    if (!knowledgeReads) return result;
    if (traceFile) {
      mkdirSync(dirname(resolve(traceFile)), { recursive: true });
      writeFileSync(traceFile, JSON.stringify(knowledgeReads.toJSON(), null, 2) + '\n');
    }
    return result && typeof result === 'object' && !Array.isArray(result)
      ? { ...(result as Record<string, unknown>), knowledge_reads: knowledgeReads.toJSON() }
      : { result, knowledge_reads: knowledgeReads.toJSON() };
  };

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
      print(withTrace(await search(sources, query, {
        scope, limit, wiki: wikiOptions, memory: memoryOptions, knowledgeReads,
      })));
    } finally {
      sources.memory?.close();
    }
    return;
  }
  if (command === 'context') {
    const query = requireText([action, ...args].join(' '), 'query');
    const scope = parseScope(values.scope ?? 'all');
    if (contextValues.categories && !contextValues.categories.every(isWikiCategory)) {
      throw new InputError('Unknown Wiki context category');
    }
    if (contextValues.repository !== undefined && !isRepositoryId(contextValues.repository)) {
      throw new InputError('Expected a persisted repository UUID');
    }
    const sources = sourcesFor(scope);
    try {
      print(withTrace(await buildContext(sources, query, {
        limit,
        context: {
          task: contextValues.task,
          paths: contextValues.paths,
          categories: contextValues.categories as WikiContext['categories'],
          repository: contextValues.repository,
          keyword: contextValues.keyword,
          includePathScoped: contextValues.includePathScoped,
        },
        wiki: wikiOptions,
        memory: memoryOptions,
        includeWorkingMemory: values['include-memory'],
        knowledgeReads,
        contextScope: {
          ...(values.session ? { session_id: values.session } : {}),
          ...(contextValues.task ? { task_kind: contextValues.task } : {}),
          ...(contextValues.paths?.length ? { paths: contextValues.paths } : {}),
        },
      })));
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
      case 'search': {
        const query = args.join(' ');
        const result = await code.search(query, limit);
        if (knowledgeReads) knowledgeReads.recordSearch({
          source: 'code', query,
          returnedIds: result.flatMap(item => typeof item.node?.id === 'string' ? [item.node.id] : []),
        });
        return print(withTrace(result));
      }
      case 'callers':
      case 'callees': return print(await code.neighbors(requireText(args[0], 'symbol id'), action, Number(values.depth ?? '1')));
      case 'trace': return print(await code.trace(requireText(args[0], 'from id'), requireText(args[1], 'to id')));
    }
  }
  if (command === 'wiki') {
    switch (action) {
      case 'build': return print(wiki.build());
      case 'search': {
        const query = args.join(' ');
        const result = wiki.search(query, wikiOptions);
        if (knowledgeReads) knowledgeReads.recordSearch({
          source: 'wiki', query, filters: wikiOptions, returnedIds: result.results.map(hit => hit.id),
        });
        return print(withTrace(result));
      }
      case 'get':
        if (!values.resolved) return print(withTrace(wiki.getEntry(requireText(args[0], 'wiki entry ID'), {
          knowledgeReads, fromSearchId: values['from-search'],
        })));
      case 'constraints':
      case 'references':
      case 'reference': {
        const categories = contextValues.categories;
        const repository = contextValues.repository;
        if (categories && !categories.every(isWikiCategory)) {
          throw new InputError(action === 'constraints' ? 'Unknown Wiki constraint category' : 'Unknown Wiki reference category');
        }
        if (repository !== undefined && !isRepositoryId(repository)) throw new InputError('Expected a persisted repository UUID');
        const context: WikiContext = { task: contextValues.task, paths: contextValues.paths,
          categories: categories as WikiContext['categories'], repository, keyword: contextValues.keyword };
        if (action === 'references') {
          const query = args.join(' ');
          const result = wiki.references(query, context, wikiOptions);
          if (knowledgeReads) knowledgeReads.recordSearch({
            source: 'wiki_references', query, filters: { ...context, ...wikiOptions },
            returnedIds: result.results.map(hit => hit.id),
          });
          return print(withTrace(result));
        }
        if (action === 'reference' || (action === 'get' && values.resolved)) {
          return print(withTrace(wiki.getReference(requireText(args[0], 'Wiki entry ID'), context, {
            knowledgeReads, fromSearchId: values['from-search'],
          })));
        }
        const result = wiki.constraints({ ...context, includePathScoped: contextValues.includePathScoped });
        if (knowledgeReads) for (const constraint of result) {
          knowledgeReads.bindConstraint({
            knowledgeId: constraint.id, scope: constraint.entry?.scope ?? [],
            categories: constraint.entry?.categories, content: constraint.body,
          });
        }
        return print(withTrace(result));
      }
      case 'migrate': {
        const scope = values.scope ?? 'project';
        if (scope !== 'project' && scope !== 'global' && scope !== 'team' && scope !== 'personal') {
          throw new InputError('Expected Wiki migration scope project, global, team, or personal');
        }
        const source = resolve(requireText(args[0], 'legacy source root'));
        const uid = scope === 'personal' ? validateWikiMemberUid(values.uid) : undefined;
        const collab = join(root, '.workflow', 'collab');
        if (!values['wiki-root'] && (scope === 'team' || scope === 'personal')) {
          const parents = [join(root, '.workflow'), collab];
          if (uid) parents.push(join(collab, 'personal'), join(collab, 'personal', uid));
          for (const parent of parents) {
            const info = lstatSync(parent, { throwIfNoEntry: false });
            if (info && !info.isDirectory()) throw new InputError(`Invalid Wiki migration directory: ${parent}`);
          }
        }
        const layerRoot = scope === 'global' ? source : scope === 'team' ? collab
          : uid ? join(collab, 'personal', uid) : root;
        const destination = new Wiki(values['wiki-root'] ?? layerRoot);
        return print(migrateLegacyWiki(destination, source, requireText(values.project, 'legacy project ID'), values.apply, {
          scope, uid, knowhowOnly: values['knowhow-only'],
        }));
      }
      case 'propose': {
        const change = JSON.parse(readFileSync(requireText(args[0], 'change file'), 'utf8').replace(/^\uFEFF/, ''));
        const evidence = values.evidence ?? [];
        if (values.closeout !== undefined || values.candidate !== undefined) {
          const closeout = requireText(values.closeout, 'closeout ID');
          const candidate = readCloseoutCandidate(wiki, closeout, requireText(values.candidate, 'candidate ID'));
          return print(proposeWikiChange(wiki, change, evidence, {
            closeout, id: candidate.id, sources: candidate.sources,
            related: [...(candidate.matched_entry ? [candidate.matched_entry] : []),
              ...(candidate.related_entries ?? []).map(entry => entry.id)],
          }));
        }
        return print(proposeWikiChange(wiki, change, evidence));
      }
      case 'changes': return print(listWikiChanges(wiki, { id: args[0], entry: values.entry }));
      case 'apply': return print(applyWikiChange(wiki, requireText(args[0], 'Wiki change ID')));
      case 'ingest': return print(await wiki.ingest(requireText(args[0], 'source file'), { llm: modelClient() }));
    }
  }

  if (command === 'closeout') {
    if (action === 'publish') return print(publishReference(
      wiki, requireText(args[0], 'closeout ID'), requireText(args[1], 'candidate ID'), args.slice(2).join(' '),
    ));
    if (action === 'route') {
      const candidate = readCloseoutCandidate(wiki, requireText(args[0], 'closeout ID'), requireText(args[1], 'candidate ID'));
      const closeoutId = requireText(args[0], 'closeout ID');
      const candidateId = requireText(args[1], 'candidate ID');
      const decision = decideSkillRoute({
        content: candidate.content,
        sources: candidate.sources,
        matchedEntry: candidate.matched_entry,
        relatedEntries: candidate.related_entries?.map(entry => entry.id),
        skillId: values.skill,
        skillVersion: values['skill-version'],
        signalKinds: values['signal-kind'],
        repeatCount: values['repeat-count'] === undefined ? undefined : Number(values['repeat-count']),
        stepCount: values['step-count'] === undefined ? undefined : Number(values['step-count']),
        crossSkill: values['cross-skill'],
        requiresNewContract: values['new-contract'],
        requiresNewArtifacts: values['new-artifacts'],
        requiresRouting: values['requires-routing'],
        explicitSkillIntent: values['skill-intent'],
      });
      if (decision.route !== 'skill-design') return print(decision);
      if (!values.skill) throw new InputError('Skill-design route requires --skill <skill-id> for the replay/apply chain');
      const task = createSkillDesignTask(root, {
        closeoutId, candidateId, content: candidate.content, sources: candidate.sources,
        decision, skillId: values.skill, skillVersion: values['skill-version'],
      });
      return print({ ...decision, design_task: task });
    }
    const project = requireText(values.project, 'source project ID');
    if (action === 'harvest' || action === 'resume') {
      const source = requireText(args[0], action === 'harvest' ? 'receipt path or ID' : 'receipt ID');
      if (action === 'harvest' && existsSync(source)) {
        return print(await harvestCompletion(
          wiki, project, JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, '')), modelClient,
        ));
      }
      const saved = readSkillCompletions(wiki, project, source)[0];
      if (!saved) throw new InputError(`Standalone Skill completion receipt not found: ${source}`);
      return print(await harvestCompletion(wiki, project, saved.receipt, modelClient));
    }
    if (action === 'show') return print(readHarvest(wiki, project, requireText(args[0], 'completion receipt ID')));
    if (action === 'session') {
      const session = requireText(args[0], 'Session ID');
      const [native] = readEvolveSessions(root, session);
      if (native) {
        const receipt = evolveSessionReceipt(native);
        if (values.receipt && values.receipt !== receipt.id) throw new InputError('Evolve Session receipt ID mismatch');
        return print(await harvestCompletion(wiki, project, receipt, modelClient));
      }
      const receipts = [...readCompletionReceipts(root, session, values.receipt)];
      if (receipts.length !== 1) {
        throw new InputError(`Expected one committed completion receipt for ${session}, found ${receipts.length}`);
      }
      const [{ receipt, directory }] = receipts;
      return print(await harvestCompletion(wiki, project, receipt, modelClient, directory));
    }
    if (action === 'skill') {
      const transcript = values.transcript ? JSON.parse(readFileSync(values.transcript, 'utf8').replace(/^\uFEFF/, '')) : [];
      if (!Array.isArray(transcript)) throw new InputError('Transcript must be a JSON message array');
      const knowledgeReads = values['knowledge-receipt']
        ? validateKnowledgeReads(JSON.parse(readFileSync(values['knowledge-receipt'], 'utf8').replace(/^\uFEFF/, '')))
        : undefined;
      const recorded = recordSkillCompletion(wiki, project, {
        execution: requireText(args[0], 'Skill execution ID'),
        skill: requireText(values.skill, 'Skill ID'), version: requireText(values['skill-version'], 'Skill version'),
        status: requireText(values.status, 'Skill status'), messages: transcript, session: values.session, knowledgeReads,
      });
      if (!('receipt' in recorded)) return print(recorded);
      if (values['record-only']) return print({ receipt: recorded.receipt.id });
      return print({ receipt: recorded.receipt.id, ...await harvestCompletion(wiki, project, recorded.receipt, modelClient) });
    }
    if (action === 'scan') {
      const results: Awaited<ReturnType<typeof harvestCompletion>>[] = [];
      const errors: Array<{ receipt: string; error: string }> = [];
      const sessionSource = args[0] ?? root;
      const hasHistoricalSessions = existsSync(join(sessionSource, '.workflow', 'sessions'));
      if (args[0] && !hasHistoricalSessions && !existsSync(workflowDbPath(sessionSource))) {
        throw new InputError('Cannot locate Evolve or historical Sessions in the source project');
      }
      const sessionReceipts = hasHistoricalSessions
        ? readCompletionReceipts(sessionSource) : [];
      const consume = async (id: string, receipt: unknown, directory?: string) => {
        try {
          results.push(await harvestCompletion(wiki, project, receipt, modelClient, directory));
        } catch (error) {
          errors.push({ receipt: id, error: error instanceof Error ? error.message : String(error) });
        }
      };
      for (const { receipt, directory } of sessionReceipts) {
        await consume(requireText(receipt.transition_id, 'transition ID'), receipt, directory);
      }
      for (const session of readEvolveSessions(sessionSource).filter(item => item.status === 'completed')) {
        const receipt = evolveSessionReceipt(session);
        await consume(receipt.id, receipt);
      }
      for (const { id, receipt } of readSkillCompletions(wiki, project)) {
        await consume(id, receipt);
      }
      if (errors.length > 0) {
        process.exitCode = 1;
        return print({ results, errors });
      }
      return print(results);
    }
  }

  if (command === 'session' && action === 'review') {
    const transcript = values.transcript ? JSON.parse(readFileSync(values.transcript, 'utf8')) : undefined;
    if (transcript !== undefined && !Array.isArray(transcript)) throw new InputError('Transcript must be a JSON message array');
    return print(await reviewSession(root, requireText(args[0], 'Session ID'), { model: modelClient, transcript }));
  }

  if (command === 'evolve' && action === 'review') {
    return print(await reviewSkillExecution(
      wiki, requireText(values.project, 'source project ID'), requireText(args[0], 'Skill execution ID'), modelClient,
    ));
  }

  if (command === 'evolve' && action === 'draft') {
    const priority = values.priority;
    if (priority !== 'high' && priority !== 'normal' && priority !== 'low') throw new InputError('Unknown Skill priority');
    return print(draftSkillAddition({
      entry: requireText(args[0], 'Skill entry path'),
      priority,
      instruction: args.slice(1).join(' '),
      sources: values.evidence ?? [],
      when: values.when,
    }));
  }
  if (command === 'evolve' && action === 'replay') {
    const draft: unknown = JSON.parse(readFileSync(requireText(args[0], 'draft file'), 'utf8').replace(/^\uFEFF/, ''));
    const scenarios: unknown = JSON.parse(readFileSync(requireText(values.scenarios, 'scenarios file'), 'utf8').replace(/^\uFEFF/, ''));
    return print(replaySkillAddition(root, draft, { runner: requireText(values.runner, 'replay runner'), scenarios }));
  }
  if (command === 'evolve' && (action === 'apply' || action === 'rollback')) {
    return print(changeSkillVersion(root, requireText(args[0], 'replay receipt ID'), action === 'rollback'));
  }
  if (command === 'skill-design') {
    if (action === 'task') return print(readSkillDesignTask(root, requireText(args[0], 'Skill design task ID')));
    if (action === 'run') return print(runSkillDesign(root, requireText(args[0], 'Skill design task ID'), requireText(values.runner, 'design runner')));
    if (action === 'review') return print(reviewSkillDesign(root, requireText(args[0], 'Skill design receipt ID')));
    if (action === 'replay') {
      const scenarios: unknown = JSON.parse(readFileSync(requireText(values.scenarios, 'scenarios file'), 'utf8').replace(/^\uFEFF/, ''));
      return print(replaySkillDesign(root, requireText(args[0], 'Skill design receipt ID'), {
        runner: requireText(values.runner, 'replay runner'), scenarios,
      }));
    }
    if (action === 'apply' || action === 'rollback') {
      return print(applySkillDesign(root, requireText(args[0], 'Skill design receipt ID'), action === 'rollback'));
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
        case 'get': return print(withTrace(memory.get(requireText(args[0], 'id'), {
          knowledgeReads, fromSearchId: values['from-search'],
        }) ?? null));
        case 'delete': return print({ deleted: memory.delete(requireText(args[0], 'id')) });
        case 'search': {
          const query = args.join(' ');
          const result = await memory.search(query, memoryOptions);
          if (knowledgeReads) knowledgeReads.recordSearch({
            source: 'memory', query, filters: memoryOptions, returnedIds: result.results.map(hit => hit.id),
          });
          return print(withTrace(result));
        }
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
