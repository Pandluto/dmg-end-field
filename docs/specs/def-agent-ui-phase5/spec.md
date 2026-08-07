# DEF Agent Product API and Slim AI Mode Phase 5 Spec

## Status

Implemented; two external validation gates remain.

## Goal

把已经接入真实 OpenCode 的 `DefAgentHost` 开放为 DEF 自己拥有的产品协议，并把 `/timeline/ai` 上的状态占位面板升级为可实际对话的 Slim React AI 模式。

本阶段只完成五业务只读闭环：用户在当前 Slim Workbench 中创建会话、发送消息、观察 DEF Event Journal、看到 Tool 过程、停止当前 Turn。产品 UI 不读取 OpenCode Session、消息或事件，不恢复 AI CLI、旧 REST、旧 OpenCode Web UI、旧 Node SQLite 或第二份业务数据源。

## Product boundary

- 唯一入口仍是 Electron Shell 的“打开 AI 模式”；隐藏路由只是这一入口的实现。
- AI 模式继续挂载完整 `WorkbenchFrame`，当前标签仍是浏览器 SQLite/OPFS 的唯一 writer 与 BrowserWorkbench consumer。
- Electron 只代理 `/agent-host/**`，浏览器只持有当前标签的 `AgentUiCapability`。
- Session、Turn 和 Event 的权威状态位于 `DefAgentHost`；OpenCode 只存在于 `AgentEngine` 适配器内部。
- 本阶段 Session/Event 仍是 Host 进程内状态。Host 重启后的持久化恢复、归档与历史迁移留给后续阶段，不在 UI 中伪装为已支持。
- Question、Approval、mutation、会话删除/归档、Provider 凭据编辑不属于本阶段。

## Product HTTP API

