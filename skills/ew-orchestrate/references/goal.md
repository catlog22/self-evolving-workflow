Read the [Run loop](orchestrator-run-loop.md) when resuming the Session after the amendment.
# Evolve Goal Amendment Flow

Under `evolve-session/1.0`, goal, boundary, decomposition and pending-tail changes belong to the Session chain and this Evolve policy. They never become a separate Execution or durable Session metadata command. Runs advance through fenced `evolve run next` and `evolve run complete`.

## 1. Capability and Snapshot

1. Read the Evolve capability receipt and retain the Session ID and current revision.
2. Resolve exactly one compatible Session through read-only recall, then read `evolve session status --session {session_id}`.
3. Retain exact `session_id + orchestration_revision` (plus `run_revision` for run-target mutations) and one authorized `actor_id`; pass it to `--actor` (`--participant` defaults to it). Never infer current authority from Session status.
1. Snapshot current Session objective, `definition_of_done`, `boundary_contract`, `goals[]`, `amendments[]`, sealed Run handoffs, pending chain, decisions, and revision via `evolve session status` / `evolve run brief`. Apply amendments to an open Session.

## 2. Parse and Assess

Use remaining `--amend` text as `change_request`; ask when empty. Classify `modify|add|remove|boundary` and derive affected goals, invalidated steps, new gaps, boundary additions, risk, reason, and evidence.

Assessment is read-only. Completed Run evidence remains immutable. High risk always requires explicit confirmation; `-y` cannot bypass it.

## 3. Build the Pending-Tail Chain Change

Construct the pending-tail chain change in memory:

- Append one `CHG-NNN` entry with before/after goals, reason, risk, and evidence.
- Supersede only unfinished affected goals; completed goals remain immutable evidence.
- Give modified goals versioned IDs and added goals the next `G{n}` ID.
- Add boundaries without deleting historical constraints.
- Preserve the chain step shape: `command/args?/stage?/goal_ref?/decision_ref?`.

Do not edit protocol JSON or issue direct chain mutations from a Skill. The orchestrator applies the pending-tail change through the fenced chain surface after Skill assessment:

`evolve session chain replace --session {session_id} --step-id <id> --command <name> --actor {actor_id} --expected-orchestration-revision {orchestration_revision}`

or `evolve session chain insert --session {session_id} --step-id <id> --command <name> [--arg <value> ...] [--after-step <id>] [--goal-ref <id>] [--stage <name>] [--decision-ref <id>] --actor {actor_id} --expected-orchestration-revision {orchestration_revision}` for added steps. Skipping a non-running step uses the fully fenced `session chain skip` form with evidence.

## 4. Commit the Amendment

3. After confirmation, record the new objective and completion criteria with `evolve session amend "<objective>" --definition-of-done "<criteria>" --session <session> --actor <actor> --expected-orchestration-revision <revision> --evidence <confirmation>` (Runtime appends `CHG-NNN` automatically to `Session.amendments[]`). Apply approved pending-tail changes (supporting `--retry-max <n>` and `--decision-only` on `session chain insert`) and dispatch with the current fence:

`evolve run next --session {session_id} --actor {actor_id} --expected-orchestration-revision {orchestration_revision}`

and complete it with:

`evolve run complete {run_id} --session {session_id} --actor {actor_id} --expected-orchestration-revision {orchestration_revision} --expected-run-revision {run_revision} --summary "<summary>" --verdict {done|done_with_concerns}`

Runtime must atomically validate and seal the Run plus advance the chain step and return `Evolve mutation receipt`. Consume its fresh `orchestration_revision` before continuing. Reject by recording a blocking concern; revise by re-reading `evolve session status` and applying another fenced chain mutation.

If the installed Runtime cannot express the complete goal/decomposition replacement as a Session-chain pending-tail change, stop with a capability blocker. Do not silently call a Session metadata command in the canonical branch.

## 5. Continue

Display amendment ID, risk, superseded/added goal counts, and chain disposition. Re-read exact `evolve session status`, then continue through fenced `evolve run next`. Recovery reads `evolve run check {run_id} --session {session_id}` and transitions/cancels the stuck Run; final completion remains `evolve session complete`.
