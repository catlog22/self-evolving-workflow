# Pre-flight: ew-analyze

Confirm goal clarity and branch routing before entering [workflow](workflow.md):

- **Mode check**: pure digits -> micro milestone deep-dive; text -> macro topic analysis; `--gaps [ISS-ID]` -> [issue gap analysis](issue-gaps-analyze.md); `-q` -> decision extraction only (must not be omitted).
- **Upstream `--from` alias**: read only via injected paths (`current-guidance`, `current-blueprint`, `latest-debug`); keep already-locked decisions invariant and focus open decisions/questions. If `latest-debug` is present, treat the diagnosis as confirmed symptom and analyze impact/fix direction rather than re-diagnosing.
- **Knowledge & scope invariants**: satisfy the Knowledge Gate first (`wiki_context`/`wiki_reference` or CLI `--reads`); record new domain terms in `report.md`; never modify source files during analysis.
- **Evidence & convergence**: exploration subagents (`invoke_subagent` or host subagent, always joined before advancing) + independent `evolve delegate` analysis provide required evidence — manual reads alone do not satisfy scoring gates. Ground `scope_verdict` (`small|medium|large`) accurately to guide downstream `ew-plan` decomposition.
