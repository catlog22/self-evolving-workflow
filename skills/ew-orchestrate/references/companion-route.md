# Evolve Companion 内部路由

`ew-companion` 是 Evolve 内部的轻量单步直行通道，使用同一套 Session/Run 生命周期，省略 `ew-analyze` / `ew-plan` 多阶段拆解、默认多 Agent 拆分与复杂决策门；它是 `ew-orchestrate/steps/ew-companion/` 中的真实可绑定步骤，不创建第二套状态协议。

## 路由原则与 `END` / 主链边界

**默认轻量优先（Lightest Sufficient Channel）**：现代强模型能够直接完成一般难度的跨文件理解、修改与验证；**不以文件数量（如 `<= 2` 文件）作为是否走 `ew-companion` 的硬门槛**。只要任务属于单一关注点、无需下游消费类型化工件（`current-plan` / `current-execution`）、也无需多阶段架构决策或 `--goal` 门禁，即使涉及多个文件的联动改动，也应优先进入 `ew-companion` 在当前上下文直接完成（`implement` / `fix` / `refactor` 等动作词不覆盖复杂度判断）。

| 条件 | 路由 | 说明 |
| --- | --- | --- |
| 纯问答、只读解释或状态查询（零文件改写） | `END` | 不打开 Session，直接基于只读工具与 Knowledge Gate 作答 |
| 一般单关注点改动、局部修补、局部重构或状态变更检查（**不限文件数**，无需多阶段工件交接或正式门禁） | `ew-companion` | 打开单步 Session，利用完整模型能力直接定位、改动并验证，走完整 Run 封存与证据留存（默认不拆分多 Agent） |
| 需架构/方案权衡、跨包/多模块耦合（`>= 3` 模块）拆解、`--goal` 长链，或显式要求类型化工件与独立验收评审 | 主编排链 | `ew-analyze` / `ew-plan` / `ew-execute` / `ew-verify` / `ew-review` |

## 最小生命周期

1. 确认满足单步直行条件（单一关注点、无需下游类型化工件消费、无需正式决策门或跨包架构分解、可由直接检查/测试验证）。
2. 通过 `evolve capabilities` 校验能力，打开仅含 `ew-companion` 步骤的 Session 并派发：

```text
evolve session create "<intent>" --id <slug> --actor <actor> --chain ew-companion
evolve run create --session <session-id> --actor <actor> --expected-orchestration-revision <revision>
```

3. 读取 `evolve run read skill <run_id> --session <session-id>`、加载项目知识（CLI `--reads`），如有 `latest-review` / `latest-debug` 上游输入通过 `evolve run read artifact` 读取。
4. 直接在当前主上下文利用完整模型能力定位目标、完成边界内改动并执行最窄验证命令（**默认不拆分子 Agent，也不套用 `ew-analyze`/`ew-plan` 仪式**）；将操作记录与验证命令写入 `{run_dir}/outputs/companion-log.md`（带匹配 `companion-log/1.0` 的 YAML frontmatter），若过程中解决了非显而易见的问题或环境坑点，通过 `evolve kb add --kind episodic "<lesson>" --type verified_fix --scene coding --session <session-id>` 记录到工作记忆，然后封存 Run 并完成终态 Session：

```text
evolve run complete <run_id> --session <session-id> --actor <actor> --expected-orchestration-revision <rev> --expected-run-revision <run_rev> --summary "<observed change and verification>" --verdict done|done_with_concerns
evolve session complete --session <session-id> --actor <actor> --expected-orchestration-revision <rev>
```

5. Session 完成后按 `session complete` 返回的 `closeout_command` 转交 `ew-knowledge`（`evolve skill workflows show ew-knowledge`）处理候选知识（候选为零同样正常完结）。不要在业务任务执行中自动调用 `workflow-evolve` 或 `evolve session review`；仅当 `evolve_reminder` 确实反映了 Skill/编排流程本身的缺陷时，在收尾简要告知用户可显式使用 `/workflow-evolve`。

## 退出与升级

| 发现 | 处理 |
| --- | --- |
| 目标不明确或缺少完成条件 | 若仍属单步改动，暂停询问或 `evolve run cancel` 后记录阻塞并在澄清后重派 |
| 需要深入根因调查或演化为跨模块/跨包架构改动（`>= 3` 耦合模块或接口重设计） | **同 Session 升级**：保留当前发现，先对活跃 Run 执行 `evolve run cancel`（步骤退回 `pending`），再用 `evolve session step delete --step-id ew-companion-1 --evidence "<scope expanded>"` 删除单步，并用 `evolve session step add` 追加 `ew-analyze` / `ew-debug` 等多步链（禁止遗留孤立 open Session） |
| 需要显式任务 DAG 拆解或正式多步实现/独立审查门禁 | 同上执行 `run cancel` + `session step delete --step-id ew-companion-1`，在同 Session 内 `session step add` 追加 `ew-plan` → `ew-execute` → `ew-verify` / `ew-review` |
| 需要长期多轮审计或并行探索 | 关闭/跳过当前轻量链后，明确提示用户显式调用 `/ew-odyssey` 或 `/ew-swarm` |
