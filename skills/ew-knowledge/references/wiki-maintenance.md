# Wiki 与记忆维护参考

本文件汇总 `evolve wiki` 与 `evolve memory` 的日常检索、索引、摄入与跨宿主记忆提取操作。

## Wiki 索引、查询与摄入

| 操作 | 命令 | 说明 |
| --- | --- | --- |
| 重建 / 更新 Wiki 索引 | `evolve wiki build` | 扫描并索引 `wiki/` 下的 Markdown 页面与依赖关系 |
| 从源文档生成/合并 Wiki 页 | `evolve wiki ingest <file.md\|file.txt>` | 需配置 OpenAI 兼容模型接口；保留来源归属与已锁定页面 |
| 检索与图谱展开 | `evolve wiki search "<query>"` | 支持全文与关系检索 |
| 按范围列出约束 | `evolve wiki constraints [--task <kind>] [--path <glob>] [--category <cat>]` | 解析对当前上下文生效的 `mode: constraint` 条目 |
| 按范围查询参考 | `evolve wiki references "<query>" [--task <kind>] [--path <glob>] [--repository <uuid>]` | 解析活跃 `mode: reference` 条目 |
| 精确读取条目与历史 | `evolve wiki get <entry-id> [--resolved]` | 读取完整正文、作用域与修订历史 |

## 工作记忆写入、检索与多宿主同步

本地工作记忆保存在 `<root>/.agent-memory/memory.db`，可通过以下 CLI 直接读写或配置自动提取：

| 操作 | 命令 | 说明 |
| --- | --- | --- |
| 手工写入记忆 | `evolve memory put "<text>" [--id <id>] [--type <type>] [--scene <scene>] [--session <session>]` | 立即保存工作经验并可供 `context` 召回 |
| 分页检索记忆 | `evolve memory search "<query>" [--type <t>] [--scene <s>] [--session <id>] [--page <n>] [--limit <n>]` | 返回短预览与后续读取参数，避免一次拉爆上下文 |
| 精确读取单条记忆 | `evolve memory get <memory-id>` | 按需展开全文 |
| 追溯原始对话来源 | `evolve memory sources <memory-id>` / `evolve memory conversation <id> --host <host> [--page <n>]` | 分页查看原始对话上下文 |
| 从消息文件抽取 L1 记忆 | `evolve memory extract <messages.json> --session <id> [--mode chat\|code]` | 需配置模型接口（`AGENT_MEMORY_LLM_BASE_URL`、`AGENT_MEMORY_LLM_MODEL`、`AGENT_MEMORY_LLM_API_KEY`） |
| 配置与同步多宿主会话 | `evolve memory config --host <codex\|claude\|agy\|all\|off>`、`evolve memory sync --host <codex\|claude\|agy\|all> [--session <id>]` | 支持 Codex CLI、Claude Code 与 Antigravity 会话历史增量抽取 |
