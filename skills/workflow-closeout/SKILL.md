---
name: workflow-closeout
description: 在 Maestro Session 或独立 Skill 结束后，从完成回执提取可追溯的 Wiki 经验。适用于复盘纠正、失败和已验证的处理方法。
---

# 多层沉淀

1. 从已提交的 Session 完成回执或独立 Skill 的结束回执获取证据。关联失败、处理动作和验证结果。原因未查明的信号保留在回执证据中。
2. 调用 `agent-memory --root <wiki-project> closeout harvest <receipt.json> --project <source-project-id>`。补扫 Maestro Session 时调用 `agent-memory --root <wiki-project> closeout scan <maestro-project> --project <source-project-id>`。
3. 核对提取结果的证据和适用范围。重复验证的项目参考可以追加来源。新参考在得到对应候选的发布授权后，通过 `agent-memory --root <wiki-project> closeout publish <closeout-id> <candidate-id> "<title>"` 发布。
4. 如证据指向 Skill 本身的步骤、默认条件或约束缺漏，用 `agent-memory --root <maestro-project> session review <session-id>` 回溯信号，将目标版本和相关证据交给 [Skill 自进化](../workflow-evolve/SKILL.md)。

本次只产生运行信号或零条候选时，使用处理回执结束沉淀。
