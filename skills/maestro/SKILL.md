---
name: maestro
disable-model-invocation: false
description: Route, brainstorm, analyze, plan, execute, review and recover work over one canonical Session/Run chain
argument-hint: <intent> [--goal <goal>] [--auto] [--resume <session-id>] [-y] [-c] [--amend]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - followup_task
  - interrupt_agent
  - list_agents
  - request_user_input
  - send_message
  - spawn_agent
  - spawn_agents_on_csv
  - update_plan
  - wait_agent
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.93
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

If any required file above was not expanded into context by the host, or its content is no longer in context, Read it explicitly before executing the state machine.

<deferred_reading>
- [Chain catalog](references/maestro.md) — read before initial intent classification.
- [Planning and chain creation](references/planning.md) — read when creating a Session chain.
- [Goal long-chain policy](references/goal.md) — read when `--goal` or a multi-stage outcome is present.
- [Brainstorm step](steps/brainstorm/SKILL.md) — read for exploration-first work.
- [Analyze step](steps/analyze/SKILL.md) — read for investigation and evidence production.
- [Review step](steps/review/SKILL.md) — read for quality review and findings.
- [Run loop and recovery](references/orchestrator-run-loop.md) — read before dispatching or resuming a Run.
- [Automatic execution policy](references/auto-policy.md) — read for `--auto` or goal long-chain mode.
- [Goal amendment](references/goal.md) — read for `--amend`.
</deferred_reading>

<purpose>
Route a user intent to the lightest sufficient execution path. For work requiring a durable chain, create one canonical topic Session through `maestro session open --chain <commands...>` and drive it through the shared Run loop. Recovery, verification and bounded retries use that same loop.
</purpose>

<goal_long_chain>
`--goal <goal>` selects the long-chain mode. Read `references/goal.md`, derive a boundary contract, observable completion conditions and a goal-to-step lifecycle, then keep every required stage in one Session chain. Insert a final goal audit before `session complete` when the chain has decomposition. A goal mode may add `brainstorm`, `analyze`, `plan`, `execute` and `review` steps, but those steps remain child steps of this Maestro Skill and never become separate top-level Skill invocations.
</goal_long_chain>

<interface>
Only these user flags are accepted:

- `-y` — skip all confirmation/clarification interactions, use default choices. Does NOT change data semantics (no auto-deferred decisions). Never bypasses: high-risk classification, confidence <60, ambiguity requiring user input, failed gates, or drift escalation.
- `-c` — continue the unique live compatible Session.
- `--resume <session-id>` — resume that exact Session using its status and current evidence. Resolve stuck Runs through the shared recovery procedure.
- `--auto` — use the bounded recovery and retry policy for this invocation. It retains the current authorization scope and the risk limits below.
- `--goal <goal>` — build a durable long-chain Session around the declared outcome.
- `--amend` — amend that Session's goal; remaining text is the change request.

Execution always dispatches run-executor (the default behavior); this never changes Session type or chain semantics.

All other text is intent. Unknown flags are not silently reinterpreted. Platform, roadmap, quality, template reuse, parallelism and adversarial depth are inferred.

All routing, chain creation, long-chain goal auditing and recovery stay inside this Maestro Skill. A confirmed single-Run route or a single Run authorized by the original `-y` proceeds through the shared loop. Lightweight work recommends Companion, campaign work recommends the exact campaign Skill, and multiple-step work stays in Maestro. Propose `--auto` for a route that needs bounded recovery and confirm before execution.
</interface>

<invariants>
1. **One chain** — every task uses the same Session/Run protocol; no static/dynamic or executor-specific Session type.
2. **Session before execution** — open via `maestro session open "<objective>" --id <slug> --chain <commands...>` before allocating a step Run.
3. **Creator owns decomposition** — Maestro creates `boundary_contract` and outcome-oriented goals; later orchestrators consume rather than overwrite them.
4. **Runtime owns mutation** — prompt never writes session.json/run.json and never auto-uses admin chain commands.
5. **Skill owns domain adaptation** — optional chain changes come only from the current Skill's validated `chain-proposal/1.0`.
6. **Verdict advances** — execution steps advance only through fenced `maestro run complete ... --advance --verdict done|done_with_concerns`; decision steps only through fenced `maestro run decide`.
7. **Historical similarity remains read-only evidence** — it never selects a Session or binds outputs.
8. **Compatibility commands are out of band** — normal orchestration calls only `maestro run ...`.
9. **Auto is bounded** — `-y` never bypasses high risk, low confidence, ambiguity, failed gates or drift escalation.
10. **Entry commands stay outside the chain** — each persisted step names the executing Skill or decision point directly.
11. **Running means continue** — while canonical continuation authority is `automatic`, execute it and re-read the receipt in the same turn; `suggest_only` is Runtime passivity, not a reason to end the turn.
</invariants>

