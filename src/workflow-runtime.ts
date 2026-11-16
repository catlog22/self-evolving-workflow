import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { InputError, openDb, requireText, transaction } from './common.js';
import { contentSha256, KnowledgeReads, validateKnowledgeReads, type KnowledgePriorReuse, type KnowledgeReadsReceipt } from './knowledge-reads.js';
import { wikiLookupScope, type WikiLookupScope, type WikiPrior } from './workflow-knowledge.js';
import { workflowName } from './workflow-names.js';
import {
  bindWorkflowSkill, readWorkflowLink, readWorkflowMarkdown, workflowBlob, workflowHash, workflowHeader, workflowMeta,
  workflowPath, workflowRecord, type ArtifactType, type WorkflowSkill, type OutputSlot,
} from './workflow-skills.js';

type StepStatus = 'pending' | 'running' | 'completed' | 'skipped';
type RunStatus = 'running' | 'blocked' | 'failed' | 'cancelled' | 'sealed';
export interface WorkflowStep {
  id: string;
  command: string;
  args: string[];
  decision_ref?: string;
  stage?: string;
  goal_ref?: string;
}
interface Step extends WorkflowStep {
  status: StepStatus;
  run_id?: string;
  decision?: 'proceed' | 'fix' | 'escalate';
}
interface Run {
  id: string;
  owner: string;
  step_id: string;
  status: RunStatus;
  revision: number;
  skill: WorkflowSkill;
  task: { command: string; args: string[]; goal: string };
  inputs: string[];
  input_aliases: Record<string, string>;
  reads: Record<string, string>;
  retry_of_run_id?: string;
  summary?: string;
  finished_at?: string;
  verdict?: 'done' | 'done_with_concerns';
  knowledge_reads?: KnowledgeReadsReceipt;
  wiki_priors?: WikiPrior[];
  priors_reuse?: KnowledgePriorReuse[];
  assignments?: Record<string, Assignment>;
}
interface Assignment {
  id: string;
  role: string;
  path: string;
  result?: { summary: string; sha256: string };
  cancellation?: string;
}
interface Artifact extends ArtifactType {
  id: string;
  path: string;
  run_id: string;
  sha256: string;
  derived_from: string[];
  status: 'sealed';
  wiki_priors?: true;
}
interface Session {
  schema_version: 'evolve-session/1.0';
  id: string;
  objective: string;
  definition_of_done: string;
  status: 'open' | 'completed';
  revision: number;
  created_at: string;
  completed_at?: string;
  steps: Step[];
  runs: Run[];
  aliases: Record<string, string>;
  artifacts: Record<string, Artifact>;
}
export interface Mutation {
  actor: string;
  requestId?: string;
  revision?: number;
  runRevision?: number;
  evidence?: string[];
  reason?: string;
}
interface Publication { artifact: Artifact; bytes: Buffer }
const maxArtifactBytes = 5 * 1024 * 1024;

export function workflowId(value: unknown, label: string) {
  const id = requireText(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(id)) {
    throw new InputError('Invalid ' + label + ': ' + id);
  }
  return id;
}

function changed(id: string, expected: number | undefined, actual: number) {
  if (expected !== actual) throw new InputError('REVISION_CONFLICT ' + id + ': expected ' + expected + ', current ' + actual);
}

function findRun(session: Session, runId: string) {
  const run = session.runs.find(item => item.id === runId);
  if (!run) throw new InputError('Run not found: ' + runId);
  return run;
}

function findStep(session: Session, id: string) {
  const step = session.steps.find(item => item.id === id);
  if (!step) throw new InputError('Step not found: ' + id);
  return step;
}

function activeDecision(session: Session) {
  return session.steps.find(step => step.status === 'completed' && step.decision_ref &&
    (step.decision === undefined || step.decision === 'escalate'));
}

function nextAction(session: Session) {
  const active = session.runs.find(run => run.status === 'running' || run.status === 'blocked');
  const decision = activeDecision(session);
  if (session.status === 'completed') return { action: 'end' };
  if (active) return { action: active.status === 'running' ? 'execute' : 'recover', run_id: active.id };
  if (decision) return { action: 'decide', decision_ref: decision.decision_ref };
  if (session.steps.some(step => step.status === 'pending')) return { action: 'next' };
  return { action: 'complete' };
}

