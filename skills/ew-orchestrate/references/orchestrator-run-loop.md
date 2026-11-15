# Evolve Session execution and recovery

Use the bundled evolve command. A checkout can invoke the same entry with node dist/workflow-cli.js. Session and Run state, requests and sealed artifact bytes share the SQLite database under .agent-memory/. Working outputs and campaign checkpoints live under the run_dir returned by the controller.

## Start and dispatch

1. Run `evolve install` to choose a project or user installation and select Skill packages. For unattended project setup, use `evolve install --scope project --yes`. Commit the project Skill files so Runs can pin them. Use `evolve workflows` to list the packaged Markdown and `evolve workflows show session-run` to open this guide. Use `evolve skills validate <command>` to validate a step's committed contract and required links.
2. Open with evolve session open "<objective>" --id <session> --actor <actor>. Supply --definition-of-done and --chain "ew-analyze,ew-plan,ew-execute,ew-review" for an argument-free chain. For step arguments, use evolve session chain insert --session <session> --step-id <id> --command <command> --arg "<argument>" --actor <actor> --expected-orchestration-revision <revision>. Add --decision-ref <id> where a step requires a coordinator decision. Pass argument values beginning with a hyphen as --arg=VALUE.
3. Dispatch evolve run next --session <session> --actor <actor> --expected-orchestration-revision <revision>. The response supplies the exact Run, frozen task, Skill reference, input artifacts and exit gates. Pass these identifiers to the host worker.
4. Use the returned orchestration_revision for the next Session mutation. Run completion and recovery also take the current Run revision. Supply a stable --request-id for a retry after an uncertain response. Each Session records the normalized mutation payload and the original result. Refresh status after a revision conflict.

## Read and execute

Open the entry with evolve run skill-read <run> --session <session>. Open each applicable Markdown link with evolve run skill-read <run> <destination> --from <source> --session <session>. Paths are relative to the bound Skill package. If Git objects are unavailable, restore that revision before resuming.

Read input artifacts with evolve run artifact-read <run> <alias-or-id> --session <session>. This returns the sealed bytes and lineage from the Run's input binding. Write the outputs declared by the Skill to its run_dir. Use _meta in JSON, the first record of NDJSON, or YAML frontmatter in Markdown. Match the declared kind, schema, role and alias.

Use `agent-memory context "<topic>" --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"` for project knowledge. Add `--task` or `--path` when known. Use agent-memory wiki reference and memory get with the same trace and --from-search when opening a result. Other hosts can connect to evolve mcp --root <project> --session <session> --run <run>. This exposes Skill reads, frozen inputs and Memory search and exact reads for the Run. Select one knowledge receipt source per Run.

For a bound Codex worker, use `evolve delegate "<prompt>" --to codex --mode analysis --session <session> --run <run>`. This connects Codex to that Run’s MCP tools. Use write mode for authorized edits. A host may also execute the step directly or use its own collaboration tools. Use `evolve delegate` without a Run binding for a second opinion from Agy.

## Verify and continue

Use evolve run check <run> --session <session> and repeat --gate <id> for each verified exit gate. The controller checks required Skill reads, evidence and outputs. Seal with evolve run complete <run> --session <session> --actor <actor> --expected-orchestration-revision <revision> --expected-run-revision <revision> --summary "<observed result>" and the same gates. The controller registers outputs and advances the step in one transaction. Record qualified outcomes with --verdict done_with_concerns.

Follow continuation.action. For decide, run evolve run decide <decision-id> --session <session> --actor <actor> --expected-orchestration-revision <revision> --verdict proceed|fix|escalate --summary "<decision evidence>". For next, allocate the pending step. For complete, use evolve session complete --session <session> --actor <actor> --expected-orchestration-revision <revision>. Review and harvest completed evidence through the [knowledge route](knowledge-route.md).

## Recover

Read evolve session status --session <session> and evolve run brief <run> --session <session>. Resume the exact bound Run and any domain checkpoint in its run_dir. For a blocked Run, transition it to running when the blocker clears. For a failed attempt, use evolve run transition <run> failed --session <session> --actor <actor> --expected-orchestration-revision <revision> --expected-run-revision <revision> --reason "<evidence>". Cancellation uses evolve run cancel with the same fences and reason. Allocate the resulting pending step through run next. New attempts retain retry lineage and bind the current Git version.

Historical Session receipts are available to agent-memory session review and agent-memory closeout session. Start an Evolve Session for new execution and reference the historical evidence in its objective when relevant.
