---
name: ew-skill-design
disable-model-invocation: true
description: Design, migrate, or validate an Evolve project Skill with linked Markdown, a Session/Run contract where needed, and reproducible host cases.
session-mode: none
version: 0.6.0
---

# Evolve Skill Design

Use this Skill when `evolve closeout` / knowledge routing classifies a structural or multi-file candidate as `skill-design`, or when authoring/migrating `skills/<id>/SKILL.md`. Single-evidence behavioral fixes route to `workflow-evolve` instead.

## Workflow

1. **Resolve context & lifecycle**:
   - Run the project Knowledge Gate (`evolve context` / `node dist/workflow-cli.js context`).
   - Inventory existing entry points, flags, inputs, outputs, and recovery paths when migrating a Skill.
   - Choose `session-mode: run` when durable progression, coordinator decisions, or artifact handoff is needed; otherwise use `session-mode: none`.
2. **Enforce Progressive Disclosure (`SKILL.md` vs `references/`)**:
   - Keep `SKILL.md` focused on: frontmatter (`name`, `description`, `session-mode`, `contract`, `required_links`), trigger/routing table, non-negotiable invariants, and short common steps.
   - Move mode details, schemas, checklists, and examples into package-relative `.md` links (see [the package contract guide](references/package-contract.md)). Never use cross-package `../` links.
   - Keep every entry in `required_links` minimal and literally linked in `SKILL.md`.
3. **Validate & verify**:
   - Follow [the replay and release procedure](references/validation.md) to validate the committed Git revision and exercise the main flow, one passing case, and affected recovery paths.

## Evolve design-task handoff

- When entered from `evolve closeout route`, inspect the task with `evolve skill-design task <task-id>` and run `evolve skill-design run <task-id>` (or `node dist/workflow-cli.js` in this checkout).
- Return a `skill-design/1.0` envelope (`task_id` + replayable `draft` naming the target entry, evidence sources, baseline hash, priority, and conditional links).
- Do not edit the target Skill during draft generation; the caller runs `evolve skill-design review <design-id>`, `replay`, and `apply`.