以下浏览器 API 全部要求有效的 `AgentUiCapability`、固定 browser origin 和已注册的可见 writer consumer。

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/agent-host/sessions` | 返回与当前 `workspaceId + databaseGeneration + timelineId` 绑定的 DEF Sessions |
| `POST` | `/agent-host/sessions` | 从当前 consumer binding 创建 Session；浏览器不得自行提交 binding |
| `GET` | `/agent-host/sessions/:defSessionId` | 返回 Session metadata；错误 binding 返回 typed conflict |
| `GET` | `/agent-host/sessions/:defSessionId/events?afterSequence=N` | 返回严格递增、有限大小的 DEF Event Journal 增量及 next cursor |
| `POST` | `/agent-host/sessions/:defSessionId/turns` | 使用 Harness 启动一轮只读 Turn |
| `POST` | `/agent-host/turns/:defTurnId/abort` | 幂等停止当前 Turn |

规则：

- `POST /sessions` 只接受可选 `providerProfileRef`，首版默认 `default`；不接受 engine kind、OpenCode ID 或 ProductBinding。
- `POST /turns` 只接受 `userMessage` 与 `clientTurnId`；消息 trim 后必须为 1–16,000 字符，ID 必须通过 branded ID parser。
- 同一 Session 同时只允许一个 active Turn；整个 Host 仍只允许一个 active Turn。
- `clientTurnId` 是调用方重试键：相同 Session、相同消息返回原 `defTurnId`；相同 ID 配不同消息返回 `409`。
- `turn.accepted` 事件记录原始用户消息，使 transcript 完全由 Event Journal 投影，不由 React 维护第二份权威聊天记录。
- Event feed 使用 cursor JSON polling，不在本阶段暴露 SSE。Electron 代理仍会缓冲响应；在实现真正流式代理前不得伪装 SSE。
- Event 响应每次最多 256 条、JSON 总体受 Host 响应边界限制；非法或超前 cursor 返回 typed request error。
- Session API 永远不返回 provider secret、Host token、OpenCode URL、engine authorization、内部路径或 raw provider error。

## Host model additions

`DefAgentHost` 增加只读产品查询，不把内部 Map 暴露给 HTTP 层：

- `listSessions(binding)`；
- `readSession(defSessionId, binding)`；
- `readEvents(defSessionId, afterSequence, limit)`；
- client Turn correlation / retry lookup；
- active Turn 与 terminal 查询所需的稳定 metadata。

Session 必须精确匹配当前 consumer 的 `workspaceId`、`databaseGeneration` 与 `timelineId`。checkout/revision 可以在两轮之间变化，但新 Turn 启动前仍由 Browser snapshot/consumer binding 提供当前产品上下文；不允许跨 Timeline 静默复用 Session。

## Slim React AI mode

现有 `AgentModeOverlay` 改为右侧工作面板，保留 Workbench 可见：

- 顶部：Host/Engine readiness、当前 Timeline/checkout 简要绑定、新建会话；
- 主区：由 Event Journal 投影的用户消息、assistant 增量、Tool requested/started/result/error 和 Turn terminal；
- 底部：多行输入、发送、停止；active Turn 时不允许发送第二条消息；
- 首次进入：consumer/binding/engine 均 ready 后，若当前 Timeline 没有 Session，显示明确“新建会话”；不自动伪造会话；
- 发送后立即以 Host 返回的 `turn.accepted` 为准，React 不预写“已发送成功”；网络不确定时用同一 `clientTurnId` 重试；
- Event polling 在页面隐藏、授权失效、consumer 丢失或组件卸载时停止；恢复后从最后 sequence 继续；
- response delta 按同一 `defTurnId` 合并；Tool 卡按 `toolCallId` 合并；一个 Turn 只显示一个 terminal；
- Markdown 仅用于 assistant 最终/累积文本，禁止 raw HTML；Tool input/result 默认折叠，避免大对象压垮布局；
- engine unavailable、无 consumer、无 binding、Session conflict 和 Turn failure 都显示可理解的中文状态，不显示“引擎待接入”。

## Explicit exclusions

- 不增加 `/AI CLI`、`/def-agent/chat*`、`/api/chat*` 或普通 Web 导航入口。
- 不让浏览器访问 OpenCode server、Session、provider API 或 plugin bridge。
- 不恢复旧 OpenCode UI assets、SolidJS UI、Sidecar、`17321/17322`、Node Timeline/Work Node SQLite。
- 不实现 SSE、WebSocket、跨 Host 重启恢复、会话持久化、会话管理器、Question、Approval 或写 Tool。
- 不借本阶段修改伤害计算、Timeline、Buff、装备、武器或角色业务逻辑。

## Tests

1. Host 合同：capability/origin/consumer/binding、Session create/list/read、Event cursor/limit、Turn start/abort、clientTurnId retry/conflict。
2. Event 投影：用户消息、assistant delta、Tool lifecycle、failure/stop/completed 恰好一次且 sequence 单调。
3. Browser bridge：请求路径、capability header、typed response validation、401/403 清授权、请求体不含 binding/engine private fields。
4. React model：Events → transcript/tool cards/terminal 的纯函数测试，不依赖 DOM 截图证明语义。
5. Fake Engine 纵向测试：UI 使用同一桥合同完成 create → send → events → terminal → second turn → abort。
6. 真实 OpenCode 纵向测试：至少一条 calculation 路线通过新 Product HTTP API，最终中文文本来自 Event Journal。
7. 回归：`npm run check`、Electron supervisor、package boundary、普通 Slim route、MCP 与 Browser SQLite 不回归。

## Acceptance

- 用户从 Shell 打开 `/timeline/ai` 后，可以在 Slim Workbench 内创建真实 DEF Session 并完成五业务只读对话。
- UI 的所有消息、Tool 与终态都能从 Host Event Journal 重建；刷新 React state 不产生第二份聊天事实。
- 发送、停止、网络重试和 active Turn 冲突有确定语义；同一 `clientTurnId` 不创建第二轮。
- 浏览器 bundle 和网络请求中没有 OpenCode 私有协议或 secret。
- 普通 Web LTS 不显示入口，不依赖 Agent 才能运行。
- AI CLI 和旧 AI 栈继续保持退役。
- 自动测试、真实 OpenCode HTTP 纵向黑盒和独立审查无未关闭 P0/P1。
