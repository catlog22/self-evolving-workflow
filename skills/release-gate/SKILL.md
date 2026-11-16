---
name: release-gate
description: Validate release readiness against active Wiki constraints and emit a structured release-gate/1.0 artifact.
version: 0.2.0
session-mode: run
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
  gates:
    entry: []
    exit:
      - artifact_sha256 format verified
      - knowledge and production freeze checks recorded in outputs/release-gate.json
---

# Release Gate

1. **Knowledge Gate**: Follow the project Knowledge Gate before inspecting files or deciding:
   - In a Run, use Run MCP `wiki_context` / `wiki_reference` / `memory_get`, or CLI `evolve context "<query>" --task release --session <session-id> --include-memory --reads "<run-dir>/knowledge-reads.json"` (single receipt source per Run), then inspect governing IDs with `--from-search <search-id>`.
   - Outside a Run, use `evolve context "<query>" --task release --include-memory` (or `node dist/workflow-cli.js` in this checkout).
2. **Checksum Verification**: Verify `artifact_sha256` matches `^sha256:[a-f0-9]{64}$` and record the active release checksum Wiki constraint ID in `consulted_knowledge_ids`.
3. **Production Freeze Check**: When `environment=production`, confirm via `evolve context` / `memory_search` + `memory_get` (and matching `evolve wiki get <id> --resolved`) whether any active production freeze record applies. If active, set `decision` to `blocked`, include the consulted memory/wiki IDs, and specify a rollback or hold action.
4. **Output & Seal**: Write `outputs/release-gate.json` (`_meta` matching `release-gate/1.0`, `environment`, `artifact_sha256`, `decision`, `reasons`, `consulted_knowledge_ids`, `consulted_memory_ids`), summarize findings in `report.md` if required, and seal via `evolve run complete`.
