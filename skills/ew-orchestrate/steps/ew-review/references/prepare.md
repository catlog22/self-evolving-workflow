# Pre-flight: ew-review

Confirm audit target, bound context, and read-only invariants before running [workflow](workflow.md).

## Input & Mode

- **Default (`current-execution`)**: read bound `current-execution` (`read_artifact` / `evolve run artifact-read`) and audit its changed files and git diff.
- **Explicit `<target>`**: file/directory path, `HEAD` / `staged` (`git diff`), or commit/PR range.
- **`--tier quick`**: focused pass on changed hunks (`correctness` + `security` + regressions).
- **`-y`**: skip optional confirmation prompts; never suppress findings, missing evidence, or gate checks.

## Boundaries & Invariants

- **Read-only audit**: never edit repository source files; write Run outputs only under `{run_dir}/outputs/` and `{run_dir}/report.md`.
- **Knowledge reuse**: consume `session-priors` for covered `review`/`coding` scope; query `wiki_context` + `wiki_reference` and `memory_search` + `memory_get` (or CLI `--reads` / `--from-search`) whenever the target introduces new paths or categories.
- **Evidence-first**: audit all 4 dimensions (`correctness`, `security`, `performance`, `architecture`, or `correctness`+`security` in quick tier); every finding requires verified `file:line`, observed evidence, accurate severity (`critical|high|medium|low`), and concrete remediation.
- **Zero-residual check & routing**: verify claimed fixes and test results against disk state without collapsing distinct root causes. Route actionable multi-tier fixes via `outputs/review.json` + `next` (`ew-plan` / `ew-execute`, or `ew-odyssey-review` for an iterative repair campaign).
