# Evolve Companion 内部路由

Companion 是 Evolve 内部的轻量执行通道。它使用同一套 Session/Run 生命周期，只省略不需要的多阶段分解、额外决策门和下游工件交接。它不是独立 Skill，也不创建第二套执行协议。

## 适用条件

以下条件必须同时满足。

- 任务目标具体、边界明确，包含文件、函数、错误或可直接定位的操作对象。
- 只有一个关注点，执行方式可以直接判断，不需要架构或方案选择。
- 不需要下游步骤消费类型化工件。
- 不需要独立决策门、长链恢复或多轮质量循环。
- 完成条件可以通过直接检查、测试或命令结果验证。

文件数量不决定是否使用 Companion。任务一旦出现根因不明、需要协调多个阶段、需要新的计划工件或需要独立审查，就回到 Evolve 的 `ew-analyze`、`ew-plan`、`ew-execute` 和 `ew-review` 路由。

## 最小生命周期

1. 读取通用 Run 规则和本文件，记录任务边界、目标文件和完成条件。
2. 通过 `evolve capabilities` 校验 Session/Run 能力。
3. 创建一条只有 `ew-companion` 步骤的 Session 链。

```text
evolve session open "<intent>" --id <slug> --actor <actor>
evolve session chain insert --session <session-id> --step-id companion-1 --command ew-companion --arg "<intent>" --actor <actor> --expected-orchestration-revision <revision>
evolve run next --session <session-id> --actor <actor> --expected-orchestration-revision <revision>
```

4. 使用 `run next` 返回的 `task`、`skill_ref`、`gates`、`run_dir`、`revision` 和 `orchestration_revision`。按共享循环执行准备、操作、检查和完成。
5. 将最小证据追加到 `{run_dir}/evidence/companion-log.md`，记录目标、关键发现、执行结果和验证命令。
6. 通过 `evolve run complete <run_id> --session <session-id> --actor <actor> --expected-orchestration-revision <revision> --expected-run-revision <revision> --summary "<summary>" --verdict done|done_with_concerns` 完成 Run，再用 `evolve session complete --session <session-id> --actor <actor> --expected-orchestration-revision <revision>` 完成终态 Session。

Companion 不修改 `session.json`、`run.json` 或其他协议状态文件。所有状态变更都经过 Runtime 的受控命令。`-y` 只跳过低风险任务确认，不授予 Wiki 发布或 Skill 修改授权。

## 执行规则

- 先读取目标和相邻实现，确认边界后再修改。
- 复用现有模式，保持修改集中，不为轻量任务扩大范围。
- 每个关键动作都保留可回查的文件、命令或测试证据。
- 任务失败时先检查是否属于可恢复的执行错误。需要新的方法或新的证据时，按共享 Run 恢复规则处理。
- 发现任务不再满足适用条件时停止 Companion 执行，把新的边界和已收集证据交回 Evolve 重新分类。
- Session 完成后按 [知识路由](knowledge-route.md) 处理证据和候选。候选可以为零。

## 退出与升级

| 发现 | 处理 |
| --- | --- |
| 目标不明确或缺少完成条件 | 回到 Evolve 分类并请求必要信息 |
| 需要调查根因或跨模块分析 | 路由到 `ew-analyze` |
| 需要拆解任务或产出计划 | 路由到 `ew-plan` |
| 需要多阶段实现和验证 | 路由到 `ew-execute`，必要时追加 `ew-review` |
| 需要长期迭代、全面审计或并行协作 | 转交对应的 Odyssey 或 Swarm 入口 |
