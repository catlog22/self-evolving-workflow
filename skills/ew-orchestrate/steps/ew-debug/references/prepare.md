# Pre-flight: ew-debug

Confirm entry mode, Knowledge Gate context, and strict read-only diagnosis invariants before running [workflow](workflow.md).

## Entry Modes

| Mode | Trigger | Symptom Source |
| --- | --- | --- |
| Standalone | `<issue>` description | Interactive collection (expected, actual, error, regression window, repro steps) + recent `git log`/`diff` |
| From test / review | `--from-test` or bound `latest-test` / `latest-review` | Failed scenarios / findings clustered by affected module or flow |
| Parallel | `--parallel` | One isolated debug subagent per non-overlapping failure cluster (all joined before synthesis) |
| Continuation | `-c` | Resume from prior failed Run's `evidence` / `understanding` via `run brief` |

Missing issue and no bound failure artifact -> error `E001`.

## Knowledge & Codebase Pre-load

1. Reuse bound `session-priors` (`debug`/`coding`); otherwise run `wiki_context` + `wiki_reference` and `memory_search` + `memory_get` (or CLI `evolve context "<symptom keywords>" --task debug --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"` + `--from-search <search-id>`) to check known pitfalls and prior fixes.
2. Run `evolve code search` / `evolve code callers` / `evolve code trace` after the Knowledge Gate to trace propagation paths.

## Scientific Boundaries (Iron Law)

- **Read-only on repository source**: never apply speculative quick fixes or edit production source files during diagnosis; temporary reproduction probes must be reverted or isolated to `{run_dir}/evidence/`. Fixing belongs to `ew-plan --gaps` -> `ew-execute`.
- **Evidence before confirmation**: a hypothesis stays `"suspected"` until backed by a live reproduction or concrete `file:line`/log evidence.
- **Single-variable testing & 3-strike escalation**: test one hypothesis at a time and record append-only observations in `{run_dir}/evidence/evidence.ndjson`. If 3 hypotheses fail, STOP proposing ad-hoc theories and escalate to architectural boundary inspection.
- **Backward tracing**: trace from symptom origin back to where valid data first turned invalid — fix root cause, never surface symptoms.
- **Exit gates**: `hypothesis-tested` (repro + isolated hypotheses logged) and `evidence-grounded` (pressure pass done, multi-factor confidence recorded, zero unaddressed contradicting evidence, actionable `affected_files` + `fix_direction`).
