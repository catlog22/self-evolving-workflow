import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { InputError, requireText } from './common.js';
import type { SkillRouteDecision } from './skill-route.js';
import { draftSkillAddition } from './skill-addition.js';
import { changeSkillVersion, replaySkillAddition } from './skill-replay.js';

export const SKILL_DESIGN_TASK_VERSION = 'skill-design-task/1.0';
export const SKILL_DESIGN_RECEIPT_VERSION = 'skill-design-receipt/1.0';

export interface SkillDesignTask {
  schema_version: typeof SKILL_DESIGN_TASK_VERSION;
  id: string;
  created_at: string;
  route: 'skill-design';
  source: {
    closeout_id: string;
    candidate_id: string;
    evidence: string[];
    content: string;
  };
  target: {
    skill_id?: string;
    skill_version?: string;
    entry?: string;
  };
  design_request: {
    reasons: string[];
    instruction: string;
    acceptance: string[];
  };
}

export interface SkillDesignReceipt {
  schema_version: typeof SKILL_DESIGN_RECEIPT_VERSION;
  id: string;
  task_id: string;
  status: 'designed' | 'reviewed' | 'replayed' | 'applied' | 'rolled_back';
  runner: { path: string; sha256: string };
  design: { schema_version: 'skill-design/1.0'; task_id: string; draft: Record<string, unknown> };
  review?: { status: 'passed'; checks: string[] };
  replay_receipt_id?: string;
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function designRoot(root: string): string {
  return join(resolve(root), '.agent-memory', 'skill-design');
}

function taskPath(root: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new InputError('Expected an exact Skill design task ID');
  return join(designRoot(root), 'tasks', `${id}.json`);
}

function receiptPath(root: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new InputError('Expected an exact Skill design receipt ID');
  return join(designRoot(root), 'receipts', `${id}.json`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`Invalid ${field}`);
  return value as Record<string, unknown>;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new InputError(`Invalid ${field}`);
  }
  return [...new Set(value.map(item => item.trim()))];
}

function writeOnce(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) throw new InputError(`Skill design artifact changed: ${path}`);
    return false;
  }
  writeFileSync(path, content, { flag: 'wx' });
  return true;
}

function readTask(root: string, id: string): SkillDesignTask {
  const path = taskPath(root, id);
  if (!existsSync(path)) throw new InputError(`Skill design task not found: ${id}`);
  const task = object(JSON.parse(readFileSync(path, 'utf8')), 'Skill design task') as Partial<SkillDesignTask>;
  if (task.schema_version !== SKILL_DESIGN_TASK_VERSION || task.id !== id || task.route !== 'skill-design') {
    throw new InputError(`Invalid Skill design task: ${id}`);
  }
  return task as SkillDesignTask;
}

function readReceipt(root: string, id: string): SkillDesignReceipt {
  const path = receiptPath(root, id);
  if (!existsSync(path)) throw new InputError(`Skill design receipt not found: ${id}`);
  const receipt = object(JSON.parse(readFileSync(path, 'utf8')), 'Skill design receipt') as Partial<SkillDesignReceipt>;
  if (receipt.schema_version !== SKILL_DESIGN_RECEIPT_VERSION || receipt.id !== id ||
      !receipt.design || receipt.design.schema_version !== 'skill-design/1.0') {
    throw new InputError(`Invalid Skill design receipt: ${id}`);
  }
  return receipt as SkillDesignReceipt;
}

function saveReceipt(root: string, receipt: SkillDesignReceipt): void {
  const path = receiptPath(root, receipt.id);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
}

export function createSkillDesignTask(root: string, input: {
  closeoutId: string;
  candidateId: string;
  content: string;
  sources: string[];
  decision: SkillRouteDecision;
  skillId?: string;
  skillVersion?: string;
}): { id: string; path: string; task: SkillDesignTask; replayed: boolean } {
  if (input.decision.route !== 'skill-design' || !input.decision.invoke_meta_skill) {
    throw new InputError('Skill design task requires a skill-design route decision');
  }
  const skillId = input.skillId === undefined ? undefined : requireText(input.skillId, 'Skill ID');
  if (skillId && !/^[a-z0-9][a-z0-9-]*$/i.test(skillId)) throw new InputError('Invalid Skill ID for design task');
  const content = requireText(input.content, 'Skill design candidate content');
  const sources = stringList(input.sources, 'Skill design evidence');
  if (!sources.length) throw new InputError('Skill design task requires evidence');
  const taskBase: Omit<SkillDesignTask, 'id' | 'created_at'> = {
    schema_version: SKILL_DESIGN_TASK_VERSION,
    route: 'skill-design' as const,
    source: {
      closeout_id: requireText(input.closeoutId, 'closeout ID'),
      candidate_id: requireText(input.candidateId, 'candidate ID'),
      evidence: sources,
      content,
    },
    target: {
      ...(skillId ? { skill_id: skillId } : {}),
      ...(input.skillVersion ? { skill_version: requireText(input.skillVersion, 'Skill version') } : {}),
      ...(skillId ? { entry: `skills/${skillId}/SKILL.md` } : {}),
    },
    design_request: {
      reasons: input.decision.reasons,
      instruction: input.decision.meta_skill?.instruction ?? 'Design the smallest Skill package that captures the verified workflow.',
      acceptance: [
        'Preserve the evidence and target Skill identity.',
        'Keep the design in a candidate artifact until review passes.',
        'Return a replayable draft with at least one failing and one passing scenario.',
        'Use Markdown links for conditional procedure documents.',
      ],
    },
  };
  const id = hash(JSON.stringify(taskBase));
  const task: SkillDesignTask = { ...taskBase, id, created_at: new Date().toISOString() };
  const path = taskPath(root, id);
  const replayed = !writeOnce(path, JSON.stringify(task, null, 2) + '\n');
  return { id, path, task, replayed };
}

