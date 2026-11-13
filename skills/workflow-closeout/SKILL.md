---
name: workflow-closeout
description: 在 Maestro Session 或独立 Skill 结束后，从完成回执提取可追溯的 Wiki 经验。适用于复盘纠正、失败和已验证的处理方法。
---

# 多层沉淀

1. 从已提交的 Session 或独立 Skill 结束回执获取证据。关联失败、处理动作和验证结果。原因未查明的信号保留在回执证据中。
2. 对已启用自动沉淀的 Session，用 `agent-memory --root <maestro-project> closeout show <receipt-id> --project <source-project-id>` 查看候选。需要补处理时用 `closeout session <session-id> --receipt <receipt-id>`。宿主在独立 Skill 结束后调用 `closeout skill <execution-id> --skill <id> --skill-version <version> --status <succeeded|failed|cancelled> --transcript <messages.json>`。这条命令先记回执，再提取经验。有独立 Wiki 目录时为这些命令传 `--wiki-root <wiki-project>`；用 `closeout scan <maestro-project>` 重试未处理的回执。
3. 核对提取结果的证据和适用范围。重复验证的项目参考可以追加来源。新参考在得到对应候选的发布授权后，通过 `agent-memory --root <wiki-project> closeout publish <closeout-id> <candidate-id> "<title>"` 发布。
4. 如证据指向 Skill 的步骤、默认条件或约束缺漏，将 Session ID 与相关证据交给 [Skill 自进化](../workflow-evolve/SKILL.md) 回溯和核对。

本次只产生运行信号或零条候选时，使用处理回执结束沉淀。
