---
name: ew-companion
description: Execute and verify one bounded edit or state-changing task in an Evolve Run without multi-step decomposition.
argument-hint: '<intent> [--from <alias>]'
wiki_categories: [coding]
search_profile:
  wiki: [constraints, references]
  memory: [error, correction, verified_fix]
session-mode: run
contract:
  consumes:
  - kind: review-findings
    alias: latest-review
    required: false
    schema: review-findings/1.0
    role: primary
    accepts_negative_evidence: true
  - kind: diagnosis
    alias: latest-debug
    required: false
    schema: diagnosis/1.0
    role: primary
    accepts_negative_evidence: true
  - kind: fix-directions
    alias: latest-fix-directions
    required: false
    schema: fix-directions/1.0
    role: attachment
    accepts_negative_evidence: true
  - kind: priors
    alias: session-priors
    required: false
    schema: priors/1.0
    role: evidence
  produces:
  - path: outputs/companion-log.md
    kind: companion-log
    role: attachment
    required: false
    schema: companion-log/1.0
  contract_version: 2.1
---

# Companion

Execute one bounded single-concern edit or verifiable check inside an Evolve Run (`skills/ew-orchestrate/references/companion-route.md`):

1. Read the bound task, complete the Knowledge Gate (`wiki_context`/`wiki_reference` or CLI `--reads`), and inspect any bound `latest-review` / `latest-debug` inputs (`evolve run artifact-read`).
2. Perform the minimal scoped change and run the narrowest direct verification command.
3. Record actions, modified files, and observed command results in `{run_dir}/outputs/companion-log.md` (YAML frontmatter `kind: companion-log`, `schema: companion-log/1.0`, `role: attachment`), then seal via `evolve run complete` (or escalate via `evolve run transition ... blocked` / `run cancel` if scope expands past a single concern).
