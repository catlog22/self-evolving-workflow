# Planning & Chain Creation

本文件定义意图分类（`S_CLASSIFY`）、建链（`S_CREATE`）与分解（`S_DECOMPOSE`）协议。完整步骤路由与前置阈值见 [意图分类目录](ew-orchestrate.md)，长链与决策门策略见 [自动与 Goal 策略](auto-policy.md)，分派/恢复命令见 [执行循环](orchestrator-run-loop.md)。

## Classification Protocol

1. **Exact match**:
   - `status` / `状态` / `dashboard` → 只读执行 `evolve session status`（无则 `evolve session list --status open`），呈现后即止，不推断开链。
   - `continue` / `next` / `go` / `继续` / `下一步` → `S_CONTINUE`（无活跃 Session 时走 [意图分类目录](ew-orchestrate.md) 的冷启动回退规则）。
2. **Selection priorities**: tracked issue (`--gaps`) > Swarm (`team-swarm`) > UI/设计 (`ew-impeccable`) > 多步骤工程链 > 单步强契约任务 > `ew-companion`（单关注点轻量改动/验证）> `END`（零修改纯问答）。
3. **契约前置校验**:
   - `ew-verify` 在契约层面强依赖 `current-plan` + `current-execution`；缺任一上游时禁止单排 `ew-verify`（改走 `ew-review`，或先补 `ew-plan` → `ew-execute`）。
   - `ew-execute` 缺 `current-plan` 时前置 `ew-plan`（或降级为 `ew-companion`）。
   - `ew-test` 无 `latest-verification` 时至少需有 `current-execution` + `current-plan`、`latest-review` 或显式 `<scope>`。
4. **留痕要求**: 必须记录匹配证据、排除备选方案与置信度；无记录不可进入 `S_CREATE`。

| 意图证据 | 初始链 |
| --- | --- |
| 零修改纯问答 | `END`（不开 Session） |
| 轻量明确单步改/验（1 关注点，<=2 文件） | `ew-companion` |
| 项目冷启动 / 存量接入 / 旧知识检测 | `ew-init` → `ew-roadmap` / `ew-blueprint` |
| 探索开放方案 / 压测假设 | `ew-brainstorm` / `ew-grill` → 仅按 Skill 提议续接 |
| 正式规格文档包 | `ew-blueprint` → `ew-roadmap` / `ew-plan` |
| 多 Session 需求拆解 | `ew-roadmap` → `ew-plan` |
| 已知计划直接执行 | `ew-execute` → `ew-verify` / `ew-review` |
| 常规功能开发 / 重构（>2 文件） | `[ew-analyze -q]` → `ew-plan` → `ew-execute` → `ew-verify` → `ew-review` |
| 广泛重写 / 宏架构迁移 | `ew-analyze`（宏分析）→ `--decision-only` (`post-analyze-scope`) → `ew-roadmap` / `ew-plan` |
| 独立代码审查 / 覆盖验证 / UAT / 自动化测试 | `ew-review` / `ew-verify` / `ew-test` / `ew-auto-test` |
| 链内缺陷排查与修复 | `ew-debug` → `ew-plan --gaps` → `ew-execute` → `ew-verify` |
| Tracked Issue / Review Gap 闭环修复 | `ew-analyze --gaps` → `ew-plan --gaps` → `ew-execute` → `ew-verify` |
| 阶段多视角复盘 | `ew-retrospective` |
| 已有 compatible open Session | 不重建，直接进入共享执行循环 |

## Decomposition Protocol (`S_DECOMPOSE`)

1. narrow / 单步链跳过分解，直接构造最小 `boundary_contract`（`in_scope: [intent]`、`definition_of_done: "step completed with passing gates"`）。
2. broad/medium 意图（影响 >=3 个模块、需跨包接口变更、或范围/约束/完成标准中 >=2 项不明确）最多询问 3 轮；`-y` 不跳过广泛歧义。
3. 派生面向结果的 `boundary_contract` 与 `goals[]`（含 `id`、`goal`、`boundary`、`done_when`、`evidence`、`lifecycle`、`status: "pending"`）。
4. 有分解时在 `session complete` 前插入 `--decision-only --decision-ref post-goal-audit` 决策门；多里程碑拆分仅在多 release 证据时先走 `ew-roadmap`。

## Chain Creation (`S_CREATE`)

1. **Knowledge Gate**: 建链前通过 `evolve context "<query>" --include-memory` 检索适用 Wiki 约束并记录读取。
2. **Skill 契约校验**: 通过 `evolve skills` 与 `evolve skills validate <command>` 确认目标项目提交中的步骤契约（所有新增或修改的步骤必须先已提交进 Git `HEAD`）。
3. **持久化 Session 与 Chain**:
   - 通过 `evolve session open "<intent>" --id ew-<slug> [--definition-of-done "<text>"] [--boundary-contract '<json>'] [--goals '<json>'] [--auto] [--goal-mode] [--chain <commands...>] --actor <actor> --request-id <req_id> --reason "<reason>"` 持久化目标、边界与策略（不再停留在对话内存）。
   - 带领域参数、`--retry-max`、`--goal-ref`、`--stage`、`--decision-ref` 或 `--decision-only` 的步骤，使用 open 返回的 `orchestration_revision` 通过 `evolve session chain insert` 逐条写入。
   - 分解完成后可在回复中简要列出 `G1..Gn` 子目标及其 `done_when` 供用户确认（不要输出 `/goal` 斜杠命令）。

## Target Scope Resolution 优先级

1. 明确传入的目标路径、Session ID、Issue ID 或 `--from <alias>` 产物。
2. 当前项目活跃 Session 的 `goals[]` / 未完成步骤。
3. 多步链默认以 `{run_dir}` 隔离交付物；仍无法确定范围时使用宿主结构化提问工具（Antigravity 为 `ask_question`）向用户确认。
