# Workflow: ew-retrospective

Four-lens retrospective: `Load Evidence -> Parallel Lens Analysis -> Synthesize & Compare -> Route Insights -> Seal`.

## Step 1: Load Read-Only Evidence

1. Complete the Knowledge Gate and load bound artifacts (`current-execution`, `latest-verification`, `latest-review`) plus `evolve session status` timeline and any `--compare` prior retrospective.
2. Verify source artifacts remain untouched throughout analysis.

## Step 2: Independent Four-Lens Analysis (`lenses-complete` gate)

Run one read-only subagent per selected lens in parallel (`invoke_subagent` / host equivalent, **join or cancel all spawned subagents cleanly before synthesis**):
1. **`technical`**: architectural trade-offs, coupling surprises, brittle APIs, code patterns worth reusing or avoiding.
2. **`process`**: estimation drift, blocked gates, unclear plan boundaries, wasted retries or missing pre-flight context.
3. **`quality`**: missed edge cases, test gaps, late regressions caught in review/verify vs earlier steps.
4. **`decision`**: assumptions that held vs broke, reversible vs irreversible choices, scope changes.

Each lens reports findings independently with exact evidence anchors (`run_id`, `file:line`, exit code); missing a requested lens flags `[LOW CONFIDENCE]`.

## Step 3: Synthesis, Stability & Routing (`insights-routed` gate)

1. Deduplicate cross-lens findings and compute a deterministic `INS-{8hex}` ID per insight (`sha256(scope + normalized_title).slice(0, 8)`) so re-runs do not spawn duplicates.
2. Classify each insight's route (unless `--no-route`):
   - `wiki-candidate` -> prepare candidate summary for `ew-knowledge` closeout review (never direct file write).
   - `skill-evolve` -> attribute exact Skill/step + Run receipt for `workflow-evolve` (`evolve session review` / `skills draft`).
   - `issue` -> surface actionable backlog item for user-authorized issue tracking.
   - `none` -> project-specific observation recorded in `retrospective.md` only.
3. Collect user confirmation via structured prompt (`ask_question` or host equivalent) before invoking optional external routes (`memory put` / issue tracking); keep Wiki publication explicitly under `ew-knowledge`.

## Step 4: Write Outputs & Seal

1. Write `{run_dir}/outputs/retrospective.json` (`retrospective/1.0`: `lenses_run[]`, `delta` if `--compare`, `insights[]` with `id`, `lens`, `summary`, `evidence[]`, `route`, `status`) and `{run_dir}/outputs/retrospective.md`.
2. Write `{run_dir}/report.md` and seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate lenses-complete --gate insights-routed --summary "<summary>" --verdict done|done_with_concerns`.
3. At Session completion, hand candidate staging/review cleanly to `ew-knowledge`.
