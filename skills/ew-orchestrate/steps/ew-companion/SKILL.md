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

Execute one single-concern task, feature, localized fix, or verifiable check directly inside an Evolve Run using full model capability (`evolve skill workflows show ew-orchestrate` / `companion-route.md`):

1. Read the bound task, complete the Run Knowledge Gate (`evolve skill workflows show session-run`: reuse bound `session-priors` when `coding` scope matches; otherwise run `evolve search "<query>" --mode context` / `evolve kb get <id>` with CLI `--reads`), and inspect any bound `latest-review` / `latest-debug` inputs (`evolve run read artifact`).
2. Locate targets and perform the scoped changes directly in the current Run context (file count is not a hard blocker; do NOT split into subagents or `ew-analyze`/`ew-plan` phases by default unless isolated parallelism is explicitly needed), then run the narrowest direct verification command(s).
3. Record actions, modified files, and observed command results in `{run_dir}/outputs/companion-log.md` (YAML frontmatter `kind: companion-log`, `schema: companion-log/1.0`, `role: attachment`), persist any non-obvious verified fix or environment quirk via `evolve kb add --kind episodic "<lesson>" --type verified_fix --scene coding --session <session_id>`, then write `report.md` and seal or transition the Run per `evolve skill workflows show session-run` (or escalate in the same Session via `evolve run cancel` + `session step delete` + `session step add` if unexpected cross-module coupling or root-cause ambiguity requires multi-step decomposition).
