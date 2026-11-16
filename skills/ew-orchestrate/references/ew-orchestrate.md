# Evolve chain catalog

Match the intent to the smallest Evolve chain that can produce and verify the requested result. Confirm the boundary, completion criteria and required handoffs before opening the Session. The execution guide owns dispatch and recovery.

| Intent | Route |
| --- | --- |
| Mechanically clear operation with a direct check | ew-companion |
| Explore alternatives or challenge a proposal | ew-brainstorm → ew-analyze when scope evidence is needed |
| Investigate behavior or evaluate existing code | ew-analyze |
| Produce requirements, a roadmap or an implementation plan | ew-brainstorm or ew-analyze → ew-plan |
| Implement or refactor with known scope | ew-plan → ew-execute → ew-review |
| Inspect changes or verify a completed implementation | ew-review |
| Design, fix and verify a UI change | ew-analyze → ew-plan → ew-execute → ew-review, or the explicit Odyssey UI mode |
| Diagnose a defect, verify the fix and look for related cases | Explicit Odyssey Debug mode |
| Audit quality, supply-chain risk or defensive fallbacks | Explicit Odyssey mode appropriate to the audit |
| Explore and score multiple search paths | team-swarm when the user requests a Swarm |
| Analyze and fix a tracked issue | ew-analyze --gaps → ew-plan --gaps → ew-execute → ew-review. Keep the issue ID in the task and update its tracker after verification. |
| Create, list or close tracking items | Use the project's issue tracker with the user's authorization. |
| View progress or continue | Read evolve session list or evolve session status; resume the exact Session. |
| Query, review or harvest knowledge | Follow the internal [knowledge route](knowledge-route.md). |
| Rebuild the project code index | evolve code build |
| Provision Skill packages | evolve skills install |
| Create or merge a requested worktree | Use Git worktree and merge operations in the selected repository. |

Use evolve skills validate for each selected step. A project-provided step can participate when it is committed and declares its Skill contract. Record step arguments with the chain so the next host resumes the same task.

Resolve a phase or issue from the user's exact identifier, the chosen Session or the project tracker. Carry `goal_ref` on long-chain steps and add an explicit decision wherever verification needs a coordinator verdict. After the Session completes, process reusable evidence through the knowledge route.
