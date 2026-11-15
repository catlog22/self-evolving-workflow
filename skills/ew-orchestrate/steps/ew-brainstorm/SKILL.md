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
  consumes: []
  produces:
  - path: outputs/brainstorm.json
    kind: brainstorm
    alias: current-brainstorm
    role: primary
    required: true
    schema: brainstorm/1.0
  contract_version: 2.1
---

# Brainstorm

Brainstorm is a planning step inside the Evolve Skill. Explore the problem space, record assumptions and alternatives, and leave a bounded option set for the next chain step.

1. Read the current Session objective, boundary contract and available Wiki evidence. Search `agent-memory context "<intent keywords>" --category arch --include-memory` when prior decisions or learning examples may affect the options.
2. Separate observed facts, user constraints, open questions and proposed options.
3. Compare options against scope, risk, reversibility and verification cost.
4. Write `outputs/brainstorm.json` with source evidence for every material conclusion.
5. Propose a follow-up chain only when the option requires a typed artifact or a durable decision.

Do not implement changes in this step. Do not replace the Session chain with an untracked recommendation.
