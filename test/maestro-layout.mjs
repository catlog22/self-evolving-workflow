import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const maestro = join(project, 'skills', 'maestro');
const steps = ['brainstorm', 'analyze', 'plan', 'execute', 'review'];
const retiredCompanionName = ['maestro', 'companion'].join('-');
const topLevelForbidden = ['maestro-next', 'maestro-ralph', retiredCompanionName, 'analyze', 'plan', 'execute', 'brainstorm', 'review'];

function markdown(path) {
  assert.ok(existsSync(path), `Missing Markdown file: ${relative(project, path)}`);
  return readFileSync(path, 'utf8');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const entry = markdown(join(maestro, 'SKILL.md'));
assert.match(entry, /argument-hint:.*--goal <goal>/);
assert.match(entry, /<goal_long_chain>/);
assert.match(entry, /<knowledge_route>/);
assert.match(entry, /<companion_route>/);
assert.match(entry, /references\/goal\.md/);
assert.match(entry, /references\/knowledge-route\.md/);
assert.match(entry, /references\/companion-route\.md/);
for (const step of steps) assert.match(entry, new RegExp(`steps/${step}/SKILL\\.md`));

const companionRoute = markdown(join(maestro, 'references', 'companion-route.md'));
for (const marker of ['内部路由', 'companion` 步骤', 'Session/Run', 'analyze', 'plan', 'execute', 'review']) {
  assert.match(companionRoute, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const knowledgeRoute = markdown(join(maestro, 'references', 'knowledge-route.md'));
for (const marker of ['统一 Wiki', 'closeout', 'mode: constraint', 'mode: reference', 'wiki propose', 'workflow-evolve']) {
  assert.match(knowledgeRoute, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const goal = markdown(join(maestro, 'references', 'goal.md'));
for (const marker of ['evolve-session/1.0', 'goal_ref', 'session complete', 'pending-tail']) assert.match(goal, new RegExp(marker));

for (const step of steps) {
  const stepEntry = markdown(join(maestro, 'steps', step, 'SKILL.md'));
  assert.match(stepEntry, new RegExp(`name: ${step}\\b`));
  assert.match(stepEntry, /contract_version: 2\.1/);
}
markdown(join(maestro, 'steps', 'review', 'references', 'prepare.md'));
markdown(join(maestro, 'steps', 'review', 'references', 'workflow.md'));

for (const packageName of topLevelForbidden) {
  assert.equal(existsSync(join(project, 'skills', packageName)), false,
    `Independent package remains: skills/${packageName}`);
}

const staleTokens = new RegExp(`maestro-next|maestro-ralph|${retiredCompanionName}|ralph-amend-goal|skills\\/(?:analyze|plan|execute)\\/`);
for (const file of [...walk(join(project, 'skills')), ...walk(join(project, 'docs'))]) {
  if (!file.endsWith('.md')) continue;
  assert.doesNotMatch(readFileSync(file, 'utf8'), staleTokens, `Stale Skill reference: ${relative(project, file)}`);
}

for (const file of walk(maestro)) {
  if (!file.endsWith('.md')) continue;
  assert.doesNotMatch(readFileSync(file, 'utf8'), /maestro-knowledge|maestro-knowhow|maestro-spec/,
    `Independent knowledge route remains: ${relative(project, file)}`);
}

for (const file of walk(maestro)) {
  if (!file.endsWith('.md')) continue;
  const directory = dirname(file);
  for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1].split('#', 1)[0];
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|@|\/)/i.test(href)) continue;
    const target = join(directory, href);
    assert.ok(statSync(target, { throwIfNoEntry: false })?.isFile(),
      `Broken local Markdown link ${relative(project, file)} -> ${href}`);
  }
}

for (const file of walk(join(project, 'skills'))) {
  if (!file.endsWith('.md')) continue;
  assert.doesNotMatch(readFileSync(file, 'utf8'),
    /(?:\bmaestro\s+(?:run|session|delegate|execution|skills|capabilities|search|load|kg|knowledge|agent-msg)\b|mcp__maestro|~\/\.maestro)/,
    `External workflow command in ${relative(project, file)}`);
}

console.log(`Maestro layout passed: goal long-chain + ${steps.join(', ')} + internal Companion are inside one package; no legacy routing packages remain.`);
