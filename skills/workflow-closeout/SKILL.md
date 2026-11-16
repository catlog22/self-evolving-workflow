---
name: workflow-closeout
description: 兼容入口。将 Session、Skill 收尾沉淀、Wiki 审查与发布统一路由到 Evolve 知识治理流程。
session-mode: none
version: 0.1.0
---

# Evolve 知识路由兼容入口

当旧宿主仍调用 `workflow-closeout` 时，按以下步骤接入统一知识治理：

1. 使用 `evolve workflows show knowledge`（或阅读 `skills/ew-orchestrate/references/knowledge-route.md`）获取统一的 Wiki 条目属性、Closeout 证据、候选审查、迁移与发布规则。
2. 统一通过 `evolve closeout`、`evolve wiki` 与 `workflow-evolve` 完成沉淀、候选审查与发布（源码仓库内使用 `node dist/workflow-cli.js`）。
3. 零候选、延期与待补证均通过结构化回执正常收尾；严禁绕过治理命令直接写入 `wiki/entries/`。
