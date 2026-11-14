# Project Skill package

Use the package directory name in `name`, and describe the actual invocation in `description`. Keep common steps in `SKILL.md`. For any bundle-only phase, add a standard Markdown link and describe when to follow it. A path is relative to the document that contains its link. Use regular `.md` files tracked under the same Skill directory. Keep every required root link in `required_links` as well as in the body. A header fragment such as `#verify-result` must resolve to an actual heading in the linked file.

For a Skill with no Session/Run lifecycle, use `session-mode: none`. A stateful Skill uses `session-mode: run` and a structured `contract` with `contract_version: 2.1`. Use the same artifact schema, roles, and aliases as the consuming steps. For example:

```yaml
session-mode: run
required_links:
  - references/check.md
contract:
  contract_version: 2.1
  consumes:
    - kind: findings
      alias: current-analysis
      schema: findings/1.0
      role: primary
      required: true
  produces:
    - path: outputs/verification.json
      kind: verification
      schema: verification/1.0
      role: primary
      alias: latest-verification
      required: true
```

Describe how each declared input is used and what each output proves. Put typed outputs under the current Run's `outputs/` directory. Ensure each output's metadata matches its slot. Use the current Run's `report.md` for the execution narrative and `evidence/` for verification traces. Keep scratch files outside `outputs/`. Define the observable pass condition, blocked result, and next authorized action at each phase boundary that affects correctness or recovery. The coordinator owns progression through the existing Session/Run commands and receipts.
