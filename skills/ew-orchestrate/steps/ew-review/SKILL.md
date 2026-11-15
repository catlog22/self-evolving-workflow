---
name: ew-review
description: Review a change or artifact inside the Evolve chain and produce typed findings
argument-hint: '<target> [--tier quick] [-y]'
wiki_categories: [review, coding]
search_profile:
  wiki: [constraints, references]
  memory: [error, correction, verified_fix]
session-mode: run
required_links:
  - references/prepare.md
  - references/workflow.md
contract:
  consumes:
  - kind: artifact
    alias: current-execution
    required: false
    schema: artifacts/1.0
    role: primary
  produces:
  - path: outputs/review.json
    kind: review-findings
    alias: latest-review
    role: primary
    required: true
    schema: review-findings/1.0
  contract_version: 2.1
---

# Review

Review is a quality step inside the Evolve Skill. Use the linked preparation and workflow documents for the full review protocol.

- Read [review preparation](references/prepare.md) before defining the audit scope.
- Read [review workflow](references/workflow.md) for the four dimensions, evidence format and zero-residual gate.
- Write `outputs/review.json` with file and line evidence, severity, remediation and verification status.

The review step reports findings and follows the confirmed Session chain. It does not create a separate orchestration entry.
