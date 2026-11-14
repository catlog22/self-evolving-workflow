---
name: workflow-evolve
description: Analyze a Skill execution history, run a real Codex plus Agent Memory regression, and iteratively improve the Skill through an Agy-confirmed replay loop.
argument-hint: <skill-entry> --iterations <n> --scenarios <file> [--session <id>|--execution <id>] [--auto]
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
  - request_user_input
  - update_plan
  - wait_agent
session-mode: run
required_links:
  - references/auto-loop.md
  - references/history-review.md
  - references/agy-gate.md
contract:
  contract_version: 2.1
  consumes: []
  produces:
    - path: outputs/evolution-report.json
      kind: workflow-evolution-report
      schema: workflow-evolution/1.0
      role: primary
      alias: latest-workflow-evolution
      required: true
  gates:
    entry:
      - explicit iteration count is a positive integer
      - target Skill package is committed and replayable
    exit:
      - every applied round has an Agy confirmation receipt
      - baseline and candidate scenarios pass
      - failed applications are rolled back
version: 0.2.0
---

# Workflow Evolution

Use this Skill when a completed Session/Run or standalone Skill execution needs evidence-based improvement. The Skill keeps the existing Git worktree replay model, adds a real Codex and Agent Memory task, and runs a bounded loop whose changes are gated by Agy.

The entry requires `--iterations <n>`. `--auto` enables unattended apply and rollback after the Agy gate while retaining history, replay and confirmation checks. With interactive apply, the loop stops after a confirmed replay and leaves the receipt ready for the next authorized action.

Follow [the automatic loop](references/auto-loop.md) for argument parsing, state, retries and stop conditions. Follow [history review](references/history-review.md) before drafting a change. Follow [the Agy gate](references/agy-gate.md) before replay and apply.

## Entry contract

```text
workflow-evolve <skill-entry>
  --iterations <positive integer>
  --scenarios <JSON file with one baseline failure and one baseline pass>
  [--runner <replay runner>]
  --session <Session ID> | --execution <Skill execution ID> | --history <JSON transcript>
  [--project <project ID>] [--max-retries <n>] [--auto]
```

The default runner is `scripts/codex-memory-replay.mjs`. It invokes the real `codex exec` CLI in read-only mode, requires the Codex task to call Agent Memory through `scripts/memory-codex-mcp.mjs`, and returns loaded Skill files plus a `knowledge-reads/1.0` receipt. Use `scripts/codex-replay.mjs` when the host provides a compatible Maestro Session/Run CLI. Set `MAESTRO_REPLAY_CLI` to that CLI. `AGENT_MEMORY_REPLAY_CLI` remains a compatibility alias for older callers.

## Required evidence

- Prepare the target Skill package as a clean commit before replay. `agent-memory evolve replay` creates isolated baseline and candidate worktrees from that commit.
- Supply either a committed Session/Run, a standalone Skill execution ID, or an explicit transcript file. The history review records the source and the extracted signals used for the draft.
- Preserve the Agy discussion and confirmation JSON for every round. Apply each draft after its Agy response carries `approved: true`.

## Automatic invocation

```powershell
node skills/workflow-evolve/scripts/evolve-loop.mjs `
  --skill skills/workflow-evolve/SKILL.md `
  --iterations 3 `
  --scenarios .workflow/evolution/scenarios.json `
  --session <session-id> `
  --auto
```

The script writes one state file and one directory per round under `.workflow/evolution/<timestamp>/.` The Run adapter publishes the final state as `outputs/evolution-report.json`.
