# Validate and Release a Project Skill

## Static & Contract Validation

- Run `evolve skills validate <id> --root <repo>` (or `node dist/workflow-cli.js skills validate <id>` in this checkout).
- Note that Evolve binds the **committed Git revision (`HEAD^{commit}`)** — working-tree edits are ignored until committed (use a test commit in an isolated worktree to test unpublished changes).
- Fix any broken link, cross-package `..` path, unsupported lifecycle, or output schema mismatch at the source.

## Runtime & Replay Verification

- **Stateful Skills (`session-mode: run`)**:
  - Verify a fresh Run binds the expected commit and `contract`.
  - Read `SKILL.md` and exercised links via `evolve run skill-read`, confirm input aliases and output schemas, and run `evolve run check` before `evolve run complete`.
  - When migrating existing guidance, also resume a Run bound to the prior commit and replay one historically successful case.
- **Standalone Skills (`session-mode: none`)**:
  - Verify the actual host entry, expected outputs, and completion receipt.

## Routing: `ew-skill-design` vs `workflow-evolve`

- Use **`workflow-evolve`** for single-evidence behavioral fixes (short inline addition <= 280 chars, conditional link, or `references/learnings/` entry) via `evolve session review <session-id>` -> `draft` -> `replay` -> `apply` / `rollback`.
- Use **`ew-skill-design`** for new Skills, multi-file restructuring, or `contract` / lifecycle changes.
