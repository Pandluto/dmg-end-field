# def-opencode Tools / Work Node 第二阶段 Spec

## Status

草案中。

本 spec 记录 2026-07-08 这轮架构讨论结论，用于开启 def-opencode 主界面 agent 的第二阶段重构。它不是具体实现 tasks，不拆分开发步骤。

本轮已完成前端 markdown 适配：AI CLI 页面和主界面右侧 AI 面板的 agent 回复已统一走共享 Markdown renderer。第二阶段不再把 markdown 展示作为核心架构问题。

## 背景

当前 def-opencode 主界面链路已经从“录制回放式本地流”推进到更接近 agent 的结构：

- OpenCode adapter 已收窄权限，禁止 shell/read/edit/task/websearch 等能力。
- 主界面操作通过本地 REST 投递声明式 command queue。
- 浏览器主界面作为事实源，消费 command queue 并调用现有 React/service/storage 逻辑。
- REST 层已有 op 白名单、基础 schema 校验、batch/result/snapshot 记录。
- appdata/localdata AI work node 已具备 basePayload、workingPayload、diff、checkoutDecision、commit、checkout 和 rollback 的底层骨架。

但当前主界面 agent 仍有两个关键中间态问题：

1. workbench 操作主要还是 prompt 指挥模型用 webfetch 手写 HTTP JSON，而不是 OpenCode 原生/近原生 typed tools。
2. AI work node 已有底座，但缺少让模型安全修改 workingPayload 的工具层；它目前更多作为高风险操作前的 base rollback / 审计锚点，而不是完整的“隔离节点内部开发”主路径。

因此第二阶段需要从“prompt 教模型调 REST”转向“工具协议承载动作”，并把“AI 写代码能力”落成一种受控的领域 patch tool。

## 核心判断

多做 tools 是正确方向，是主流 agent 架构的交互方式。

“发挥 AI 写代码能力”不应理解成让模型无限制读写项目文件、localStorage 或完整 workingPayload JSON。它应被建模为一种 tool：

```text
AI 在受控 work node 中生成领域 patch
  -> 系统应用 patch 到 workingPayload
  -> validator 校验 payload
  -> diff / risk / checkoutDecision 生成证据
  -> policy 决定 auto approval 或 user confirmation
  -> checkout/apply 到当前主界面迁出态
```

也就是说，写代码能力不是 agent 架构之外的自由通道，而是 tools 体系中的一种高级工具形态。

## Goal

第二阶段目标是把 def-opencode 主界面 agent 重构为 tools-first 架构：

- 所有可编辑主界面能力都应注册为 typed tools 或等价的结构化工具协议。
- work node 内部开发成为复杂/高风险排轴修改的主路径。
- 模型不再需要知道主界面 REST URL、HTTP body 和 batch endpoint 细节。
- prompt 只负责意图和策略提示；执行协议、验收、审批、回滚由 tool policy 和 verifier 兜底。
- 不同 tools 拥有不同的风险等级、验收标准、审批策略和回滚要求。

## Non-Goals

第二阶段不做：

- 不让 def-opencode 恢复 shell、read、edit、grep、glob、task、websearch 等通用 coding agent 权限。
- 不让模型直接修改项目源码来完成主界面业务操作。
- 不让模型直接写浏览器 localStorage/sessionStorage 作为业务真相。
- 不让模型直接写完整 workingPayload 大 JSON 作为常规路径。
- 不把 DOM 点击、拖拽或键盘模拟作为主界面 agent 操作方式。
- 不用正则和固定对象恢复录制回放式本地流。

## Architecture Direction

### Tools First

当前 prompt 中关于 REST endpoint、op 列表、batch 轮询、snapshot 核对的协议知识应逐步下沉到工具层。

目标心智模型：

```text
用户自然语言
  -> model 选择 typed tool / work node patch tool
  -> tool runtime 校验参数与 policy
  -> browser/work node executor 执行
  -> evidence verifier 验收
  -> model 基于 verified result 回复
```

模型可以选择工具和填写参数，但不能只靠模型自证工具完成。系统必须返回结构化 result、evidence、verification。

### Current Checkout Tools

当前迁出态的直接编辑能力应形成 typed tools，包括但不限于：

- readSnapshot / readEvidence
- selectCharacters
- setOperatorWeapon
- setOperatorEquipment
- refreshOperatorConfig
- addSkillButton
- removeSkillButton
- moveSkillButton
- addBuff
- removeBuff
- setTargetResistance
- calculateDamage
- refreshSnapshot

这些 tools 适合低风险、小步、用户明确要求立即作用到当前主界面的操作。

### Work Node Development Tools

复杂、批量或高风险排轴修改应优先进入 work node 内部开发工具链：

- createTimelineWorkNode
- readTimelineWorkNode
- patchTimelineWorkNode
- validateTimelineWorkNode
- diffTimelineWorkNode
- commitTimelineWorkNode
- checkoutTimelineWorkNode
- rollbackTimelineWorkNode

