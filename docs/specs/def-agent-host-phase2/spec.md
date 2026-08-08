# DEF Agent Host 与 Browser ProductGateway Phase 2 Spec

## Status

已完成。

## Background

Phase 1 已建立引擎无关的 DEF 合同和 deterministic Fake Engine。本阶段恢复旧主分支中真正需要的产品接缝：Electron Shell 懒启动 Agent Host，系统浏览器打开 Slim 主工作台的隐藏“AI 模式”，浏览器继续持有唯一业务 SQLite 与唯一 writer，并通过 Browser ProductGateway 与 Host 交换 snapshot、command 和 result。

架构事实源：

- [OpenCode 引擎回迁、可替换 Agent 架构与完整生命周期调研（归档）](../../architecture/archive/opencode-engine-reintegration-research-20260806.md)
- [DEF Agent Core Phase 1](../def-agent-core-phase1/spec.md)

## Goal

本阶段完成：

- 建立可由 Electron `utilityProcess` 懒启动和有序停止的 `DefAgentHost`；
- 只通过现有 `31457/agent-host/**` 暴露浏览器协议，Host 私有服务使用随机 loopback 端口和随机宿主口令；
- 建立短时、一次性、绑定浏览器 origin 和 `workbench-ai-mode` audience 的 launch grant；
- 在 Slim 前端增加不出现在普通导航中的 `/timeline/ai` 隐藏路由；
- AI 模式页面交换 grant 后立即清理 URL，只把 UI capability 保存在当前标签 `sessionStorage`；
- 复用现有 Web Locks/BroadcastChannel，只有当前可见 writer 能注册唯一 Browser Workbench consumer；
- 建立浏览器 workspace identity、database generation、runtime snapshot binding 和 command journal；
- 恢复 `pullRemoteMainWorkbenchCommands`、`pushMainWorkbenchCommandResult`、`pushMainWorkbenchSnapshot` 三个远程接缝；
- 用 Fake Engine 和 Browser ProductGateway fixture 验证 Host 的文本、只读 Tool、Product command、result/reconcile 与 abort 闭环；
- 用测试专用 SQLite mutation fixture 证明 mutation、revision 与 committed receipt 在同一个 `webDatabase.batch` 事务提交；
- Shell 显示 Agent framework 状态并提供“打开 AI 模式”按钮。

## Product Outcome

本阶段交付后的真实产品状态：

- 用户从 Electron Shell 点击“打开 AI 模式”；
- 系统浏览器打开 Slim 主工作台，完整 Workbench/Canvas 仍在当前页面；
- 页面右侧显示 DEF Agent overlay，并能显示 Host、授权、writer、consumer 和 Engine 状态；
- 未从 Shell 打开的隐藏路由只显示“请从桌面 Shell 打开 AI 模式”，不会初始化数据库、抢 writer 或探测 Session；
- Fake Engine 只用于自动测试和 Host 合同验证，产品 UI 明确显示“引擎待接入”，不伪装成真实 AI；
- 普通 Slim、普通 Electron 工作台和 MCP 填表行为不变。

## Non-Goals

本阶段不做：

- 不打包或启动 OpenCode；
- 不实现 Pi；
- 不接 Provider、凭据、模型选择或真实聊天；
- 不恢复 AI CLI、Sidecar、旧 REST、`17321`、`17322`；
- 不让 Electron/Node 读取或写入业务 SQLite；
- 不把现有 29 类 Main Workbench mutation 暴露为 Agent Tool；
- 不实现最终 Ed25519 approval capability；
- 不实现完整 Session 管理 UI、历史 transcript UI 或 Harness；
- 不让 Service Worker 缓存 `/agent-host/**`；
- 不新增浏览器可直接访问的固定 Agent 端口。

## Runtime Topology

```text
Electron Shell
  ├─ 31457 static host / browser bridge
  ├─ Legacy Fill MCP utilityProcess（保持隔离）
  └─ DefAgentHost utilityProcess（点击 AI 模式后懒启动）
       ├─ private random loopback port
       ├─ random host token
       ├─ launch grant / UI capability
       ├─ Browser consumer registry
       └─ ProductGateway command queue / reconciliation

System Browser / Slim LTS
  ├─ Web Locks writer
  ├─ Browser SQLite / OPFS（唯一业务事实源）
  ├─ WorkbenchFrame + CanvasBoard
  ├─ hidden AI mode overlay
  └─ Browser ProductGateway executor
```

