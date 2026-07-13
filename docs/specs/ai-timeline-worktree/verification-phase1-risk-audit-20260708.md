# def-opencode work node 第一阶段验收审计

日期：2026-07-08

## 审计结论

上一阶段可以按“appdata/localdata AI work node 安全底座”验收，但不能按“完整 tools-first 内部开发架构”验收。

已经完成的是：高风险主界面 AI 操作前可创建独立 appdata/localdata work node，节点包含 base/working payload、diff、riskFlags、checkoutDecision、commit、checkout、rollback 入口；低风险场景允许 AI 按 policy 自行 auto checkout；回退优先使用 work node 的 basePayload。

尚未完成的是：AI 在 work node 内部通过 typed tool / Patch DSL 修改 workingPayload 的主路径。当前高风险入口更多是“先立安全锚点，再让 agent 继续用现有 command queue 操作当前迁出态”，因此审计价值成立，但还不是完整的“先在节点里开发，验收后 checkout”。

## 存储边界核查

- `localStorage` / `sessionStorage`：仍是当前前端迁出态，也就是页面正在运行的工作副本。
- `now-storage.json`：Electron/REST 与浏览器当前状态同步位，不是 AI 分支日志。
- appdata/localdata work node：独立记录在 `ai-timeline-worknodes.json`，开发环境对应 `data/localdata`，Electron 生产环境对应 appdata/localdata。

本轮核查没有发现把 AI work node 当作 `localStorage/sessionStorage` 存储的实现。需要注意的是，代码中仍存在早期 `timelineWorktree/storage.ts` 的浏览器 localStorage 过渡模块；它只能视为 phase-0 checkout cache，不能被后续文档或代码继续描述为最终 work node。

## 完成度矩阵

| 目标 | 状态 | 验收说明 |
| --- | --- | --- |
| appdata/localdata 独立 work node | 已完成 | REST、Electron IPC、Electron bridge 均有 `ai-timeline-worknodes.json` 入口。 |
| create from current checkout | 已完成 | renderer 从当前迁出态读取 payload，创建 basePayload/workingPayload，不写用户 snapshot。 |
| diff/readiness/checkoutDecision | 已完成 | diff 基于 node base/working，不读取当前迁出态；decision 支持 auto/manual/blocked。 |
| low-blocking AI 自判审批 | 基础完成 | `auto-low-risk` 无 blocker 可 auto；manual / warning / blocker 会转入需要显式 approval 或 blocked。 |
| checkout/apply 到当前迁出态 | 已完成但有事务风险 | renderer 校验 workingPayload 后 apply，并尝试回写 checkoutApplied。apply 与回写不是事务。 |
| base rollback | 已完成但有事务风险 | renderer 使用 node basePayload 回退当前迁出态，并尝试回写 rollback log。 |
| 高风险入口 work node 优先 | 已完成 | AI 面板高风险请求会先创建 work node，失败则停止该高风险回合。 |
| 用户 snapshot 降级为兼容回退 | 已完成 | 有 nodeId 时回退优先 `restoreAiTimelineWorkNodeBase`。 |
| 每个存档 id 对应工作节点 | 部分完成 | 数据模型支持 saveId/branchId，但默认 saveId 仍是 `current-main-workbench`，尚未绑定真实存档 id。 |
| AI 在节点内修改 workingPayload | 未完成 | 已有 update API/client，但主界面 agent 没有把 Patch DSL/typed tool 作为主路径。 |
| tools-first 架构 | 部分完成 | work node op 已进 command schema；agent 仍靠 prompt 指导 HTTP/command queue，不是真正 typed tool 调用。 |
| 可视化 diff/审批面板 | 未完成 | 短期依赖日志、命令结果和文档验收。 |

## 风险点

### R1 高：work node 与后续业务命令不是事务链

高风险入口已先创建 work node，但 agent 后续仍可能直接投递当前迁出态命令，而不是更新 node.workingPayload。这样 work node 能提供 base rollback 和审计锚点，但不能完整记录每一步“节点内开发”的差异来源。

验收建议：上一阶段可接受为安全底座；第二阶段必须把 workingPayload patch/update 变成主路径。

### R2 高：缺少 Patch DSL / 代码型修改工具主路径

“发挥 AI 写代码能力”目前还没有落到受控 tool 形态。已有 `update` API 但缺少面向模型的结构化 patch 工具、路径白名单、风险分类、dry-run diff 和 verifier。

验收建议：第二阶段核心任务应是 `timeline.apply_patch` 或同等 Patch DSL。

### R3 中：saveId 默认值过粗

`createAiTimelineWorkNodeFromCurrent` 未收到 saveId 时使用 `current-main-workbench`。这不等同于“每个存档 id 对应一个工作节点，类似分支管理”。

验收建议：需要把当前真实存档 id 或迁出上下文 id 接入 create 命令。

### R4 中：审批有 policy，缺 UI

代码已有 `approvalPolicy` 和 `checkoutDecision`，AI 可以基于风险自判；但 manual approval 缺少明确 UI 面板，当前主要通过 command 参数和日志表达。

验收建议：低阻塞路径可以先验收；人工审批体验应进入第二阶段。

### R5 中：apply 与 appdata 回写非事务

checkout/rollback 会先 apply 当前迁出态，再回写 appdata 标记。如果回写失败，会返回 `checkoutMarkError` / `rollbackMarkError`，但当前迁出态已经被改变。

验收建议：需要补偿重试入口或 pending-applied 标记。

### R6 中：Electron 与 REST 有重复逻辑

Electron main 侧仍有 checkoutDecision / work node 存储逻辑的 CJS 复制版本，和 REST/renderer 共享 `.mjs` 版本存在漂移风险。

验收建议：后续抽共享模块或生成式桥接，减少双写。

### R7 中：agent 仍主要靠 prompt 调用命令

主界面 AI prompt 写明可用 op 和 HTTP enqueue 方式，这比录制回放好，但还不是 OpenCode 原生那种 typed tool contract。模型仍可能把 tool 协议当文本说明理解。

验收建议：第二阶段应把可编辑内容注册为 tools，并让策略/校验/审批绑定到 tool metadata。

### R8 中：仍有小型 regex quick action

`buildQuickWorkbenchAction` 仍会用正则把简单“添加技能按钮”转为本地命令，并拦截“任意 Buff”。这不是之前那种大规模录制流，但仍是模型意图层硬编码残留。

验收建议：可暂时保留为止血；tools-first 后应删除或降级成 UI 快捷入口，而不是 agent 主路径。

### R9 低：旧文档有 markdown 状态滞后

`def-opencode-main-workbench` 旧规格中关于前端 markdown 未统一的描述已经过期。当前主界面 AI 模式和 AiCliPage 已接入共享 `MarkdownRenderer`。

验收建议：不影响 work node 验收，但后续整理 specs 时应同步修正文档。

## 验收建议

建议将上一阶段验收口径定为：

> 通过“低阻塞 appdata work node 安全底座”验收；风险移交第二阶段 tools/work node patch 重构。

不建议将上一阶段验收为：

> 完整 def-opencode tools-first agent 架构已完成。

原因是安全边界已经立住，但 AI 的主要编辑能力还没有从“当前迁出态 command queue”迁移到“appdata work node 内部 patch/commit/checkout”。

