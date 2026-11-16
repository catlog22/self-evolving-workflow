# Workflow: ew-auto-test

Unified layered automated test pipeline: `Route Source -> Plan Layers -> Write Tests -> Execute L0..L3 -> Diagnose & Iterate -> Publish & Seal`.

## Step 1: Resolve Source & Test Infrastructure

1. Complete the Knowledge Gate and inspect bound artifacts (`latest-verification`, `current-execution`, `latest-review`, `latest-debug`).
2. Identify the project's test runner, existing test patterns, fixture helpers, and coverage tooling.
3. Map target behaviors into ordered layers (`L0` unit, `L1` integration, `L2` API/CLI contract, `L3` E2E) and assign every spec-derived scenario a requirement trace ID (`outputs/traceability.md`).

## Step 2: Author Tests (`tests-generated` gate)

Skip file creation under `--dry-run` (emit plan only). Otherwise:
- Group independent scenario sets by non-overlapping new test files; fan out parallel test-authoring subagents (`invoke_subagent` / host equivalent, **always joined or cancelled before advancing**) if multiple modules are targeted.
- Verify each generated test actually exercises the target module and executes assertions (RED-first check when adding regression tests for known defects).
- Confirm zero edits to existing test files or production source.

## Step 3: Layered Execution & Bounded Convergence (`execution-converged` gate)

Run up to `--max-iter` rounds (default `5`):
1. Execute layers `L0 -> L1 -> L2 -> L3` sequentially; fail-fast if a lower layer breaks structurally.
2. When scenarios fail: dispatch read-only diagnosis (`test_defect` vs `app_defect`).
   - Fix `test_defect` (bad mock/setup in newly generated test) up to `3` attempts per scenario, then escalate.
   - Never alter production source for an `app_defect` — record it clearly for `ew-debug` / `ew-plan --gaps`.
3. Compute pass rate and confidence strictly from live command exit codes and test output counts.

## Step 4: Publish Report & Seal

1. Write `{run_dir}/outputs/auto-test-report.json` (`_meta: { kind: "auto-test-report", schema: "auto-test-report/1.0", role: "primary", alias: "latest-auto-test" }`, `route`, `iterations_run`, `layers`, `summary: { total, passed, failed, skipped, pass_rate }`, `app_defects[]`, `commands_run[]`; under `--dry-run`, populate `route` + planned layers + `summary: { total: <planned>, passed: 0, failed: 0, skipped: <planned>, pass_rate: null }` so sealing holds without fabricated runs) and `outputs/traceability.md`.
2. Write `{run_dir}/report.md` (`next` proposing `ew-debug --from-test` or `ew-plan --gaps` if `app_defects[]` remain).
3. Seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate tests-generated --gate execution-converged --summary "<summary>" --verdict done|done_with_concerns`. Stage reusable testing findings via `ew-knowledge`.
