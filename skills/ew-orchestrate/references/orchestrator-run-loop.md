# Evolve Session Execution and Recovery

Use the bundled `evolve` CLI (in this source checkout, run `node dist/workflow-cli.js`). Session/Run state, `boundary_contract`, `goals[]`, `amendments[]`, requests, and sealed artifact bytes share `.agent-memory/workflow.db`; working outputs live under the `run_dir` returned by the controller.

## Start and Dispatch

1. **Install & validate**: Run `evolve install` (`--scope project --yes` for project setup), **commit Skill packages to Git `HEAD`** so Runs bind cleanly, list docs via `evolve workflows`, and validate contracts via `evolve skills validate <command>`.
2. **Open Session & chain**:
   - Argument-free chain: `evolve session open "<objective>" --id <session> --actor <actor> [--definition-of-done "<text>"] [--boundary-contract '<json>'] [--goals '<json>'] [--auto] [--goal-mode] --chain "ew-analyze,ew-plan,ew-execute,ew-verify"`.
   - Step with args / retries / gates: `evolve session chain insert --session <session> --step-id <id> --command <command> [--arg "<val>" ...] [--retry-max <n>] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] [--after-step <id>] --actor <actor> --expected-orchestration-revision <revision>` (pass `-`-prefixed values as `--arg=VALUE`).
   - Standalone decision gate (`decision-only`): add `--decision-only --decision-ref <gate-id>` instead of `--command`.
3. **Dispatch Run**: `evolve run next --session <session> --actor <actor> --expected-orchestration-revision <revision>` — passes `run_id`, `run_dir`, `skill_ref`, bound `upstream` (primary + sibling attachments/evidence), `boundary_contract`, `goals`, and `gates` (Runtime expands `{session}` and `{intent}` in `task.args` automatically).
4. **Concurrency & idempotency**: Advance `--expected-orchestration-revision` (and `--expected-run-revision` for Run mutations) from each receipt; keep the same `--request-id` when retrying an uncertain call, and re-read `evolve session status` on `REVISION_CONFLICT`.

## Read and Execute

- **Skill reads**: Open entry with `evolve run skill-read <run> --session <session>`, and package-relative `.md` links (zero `..` segments) with `evolve run skill-read <run> <destination> --from <source> --session <session>`.
- **Artifacts**: Read bound inputs via `evolve run artifact-read <run> <alias-or-id> --session <session>` (`--scope <JSON>` for `session-priors`). JSON artifacts MUST carry `_meta: { kind, schema, role, alias? }` and Markdown artifacts matching YAML frontmatter; NEVER append raw Markdown into `.json` files.
- **Knowledge Gate inside a Run** (choose one receipt source per Run):
  - **Run MCP** (`evolve mcp --root <project> --session <session> --run <run>`): open `session-priors` via `read_artifact` ONLY when its recorded `lookup_scopes` matches the current scope; otherwise search with `wiki_context` and open hits with `wiki_reference`.
  - **CLI fallback**: `evolve context "<topic>" --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"`, then inspect exact IDs with `--from-search <search-id>`. For steps declaring `outputs/priors.json`, Runtime snapshots CLI-read Wiki entries cleanly at `run complete` too.

## Verify, Continue and Recover

- **Seal Run**: `evolve run complete <run> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --summary "<observed result>" --gate <id>... [--verdict done|done_with_concerns]`. Run `evolve run check` first to preflight gates, outputs, and `report.md` `next` commands. Use `--verdict done_with_concerns` for non-fatal findings (downstream `consumes[]` slots expecting failed artifacts must declare `accepts_negative_evidence: true`).
- **Follow `continuation.action` & `authority`**:
  - When `continuation.authority === "automatic"` (`--auto`), keep executing satisfiable actions (`next` / `decide` / `complete`) in the same turn rather than stopping between steps (unless hit by a user gate, drift/confidence halt, or unrecoverable failure).
  - `execute` -> inspect/resume active Run via `evolve run brief` + `evolve run check`.
  - `recover` -> handle `blocked` Run via `evolve run transition` (or `cancel`) before retrying.
  - `decide` -> `evolve run decide <decision-id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --verdict proceed|fix|escalate [--confidence <0-100>] [--target-step <step-id>] --summary "<evidence>"` (`--target-step` reopens the target step through the gate when `verdict=fix`).
  - `next` -> allocate next pending step via `evolve run next`.
  - `complete` -> `evolve session complete --session <session> --actor <actor> --expected-orchestration-revision <rev>`, then hand off closeout review/harvesting to standalone `ew-knowledge` (`evolve workflows show knowledge`).
- **Crash / Stuck-Run Recovery**: Read `evolve session list --status open [--query <text>]`, `evolve session status --session <session>`, `evolve run brief <run> --session <session>`, and `evolve run check <run> --session <session>`. Use `evolve run transition <run> running|blocked|failed --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <run_rev> --reason "<why>"` (or `evolve run cancel ...`) with current fences before allocating a retry via `evolve run next`.
