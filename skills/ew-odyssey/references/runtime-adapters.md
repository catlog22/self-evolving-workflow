# Odyssey Host Runtime Adapters

Mode workflows describe host-neutral capabilities (parallel agents, structured user prompts, progress tracking, heartbeats). Map them to the active host runtime below:

## 1. Parallel Subagents & Batch Scans

| Capability | Antigravity | Codex |
|---|---|---|
| Parallel review / audit / archaeology / generalization scan | `invoke_subagent` (parallel), `swarm`, or `run_workflow` | `spawn_agent` / `spawn_agents_on_csv` + `wait_agent` |
| Lifecycle rule | **Always join, complete, or cancel every spawned subagent before advancing or ending scope** | Collect all batch CSV/agent outputs before merging |
| Cross-angle CLI verification | `evolve delegate "<prompt>" --to codex\|agy --mode analysis\|write` (pass `--session <id> --run <run>` only with `--to codex`) | Same (`evolve delegate` binds Run MCP with `--to codex`) |

## 2. Structured User Prompts

- When a workflow specifies **structured prompt** at a non-`-y` decision gate: use `ask_question` in Antigravity, or `request_user_input` in Codex.
- When `-y` (`auto_confirm: true`) is active, follow each mode's `-y` Decision Points table and record skipped human choices as `deferred`.

## 3. Progress Mirroring & Heartbeats

- **`phase_goals[]` in `outputs/session.json`** is the single authoritative campaign progress record.
- Mirror `phase_goals[]` updates via the host's native progress tracker when available (`update_plan` in Codex; Antigravity hosts respect native `/goal` state and never re-emit `/goal` prose or recreate cleared UI state).
- **Optional `--heartbeat`**: update `session.json.updated_at` on each phase transition (if >15 min stalls occur, increment `stale_count`; Antigravity `schedule` is used only when the user explicitly requests a recurring timer).

## 4. Run Artifact Metadata & Sealing

- Every mode stores artifacts exclusively under `{run_dir}/outputs/` (or workspace source files in mutable fix phases).
- Attach matching `kind`, `schema`, `role`, and `alias` from `references/prepare/odyssey-<mode>.md` to:
  - Top-level `_meta` in JSON outputs (`session.json`, plus `explore.json` or `anchors.json`)
  - First record's `_meta` in `evidence.ndjson` (append-only NDJSON lines thereafter)
  - YAML frontmatter in `understanding.md`
- Set `current_state = "END"` in `outputs/session.json` before sealing atomically via `evolve run complete <run_id> --session <session_id> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <run_rev> --summary "<summary>"`.
