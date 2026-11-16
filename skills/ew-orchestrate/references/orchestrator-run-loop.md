# Evolve Session Execution and Recovery

Use the bundled `evolve` CLI (in this source checkout, run `node dist/workflow-cli.js`). Session and Run state, requests, and sealed artifact bytes share the SQLite database under `.agent-memory/`; working outputs live under the `run_dir` returned by the controller.

## Start and Dispatch

1. **Install & validate**: Run `evolve install` (`--scope project --yes` for unattended project setup), commit Skill packages so Runs bind to a Git revision, list docs via `evolve workflows`, and validate contracts via `evolve skills validate <command>`.
2. **Open Session & chain**:
   - Argument-free chain: `evolve session open "<objective>" --id <session> --actor <actor> [--definition-of-done "<text>"] --chain "ew-analyze,ew-plan,ew-execute,ew-review"`.
   - With step args / gates: `evolve session chain insert --session <session> --step-id <id> --command <command> --arg "<argument>" [--decision-ref <id>] --actor <actor> --expected-orchestration-revision <revision>` (pass values starting with `-` as `--arg=VALUE`).
3. **Dispatch Run**: `evolve run next --session <session> --actor <actor> --expected-orchestration-revision <revision>` — pass the returned `run_id`, `run_dir`, `skill_ref`, `upstream`, and `gates` to the executing worker.
4. **Concurrency & retries**: Advance `--expected-orchestration-revision` (and `--expected-run-revision` for Run mutations) from each receipt; keep a stable `--request-id` when retrying an uncertain response, and call `evolve session status` after any `REVISION_CONFLICT`.

## Read and Execute

- **Skill reads**: Open entry with `evolve run skill-read <run> --session <session>`, and required/conditional links with `evolve run skill-read <run> <destination> --from <source> --session <session>` (package-relative `.md` paths only).
- **Artifacts**: Read upstream inputs with `evolve run artifact-read <run> <alias-or-id> --session <session>` (`--scope <JSON>` when filtering). Write declared outputs under `{run_dir}/outputs/` with matching `_meta` (JSON), first NDJSON record, or YAML frontmatter (Markdown).
- **Knowledge Gate inside a Run** (choose one receipt source per Run):
  - **Run MCP** (`evolve mcp --root <project> --session <session> --run <run>`): open bound `session-priors` via `read_artifact` when its scope matches; otherwise search with `wiki_context` and open selected IDs with `wiki_reference`.
  - **CLI fallback**: `evolve context "<topic>" --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"`, then inspect exact IDs with `--from-search <search-id>`.
- **Delegation**:
  - Within Antigravity: execute directly or use `invoke_subagent` / `swarm` (joining all subagents).
  - External worker: `evolve delegate "<prompt>" --to codex --mode analysis|write --session <session> --run <run>` attaches `evolve mcp` (`--to agy` runs standalone without Run MCP binding).

## Verify and Continue

- **Seal Run**: `evolve run complete <run> --session <session> --actor <actor> --expected-orchestration-revision <revision> --expected-run-revision <revision> --summary "<observed result>" --gate <id>... [--verdict done|done_with_concerns]`. Use `evolve run check` to diagnose blockers.
- **Follow `continuation.action`**:
  - `decide` -> `evolve run decide <decision-id> --session <session> --actor <actor> --expected-orchestration-revision <revision> --verdict proceed|fix|escalate --summary "<evidence>"`
  - `next` -> allocate next pending step via `evolve run next`
  - `complete` -> `evolve session complete --session <session> --actor <actor> --expected-orchestration-revision <revision>`, then follow [knowledge-route.md](knowledge-route.md) to review/harvest findings.

## Recover

- Inspect `evolve session status --session <session>` and `evolve run brief <run> --session <session>`.
- Transition blocked Runs back to `running`, or mark failed/cancelled attempts via `evolve run transition <run> failed` / `evolve run cancel` (with current fences and `--reason`), then allocate the pending retry via `evolve run next`.
- Historical receipts remain readable via `evolve session review` and `evolve closeout session`.
