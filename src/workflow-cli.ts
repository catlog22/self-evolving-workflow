#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CodeGraph } from './code.js';
import { InputError, requireText } from './common.js';
import { knowledgeHelp, knowledgeOptions, runKnowledgeCli } from './knowledge-cli.js';
import { WorkflowStore, workflowId, type Mutation, type WorkflowStep } from './workflow-runtime.js';
import { bindWorkflowSkill, commandNames, workflowHash } from './workflow-skills.js';
import { serveWorkflowRun } from './workflow-mcp.js';
import { Wiki } from './wiki.js';
import { migrateLegacyWiki } from './wiki-migration.js';
import { wikiLookupScope } from './workflow-knowledge.js';
import { installSkills, installWorkflow, workflowDocument, workflowDocuments } from './workflow-install.js';

const string = { type: 'string' } as const;
const strings = { type: 'string', multiple: true } as const;
const bool = { type: 'boolean' } as const;
const options = {
  root: string, db: string, id: string, session: string, run: string, actor: string, participant: string,
  'request-id': string, reason: string, evidence: strings, json: bool, help: { ...bool, short: 'h' }, advance: bool,
  'expected-orchestration-revision': string, 'expected-run-revision': string,
  'definition-of-done': string, chain: strings, 'step-id': string, command: string, arg: strings, 'after-step': string,
  'decision-ref': string, 'goal-ref': string, stage: string, gate: strings, from: string, verdict: string, summary: string,
  to: string, tool: string, role: string, mode: string, model: string, cd: string, 'prompt-file': string, path: string,
  project: string, global: bool, apply: bool, 'knowhow-only': bool,
  scope: string, host: string, skill: strings, yes: bool,
} as const;

const usage = [
  'evolve capabilities',
  'evolve session open <objective> --id <id> [--chain <commands>] --actor <id>',
  'evolve session status|amend|complete --session <id>',
  'evolve session list|resume-view',
  'evolve session chain insert|replace|skip --session <id> --step-id <id>',
  'evolve run next|brief|check|skill-read|artifact-read|complete|transition|cancel|decide --session <id>',
  'evolve run skill-read <run> [<path> --from <from>] --session <id>',
  'evolve run artifact-read <run> <alias> --session <id> [--scope <Wiki scope JSON>]',
  'evolve team controller|assign|report|cancel|list --session <id> --run <id>',
  'evolve skills [install <package>... | validate <command>]',
  'evolve install [--scope project|user | --global] [--host codex|claude|agy] [--skill <package>] [--root <project>] [--yes]',
  'evolve workflows [show <id>]',
  'evolve knowledge import [<source>] [--root <destination>] [--project <legacy-id>] [--global] [--knowhow-only] [--apply]',
  'evolve mcp --session <id> --run <id>',
  'evolve delegate <prompt> --to codex|agy --mode analysis|write',
].join('\n');

const knowledgeCommands = new Set(['code', 'wiki', 'memory', 'search', 'context', 'serve', 'closeout', 'skill-design']);
const skillEvolutionActions = new Set(['review', 'draft', 'replay', 'apply', 'rollback']);

async function main(argv: string[]) {
  // 路由保留选项及参数顺序，具体命令仍使用各自的严格参数定义。
  const { positionals: [group, action], tokens } = parseArgs({
    args: argv, options: { ...knowledgeOptions, ...options }, allowPositionals: true, strict: false, tokens: true,
  });
  if (knowledgeCommands.has(group) || (group === 'session' && action === 'review')) {
    return runKnowledgeCli(argv, 'evolve');
  }
  if (group === 'skills' && skillEvolutionActions.has(action)) {
    const command = tokens.find(token => token.kind === 'positional');
    if (command) argv[command.index] = 'evolve';
    return runKnowledgeCli(argv, 'evolve');
  }
  return runWorkflowCli(argv);
}

function revision(value: string | undefined) {
  if (value === undefined) return;
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result)) throw new InputError('Invalid revision: ' + value);
  return result;
}

function select<T extends string>(value: string | undefined, choices: readonly T[], label: string): T {
  if (choices.some(item => item === value)) return value as T;
  throw new InputError(label + ' must be one of: ' + choices.join(', '));
}

function importLegacyKnowledge(root: string, sourceArg: string | undefined, values: {
  root?: string; global?: boolean; project?: string; apply?: boolean; 'knowhow-only'?: boolean;
}) {
  const scope = values.global ? 'global' : 'project';
  const source = realpathSync(sourceArg ?? (values.global ? join(homedir(), '.maestro') : root));
  if (!lstatSync(source).isDirectory()) throw new InputError('Legacy knowledge source must be a directory');
  const destination = values.root ? root : values.global ? join(homedir(), '.evolve') : source;
  const project = values.project ?? (values.global && !sourceArg ? 'maestro-global' : 'legacy-' + workflowHash(source).slice(7, 23));
  const entries = migrateLegacyWiki(new Wiki(destination), source, project, values.apply, {
    scope, knowhowOnly: values['knowhow-only'],
  });
  return { source, destination, project, scope, applied: values.apply ?? false,
    new_entries: entries.filter(entry => !entry.existing).length,
    existing_entries: entries.filter(entry => entry.existing).length,
    needs_review: entries.filter(entry => entry.status === 'needs_review').length, entries };
}