Electron SHALL 只做进程管理、grant 发起、静态桥接和打开系统浏览器。Host、浏览器协议和 ProductGateway 合同不得依赖 Electron IPC。

## Agent Host Contract

`DefAgentHost` 至少管理：

- protocol/runtime health；
- launch grant exchange；
- UI capability validation；
- 单一 Browser Workbench consumer；
- consumer heartbeat 和失效；
- 当前 Product snapshot；
- Product command queue、result 和 reconcile；
- Fake Engine 注入后的 Session/Turn/event loop；
- stop、consumer lost 和 Host shutdown 的有序 abort。

Host 首版整个 `workbench` 只允许一个 active Turn。没有合法 consumer 时不得创建产品绑定 Session、不得分发 command。

## Launch Grant And Capability

启动顺序固定为：

1. Shell 去重“打开 AI 模式”点击；
2. 懒启动或复用健康的 DefAgentHost；
3. Electron 生成随机 launch grant，并通过私有 Host API 注册其 hash、origin、audience 和 expiry；
4. grant 只放在 `#/timeline/ai?...` 的 fragment；
5. 页面捕获 grant，立即从 URL 删除；
6. 页面向 `POST /agent-host/ui/session` 交换 UI capability；
7. grant 无论成功或失败都只能消费一次；
8. capability 只存当前标签 `sessionStorage`，不得进入 localStorage、日志或 query string；
9. 页面取得 writer 后才能注册 consumer；
10. capability、consumer 或 writer 任一失效时，停止领取新 command。

TTL 初值：launch grant 30 秒、UI capability 8 小时、consumer heartbeat 15 秒。具体数值可配置，单次、绑定和 fail-closed 语义不可改变。

## Browser Route And Writer Rules

- 隐藏路由固定为 `/timeline/ai`，用户可见名称固定为“AI 模式”；
- 普通导航、线上网页和 Shell 的“打开浏览器工作台”不显示 AI 入口；
- 无 grant 且无当前标签 capability 时，WebBootstrap 在数据库初始化和 `workspaceLease.start()` 之前返回授权提示页；
- 有授权时先交换 capability，再沿现有 `requestControl()` 流程取得 writer；
- 只有 `document.visibilityState === "visible"` 且 `workspaceLease.getRole() === "writer"` 的页面可注册或续约 consumer；
- writer 丢失、页面隐藏、退出 AI 模式或标签卸载时注销 consumer；
- 页面刷新可复用当前标签 capability，重新取得 writer、注册 consumer 和对账；Host 重启导致 capability 无效时必须回 Shell 重新打开。

## Browser Workspace Identity

浏览器业务库 SHALL 保存：

- `workspaceId`：数据库谱系 ID；
- `databaseGeneration`：当前整库世代；
- `agentRuntimeSchemaVersion`；
- command journal schema version。

每份 runtime snapshot SHALL 包含：

- `workspaceId`；
- `databaseGeneration`；
- `timelineId`；
- checkout target/updatedAt；
- `contentRevision`；
- canonical `snapshotDigest`；
- capturedAt；
- Main Workbench snapshot payload。

尚未创建具体排轴时，选择工作区使用稳定的 `workspace-selection` 哨兵 `timelineId`；一旦进入真实排轴，consumer 必须关闭旧绑定并以真实 `timelineId` 重新注册，不允许用空字符串绕过绑定合同。

本阶段负责首次创建并稳定读取 identity；数据库整库导入/恢复时的 generation 轮换必须有明确 hook 和合同测试，不允许旧 command 静默跨 generation 使用。

## Product Command Journal

浏览器 SQLite command journal 至少保存：

- `commandId`、schema version、operation；
- workspace/generation/timeline/checkout/revision/digest binding；
- `queued/dispatched/claimed/committed/succeeded/not-executed/rejected/conflict/error/orphaned`；
- executor lease ID；
- before/after revision；
- browser result、visible postcondition、receipt digest；
- claimed/completed timestamps。

规则：

- 相同 `commandId` 重复领取只返回已有状态，不创建第二次执行；
- binding 不一致返回 typed conflict；
- generation 不一致返回 orphaned；
- read-only command 可以安全重取新 snapshot 后重试；
- mutation timeout 不得自动重发，只能按原 `commandId` reconcile；
- 本阶段生产只分发只读或 UI-safe command；
- 测试专用 mutation fixture 必须把 fixture state、revision 和 committed receipt 放入同一个 `webDatabase.batch`；
- 现有复杂 mutation 在完成逐命令原子事务改造前保持不可达。

