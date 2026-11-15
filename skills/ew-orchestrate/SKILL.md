---
name: ew-orchestrate
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

<deferred_reading>
- [Chain catalog](references/ew-orchestrate.md) — read before initial intent classification.
- [Planning and chain creation](references/planning.md) — read when creating a Session chain.
- [Goal long-chain policy](references/goal.md) — read when `--goal` or a multi-stage outcome is present.
- [Brainstorm step](steps/ew-brainstorm/SKILL.md) — read for exploration-first work.
- [Analyze step](steps/ew-analyze/SKILL.md) — read for investigation and evidence production.
- [Plan step](steps/ew-plan/SKILL.md) — read for decomposition and executable task planning.
- [Execute step](steps/ew-execute/SKILL.md) — read for implementation and self-checks.
- [Review step](steps/ew-review/SKILL.md) — read for quality review and findings.
- [Run loop and recovery](references/orchestrator-run-loop.md) — read before dispatching or resuming a Run.
- [Automatic execution policy](references/auto-policy.md) — read for `--auto` or goal long-chain mode.
- [Goal amendment](references/goal.md) — read for `--amend`.
- [Knowledge route](references/knowledge-route.md) — read for Wiki, Closeout, migration and knowledge intents.
- [Companion route](references/companion-route.md) — read for small, mechanically clear tasks.
</deferred_reading>

<purpose>
Route a user intent to the lightest sufficient execution path. For work requiring a durable chain, create one canonical topic Session through `evolve session open --chain <commands...>` and drive it through the shared Run loop. Recovery, verification and bounded retries use that same loop.
</purpose>

<goal_long_chain>
`--goal <goal>` selects the long-chain mode. Read `references/goal.md`, derive a boundary contract, observable completion conditions and a goal-to-step lifecycle, then keep every required stage in one Session chain. Insert a final goal audit before `session complete` when the chain has decomposition. A goal mode may add `ew-brainstorm`, `ew-analyze`, `ew-plan`, `ew-execute` and `ew-review` steps, but those steps remain child steps of this Evolve Skill and never become separate top-level Skill invocations.
</goal_long_chain>

<knowledge_route>
Knowledge, Wiki, closeout, migration, constraint and reference intents stay inside this Evolve Skill. Read `references/knowledge-route.md` and route them to the unified Agent Memory Wiki flow. `workflow-closeout` is a compatibility entry that points back to the same route. Do not dispatch independent legacy knowledge Skills.
</knowledge_route>

<companion_route>
Small, mechanically clear tasks stay inside this Evolve Skill through `references/companion-route.md`. Companion uses the canonical Session/Run lifecycle with one bounded `ew-companion` step. It never becomes an independent Skill and escalates to `ew-analyze`, `ew-plan`, `ew-execute` or `ew-review` when its self-check fails.
</companion_route>

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

All routing, chain creation, long-chain goal auditing and recovery stay inside this Evolve Skill. A confirmed single-Run route or a single Run authorized by the original `-y` proceeds through the shared loop. Lightweight work uses the internal Companion route, campaign work recommends the exact campaign Skill, and multiple-step work stays in Evolve. Propose `--auto` for a route that needs bounded recovery and confirm before execution.
</interface>

<invariants>
1. **One chain** — every task uses the same Session/Run protocol; no static/dynamic or executor-specific Session type.
2. **Session before execution** — open via `evolve session open "<objective>" --id <slug> --chain <commands...>` before allocating a step Run.
3. **Creator owns decomposition** — Evolve creates `boundary_contract` and outcome-oriented goals; later orchestrators consume rather than overwrite them.
4. **Runtime owns mutation** — prompt never writes session.json/run.json and never auto-uses admin chain commands.
5. **Skill owns domain adaptation** — optional chain changes come only from the current Skill's validated `chain-proposal/1.0`.
6. **Verdict advances** — execution steps advance only through fenced `evolve run complete ... --advance --verdict done|done_with_concerns`; decision steps only through fenced `evolve run decide`.
7. **Historical similarity remains read-only evidence** — it never selects a Session or binds outputs.
8. **Compatibility commands are out of band** — normal orchestration calls only `evolve run …`.
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
S_COMPANION — execute the internal bounded Companion route
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
  → S_COMPANION WHEN: intent satisfies the Companion self-check
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
S_COMPANION → END WHEN: bounded Run completed and verified
S_COMPANION → S_CLASSIFY WHEN: self-check fails or the task expands
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

### A_COMPANION

Read `references/companion-route.md`. Confirm the task has one bounded concern, a named target and a direct verification path. Create one Session chain with a single `ew-companion` step, then use the shared Run loop. If the task requires investigation, planning, multiple execution stages, a typed handoff or a separate gate, return to classification and choose the smallest sufficient full route.

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

For `--resume`, read `evolve session status --session {session_id} --json` and reattach the exact Run using its Resume Packet. For `-c`, resolve a unique compatible live Session from the read-only list and status views, and ask when several match. A pending decision follows the declared continuation. A stuck Run follows the recovery section of `orchestrator-run-loop.md`. A completed or archived Session stays terminal for this invocation.

### A_AUTO

At an actionable continuation, evaluate the remaining scope, goal evidence and risks. Allow a retry only if the error is recoverable, the step is pending, and the retry budget permits it. Use the returned next action and current revision. A retry must consume new evidence or change the failing approach. Escalate exhausted retries, missing authorization, unresolved decisions, low confidence or a material departure from the confirmed goal.

At a decision gate, compare every pending goal's completion condition against the accumulated evidence. Use the linked automatic execution policy's confidence and risk rules before advancing. Keep the chain open when a decision needs more evidence or a user ruling.

Use the Evolve lifecycle from the shared execution guide. Retain the current revision after each mutation and follow continuation.action. Confidence below 60 requires review before proceeding.

### A_AMEND

Read `goal.md`, use `evolve session status --session {session_id} --json` for the snapshot, perform read-only impact analysis, confirm, then apply the amendment through a chain-aware typed proposal: goal/decomposition metadata is committed with fenced `evolve session chain insert|replace` (per-step `--goal-ref` / `--stage` / `--decision-ref`). Any pending-tail change must come from a planning step inside this Evolve Skill.

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
- Follow the packet from `run next`, execute the step and seal it with `run complete`. Use `run decide` at decision nodes and `run check` to diagnose a failed completion.
- Chain adaptation is Skill-proposed and atomically applied by the producing Run (`session chain insert|replace|skip`).
- Normal output and recommendations contain only `evolve run …` lifecycle commands.
</success_criteria>
