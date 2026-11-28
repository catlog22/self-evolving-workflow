# Self-Evolving Loop Design Guide

Use this reference during `ew-skill-design` Step 2 whenever a target Skill operates in a recurring, high-variance domain where real usage uncovers new defects, constraints, or examples over time (for example: end-to-end testing & bug repair, complex multi-parameter configuration validation, regression hunting, or periodic auditing).

## 1. Loop Discovery Signals

Introduce a **Self-Evolving Loop** when at least two of the following hold; otherwise declare the Skill `static` and keep the package simple:

- **High-dimensional or coupled state space**: Parameters, modes, or UI/API surfaces interact via conditional-required, mutually exclusive, or physical/domain constraints that cannot be exhaustively hardcoded once.
- **Recurring real-user failure modes**: Realistic usage (novice zero-start, conditional omission, invalid/unit confusion, cross-field conflict, mode-switch stale state) repeatedly exposes UX, contract, mapping, or execution/convergence bugs.
- **Compounding prior value**: Historical defects, minimal reproducible examples, and project knowledge (`evolve kb`) directly sharpen future runs by becoming high-priority regression seeds.

## 2. Dual-Layer Self-Evolution Architecture

Separate evolving domain data from governed Skill instructions so every run compounds experience without bloating `SKILL.md` or introducing sediment:

```text
Project Knowledge (evolve kb) + Domain Playbooks (playbooks/<domain>/)
        │ Retrieve priors & seed patterns                  ▲ Capture deduplicated patterns,
        ▼                                                  │ minimal cases & episodic memory
[Pre-Run Context] -> [Scenario/Fault Matrix] -> [Real Execution & Layered Verdict] -> [Root-Cause Repair & Retest]
                                                                                              │
                                                                             Repeated blind spot (>= 2)
                                                                                              ▼
                                                                       Governed Process Proposal (ew-skill-design / workflow-evolve)
```

### Layer A: Data-Layer Evolution (Automatic Per Run)

Store domain-specific evolving assets outside `SKILL.md` and outside `required_links` (loaded on demand by `<domain>`):

1. **Retrieve (Pre-Run Warmup)**:
   - Run `evolve search "<domain> <task keywords>" --mode context` and read governing or truncated records with `evolve kb get <id>... --resolved`.
   - Load `playbooks/<domain>/domain-adapter.md`, `playbooks/<domain>/defect-patterns.yaml`, and `playbooks/<domain>/cases/` index.
   - Convert every active defect pattern and relevant knowledge prior into mandatory seed cases before running new exploration.
2. **Execute with Layered Verdicts & Real-User Faults**:
   - Pair realistic **golden baselines** with structured **real-user fault personas** (novice blind-fill, deep conditional omission, invalid/unit error, cross-field conflict, mode-switch stale state).
   - Separate verdicts by execution layer (for example: `L1 UX guidance`, `L2 frontend contract`, `L3 backend mapping`, `L4 core execution/solver convergence`, `L5 result feedback`) so HTTP 200 or `exit 0` never masquerades as end-to-end success.
   - Preserve original failure evidence append-only; verify every fix with an exact `retest_of` replay plus an automated project regression test.
3. **Capture (Post-Run Feedback)**:
   - **Deduplicate & append** confirmed recurring defects into `playbooks/<domain>/defect-patterns.yaml` (fields: `id`, `title`, `status`, `layer`, `severity`, `involved_params`, `user_trigger`, `symptom`, `root_cause`, `regression_assertion`, `evidence_refs`, `last_verified`). Mark obsolete entries `retired` rather than silently deleting history.
   - **Archive minimal sanitized cases** under `playbooks/<domain>/cases/` (parameter overrides or minimal snapshots only; keep large artifacts, logs, and credentials out of the Skill package).
   - **Record working memory** via `evolve kb add "<self-contained finding>" --kind episodic --type verified_fix --scene <skill-id> --evidence <ref>` after searching for duplicates, and read back with `evolve kb get <id>`. Keep Wiki publication governed (`evolve kb harvest` / `propose` / `apply` only; never write `wiki/entries/` directly).
4. **Domain Bootstrap**:
   - When no `playbooks/<domain>/` exists yet, run in generic discovery mode and scaffold `domain-adapter.md`, `defect-patterns.yaml`, and `cases/README.md` during closeout.

### Layer B: Process-Layer Evolution (Governed Only)

Never mutate `SKILL.md` or core `phases/` inline during an ordinary task run. Trigger process-layer evolution only when:

- The same workflow blind spot causes missed bugs across `>= 2` runs;
- The user corrects the Skill's workflow or grading criteria `>= 2` times; or
- A cross-domain fault class should be generalized into shared `references/`.

Emit a structured `<artifactRoot>/skill-evolution-proposal.md` (evidence, minimal target diff, anti-bloat check, replay scenarios) and route upgrades through `ew-skill-design` or `/workflow-evolve` (`review -> replay -> confirmed apply`).

## 3. Recommended Package Layout for Self-Evolving Skills

```text
<skill-root>/<skill-id>/
├─ SKILL.md                      # Lean orchestrator: frontmatter, invariants, phase routing, recovery
├─ phases/                       # Progressive-disclosure stage protocols (loaded one phase at a time)
├─ references/                   # Domain-neutral fault catalog, evolution protocol, evidence contract
└─ playbooks/<domain>/           # On-demand data-layer evolution store (never in required_links)
   ├─ domain-adapter.md          # Authoritative source paths, APIs, domain convergence/pass criteria
   ├─ defect-patterns.yaml       # Deduplicated active/retired historical defect patterns
   └─ cases/                     # Minimal sanitized golden & fault snapshots + README index
```

## Completion Criteria

A Skill's self-evolving loop design is complete only when every item holds:

- [ ] Loop applicability is explicitly justified against the discovery signals (or explicitly marked `static`).
- [ ] Pre-run Retrieve binds both `evolve search` / `evolve kb get` and `playbooks/<domain>/` into executable seed cases.
- [ ] Real-user fault classes, layered verdicts, and append-only `retest_of` verification are defined.
- [ ] Post-run Capture defines deduplicated `defect-patterns.yaml` updates, minimal sanitized `cases/`, and `evolve kb add --kind episodic` + `kb get` read-back without direct Wiki writes.
- [ ] Process-layer upgrades are isolated behind a `>= 2` threshold proposal routed to `ew-skill-design` / `/workflow-evolve`, keeping `SKILL.md` free of per-bug sediment.
