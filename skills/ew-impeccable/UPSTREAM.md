# Bundled Impeccable Core

This package ports Maestro Flow's bundled Impeccable design core.

## Provenance

- Maestro Flow source: <https://github.com/catlog22/maestro-flow/tree/1d0696c30f4800f2226583332f8ee9275c209a22/workflows/impeccable>

- Upstream: <https://github.com/pbakaus/impeccable>
- Upstream Skill version: `4.1.3`
- Upstream commit: `4c5243fcd42d39c1fc281adcaf10be0913095f74`
- Imported surfaces: `.claude/skills/impeccable/SKILL.md`, `reference/`, and `scripts/`
- License: Apache License 2.0; see `LICENSE`
- Third-party notices: see `NOTICE.md`

## Self-Evolving Workflow adaptation

- The core is installed as `skills/ew-impeccable/`. The directory containing its `SKILL.md` is the base for every playbook and script.
- The host invokes `ew-impeccable`. Evolve binds the package to a Git revision for Session and Run work.
- Role guidance is carried alongside the Skill and can be given to a host worker or used inline.
- The static detector uses CSS Tree's distributable module, which embeds the grammar data needed by the installed Skill.
- This port includes the Impeccable design core. Maestro-specific Codify and legacy UI search belong to the Maestro runtime.
- Updates are distributed with Self-Evolving Workflow.