function safeFile(root: string, path: string) {
  let file = root;
  for (const part of workflowPath(path).split('/')) {
    file = join(file, part);
    const info = lstatSync(file, { throwIfNoEntry: false });
    if (!info) return;
    if (info.isSymbolicLink()) throw new InputError('Workflow files must be regular entries: ' + path);
  }
  const info = lstatSync(file);
  if (!info.isFile() || info.size > maxArtifactBytes) throw new InputError('Expected a regular file at most 5 MiB: ' + path);
  const bytes = readFileSync(file);
  if (bytes.length > maxArtifactBytes) throw new InputError('Workflow file exceeds 5 MiB: ' + path);
  return bytes;
}

function expandSlot(directory: string, slot: string) {
  if (!slot.includes('{')) return [slot];
  const parent = slot.slice(0, slot.lastIndexOf('/'));
  const dir = join(directory, workflowPath(parent));
  const info = lstatSync(dir, { throwIfNoEntry: false });
  if (!info) return [];
  if (!info.isDirectory()) throw new InputError('Invalid output directory: ' + parent);
  const pattern = slot.slice(parent.length + 1).split(/(\{[a-zA-Z_]+\})/).map(part =>
    part.startsWith('{') ? '[A-Za-z0-9_-]+' : part.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')).join('');
  return readdirSync(dir).filter(path => new RegExp('^' + pattern + '$').test(path)).map(path => parent + '/' + path);
}

function artifactMetadata(path: string, bytes: Buffer) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (path.endsWith('.json') || path.endsWith('.ndjson')) {
    const records = path.endsWith('.ndjson') ? text.trim().split(/\r?\n/).map(line => JSON.parse(line)) : [JSON.parse(text)];
    return workflowMeta(workflowRecord(records[0], 'artifact body')._meta);
  }
  return workflowMeta(workflowHeader(text));
}

export function workflowDbPath(root: string) {
  return join(root, '.agent-memory', 'workflow.db');
}

export function readEvolveSessions(root: string, id?: string): Session[] {
  const path = workflowDbPath(root);
  if (!existsSync(path)) return [];
  const db = openDb(path, true);
  try {
    const rows = id ? db.prepare('SELECT body FROM sessions WHERE id = ?').all(id)
      : db.prepare('SELECT body FROM sessions ORDER BY id').all();
    return rows.map(row => JSON.parse(String(row.body)) as Session);
  } finally {
    db.close();
  }
}

export function evolveSessionReceipt(session: Session) {
  if (session.status !== 'completed' || !session.completed_at) {
    throw new InputError('Complete the Evolve Session before harvesting its evidence');
  }
  return {
    schema_version: 'evolve-session-completion/1.0',
    id: workflowHash(JSON.stringify([session.id, session.created_at, session.completed_at, session.revision])).slice(7),
    session_id: session.id,
    recorded_at: session.completed_at,
    messages: session.runs.flatMap(run => {
      const timestamp = run.finished_at ?? session.completed_at!;
      return [
        { id: run.id + ':outcome', role: 'tool' as const, timestamp,
          content: [run.task.command + ' ' + run.status, run.summary, run.retry_of_run_id && 'retries ' + run.retry_of_run_id]
            .filter(Boolean).join('. ') },
        ...(run.knowledge_reads ? [{ id: run.id + ':knowledge-reads', role: 'tool' as const, timestamp,
          content: JSON.stringify(run.knowledge_reads) }] : []),
      ];
    }),
  };
}

