---
name: workflow-closeout
description: 在 Maestro Session 或独立 Skill 结束后，从完成回执提取可追溯的 Wiki 经验。适用于复盘纠正、失败和已验证的处理方法。
---

# 多层沉淀

1. Session 结束前，将可用于沉淀的会话片段保存为含 `host_kind`、`host_session_id`、`entry_id` 和 `quote` 的 JSON，调用 `maestro session evidence <descriptor.json> --session <id> --json` 得到引用。将引用通过 `--evidence` 传给相关 Run 的状态变更或 Session 完成。随后从已提交的 Session 或独立 Skill 结束回执获取证据，关联失败、处理动作和验证结果。原因未查明的信号保留在回执证据中。
2. 用 `agent-memory --root <maestro-project> closeout show <receipt-id> --project <source-project-id>` 查看候选。需要补处理时，用 `closeout session <session-id> --receipt <receipt-id>` 重试 Session，用 `closeout resume <receipt-id>` 重试独立 Skill。`maestro skills run <id> "<任务>" --json` 在配置 Evolve 后自动记录独立 Skill 回执。其他宿主可在 Skill 结束后调用 `closeout skill <execution-id> --skill <id> --skill-version <version> --status <succeeded|failed|cancelled> --transcript <messages.json>`。有独立 Wiki 目录时传 `--wiki-root <wiki-project>`。用 `closeout scan <maestro-project>` 补扫未处理的回执。
3. 核对提取结果的证据、适用范围和关联条目。没有关联条目的新参考可在获得对该候选的发布授权后执行 `closeout publish <closeout-id> <candidate-id> "<title>"`。已有条目需要更新，或存在重叠与相反证据时，通过 `wiki propose <change.json> --closeout <closeout-id> --candidate <candidate-id>` 暂存处理决定。请求中填写 `operation`、`entry`、所需内容和 `review` 中的 `relationship`、`rationale`。展示前后内容、作用域与来源，获得对确切变更 ID 的授权后执行 `wiki apply <change-id>`。
4. 如证据指向 Skill 的步骤、默认条件或约束缺漏，将 Session ID 与相关证据交给 [Skill 自进化](../workflow-evolve/SKILL.md) 回溯和核对。

本次只产生运行信号或零条候选时，使用处理回执结束沉淀。
