# DEF OpenCode 原生 + typed tools 健康度审查（2026-07-13）

## 结论

Spec 7 可以维持“已完成”状态，但当前设计更准确的评级是：**架构健康、运行时约束较强、agent 行为层中等健康，尚未达到可证明的弱提示稳定性**。

三类工具、原生 OpenCode 循环、节点代码工作区、codec、校验、diff、CAS、permission 与 host 隔离已经形成合理闭环。核心安全性质大多由代码而不是 prompt 保证。这说明“OpenCode 原生 + typed tools”路线本身是健康的，不需要再增加按钮级工具、Patch DSL 主路径或第四类工具。

当前主要风险不在工具能否执行，而在模型能否在普通用户短句、长会话、checkout 切换和多种近似工具并存时稳定选择正确路径。现有验收对此有正向证据，但黑盒入口会给用户消息附加工作流提示，因此不能把已有结果解释为“原生普通 prompt 下的工具选择已经充分稳定”。

## 健康度分项

| 维度 | 评级 | 依据与判断 |
| --- | --- | --- |
| 架构边界 | 健康 | 正式分类仍且仅有 `def-node-code`、`def-node-crud`、`def-data-resource`；代码式编辑是第一类的执行方式。 |
| 事实与写入安全 | 健康 | 规范化 source、只读 base/context/generated、codec rebuild、validation、semantic diff、risk、revision CAS 和 use 审批共同限制写入。 |
| host/session 隔离 | 健康 | Workbench 锁定 `def-workbench`，AI CLI 锁定自身 profile；发送时后端纠正错误 agent，目录与历史隔离。 |
| 状态切换安全 | 较健康 | `checkout-changed` 有 tool gate，节点操作会拒绝陈旧 checkout anchor；但正确恢复仍要求模型先调用空 `nodeId` 的 bind。 |
| 工具可发现性 | 中等健康 | tool description、agent prompt 和 `timeline-workbench` skill 都提供路由信息；同时存在明显重复和较长指令，容易在长上下文中稀释。 |
| 普通语言鲁棒性 | 证据不足 | 已有“你可以排轴吗”和一次代码式移动的成功记录，但场景少，且测试 ingress 给消息附加了明确工具工作流提示。 |
| 可观测性 | 中等健康 | 验收记录包含部分 session、工具、首响与完成时间；尚缺按 turn 记录的 prompt 版本、注入状态、错误分类和工具选择偏差。 |
| 上游可维护性 | 中等健康 | 复用原生 OpenCode 内核是优点；adapter 中长 prompt、skill 与运行时注入若继续各自增长，会提高升级和行为回归成本。 |

## 当前设计中健康的部分

### 1. typed tools 是能力边界，不只是 prompt 别名

工具实现已经在路径、revision、checkout、permission 和 repository 层做拒绝。即使模型忽略说明，也不能直接编辑只读投影、静默覆盖陈旧 revision 或绕过 use 改变 checkout。这是当前设计最健康的部分。

### 2. 原生工具与领域工具的分工合理

`read/edit/apply_patch` 负责自由编辑规范化节点源，typed tools 负责 materialize、bind、rebuild、validate、diff、approval/use 与可信资源解析。这个切分既保留了 agent 的组合能力，也把不可由模型自由决定的治理动作放回确定性代码。

### 3. checkout 转换已经从“提示建议”升级为硬门

`def.js` 会把 checkout 变化记录为 `checkout-changed`，并在其他节点操作前抛出 `def-workbench-checkout-changed`，要求先 `def_node_bind(nodeId="")`。这比只在 system prompt 中提醒可靠得多。

## 主要问题

### P1：黑盒入口污染了被测 prompt，导致行为健康度被高估

`docs/testing/def-agent-blackbox.md` 要求测试 prompt 像普通用户消息，不包含预期工具、验证标准、安全说明或实现细节。但 `electron/main.cjs` 的 `buildWorkbenchTestPrompt` 会把普通用户文本改写为：

- 使用已注册 native DEF tools；
- 不使用 legacy REST；
- mutation 必须走隔离子节点；
- validate、diff、approval 后才能 use。

这不违反“记录中的用户文本”表面形式，却改变了实际送给模型的文本。现有黑盒成功证明的是“用户请求 + 测试辅助 prompt”下可用，不是纯用户请求下可用。

建议把 ingress 发送给模型的 text 保持为原始用户消息；host、agent、context 和 runtime state 走独立字段。测试记录同时保存 `rawUserText`、最终 provider-visible user text、system/context 注入摘要及其版本哈希。

