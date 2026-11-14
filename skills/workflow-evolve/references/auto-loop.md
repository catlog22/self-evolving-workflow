# Automatic loop

The loop is deterministic around four external calls. The runner executes the real task, Agent Memory reviews history, Agy discusses and confirms the proposed change, and Git worktrees replay the baseline and candidate.

## Round order

1. Read the current `HEAD` and verify that the target Skill package has no uncommitted changes.
2. Run every scenario with the current Skill. At least one scenario must reproduce the known failure and one must already pass.
3. Review history with `agent-memory session review <id>` or `agent-memory evolve review <execution-id> --project <id>`. An explicit `--history` JSON file is accepted when no committed receipt exists. Keep the returned signals, Skill reference, Skill reads and `knowledge_reads` evidence in the round directory.
4. Ask Agy for one minimal, evidence-linked draft. Agy returns `approved`, `priority`, `instruction`, `when`, `evidence` and `needs_revision`. Reject a draft that lacks a stable source or changes an unrelated behavior. Retry only up to `--max-retries`.
5. Create the draft through `agent-memory evolve draft`. Replay it with `agent-memory evolve replay` against the accumulated scenario set. The replay must keep every baseline pass green and make every baseline failure pass.
6. Ask Agy to confirm the replay receipt. The confirmation includes the draft ID, candidate commit, scenario observations and loaded Skill documents. `approved: false` stops the round without applying the candidate.
7. With `--auto`, apply the receipt. Run the same scenarios from the applied commit. If any scenario fails, immediately call `agent-memory evolve rollback <receipt-id>` and record the failed verification. Without `--auto`, leave the confirmed receipt pending.
8. Persist the round state and continue until the requested count, a zero-signal review, an Agy rejection, or retry exhaustion stops the loop.

## State and stop conditions

`state.json` is the only machine state source. Each round records `base`, `draft`, `replay`, `history`, Agy responses, application status and verification observations. Stop with `completed` after the requested count, `agy_rejected` after bounded Agy retries, `confirmation_rejected` after replay review, or `rolled_back` after an applied verification failure. A process error is `failed` and keeps the round directory for recovery.

The loop resolves Session IDs from the supplied inputs, records exact reads behind each search, and applies drafts with an Agy confirmation receipt. A history source is mandatory. `--allow-empty-history` serves an explicitly history-free fixture and records that exception in the round state.
