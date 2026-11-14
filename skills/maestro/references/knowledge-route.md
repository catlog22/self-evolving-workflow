# Maestro 知识路由

本文件是 Maestro 内部唯一的知识路由。Wiki、Session/Skill 收尾沉淀、候选审查和发布共用 Agent Memory 与统一 Wiki。`workflow-closeout` 只作为旧调用名的兼容入口，并引用本文件。

## 路由边界

| 用户意图 | 路由 | 默认状态 | 主要入口 |
| --- | --- | --- | --- |
| 查约束、查参考、查术语、查 Wiki | `read` | 只读 | `agent-memory wiki constraints|references|reference|search|get` |
| Session 或 Skill 完成后的沉淀 | `closeout` | 生成候选 | `agent-memory closeout session|skill|scan|show` |
| 审查重复、重叠、冲突和证据 | `review` | 只读 | `closeout show`、`wiki get`、`wiki search` |
| 发布或更新候选 | `publish` | 需要明确授权 | `wiki propose` → `wiki apply` 或 `closeout publish` |
| 迁移旧 Spec 和 Knowhow | `migrate` | 预览 | `agent-memory wiki migrate` |
| 发现可归因于 Skill 的问题 | `evolve` | 只读回溯 | `agent-memory session review` 或 `evolve review`，随后转交 `workflow-evolve` |
| 候选需要新 Skill 或新流程包 | `skill-design` | 只读决策 | `agent-memory closeout route`，满足结构条件时显式调用元 Skill 设计 |

### 统一 Wiki 条目

正式知识只进入 Wiki 条目。原 Spec 和 Knowhow 通过属性表达差异。

- `mode: constraint` 表示执行约束、质量门禁和适用规则。
- `mode: reference` 表示经验、方法、模板、术语和可选建议。
- `status: active|needs_review|deprecated` 表示生命周期。
- `scope` 表示 `project`、`skill:<id>`、`task:<kind>` 或 `path:<glob>` 等适用范围。
- `categories`、`tags` 和 `keywords` 用于查询和路由，不能替代 `mode` 与 `scope`。
- `sources` 必须能回查到完成回执、消息锚点或迁移来源。

不再创建或直接修改 `.workflow/specs/`、`.workflow/knowhow/`。旧目录只作为迁移输入和历史档案。

## 路由规则

1. 先识别操作，再识别目标。`查、搜索、读取、引用` 进入 `read`，`收尾、沉淀、harvest` 进入 `closeout`，`审查、重复、冲突、候选` 进入 `review`，`发布、批准、应用` 进入 `publish`，`迁移、导入` 进入 `migrate`。
2. 只有明确要求发布或应用时才执行写入。检索结果、Closeout 候选、审计结果和回溯信号都只是证据。
3. Session 收尾和独立 Skill 收尾进入同一 Closeout 流程。使用完成回执中的证据范围，不从未授权的工作区文本补证。
4. Closeout 提取出可复用方法后，先核对适用条件、验证证据和现有条目的关系，再决定追加来源、创建候选、更新条目或标记冲突。
5. 同一内容在唯一活跃 `reference` 条目中重复验证时，可以只追加 `sources`。正文、作用域和模式变化必须走 Wiki 提案。
6. `constraint` 与 `reference` 发生冲突时保留双方证据，创建待审查关系，不自动覆盖活跃条目。
7. 没有合格候选、候选被拒绝或用户延期都属于正常结果，不得为了填充知识库而制造条目。
8. 发现信号能定位到具体 Skill、版本、读取文件和证据时，才转交 `workflow-evolve`。项目级规则和跨任务经验留在 Wiki。
9. 候选只有在需要新契约、新产物、跨 Skill 路由、至少 3 个稳定步骤或明确要求新增 Skill 时，才进入 `skill-design`。单条指令和条件链接继续由 `workflow-evolve` 处理。

## 操作流程

### `read`

按查询类型选择最窄的入口。约束读取必须带适用上下文，参考读取保留条目 ID 和来源。

```text
agent-memory --root <project> wiki constraints --skill <id> --category <category>
agent-memory --root <project> wiki references "<topic>" --skill <id> --task <kind>
agent-memory --root <project> wiki reference <entry-id> --skill <id> --task <kind>
agent-memory --root <project> wiki search "<query>"
agent-memory --root <project> wiki get <entry-id>
agent-memory --root <project> context "<query>" --skill <id> --task <kind> --session <session-id>
agent-memory --root <project> context "<query>" --skill <id> --task <kind> --session <session-id> --include-memory
agent-memory --root <project> context "<query>" --session <current-session-id> --memory-session <historical-session-id> --include-memory
agent-memory --root <project> search "<query>" --scope memory --scene <scene> --type <type> --trace --trace-file <knowledge-reads.json>
```

没有命中时保留查询条件和空结果。不要把缺少参考误写成新的约束。

### Search 与 Get/Query 的 ID 边界

- `search(query, filters?)` 负责候选发现，不接收 `knowledge_id`。查询词、作用域、Skill、任务、路径和分类是它的输入。
- 搜索结果返回稳定的 `knowledge_id`，供后续精确读取和审计使用。
- `get(id)`、`query({ id })` 和 `reference(id)` 负责单条读取，必须接收稳定 ID。Wiki 可以兼容已登记的 `aliases`，写入操作不接受别名。
- `constraints(context)` 根据 Skill、任务、路径和分类解析适用约束，不要求条目 ID。返回结果仍带 `knowledge_id`，用于 Run 快照和消费记录。
- `propose`、`changes` 和 `apply` 属于变更接口，必须使用规范化条目 ID、候选 ID 或变更 ID，并校验基线哈希。

标准调用顺序是 `search → get/query`。搜索只返回摘要和 ID，精确读取才返回完整正文、作用域和来源。

