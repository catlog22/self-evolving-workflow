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
4. 将草稿保存为 JSON。准备一个由项目维护的宿主回放脚本和场景文件，运行 `agent-memory --root <project> evolve replay <draft.json> --runner <host-runner.mjs> --scenarios <cases.json>`。场景是 `{id,input,baseline}` 数组，至少覆盖一次原问题和一次既有成功流程。脚本从标准输入取得场景、入口和提交，通过真实宿主执行后返回 `{passed,loaded:[{path,sha256}]}`。命令用独立 Git worktree 对照旧版和候选版，核对宿主实际读取的内容，并返回回执 ID。
5. 得到采用授权后，运行 `agent-memory --root <project> evolve apply <receipt-id>`，重新执行并核对宿主加载版本。用 `agent-memory --root <project> evolve rollback <receipt-id>` 恢复该次变更，保留 Git 历史。
