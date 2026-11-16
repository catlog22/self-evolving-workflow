# Automatic Loop

The loop orchestrates four steps per round: baseline/candidate runner execution, history review, Agy discussion/confirmation, and isolated Git worktree replay.

## Round Order

1. **Preflight**: Read `HEAD` and verify the target Skill package has no uncommitted changes.
2. **Baseline**: Run all scenarios against the current Skill (must include >= 1 failing case and >= 1 passing case).
3. **History review**:
   - In Evolve Runs/Sessions, `evolve-loop.mjs` invokes `node dist/cli.js session review <id>` (or `evolve session review <id>`).
   - For standalone executions without a Session, pass `--execution <id> --project <id>` or `--history <transcript-evidence/1.0 JSON>`.
   - Record returned signals, Skill reference, Skill reads, and `knowledge_reads` in the round directory.
4. **Draft via Agy**: Request one minimal, evidence-linked change (`approved`, `priority`, `instruction`, `when`, `evidence`, `needs_revision`). Reject drafts lacking a traceable source or altering unrelated behavior; retry up to `--max-retries`.
5. **Replay**: Create the draft and replay it against the accumulated scenarios (`evolve skills draft` / `evolve skills replay`, or `dist/cli.js evolve draft` / `replay` inside `evolve-loop.mjs`). All baseline passes must stay green and baseline failures must pass.
6. **Confirm via Agy**: Submit draft ID, candidate commit, scenario results, and loaded Skill documents. `approved: false` halts without applying.
7. **Apply & Verify**: With `--auto`, apply the confirmed receipt and re-run scenarios on the applied commit; on any failure, immediately `rollback` and record the failure. Without `--auto`, leave the confirmed receipt pending.
8. **Persist & Loop**: Save round state and continue until `--iterations` completes or a stop condition triggers.

## State and Stop Conditions

- `state.json` is the single machine state source per run (`base`, `draft`, `replay`, `history`, Agy responses, apply status, verification results).
- Terminal statuses: `completed`, `agy_rejected`, `confirmation_rejected`, `rolled_back`, or `failed` (keeps round directory for recovery).
- History evidence is mandatory (`--allow-empty-history` is reserved for explicitly history-free test fixtures and recorded in `state.json`).
