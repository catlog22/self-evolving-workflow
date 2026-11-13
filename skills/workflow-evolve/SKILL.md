---
name: workflow-evolve
description: 回溯指定 Session，找出可归因到 Skill 的执行问题，按优先级生成附加指令或 Markdown 引用。
---

# Skill 自进化

1. 调用 `agent-memory --root <maestro-project> session review <session-id>`。有经授权的会话导出时，加 `--transcript <messages.json>`。检查用户纠正、错误、重试及修复证据，并核对实际执行的 Skill 版本。
2. 确认缺漏位于 Skill 的步骤、约束或适用条件。把临时故障与执行器问题留给对应处理流程。
3. 生成附加内容。运行 `agent-memory evolve draft <SKILL.md> "<执行指令或说明>" --priority <high|normal|low> --evidence "<证据引用>"`。有多个来源时重复传入 `--evidence`。
   - `high` 放一条明确的短指令，供每次执行前读取。
   - `normal` 用包内链接承载详细说明，用 `--when "<触发条件>"` 标出何时读取。
   - `low` 放入独立参考文档，供主动检索。
4. 核对草稿的基线哈希，在隔离工作区用实际宿主回放旧版和候选版。使用相同输入复现旧问题并验证候选，同时跑已有成功场景。记录实际加载路径和版本。
5. 确认采用后应用经过回放的候选，保留旧版本和回滚记录。重新执行并核对宿主实际加载的内容。
