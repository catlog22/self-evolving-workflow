---
name: ew-brainstorm
description: Explore a problem space and produce bounded options for the Evolve chain
argument-hint: '<intent> [--from <artifact-alias>] [-y]'
wiki_categories: [arch, learning]
search_profile:
  wiki: references
  memory: optional
session-mode: run
contract:
  consumes:
  - kind: context-package
    alias: upstream-context
    required: false
    schema: context-package/1.0
    role: attachment
    accepts_negative_evidence: true
  - kind: priors
    alias: session-priors
    required: false
    schema: priors/1.0
    role: evidence
  produces:
  - path: outputs/brainstorm.json
    kind: brainstorm
    alias: current-brainstorm
    role: primary
    required: true
    schema: brainstorm/1.0
  - path: outputs/context-package.json
    kind: context-package
    alias: upstream-context
    role: attachment
    required: false
    schema: context-package/1.0
  contract_version: 2.1
---

# Brainstorm

Brainstorm is a planning step inside the Evolve Skill. Explore the problem space, record assumptions and alternatives, and leave a bounded option set for the next chain step.

1. Read the current Session objective, `boundary_contract`, optional `upstream-context`, and available Wiki evidence. Reuse `session-priors` when the lookup scope matches; otherwise query `wiki_context` + `wiki_reference` (Run MCP) or `evolve context "<intent keywords>" --category arch --include-memory --session <session> --reads "<run_dir>/knowledge-reads.json"` + `--from-search` (CLI fallback).
2. Separate observed facts, user constraints, open questions, and proposed options.
3. Compare options against scope, risk, reversibility, and verification cost.
4. Write `{run_dir}/outputs/brainstorm.json` (with `_meta: { kind: "brainstorm", schema: "brainstorm/1.0", role: "primary", alias: "current-brainstorm" }`) and optional `outputs/context-package.json` (`_meta` matching `context-package/1.0`), citing source evidence for every material conclusion.
5. Write `{run_dir}/report.md` (`next` proposing `ew-blueprint`, `ew-roadmap`, `ew-analyze`, or `ew-plan` only when durable follow-up artifacts are needed), then seal via `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --summary "<summary>" --verdict done|done_with_concerns`. If blocked, inspect `evolve run check` and recover via `evolve run transition` / `run cancel`.

Do not implement changes in this step. Do not replace the Session chain with an untracked recommendation.
