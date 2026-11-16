# Workflow: ew-roadmap

Session DAG decomposition: `Parse & Context -> Codebase Mapping -> Decompose / Revise / Review -> Validate DAG -> Wrap-up`.

## Step 1: Load Context & Upstream

1. Complete the Knowledge Gate (`session-priors` / `wiki_context` / CLI `--reads`) and inspect existing `evolve session list` state so already-completed work is excluded.
2. Read bound `current-blueprint` / `upstream-context` when provided (`read_artifact` / `evolve run artifact-read`).
3. If architectural boundaries are unclear, run a read-only exploration subagent (`invoke_subagent` / host equivalent, joined before Step 2) and optional `search_web` for external API constraints -> save summary to `{run_dir}/evidence/roadmap-context.json`.

## Step 2: Execute Selected Mode

- **Create mode**:
  1. Parse requirement into goals, hard constraints, and acceptance criteria.
  2. Group requirements into cohesive Sessions using the **default 1-session / 3-hard-condition split rule** (`>= 5` estimated tasks per Session). Map every active requirement to one owning Session and assign `depends_on` edges.
  3. Confirm scope/mode (`progressive` / `direct` / `auto`) and Session boundaries via structured user prompt (`ask_question` or host equivalent; auto-accept defaults under `-y`).
  4. Re-audit splits if `> 3` Sessions exist and merge unjustified splits.
- **Revise mode (`--revise`)**:
  1. Load `current-roadmap` (`E004` if missing). Check which Sessions are already sealed/completed; refuse (`E005`) or confirm adjustment if a change alters completed scope.
  2. Update pending Sessions and edges cleanly while preserving sealed entries.
- **Review mode (`--review`)**:
  1. Inspect `current-roadmap` read-only for cycles (`E003`), orphaned requirements, undersized Sessions, and blocked dependencies; inside an active Run, copy the read-only roadmap into `{run_dir}/outputs/roadmap.json` with an appended `health_review` summary (and matching `_meta`) so the Run seals cleanly without modifying the original roadmap source.

## Step 3: Write Outputs & Seal (`dag-valid`, `sessions-registered`)

1. Write `{run_dir}/outputs/roadmap.json` (`roadmap/1.0`: `sessions[]` with `id`, `title`, `intent`, `scope`, `requirement_refs[]`, `acceptance_criteria[]`, `depends_on[]`, `status`) and `{run_dir}/outputs/roadmap.md` (including `## Roadmap Decisions` and dependency graph).
2. Verify acyclicity (topological sort), zero dangling `depends_on`, and complete requirement mapping.
3. Write `{run_dir}/report.md` (`next` proposing `ew-analyze` or `ew-plan` for the first ready Session) and seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate dag-valid --gate sessions-registered --summary "<summary>" --verdict done|done_with_concerns`. Stage reusable architecture learnings through `ew-knowledge`.
