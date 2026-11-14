---
name: workflow-closeout
description: 兼容入口。将 Session、Skill 收尾沉淀、Wiki 审查和发布统一路由到 Maestro 知识路由。
---

# Maestro 知识路由兼容入口

所有操作先读取 [Maestro 知识路由](../maestro/references/knowledge-route.md)。该文件统一规定 Wiki 条目属性、Closeout 证据、候选审查、迁移和发布顺序。

旧宿主仍调用 `workflow-closeout` 时，继续使用同一 Agent Memory Closeout CLI 和同一 Wiki。不要恢复 `maestro-knowledge`、`maestro-knowhow` 或旧 Spec 的独立流程。零候选、延期和待补证都通过处理回执结束本次操作。
