# Evolve Workflow

## Guardrails

- **Minimize changes** — modify only what the task requires; no drive-by refactors, formatting, cleanups, or scope growth.
- **No unsolicited documentation** — NEVER generate reports, summaries, or documentation files unless the active command requires them (a Run's `report.md` or a declared typed output).
- **Join your subagents** — every subagent you spawn must be joined, stopped, or cancelled before your scope ends; never fire-and-forget.
- **Fix root causes, don't hide them** — no skipped tests, `@ts-ignore`, empty catches, `as any`, or padded timeouts to silence failures; trace root causes and check adjacent code for the same defect before closing.
- **No direct knowledge writes** — never write `.workflow/specs/` or `.workflow/knowhow/` files directly; use the governed Agent Memory commands in the knowledge route.
- **Verify before claiming completion** — support completion claims with actual check results; fix clear in-scope errors before reporting, stop once acceptance criteria pass, and explicitly state any checks not run or blockers.
- **Keep audit metadata in chat/reports only** — in final chat replies, concisely state outcome, verification evidence (including unverified limits), and any decisions needing user judgment; NEVER leak QA ledgers, test status codes, or defensive disclaimers into manuscript prose.

# Coding Philosophy

## Core Beliefs

- **Pursue good taste** — eliminate edge cases to make code logic natural and elegant
- **Embrace extreme simplicity** — complexity is the root of all evil
- **Be pragmatic** — code must solve real-world problems, not hypothetical ones
- **Data structures first** — bad programmers worry about code; good programmers worry about data structures
- **Never break backward compatibility** — existing functionality is sacred and inviolable
- **Incremental progress over big bangs** — small changes that compile and pass tests
- **Learn from existing code** — study and plan before implementing
- **Clear intent over clever code** — be boring and obvious
- **Follow existing code style** — match import patterns, naming conventions, and formatting of the existing codebase

## Simplicity Means

- Single responsibility per function/class
- Avoid premature abstractions
- No clever tricks — choose the boring solution
- If you need to explain it, it's too complex

## Fix, Don't Hide

**Solve problems, don't silence symptoms** — skipped tests, `@ts-ignore`, empty catch, `as any`, excessive timeouts = hiding bugs, not fixing them.

**NEVER**:
- Make assumptions — verify against existing code
- Use suppression mechanisms (`skip`, `ignore`, `disable`) without fixing the root cause

**ALWAYS**:
- Plan complex tasks thoroughly before implementation
- Generate task decomposition for multi-module work (>3 modules or >5 subtasks)
- Track progress using TODO checklists for complex tasks
- Validate planning documents before starting development
- Commit working code incrementally
- Update plan documentation and progress tracking as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- **Edit fallback**: when the Edit tool fails 2+ times on the same file, try Bash sed/awk first, then Write to recreate if still failing

## Learning the Codebase

- Find 3 similar features/components
- Identify common patterns and conventions
- Use the same libraries/utilities when possible
- Follow existing test patterns

## Tooling

- Use the project's existing build system
- Use the project's test framework
- Use the project's formatter/linter settings
- Don't introduce new tools without strong justification

## Content Uniqueness Rules

- **Each layer owns its abstraction level** — no content sharing between layers
- **Reference, don't duplicate** — point to other layers, never copy content
- **Maintain perspective** — each layer sees the system at its appropriate scale
- **Avoid implementation creep** — higher layers stay architectural

## Context Requirements

Before implementation, always:
- Identify 3+ existing similar patterns
- Map dependencies and integration points
- Understand the testing framework and coding conventions

# Knowledge System

Resolve applicable project knowledge before reading or changing project files. Start a standalone task with `agent-memory context "<1-3 task-specific keywords>" --include-memory`. For an Evolve Run, inspect its packet or recover it with `evolve run brief <run-id> --session <session-id>`. Use the Run-bound MCP tools or the Agent Memory command with that Run's scope and receipt path.

- Match project, Skill, task and path scope when reading constraints or references. Follow a relevant search hit to its exact ID and record the read for the Run.
- Refine an empty or irrelevant search. Re-query when the task enters a new subsystem, an approach needs a decision, or the same fix fails twice.
- Use `agent-memory code search <query>` for symbols and `rg` for known text, file names or an exhaustive usage check.
- Seal verified outputs and evidence through Evolve. Follow the [knowledge route](skills/maestro/references/knowledge-route.md) to stage reusable findings through Agent Memory. Review candidates before promotion. Zero candidates is a valid outcome. Keep previous project knowledge directories as migration inputs.

## Workflow Routing

| Intent | Entry |
| --- | --- |
| Ordinary orchestration and goal chains | [Maestro](skills/maestro/SKILL.md) |
| Iterative audit, debugging, improvement or review | [Odyssey](skills/maestro-odyssey/SKILL.md) |
| Parallel ACO exploration and scoring | [Swarm](skills/team-swarm/SKILL.md) |
| Session/Run, artifact and recovery commands | [Evolve controller](skills/maestro/references/orchestrator-run-loop.md) |
| Historical review and knowledge governance | [Agent Memory knowledge route](skills/maestro/references/knowledge-route.md) |
| Evidence-driven Skill improvement | [Workflow Evolve](skills/workflow-evolve/SKILL.md) |
| External Codex or Agy execution | `evolve delegate --help` and the controller guide |

From this source checkout, build with `npm run build`. The executable equivalents are `node dist/workflow-cli.js` and `node dist/cli.js`.

# 中文回复准则

## 核心原则

- 所有回复使用简体中文
- 技术术语保留英文，首次出现可添加中文解释
- 代码变量名保持英文，注释使用中文

## 格式规范

- 中英文/数字间加空格：`使用 TypeScript 开发`、`共 3 个文件`
- 使用中文标点：，。！？：；
- 代码/命令用反引号：`npm install`

## Git Commit

- 使用中文提交信息
- 格式：`类型: 简短描述`
- 类型：feat/fix/refactor/docs/test/chore

## 保持英文

- 代码文件内容
- 错误信息和日志
- 文件路径和命令
