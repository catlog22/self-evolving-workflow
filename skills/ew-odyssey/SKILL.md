---
name: ew-odyssey
disable-model-invocation: true
description: Long-running iterative cycle — one entry, seven modes (debug|improve|planex|review|security|defensive|ui). Shared archaeology/audit → fix → verify → generalize → discover → persist skeleton with mode-specific dimensions. User-invoked campaign entry; single-step fixes route via /ew-orchestrate
argument-hint: <intent> --mode debug|improve|planex|review|security|defensive|ui [-y] [-c]
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.6.0
---

For Evolve Session/Run dispatch, decisions, and recovery, inspect `evolve workflows show orchestrate` (repo source: `skills/ew-orchestrate/references/orchestrator-run-loop.md`).

## Mode documents

- Shared phases — [shared base](references/odyssey-base.md) | [runtime adapters](references/runtime-adapters.md)
- Debug — [prepare](references/prepare/odyssey-debug.md), [workflow](references/odyssey-debug.md)
- Improve — [prepare](references/prepare/odyssey-improve.md), [workflow](references/odyssey-improve.md)
- Plan and execute — [prepare](references/prepare/odyssey-planex.md), [workflow](references/odyssey-planex.md)
- Review — [prepare](references/prepare/odyssey-review.md), [workflow](references/odyssey-review.md)
- Security — [prepare](references/prepare/odyssey-security.md), [workflow](references/odyssey-security.md)
- Defensive — [prepare](references/prepare/odyssey-defensive.md), [workflow](references/odyssey-defensive.md)
- UI — [prepare](references/prepare/odyssey-ui.md), [workflow](references/odyssey-ui.md)

<purpose>
Long-running, evidence-driven iterative campaign across seven modes sharing one backbone (`discovery → audit → fix → verify → GENERALIZE → DISCOVER → RECORD → END`) until mode exit criteria pass or escalation is required.
</purpose>

<mode_dispatch>

**Mode selection precedence:** explicit `--mode <name>` > intent keyword auto-detection (first match wins, case-insensitive) > structured prompt (Normal) / `E000` (`-y`).

| Keywords in intent | Mode | Discovery / Audit | Fix → Verify |
|---|---|---|---|
| bug, crash, error, broken, fails, regression, race, leak, "why does" | `debug` | `ARCHAEOLOGY, EXPLORE` / `DIAGNOSE` | `FIX → CONFIRM` (`ESCALATE_DIAGNOSIS`) |
| requirement, implement, build, add feature, deliver feature, user story | `planex` | `—` / `PLAN + EXECUTE` | `VERIFY ↔ FIX` |
| ui, visual, layout, style, component, page, responsive, a11y, design system, design tokens | `ui` | `SURVEY` / `AUDIT (6 dims) + DIVERGE` | `FIX → VERIFY` |
| security audit, OWASP, vulnerability, CVE, secrets scan, STRIDE, threat model, supply chain | `security` | `RECON` / `SCAN (OWASP+deps+secrets+CI+STRIDE+git)` | *(read-only)* |
| defensive programming/code, exception swallowing, silent failure, fallback/default risk, error suppression, 防御性编程, 防御性代码, 异常吞噬, 兜底风险 | `defensive` | `ANCHOR, SLICE` / `SCAN (8 patterns) + PROPAGATE` | *(read-only)* |
| improve, optimize, performance, refactor quality, reliability, observability | `improve` | `SURVEY` / `AUDIT (6 dims) + DIAGNOSE` | `FIX → VERIFY` (`ESCALATE_DIAGNOSIS`) |
| review, audit, code check, inspect changes, "look over", zero-residual | `review` | `ARCHAEOLOGY, EXPLORE` / `REVIEW (4 dims)` | `FIX → CONFIRM` |

(`CONFIRM` and `VERIFY` are synonymous post-fix gates. All modes share `S_GENERALIZE → S_DISCOVER → S_RECORD → END` in [shared base](references/odyssey-base.md) §Shared Back-Half.)

- **New campaign**: resolve mode, open an Evolve Session (`ew-odyssey-<mode>` + `--arg`), dispatch `evolve run next`, and read the selected mode's `prepare/odyssey-<mode>.md`, `odyssey-<mode>.md`, [shared base](references/odyssey-base.md), and [runtime adapters](references/runtime-adapters.md).
- **Resume / Run brief**: use the exact `ew-odyssey-<mode>` command from the Resume Packet (`evolve run brief`), verify `skill_ref` / `required_links`, and continue from `outputs/session.json` (`--mode` mismatch with `-c` fails with `E003`; no prior session starts fresh).

</mode_dispatch>

