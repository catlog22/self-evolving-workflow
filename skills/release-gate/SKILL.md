---
name: release-gate
description: Validate release readiness against active Wiki constraints and emit a structured release-gate/1.0 artifact.
version: 0.1.1
session-mode: run
required_links:
  - references/check-checksum.md
contract:
  contract_version: 2.1
  consumes: []
  produces:
    - path: outputs/release-gate.json
      kind: verification
      schema: release-gate/1.0
      role: primary
      alias: latest-release-gate
      required: true
---

# Release Gate

1. Resolve active Wiki constraints for `skill:release-gate` with `agent-memory wiki constraints --skill release-gate --category review --trace`.
2. Search Wiki references for the release query with `agent-memory wiki references "<query>" --skill release-gate --task release --trace` and read the selected stable IDs.
3. Follow [the checksum verification guide](references/check-checksum.md) to validate `artifact_sha256`.
4. When `environment=production`, search Memory with `agent-memory memory search "<query>" --scene release --trace`, read the returned memory ID, and follow [the freeze window protocol](references/freeze-window.md). Block the release when an active production freeze is found.
5. Write `outputs/release-gate.json` with `schema_version: "release-gate/1.0"`, `environment`, `artifact_sha256`, `decision`, `reasons`, `consulted_knowledge_ids`, and `consulted_memory_ids`.