### 搜索回执

阶段 Skill 可以在搜索和精确读取完成后使用 `--trace` 获取 `knowledge_reads/1.0`。默认查询保持无状态，只有显式传入 `--trace` 才在结果中附加回执数据。回执包含 `constraints_bound`、`searches` 和 `reads`，由 Run 封存时写入 `result.knowledge_reads`。

- `searches[]` 记录查询词、阶段过滤条件、返回 ID 和命中数，不接收条目 ID。
- `reads[]` 记录 `wiki reference <id>`、`wiki get <id>` 或 `memory get <id>` 的精确读取，必须带稳定 ID。
- `reads[].from_search_id` 必须指向本次搜索或 `priors`，用于核对搜索到读取的链路。
- 跨 CLI 调用时使用同一个 `--trace-file`，精确读取再传 `--from-search <search-id>`，保持同一份回执中的搜索与读取关联。
- `content_sha256` 和 `version` 用于确认读取内容与回执时点一致。
- 没有执行搜索时不生成伪造记录。零命中使用 `returned_ids: []` 保留为可分析信号。

### L3 初始化与无侵入回溯

初始化时调用 `agent-memory context` 加载 L3 Wiki 约束和参考，返回 `agent-memory-envelope/1.0`。宿主保留自己的 system prompt、模型调用和工具链，初始化过程不读取宿主历史文件。

`context --session` 只标记当前工作上下文。需要限定历史 Working Memory 时显式使用 `--memory-session`，避免把新 Session ID 错当成历史记忆过滤条件。

任务结束后使用已提交的 Session/Run 回执执行 Review 和自进化。原始 CLI 历史不是常规输入。未来如果需要补充历史，按 `host_kind` 和显式配置的历史根目录选择性读取，并把结果转换成现有 `transcript-evidence/1.0`，只服务于一次明确的回溯请求。

### `closeout`

先消费已提交回执，再读取候选。模型提取使用 Agent Memory 的统一系统提示词，候选保留来源消息 ID 和回执身份。

```text
agent-memory --root <project> closeout session <session-id> --project <source-project-id> --receipt <receipt-id>
agent-memory --root <project> closeout skill <execution-id> --skill <skill-id> --skill-version <version> --status <status> --transcript <messages.json> --project <source-project-id>
agent-memory --root <project> closeout scan <maestro-root> --project <source-project-id>
agent-memory --root <project> closeout show <receipt-id> --project <source-project-id>
agent-memory --root <project> closeout route <closeout-id> <candidate-id> --skill <skill-id> --skill-version <version>
agent-memory --root <project> skill-design run <task-id> --runner <meta-skill-runner.mjs>
agent-memory --root <project> skill-design review <design-id>
agent-memory --root <project> skill-design replay <design-id> --runner <host-runner.mjs> --scenarios <cases.json>
agent-memory --root <project> skill-design apply <design-id>
```

重复投递按回执身份幂等处理。模型失败后使用同一回执重试，不重新构造证据。Closeout 自身和 `workflow-evolve` 的执行记录不进入自动沉淀，避免递归。

### `review`

审查时逐项核对以下内容。

- 候选是否有适用条件、动作和验证结果。
- 每个来源 ID 是否属于本次回执的冻结证据。
- 候选是否与活跃条目相同、重叠、冲突或仅仅相关。
- `mode`、`scope`、`categories` 和 `sources` 是否完整。
- 是否应追加来源、创建 Wiki 提案、等待补证或保持零候选。

审查输出保留候选 ID、条目 ID、关系、证据和建议动作。审查本身不应用文件变更。

`closeout route` 对 `route=skill-design` 生成当前项目 `.agent-memory/skill-design/tasks/` 下的设计任务。设计任务必须带目标 Skill，避免生成无法回放的无主候选。`skill-design run` 通过显式元 Skill runner 生成设计回执，`review` 校验候选能从目标基线重建，`replay` 复用现有 Skill replay，`apply` 和 `rollback` 复用现有版本应用链。路由结果中的 `invoke_meta_skill` 只表示允许显式调用，不代表自动启动元 Skill。

### `publish`

新条目或正文变化先创建提案，再在明确授权后应用。

```text
agent-memory --root <project> wiki propose <change.json> --closeout <closeout-id> --candidate <candidate-id>
agent-memory --root <project> wiki changes --entry <entry-id>
agent-memory --root <project> wiki apply <change-id>
agent-memory --root <project> closeout publish <closeout-id> <candidate-id> "<title>"
```

应用前核对目标条目基线、证据和作用域。应用后重建 Wiki 索引并读取结果验证。基线漂移、证据缺失、关系未裁决或授权不明确时保持候选待处理。

### `migrate`

迁移先预览，再逐范围核对。旧 Spec 映射为 `mode: constraint`，旧 Knowhow 映射为 `mode: reference`。保留原 ID、来源文件、旧标签和别名。无法判断作用域、身份冲突或引用断链时使用 `status: needs_review`。

```text
agent-memory --root <project> wiki migrate <legacy-root> --project <source-project-id> --scope project
agent-memory --root <project> wiki migrate <legacy-root> --project <source-project-id> --scope project --apply
```

迁移重复执行必须命中同一稳定 ID。应用前保留来源快照和迁移映射，应用后核对旧查询与新 Wiki 的有效条目集合。

## 与其他 Skill 的关系

- 当前 Agent Memory 主包负责识别意图并读取本路由。
- `workflow-closeout` 只提供旧名称兼容，不维护第二份知识规则。
- `workflow-evolve` 只处理有证据归因到 Skill 行为的修改、回放、应用和回滚。
- `maestro-odyssey`、`team-swarm` 和 `maestro-skill-design` 可以产生证据或候选，但知识落点仍由本路由决定。
