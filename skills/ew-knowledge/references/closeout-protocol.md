# 收尾与候选晋升协议

本文件定义任务 / Session 结束或独立知识收尾时，完成责任人（Completion Owner）遵循的规范流程：`Read → Refresh → Present → Ask → Execute → Verify`。

## 所有权与时机

- Run 完成阶段仅允许沉淀候选；已采纳决策或锁定约束不等同于 Wiki 发布授权。
- 长链中间 Run 继续推进既有链，不在中途插入发布审批；整体终端收尾或显式知识管理请求时执行本协议。
- `ew-knowledge` 自身与 `workflow-evolve` 的执行记录不进入自动沉淀，防止递归。

## 执行步骤

### 1. Read internally（只读收集与查重）

先消费已提交回执并查看现有候选与对照关系，不把人类用户直接打发去运行 CLI：

```text
evolve --root <project> closeout session <session-id> --project <source-project-id> --receipt <receipt-id>
evolve --root <project> closeout skill <execution-id> --skill <skill-id> --skill-version <version> --status <status> --transcript <messages.json> --project <source-project-id>
evolve --root <project> closeout scan <source-project-root> --project <source-project-id>
evolve --root <project> closeout show <receipt-id> --project <source-project-id>
```

- 重复投递按回执身份幂等处理；模型抽取失败时沿用同一回执重试，不重构或扩大证据范围。
- 先用 `evolve wiki search` / `evolve wiki get` 核对每条候选与现有活跃 Wiki 的重复、重叠或冲突，保留双方证据并先于发布生成预览：

```text
evolve --root <project> wiki propose <change.json> --closeout <closeout-id> --candidate <candidate-id>
evolve --root <project> wiki propose <change.json> --evidence <receipt-id>
evolve --root <project> wiki changes [<change-id>]
```

- 没有合格候选时直接记录零候选回执并正常结束。

### 2. Present（结构化呈现）

向用户逐条展示每个可处理候选的：
- 精确 `candidate-id`、建议动作（新增 / 更新 / 追加来源 / 标记冲突 / 跳过）与理由；
- 真实验证证据锚点（完成回执、消息 ID、命令结果）；
- 与既有 Wiki 条目的命中对照关系（不要将不可信原始对话摘录直接当作已验证正文）。

### 3. Ask（人类审查与固定授权）

通过宿主结构化提问工具（Antigravity 使用 `ask_question`，或宿主等效工具）一次性收集**固定候选 ID 列表、关系裁决与发布/分流动作**的明确授权：
- 必须提供选择、拒绝与延期选项；群组确认仅对本次展示的固定 ID 列表生效。
- `-y`、高重要性标记或机器建议**不能**替代人类发布确认；无提问工具且无先前针对同批固定 ID 的显式授权时，直接延期保留待审查清单，不要输出裸命令敷衍了事。
- 不得为清空待办而伪造 `duplicate` 等裁决。

### 4. Execute（按固定授权逐项执行）

仅对明确批准的固定 ID 执行对应操作（禁止 `--all` 扩大选择范围）：

```text
# 路径 A：对审核通过的变更执行 Wiki 应用或直接发布
evolve --root <project> wiki apply <change-id>
evolve --root <project> closeout publish <closeout-id> <candidate-id> "<title>"

# 路径 B：问题可归因于具体 Skill 或需要新流程包时进行分流
evolve --root <project> closeout route <closeout-id> <candidate-id> --skill <skill-id> --skill-version <version>
evolve --root <project> session review <session-id>
evolve --root <project> skills review <execution-id> --project <source-project-id>
```

若候选在 `closeout route` 后达到元 Skill 设计条件，再显式转交 `ew-skill-design`（`skill-design task|run|review|replay|apply`）；若仅是既有 Skill 指令或边界缺陷，则转交 `workflow-evolve`。

### 5. Verify（回读确认）

执行后回读 `evolve wiki get <id>` / `evolve wiki changes <change-id>` / `evolve closeout show <receipt-id>`，如实报告成功发布的条目 ID 与仍处于待审查/延期/阻塞状态的候选项。
