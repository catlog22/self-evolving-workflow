# Pre-flight: ew-init

Confirm repository state, bootstrap prerequisites, and Evolve-native boundaries before running [workflow](workflow.md).

## Modes & Input

- **Interactive (default)**: auto-detects greenfield vs brownfield vs legacy Maestro vs already-initialized, then collects missing project context.
- **`-y`**: auto-initializes from `--from`, `@file`/prompt text, or brownfield codebase scan without interactive interviews (`-y` still NEVER authorizes unapproved Wiki publication).
- **`--from <alias>`**: consume bound `upstream-context` (`context-package.json`) to populate vision, goals, locked constraints, non-goals, and terminology without repeating discovery.

## State Detection Rules (`state-detected` gate)

Inspect repository root before scanning or proposing writes:
- **Worktree guard**: refuse to initialize a fresh project baseline inside a linked `.git` temporary worktree; run initialization on the main repository checkout.
- **Path A (`greenfield`)**: no application source files yet -> run deep questioning ("What do you want to build?" -> core value, target users, 2–5 primary goals, constraints/non-goals, tech preferences).
- **Path B (`brownfield`)**: existing codebase, no `wiki/` / `.agent-memory/` yet -> run `evolve code build` + multi-angle codebase onboarding scan.
- **Path C (`legacy-maestro`)**: `.workflow/specs/` or `.workflow/knowhow/` exists -> surface `evolve knowledge import` migration preview (`ew-knowledge`) rather than duplicating knowledge.
- **Path D (`initialized`)**: `.agent-memory/` + `wiki/` already present -> warn idempotently (`E002`), report existing status, and never overwrite active Wiki or Session state silently.

## Boundaries & Invariants

- **No legacy `.workflow/` generation**: NEVER create `.workflow/project.md`, `.workflow/state.json`, `.workflow/config.json`, or `.workflow/specs/`. State lives in `.agent-memory/` SQLite; durable conventions belong in `wiki/` via `evolve wiki propose` + explicit user-approved `evolve wiki apply`.
- **Idempotent & scope-guarded**: only establish project identity, code/knowledge baseline, and initial `context-package.json` — do NOT pre-split `ew-roadmap` Sessions or `ew-plan` tasks.
- **Bootstrap note**: if the repository has not yet installed/committed `skills/` (so no Session Run can bind yet), run pre-Session bootstrap (`evolve install --scope project --yes`, `git add`/`commit` Skills, `evolve code build`) before opening the onboarding Session.
- **Exit gates**: `state-detected` (path A/B/C/D resolved accurately) and `context-initialized` (`outputs/init-report.json` + `outputs/context-package.json` ready, CodeGraph built when codebase exists).