export class WorkflowStore {
  private readonly db: ReturnType<typeof openDb>;
  constructor(readonly root: string) {
    const path = workflowDbPath(root);
    mkdirSync(dirname(path), { recursive: true });
    this.db = openDb(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS requests (session TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY (session, id), FOREIGN KEY (session) REFERENCES sessions(id)) STRICT;',
      'CREATE TABLE IF NOT EXISTS artifacts (session TEXT NOT NULL, id TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY (session, id), FOREIGN KEY (session) REFERENCES sessions(id)) STRICT;',
    ].join('\n'));
  }

  close() { this.db.close(); }

  find(id: string) {
    const row = this.db.prepare('SELECT body FROM sessions WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.body)) as Session : undefined;
  }

  status(id: string) {
    const session = this.find(id);
    if (!session) {
      if (existsSync(join(this.root, '.workflow', 'sessions', workflowId(id, 'Session ID')))) {
        throw new InputError('Historical Session: use evolve session review or evolve closeout session to inspect pre-Evolve Sessions');
      }
      throw new InputError('Evolve Session not found: ' + id);
    }
    return { ...session, orchestration_revision: session.revision, continuation: nextAction(session) };
  }

  list() {
    return this.db.prepare('SELECT body FROM sessions ORDER BY id').all().map(row => {
      const session = JSON.parse(String(row.body)) as Session;
      return { id: session.id, objective: session.objective, status: session.status,
        orchestration_revision: session.revision, steps: session.steps, continuation: nextAction(session) };
    });
  }

  private save(session: Session) {
    this.db.prepare('INSERT INTO sessions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(session.id, JSON.stringify(session));
  }

  private change<T extends object>(id: string, operation: string, mutation: Mutation, input: unknown, apply: () => T) {
    const actor = workflowId(mutation.actor, 'actor');
    const fingerprint = workflowHash(JSON.stringify([operation, actor, mutation.revision, mutation.runRevision, mutation.evidence, mutation.reason, input]));
    const requestId = mutation.requestId ? workflowId(mutation.requestId, 'request ID') : fingerprint.slice(7);
    type Receipt = T & { receipt: { request_id: string; action: string; actor: string; recorded_at: string; evidence: string[]; reason?: string } };
    return transaction(this.db, () => {
      const saved = this.db.prepare('SELECT fingerprint, receipt FROM requests WHERE session = ? AND id = ?').get(id, requestId);
      if (saved) {
        if (saved.fingerprint !== fingerprint) throw new InputError('IDEMPOTENCY_PAYLOAD_MISMATCH ' + requestId);
        return JSON.parse(String(saved.receipt)) as Receipt;
      }
      const receipt = { ...apply(), receipt: { request_id: requestId, action: operation, actor,
        recorded_at: new Date().toISOString(), evidence: mutation.evidence ?? [], reason: mutation.reason } };
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?)').run(id, requestId, fingerprint, JSON.stringify(receipt));
      return receipt;
    });
  }

  private mutate<T extends object>(id: string, operation: string, change: Mutation, input: unknown, apply: (session: Session) => T) {
    return this.change(id, operation, change, input, () => {
      const session = this.status(id);
      if (session.status !== 'open') throw new InputError('Session is completed: ' + id);
      changed(id, change.revision, session.revision);
      const result = apply(session);
      session.revision++;
      // 续步由已持久化的状态计算。
      const { continuation: _continuation, orchestration_revision: _revision, ...saved } = session;
      this.save(saved);
      return { ...result, session_id: id, orchestration_revision: session.revision, continuation: nextAction(session) };
    });
  }

  open(id: string, objective: string, definition: string, steps: WorkflowStep[], change: Mutation) {
    workflowId(id, 'Session ID');
    return this.change(id, 'session.open', change, { objective, definition, steps }, () => {
      if (this.find(id) || existsSync(join(this.root, '.workflow', 'sessions', id))) throw new InputError('Session ID already exists: ' + id);
      const existing = new Set<string>();
      const chain = steps.map(step => {
        this.validateStep(step);
        if (existing.has(step.id) || (step.decision_ref && steps.filter(item => item.decision_ref === step.decision_ref).length > 1)) {
          throw new InputError('Duplicate chain step or decision: ' + step.id);
        }
        existing.add(step.id);
        return { ...step, command: workflowName(step.command), status: 'pending' as const };
      });
      const session: Session = {
        schema_version: 'evolve-session/1.0', id, objective: requireText(objective, 'objective'), definition_of_done: definition,
        created_at: new Date().toISOString(), revision: 0, status: 'open', steps: chain, runs: [], aliases: {}, artifacts: {},
      };
      this.save(session);
      return { session_id: id, status: 'open', orchestration_revision: 0, continuation: nextAction(session) };
    });
  }

  private validateStep(step: WorkflowStep) {
    workflowId(step.id, 'step ID');
    if (step.decision_ref) workflowId(step.decision_ref, 'decision ID');
    bindWorkflowSkill(this.root, step.command);
    if (/^ew-odyssey-(security|defensive)$/.test(workflowName(step.command)) && step.args.includes('--fix')) {
      throw new InputError('This Odyssey mode uses a read-only audit');
    }
  }

  amend(id: string, objective: string, definition: string | undefined, change: Mutation) {
    return this.mutate(id, 'session.amend', change, { objective, definition }, session => {
      if (session.runs.some(run => run.status === 'blocked' || run.status === 'running')) {
        throw new InputError('Resolve the active Run before amending the Session');
      }
      if (!change.evidence?.length) throw new InputError('Supply evidence for the approved amendment');
      const previous = session.objective;
      session.objective = requireText(objective, 'amended objective');
      if (definition !== undefined) session.definition_of_done = requireText(definition, 'definition of done');
      return { previous_objective: previous, objective: session.objective, definition_of_done: session.definition_of_done };
    });
  }

  chain(id: string, action: 'insert' | 'replace' | 'skip', step: WorkflowStep, after: string | undefined, change: Mutation) {
    return this.mutate(id, 'chain.' + action, change, { step, after }, session => {
      const current = session.steps.findIndex(item => item.id === step.id);
      if (action === 'insert') {
        if (current >= 0) throw new InputError('Step already exists: ' + step.id);
        this.validateStep(step);
        if (step.decision_ref && session.steps.some(item => item.decision_ref === step.decision_ref)) throw new InputError('Decision already exists');
        const index = after ? session.steps.findIndex(item => item.id === after) + 1 : session.steps.length;
        const firstPending = session.steps.findIndex(item => item.status === 'pending');
        if ((after && index === 0) || index < (firstPending < 0 ? session.steps.length : firstPending)) {
          throw new InputError('Insert the step in the pending chain');
        }
        session.steps.splice(index, 0, { ...step, command: workflowName(step.command), status: 'pending' });
      } else {
        const original = findStep(session, step.id);
        if (original.status !== 'pending') throw new InputError('Select a pending step');
        if (action === 'replace') {
          const replacement = { ...original, ...step, decision_ref: step.decision_ref ?? original.decision_ref };
          this.validateStep(replacement);
          if (replacement.decision_ref && session.steps.some(item => item.id !== step.id && item.decision_ref === replacement.decision_ref)) {
            throw new InputError('Decision already exists');
          }
          session.steps[current] = { ...replacement, command: workflowName(replacement.command) };
        } else {
          if (!change.evidence?.length) throw new InputError('Supply evidence for a skipped step');
          original.status = 'skipped';
        }
      }
      return { step_id: step.id, status: action === 'skip' ? 'skipped' : 'pending' };
    });
  }

  private runDir(id: string, runId: string) {
    return join(this.root, '.agent-memory', 'workflow', 'runs', id, runId);
  }

  private packet(session: Session, run: Run) {
    return {
      session_id: session.id, run_id: run.id, run_dir: this.runDir(session.id, run.id),
      status: run.status, revision: run.revision, orchestration_revision: session.revision,
      task: { ...run.task, input_refs: run.inputs },
      skill_ref: run.skill, gates: run.skill.gates, upstream_aliases: run.input_aliases,
      upstream: Object.fromEntries(run.inputs.map(id => [id, session.artifacts[id]])),
      skill_reads: this.readProof(run), retry_of_run_id: run.retry_of_run_id,
    };
  }

  next(id: string, change: Mutation, gates: string[] = [], stepId?: string) {
    const packet = this.mutate(id, 'run.next', change, { gates, stepId }, session => {
      if (nextAction(session).action !== 'next') throw new InputError('Workflow continuation does not dispatch a Run');
      const step = session.steps.find(item => item.status === 'pending')!;
      if (stepId && step.id !== stepId) throw new InputError('Run creation must follow the pending chain');
      const command = workflowName(step.command);
      const skill = bindWorkflowSkill(this.root, command);
      const missing = skill.gates.entry.filter(gate => !gates.includes(gate));
      if (missing.length) throw new InputError('Missing entry gates: ' + missing.join(', '));
      const run: Run = {
        id: 'run-' + randomUUID(), owner: change.actor, step_id: step.id, status: 'running', revision: 0, skill,
        task: { command, args: step.args, goal: session.objective },
        inputs: [], input_aliases: {}, reads: {},
        ...(step.run_id ? { retry_of_run_id: step.run_id } : {}),
      };
      for (const slot of skill.consumes) {
        const artifact = slot.alias ? session.artifacts[session.aliases[slot.alias]] :
          Object.values(session.artifacts).findLast(item => item.kind === slot.kind && item.schema === slot.schema && item.role === slot.role);
        if (!artifact || artifact.kind !== slot.kind || artifact.schema !== slot.schema || artifact.role !== slot.role ||
            (!slot.accepts_negative_evidence && findRun(session, artifact.run_id).verdict === 'done_with_concerns')) {
          if (slot.required) throw new InputError('Required upstream artifact: ' + (slot.alias ?? slot.kind));
          continue;
        }
        run.inputs.push(artifact.id);
        if (slot.alias) run.input_aliases[slot.alias] = artifact.id;
        if (slot.kind === 'plan') run.inputs.push(...Object.values(session.artifacts)
          .filter(item => item.run_id === artifact.run_id && item.role === 'attachment').map(item => item.id));
      }
      run.inputs = [...new Set(run.inputs)];
      session.runs.push(run);
      step.status = 'running';
      step.run_id = run.id;
      return this.packet(session, run);
    });
    mkdirSync(join(packet.run_dir, 'outputs'), { recursive: true });
    return packet;
  }

  brief(id: string, runId: string) {
    const session = this.status(id);
    const packet = this.packet(session, findRun(session, runId));
    if (packet.status !== 'sealed') mkdirSync(join(packet.run_dir, 'outputs'), { recursive: true });
    return { ...packet, continuation: nextAction(session) };
  }

  readSkill(id: string, runId: string, from?: string, destination?: string) {
    return transaction(this.db, () => {
      const session = this.find(id);
      if (!session) throw new InputError('Evolve Session not found: ' + id);
      const run = findRun(session, runId);
      if ((from === undefined) !== (destination === undefined)) throw new InputError('Supply both --from and a Markdown destination');
      if (from && !Object.hasOwn(run.reads, from)) throw new InputError('Read the source document first: ' + from);
      const read = from && destination ? readWorkflowLink(this.root, run.skill, from, destination)
        : readWorkflowMarkdown(this.root, run.skill, run.skill.entry);
      if (run.status === 'running' || run.status === 'blocked') {
        run.reads[read.path] = read.sha256;
        this.save(session);
      }
      return { ...read, recorded: Object.hasOwn(run.reads, read.path) };
    });
  }

  readArtifact(id: string, runId: string, artifactId: string, scope: WikiLookupScope = {}) {
    const session = this.status(id);
    const run = findRun(session, runId);
    const resolved = run.input_aliases[artifactId] ?? artifactId;
    if (!run.inputs.includes(resolved)) throw new InputError('Artifact is outside the Run input binding: ' + artifactId);
    const artifact = session.artifacts[resolved];
    const bytes = this.db.prepare('SELECT body FROM artifacts WHERE session = ? AND id = ?').get(id, resolved)?.body;
    if (!(bytes instanceof Uint8Array) || workflowHash(Buffer.from(bytes)) !== artifact.sha256) {
      throw new InputError('Sealed artifact bytes are unavailable or changed: ' + resolved);
    }
    const content = Buffer.from(bytes).toString('utf8');
    if (artifact.wiki_priors) {
      const scopes = workflowRecord(JSON.parse(content), 'session-priors').lookup_scopes;
      const expected = JSON.stringify(wikiLookupScope(scope));
      if (!Array.isArray(scopes) || !scopes.some(item => JSON.stringify(wikiLookupScope(item)) === expected)) {
        throw new InputError('Wiki scope is outside session-priors; use wiki_context in this Run');
      }
      transaction(this.db, () => {
        const latest = this.status(id);
        const consumer = findRun(latest, runId);
        if (consumer.status !== 'running' || consumer.priors_reuse?.some(item => item.artifact_id === artifact.id)) return;
        (consumer.priors_reuse ??= []).push({ artifact_id: artifact.id, producer_run_id: artifact.run_id, content_sha256: artifact.sha256 });
        const { continuation: _continuation, orchestration_revision: _revision, ...saved } = latest;
        this.save(saved);
      });
    }
    return { ...artifact, content };
  }

  private readProof(run: Run) {
    return {
      reference: run.skill, reads: Object.entries(run.reads).map(([path, sha256]) => ({ path, sha256 })),
      missing: run.skill.required_links.filter(path => !Object.hasOwn(run.reads, path)),
    };
  }

  private outputs(session: Session, run: Run, gates: string[]) {
    const directory = this.runDir(session.id, run.id);
    const errors = this.readProof(run).missing.map(path => 'Required Skill read: ' + path);
    errors.push(...run.skill.gates.exit.filter(gate => !gates.includes(gate)).map(gate => 'Required exit gate: ' + gate));
    if (run.status !== 'running') errors.push('Complete a running Run');
    for (const item of Object.values(run.assignments ?? {})) {
      if (item.cancellation) continue;
      const bytes = item.result && safeFile(directory, item.path);
      if (!item.result || !bytes || workflowHash(bytes) !== item.result.sha256) errors.push('Swarm assignment evidence: ' + item.id);
    }
    const publications: Publication[] = [];
    for (const slot of run.skill.produces) {
      const priors = slot.alias === 'session-priors' && slot.kind === 'priors' && slot.schema === 'priors/1.0'
        && slot.path === 'outputs/priors.json' ? run.wiki_priors : undefined;
      const generated = priors?.length ? Buffer.from(JSON.stringify({
        _meta: { alias: slot.alias, kind: slot.kind, schema: slot.schema, role: slot.role },
        source_run_id: run.id,
        lookup_scopes: [...new Map(priors.map(item => [JSON.stringify(item.lookup_scope), item.lookup_scope])).values()],
        wiki: priors,
      })) : undefined;
      let discovered = 0;
      for (const path of generated ? [slot.path] : expandSlot(directory, slot.path)) {
        const bytes = generated ?? safeFile(directory, path);
        if (!bytes) continue;
        discovered++;
        if (bytes.length > maxArtifactBytes) errors.push('Artifact exceeds the size limit: ' + path);
        const meta = artifactMetadata(path, bytes);
        if (meta.kind !== slot.kind || meta.schema !== slot.schema || meta.role !== slot.role || meta.alias !== slot.alias) {
          errors.push('Artifact metadata does not match the Skill contract: ' + path);
        }
        if (workflowName(run.task.command).startsWith('ew-odyssey-') && path === 'outputs/session.json' &&
            workflowRecord(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), 'Odyssey checkpoint').current_state !== 'END') {
          errors.push('Finish the Odyssey domain checkpoint before sealing');
        }
        const artifact: Artifact = { ...meta, id: 'art-' + randomUUID(), path, run_id: run.id,
          sha256: workflowHash(bytes), derived_from: run.inputs, status: 'sealed', ...(generated ? { wiki_priors: true } : {}) };
        publications.push({ artifact, bytes });
      }
      if (!discovered && slot.required) errors.push('Required artifact: ' + slot.path);
    }
    const trace = safeFile(directory, 'knowledge-reads.json');
    if (trace && run.knowledge_reads) errors.push('Select a single Run knowledge receipt source');
    const knowledge = trace ? validateKnowledgeReads(JSON.parse(trace.toString('utf8'))) : run.knowledge_reads;
    if (trace && knowledge?.priors_reuse) errors.push('Run reuse evidence comes from bound artifact reads');
    const receipt = run.priors_reuse?.length
      ? { ...(knowledge ?? new KnowledgeReads().toJSON()), priors_reuse: run.priors_reuse } : knowledge;
    return { errors, publications, knowledge: receipt };
  }

  check(id: string, runId: string, gates: string[]) {
    const session = this.status(id);
    const run = findRun(session, runId);
    if (run.status === 'sealed') return {
      ...this.packet(session, run), completion_preflight: { ready: false, errors: ['Run is sealed'] },
      knowledge_reads: run.knowledge_reads,
    };
    const { errors, knowledge } = this.outputs(session, run, gates);
    return { ...this.packet(session, run), completion_preflight: { ready: errors.length === 0, errors }, knowledge_reads: knowledge };
  }

  completeRun(id: string, runId: string, summary: string, verdict: 'done' | 'done_with_concerns', gates: string[], change: Mutation) {
    return this.mutate(id, 'run.complete', change, { runId, summary, verdict, gates }, session => {
      const run = findRun(session, runId);
      changed(runId, change.runRevision, run.revision);
      const { errors, publications, knowledge } = this.outputs(session, run, gates);
      if (errors.length) throw new InputError(errors.join('\n'));
      const artifacts: Record<string, Artifact> = {};
      const aliases: Record<string, string> = {};
      for (const { artifact, bytes } of publications) {
        this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?)').run(id, artifact.id, bytes);
        artifacts[artifact.id] = artifact;
        if (artifact.alias) aliases[artifact.alias] = artifact.id;
      }
      Object.assign(session.artifacts, artifacts);
      session.aliases = { ...session.aliases, ...aliases };
      run.status = 'sealed';
      run.revision++;
      run.finished_at = new Date().toISOString();
      run.verdict = verdict;
      run.summary = requireText(summary, 'Run summary');
      run.knowledge_reads = knowledge;
      delete run.wiki_priors;
      delete run.priors_reuse;
      findStep(session, run.step_id).status = 'completed';
      return { ...this.packet(session, run), artifact_publication: { artifacts, aliases }, knowledge_reads: knowledge };
    });
  }

  transition(id: string, runId: string, status: 'running' | 'blocked' | 'failed' | 'cancelled', reason: string, change: Mutation) {
    return this.mutate(id, 'run.transition', change, { runId, status, reason }, session => {
      const run = findRun(session, runId);
      changed(runId, change.runRevision, run.revision);
      if ((run.status !== 'blocked' && run.status !== 'running') || run.status === status) throw new InputError('Invalid Run transition');
      run.status = status;
      run.revision++;
      run.summary = requireText(reason, 'transition reason');
      if (status === 'failed' || status === 'cancelled') {
        run.finished_at = new Date().toISOString();
        findStep(session, run.step_id).status = 'pending';
      }
      return this.packet(session, run);
    });
  }

  decide(id: string, decisionId: string, verdict: 'proceed' | 'fix' | 'escalate', summary: string, change: Mutation) {
    return this.mutate(id, 'run.decide', change, { decisionId, verdict, summary }, session => {
      const step = activeDecision(session);
      if (step?.decision_ref !== decisionId) throw new InputError('Select the pending decision');
      if (verdict === 'fix' && /^ew-odyssey-(security|defensive)$/.test(workflowName(step.command))) {
        throw new InputError('Route read-only audit findings to a separate remediation step');
      }
      step.decision = verdict;
      if (verdict === 'fix') {
        step.status = 'pending';
        delete step.decision;
      }
      return { decision_ref: decisionId, verdict, summary };
    });
  }

  completeSession(id: string, change: Mutation) {
    return this.mutate(id, 'session.complete', change, {}, session => {
      if (!session.steps.length || nextAction(session).action !== 'complete') throw new InputError('Resolve pending workflow steps and decisions');
      session.status = 'completed';
      session.completed_at = new Date().toISOString();
      const completion = evolveSessionReceipt({ ...session, revision: session.revision + 1 });
      return { status: session.status, completed_at: session.completed_at, completion_id: completion.id };
    });
  }

  team(id: string, runId: string, action: 'assign' | 'report' | 'cancel', assignment: Assignment, change: Mutation) {
    return this.mutate(id, 'team.' + action, change, { runId, assignment }, session => {
      const run = findRun(session, runId);
      if (run.skill.skill_id !== 'team-swarm' || run.status !== 'running') throw new InputError('Select a running Swarm Run');
      if (action !== 'report' && run.owner !== change.actor) throw new InputError('Use the Swarm coordinator identity');
      const taskId = workflowId(assignment.id, 'assignment ID');
      const roster = run.assignments ??= {};
      if (action === 'assign') {
        if (Object.hasOwn(roster, taskId)) throw new InputError('Assignment already exists: ' + taskId);
        workflowPath(assignment.path, '.json');
        if (!assignment.path.startsWith('outputs/') && !assignment.path.startsWith('work/team/scores/')) {
          throw new InputError('Assignment output belongs under outputs/ or work/team/scores/');
        }
        if (Object.values(roster).some(item => item.path === assignment.path && !item.cancellation)) throw new InputError('Another assignment owns this output');
        roster[taskId] = assignment;
      } else {
        const task = roster[taskId];
        if (!Object.hasOwn(roster, taskId) || task.result || task.cancellation) throw new InputError('Select an outstanding assignment');
        if (action === 'cancel') {
          task.cancellation = requireText(change.reason, 'assignment cancellation reason');
        } else {
          if (task.role !== change.actor) throw new InputError('Use the assigned worker identity');
          const bytes = safeFile(this.runDir(id, runId), task.path);
          if (!bytes) throw new InputError('Assignment artifact is required: ' + task.path);
          JSON.parse(bytes.toString('utf8'));
          task.result = { summary: requireText(assignment.result?.summary, 'assignment summary'), sha256: workflowHash(bytes) };
        }
      }
      return { run_id: run.id, assignment: roster[taskId] };
    });
  }

  teamList(id: string, runId: string) {
    return Object.values(findRun(this.status(id), runId).assignments ?? {});
  }

  swarmController(id: string, runId: string) {
    const run = this.brief(id, runId);
    if (run.skill_ref.skill_id !== 'team-swarm' || run.status !== 'running') throw new InputError('Select a running Swarm Run');
    const work = join(run.run_dir, 'work');
    const target = join(work, 'controller');
    mkdirSync(target, { recursive: true });
    for (const source of ['scripts/aco.py', 'scripts/pheromone.py', 'scripts/scoring.py', 'specs/swarm-config-template.json']) {
      const bytes = workflowBlob(this.root, run.skill_ref.commit, run.skill_ref.package_path + '/' + source);
      const name = source.split('/').at(-1)!;
      const existing = safeFile(run.run_dir, 'work/controller/' + name);
      if (existing && !existing.equals(bytes)) throw new InputError('Controller file changed: ' + name);
      if (!existing) writeFileSync(join(target, name), bytes, { flag: 'wx' });
    }
    return { controller_dir: target, script: join(target, 'aco.py'), config_template: join(target, 'swarm-config-template.json') };
  }

  recordKnowledge(id: string, runId: string, update: (trace: KnowledgeReads, pin: (prior: Omit<WikiPrior, 'content_sha256'>) => void) => void) {
    return transaction(this.db, () => {
      const session = this.status(id);
      const run = findRun(session, runId);
      if (run.status !== 'running') throw new InputError('Select a running Run for knowledge reads');
      const trace = new KnowledgeReads(run.knowledge_reads);
      update(trace, prior => {
        const hash = contentSha256(prior.content);
        const snapshots = (run.wiki_priors ??= []);
        const existing = snapshots.find(item => item.id === prior.id);
        if (existing && (existing.content_sha256 !== hash || JSON.stringify([existing.mode, existing.scope, existing.categories, existing.repositories]) !==
          JSON.stringify([prior.mode, prior.scope, prior.categories, prior.repositories]))) {
          throw new InputError('Wiki evidence changed during this Run: ' + prior.id);
        }
        if (!snapshots.some(item => item.id === prior.id && JSON.stringify(item.lookup_scope) === JSON.stringify(prior.lookup_scope))) {
          snapshots.push({ ...prior, content_sha256: hash });
        }
      });
      if (run.wiki_priors && Buffer.byteLength(JSON.stringify(run.wiki_priors)) > maxArtifactBytes) {
        throw new InputError('Wiki snapshot exceeds the Run artifact size limit');
      }
      run.knowledge_reads = trace.toJSON();
      const { continuation: _continuation, orchestration_revision: _revision, ...saved } = session;
      this.save(saved);
      return run.knowledge_reads;
    });
  }
}