<state_machine>

<states>
S_PARSE — parse intent and flags
S_CONTINUE — locate the unique live Session
S_RECOVER — run the shared recovery procedure for the selected Session
S_AMEND — audited goal amendment
S_CLASSIFY — select the smallest sufficient initial chain
S_DECOMPOSE — derive boundary, criteria and observable goals
S_CREATE — open via `session open --chain`
S_CONFIRM — confirm classification unless `-y`
S_RUN_LOOP — execute `orchestrator-run-loop.md`
S_FALLBACK — request missing intent or disambiguation
</states>

<transitions>
S_PARSE:
  → S_AMEND WHEN: `--amend`
  → S_CONTINUE WHEN: `--resume <session-id>` OR `-c`
  → S_CLASSIFY WHEN: intent present
  → S_FALLBACK OTHERWISE

S_CONTINUE:
  → S_RECOVER WHEN: selected Session has a stuck Run
  → S_RUN_LOOP WHEN: selected Session can continue, including an open decision gate
  → S_FALLBACK WHEN: the explicit ID is invalid, or legacy selection has none or multiple

S_RECOVER:
  → S_RUN_LOOP WHEN: shared recovery returns an executable continuation
  → END WHEN: recovery remains blocked or requires a user decision

S_AMEND:
  → S_RUN_LOOP WHEN: shared amend protocol committed
  → END WHEN: cancelled or blocked

S_CLASSIFY:
  → S_RUN_LOOP WHEN: existing compatible Session found (do not rebuild)
  → END WHEN: lightweight direct task completed and verified
  → S_DECOMPOSE WHEN: multi-step chain
  → S_CREATE WHEN: narrow/single-step chain
  → S_FALLBACK WHEN: confidence < 60

S_DECOMPOSE → S_CREATE
S_CREATE → S_RUN_LOOP WHEN: `-y` AND risk ≠ high AND confidence ≥ 60
S_CREATE → S_CONFIRM WHEN: `-y` AND (risk == high OR confidence < 60)
S_CREATE → S_CONFIRM OTHERWISE
S_CREATE → S_FALLBACK WHEN: creation fails (delete temp file, report error)
S_CONFIRM → S_RUN_LOOP WHEN: confirmed
S_CONFIRM → S_CLASSIFY WHEN: revised intent may reshape the chain
S_CONFIRM → END WHEN: cancelled
</transitions>

<actions>

### A_CLASSIFY

Read the linked chain catalog. Record matched evidence, excluded alternatives and confidence before creation. Execute clear, bounded work directly when it has no typed handoff, recovery or gate requirement. Select a single Run when one Skill provides all necessary evidence. Build a chain when several steps or decision points are required. Keep an explicit request for only a recommendation read-only.

Minimum chain rules:

| Intent evidence | Initial chain |
|---|---|
| narrow fix/change | analyze → plan → execute → review/test as required |
| broad rewrite/migration | analyze-macro → scope decision → plan/roadmap path |
| brainstorm/explore | `steps/brainstorm`, then only Skill-proposed continuation |
| stress/grill | grill, then only Skill-proposed continuation |
| formal specification | blueprint → plan path |
| existing compatible Session | do not rebuild; enter shared loop |

Roadmap is inferred only for multi-release evidence. Quality depth follows project specs, UI evidence needs frontend verification, and every executable command is resolved by Run Runtime.

### A_DECOMPOSE

For broad intent, ask at most 3 questions covering scope, constraints and observable done criteria; broad ambiguity is not skipped by `-y`. (broad = affects ≥3 modules OR requires cross-package interface changes OR ≥2 of 3 decomposition questions remain unanswered.) Produce:

```json
{
  "boundary_contract": { "in_scope": [], "out_of_scope": [], "constraints": [], "definition_of_done": "" },
  "decomposition": {
    "execution_criteria": [],
    "goals": [{ "id": "G1", "goal": "", "boundary": "", "done_when": "", "evidence": "", "lifecycle": [], "status": "pending" }],
    "changelog": []
  }
}
```

