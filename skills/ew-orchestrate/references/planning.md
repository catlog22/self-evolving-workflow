# Planning & Chain Creation

本文件定义意图分类（`S_CLASSIFY`）、建链（`S_CREATE`）与分解（`S_DECOMPOSE`）协议。分类目录见 [意图分类目录](ew-orchestrate.md)，长链策略见 [自动与 Goal 策略](auto-policy.md)，分派/恢复命令见 [执行循环](orchestrator-run-loop.md)。

## Classification Protocol

1. **Exact match**: `continue` / `next` / `go` / `继续` → `S_CONTINUE`。
2. **Semantic match**: 对照 [意图分类目录](ew-orchestrate.md) 匹配最小充分链路（`issue_id > team > UI/design > multi-step > single-step > ew-companion`）。
3. **前置校验**: `ew-execute` 缺少计划时前置 `ew-plan`；未完成自检与审查前不得结束链路。
4. **留痕要求**: 必须记录匹配证据、排除的备选方案与置信度；无记录不可进入 `S_CREATE`。

| 意图证据 | 初始链 |
| --- | --- |
| 窄修复 / 变更 | `ew-analyze` → `ew-plan` → `ew-execute` → `ew-review`（按需） |
| 广泛重写 / 迁移 | `ew-analyze`（宏分析）→ scope decision → `ew-plan` / 多波次分解 |
| 头脑风暴 / 探索 | `ew-brainstorm` → 仅按 Skill 提议续接 |
| 压力测试 / 深度审查 | `ew-analyze`（边界分析）或 `ew-review` → 仅按 Skill 提议续接 |
| 正式规格 | `ew-brainstorm` → `ew-analyze` → `ew-plan` |
| 已有 compatible Session | 不重建，直接进入共享执行循环 |

## Decomposition Protocol (`S_DECOMPOSE`)

1. narrow / 单步链跳过分解，直接生成最小隐式 `boundary_contract`（`in_scope: [intent]`、`definition_of_done: "step completed with passing gates"`）。
2. broad/medium 意图（影响 >=3 个模块、需跨包接口变更、或范围/约束/完成标准中 >=2 项不明确）最多询问 3 轮；`-y` 不跳过广泛歧义。
3. 派生面向结果的 `boundary_contract` 与 `goals`（禁止用生命周期阶段充当目标，每个目标含 `id`、`goal`、`boundary`、`done_when`、`evidence`、`lifecycle`、`status: "pending"`）。
4. 多里程碑拆分仅在多 release 证据时启用；有分解时在 `session complete` 前追加 `post-goal-audit` 决策门。

## Chain Creation (`S_CREATE`)

1. **Knowledge Gate**: 建链前通过 `evolve context "<query>" --include-memory`（源码仓库内为 `node dist/workflow-cli.js`）检索适用 Wiki 约束并记录读取。
2. **Skill 契约校验**: 通过 `evolve skills` 与 `evolve skills validate <command>` 确认目标项目提交中的步骤契约。
3. **创建 Session 与 Chain**:
   - 无参步骤可用 `evolve session open "<intent>" --id ew-<slug> [--definition-of-done "<text>"] [--chain <commands...>] --actor <actor> --request-id <req_id> --reason "<reason>"`。
   - 带领域参数、`--goal-ref`、`--stage` 或 `--decision-ref` 的步骤，使用 open 返回的 `orchestration_revision` 通过 `evolve session chain insert` 逐条写入（禁止写入临时 chain 文件或直接编辑协议状态；Session 状态统一存储在 `.agent-memory/` SQLite 数据库中）。
   - 分解完成后可在回复中简要列出 `G1..Gn` 子目标及其 `done_when` 供用户确认（**不要**输出 `/goal` 斜杠命令，以免与宿主 `/goal` 冲突）。

## Phase Resolution 优先级

1. 结构化 `phase_ref` 或明确 `"phase N"` / 编号。
2. 当前项目进行中的执行状态或最新未完成阶段。
3. 多步链默认由 `{run_dir}` 隔离工作；若仍无法确定目标阶段，使用宿主结构化提问工具（Antigravity 为 `ask_question`）向用户确认。
