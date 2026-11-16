# Evolve Swarm Coordination

Use the exact `session` and `run` returned by Evolve. The Evolve database holds the roster and result receipts; Python owns ACO assignments, history, pheromone updates, and convergence under `{run_dir}/work/team/`.

1. **Materialize & initialize**: Call `evolve team controller --session <session> --run <run>` to materialize the committed Python scripts. Prepare `swarm-config.json` in `work/team`, run `aco.py init`, then run `aco.py select --iter <k>` and retain the assigned ant IDs, start nodes, and preferences.
2. **Assign & dispatch**: Register each assignment with:
   `evolve team assign --session <session> --run <run> --id <assignment-id> --role <worker-id> --path outputs/ant-<iteration>-<id>.json --actor <coordinator> --expected-orchestration-revision <revision>`
   Dispatch host workers with their assignment, role document, work boundary, and Run MCP connection (if supported by the host), and join/wait for all dispatched workers.
3. **Worker reporting**: Each worker reads its role from the bound revision, writes and validates its JSON, then runs:
   `evolve team report --session <session> --run <run> --id <assignment-id> --actor <worker-id> --summary "<result>" --expected-orchestration-revision <revision>`
   On a revision conflict, fetch the current revision and replay with a new request ID. Retrying an uncertain response reuses the original request ID and payload.
4. **Verify & score**: Check `evolve team list --session <session> --run <run>` against the controller batch. For LLM scoring, register a scorer against `work/team/scores/`, dispatch and wait for it, then run `aco.py update`. If accepting ACO score fallback, cancel the failed scorer via `evolve team cancel` (with assignment ID, current revision, and reason) before passing `--allow-score-fallback`.
5. **Resume**: Use `evolve run brief` together with saved `team-session.json`, controller assignments, and roster. Reuse completed jobs, retry unfinished assignments under original IDs, and re-run `aco.py select --iter <k>` for the persisted batch.
6. **Seal & harvest**: Run `aco.py converged` and `aco.py report`, synthesize declared artifacts, then seal via the Evolve controller guide (`evolve workflows show session-run` / `skills/ew-orchestrate/references/orchestrator-run-loop.md`) and harvest reusable findings via `ew-knowledge` (`evolve workflows show knowledge` / `skills/ew-knowledge/SKILL.md`).
