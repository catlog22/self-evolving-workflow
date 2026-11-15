# Validate and release a project Skill

Run `evolve skills validate <id> --root <repo>` against the intended Git revision. The command checks the committed entry, Run contract, required links, and reachable Markdown. Use a test commit in an isolated worktree to exercise unpublished changes when needed. Resolve any broken link, unsupported lifecycle, or output mismatch at the source.

For a stateful Skill, verify a fresh Run binds the expected commit and contract. Read the entry and exercised links through the host's `evolve run skill-read`, confirm the input aliases and output schemas, and run `evolve run check` before sealing the sample. When migrating existing guidance, also resume a Run bound to the prior commit and repeat one historically successful case. For a standalone Skill, verify its actual host entry, expected result, and completion receipt.

For a behavior change based on a finished Session, run `agent-memory session review <session-id>` in that project. Use evidence tied to the affected Skill version. Follow `workflow-evolve` for a short inline change, a conditional link, or an optional reference, depending on severity and applicability. Replay the original case and an existing successful case. Apply the replayed change through the workflow's authorized adoption step, using its receipt for rollback.
