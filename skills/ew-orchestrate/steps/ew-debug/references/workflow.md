# Workflow: ew-debug

Scientific root-cause pipeline: `Symptom Baseline -> Cluster -> Isolated Hypothesis Investigation -> Confidence & Pressure Pass -> Synthesis & Seal`.

## Step 1: Collect Symptoms & Baseline

1. Complete the Knowledge Gate and check bound inputs (`latest-test`, `latest-review`, `current-execution`).
2. Extract reproduction baseline: expected vs actual behavior, exact error output, `git log --oneline -10`, and minimal reproduction command (run and record exact exit code/output into `outputs/reproduction.json`).
3. Under `--from-test`, group failures into independent component/flow clusters.

## Step 2: Isolated Hypothesis Investigation (`hypothesis-tested` gate)

Dispatch an isolated read-only investigation subagent (`invoke_subagent` / host equivalent; in `--parallel` mode, one subagent per non-overlapping cluster; **join or cancel all spawned subagents cleanly before Step 3**).

Each investigator follows strict discipline:
1. Form 2–3 ranked hypotheses and test ONE variable at a time via backward tracing (`evolve code trace` + reproduction logs).
2. Append every test step, observed result, and `file:line` anchor to `{run_dir}/evidence/evidence[-<cluster>].ndjson` and summarize active state in `{run_dir}/evidence/understanding[-<cluster>].md`.
3. Enforce **3-strike stop**: after 3 falsified hypotheses without confirmation, stop guessing and report architectural contradiction (`INVESTIGATION INCONCLUSIVE` / architecture escalation).

## Step 3: Confidence Scoring & Pressure Pass (`evidence-grounded` gate)

Compute multi-factor confidence (`evidence_depth * 0.30 + evidence_strength * 0.25 + coverage_breadth * 0.20 + reproduction * 0.15 + consistency * 0.10`; `< 40%` low, `40–70%` medium, `> 70%` high) and run two mandatory checks before writing outputs:
- **Pressure Pass**: cross-check confirmed causes against every refuted hypothesis and contradicting observation.
- **Devil's Advocate** (when isolation `> 0.7`): verify whether the apparent cause hides a deeper upstream invariant violation.
- **Readiness check**: confirm evidence completeness `>= 40%`, pressure pass complete, zero unresolved contradicting evidence, and concrete `affected_files[]` + `fix_direction`.

## Step 4: Write Outputs & Seal

1. Write `{run_dir}/outputs/diagnosis.json` (`diagnosis/1.0`: `status: confirmed|partial|inconclusive`, `clusters[]`, `confidence`, `pressure_pass`), `{run_dir}/outputs/hypotheses.json`, `{run_dir}/outputs/reproduction.json`, and `{run_dir}/outputs/fix-directions.json` (actionable root cause + target `file:line` + verification criteria for `ew-plan --gaps`).
2. Write `{run_dir}/report.md` (`next` pointing to `ew-plan --gaps` when confirmed fixes are needed).
3. Seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate hypothesis-tested --gate evidence-grounded --summary "<summary>" --verdict done|done_with_concerns`. Stage verified pitfall/root-cause patterns after sealing via `ew-knowledge`.