Goals describe outcomes, not lifecycle stages.

### A_CREATE

Follow the linked planning and chain-creation procedure for knowledge checks, Skill discovery, and chain creation.

- With `--auto` or `--goal`, a final quality, scope and goal decision is mandatory. Use the linked automatic execution policy for stage mapping, periodic checks for long chains, and the requirement for at least 2 independently releasable milestones before adding roadmap work. Regular chains retain their quality steps and gates.
- For narrow/single-step chains, generate a minimal implicit boundary_contract: in_scope = [intent], out_of_scope = [], constraints = [], definition_of_done = 'step completed with passing gates'.
- Do not inline unescaped JSON.

### A_CONTINUE

For `--resume`, read `maestro session status --session {session_id} --json` and reattach the exact Run using its Resume Packet. For `-c`, resolve a unique compatible live Session from the read-only list and status views, and ask when several match. A pending decision follows the declared continuation. A stuck Run follows the recovery section of `orchestrator-run-loop.md`. A completed or archived Session stays terminal for this invocation.

### A_AUTO

At an actionable continuation, evaluate the remaining scope, goal evidence and risks. Allow a retry only if the error is recoverable, the step is pending, and the retry budget permits it. Use the returned next action and current revision. A retry must consume new evidence or change the failing approach. Escalate exhausted retries, missing authorization, unresolved decisions, low confidence or a material departure from the confirmed goal.

At a decision gate, compare every pending goal's completion condition against the accumulated evidence. Use the linked automatic execution policy's confidence and risk rules before advancing. Keep the chain open when a decision needs more evidence or a user ruling.

Before any mutation run `maestro capabilities --json` and use the shared `session_run_minimal_v3` capability gate. Carry `session/3.0`, `run/3.0`, `run-response/1.2` and the fresh `orchestration_revision` through the shared loop. Confidence below 60 blocks the loop. After `run complete --json` or `run decide --json`, take any authorized automatic continuation. Terminal completion uses `maestro session complete`.

### A_AMEND

Read `goal.md`, use `maestro session status --session {session_id} --json` for the snapshot, perform read-only impact analysis, confirm, then apply the amendment through a chain-aware typed proposal: goal/decomposition metadata is committed with fenced `maestro session chain insert|replace` (per-step `--goal-ref` / `--stage` / `--decision-ref`). `session meta update` is session/1.x/2.0 compatibility-only and must not be used in the canonical branch. Any pending-tail change must come from a planning step inside this Maestro Skill.

</actions>

</state_machine>

<task_tracking>

**时机与操作**（plan 是 session 权威状态的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | update_plan 初始化步骤清单 | `update_plan({ plan: [{ step: "Step {index}: {step.skill}", status: "pending" }, ...] })` |
| Step 派发时 | update_plan 标记当前 step | `update_plan({ plan: [..., 当前 step status: "in_progress"] })` |
| Step 完成时 | update_plan 标记完成 | `update_plan({ plan: [..., 该 step status: "completed"] })` |
| Step 失败时 | update_plan + explanation 说明 | `update_plan({ explanation: "Step {index} failed: {reason}", plan: [...] })` |

</task_tracking>

<success_criteria>
- Public flags include `--auto`, `--resume <session-id>`, `-y`, `-c`, and `--amend`.
- Initial classification is auditable and the Session exists before step execution.
- Every step follows `run next` → brief → execute → `run check` → `run complete --advance`; decision nodes use `run decide`.
- Chain adaptation is Skill-proposed and atomically applied by the producing Run (`session chain insert|replace|skip`).
- Normal output and recommendations contain only `maestro run ...` lifecycle commands.
</success_criteria>

## Legacy `session/1.x/2.x` Compatibility Branch

The v2 command surface is **deprecated / compatibility-only** for explicitly selected old CLI/schema (see run-mode.md Legacy `session/1.x/2.x` Compatibility Branch): `maestro session create --chain-file`, `maestro session done --verdict`, `maestro session decide`, `maestro session meta update`, and the standalone `run prepare` dispatcher are never used by the canonical flow above. Normal orchestration calls only the v3 surface: `session open/status/list/chain insert|replace|skip/complete`, `run next/create/brief/check/complete --advance/decide/transition/cancel`, and `knowledge stage/review/promote`.
