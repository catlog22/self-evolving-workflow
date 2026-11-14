---
name: analyze
wiki_categories: [arch]
description: Perform multi-dimensional analysis of a topic or existing implementation, producing findings and a risk-matrix consumable by plan
argument-hint: '[topic] [-y] [-q] [--from <artifact-alias>] [--gaps [ISS-ID]]'
required_links:
  - references/prepare.md
  - references/workflow.md
contract:
  consumes:
  - kind: guidance
    alias: current-guidance
    required: false
    schema: guidance/1.0
    role: primary
  - kind: blueprint
    alias: current-blueprint
    required: false
    schema: blueprint/1.0
    role: primary
  - kind: diagnosis
    alias: latest-debug
    required: false
    schema: diagnosis/1.0
    role: primary
  produces:
  - path: outputs/findings.json
    kind: findings
    alias: current-analysis
    role: primary
    required: true
    schema: findings/1.0
  - path: outputs/risk-matrix.json
    kind: risk-matrix
    role: evidence
    required: false
    schema: risk-matrix/1.0
  - path: outputs/priors.json
    kind: priors
    alias: session-priors
    role: evidence
    required: false
    schema: priors/1.0
  gates:
    exit:
    - exploration-done
    - discussion-round
    - scoring-complete
    - intent-covered
  contract_version: 2.1
session-mode: run
---

# Analyze

Read [preparation](references/prepare.md), then follow the [analysis workflow](references/workflow.md).

- Read [boundary review](references/boundary-grill.md) when a responsibility conflict is found.
- Read [issue gap analysis](references/issue-gaps-analyze.md) for the --gaps branch.