## Browser Bridge Routes

本阶段最小路由：

```text
GET  /agent-host/health
POST /agent-host/ui/session
GET  /agent-host/ui/state

POST /agent-host/workbench/register
POST /agent-host/workbench/heartbeat
POST /agent-host/workbench/close
POST /agent-host/workbench/snapshot
GET  /agent-host/workbench/commands/next
POST /agent-host/workbench/commands/:id/result
GET  /agent-host/workbench/commands/:id
```

除 `health` 和 grant exchange 外全部要求 scoped UI capability。所有响应 `Cache-Control: no-store`，严格校验 browser origin，不允许 `*` CORS。

## Restored Main Workbench Seams

- `pullRemoteMainWorkbenchCommands`：仅在授权 AI 模式、可见 writer 和已注册 consumer 下长轮询/领取命令，验证 schema/binding 后写入现有页面本地 command queue；
- `pushMainWorkbenchCommandResult`：先写浏览器 command journal，再把 typed result 回送 Host；
- `pushMainWorkbenchSnapshot`：构造带 workspace/generation/revision/digest 的 runtime snapshot 并发布 Host；
- 普通页面调用三者时立即 no-op，不发请求、不创建 identity；
- 本阶段 Host 只允许 `refreshSnapshot` 等明确白名单只读/UI-safe operation 进入现有消费者。

## Shell UX

Shell SHALL：

- 显示 `未启动 / 正在启动 / framework ready / engine pending / error`；
- 提供“打开 AI 模式”按钮；
- 点击期间禁用重复操作并复用同一个启动 Promise；
- Agent 失败不影响普通浏览器工作台、MCP 和发包工具；
- 完全退出顺序包含停止 Agent Host，并验证无残留子进程。

## Source Boundary

允许新增：

```text
agent/host/**
agent/runtime/**
src/platform/agent/**
src/components/AgentMode/**
electron/agent-runtime.cjs
scripts/build-agent-runtime.mjs
```

依赖方向：

```text
Agent Host → agent/core contracts
Agent Host → injected AgentEngine
Browser Agent bridge → core wire types / browser database / existing Main Workbench seams
Electron supervisor → built Host runtime only
```

禁止：

- `agent/**` import `src/**`、Electron、React 或浏览器数据库；
- `src/**` import Electron 或 Engine SDK；
- Electron import业务 handler；
- Host 直接访问浏览器 SQLite；
- Agent 与 Legacy Fill MCP 共用 capability、进程、数据库或固定端口。

## Required Verification

自动测试至少覆盖：

1. Host health、lazy start、重复 start、stop 和 crash state；
2. launch grant 单次、过期、origin/audience 绑定和 URL 清理；
3. 无授权 AI 路由不启动 workspace；
4. UI capability 只存 sessionStorage；
5. writer/visibility/consumer register、heartbeat、close 和失效；
6. snapshot binding 与 digest；
7. command duplicate、conflict、generation orphaned、result 和 reconcile；
8. 三个 remote seam 在普通页面 no-op、AI 页面恢复；
9. Fake Engine 的文本、Tool、ProductGateway result、terminal 和 abort Host 闭环；
10. test-only SQLite mutation fixture 的业务值、revision、receipt 同事务；
11. `/agent-host/**` no-store、origin/capability 和未知路由拒绝；
12. Electron Shell AI 状态、入口、utilityProcess 生命周期和退出回收；
13. 旧 AI CLI/Sidecar/固定端口/Node 业务 SQLite 仍不可回归；
14. 普通 Slim、MCP、发包和现有主工作台测试不回归。

## Acceptance

以下条件全部满足才完成 Phase 2：

- Shell 可懒启动 Host 并打开带一次性 grant 的 AI 模式；
- 无 grant 页面 fail closed，合法页面持有唯一 writer/consumer；
- 浏览器仍是唯一业务库和 ProductGateway executor；
- 三个 remote no-op 已恢复为受 capability 与页面状态约束的桥；
- Host + Fake Engine + Browser ProductGateway 合同测试通过；
- command journal 可按原 `commandId` 对账；
- 产品 mutation 白名单仍为空，测试 fixture 不可从生产 UI/Host 调用；
- `npm run check` 与 `npm run electron:check` 通过；
- 独立审查无 P0/P1；
- 没有 OpenCode/Pi、AI CLI、旧 REST、Node 业务 SQLite 或普通 Slim 行为回归。
