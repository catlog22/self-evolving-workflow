# Pre-flight: ew-roadmap

Confirm mode, Knowledge Gate inputs, and DAG altitude boundaries before running [workflow](workflow.md).

## Input & Mode

| Mode | Trigger | Behavior |
| --- | --- | --- |
| Create (default) | requirement / `--from` / `current-blueprint` | Build acyclic Session DAG from requirements and upstream context |
| Revise | `--revise [instructions]` | Update bound `current-roadmap` while preserving all sealed sessions (`E005` if modification collides) |
| Review | `--review` | Read-only health assessment of DAG acyclicity, coverage, and sizing (`E004` if missing) |
| Resume | `-c` / `--continue` | Continue from last checkpoint |

Missing requirement without `--revise`/`--review` -> error `E001`.

## Knowledge & Context Pre-load

1. Reuse bound `session-priors` for `arch` constraints; otherwise query `wiki_context` + `wiki_reference` (or CLI `evolve context "<requirement keywords>" --task roadmap --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"` + `--from-search <search-id>`).
2. Read active Session registry (`evolve session list`) and codebase boundaries (`evolve code search`) after the Knowledge Gate.

## Decomposition & Output Boundaries

- **Run artifacts only**: write `outputs/roadmap.json` and `outputs/roadmap.md` under `{run_dir}/outputs/`; never write legacy `.workflow/roadmap.md` or deprecated `milestones[]` / `current_milestone` / `accumulated_context` fields.
- **Default to 1 Session**: split into multiple Sessions only when ALL THREE hard-dependency conditions hold: (1) Session B runtime code consumes Session A real output without mocking, (2) interface contracts cannot unblock concurrent work, and (3) every Session A task must complete before Session B starts. Otherwise keep 1 Session and let `ew-plan` model execution waves.
- **Sizing guard**: aim for `>= 5` substantial tasks per Session; if `> 3` Sessions result, re-audit every split against the 3 hard conditions and merge weak splits.
- **Altitude guard**: define Session boundaries, success criteria, and `depends_on` edges only — leave task splitting to `ew-plan`.
- **Exit gates**: `dag-valid` (acyclic, full requirement coverage, valid dependencies) and `sessions-registered` (roadmap metadata recorded cleanly without mutating already-completed Sessions).
