---
name: team-swarm
disable-model-invocation: true
description: Swarm intelligence team skill — ACO-driven multi-agent exploration with hybrid LLM coordinator and Python optimization controller. Coordinator translates the task into swarm-config.json and runs K iterations of N parallel ants guided by pheromone state. Triggers on "team swarm", "swarm intelligence", "蚁群".
session-mode: run
required_links:
  - references/mcp-coordination.md
contract:
  contract_version: 2.1
  consumes: []
  produces:
    - path: outputs/best-solution.md
      kind: swarm-best-solution
      schema: swarm-best-solution/1.0
      role: primary
      required: true
    - path: outputs/swarm-report.json
      kind: swarm-report
      schema: swarm-report/1.0
      role: attachment
      required: true
    - path: outputs/ant-{iteration}-{ant_id}.json
      kind: swarm-ant-result
      schema: swarm-ant-result/1.0
      role: evidence
      required: false
  gates:
    entry: []
    exit: []
version: 0.6.0
---

# Team Swarm

Orchestrate ant-colony-style exploration over a user-defined task space (`swarm-config.json`). **Hybrid model**: LLM handles task translation, worker dispatch, and synthesis; Python (`scripts/aco.py`) owns all numeric decisions (selection, pheromone update, convergence).

## Role Router

- **No `--role` flag** -> Load [roles/coordinator/role.md](roles/coordinator/role.md) and execute Phase 0–4.
- **`--role <name>`** -> Load the assigned role only:
  - `ant` -> [roles/ant/role.md](roles/ant/role.md) (`ANT-*`)
  - `scorer` -> [roles/scorer/role.md](roles/scorer/role.md) (`SCORE-*`)
  - `analyst` -> [roles/analyst/role.md](roles/analyst/role.md) (`ANALYST-*`)

## Shared Constants & Host Mapping

- **Coordination state**: `{run_dir}/work/team/` (never register as formal Run outputs).
- **Formal outputs**: `{run_dir}/outputs/` (`ant-<iter>-<id>.json`, `swarm-report.json`, `best-solution.md`).
- **Controller CLI**: `<skill_root>/scripts/aco.py` (Python 3.10+). For version-bound Runs, run `evolve team controller` / `evolve run skill-read` to materialize scripts from the pinned commit.
- **Roster**: `evolve team list --session <session> --run <run>`. Always read [MCP coordination](references/mcp-coordination.md) before dispatching or reporting assignments.
- **Host dispatch**: Use the host's parallel subagent mechanism (`invoke_subagent` or `swarm` in Antigravity, joining/closing all spawned workers before finishing; `spawn_agent` + `wait_agent` in Codex) and structured user prompt (`ask_question` in Antigravity; `request_user_input` in Codex).

## User Commands

| Command | Action |
|---------|--------|
| `check` / `status` | View iteration progress and convergence curve |
| `resume` / `continue` | Resume interrupted iteration (Phase 0) |
| `feedback <text>` | Append to `work/team/wisdom/learnings.md` for next iteration |
| `revise <ITER>` | Re-run a specific iteration |

## References

- [specs/swarm-protocol.md](specs/swarm-protocol.md) — Master architecture, script <-> coordinator interface, lifecycle
- [specs/pheromone-schema.md](specs/pheromone-schema.md) — Pheromone JSON structure, update formula, evaporation
- [specs/ant-output-schema.md](specs/ant-output-schema.md) — Ant & scorer JSON contracts
- [specs/convergence-criteria.md](specs/convergence-criteria.md) — Stop conditions and multi-criterion logic
- `specs/swarm-config-template.json` — Config template (`scripts/aco.py`, `scripts/pheromone.py`, `scripts/scoring.py`)