这条链路用于发挥模型“像写代码一样重构排轴”的能力，但实际写入对象是 appdata/localdata work node 的 workingPayload，不是真实主界面状态。

## Patch DSL

`patchTimelineWorkNode` 不应接受任意完整 workingPayload 作为常规输入。

推荐输入是领域 patch DSL，例如：

```json
[
  {
    "op": "addButton",
    "characterName": "莱万汀",
    "skillType": "A",
    "position": { "staffIndex": 0, "nodeIndex": 2 }
  },
  {
    "op": "attachBuff",
    "target": { "characterName": "莱万汀", "skillType": "A" },
    "buffId": "example-buff-id"
  }
]
```

Patch DSL 的目的：

- 让模型表达复杂修改意图。
- 让代码负责定位、补默认值、应用变更、校验引用和生成错误。
- 避免模型全量重写 payload 时破坏隐含字段。
- 让 diff、riskFlags、approval 和回滚可解释。

Patch op 应优先覆盖：

- addButton
- removeButton
- moveButton
- attachBuff
- removeBuff
- setTargetResistance
- setOperatorWeapon
- setOperatorEquipment
- replaceSelectedCharacters
- clearTimeline

## Tool Policy

不同 tools 必须有不同验收和审批策略。AI 可以参与风险判断、解释和建议，但最终必须由代码里的 tool policy 与 evidence verifier 兜底。

建议抽象：

```ts
type ToolPolicy = {
  riskLevel: 'read' | 'low' | 'medium' | 'high';
  approval: 'none' | 'auto' | 'ai-review' | 'user-confirm';
  verification: 'schema' | 'snapshot' | 'diff' | 'damage-report';
  rollback: 'none' | 'optional' | 'required';
};
```

示例策略：

```text
readSnapshot
  risk: read
  approval: none
  verification: schema + timestamp
  rollback: none

addSkillButton / addBuff / removeBuff
  risk: low | medium
  approval: auto by default
  verification: command done + snapshot target changed
  rollback: optional

clearTimeline / replaceTeam / batchEdit
  risk: high
  approval: create work node first; user-confirm when diff/risk requires
  verification: validator + diff + snapshot
  rollback: required

patchTimelineWorkNode
  risk: medium | high
  approval: AI may propose and self-review; checkout still follows checkoutDecision
  verification: payload validator + diff matches goal + no blocker
  rollback: basePayload required

checkoutTimelineWorkNode
  risk: high
  approval: checkoutDecision controls auto/manual/blocked
  verification: current checkout payload equals committed/applied payload or diff summary matches
  rollback: restore base
```

## Approval Model

“由 AI 自己决策”只能表示 AI 可以判断工具选择、风险说明和建议是否继续；不能表示 AI 是唯一裁决者。

系统 SHALL 强制：

- 每个 tool 有最低验收标准。
- 高风险 tool 有明确 rollback 资产。
- checkout 类 tool 必须经过 checkoutDecision。
- blocker 风险默认阻断 auto checkout。
- manual policy 需要显式用户或系统授权。
- AI 的 approval rationale 必须写入 commit/result，作为审计证据。

AI MAY：

- 选择更合适的 tool。
- 给出风险评估。
- 在 auto-low-risk 策略允许时继续。
- 在需要用户确认时总结 diff 和风险。

AI MUST NOT：

- 只因为自己认为完成就跳过 verifier。
- 在无 evidence 时声称完成。
- 用自然语言绕过 tool policy。
- 把 enqueue 成功当作执行成功。

## Relation to Existing Work Node

现有 AI work node 已完成的重要底座：

- appdata/localdata 存储。
- create/get/update/commit。
- diff/readiness。
- checkoutDecision。
- renderer checkout/apply。
- renderer base rollback。
- 高风险入口优先创建 work node。

第二阶段要补的是主路径能力：

```text
create work node
  -> read node
  -> patch workingPayload through DSL
  -> validate
  -> diff / risk / checkoutDecision
  -> commit
  -> checkout/apply
```

也就是从“work node 作为安全点”升级为“work node 作为 AI 内部开发工作区”。

## Hardcoding Boundary

第二阶段继续保持此前结论：

应该硬编码：

- tool schema
- permission
- policy
- verifier
- rollback
- diff/risk rules
- executor boundary

不应该硬编码：

- 用户意图到固定业务对象的映射
- 固定角色/武器/装备/按钮脚本
- 前端正则录制流
- 模型应该自己完成的计划和对象选择

判断标准：

```text
换模型后仍必须一样 -> 基础设施，硬编码。
换用户/数据后应该自然变化 -> 模型或 tool 参数，不写死。
```

## Frontend Markdown Note

本轮前端 markdown 适配已完成，不作为第二阶段架构阻塞项。

完成内容：

- 新增共享 MarkdownRenderer。
- AI CLI 页面复用共享 renderer。
- 主界面右侧 AI 面板的后台回复走 markdown 渲染。
- 清理旧 markdown table 样式尾巴。

后续 UI 仍可继续优化 diff/approval 审核面板，但 markdown 展示不再作为第二阶段 tools/work node 重构的核心问题。