function findWindowsCommand(name: string) {
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name + '.exe';
}

function resolveDelegateCommand(tool: 'codex' | 'agy', childArgs: string[]) {
  const raw = tool === 'codex'
    ? process.env.CODEX_REPLAY_EXECUTABLE ?? (process.platform === 'win32' ? findWindowsCommand('codex') : 'codex')
    : process.env.AGY_EXECUTABLE ?? (process.platform === 'win32' ? findWindowsCommand('agy') : 'agy');
  if (/\.[cm]?js$/i.test(raw)) {
    return { command: process.execPath, args: [resolve(raw), ...childArgs], shell: false };
  }
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(raw)) {
    if (existsSync(raw)) {
      const shim = readFileSync(raw, 'utf8');
      const match = /%~?dp0[\\/]([^"\r\n]+\.[cm]?js)/i.exec(shim);
      if (match) {
        const script = resolve(dirname(raw), match[1]);
        if (existsSync(script)) return { command: process.execPath, args: [script, ...childArgs], shell: false };
      }
    }
    return {
      command: `"${raw}"`,
      args: childArgs.map(arg => `"${arg.replaceAll('"', '\\"')}"`),
      shell: true,
    };
  }
  return { command: raw, args: childArgs, shell: false };
}

function delegate(root: string, values: {
  to?: string; tool?: string; mode?: string; model?: string; cd?: string; session?: string; run?: string; 'prompt-file'?: string;
}, args: string[]) {
  const tool = select(values.to ?? values.tool ?? 'codex', ['codex', 'agy'], 'executor');
  const mode = select(values.mode ?? 'analysis', ['analysis', 'write'], 'mode');
  const cwd = resolve(root, values.cd ?? '.');
  const prompt = requireText(values['prompt-file'] ? readFileSync(resolve(cwd, values['prompt-file']), 'utf8') : args.join(' '), 'prompt');
  const model = values.model ? ['--model', values.model] : [];
  if ((values.session === undefined) !== (values.run === undefined)) throw new InputError('Supply both Session and Run identifiers');
  const bound = values.session && values.run ? [
    '-c', 'mcp_servers.evolve_run.command=' + JSON.stringify(process.execPath),
    '-c', 'mcp_servers.evolve_run.args=' + JSON.stringify([fileURLToPath(import.meta.url), 'mcp', '--root', root,
      '--session', workflowId(values.session, 'Session ID'), '--run', workflowId(values.run, 'Run ID')]),
    '-c', 'mcp_servers.evolve_run.required=true',
    '-c', 'mcp_servers.evolve_run.default_tools_approval_mode="writes"',
  ] : [];
  if (bound.length && tool !== 'codex') throw new InputError('Use Codex for a bound Evolve worker');
  const childArgs = tool === 'codex'
    ? ['-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
      '--sandbox', mode === 'analysis' ? 'read-only' : 'workspace-write', ...model, ...bound, '-']
    : ['--mode', mode === 'analysis' ? 'plan' : 'accept-edits', '--output-format', 'text', ...model, '--print=' + prompt];
  const resolved = resolveDelegateCommand(tool, childArgs);
  const child = spawnSync(resolved.command, resolved.args, { cwd, input: tool === 'codex' ? prompt : undefined, encoding: 'utf8',
    shell: resolved.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new InputError(tool + ' exited with status ' + child.status);
  return { executor: tool, output: child.stdout };
}

async function runWorkflowCli(argv: string[]) {
  const { positionals: [group, action, ...args], values } = parseArgs({ options, args: argv, allowPositionals: true });
  if (!group || values.help) {
    process.stdout.write(usage + '\n\n' + knowledgeHelp('evolve'));
    return;
  }
  const root = resolve(values.root ?? '.');
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (group === 'capabilities') return print({ schema_version: 'evolve-workflow/1.0', session: 'evolve-session/1.0',
    features: ['revision-cas', 'request-receipts', 'git-skill-binding', 'atomic-artifact-seal', 'run-knowledge', 'swarm-coordination'] });
  if (group === 'knowledge') {
    if (action !== 'import' || args.length > 1) {
      throw new InputError('Usage: evolve knowledge import [<source>] [--root <destination>] [--project <legacy-id>] [--global] [--knowhow-only] [--apply]');
    }
    return print(importLegacyKnowledge(root, args[0], values));
  }
  if (group === 'workflows') {
    if (!action) return print(workflowDocuments());
    if (action === 'show' && args.length === 1) {
      process.stdout.write(workflowDocument(args[0]));
      return;
    }
    throw new InputError('Usage: evolve workflows [show <id>]');
  }
  if (group === 'install' && !action) {
    if (values.global && values.scope === 'project') throw new InputError('--global selects the user scope');
    const scope = values.global ? 'user'
      : values.scope === undefined ? undefined : select(values.scope, ['project', 'user'] as const, 'Install scope');
    return print(await installWorkflow(root, {
      scope,
      host: values.host === undefined ? undefined : select(values.host, ['codex', 'claude', 'agy'] as const, 'Install host'),
      skill: values.skill, yes: values.yes,
    }));
  }
  if (group === 'skills') {
    if (action === 'install') return print(installSkills(root, args));
    if (action === 'validate') return print(bindWorkflowSkill(root, requireText(args[0], 'Skill command')));
    if (!action) return print(commandNames.map(command => ({ command })));
    throw new InputError('Unknown Skills command: ' + action);
  }
  if (group === 'delegate') return print(delegate(root, values, action === undefined ? args : [action, ...args]));
  const store = new WorkflowStore(root);
  const id = () => workflowId(values.session ?? values.id, 'Session ID');
  const runId = () => workflowId(values.run ?? args[0], 'Run ID');
  const mutation = (): Mutation => {
    const actor = workflowId(values.actor ?? values.participant, 'actor');
    if (values.participant && values.participant !== actor) throw new InputError('Participant must match the actor');
    return { actor, requestId: values['request-id'], revision: revision(values['expected-orchestration-revision']),
      runRevision: revision(values['expected-run-revision']), evidence: values.evidence, reason: values.reason };
  };
  const makeStep = (command: string, step: string): WorkflowStep => ({
    id: step, command, args: values.arg ?? [], decision_ref: values['decision-ref'],
    goal_ref: values['goal-ref'], stage: values.stage,
  });
  try {
    if (group === 'session') {
      if (action === 'list' || action === 'resume-view') return print(store.list());
      if (action === 'status') return print(store.status(id()));
      if (action === 'amend') return print(store.amend(id(), requireText(args[0], 'amended objective'),
        values['definition-of-done'], mutation()));
      if (action === 'open') {
        const chain = [...values.chain ?? [], ...args.slice(1)].flatMap(value => value.split(/[\s,]+/)).filter(Boolean);
        const steps = chain.map((command, index) => ({ id: command + '-' + (index + 1), command, args: [] }));
        const session = store.open(id(), requireText(args[0], 'objective'), values['definition-of-done'] ?? '', steps, mutation());
        if (existsSync(join(root, '.git'))) {
          try {
            await new CodeGraph(root).refresh();
          } catch (error) {
            console.warn('Code graph refresh failed: ' + (error instanceof Error ? error.message : String(error)));
          }
        }
        return print(session);
      }
      if (action === 'chain') {
        const change = select(args[0], ['insert', 'replace', 'skip'], 'chain action');
        return print(store.chain(id(), change, makeStep(change === 'skip' ? '' : requireText(values.command, 'command'),
          workflowId(values['step-id'], 'step ID')), values['after-step'], mutation()));
      }
      if (action === 'complete') return print(store.completeSession(id(), mutation()));
    }
    if (group === 'run') {
      const gates = values.gate ?? [];
      if (action === 'next' || action === 'create') return print(store.next(id(), mutation(), gates, values['step-id']));
      if (action === 'brief') return print(store.brief(id(), runId()));
      if (action === 'check') return print(store.check(id(), runId(), gates));
      const target = values.run === undefined ? args[1] : args[0];
      if (action === 'skill-read') return print(store.readSkill(id(), runId(), values.from, target));
      if (action === 'artifact-read') return print(store.readArtifact(id(), runId(), requireText(target, 'artifact ID or alias'),
        wikiLookupScope(values.scope === undefined ? undefined : JSON.parse(values.scope))));
      if (action === 'complete') return print(store.completeRun(id(), runId(), requireText(values.summary, 'Run summary'),
        select(values.verdict ?? 'done', ['done', 'done_with_concerns'], 'verdict'), gates, mutation()));
      if (action === 'transition' || action === 'cancel') return print(store.transition(id(), runId(),
        action === 'cancel' ? 'cancelled' : select(args[1], ['running', 'blocked', 'failed'], 'Run status'),
        requireText(values.reason ?? values.summary, 'transition reason'), mutation()));
      if (action === 'decide') return print(store.decide(id(), workflowId(args[0], 'decision ID'),
        select(values.verdict, ['proceed', 'fix', 'escalate'], 'decision'), requireText(values.summary, 'decision summary'), mutation()));
    }
    if (group === 'team') {
      if (action === 'list') return print(store.teamList(id(), runId()));
      if (action === 'controller') return print(store.swarmController(id(), runId()));
      const operation = select(action, ['assign', 'report', 'cancel'], 'team operation');
      return print(store.team(id(), workflowId(values.run, 'Run ID'), operation, {
        id: workflowId(values.id ?? args[0], 'assignment ID'),
        role: operation === 'assign' ? workflowId(values.role, 'worker role') : '',
        path: operation === 'assign' ? requireText(values.path, 'artifact path') : '',
        ...(operation === 'report' ? { result: { summary: requireText(values.summary, 'assignment summary'), sha256: '' } } : {}),
      }, mutation()));
    }
    if (group === 'mcp') return await serveWorkflowRun(store, id(), workflowId(values.run, 'Run ID'), values.db);
    throw new InputError('Unknown workflow command: ' + [group, action].filter(Boolean).join(' '));
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
