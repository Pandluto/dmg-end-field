# ADR-0008：AI 模式复用原生 OpenCode UI

- Status: Accepted
- Recorded: 2026-08-07
- Supersedes: 调研报告中“另建 Slim React Agent UI”的产品 UI 结论

## Context

Slim React 自研聊天层需要重新实现消息流、推理、工具调用顺序、停止、重试和会话状态。实际使用证明这套重复实现的信息密度和可读性都不如原生 OpenCode UI，也形成了第二套 transcript 投影。

旧 DEF 分支已经基于 OpenCode `v1.17.11` 构建过完整 UI。当前 OpenCode Engine 仍锁定在同一版本，因此可以复用该静态产物，同时保留新 Host、Harness、ProductBinding 和浏览器 SQLite 边界。

## Decision

主工作台的 AI 模式只负责宿主版本锁定的 OpenCode UI iframe，不再自行渲染聊天消息、推理过程或工具卡。

- UI 与 Engine 同锁 OpenCode `v1.17.11`；构建时校验文件数、总字节数和整树 SHA-256。
- Browser 只拿到短期、绑定当前可见 Workbench consumer 的原生 UI 网关地址；不拿 OpenCode 私有端口或密码。
- 原生 UI 的读取请求由网关转发给 OpenCode；Session 列表按当前 ProductBinding 过滤。
- 网关保持 OpenCode 启动所需的 `/global/config` 读取和 `x-next-cursor` 分页协议；工具阶段很多的旧会话重新打开后也必须自动补齐到可见的用户消息。
- 原生 prompt、stop、建会话和删会话先进入 DEF Host。prompt 继续经过 Harness 和 typed tool 路由，不能旁路产品门禁。
- 原生 UI 创建的 optimistic `messageID` 原样交给 Engine，避免同一用户消息重复显示。
- AI CLI、旧 chat API、Node SQLite、通用终端和 OpenCode 管理入口继续保持退役。
- Question/Approval 的产品授权仍由 DEF Host 持有；其原生卡片适配可以独立演进，不能因此恢复 OpenCode 的直接产品写权限。

## Consequences

用户重新获得 OpenCode 原生会话流和严格按发生顺序排列的工具记录，不再维护第二套聊天 UI。代价是桌面包增加约 29 MB 的锁定静态资源，并需要维护一个窄的 OpenCode HTTP/SSE 兼容网关。未来更换 Pi 时，产品 Host/Harness/Tool 合同不变；UI 是否继续复用 OpenCode，需要作为独立产品决定，不能与 Engine 更换绑成一次重写。

## Evidence

- `agent/engines/opencode/native-ui-lock.json`
- `agent/host/opencode-native-ui-gateway.ts`
- `src/components/AgentMode/AgentModeOverlay.tsx`
- `agent/host/opencode-native-ui-gateway.test.ts`
- 2026-08-07 Mac 桌面实测：一条只读问题在原生会话中依次显示 `def_harness_route`、`def_node_crud_current`，随后显示最终回答，且用户消息没有重复；重启 Host 后同一会话的历史消息和工具顺序完整恢复。