export function readSkillDesignTask(root: string, id: string): SkillDesignTask {
  return readTask(root, id);
}

export function runSkillDesign(root: string, taskId: string, runnerPath: string) {
  const task = readTask(root, taskId);
  const runner = resolve(requireText(runnerPath, 'design runner'));
  if (!existsSync(runner)) throw new InputError(`Design runner not found: ${runner}`);
  const output = execFileSync(process.execPath, [runner], {
    cwd: resolve(root), input: JSON.stringify({ task, task_id: task.id, root: resolve(root) }),
    encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000,
  });
  const design = object(JSON.parse(output), 'Skill design output');
  if (design.schema_version !== 'skill-design/1.0' || design.task_id !== task.id) {
    throw new InputError('Design runner returned an invalid Skill design envelope');
  }
  const draft = object(design.draft, 'Skill design draft');
  const designReceipt: SkillDesignReceipt = {
    schema_version: SKILL_DESIGN_RECEIPT_VERSION,
    id: hash(JSON.stringify([task.id, design])),
    task_id: task.id,
    status: 'designed',
    runner: { path: runner, sha256: hash(readFileSync(runner)) },
    design: { schema_version: 'skill-design/1.0', task_id: task.id, draft },
  };
  const path = receiptPath(root, designReceipt.id);
  const replayed = !writeOnce(path, JSON.stringify(designReceipt, null, 2) + '\n');
  return { ...designReceipt, path, replayed };
}

export function reviewSkillDesign(root: string, designId: string) {
  const receipt = readReceipt(root, designId);
  const task = readTask(root, receipt.task_id);
  const draft = receipt.design.draft;
  const baseline = object(draft.baseline, 'Skill design baseline');
  const entry = resolve(requireText(baseline.path, 'Skill design baseline path'));
  if (!task.target.entry || entry.replaceAll('\\', '/') !== resolve(root, task.target.entry).replaceAll('\\', '/')) {
    throw new InputError('Skill design target does not match its task');
  }
  const priority = draft.priority;
  if (priority !== 'high' && priority !== 'normal' && priority !== 'low') {
    throw new InputError('Invalid Skill design priority');
  }
  const regenerated = draftSkillAddition({
    entry,
    priority,
    instruction: requireText(draft.instruction, 'Skill design instruction'),
    sources: stringList(draft.sources, 'Skill design sources'),
    when: draft.when === undefined ? undefined : requireText(draft.when, 'Skill design trigger'),
  });
  if (regenerated.id !== draft.id || regenerated.baseline.sha256 !== baseline.sha256 ||
      JSON.stringify(regenerated.changes) !== JSON.stringify(draft.changes)) {
    throw new InputError('Skill design draft does not reproduce from its target baseline');
  }
  receipt.status = 'reviewed';
  receipt.review = { status: 'passed', checks: ['target matches task', 'draft reproduces from baseline', 'evidence is present'] };
  saveReceipt(root, receipt);
  return receipt;
}

export function replaySkillDesign(root: string, designId: string, options: { runner: string; scenarios: unknown }): SkillDesignReceipt & { replay: Record<string, unknown> } {
  const receipt = readReceipt(root, designId);
  if (receipt.status !== 'reviewed' && receipt.status !== 'replayed') {
    throw new InputError('Review the Skill design before replay');
  }
  const replay = replaySkillAddition(root, receipt.design.draft, options) as unknown as Record<string, unknown>;
  receipt.status = 'replayed';
  receipt.replay_receipt_id = requireText(replay.id, 'replay receipt ID');
  saveReceipt(root, receipt);
  return { ...receipt, replay };
}

export function applySkillDesign(root: string, designId: string, rollback = false) {
  const receipt = readReceipt(root, designId);
  if (!receipt.replay_receipt_id) throw new InputError('Replay the Skill design before applying it');
  if (!rollback && receipt.status !== 'replayed' && receipt.status !== 'applied') {
    throw new InputError('Skill design is not ready for application');
  }
  const result = changeSkillVersion(root, receipt.replay_receipt_id, rollback);
  receipt.status = rollback ? 'rolled_back' : 'applied';
  saveReceipt(root, receipt);
  return { ...result, design_id: designId, replay_receipt_id: receipt.replay_receipt_id };
}
