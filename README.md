# Self-Evolving Workflow

面向代码助手的可恢复开发工作流。用 `evolve` 管理 Session 和 Run，并查询代码图谱、项目 Wiki 和工作记忆。每个 Run 可以绑定 Git 中的 Skill 版本，记录读取过的知识和交付证据，方便恢复执行和复查结果。

[npm 安装包](https://www.npmjs.com/package/evolve-agent-memory) · [Session 与 Run 指南](skills/ew-orchestrate/references/orchestrator-run-loop.md) · [MIT 许可证](LICENSE)

## 快速开始

需要 Node.js `22.16.0` 或更新版本。项目工作流还需要 Git，用来固定 Run 所使用的 Skill 版本。

```sh
npm install -g evolve-agent-memory
evolve --help
```

现有脚本可以继续使用 `agent-memory`。两个入口共用项目 Wiki、记忆数据库和代码图谱索引。

进入项目的 Git 根目录，安装项目 Skill 和 `AGENTS.md` 指南，再把它们提交到 Git。

```sh
evolve install --scope project --yes
git add -- AGENTS.md skills/
git commit -m "chore: 安装项目工作流"
```

写入一条本地工作记忆并检索它。

```sh
evolve memory put "发布前运行回归测试。" --id quickstart-regression --type work_method --session quickstart
evolve context "回归测试" --session quickstart --include-memory
```

在查询结果的 `working_memories` 中可以找到 `quickstart-regression`。本地记忆和 Wiki 检索可直接使用。通过模型抽取记忆或导入文本时，可配置 OpenAI 兼容的模型接口。

接下来可以在代码助手中运行一次轻量任务。

> 读取项目的 `AGENTS.md` 和 `skills/ew-orchestrate/SKILL.md`，使用 `ew-companion` 开一轮 Evolve Run，验证刚写入的回归测试记忆能被检索，并完成 Session。

用 `evolve session list` 查看 Session，用 `evolve workflows show session-run` 查看命令行的分派、封存和恢复步骤。

## 支持的工作

| 任务 | 入口 |
| --- | --- |
| 单个可直接验证的任务 | `ew-companion` |
| 需要分析、规划、执行和评审的任务 | `ew-orchestrate` |
| 搜索代码符号和调用关系 | `evolve code search`、`evolve code callers` |
| 按项目范围检索约束、参考和工作记忆 | `evolve context` |
| 单独搜索 Wiki 或工作记忆 | `evolve wiki search`、`evolve memory search` |
| 根据经过验证的证据改进 Skill | `workflow-evolve` |

Run 通过 MCP 读取项目知识时，回执会记录搜索范围、条目 ID 和正文校验值。Session 可以把已读取的知识固定为后续步骤的输入。Skill 改进以提案形式进入评审和回放，通过验证后再应用。运行状态和工作记忆保存在项目的 `.agent-memory/`，正式 Wiki 条目位于 `wiki/entries/`。 [知识使用与沉淀](skills/ew-orchestrate/references/knowledge-route.md)

## 代码图谱

在 Git 根目录打开 Session，或首次用 `evolve` 查询代码时，会自动在项目的 `.codegraph/` 中建立索引。之后打开 Session 或查询代码时，CLI 会先同步新增、修改和删除的文件。只查 Wiki 或记忆时无需建立代码图谱。

```sh
evolve code search "<symbol>"
evolve code callers "<symbol-id>" --depth 2
evolve code trace "<from-id>" "<to-id>"
evolve search "<query>" --scope code
```

可以用 `evolve code build` 手动全量索引，也可以用 `evolve code sync` 手动更新已有索引。使用兼容入口 `agent-memory` 的脚本仍可按原方式显式执行 `code build` 和 `code sync`。

## 从 Maestro Flow 迁移

在旧项目根目录预览迁移。`--knowhow-only` 只选择 `.workflow/knowhow/` 中的 Knowhow。确认预览后加上 `--apply`，将条目作为 Wiki `reference` 写入并建立索引。

```sh
evolve knowledge import --knowhow-only
evolve knowledge import --knowhow-only --apply
```

迁往另一个项目时，传入源项目路径，并用 `--root` 指定目标。要同时导入旧 Spec，使用 `evolve knowledge import` 预览。带仓库限制的条目可用 `evolve wiki references "关键词" --repository "<仓库 UUID>"` 检索。 [迁移与项目范围](skills/ew-orchestrate/references/knowledge-route.md)

## 源码开发

```sh
git clone https://github.com/catlog22/self-evolving-workflow.git
cd self-evolving-workflow
npm ci
npm test
```

`npm test` 会编译 TypeScript 并运行回归测试。源码检出可用 `node dist/workflow-cli.js --help` 和 `node dist/cli.js --help` 查看两个入口。

## 致谢

工作流延续了 Maestro Flow 的 Session、Run 和 Skill 生命周期设计。代码图谱的自动初始化和同步参考了 Maestro Flow 的启动及提交提示词钩子。记忆和 Wiki 实现复用了 TencentDB Agent Memory 的部分 MIT 代码。 [Maestro Flow](https://github.com/catlog22/maestro-flow) · [Maestro Flow 图谱初始化](https://github.com/catlog22/maestro-flow/blob/master/src/hooks/kg-auto-init.ts) · [Maestro Flow 图谱同步](https://github.com/catlog22/maestro-flow/blob/master/src/hooks/kg-sync-hook.ts) · [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/42d4cde50c5a83182fced8c584f9ddb32a620615)
