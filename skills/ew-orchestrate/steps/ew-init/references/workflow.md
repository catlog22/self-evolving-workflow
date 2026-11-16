# Workflow: ew-init

Project onboarding: `Pre-flight & State Detection -> Greenfield Questioning or Brownfield Scan -> Knowledge & CodeGraph Setup -> Package & Seal`.

## Step 1: Detect State & Check Bootstrap (`state-detected` gate)

1. Check Git main-worktree status (`git rev-parse --git-common-dir`), `AGENTS.md` / `skills/`, `.agent-memory/`, `.codegraph/`, `wiki/`, source manifests (`package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, etc.), and legacy `.workflow/`.
2. Run the Knowledge Gate (`session-priors`, or `wiki_context` / CLI `evolve context "project conventions architecture" --task init --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"`) to load any already-recorded project rules.
3. Classify into **Path A (`greenfield`)**, **Path B (`brownfield`)**, **Path C (`legacy-maestro`)**, or **Path D (`initialized`)**. If Path D and no refresh/re-scan was explicitly requested, emit idempotent status into `outputs/init-report.json` (`_meta: { kind: "init-report", schema: "init-report/1.0", role: "primary", alias: "current-init" }`) without mutating existing knowledge and seal cleanly.

## Step 2: Gather Context by Path

- **Path A (Greenfield)** (skip questioning if `--from` / `upstream-context` or `-y` with `@file`):
  - Conduct focused discovery via structured prompt (`ask_question` or host equivalent) covering: vision & core value (the one thing that must work), target users, 2–5 primary goals, tech preferences, hard constraints, and non-goals.
- **Path B (Brownfield)** / **Path C (Legacy)**:
  1. Ensure code graph is indexed via `evolve code build` (if `.codegraph/` is absent or stale).
  2. Spawn up to 4 read-only parallel subagents (`invoke_subagent` / host equivalent, **always joined or cancelled before Step 3**) mapping `stack`, `architecture`, `conventions`, and `pitfalls` -> write summaries under `{run_dir}/evidence/`.
  3. Under Path C, run `evolve knowledge import` (dry-run preview; pass `--knowhow-only` if requested) and summarize pending Spec/Knowhow migration candidates cleanly for `ew-knowledge`.

## Step 3: Knowledge Seeding & Artifact Packaging (`context-initialized` gate)

1. Never write `wiki/entries/` directly. If onboarding surfaced stable baseline architectural conventions or glossary constraints, prepare proposal JSON and stage previews via `evolve wiki propose <change.json> --evidence <receipt-or-session>` — defer `evolve wiki apply` to explicit user approval via `ew-knowledge` (never treat `-y` as Wiki approval).
2. Write `{run_dir}/outputs/project-brief.md` (vision, core value, validated capabilities for brownfield, active goals, constraints, non-goals, key decisions).
3. Write `{run_dir}/outputs/context-package.json` (`context-package/1.0`: `domain`, `requirements[]`, `constraints[]`, `non_goals[]`, `insights[]`, `references[]`) and `{run_dir}/outputs/init-report.json` (`init-report/1.0`: `path`, `codegraph_status`, `wiki_entries_count`, `legacy_import_preview`, `suggested_next`).

## Step 4: Seal & Route Next

Write `{run_dir}/report.md` (`next` proposing `ew-roadmap`, `ew-blueprint`, or `ew-brainstorm` based on user intent) and seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate state-detected --gate context-initialized --summary "<summary>" --verdict done|done_with_concerns`. All JSON outputs must include matching `_meta` and Markdown outputs matching YAML frontmatter; recover blocked/failed attempts via `evolve run check` + `evolve run transition`.
