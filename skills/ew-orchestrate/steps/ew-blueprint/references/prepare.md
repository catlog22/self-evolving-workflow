# Pre-flight: ew-blueprint

Confirm input source, depth, Knowledge Gate constraints, and document-only boundaries before executing [workflow](workflow.md).

## Input & Mode

- **Direct text / `@file`**: fresh specification pipeline starting from P1 Discovery & P1.5 Clarification.
- **`--from <alias>` / `upstream-context`**: load bound `context-package.json` (`requirements[]`, `constraints[]`, `domain.terminology[]`, `non_goals[]`, `insights[]`) and skip redundant P1.5 expansion.
- **`-c` / `--continue`**: inspect prior `blueprint-config.json` and resume from the first incomplete phase.
- **`-y`**: auto-select default profile (`service` / `standard` depth) and non-ambiguous suggestions; stop if broad requirements lack minimum domain truth.

## Knowledge Gate & Research

1. Reuse bound `session-priors` for architectural/spec constraints; otherwise query `wiki_context` + `wiki_reference` (or CLI `evolve context "<idea keywords>" --task blueprint --session <session> --include-memory --reads "<run_dir>/knowledge-reads.json"` + `--from-search <search-id>`).
2. Exclude already-shipped features from spec scope and carry lessons learned into P1 risk assessment and P4 ADRs.

## Boundaries & Exit Gates

- **Document-only**: zero implementation code edits; write outputs exclusively under `{run_dir}/outputs/`.
- **Phase gates**: P2 requires `outputs/product-brief.md` + `>=5` terms in `outputs/glossary.json`; P3 requires `outputs/requirements/_index.md` with MoSCoW prioritization & traceability.
- **Exit gates**: `phases-complete` (P2–P5 documents written and cross-linked) and `readiness-passed` (P6 readiness check `>= 80%`, or `60–79%` documented with explicit caveats after up to 2 auto-fix passes).
