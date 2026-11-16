# Automatic & Goal Long-Chain Policy

本文件定义 `--auto` 与 `--goal` 闭环长链的 **阶段映射（Stage Mapping）**、**建链规则（Build Rules）** 与 **决策门评估（Decision Gates）**。具体 fenced CLI 语法见 [执行循环](orchestrator-run-loop.md)，Goal 变更协议见 [goal.md](goal.md)。

## Execution Authority Invariants

1. 首次变更前通过 `evolve capabilities` 确认运行时能力，之后严格沿 `Evolve mutation receipt` 刷新 `orchestration_revision`（Run 目标操作另需 `run_revision`）。
2. 全程固定同一 `actor_id`（同时传给 `--participant` 与 `--actor`）；每次重试同一请求复用原 `--request-id`，修订冲突先读 `evolve session status`。
3. 在 `session open` 时显式持久化 `--boundary-contract`、`--goals` 与 `--auto` / `--goal-mode` 策略（`Session.policy.auto_mode` 控制 `continuation.authority = "automatic"`）；未设置 `--auto` 时需按 `S_CONFIRM` 与每步人工节点推进。
4. 禁止绕过 `evolve session` / `evolve run` 命令行直接修改状态；Run 封存后不可变，失败重试须通过 `evolve run transition ... failed`（触发 `--retry-max` 计数）后再经 `evolve run next` 派发。

## Stage Mapping

| Stage | Skill / 节点配置 | Decision after | 适用条件 |
| --- | --- | --- | --- |
| init | `ew-init "{intent}"` | — | 项目未初始化或需存量接入引导时 |
| grill | `ew-grill "{intent}"` | — | 需要压测假设或对齐术语时 |
| brainstorm | `ew-brainstorm "{intent}"` | — | 开放探索阶段 |
| blueprint | `ew-blueprint "{intent}"` | — | 需要正式规格文档包时 |
| roadmap | `ew-roadmap "{intent}"` | — | 多 Session 拆解证据 |
| analyze-macro | `ew-analyze "{intent}"` | `post-analyze-scope` | 宏分析路由门 |
| analyze | `ew-analyze --session {session}` | — | 分析阶段 |
| plan | `ew-plan --session {session}` | — | 规划阶段 |
| execute | `ew-execute --session {session}` | `post-execute` | 执行阶段 |
| verify | `ew-verify --session {session}` | — | 需要结构与约束覆盖验证时（前置 `plan` + `execute`） |
| test | `ew-test --session {session}` | — | 需要 UAT / `--frontend-verify` 验收时 |
| auto-test | `ew-auto-test --session {session}` | — | 需要分层自动化测试生成与收敛时 |
| review | `ew-review --session {session} [--tier quick]` | `post-review` | 审查阶段（quick 模式加 `--tier quick`） |
| debug | `ew-debug "{intent}"` | — | 链内出现失败需要根因诊断时 |
| retrospective | `ew-retrospective --session {session}` | — | 阶段收尾多视角复盘时 |
| goal-audit | `--decision-only` | `post-goal-audit` | 存在 `goals` 分解时 |
| session-complete | `--decision-only` | `post-execution` | 长链终端核验节点 |
| debug-escalate | `--decision-only` | `post-debug-escalate` | 调试升级阻断节点 |

> **说明**：`{session}` 与 `{intent}` 占位符由 Runtime 在 `evolve run next` 派发 `run.task.args` 时自动展开；`--decision-only` 节点仅需 `--step-id` 与 `--decision-ref`，不绑定 Skill 包。

## Build Rules（按顺序应用）

1. **Wiki 约束预检**: 建链前执行 `evolve context` 读取项目约束（旧知识目录通过 `evolve knowledge import` 预览并导入，禁止直接读写）。
2. **起点与过滤**: 从当前最新状态起步，跳过已有 sealed artifact 的阶段，并确认 `ew-verify` 等硬契约上游已满足。
3. **决策门、重试上限与审计插入**:
   - 附带在可运行步骤上的门禁通过 `evolve session chain insert ... --decision-ref "<gate>" --retry-max 3` 绑定；独立核验节点使用 `--decision-only --decision-ref "<gate>" --step-id <id>`。
   - 存在 `goals` 分解时：在末个产出阶段后插入 `--decision-only --decision-ref post-goal-audit`；每执行 `>= 3` 步插入 `--decision-only --decision-ref post-reground`。
   - 链尾以 `--decision-only --decision-ref post-execution`（需 `run decide proceed`）收尾，再调用 `evolve session complete`。
4. **参数与契约校验**: 建链前用 `evolve skills validate <command>` 校验所有步骤（且新增/修改的 Skill 必须已提交进 Git `HEAD`）。
5. **`scope_verdict` 门控（宏分析起点）**: `large` 保留多模块分解并向 `ew-plan` 传 `--session {session}`；`unknown` 由 `post-analyze-scope` 决策或询问用户纠正（`-y` 不猜测）。

## Decision Gate 评估与回退规范

| 类型 | `decision_ref` | 评估动作 | 检查输入 |
| --- | --- | --- | --- |
| quality-gate | `post-execute` | 评估执行与自检 | `outputs/execution.json`, `outputs/self-check.json` |
| quality-gate | `post-review` | 评估审查结论 | `outputs/review.json` |
| goal-gate | `post-goal-audit` | 对照 `goals[].done_when` 核验未完成目标 | `Session.goals` + Run 证据 |
| scope-gate | `post-analyze-scope` | 判定范围路由 | `outputs/findings.json` (`scope_verdict`) |
| reground-gate | `post-reground` | 核验累积产出是否偏离 `intent` / `boundary_contract` | `Session.boundary_contract` + handoffs |
| structural | `post-execution` | 终态核验（全部 Run sealed + chain 终结） | Session 全量状态 |
| structural | `post-debug-escalate` | 始终 `escalate` 阻断推进 | — |

### Evaluator Verdict 与回退约定

- **`proceed` / `fix` / `escalate`**：决策评价包含 `CONFIDENCE_SCORE`（`0–100`）；调用 `evolve run decide <gate> --verdict <verdict> --confidence <score> [--target-step <step-id>] --summary "<evidence>"`：
  - Runtime 在 `auto_mode` 下遇到 `confidence < 60` 且无明确 `--evidence` 时会拒绝 `proceed`；
  - 判定 `fix` 需要重跑上游执行/规划步骤时，**必须显式传入 `--target-step <step-id>`**（从 `--decision-only` 节点返回 `fix` 时为必填），Runtime 会把目标步骤至决策门间的步骤重开为 `pending`；若需新增修复步骤（如 `ew-debug` / `ew-plan --gaps`），先通过 `evolve session chain insert` 插链再判定 `proceed` 或重开步骤；
  - `reground-gate` 判定严重漂移且置信度 `>= 60` 时，作为协调器强制停机策略（`REGROUND_HALT`，`-y` 不可跳过）立即传入 `--verdict escalate` 暂停并上报用户。
- **`post-execution`**：核验全部 Run 已 sealed 且无悬空门禁后，提交 `--verdict proceed`，再用最新 `orchestration_revision` 调用 `evolve session complete`。
