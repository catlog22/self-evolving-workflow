# Self-Evolving Workflow

For this repository, the Knowledge Gate and Workflow Routing below take precedence over host-wide defaults for knowledge lookups and Session/Run control. The Agent Memory lookup here fulfills inherited knowledge-search requirements for this repository.

## Guardrails & Engineering Standards

- **Minimize changes** — modify only what the task requires; no drive-by refactors, formatting, cleanups, or scope growth.
- **No unsolicited documentation** — NEVER generate reports, summaries, or documentation files unless the active command requires them (a Run's `report.md` or a declared typed output).
- **Join your subagents** — every subagent you spawn must be joined, stopped, or cancelled before your scope ends; never fire-and-forget.
- **Fix root causes, don't hide them** — no skipped tests, `@ts-ignore`, empty catches, `as any`, or padded timeouts to silence failures; trace root causes, check adjacent code for the same defect, and stop after 3 failed attempts to reassess.
- **No direct knowledge writes** — never write `wiki/entries/` or legacy `.workflow/specs/` / `.workflow/knowhow/` files directly; use the governed `evolve wiki` commands in the knowledge route.
- **Verify before claiming completion** — support completion claims with actual check results; fix clear in-scope errors before reporting, stop once acceptance criteria pass, and explicitly state any checks not run or blockers.
- **Keep audit metadata in chat/reports only** — in final chat replies, concisely state outcome, verification evidence (including unverified limits), and any decisions needing user judgment; NEVER leak QA ledgers, test status codes, or defensive disclaimers into manuscript prose.
- **Simplicity & compatibility** — design data structures first, keep single-responsibility functions with shallow nesting, preserve backward compatibility, follow existing codebase conventions/tooling, and separate abstraction layers without duplicating content across them.
- **Before implementing** — study 3+ existing similar patterns, map integration points, decompose complex work (>3 modules or >5 subtasks), and use `write_file` / shell text replacement as fallback if `edit_file` fails 2+ times on the same file.

## Knowledge Gate (required)

Search project knowledge before inspecting, analyzing, planning against, or changing project files. Start with a query of 1–3 task-specific keywords. Run the knowledge lookup before `git status`, `rg`, file reads, or other project exploration.

| Task context | Required opening |
| --- | --- |
| Standalone task | In this checkout, run `node dist/workflow-cli.js context "<query>" --include-memory` as the first project-related tool call. The installed equivalent is `evolve context "<query>" --include-memory`. |
| New Evolve Run | Inspect the Run packet. Open bound `session-priors` when it covers the current scope. Otherwise, use the Run MCP `wiki_context` and open selected IDs with `wiki_reference` before exploring the project. |
| Resumed Evolve Run | Recover the packet with `evolve run brief <run-id> --session <session-id>`, then resolve project knowledge before resuming exploration. Reuse complete entries already in context and reload any entry represented only by an ID or summary. |

For a CLI lookup in a Run, use `evolve context "<query>" --session <session-id> --include-memory --reads "<run-dir>/knowledge-reads.json"`. Add `--task` or `--path` when that scope is known. Use one receipt source per Run. Code search with `evolve code search <query>` is available after the opening lookup.

- Inspect the applicable constraints and open governing hits by exact ID with `evolve wiki get <id> --resolved` or `evolve memory get <id>`. In a Run, use its bound tools or the same `--reads` receipt with `--from-search <search-id>` so the exact read is recorded.
- Refine an empty or irrelevant query before exploring. Proceed after inspecting a successful zero-result response to the refined query. Follow any initialization or recovery hint and retry. Re-query when the task enters a new subsystem, an approach needs a decision, or the same fix fails twice.
- Seal verified outputs and evidence through Evolve. Follow [ew-knowledge](skills/ew-knowledge/SKILL.md) to stage reusable findings through Agent Memory. Review candidates before promotion. Zero candidates is a valid outcome. Keep previous project knowledge directories as migration inputs.

## Workflow Routing

| Intent | Entry |
| --- | --- |
| Ordinary orchestration and goal chains | [ew-orchestrate](skills/ew-orchestrate/SKILL.md) |
| Knowledge governance, closeout, Wiki review, and migration | [ew-knowledge](skills/ew-knowledge/SKILL.md) |
| Iterative audit, debugging, improvement or review | [ew-odyssey](skills/ew-odyssey/SKILL.md) |
| Parallel ACO exploration and scoring | [Swarm](skills/team-swarm/SKILL.md) |
| Frontend design, audit, and polish | [ew-impeccable](skills/ew-impeccable/SKILL.md) |
| Skill authoring, migration, and package validation | [ew-skill-design](skills/ew-skill-design/SKILL.md) |
| Release readiness validation against Wiki constraints | [release-gate](skills/release-gate/SKILL.md) |
| Session/Run, artifact and recovery commands | [Evolve controller](skills/ew-orchestrate/references/orchestrator-run-loop.md) |
| Historical review and Wiki governance rules | [ew-knowledge route](skills/ew-knowledge/references/knowledge-route.md) |
| Evidence-driven Skill improvement | [Workflow Evolve](skills/workflow-evolve/SKILL.md) |
| External Codex or Agy execution | `evolve delegate --help` and the controller guide |

From this source checkout, build with `npm run build`. The executable equivalents are `node dist/workflow-cli.js` (`evolve`) and `node dist/cli.js` (knowledge-only `agent-memory` entrypoint).

# 中文回复准则

- 所有回复使用简体中文，保留英文技术术语、代码变量名、文件/命令路径与错误日志（代码注释使用中文）。
- 中英文/数字间加空格，使用中文标点，代码与命令使用反引号。
- Git Commit 使用中文提交信息，格式：`类型: 简短描述`（`feat/fix/refactor/docs/test/chore`）。
