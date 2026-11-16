# Command: converge

## Workflow

### Step 1: Call aco.py report

```
Bash: python <skill_root>/scripts/aco.py --session {run_dir}/work/team --run-dir <run_dir> report
```

Parse stdout JSON. Expected:
```json
{
  "_meta": {"kind": "swarm-report", "schema": "swarm-report/1.0", "role": "attachment"},
  "status": "ok",
  "best": { ant_id, iteration, path, score, candidate_solution, evidence, ... },
  "top_k": [<top 5 trails>],
  "convergence_curve": [{iteration, entropy, tau_max, tau_mean}, ...],
  "final_pheromone_stats": {...},
  "iterations_completed": <int>
}
```

Save the complete stdout JSON, including `_meta`, to `{run_dir}/outputs/swarm-report.json` (raw data for analyst). Do not wrap, strip, or replace the metadata.

### Step 2: Dispatch analyst worker

Dispatch an `analyst` worker via host subagent/swarm (`role_spec: <skill_root>/roles/analyst/role.md`) with `outputs/swarm-report.json`, `work/team/best.json`, `work/team/trails/*.jsonl`, and `<config.ant_prompt.objective>` to synthesize `outputs/best-solution.md`, and wait/join for completion.

### Step 3: On analyst callback

Give `{run_dir}/outputs/best-solution.md` the `kind: swarm-best-solution`, `schema: swarm-best-solution/1.0`, and `role: primary` YAML frontmatter. Seal with `evolve run complete <run_id> --session <session-id> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --summary "<summary>" --verdict done` and fix any output contract errors it reports.

If missing -> ask user (`ask_question` / `request_user_input`) to skip synthesis or retry analyst.

### Step 3.5: Run lifecycle completion

```
  +- Run lifecycle completion:
  |   - Read run_id from team-session.json.run.run_id
  |   - Write {run_dir}/report.md with frontmatter (verdict/summary/constraints/decisions/concerns; constraints/decisions = {text,status} objects, id auto-derived)
  |   - Before requesting completion, merge-write team status="completed", converged_at=<iso8601>, convergence_reason=<triggered_by>, preserving run; log the final state_update now. If completion is blocked, leave it unsealed and merge-write status="paused" with the blocker.
  |   - If self-started, run `evolve run complete <run_id> --session <session-id> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --summary "<summary>" --verdict done` (and `evolve session complete --session <session-id> --actor <actor> --expected-orchestration-revision <rev>` when the chain is terminal; follow the `ew-orchestrate` controller run loop guide); if dispatched, return to the claim-holding orchestrator
  |   - If complete fails: fix the blocking gate and retry once; still failing -> do NOT archive/clean - keep the team active (status=paused) and report the blocking gate
```

### Step 4: Build completion summary

```
[coordinator] ============================================
[coordinator] SWARM CONVERGED
[coordinator]
[coordinator] Iterations: <iterations_completed> / <max_iterations>
[coordinator] Trigger: <triggered_by[0]>
[coordinator] Total ants spawned: <iterations * n_ants>
[coordinator]
[coordinator] Best Solution:
[coordinator]   ant_id: <best.ant_id>
[coordinator]   iteration: <best.iteration>
[coordinator]   path: <best.path joined with " -> ">
[coordinator]   verified_score: <best.score>
[coordinator]   summary: <best.candidate_solution.summary>
[coordinator]
[coordinator] Convergence curve (entropy):
[coordinator]   iter 1: <e1>  iter 2: <e2>  iter 3: <e3>  ...
[coordinator]
[coordinator] Deliverables:
[coordinator]   - {run_dir}/outputs/best-solution.md (analyst synthesis)
[coordinator]   - {run_dir}/outputs/swarm-report.json (raw data)
[coordinator]   - best.json (canonical best)
[coordinator]   - trails/*.jsonl (full exploration log)
[coordinator]
[coordinator] Session: <session_path>
[coordinator] ============================================
```

### Step 5: Preserve completed state

The final team state and state_update were written before completion in Step 3.5. After sealing, inspect the frozen state read-only; do not update team-session.json or append Run-local logs.

### Step 6: Completion action (interactive)

Ask the user via host structured question (`ask_question` / `request_user_input`) to choose one of:
- **Archive & Clean (Recommended)** — Close/join active worker handles; output final summary; preserve the sealed Run directory and evidence.
- **Keep Active** — Keep team available for read-only inspection; follow-up work requires a fresh Run.
- **Export Best Solution** — Prompt for target path, copy `best-solution.md` + `best.json`, then Archive & Clean.
- **Run Another Round** — Prompt for additional `K`, then follow the fresh-Run handoff below (never reset or iterate in the completed Run).

| Choice | Steps |
|--------|-------|
| Archive & Clean | Close active worker handles; output final summary; preserve the sealed Run directory and evidence |
| Keep Active | Keep the live team for read-only inspection; output fresh-Run follow-up instructions; do not change completed team state |
| Export Best Solution | Ask target path; copy best-solution.md + best.json; then Archive & Clean |
| Run Another Round | Ask additional K; follow the fresh-Run handoff below; never reset or iterate in the completed Run |

### Fresh-Run handoff for another round

- Completion above seals the old Run. Never write its `work/team`, `outputs/`, report, counters, or pheromone again, including changing its completed team state to paused. Keep Active preserves the live team for inspection only; it does not reopen the Run.
- For an orchestrator-dispatched Run, return the requested K and exact old locator to the completion owner and wait for a new birth packet. Do not create a competing Run or continue under the old locator.
- For a self-started Run, use the receipt-chained `evolve session open` / `evolve session chain insert` / `evolve run next` flow from `roles/coordinator/role.md`. If the prior Session is terminal/completed, open a new Session; otherwise the owner inserts and dispatches a new chain step. Do not reuse the completed step or Run ID.
- Resolve a distinct new `session_id` / `run_id` / `run_dir` before any follow-up write. Initialize a new `work/team/team-session.json` via init-swarm.md with the new public locator and reset round-local counters there only.
- If retaining pheromone is requested, read the old frozen config/task-space/pheromone as seed inputs and copy only compatible inputs into the new Run's coordination directory after initialization; record their exact source locator. Set the new iteration cap to K. Do not copy old outputs, trails, scores, worker liveness, or completion state as new-round evidence. Spawn new ants through Phase 3 iterate.md only after the new locator and seed/config are verified.
- If allocation or seed validation fails, keep the old Run immutable and report the blocker; never fall back to iterating there.

## Failure Cases

| Failure | Action |
|---------|--------|
| `aco.py report` fails | Stop before analyst dispatch; keep Run unsealed and team paused, record stderr, repair the script/state, then retry `report`. Do not substitute an untyped manual report for required `outputs/swarm-report.json`. |
| Analyst worker crashes | Retry once. If synthesizing a minimal best-solution.md from best.json is explicitly chosen, include the required `swarm-best-solution/1.0` primary YAML frontmatter for completion. |
| best.json missing | Pipeline ran but no successful ant - report failure, keep session for inspection |
| Run Another Round chosen but max_iterations already at limit | Ask user to raise the cap before continuing |
