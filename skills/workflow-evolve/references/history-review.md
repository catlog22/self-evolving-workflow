# History review

Use committed execution evidence whenever possible. `session review` reconstructs Run transitions, retries, Skill references, loaded Skill files and `knowledge_reads`. `evolve review` performs the equivalent review for a standalone Skill completion. The review result is the input to Agy and to the draft evidence list.

When a transcript file is supplied, keep its message IDs and pair every quoted fragment with a receipt or verification source. If the review returns no attributable signal, finish the loop with a zero-change result.

The history summary should answer these questions.

- Which Run or standalone execution used the affected Skill revision?
- What user correction, failure, retry and verified fix are linked to that execution?
- Which Skill documents and memory searches were actually read?
- Is the defect in the Skill instructions, the runner, the host adapter or a transient external dependency?

Only a defect attributable to the Skill package can produce an `evolve draft`. Host outages and missing runtime capabilities stay in the round report for later workflow repair.
