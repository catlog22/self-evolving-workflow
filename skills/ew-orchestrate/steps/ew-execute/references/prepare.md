---
refs:
  - path: ref/finish-work.md
    when: Wrapping up
---

# Pre-task Thinking: execute

## Purpose

The output of execute is "an implementation consistent with the real diff + traceable per-task evidence," not "it looks like it ran." Think through the execution boundaries and failure handling before you start.

## Degradation Routing (no plan)

When `current-plan` is absent (entry gate skipped, not failed), execute enters **degradation mode**. Assess the upstream that IS available and route:

| Available upstream | Scope | Route |
|---|---|---|
| `latest-review` (review-findings) | ≤3 findings, each ≤2 files | **Companion**: seal this run as `needs-retry` with verdict note "degraded to companion", then use Evolve's internal Companion route with the finding list as intent |
| `latest-review` (review-findings) | >3 findings or cross-module | **Odyssey planex**: seal this run as `needs-retry`, then `/odyssey-planex` with the review findings as requirement |
| `latest-debug` (diagnosis + fix-directions) | fix-directions present | **Companion** if ≤2 files; **Odyssey planex** otherwise |
| No upstream at all | — | **Abort**: report E001 "No plan and no alternative upstream; run plan first" |

Degradation close: complete the Run honestly with `evolve run complete <run_id> ... --verdict done_with_concerns --advance --json`（report.md `concerns` 记录 degradation reason 与 target command），或 `evolve run cancel <run_id> ... --json` 后重新派发目标命令。这保留 run 记录而不伪造 plan。（v2 的 `evolve session done <run_id> --verdict needs-retry` 为 deprecated/legacy-only。）

**Never fabricate a plan artifact to satisfy the gate.** The degradation path is the compliant escape.

## Input Interpretation

- When `current-plan` is present, follow the bound Artifact path described in the workflow. Stay within the waves and task scope declared in that plan.
- A `plan/1.0` artifact with `source_format: pi-markdown` is the approved external-Plan variant: treat `markdown` as the complete authoritative plan body. Derive the execution task order, dependencies, boundaries, risks, and acceptance checks explicitly from that Markdown before dispatch; do not require structured `task_ids` or `wave_ids`, and do not invent work absent from the Markdown.
- When `current-plan` is absent: follow the Degradation Routing table above. Do NOT proceed to Step 1+ without a plan.
- How is the execution method decided? `--method` specifies explicitly (agent / cli / auto), or auto-routes by domain (frontend / backend / general each go to their own executor). When the user names a tool, use `--executor` — don't guess.
- `--task TASK-ID` runs only a single task; without args, execute the full DAG/waves. Already-completed tasks resume from checkpoint and are not re-executed.
- `-y` auto mode skips all interactive questions (executor choice, inter-wave confirmation, blocked prompts); non-auto mode must stop and ask the user retry / skip / abort when a wave is blocked.

## Required Context

- With `current-plan`: for a structured Evolve Plan, read waves, dependency graph, collision report, and each task's convergence.criteria. For `source_format: pi-markdown`, use the derived task/dependency view from the authoritative `markdown` body and preserve every stated acceptance check as convergence criteria.
- With `session-priors`, reuse its document and reference context. For legacy Runs, reuse matching prior specs.
- Before dispatching a task, select coding rules for its exact paths as described in the workflow. For frontend or UI tasks include the `ui` category. The Run's Wiki snapshot remains authoritative even when the returned list is empty.
- The architecture doc `.workflow/codebase/ARCHITECTURE.md` and Wiki search results are injected as shared context into the executor. Reuse already-read IDs from `session-priors`, then run the incremental path-scoped query `agent-memory wiki references "<task keywords>" --skill ew-execute --category coding --path <target>` when the task adds a new path. On a failure or retry, run `agent-memory memory search "<error keywords>" --type error --scene execute` and read selected IDs with `agent-memory memory get <id>`.

## Boundaries and Invariants

### Artifact Compatibility Recovery

For an incompatible sealed input, inspect the bound input via `evolve run artifact-read` when the consumer has a Run. Cancel that attempt with the current revision fences, then place a producer step ahead of the pending consumer to publish a compatible artifact. Verify the new publication and dispatch the consumer using `evolve run next` and the current Session revision.

Migration must preserve the sealed source bytes and raw registry role/alias semantics. Never repair this boundary with chain skip, Run rebind, direct Artifact Registry edits/rewrites, or source Artifact mutation; semantic republish creates a derived compatibility Artifact and receipt instead.

- self-check is only a scoped build/test smoke over this run's changes (narrowest suites covering changed behavior; never a repository-wide matrix), **not** an acceptance conclusion — formal acceptance is in a separate verify run; never overstep to issue a verdict here.
- Write only source-code changes and this run's domain artifacts; protocol state (run completion, artifact registration) is handled by the CLI — do not manually edit state.
- After each task completes, do knowledge extraction per trigger conditions: deviations → arch constraints; retry_count ≥ 2 → debug fix mode; design_rationale → learning knowhow.
- Full knowledge extraction (constraints/decisions/terminology) and archiving go uniformly through `ref/finish-work.md`; execute only does incremental learnings.
- When a task carries `issue_id`, sync the issue status after completion (all task_refs done → resolved, any failure → in_progress); in non-auto mode, confirm before writing back.

## Risk Checklist

- Are there write conflicts within the same wave? Follow task deps and the collision report — only parallelize tasks with no write conflict; conflicting ones go to different waves.
- Does each task have real evidence? Files changed, commands/tests executed, and per-criterion pass/fail must all be recorded; do not mark done based on the executor's self-report alone.
- Has a single task exhausted 3 chances? Normal execution → focused retry → degraded execution; still failing records blocked and writes a checkpoint. Never fabricate completion.
- What about downstream of a blocked task? Propagate blocked along dependencies; downstream tasks with unmet dependencies are marked `upstream_blocked` — don't pretend they can run.
- Are changes out of bounds? Write only source-code changes and this run's domain artifacts; protocol state (run completion, artifact registration) is handled by the CLI — do not manually edit state.
- Are tech-stack constraints followed? The specs' allowed_languages / disallowed_imports must be scanned once after changes; a hit is critical.

## Gate Intent

- `execution-complete`: every task in the plan reaches a terminal state (done / blocked with checkpoint); `execution.json` is written and completed tasks carry a summary + status.
- `self-check-passed`: the gate fails only when the scoped build/test smoke over this run's changes was not run this round or an unhandled critical tech-stack violation (allowed_languages / disallowed_imports) remains. A self-check result of `gaps_found` does **not** block run completion — gaps are recorded as concerns in the report for the separate verify run to consume (formal acceptance lives in verify, not here).