### P1：稳定指令存在三份来源，职责开始重叠

当前 Workbench 工作流同时存在于：

1. adapter 的 `buildAgentPrompt('workbench')`；
2. `timeline-workbench/SKILL.md`；
3. 黑盒 ingress 的 per-message 包装。

agent prompt 与 skill 对 fork、context、edit、validate、preview/use、occupied slot question 等规则重复较多。重复暂时能提高命中率，但会带来版本漂移：修改一个规则时，另两处可能保留旧语义；长 system prompt 也会降低领域工具 description 的相对显著性。

建议建立单一职责：

- agent prompt：身份、不可违背的全局职责、三类工具边界、最终回答风格；
- skill：排轴任务的详细操作流程与业务歧义处理；
- tool schema/result：该工具的前置条件、参数、失败码和下一允许动作；
- runtime state：仅注入本 turn 的动态事实与硬门；
- user message：保持用户原文，不混入测试或执行指导。

### P2：动态状态适合工程化插入，但当前形式需要规范化

checkout 切换发生在会话外部，旧 transcript 和静态 prompt 无法可靠表达其最新值，因此动态插入是必要的。适合插入的内容包括：

- host、axis binding 与 active checkout；
- `ready` / `checkout-changed` phase；
- observed checkout、workspace anchor 与 revision；
- `requiresRebind` 和唯一允许的恢复动作；
- context schema version、生成时间和事实来源。

这些内容应是机器生成的、短小的、结构化的、每 turn 重算的 system/context source，不应伪装成用户文本，也不应重复完整工作流。静态文字只需说明：“若 gate 为 X，遵循 state 中的 nextAction”；真正的 gate 继续由工具代码强制。

推荐最小形态：

```json
{
  "schemaVersion": 1,
  "host": "workbench",
  "axisId": "...",
  "checkout": { "nodeId": "...", "revision": 12 },
  "workspace": { "anchorNodeId": "...", "phase": "checkout-changed" },
  "gate": {
    "code": "checkout-rebind-required",
    "nextAction": { "tool": "def_node_bind", "args": { "nodeId": "" } }
  }
}
```

不要在这里加入“先 fork、再 edit、再 validate”之类稳定教程；那属于 skill。

### P2：工具面仍有迁移期近似能力，增加错误选择概率

底层 definitions 仍保留直接 current-checkout command、Patch DSL、copy staff line、checkout/restore compatibility 等能力。正式 OpenCode exposure 已通过 profile/permission 控制，这是安全基础；但健康度审查不能只看“51 项均已分类”，还应检查每个 host 实际暴露给模型的 tool set 是否最小化。

建议验收记录增加两份清单：Workbench provider-visible tools 与 AI CLI provider-visible tools。对 Workbench，legacy button command、Patch DSL 与直接 checkout 类工具应不可见或明确 deny，而不只是要求 prompt 不使用。

## 是否需要工程化插入辅助 prompt

结论是：**需要，但只需要工程化插入动态控制面；不需要工程化注入第二套完整 agent 教程。**

必要性来自四点：

1. checkout、revision、axis binding 会在 transcript 外变化；
2. session 恢复后 OpenCode session id 可变，但业务绑定必须延续；
3. compaction/长会话可能弱化早期状态；
4. 外部 UI 操作与 agent tool loop 并发时，必须在每 turn 开始重新建立事实基线。

不应依赖辅助 prompt 保证的内容包括：路径权限、CAS、approval、host agent 锁定、tool exposure 和 checkout 写入。这些必须继续由代码强制。

## 推荐落地顺序

1. 先修正黑盒 ingress：provider-visible user text 保持原文，并补充注入审计字段。
2. 定义版本化 `WorkbenchTurnState`，通过 OpenCode 的 system/context source 注入，不拼接到 user text。
3. 将 adapter agent prompt 与 timeline skill 去重，明确静态职责归属。
4. 为两个 host 导出并审计 provider-visible tool allowlist，移除迁移期近似工具的可见性。
5. 按 `docs/testing/def-agent-blackbox.md` 做弱提示矩阵：只读、明确 mutation、预览、应用、歧义、checkout 切换、长会话恢复、错误工具诱导；记录每 turn 时间、工具调用、状态变化和 prompt/state 版本。

## Spec 7 状态建议

不建议撤销 Spec 7 完成标记。上述问题属于完成后的健康度与测试可信度债务，不证明现有功能未完成。但在下一阶段宣称“agent 已稳定自然使用三类 typed tools”前，应先完成 P1 两项，尤其是去除黑盒入口的工作流提示污染。

