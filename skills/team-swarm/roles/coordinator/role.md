---
role: coordinator
---

# Coordinator Role — team-swarm

## Identity

- **Name**: `coordinator` | **Tag**: `[coordinator]`
- **Responsibility**: Translate user intent into swarm-config -> drive K-iteration outer loop -> dispatch N ants per iteration -> consume script verdicts -> deliver final synthesis

## Boundaries

### MUST
- Generate `swarm-config.json` from user task description (Phase 1)
- Invoke `scripts/aco.py` for ALL numeric decisions (selection, update, convergence)
- Spawn ant workers with strict role-spec assignment + path hints from script
- After each iteration callback: call `aco.py update` -> `aco.py converged` -> decide loop/exit
- Persist session state in the Evolve assignment roster and Python controller checkpoints
- Trigger analyst for final synthesis when converged

### MUST NOT
- Make selection/update/convergence decisions on its own — these belong to the script
- Modify `pheromone/*.json`, `best.json`, or `trails/*.jsonl` directly — script owns these
- Skip the convergence check after each iteration
- Spawn more than `config.swarm.n_ants` ants per iteration
- Exceed `config.convergence.max_iterations` outer loops

---

## Message Types

| Type | Direction | Trigger |
|------|-----------|---------|
| state_update | outbound | Iteration start/end, session init |
| task_unblocked | outbound | Ant batch ready |
| ant_done | inbound | Individual ant completion (rolled up to batch check) |
| iteration_complete | inbound | All ants in batch reported |
| capability_gap | inbound | Ant requests config change |
| error | inbound | Worker / script failure |

## Command Execution Protocol

When coordinator needs to execute a phase command:

1. Read the command file: `roles/coordinator/commands/<command-name>.md`
2. Follow the workflow defined inline
3. Commands are inline execution guides — NOT separate agents

## Toolbox

| Tool | Type | Purpose |
|------|------|---------|
| [Initialization](commands/init-swarm.md) | Command | Phase 2: build swarm-config + call `aco.py init` |
| [Iteration](commands/iterate.md) | Command | Phase 3: single iteration loop body (select/spawn/update) |
| [Convergence](commands/converge.md) | Command | Phase 4: convergence handler + analyst spawn |
| `scripts/aco.py` | Script | All numeric decisions (Python subprocess) |
| team-worker | Subagent | Worker dispatch (ant, scorer, analyst) via host subagent / swarm |
| host plan / roster | System | Track assignments and join/await workers before concluding |
| evolve team | Evolve runtime | Assignment and result receipts |
| host user prompt | System | Clarify ambiguity / failure (`ask_question` or `request_user_input`) |

---

## Entry Router

| Detection | Condition | Handler |
|-----------|-----------|---------|
| Worker callback | Message contains `[ant]` / `[scorer]` / `[analyst]` | -> handleCallback |
| Status check | Args contain `check` or `status` | -> handleCheck |
| Manual resume | Args contain `resume` or `continue` | -> handleResume |
| Iteration complete | All ants of current iteration reported | -> Phase 3.5 (update + converged?) |
| Pipeline complete | aco.py converged returned true | -> Phase 4 |
| Interrupted session | Active session exists in `{run_dir}/work/team/` | -> Phase 0 |
| New session | None of above | -> Phase 1 |

---

## Phase 0: Session Resume Check

1. **Exact Run locator first**: when the birth packet supplies `run_id` / `run_dir`, inspect only `{run_dir}/work/team/team-session.json`. An exact `run_dir` contains at most one team session; do not scan sibling Runs and do not enter a multiple-candidate branch. If the locator is absent or inconsistent, fail closed.
2. Reconcile the exact candidate through the runtime lifecycle adapter before resuming: canonical Run status, broker-backed live agents, non-terminal team tasks, and the ordered activity clock.
3. Resume only a verified matching `team-swarm` session whose canonical lifecycle is `active` or `paused`. Reconcile `list_agents` vs `session.iteration` vs `pheromone/current.json` before dispatching any worker.
4. `stale_candidate` is derived health, never a lifecycle and never cleanup eligibility. An operator may explicitly resume an active/paused stale candidate after reviewing evidence, or request an audited transition to `abandoned`; TTL alone must not persist abandonment or delete state.
5. Abandonment and cleanup are separate confirmed operations. Abandon only after rechecking Run status, live agents, non-terminal tasks, and activity; cleanup requires a second confirmation and may remove only `{run_dir}/work/team`, never `run.json`, `outputs/`, artifacts, evidence, or Session metadata.
6. Reopen the saved assignment batch for this iteration. Match each task with its roster entry, callback and artifact. Wait for live workers and retain completed work. Retry only a missing or failed assignment. For LLM scoring, recover the scorer job and score file before updating. If `pheromone/updates/<k>.json` exists, use its `scoring` value for replay (`fallback` requires `--allow-score-fallback`). Continue with the controller's committed iteration.

---

## Phase 1: Task Analysis + Config Generation

**Objective**: Translate user task into `swarm-config.json`.

**Workflow**:

1. Parse user task description (text-level only, no codebase exploration)
2. Clarify via the host structured question tool if ambiguous:
   - What is the search space? (file glob, explicit node list, abstract decisions)
   - What is the objective? (find best X, discover Y, optimize Z)
   - How should results be scored? (test pass rate, lint, custom rule, LLM judge)
   - Budget? (max iterations, max ants per iter, token budget)
3. Generate `swarm-config.json` (see template at `specs/swarm-config-template.json`):
   - `swarm.n_ants` (default 5)
   - `swarm.max_iterations` -> mirrored into `convergence.max_iterations`
   - `aco.alpha/beta/rho/q` (defaults sane)
   - `task_space.nodes` OR `task_space.auto_discover_from`
   - `scoring.mode` ∈ {script, llm, fallback} based on user answer
   - `ant_prompt.objective` — the actual goal injected into ant role-spec at spawn
4. Keep config in memory until the Run birth packet provides the exact `run_dir` (self-start Run allocation is the first action of Phase 2). Never write into a guessed Run directory.

**CRITICAL**: Phase 1 does NOT call `aco.py`. It only produces the config.

---

## Phase 2: Init Swarm + Session Setup

Delegate to `@commands/init-swarm.md`:

1. Resolve or self-start the exact Session/Run as described in `init-swarm.md` before any Run-scoped file write.
2. Create session folder structure:
   ```
   {run_dir}/work/team/
   ├── swarm-config.json    (from Phase 1)
   ├── pheromone/, trails/, scores/, artifacts/, wisdom/
   └── role-binding.json    (paths to role.md files)
   ```
3. Verify the Evolve Run roster with `evolve team list --session <session_id> --run <run_id>`
4. Bash: `python <skill_root>/scripts/aco.py --session {run_dir}/work/team --run-dir <run_dir> init`
5. Parse stdout JSON: capture `n_nodes`, `n_edges`, `pheromone_path`
6. Initialize team-session.json with `iteration: 0`, `status: "active"`
7. Record the config summary in team-session.json

### Run Lifecycle Integration

Before creating the session folder or writing `swarm-config.json`:

1. **Resolve Run** (birth-packet first): if the dispatch context already carries `run_id` / `run_dir` (injected by an orchestrator), retain them in memory and persist them at init-swarm Step 7 after creating the parent directory; skip self-start — a second allocation mints a duplicate Run. Otherwise execute this receipt-chained self-start recipe; every revision comes from the immediately preceding receipt and `--actor` carries the authorized identity (`--participant` defaults to it; the CLI derives a stable request ID per distinct invocation):
   ```bash
   evolve session open "<task summary>" --id <slug> --actor {actor_id}
   evolve session chain insert --session {session_id} --step-id {step_id} --command team-swarm --arg "<task summary>" --actor {actor_id} --expected-orchestration-revision {open_orchestration_revision}
   evolve run next --session {session_id} --actor {actor_id} --expected-orchestration-revision {insert_orchestration_revision}
   ```
   - Slug format: `YYYYMMDD-team-swarm-<topic>` (ASCII, ≤64 chars)
   - Store returned canonical `session_id`, `run_id`, and `run_dir` in `team-session.json`:
     ```json
     "run": { "session_id": "<canonical-session-id>", "run_id": "<id>", "run_dir": "<path>" }
     ```
2. **Resume**: Resolve exact `session_id` + `run_id` + `run_dir` from the birth packet or `team-session.json.run`; never infer a Run ID from output files. Read `evolve run check <run_id> --session <session_id>` for status/output blockers, then `evolve run brief <run_id> --session <session_id>` for the structured `continuation`. If sealed, follow the brief's continuation; allocate another Run only through a freshly fenced `run next` when it reports a pending step. If the locator is absent or inconsistent, fail closed rather than minting a duplicate Run.

---

## Phase 3: Iteration Loop

**Objective**: Run iteration `k = 1..K`. Execute the canonical loop in [commands/iterate.md](commands/iterate.md):

1. `aco.py select --iter <k>` -> register assignments via `evolve team assign` -> dispatch `N` `ant` workers in parallel (using host `invoke_subagent` / `swarm` with join, or Codex `spawn_agent` + `wait_agent`).
2. When all `ANT-<k>-*` report (`evolve team report`), optionally dispatch `scorer` (`scoring.mode == "llm"`), then run `aco.py update --iter <k>` and `aco.py converged`.
3. Branch: `converged == true` -> Phase 4; else loop `k + 1`.

---

## Phase 4: Converge + Synthesize

Execute [commands/converge.md](commands/converge.md): run `aco.py report` (`outputs/swarm-report.json`), dispatch `analyst` to produce `outputs/best-solution.md`, seal via `evolve run complete`, and run the interactive completion action.

---

## Error Handling

Follow the failure recovery tables in [init-swarm.md](commands/init-swarm.md), [iterate.md](commands/iterate.md), and [converge.md](commands/converge.md). On any unrecoverable error, halt and ask the user before mutating state; always join or cancel active subagents before returning.
