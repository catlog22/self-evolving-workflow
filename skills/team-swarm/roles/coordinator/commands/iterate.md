# Command: iterate

## Two Entry Points

| Entry | Trigger | Action |
|-------|---------|--------|
| **Iteration start** | Phase 3 invoked OR previous iteration converged=false | Run "Iteration Start" workflow |
| **Iteration end** | All ants of current iter reported via callback | Run "Iteration End" workflow |

## Iteration Start Workflow

### Step 1: Determine iteration number

```
k = session.iteration + 1
```

If `k > session.max_iterations`: force converge to Phase 4 (safety net).

### Step 2: Call aco.py select

```text
python <skill_root>/scripts/aco.py --session {run_dir}/work/team --run-dir <run_dir> select --iter <k>
```

Parse stdout JSON. Expected:
```json
{
  "status": "ok",
  "iteration": <k>,
  "n_assignments": <N>,
  "assignments": [
    {
      "ant_id": "ANT-<k>-<i>",
      "start_node": "<node>",
      "edge_preferences": {"a::b": 0.4, ...},
      "max_path_length": <int>,
      "iteration": <k>
    }, ...
  ]
}
```

On error -> log to issues.md and ask user (`ask_question` / `request_user_input`) to retry or abort.

For a Run, `select --iter <k>` persists `assignments/<k>.json` before dispatch. Re-run the same command after an interruption to recover the original IDs and start nodes. Use the roster and task mapping to reuse live jobs and completed artifacts. Create a worker only for an assignment that still needs one.

### Step 3: Record ant assignments in Evolve roster

Register each `ANT-<k>-<i>` assignment via `evolve team assign` (and update the host progress plan if available). Assignment IDs `ANT-<k>-<i>` are persisted in `assignments/<k>.json` and tracked by the Evolve team roster (`evolve team assign` / `evolve team list`).

### Step 4: Dispatch N ant workers in parallel

Dispatch one worker per assignment in parallel using the host's subagent/swarm mechanism (`invoke_subagent` or `swarm` in Antigravity; `spawn_agent` in Codex) with the payload below, and join/wait for all dispatched workers before advancing:

```text
## Role Assignment
role: ant
role_spec: <skill_root>/roles/ant/role.md
session: <session_path>
session_id: <run-id>
run_dir: <exact run_dir from the birth packet or team-session.json.run.run_dir>
requirement: <config.ant_prompt.objective>
inner_loop: false

## Assignment
<assignment JSON>
```

### Step 5: Update session state

```
session.iteration = <k>  (mark "in progress")
session.active_workers = [<list of ant IDs>]
```

Persist the iteration and assignment IDs in team-session.json.

### Step 6: STOP

Wait for ant callbacks. Each ant uses evolve team report for its assignment. When ALL N reported, callback handler invokes "Iteration End" workflow.

---

## Iteration End Workflow

### Step 1: Verify completion

Check `ANT-<k>-*` task statuses. If any still in_progress: not yet complete, do nothing.

If all completed -> proceed.

### Step 2: (Conditional) Dispatch scorer

If `config.scoring.mode == "llm"`, dispatch a `scorer` worker (`role_spec: <skill_root>/roles/scorer/role.md`) with iteration `<k>`, output path `{run_dir}/work/team/scores/iter-<k>-scores.json`, and input glob `{run_dir}/outputs/ant-<k>-*.json`, then wait/join for completion before Step 3.

The callback must identify `SCORE-<k>` and the same iteration. Check that the output covers all ant artifacts for this iteration before invoking `update`. Once the controller has committed the iteration, replay with the same scoring decision and inputs.

If `scoring.mode == "script"` or `"fallback"` -> proceed directly to Step 3.

### Step 3: Call aco.py update

```
Bash: python <skill_root>/scripts/aco.py --session {run_dir}/work/team --run-dir <run_dir> update --iter <k>
```

Parse stdout JSON. Expected:
```json
{
  "status": "ok",
  "iteration": <k>,
  "n_ants_processed": <N>,
  "mean_score": <float>,
  "best_score": <float>,
  "delta": <float>,
  "elite_updated": <bool>,
  "hallucinations_flagged": [<ant_ids>],
  "stats": {<pheromone stats>}
}
```

### Step 4: Log iteration result

Save the phase summary in team-session.json.

If `hallucinations_flagged.length > N/2`: append warning to wisdom/issues.md (high-noise iteration).

### Step 5: Call aco.py converged

```
Bash: python <skill_root>/scripts/aco.py --session {run_dir}/work/team --run-dir <run_dir> converged
```

Parse:
```json
{ "converged": <bool>, "triggered_by": [...], "reason": "...", "metrics": {...} }
```

### Step 6: Branch on convergence

```
if converged:
    update session: completed_iterations.push(k), status = "converging"
    -> proceed to Phase 4 (converge.md)
else:
    update session: completed_iterations.push(k), active_workers = []
    -> re-enter "Iteration Start" workflow with k+1
```

### Step 7: Output progress to user

After each iteration:
```
[coordinator] Iteration <k>/<max> complete.
[coordinator]   best=<best_score>  mean=<mean_score>  delta=<delta>
[coordinator]   entropy=<entropy>  hallucinations=<count>
[coordinator]   Status: <converged | continuing to iter k+1>
```

---

## Edge Cases

| Condition | Handling |
|-----------|----------|
| Ant task failed | Mark task failed; if >50% failed in iter -> halt and ask user via structured prompt |
| Ant produced no artifact | Script's update will skip it; if all skipped -> error -> halt |
| `aco.py update` fails | Retry once; if persistent -> halt with error report |
| Scorer worker fails | Record the failure. For an intentional self-score fallback in a Run, use `update --iter <k> --allow-score-fallback` and record that choice for replay. |
| Iteration takes too long | After timeout (configurable), check the host job and Evolve assignment roster |
| User sends `feedback <text>` mid-iteration | Append to wisdom/learnings.md; apply at next iteration start (not mid-iter) |
