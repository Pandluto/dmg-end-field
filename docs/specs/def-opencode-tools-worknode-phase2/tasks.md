# def-opencode tools + work node 第二阶段 tasks

## Status

第二阶段目标：把上一阶段的 appdata/localdata work node 安全底座，升级为低阻塞、AI 可自判审批、以 typed tools 为主入口的 def-opencode 架构。

本阶段必须保持一个边界：`localStorage` / `sessionStorage` 是当前迁出态；appdata/localdata work node 才是本地工作节点。二者不能在命名、文档或实现里混用。

## Task 1: 固化上一阶段验收口径

- 接受上一阶段为“appdata/localdata work node 安全底座”。
- 不把上一阶段描述为完整 tools-first agent 架构。
- 将未完成项转入第二阶段风险清单。

验收：

- 有独立审计文档列出完成项、偏差和风险。
- 文档明确 `localStorage/sessionStorage` 只是当前迁出态。

## Task 2: 定义主界面可编辑内容 tools registry

- 把角色选择、装备、武器、技能按钮、Buff、抗性、排轴 checkout/rollback 等可编辑内容注册成 tools。
- 每个 tool 声明输入 schema、读写范围、风险等级、审批策略、验证器和回滚语义。
- 删除“靠 prompt 记住 op 列表”的主路径依赖。

验收：

- agent 可从工具元数据知道哪些内容可读、可写、如何校验。
- 同类编辑不再散落在 prompt 文案、REST adapter 和 renderer 分支里。

## Task 3: 设计 work node Patch DSL

- 将“AI 写代码能力”建模为受控 patch tool，而不是任意写 JSON 或任意执行 JS。
- Patch DSL 必须支持 dry-run、diff、validator、riskFlags。
- Patch DSL 必须限制路径和操作类型，删除/覆盖类操作不得模糊 fallback。

验收：

- AI 可以对 node.workingPayload 生成 patch。
- 系统可以在不写当前迁出态的情况下预览 diff 和风险。
- patch 失败不会污染 current checkout。

## Task 4: 打通 node 内部开发主路径

- 高风险请求流程改为：create work node -> patch workingPayload -> diff/risk/checkoutDecision -> checkout/apply。
- agent 后续业务编辑默认写 node.workingPayload，不直接写 current checkout。
- current checkout 只在 checkout/rollback 阶段被 renderer apply。

验收：

- work node logs 能解释 AI 修改了什么、为什么能 auto 或为什么需要 manual。
- 高风险操作的最终 diff 来自 node base/working，而不是事后对当前迁出态猜测。

## Task 5: 完善低阻塞审批策略

- 不同 tools 使用不同 approval policy。
- AI 可以自判低风险继续，但必须把理由写入 checkoutDecision / approval log。
- blocker 不应被 auto approval 绕过；manual 不应被描述为系统错误。
- 审批策略应支持“建议确认但不强制拦截”的 warning 层。

验收：

- 每个 tool 的 auto/manual/blocked 行为可解释、可复现。
- 用户能从日志看到 AI 为什么自行继续或为什么请求确认。

## Task 6: 绑定真实 saveId / branchId

- create work node 时使用当前真实存档 id 或迁出上下文 id。
- branchId 表示一次 AI 独立尝试。
- 避免长期使用 `current-main-workbench` 作为所有节点的默认 saveId。

验收：

- 每个存档 id 下能区分多个 AI branch。
- 不同存档的 work node 不会混在同一个粗粒度桶里。

## Task 7: 补齐 diff/审批 UI

- UI 展示 work node diff、riskFlags、checkoutDecision 和 commit/rollback 状态。
- manual approval 入口应低阻塞，不把 warning 一律做成硬拦截。
- 历史消息回退继续优先使用 work node basePayload。

验收：

- 用户可以验收 AI 的自判理由。
- 用户可以对需要确认的节点执行 approve/checkout 或 rollback。

## Task 8: 收敛旧 command queue 与 quick action

- 将现有 command queue 降级为兼容执行层，主路径迁移到 tools registry。
- 评估并删除 `buildQuickWorkbenchAction` 这类意图层 regex 快捷逻辑，或改成非 agent 主路径的 UI 快捷入口。
- 保留必要安全止血，例如任意 Buff 不允许自动添加。

验收：

- 模型意图理解主要由模型完成，代码只负责工具边界、安全策略、验证和执行。
- 产品代码不再混入录制回放式固定流程。

## Task 9: 减少 Electron/REST 双写漂移

- 将 checkoutDecision、diff、validator、work node 存储规则尽量抽成共享模块。
- Electron CJS 边界如暂时无法共享，应增加同步检查或明确生成来源。

验收：

- REST、Electron、renderer 对同一 work node 的 decision 结果一致。
- 关键安全规则不需要维护三份。

## Task 10: 事务与补偿机制

- checkout/rollback apply 与 appdata 回写之间增加补偿状态。
- 对 `checkoutMarkError` / `rollbackMarkError` 提供重试或修复入口。
- 日志中区分“当前迁出态已变更但节点标记失败”和“完全未应用”。

验收：

- apply 后回写失败不会让用户误判状态。
- 下一次启动可以识别并修复半应用节点。

