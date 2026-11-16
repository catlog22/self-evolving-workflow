---
name: ew-odyssey-review
description: "Odyssey review mode — multi-dimensional deep code review through archaeology, exploration, 4-dimension audit, exhaustive severity-tiered fix, and zero-residual confirmation, producing review"
argument-hint: "<target: file|dir|HEAD|staged|phase#|PR#> [--skip-fix] [--skip-generalize] [-y] [-c]"
contract:
  contract_version: 2.1
  produces:
    - path: outputs/session.json
      kind: session
      schema: session/1.0
      role: primary
      alias: review-session
      required: true
    - path: outputs/evidence.ndjson
      kind: evidence
      schema: evidence/1.0
      role: evidence
      alias: review-evidence
      required: false
    - path: outputs/understanding.md
      kind: understanding
      schema: understanding/1.0
      role: primary
      alias: review-understanding
      required: false
    - path: outputs/explore.json
      kind: exploration
      schema: exploration/1.0
      role: evidence
      alias: review-explore
      required: false
goal: true
---

# Pre-task Thinking: odyssey-review

## Purpose

Odyssey review is a full-lifecycle code review cycle: target intake → archaeology → code exploration → multi-dimensional review audit → exhaustive severity-tiered fix → zero-residual confirmation → generalization → discovery → knowledge persistence. Unlike standalone code review (which produces only findings), odyssey-review carries through to fix ALL findings by severity, confirm zero residual, generalize patterns project-wide, and persist learnings.

## Input Interpretation

Entry modes:

| Mode | Trigger | Target source |
|------|---------|---------------|
| file/dir | file or directory path in `<intent>` | Review those files directly |
| diff | `HEAD` or `staged` in `<intent>` | `git diff HEAD` or `git diff --staged` |
| session/run | session/run ID or commit range in `<intent>` | Evolve Run artifacts / `git diff <base>..<head>` |
| PR | PR number in `<intent>` | `git diff main...HEAD` |
| continuation | `-c` | Resume via latest session, jump to `current_state` |

Target resolution table:

| Input | Resolution |
|-------|-----------|
| File/dir path | Review those files |
| `HEAD` / `staged` | `git diff HEAD` / `git diff --staged` |
| Session/Run ID or commit range | Evolve Run artifacts / `git diff <base>..<head>` |
| PR number | `git diff main...HEAD` |

## Required Context

Satisfy the Knowledge Gate (`AGENTS.md`) before searching code:

- Wiki & Memory (first): Run MCP `wiki_context` / `memory_search` + `wiki_reference` / `memory_get`, or CLI `evolve context "<target keywords>" --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"` (plus `evolve wiki get <id> --resolved --reads ... --from-search ...`) for `review` and `coding` scope.
- Code graph (after Knowledge Gate): `evolve code search "<target keywords>"` → module boundaries, ownership.

When prior review artifacts of the same scope exist, check their findings first to avoid re-reviewing already-addressed patterns.

## Run Artifact Metadata

Attach `kind`, `schema`, `role`, and `alias` from `produces` to top-level `_meta` in `outputs/session.json` and `outputs/explore.json`, the first JSON record in `outputs/evidence.ndjson`, and YAML frontmatter in `outputs/understanding.md` (`current_state: "END"` before `evolve run complete`).

## Boundaries and Invariants

- **State chain:** `S_INTAKE → S_ARCHAEOLOGY → S_EXPLORE → S_REVIEW → S_FIX → S_CONFIRM → [back-half]`
- **Zero-residual applies** — fix ALL findings within fix_threshold (default: all severity levels). No partial-tier advancement.
- **Evidence append-only** — evidence.ndjson entries are immutable observations; modifying or deleting them is forbidden.
- **Phase goal tracking** — mark each goal done/failed before transition; no silent skips.
- **4-dimension mandatory** — all dimensions (correctness, security, performance, architecture) must be reviewed. Zero dimensions reviewed is BLOCKED.
- **Exhaustive fix by severity** — descend through [critical, high, medium, low], each tier fully addressed before advancing. Blanket "pre-existing" classification forbidden; each finding must be individually assessed.
- **max_fix_rounds = 5** — hard limit on fix retry rounds. After 5 rounds with remaining > 0, escalate to user or classify as deferred.
- **Test evidence reuse across S_FIX/S_CONFIRM** — a per-tier commit invalidates only tests covering the committed changes; unchanged passing results carry forward, and S_CONFIRM reruns only invalidated targets plus the modified-area re-review. Never rerun the full matrix merely because a tier advanced.
- **Generalize is mandatory** unless `skip_generalize == true`; prior-phase convergence is NOT a valid skip reason.
- **Fix scope:** source code modifications during fix phase are in-scope but MUST be committed per tier. Session artifacts target `{run_dir}/outputs/` only.
- **In scope:** Multi-dimensional deep review → exhaustive fix → generalize. **Out of scope:** Root cause debug → `--mode debug` | Feature implementation → `--mode planex` | UI visual optimization → `--mode ui`.

## Risk Checklist

- Are all 4 review dimensions (correctness, security, performance, architecture) covered? Missing a dimension leaves an entire class of findings undetected.
- Is every finding backed by file, line, and description evidence? Vague findings without location are not actionable.
- Did you descend severity tiers in order (critical → high → medium → low)? Skipping tiers leaves high-severity issues unfixed.
- Is every finding in a tier either fixed or individually classified with a reason? Blanket "pre-existing" skips are forbidden.
- Have fix rounds exceeded 5? Stop and escalate — do not continue fixing indefinitely.
- Are archaeology/explore results properly logged even on partial failure (W003/W006)? Missing evidence must be flagged, not silently omitted.
- Is every discovery hit individually classified with a reason? Blanket skips are forbidden.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.
- Did the zero-residual confirmation actually re-review modified areas? A pass-through without re-review does not satisfy the CONFIRM gate.

## Gate Intent

- `discovery-complete`: archaeology and/or exploration phases have logged evidence, understanding.md §2-§3 are updated, and explore goal (G2) is marked. Log W003 on partial archaeology failure or W006 when no CLI exploration executor is available, and record what was covered.
- `all-dimensions-reviewed`: all 4 dimension agents (correctness, security, performance, architecture) have completed, findings are merged into review_result with severity classification, evidence phase=review is logged, and understanding.md §4 severity matrix is written. G1 is marked. Zero dimensions reviewed is BLOCKED (W002 partial with at least 1 dimension is allowed).
- `zero-remaining`: exhaustive fix has been applied tier-by-tier, `remaining_actionable == 0` (or all remaining individually classified as deferred after 5-round escalation), tests covering the modified areas pass (reusing still-valid live-run results from S_FIX rounds when nothing they cover changed since; rerunning only invalidated targets), CLI re-review confirms no new findings, confirmation is written, understanding.md §5 is updated, and G3 is marked. `needs_rework` routes back to FIX. Skippable only when `skip_fix == true`.
