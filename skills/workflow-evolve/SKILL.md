---
name: workflow-evolve
description: 回溯指定 Session 或独立 Skill 调用，找出可归因到 Skill 的执行问题，按优先级生成附加指令或 Markdown 引用。
---

# Skill 自进化

1. 调用 `agent-memory --root <maestro-project> session review <session-id>`。有经授权的会话导出时，加 `--transcript <messages.json>`。用信号的 `runIds` 找到对应执行和 `skillRef`，用 `skillReads` 核对实际打开的文件、哈希与封存回执。对只来自会话片段的信号，先结合上下文确认对应的 Run。缺少版本记录时保留为待确认信号。
   - 独立 Skill 调用用 `agent-memory --root <maestro-project> evolve review <execution-id> --project <source-project-id>`，从已提交的回执获取 Skill 版本、结束状态和信号。有独立 Wiki 目录时传入记录该回执时使用的 `--wiki-root`。
2. 在对应 Git 版本中检查步骤、约束和适用条件。结合失败、修复和验证证据判断是否应修改 Skill。对缺少读取记录的文件，将其读取情况视为未知。把临时故障与执行器问题交给对应处理流程。只有能定位到具体 Skill 行为并回查证据时才生成草稿。
3. 生成附加内容。把支持同一改动的用户纠正、失败与验证证据合在一份草稿中。运行 `agent-memory evolve draft <SKILL.md> "<执行指令或说明>" --priority <high|normal|low> --evidence "<证据引用>"`。有多个来源时重复传入 `--evidence`。
   - `high` 用于每种合法调用都必须遵守的正确性要求或关键门禁。在入口放一条短指令，供每次执行前读取。
   - `normal` 用于有明确触发条件的要求，包括只在部分调用生效的关键门禁。用包内链接承载说明，并用 `--when "<触发条件>"` 标出何时读取。
   - `low` 用于可选技巧或小范围案例。放入独立参考文档，并追加到 `references/learnings/index.md`。入口首次增加索引链接，执行者在明确需要参考示例或排障时打开索引。
4. 将草稿保存为 JSON。准备场景文件并运行 `agent-memory --root <project> evolve replay <draft.json> --runner <host-runner.mjs> --scenarios <cases.json>`。场景是 `{id,input,baseline}` 数组，至少覆盖一次原问题和一次既有成功流程。脚本从标准输入取得场景、入口和提交，通过真实宿主执行后返回 `{passed,loaded:[{path,sha256}]}`。命令用独立 Git worktree 对照旧版和候选版，核对宿主实际读取的内容，并返回回执 ID。
   - 对 `low` 用显式查阅场景验证索引和具体文档，用常规场景检查索引未被读取。对 `normal` 分别检查触发和非触发场景。
   - 对 `skills/<id>/SKILL.md` 下可用文本结果验收的任务，可选用包内 [Codex 回放脚本](scripts/codex-replay.mjs)。将 `MAESTRO_REPLAY_CLI` 指向支持项目 Skill 绑定的 Maestro JavaScript 入口绝对路径。用 `input.task` 给宿主任务，用 `input.expected` 给回放脚本预期文本。Codex 通过本次回放的 MCP 工具按需读取绑定文档，脚本从 `run check` 获取实际文档哈希。需要工作区读写、产物检查或命令验收时，提供项目自己的脚本。
5. 得到采用授权后，运行 `agent-memory --root <project> evolve apply <receipt-id>`，重新执行并核对宿主加载版本。用 `agent-memory --root <project> evolve rollback <receipt-id>` 恢复该次变更，保留 Git 历史。
