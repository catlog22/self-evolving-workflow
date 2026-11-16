# Automatic & Goal Long-Chain Policy

本文件定义 `--auto` 与 `--goal` 闭环长链的 **阶段映射（Stage Mapping）**、**建链规则（Build Rules）** 与 **决策门评估（Decision Gates）**。具体 fenced CLI 语法见 [执行循环](orchestrator-run-loop.md)，Goal 变更协议见 [goal.md](goal.md)。

## Execution Authority Invariants

1. 首次变更前通过 `evolve capabilities` 确认运行时能力，之后严格沿 `Evolve mutation receipt` 刷新 `orchestration_revision`（Run 目标操作另需 `run_revision`）。
2. 全程固定同一 `actor_id`（同时传给 `--participant` 与 `--actor`）；每次重试同一请求复用原 `--request-id`，修订冲突先读 `evolve session status`。
3. 禁止绕过 `evolve session` / `evolve run` 命令行直接修改状态；Run 封存后不可变，失败重试须经 `evolve run next` 重新派发。

## Stage Mapping

| Stage | Skill 命令 | Decision after | 适用条件 |
| --- | --- | --- | --- |
| brainstorm | `ew-brainstorm "{intent}"` | — | all |
| analyze-macro | `ew-analyze "{intent}"` | `post-analyze-scope` | all |
| analyze | `ew-analyze --session {session}` | — | all |
| plan | `ew-plan --session {session}` 或 `ew-plan --from current-analysis` | — | all |
| execute | `ew-execute --session {session}` | `post-execute` | all |
| review | `ew-review --session {session} [--tier quick]` | `post-review` | all（quick 模式加 `--tier quick`） |
| goal-audit | *(decision-only)* | `post-goal-audit` | 存在 `decomposition` 时 |
| session-complete | *(decision-only)* | `post-execution` | all |
| debug-escalate | *(decision-only)* | `post-debug-escalate` | 调试升级时插入 |

## Build Rules（按顺序应用）

1. **Wiki 约束预检**: 建链前执行 `evolve context` 读取项目约束（旧知识目录通过 `evolve knowledge import` 预览并导入，禁止直接读写）。
2. **起点与过滤**: 从 `lifecycle_position` 起步，跳过已有 sealed artifact 的阶段并按 `quality_mode` 过滤。
3. **决策门与审计插入**:
   - `Decision after` 非空的阶段通过 `evolve session chain insert ... --decision-ref "<gate>"` 绑定；前置 Run 封存后必须执行 `evolve run decide` 才可继续。
   - 存在 `decomposition` 时：在末个产出阶段后插入 `post-goal-audit`；执行 step >=3 时从第 3 个起每隔 3 个插入 `post-reground`（不与相邻质量门重复）。
   - 链尾必须以 `session-complete`（`post-execution`）收尾并调用 `evolve session complete`（只读独立分析以最后一个质量门收尾）。
4. **参数与契约校验**: 建链前用 `evolve skills` + `evolve skills validate <command>` 校验契约；传播 `goal_ref` 与 `{session}`/`{intent}` 占位符；动态插入的步骤同受约束。
5. **`scope_verdict` 门控（宏分析起点）**: `large` 保留多模块分解并向 `ew-plan` 传 `--session {session}`；其余走 `--from current-analysis`；`unknown` 由 `post-analyze-scope` 决策或询问用户纠正（`-y` 不猜测）。

## Decision Gate 评估

| 类型 | `decision_ref` | 评估动作 | 检查输入 |
| --- | --- | --- | --- |
| quality-gate | `post-execute` | 评估执行与自检 | `outputs/execution.json`, `outputs/self-check.json` |
| quality-gate | `post-review` | 评估审查结论 | `outputs/review.json` |
| goal-gate | `post-goal-audit` | 对照 `done_when` 核验未完成目标 | `decomposition.goals` + Run 证据 |
| scope-gate | `post-analyze-scope` | 判定范围路由 | `outputs/findings.json` (`scope_verdict`) |
| reground-gate | `post-reground` | 核验累积产出是否偏离 `intent` | `intent` + `boundary_contract` + handoffs |
| structural | `post-execution` | 终态核验（全部 Run sealed + chain 终结） | Session 全量状态 |
| structural | `post-debug-escalate` | 始终 `escalate` 阻断推进 | — |

### Evaluator Verdict 契约

- `quality-gate` / `goal-gate` / `scope-gate` 映射到 CLI `--verdict`：`proceed | fix | escalate`（附一句话 `REASON` 与 `CONFIDENCE_SCORE` 0–100）。
- `goal-audit` 未全满足（`has_unmet`）→ 插入修复 step；全满足但偏离意图 → **REGROUND_HALT**（`-y` 不可跳过）。
- `reground-gate` 判定 `drifted` 且置信度 >=60 → **REGROUND_HALT**（`-y` 不可跳过）；置信度 <60 → 记录漂移证据并由 coordinator 决定是否追加核验。
- `post-execution`：核验全部 Run 已 sealed、chain 已终结且无悬空门禁后，提交 `evolve run decide ... --verdict proceed`，再用新 revision 调用 `evolve session complete`。
