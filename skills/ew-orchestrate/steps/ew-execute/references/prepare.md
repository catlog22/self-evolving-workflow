# Pre-flight: ew-execute

Verify plan availability, upstream compatibility, and execution invariants before running [workflow](workflow.md).

## Degradation Routing (when `current-plan` is absent)

Never proceed to Step 1+ or fabricate a plan artifact. Inspect injected upstreams and route:

| Available upstream | Scope | Action |
|---|---|---|
| `latest-review` | <=3 findings, each <=2 files | Close/cancel run -> Evolve internal Companion route with findings |
| `latest-review` | >3 findings or cross-module | Cancel Run -> `ew-plan --gaps` (or `ew-odyssey-planex`) |
| `latest-debug` (with fix-directions) | <=2 files vs >2 files | `ew-companion` if <=2 files; `ew-plan --gaps` (or `ew-odyssey-planex`) otherwise |
| None | — | Report `E001`, transition Run `blocked` / cancel, require `ew-plan` first |

Never call `run complete` without `outputs/execution.json` — exit degradation via `evolve run cancel` (or `evolve run transition ... blocked`) with current revision fences and record the re-route reason in `report.md` (`concerns`/`next`).

## Artifact Compatibility Recovery

For an incompatible sealed input, inspect it via `evolve run artifact-read`, cancel the attempt with current revision fences, insert a producer step ahead of the pending consumer to republish a derived compatibility artifact + receipt, verify publication, and dispatch via `evolve run next`. Never bypass with chain skip, Run rebind, registry mutation, or mutating the source artifact.

## Execution Invariants

- **Plan interpretation**: handle `source_format: pi-markdown` by deriving ordered tasks, dependencies, and acceptance checks from `markdown` without writing back over `current-plan`.
- **Same-wave safety & commits**: parallelize only non-colliding `files[]` per wave; atomic git commits run only when `--auto-commit` is enabled.
- **Evidence & smoke scope**: record real per-task commands, files, and convergence checks (<=3 fix attempts before `blocked` checkpoint + `upstream_blocked` propagation). `self-check` is only a scoped build/test smoke for `ew-review` — `gaps_found` does not block completion, and formal acceptance belongs to `ew-review`.
- **Incremental learnings & issues**: sync `issue_id` status on completion (confirm unless `-y`); hand off candidate staging to `ew-knowledge` (`evolve workflows show knowledge`) at wrap-up without writing Wiki files directly.
