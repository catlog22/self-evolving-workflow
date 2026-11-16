# Swarm Protocol

Master protocol document for team-swarm: defines how the LLM coordinator and Python ACO controller interface, how ants explore the task space, and how exploration results flow back to update pheromone state.

## Design Philosophy

| Principle | Rationale |
|-----------|-----------|
| **Outer loop = script, inner loop = LLM** | Optimization math is cheap and deterministic; LLM evaluation is expensive and noisy. Separate them. |
| **Coordinator is a hybrid** | LLM coordinator translates user intent + dispatches workers; Python script makes all numeric decisions (selection, update, convergence). |
| **Schema-locked ant output** | LLM output → algorithm input bridge demands strict JSON contract. Free-text outputs cannot feed pheromone updates. |
| **Two-layer scoring** | `self_score` (LLM self-report) is fast but optimistic. `verified_score` (script or LLM scorer) is the only authoritative input to pheromone update. |
| **Universal task space** | Coordinator does not bake in any domain. User provides `swarm-config.json` with task space + scoring rule. |

## Three-Component Architecture

```
+-----------------------------------------------------+
|  LLM Coordinator (roles/coordinator/role.md)       |
|  - Parses user task → emits swarm-config.json       |
|  - Phase 3 main loop: calls script, dispatches       |
|  - Translates worker results back into script ops  |
+--------+--------------------------------------------+
         | CLI subprocess (run_command / Bash)
         v
+-----------------------------------------------------+
|  Python ACO Controller (scripts/aco.py)            |
|  - CLI subcommands: init/select/update/converged    |
|  - Owns pheromone matrix + elite tracker            |
|  - Pure functions of session state files            |
+-----------------------------------------------------+
         ^                                  |
         | reads {run_dir}/outputs/ant-*.json | writes pheromone/*.json
         |                                  v
+-----------------------------------------------------+
|  LLM Workers (team-worker agents)                  |
|  - ant: explores assigned path, writes JSON         |
|  - scorer: assigns verified_score (optional)        |
|  - analyst: final synthesis of elite solutions      |
+-----------------------------------------------------+
```

## Iteration Lifecycle

```
[Coordinator] init phase
  └─> python aco.py --session {run_dir}/work/team --run-dir <run_dir> init
       └─> writes pheromone/current.json + task-space.json

[Coordinator] iteration k (k = 1..K):
  ├─> python aco.py --session {run_dir}/work/team --run-dir <run_dir> select --iter k
  │    └─> returns N ant assignments (paths to explore)
  ├─> register N ant assignments in Evolve roster
  ├─> dispatch N × ant workers in parallel and wait/join
  └─> advance when all N ants report
  
[Callback] all ants done → handleIterationComplete
  ├─> (optional) dispatch scorer worker → verified_scores.json
  ├─> python aco.py --session {run_dir}/work/team --run-dir <run_dir> update --iter k
  │    └─> reads {run_dir}/outputs/ant-k-*.json + verified_scores
  │    └─> updates pheromone + elite + history
  ├─> python aco.py --session {run_dir}/work/team --run-dir <run_dir> converged
  │    └─> {converged: true|false, reason: ...}
  └─> converged → Phase 4; else → iteration k+1

[Coordinator] Phase 4: converge
  ├─> python aco.py --session {run_dir}/work/team --run-dir <run_dir> report → stdout JSON saved as outputs/swarm-report.json
  ├─> dispatch analyst worker → best-solution.md
  └─> completion action (Archive/Keep/Export)
```

## Script ↔ Coordinator Contract

All scripts MUST:
- Read from `{run_dir}/work/team/...` (session path passed via `--session` flag)
- Write JSON to stdout for coordinator parsing (no prose)
- Use exit code 0 = success, 1 = error, 2 = config invalid
- Commit each update with its input digest before writing the derived pheromone, best result, history and trails. Replaying the same iteration with identical inputs returns the stored result. A changed replay fails. The next controller invocation restores an interrupted projection from the committed receipt.

| Subcommand | Input | Output (stdout JSON) | Side effects |
|------------|-------|---------------------|--------------|
| `init` | swarm-config.json | `{status, pheromone_path, n_nodes}` | writes pheromone/current.json, task-space.json |
| `select --iter k` | pheromone/current.json, swarm-config.json | `{iteration, assignments: [{ant_id, start_node, ...}]}` | saves `assignments/k.json` for a Run |
| `update --iter k` | {run_dir}/outputs/ant-k-*.json, saved assignment batch when available, `scores/iter-k-scores.json` in LLM mode | `{iteration, mean_score, best_score, delta, elite_updated}` | commits an iteration receipt and projects state, history, trails and best solution |
| `converged` | history/, best.json, config | `{converged: bool, reason: str, metrics: {...}}` | none |
| `report` | best.json, history/ | full JSON: `{_meta: {kind: swarm-report, schema: swarm-report/1.0, role: attachment}, best, top_k, convergence_curve, ...}` | none |

Run-scoped `select` saves `assignments/k.json` and returns the same batch on replay. An LLM score file covers the accepted artifacts for the same iteration. `update --allow-score-fallback` uses discounted self-scores for the entire LLM iteration. The fallback choice is part of the replay inputs.

## Data Flow Boundaries

| Boundary | Owner | Format |
|----------|-------|--------|
| User intent → config | LLM coordinator | swarm-config.json |
| Pheromone state | Python script | pheromone/current.json |
| Ant assignment → ant prompt | LLM coordinator (templated) | injected into role-spec at spawn |
| Ant exploration → artifact | LLM ant | {run_dir}/outputs/ant-k-id.json (schema-locked) |
| Artifact → pheromone update | Python script | reads artifacts, computes delta tau |
| Elite solutions → human report | LLM analyst | {run_dir}/outputs/best-solution.md |

## Why Hybrid Coordinator (Not Pure Script)

- User input is natural language → needs LLM to map to swarm-config
- Worker spawning, message routing, session management → all framework-bound to LLM coordinator
- Script as a sub-tool keeps the same team-* lifecycle (spawn-and-stop, callback-driven)
- Same pattern as `evolve delegate` — Bash-callable subprocess from inside an LLM role

## Universality

`team-swarm` is task-agnostic. Specialization happens via:
1. `swarm-config.json#task_space` — defines what nodes/edges/paths mean
2. `swarm-config.json#scoring` — defines how to compute verified_score
3. `swarm-config.json#ant_prompt` — defines what ant should actually do at each node

Example domains the same skill handles:
- Code exploration (nodes = files/modules, score = suspicious code density)
- Test case generation (nodes = code paths, score = coverage delta)
- Refactor strategy search (nodes = refactor moves, score = complexity reduction)
- Hyperparameter tuning (nodes = param choices, score = metric improvement)
