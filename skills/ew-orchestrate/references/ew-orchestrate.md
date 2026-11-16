# Evolve chain catalog

Match the intent to the smallest Evolve chain that can produce and verify the requested result. Confirm the boundary, completion criteria, and required handoffs before opening the Session. The execution guide owns dispatch and recovery.

## Exact-Match Short-Circuits

- **`status` / `状态` / `dashboard`** -> **Read-only short-circuit (no chain creation)**: run `evolve session status --session <id>` (or `evolve session list --status open`), present the result, and stop for user input without inferring or launching a chain.
- **`continue` / `next` / `go` / `继续` / `下一步`** -> Resume the unique open Session (`nextAction`).
  - **Cold-start fallback (no open Session exists)**: check `.agent-memory/`, `wiki/`, and `.codegraph/` -> if uninitialized, route to `ew-init`; if a bound `current-roadmap` / `current-blueprint` exists, propose the first pending Session/spec scope; otherwise route through `ew-analyze` / `ew-plan` or ask what to build (`S_FALLBACK`).

## Semantic Intent -> Route Matrix

| Intent | Exact Route | Prerequisites & Thresholds |
| --- | --- | --- |
| Read-only Q&A, factual lookup, or status check | `END` (no Session) | Zero repository mutations needed |
| Small bounded edit + direct verification (1 concern, <=2 files) | `ew-companion` | No downstream typed artifact, gate, or multi-step coordination |
| Initialize or onboard project (greenfield / brownfield / legacy) | `ew-init` → `ew-roadmap` or `ew-blueprint` | Skip interactive Q&A when `--from` supplies `upstream-context` |
| Explore open alternatives or compare approaches | `ew-brainstorm` | Proposes continuation only when durable artifacts are needed |
| Pressure-test an idea/proposal against codebase reality | `ew-grill` | Grounded Socratic branches; runs before `ew-brainstorm` / `ew-plan` |
| Formal multi-phase spec package (Brief -> PRD -> Arch -> Epics) | `ew-blueprint` | Pure spec outputs; feeds `ew-roadmap` or `ew-plan` |
| Decompose multi-release requirements into a Session DAG | `ew-roadmap` | Only split >1 Session when hard runtime coupling holds |
| Investigate codebase or analyze existing plan (`-q`, macro, `--gaps`) | `ew-analyze` | Pass `-q` for fast decision extraction; `--gaps` for backlog gaps |
| Plan or revise an implementation (`--gaps`, `--tdd`, `--revise`) | `ew-plan` | Produces `current-plan`; use `--gaps` after failed review/verify/debug/test |
| Execute an existing confirmed `current-plan` | `ew-execute` | Requires bound `current-plan` (if missing, run `ew-plan` first or `ew-companion`) |
| Implement or refactor with known scope (`>2` files) | `ew-analyze -q` (if impact unclear) → `ew-plan` → `ew-execute` → `ew-verify` → `ew-review` | Omit `ew-analyze -q` when scope and patterns are already settled |
| Independently verify requirement & wiring coverage | `ew-verify` | **Requires bound `current-plan` + `current-execution`** (`required: true`) |
| Run conversational UAT, `--smoke`, or `--frontend-verify` browser check | `ew-test` | Behavioral acceptance + UAT; consumes verification, execution, or review |
| Generate and converge layered automated tests (`L0->L3`) | `ew-auto-test` | Suites missing or low coverage; distinct from UAT/browser acceptance |
| Audit diff, file/dir, or `current-execution` across 4 quality dimensions | `ew-review` | Works standalone (`HEAD`/`staged`/path) OR inside a Session after `ew-execute` |
| Diagnose broken behavior inside an orchestration chain (`<=2–3` modules) | `ew-debug` → `ew-plan --gaps` → `ew-execute` → `ew-verify` | Single bounded root-cause isolation (`latest-debug` / `latest-fix-directions`) |
| Heavyweight multi-iteration audit, bug-hunt, or security campaign | `ew-odyssey --mode <debug\|improve\|planex\|review\|security\|defensive\|ui>` (`ew-odyssey-<mode>`) | Explicit standalone iterative loop across entire modules/campaigns |
| Post-execution four-lens retrospective | `ew-retrospective` | Consumes sealed execution/verification/review artifacts |
| UI design, rebuild, audit, or finish polish | `ew-impeccable` | Or chain `ew-impeccable` / `ew-plan` → `ew-execute` → `ew-test --frontend-verify` |
| Explore and score competing hypotheses/paths in parallel | `team-swarm` | Only when user requests Swarm / parallel ACO exploration |
| Analyze & fix a tracked issue (from user's tracker ID/context) | `ew-analyze --gaps` → `ew-plan --gaps` → `ew-execute` → `ew-verify` | Keep issue reference in tasks; update tracker only with user authorization |
| Knowledge Gate lookup inside an active Run | Run MCP (`wiki_context` / `wiki_reference`) or CLI `--reads` | Keep Run evidence bound inside `{run_dir}`; do not spawn `ew-knowledge` |
| Post-seal closeout harvesting, Wiki publish/audit, memory sync, legacy import | `ew-knowledge` (`evolve workflows show knowledge`) | Run after `session complete` or on standalone knowledge requests |
| Rebuild code index / install Skills / Git worktree | `evolve code build` / `evolve skills install` / `git worktree` | Direct CLI or authorized repo operations |

## Validation & Continuation Rules

1. Validate every selected step contract with `evolve skills validate <command>` before building chains (`ew-knowledge` runs with `session-mode: none`).
2. Record concrete step arguments cleanly (`{session}` and `{intent}` placeholders are expanded by Runtime on `run next`); use target scope/issue/Session IDs instead of legacy milestone/phase numbering.
3. Carry `--goal-ref` when decomposing `--goal` chains and insert `--decision-only --decision-ref <gate>` checkpoints where coordinator verdicts are required.
