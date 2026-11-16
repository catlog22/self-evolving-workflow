# Pre-flight: ew-plan

Confirm inputs, agent topology, and non-negotiable task quality rules before running [workflow](workflow.md) (open [test-first planning](tdd.md) when `--tdd` is active):

- **Input resolution**: read upstream artifacts only via injected `upstream_aliases` (`current-analysis` takes priority; `--gaps` combines issues + `latest-review` + `latest-verification` + `latest-debug`). Fail with `E001` if no usable context exists.
- **Mode & topology**: `--revise` modifies an existing plan in place; `--check` validates read-only; `--tdd` enforces RED -> GREEN -> REFACTOR chains. Scope <=3 modules -> single planner subagent (<=8 tasks); >3 modules -> 2+1 split (<=16 tasks total). Inline planning in the main flow is forbidden.
- **Knowledge reuse**: consume bound `session-priors` without re-searching identical scope; query `wiki_context`/`wiki_reference` (or CLI `--reads`) when introducing new paths or categories, and forward resolved Wiki constraints to planners.
- **Task quality**: one feature = one task (vertical UI slices with >=1 `[UI-observable]` criterion per delivery wave; batch trivial <5-minute edits); concrete `action`/`implementation` values (no "align X with Y"); grep/command-verifiable `convergence.criteria`; complete `read_first[]`; no same-wave `files[]` write collisions.
