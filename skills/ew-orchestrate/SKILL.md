---
name: ew-orchestrate
description: Route, initialize, brainstorm, grill, blueprint, roadmap, analyze, plan, execute, verify, test, debug, review, retrospect and recover work over one canonical Session/Run chain
argument-hint: <intent> [--goal <goal>] [--auto] [--resume <session-id>] [-y] [-c] [--amend]
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.7.1
---

<deferred_reading>
- [Chain catalog](references/ew-orchestrate.md) — initial intent classification, cold-start fallback, and step thresholds.
- [Planning and chain creation](references/planning.md) — Session chain creation, readonly status short-circuit, and decomposition.
- [Automatic & goal policy](references/auto-policy.md) — `--auto` and `--goal` long-chain stage mapping, decision gates, and retry guards.
- [Goal amendment](references/goal.md) — `--amend` pending-tail change protocol.
- [Run loop and recovery](references/orchestrator-run-loop.md) — fenced `evolve` CLI dispatch, MCP/CLI reads, and recovery.
- [Companion route](references/companion-route.md) — bounded `ew-companion` fast path.
- Steps (loaded when dispatched): [ew-companion](steps/ew-companion/SKILL.md), [ew-init](steps/ew-init/SKILL.md), [ew-brainstorm](steps/ew-brainstorm/SKILL.md), [ew-grill](steps/ew-grill/SKILL.md), [ew-blueprint](steps/ew-blueprint/SKILL.md), [ew-roadmap](steps/ew-roadmap/SKILL.md), [ew-analyze](steps/ew-analyze/SKILL.md), [ew-plan](steps/ew-plan/SKILL.md), [ew-execute](steps/ew-execute/SKILL.md), [ew-verify](steps/ew-verify/SKILL.md), [ew-test](steps/ew-test/SKILL.md), [ew-auto-test](steps/ew-auto-test/SKILL.md), [ew-review](steps/ew-review/SKILL.md), [ew-debug](steps/ew-debug/SKILL.md), [ew-retrospective](steps/ew-retrospective/SKILL.md).
</deferred_reading>

<purpose>
Route a user intent to the lightest sufficient execution path. For durable multi-step or verifiable edit work, open one canonical topic Session (`evolve session open`) and drive it through the shared Run loop (`orchestrator-run-loop.md`). Standalone knowledge governance, closeout harvesting, Wiki publication, and legacy migration route to `ew-knowledge` (`evolve workflows show knowledge`).
</purpose>

## Routing Boundaries

<goal_long_chain>
`--goal <goal>` selects long-chain mode. Read `references/auto-policy.md` (and `references/goal.md` when `--amend` is present) to derive `boundary_contract` and observable `goals` persisted on `evolve session open` (`--boundary-contract`, `--goals`, `--goal-mode`, `--auto`), binding `post-goal-audit` before `session complete`. Child steps under `steps/` remain steps of this Session rather than standalone Skill invocations.
</goal_long_chain>

<companion_route>
Any bounded, mechanically clear task that **modifies workspace files or runs state-changing verification** with a single focus and no typed handoff uses `references/companion-route.md` (`ew-companion` on the canonical Session/Run lifecycle), escalating to `ew-analyze`/`ew-plan`/`ew-execute`/`ew-verify`/`ew-review` if scope expands or self-check fails. Pure read-only Q&A or status/CLI queries exit via `END` without opening a Session.
</companion_route>

## Public Flags & Host Mapping

- `-y` — auto-confirm low-risk classification and proposals; NEVER bypasses high risk, confidence < 60, ambiguity requiring user input, failed gates, or drift escalation (and NEVER authorizes Wiki publication).
- `-c` — continue the unique live compatible Session (ask if 0 or >1 match).
- `--resume <session-id>` — resume exact Session via `evolve session status` / `evolve run brief`.
- `--auto` — sets `policy.auto_mode` (`continuation.authority = automatic`) with bounded retries (`--retry-max`) and recovery policy (`auto-policy.md`).
- `--goal <goal>` — durable outcome-driven chain (`--goal-mode`, `auto-policy.md`).
- `--amend` — amend live Session goal (`references/goal.md`, appends `CHG-NNN`).
- **Host capabilities**: map subagent/parallel steps to the host's native tools (`invoke_subagent` / `swarm` / `run_workflow` in Antigravity, joining or cancelling all spawned subagents; `spawn_agent` / `wait_agent` in Codex), user prompts to `ask_question` / `request_user_input`, web search to `search_web`, and browser acceptance to `browser` subagent / Playwright / Chrome DevTools.

<invariants>
1. **One chain** — one canonical Session/Run protocol; no executor-specific Session types.
2. **Session before execution** — `evolve session open` precedes allocating any step Run (except read-only `END` queries or pre-Git bootstrap).
3. **Creator owns decomposition** — Evolve persists `boundary_contract` and outcome `goals` on the Session; downstream steps consume without overwriting.
4. **Runtime owns mutation** — never edit SQLite/protocol state directly or bypass fenced CLI/MCP commands.
5. **Coordinator proposal & gate discipline** — chain updates follow Run `report.md` `next` (`chain-proposal/1.0`, validated at Run completion) and fenced `evolve session chain insert|replace|skip` + `evolve run decide`. Decision-gate thresholds (`CONFIDENCE_SCORE < 60`, `REGROUND_HALT`) are enforced by the coordinator alongside Runtime `--confidence` / `--target-step` validation.
6. **Verdict advances** — advance execution steps only via fenced `evolve run complete ... --verdict done|done_with_concerns`, and decision steps via fenced `evolve run decide` (exact CLI syntax in `orchestrator-run-loop.md`).
7. **Historical similarity is read-only** — never selects a Session or binds outputs.
8. **Auto is bounded** — `-y` never skips high risk, low confidence, ambiguity, failed gates, or drift halts.
9. **Running means continue** — when `continuation.authority` is `automatic`, execute the next action and re-read the receipt in the same turn without ending on soft warnings.
</invariants>

<state_machine>
```text
S_PARSE:
  -> S_AMEND    WHEN --amend                  (follow references/goal.md)
  -> S_CONTINUE WHEN --resume <id> OR -c      (resolve live Session; stuck/blocked Run -> S_RECOVER)
  -> S_CLASSIFY WHEN intent present           (follow references/ew-orchestrate.md + planning.md)
  -> S_FALLBACK OTHERWISE                     (ask for intent / disambiguation)

S_CLASSIFY:
  -> S_RUN_LOOP  WHEN existing compatible open Session found (or `status` read-only short-circuit)
  -> END         WHEN pure read-only Q&A or info lookup modifying no files
  -> S_COMPANION WHEN single-focus change/check needs no typed handoff or decision gate (references/companion-route.md)
  -> S_DECOMPOSE -> S_CREATE WHEN multi-step/broad (>=3 modules or cross-package or >=2 open scope/constraint/DoD questions)
  -> S_CREATE    WHEN narrow/single-step chain needing typed artifact/gate
  -> S_FALLBACK  WHEN confidence < 60

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
- Steps execute via `run next`, seal via `run complete`, decide via `run decide`, and recover via `run check` / `run brief` / `run transition`.
- Chain amendments use fenced `session chain insert|replace|skip`; post-session closeout and Wiki governance hand off to `ew-knowledge`.
</success_criteria>
