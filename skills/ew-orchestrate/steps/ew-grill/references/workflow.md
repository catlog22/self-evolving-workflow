# Workflow: ew-grill

Adversarial Socratic pressure testing: `Parse & Route -> Discovery & Terminology -> Branch Walking -> Synthesis -> Context Package -> Wrap-up`.

## Step 1: Discovery & Codebase Grounding

1. Load optional upstream artifact via Run MCP (`read_artifact`) or `evolve run artifact-read <run> upstream-context --session <session>` (or read `--from @file` / `--from <blueprint>`).
2. Complete the Knowledge Gate (`session-priors` / `wiki_context` / CLI `--reads`) to surface architectural constraints and domain decisions.
3. Launch a read-only exploration subagent (`invoke_subagent` / host equivalent, joined before Step 2) + `evolve code search` to map overlapping modules, naming conventions, error-handling patterns, and integration boundaries -> save summary to `{run_dir}/evidence/codebase-context.json`. If grounding fails, mark findings `[LOW CONFIDENCE]`.

## Step 2: Terminology Alignment (`terminology-aligned` gate)

Compare proposal nouns/verbs/states against existing codebase identifiers and Wiki concepts:
- Flag every naming collision, overloaded term, or vague abstraction.
- Arbitrate canonical names with the user (or codebase convention under `-y`).
- Write `{run_dir}/outputs/terminology.md` before walking deep branches.

## Step 3: Socratic Branch Walking (`branches-walked` gate)

Walk `3` (`shallow`), `5` (`standard`), or `8` (`deep`) risk branches in order from **basic -> specific -> adversarial**:
- For each branch, form 1 concrete assumption vs codebase `file:line` reality.
- In interactive mode, ask targeted questions through the host structured question tool (`ask_question` or equivalent), surfacing real trade-offs instead of generic menus.
- Under `-y`, answer branches directly from codebase evidence, recording `source: code-grounded` and explicit assumptions.
- Challenge any contradiction immediately before closing the branch.

## Step 4: Synthesis, Context Package & Seal

1. Write `{run_dir}/outputs/grill-report.md` (decisions, rejected assumptions, `file:line` evidence, open risks, residual severity).
2. Write `{run_dir}/outputs/context-package.json` (`context-package/1.0`: `domain`, `requirements[]`, `constraints[]`, `non_goals[]`, `insights[]`, `references[]`) for downstream `ew-brainstorm` / `ew-plan` / `ew-blueprint`.
3. Write `{run_dir}/report.md` with frontmatter (`verdict`, `summary`, `constraints`, `decisions`, `concerns`, `next` proposing `ew-brainstorm` or `ew-plan` only when justified).
4. Seal via fenced `evolve run complete <run_id> --session <session> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <rev> --gate terminology-aligned --gate branches-walked --summary "<summary>" --verdict done|done_with_concerns`. Stage reusable architectural constraints afterward through `ew-knowledge` (`evolve workflows show knowledge`).
