---
name: ew-orchestrate
disable-model-invocation: false
description: Route, brainstorm, analyze, plan, execute, review and recover work over one canonical Session/Run chain
argument-hint: <intent> [--goal <goal>] [--auto] [--resume <session-id>] [-y] [-c] [--amend]
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.6.0
---

<deferred_reading>
- [Chain catalog](references/ew-orchestrate.md) — initial intent classification.
- [Planning and chain creation](references/planning.md) — Session chain creation and decomposition.
- [Automatic & goal policy](references/auto-policy.md) — `--auto` and `--goal` long-chain stage mapping, build rules, and decision gates.
- [Goal amendment](references/goal.md) — `--amend` pending-tail change protocol.
- [Run loop and recovery](references/orchestrator-run-loop.md) — fenced `evolve` CLI dispatch, MCP/CLI reads, and recovery.
- [Knowledge route](references/knowledge-route.md) — Wiki, Closeout, migration, and `workflow-evolve` routing.
- [Companion route](references/companion-route.md) — bounded `ew-companion` fast path.
- Steps (loaded when dispatched): [ew-brainstorm](steps/ew-brainstorm/SKILL.md), [ew-analyze](steps/ew-analyze/SKILL.md), [ew-plan](steps/ew-plan/SKILL.md), [ew-execute](steps/ew-execute/SKILL.md), [ew-review](steps/ew-review/SKILL.md).
</deferred_reading>

<purpose>
Route a user intent to the lightest sufficient execution path. For durable multi-step work, open one canonical topic Session (`evolve session open`) and drive it through the shared Run loop (`orchestrator-run-loop.md`).
</purpose>

## Routing Boundaries

<goal_long_chain>
`--goal <goal>` selects long-chain mode. Read `references/auto-policy.md` (and `references/goal.md` when `--amend` is present) to derive a boundary contract, observable goals, and a goal-to-step lifecycle inside one Session chain, inserting a final goal audit before `session complete` when decomposed. Child steps (`ew-brainstorm`, `ew-analyze`, `ew-plan`, `ew-execute`, `ew-review`) remain steps of this Session rather than standalone Skill invocations.
</goal_long_chain>

<knowledge_route>
Knowledge, Wiki, closeout, migration, constraint, and reference intents stay inside this Skill: read `references/knowledge-route.md` and route via the unified Agent Memory Wiki flow.
</knowledge_route>

<companion_route>
Small, mechanically clear tasks use `references/companion-route.md` (one bounded `ew-companion` step on the canonical Session/Run lifecycle), escalating to `ew-analyze`/`ew-plan`/`ew-execute`/`ew-review` if scope expands or self-check fails.
</companion_route>

## Public Flags & Host Mapping

- `-y` — auto-confirm low-risk classification and proposals; NEVER bypasses high risk, confidence < 60, ambiguity requiring user input, failed gates, or drift escalation.
- `-c` — continue the unique live compatible Session (ask if 0 or >1 match).
- `--resume <session-id>` — resume exact Session via `evolve session status` / `evolve run brief`.
- `--auto` — bounded automatic recovery/retry policy (`auto-policy.md`) within current authorization.
- `--goal <goal>` — durable outcome-driven chain (`auto-policy.md`).
- `--amend` — amend live Session goal (`references/goal.md`); remaining text is the change request.
- **Host capabilities**: map subagent/parallel steps to the host's native tools (`invoke_subagent` / `swarm` / `run_workflow` in Antigravity, joining or cancelling all spawned subagents; `spawn_agent` / `wait_agent` in Codex), user prompts to `ask_question` / `request_user_input`, and web search to `search_web`.

<invariants>
1. **One chain** — one canonical Session/Run protocol; no executor-specific Session types.
2. **Session before execution** — `evolve session open` precedes allocating any step Run.
3. **Creator owns decomposition** — Evolve defines `boundary_contract` and outcome `goals`; downstream steps consume without overwriting.
4. **Runtime owns mutation** — never edit SQLite/protocol state directly or bypass fenced CLI/MCP commands.
5. **Skill owns domain adaptation** — chain updates come only from a Run's validated `chain-proposal/1.0`.
6. **Verdict advances** — advance execution steps only via fenced `evolve run complete ... --verdict done|done_with_concerns`, and decision steps via fenced `evolve run decide` (exact CLI syntax in `orchestrator-run-loop.md`).
7. **Historical similarity is read-only** — never selects a Session or binds outputs.
8. **Auto is bounded** — `-y` never skips high risk, low confidence, ambiguity, failed gates, or drift halts.
9. **Running means continue** — when continuation authority is `automatic`, execute the next action and re-read the receipt in the same turn.
</invariants>

<state_machine>
```text
S_PARSE:
  -> S_AMEND    WHEN --amend                  (follow references/goal.md)
  -> S_CONTINUE WHEN --resume <id> OR -c      (resolve live Session; stuck Run -> S_RECOVER)
  -> S_CLASSIFY WHEN intent present           (follow references/ew-orchestrate.md + planning.md)
  -> S_FALLBACK OTHERWISE                     (ask for intent / disambiguation)

S_CLASSIFY:
  -> S_RUN_LOOP WHEN existing compatible Session found
  -> END        WHEN lightweight direct task needs no typed handoff/gate and is verified
  -> S_COMPANION WHEN Companion self-check passes (references/companion-route.md)
  -> S_DECOMPOSE -> S_CREATE WHEN multi-step/broad (>=3 modules or cross-package or >=2 open scope/constraint/DoD questions)
  -> S_CREATE   WHEN narrow/single-step chain
  -> S_FALLBACK WHEN confidence < 60

S_CREATE -> S_RUN_LOOP WHEN -y AND risk != high AND confidence >= 60 (else S_CONFIRM)
S_CONFIRM -> S_RUN_LOOP (confirmed) | S_CLASSIFY (revised) | END (cancelled)
S_COMPANION -> END (verified) | S_CLASSIFY (scope expands / self-check fails)
```
</state_machine>

<task_tracking>
Keep any host UI plan mirrored (never authoritative over SQLite Session state): initialize steps after `session open`, mark `in_progress` on `run next`, `completed` on `run complete`, and record failure reason on `run transition failed`.
</task_tracking>

<success_criteria>
- Classification is auditable (`ew-orchestrate.md`) and Session exists before step execution.
- Steps execute via `run next`, seal via `run complete`, decide via `run decide`, and recover via `run check` / `run brief`.
- Chain amendments use fenced `session chain insert|replace|skip`; reusable findings follow `references/knowledge-route.md`.
</success_criteria>
