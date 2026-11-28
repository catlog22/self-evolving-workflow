---
name: ew-skill-design
description: "Author, package, consolidate, or validate an Evolve Skill package (`skills/<id>/SKILL.md` or `skills/ew-orchestrate/steps/<id>/SKILL.md`)."
session-mode: none
version: 0.8.0
---

# Evolve Skill Design

Use this Skill (directly or as the packaging standard inside `/workflow-evolve` and `ew-knowledge` `skill-design` routes) when creating a new Skill, migrating/restructuring an existing Skill, adding a Session/Run `contract`, or consolidating bloated learnings. Single-issue patches belong in `workflow-evolve`.

## Workflow

1. **Resolve context, invocation, and Dual Loads**:
   - Satisfy the Knowledge Gate first (`evolve search "<query>" --mode context` outside a Run, or `evolve skill workflows show session-run` inside a Run).
   - For migrations or consolidations, inventory every existing entry point, flag, input/output, learning file, and recovery path.
   - Choose invocation mode by **Dual Loads** (`context load` vs `cognitive load`):
     - **Model-invoked** (default; omit `disable-model-invocation`, keep branch-triggered `description`) when the agent or another Skill must fire it autonomously.
     - **User-invoked** (`disable-model-invocation: true`, one-line human `description` with trigger lists stripped, matching `policy.allow_implicit_invocation: false` in `agents/openai.yaml` when present) when only the human types `/skill`.
   - Choose `session-mode: run` when durable progression, coordinator decisions, or typed artifact handoff (`contract_version: 2.1`) is required; otherwise use `session-mode: none`.
   - *Done when*: Knowledge Gate recorded, invocation mode + `session-mode` justified by Dual Loads, and all package surfaces inventoried.

2. **Detect and Design Self-Evolving Loops**:
   - Evaluate whether the target Skill operates in a recurring, high-variance domain (e.g. real-world E2E testing & bug repair, coupled multi-parameter validation, regression hunting, or periodic auditing) where prior bugs and project knowledge compound across runs.
   - When loop signals apply, design a **Dual-Layer Self-Evolving Loop** following [the self-evolving loop guide](references/self-evolving-loop.md):
     - **Data layer (automatic per run)**: pre-run `Retrieve` (`evolve search` + on-demand `playbooks/<domain>/`), layered real-user fault execution with append-only `retest_of` verification, and post-run `Capture` (deduplicated `defect-patterns.yaml`, minimal sanitized `cases/`, and `evolve kb add --kind episodic` with `kb get` read-back).
     - **Process layer (governed only)**: keep `SKILL.md` free of per-bug patches; emit a `skill-evolution-proposal.md` only when a workflow blind spot repeats (`>= 2`) and route upgrades through `ew-skill-design` / `/workflow-evolve`.
   - When the task is a one-off static procedure, explicitly mark the Skill `static` and skip loop scaffolding.
   - *Done when*: Loop applicability is decided (`dual-layer` or `static`); for self-evolving Skills, Retrieve, layered Execute/Retest, deduplicated Capture, and governed process-layer boundaries are specified.

3. **Structure by Information Hierarchy and Positive Authoring**:
   - Apply **Progressive Disclosure** (see [the package contract guide](references/package-contract.md)): keep `SKILL.md` to frontmatter, routing table, core invariants, and ordered steps; move branch-only details, schemas, and checklists under `references/`, and keep evolving domain data under `playbooks/<domain>/` outside `required_links`.
   - Keep `required_links` minimal (universally preloaded files only) and literally linked in `SKILL.md`.
   - **Co-locate** each concept's definition, rules, and caveats under one heading; keep one authoritative source of truth.
   - Anchor behavior with sharp **leading words**, **positive framing**, checkable **completion criteria** (`Done when`) on every step, and **no-op / sediment pruning**.
   - *Done when*: All branch-only material is disclosed under `references/` (and domain playbooks under `playbooks/`), every step has a checkable completion criterion, `required_links` is minimal and literally linked, and prose passes positive-framing & pruning review.

4. **Validate & Verify**:
   - Follow [the replay and release procedure](references/validation.md) and run `evolve skill validate <id>` (or `evolve skill validate --all` on the committed Git revision) to verify strict YAML, host-invocation parity, `#heading` anchors, `session-mode` vs `contract`, self-evolving loop separation (when applicable), and reproducible passing/recovery cases.
   - *Done when*: Static validation passes on the committed revision and every required runtime/verification scenario passes cleanly.

## Optional Governed Design-Task Pipeline

When integrating with automated `evolve kb candidates route` handoffs (`skill-design` tasks; `--skill` optional for brand-new Skills and supports `ew-orchestrate/steps/<id>`):
- Inspect with `evolve skill design task <task-id>`, execute `run` -> `review` -> `replay` -> confirmed `apply` (or `rollback` on regression), keeping the target Skill untouched until `apply`.
