---
refs:
  - path: ref/boundary-grill.md
    when: Task boundary or file write conflict
  - path: ref/tdd.md
    when: --tdd mode
  - path: ref/finish-work.md
    when: Wrapping up
---

# Pre-task Thinking: plan

## Purpose

The output of plan is "task JSON an executor can follow to finish the work," not a task-list overview. Understand the input and boundaries before you start.

## Input Interpretation

- Resolve input aliases through the Run packet's `upstream_aliases` and read the corresponding Artifact paths in `upstream` relative to the Session directory. `current-analysis` takes priority. `--gaps` consumes registered issues plus available `latest-review`, `latest-verification`, and `latest-debug` evidence. If there is no usable source, report E001. In a legacy Run, use its existing upstream data.
- How large is the scope? It determines single-agent vs 2+1 agent mode: ≤3 modules single agent (≤8 tasks); >3 modules 2+1 (2 parallel planners of ≤8 each + 1 synthesis agent, total ≤16). Module count is derived from milestone phase definitions and the analyze upstream.
- Is it a special mode? `--revise` loads an existing plan for incremental changes (skips preceding phases); `--check` is read-only validation; `--tdd` generates a test-first task chain (open [test-first planning](tdd.md)). All three bypass the standard create pipeline.

## Required Context

- With `session-priors`, reuse its document and reference context. For legacy Runs, reuse matching prior specs to avoid a second load.
- With `current-analysis`: read `findings.json#decisions` — locked as inviolable constraints, free left to the implementer's discretion, deferred explicitly excluded; `findings[]` and recommendation as task-scope input. If upstream gave implementation_scope, 1 scope item → 1 task.
- With `latest-review`/`latest-debug` (`--gaps`): preserve review finding IDs and severity, cluster shared root causes, and produce traceable fix tasks; issue-backed gaps keep bidirectional `issue_id` links.
- Pass the Run's `wiki_constraints` to the planner when the field is present. An empty list is a resolved result. Follow the workflow's legacy rules lookup when the field is absent.

## Boundaries and Invariants

- One feature = one task (even if it touches 3-5 files); never split by file.
- Merge simple unrelated changes into one batch task to reduce agent spawns.
- depends_on is only for real output dependencies; most tasks should be parallelizable.
- Each task should be substantial (15-60 minutes); trivial changes <5 minutes must be merged.

## Risk Checklist

- Does every task map to an acceptance/requirement ref? A task with no mapping is an out-of-scope artifact.
- Are convergence.criteria grep-verifiable? Subjective/referential phrasings like "looks correct", "properly configured", "align X with Y" are forbidden — you must write exact strings/values/command output.
- Do action and implementation contain concrete values? "Update config to match production" is bad — write the exact key/signature/import path. The executor only works from the task JSON; vague instructions produce shallow changes.
- Is read_first complete? At minimum it includes the modified files themselves + the source-of-truth files from context.
- Are there file write conflicts within the same wave? Only check `files[]` (write targets); `read_first[]` (read-only) is not a conflict. Detected conflicts must be re-arranged across waves.
- UI plan: does every delivery wave have ≥1 `[UI-observable]` convergence criterion? Vertical slices — do not split into pure-backend/pure-frontend tasks.

## Gate Intent

- `context-collected`: upstream context/exploration is loaded; no context source blocks with E001.
- `plan-generated`: plan.json + tasks are produced by the planner agent (inline planning in the main flow is FORBIDDEN).
- `plan-checked`: plan-checker passes or minor issues confirmed; boundary grill complete; pressure pass complete.
- `plan-confirmed`: artifacts are registered only after user confirmation (execute/modify/cancel).