<context>
$ARGUMENTS

**Universal flags:** `--mode <name>` | `--skip-fix` *(audit/diagnose only; ignored in read-only `security`/`defensive`; skips FIX loop in `planex`, leaving EXECUTE+VERIFY; with `--skip-verify` in `planex`, runs PLAN only)* | `--skip-generalize` | `-y` *(skip confirmation prompts, log `deferred`; never bypasses `E000`, INTAKE blockers, or escalation)* | `-c` *(resume latest unfinished same-mode Session via `evolve session list` -> `evolve session status` -> `evolve session resume-view` -> `evolve run brief`)* | `--heartbeat`

**Mode-scoped flags** *(inapplicable flag emits `W008` and is ignored)*:

| Flag | Modes | Description | Default |
|------|-------|-------------|---------|
| `--template <name>` | debug, planex | Predefined investigation or criteria template | — |
| `--dimensions <list>` | improve, review, ui | Audit dimension subset | all |
| `--fix-threshold <sev>` | improve, review, ui | Severity cutoff (`critical\|high\|medium\|low\|all`) | all |
| `--tier quick\|standard\|deep` | security, defensive | Audit depth tier | standard |
| `--sink-depth <list>` | defensive | Sink layer focus (`1\|2\|3\|all`) | all |
| `--max-iterations N` | planex | Max verify-fix cycles before escalation | 3 |
| `--method agent\|cli\|auto` | planex | Task execution method | auto |
| `--executor <tool>` | planex | Explicit CLI executor | first enabled |
| `--skip-verify` | planex | Skip post-execution validation gate | false |

**Run outputs (`{run_dir}/outputs/` only)**: `session.json` | `evidence.ndjson` | `understanding.md` | `explore.json` (`debug`/`review`) | `anchors.json` (`defensive`). Never write session artifacts outside `{run_dir}/outputs/`. Keep Run lifecycle state in the Evolve Run store and seal via `evolve run complete`.

**Commit convention (mutable modes only)**: `"odyssey-{mode}({slug}): {STATE} — {summary}"` for workspace code edits (`outputs/*` seal via Evolve Run store, never committed to git).
</context>

<invariants>
All base invariants in [shared base](references/odyssey-base.md) apply (`evidence.ndjson` append-only, `phase_goals[]` tracking, mandatory 3-layer `GENERALIZE` unless `--skip-generalize`, zero-residual on mutable audit modes, read-only guarantee on `security`/`defensive`, sacred criteria in `planex`, rendered browser truth in `ui`). Do not fabricate `/goal` text or recreate host UI state cleared by the user.
</invariants>

<execution>
Follow [shared base](references/odyssey-base.md) + the selected mode workflow. Three shared blocking gates apply to every mode:

- **INTAKE gate**: mode + target/requirement resolved, Run outputs initialized (`session.json` with mode baseline/criteria, `phase_goals[]`, `understanding.md §1`). Blockers: `E000` / `E001` / `E002`.
- **GENERALIZE gate**: all 3 layers (`syntax`/`semantic`/`structural`) attempted and logged in `generalization_stats.by_layer` unless `--skip-generalize`.
- **DISCOVER gate**: every hit triaged with classification + reason (`remaining_actionable == 0` or `cross_phase_loops >= max_loops` with per-item reasons).
</execution>

<error_codes>
Mode warnings (`W001-W007`) are owned per mode; shared entry/base errors:

| Code | Condition | Recovery |
|------|-----------|----------|
| `E000` | Mode unresolved (`-y`, ambiguous intent, no `--mode`) | Pass `--mode <name>` |
| `E001` | Missing target, requirement (`planex`), or issue (`debug`) | Supply target/intent or `-c` |
| `E002` | Target path or required entry anchor not found | Check target path/scope |
| `E003` | `-c` mode mismatch with resumed Session | Match `--mode` or omit `-c` |
| `E004` | Selected mode workflow/prepare document unreadable | Reinstall Skill package or restore Run commit |
| `W008` | Flag inapplicable to active mode | Warn and ignore flag |
</error_codes>

<success_criteria>
- [ ] Mode resolved; Knowledge Gate satisfied before code exploration; Run outputs initialized
- [ ] Mode discovery, audit/diagnosis, and (unless `--skip-fix` or read-only) verified fixes completed cleanly
- [ ] Mandatory 3-layer `GENERALIZE` + per-item `DISCOVER` triage completed (unless `--skip-generalize`)
- [ ] `phase_goals[]` audited, `session.json` set to `END`, sealed via `evolve run complete`, and reusable findings staged per `evolve workflows show knowledge`
</success_criteria>
