# Workflow: ew-blueprint

6-phase formal specification chain: `P1 Discovery -> P1.5 Clarification -> P2 Product Brief -> P3 PRD -> P4 Architecture -> P5 Epics -> P6 Readiness Check`.

## Phase Execution

1. **P1 Discovery**:
   - Confirm spec profile (`service` / `api` / `library` / `platform`) and depth (`light` / `standard` / `comprehensive`), saving `outputs/blueprint-config.json`.
   - Ground existing system context via read-only codebase exploration (`evolve code search` + optional subagent, joined before P2) -> write `outputs/discovery-context.json`. Use `search_web` only if external API constraints are needed.
2. **P1.5 Requirement Expansion** (skip if `upstream-context` already supplies confirmed requirements):
   - Analyze completeness across functional scope, user scenarios, NFRs, integrations, data model, and failure modes.
   - Clarify critical gaps via structured prompt (`ask_question` or host equivalent, up to 5 rounds) -> write `outputs/refined-requirements.json`.
3. **P2 Product Brief**:
   - Author `outputs/product-brief.md` (vision, target users, scope, non-goals, KPIs) and `outputs/glossary.json` (`>= 5` domain terms).
4. **P3 Detailed PRD**:
   - Write `outputs/requirements/_index.md` (summary + MoSCoW table + traceability) plus `outputs/requirements/REQ-NNN-*.md` and `NFR-*.md`.
5. **P4 Architecture**:
   - Write `outputs/architecture/_index.md` (system boundaries, components, tech stack, data flow) plus `outputs/architecture/ADR-NNN-*.md` reflecting active Wiki constraints.
6. **P5 Epics & Stories**:
   - Write `outputs/epics/_index.md` (dependency map, MVP cut) and `outputs/epics/EPIC-NNN-*.md`, deriving realistic slice sizes from P4.
7. **P6 Readiness Check & Packaging**:
   - Validate requirement coverage, ADR traceability, terminology consistency, and testability -> write `outputs/readiness-report.md` and `outputs/blueprint-summary.md`.
   - If readiness `< 60%`, run at most 2 targeted revision passes before escalating (`blocked` / caveats); `60–79%` proceeds with explicit caveats; `>= 80%` passes cleanly.
   - Emit `outputs/context-package.json` (`context-package/1.0`) for downstream `ew-roadmap`, `ew-analyze`, or `ew-plan`.

## Wrap-up & Seal

Write `{run_dir}/report.md` (`next` proposing `ew-roadmap` or `ew-plan`) and seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate phases-complete --gate readiness-passed --summary "<summary>" --verdict done|done_with_concerns`. Route reusable architectural decisions after sealing through `ew-knowledge` (`evolve workflows show knowledge`).
