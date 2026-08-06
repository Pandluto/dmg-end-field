# DEF Agent Core Phase 1 Spec

## Status

已实现并验收（2026-08-06）。

## Background

架构调研已经确定：Slim LTS 浏览器前端和浏览器 SQLite/OPFS 保持唯一产品与业务事实源；Electron Shell 未来只懒启动本地 Agent；OpenCode 是第一套可替换 Engine，Pi 在同一合同稳定后再接入。

本阶段是正式施工的第一块地基，只实现引擎无关的 DEF 核心合同和确定性 Fake Engine。架构事实源：

- [OpenCode 引擎回迁、可替换 Agent 架构与完整生命周期调研](../../architecture/audits/opencode-engine-reintegration-research-20260806.md)

旧仓库边界当前禁止整个 `agent/` 目录回归。本阶段 SHALL 将其改为精确白名单：允许本规格新增的纯核心文件，继续拒绝旧 AI CLI、Sidecar、REST、Node 业务 SQLite、OpenCode vendor/runtime 和未审计 Agent 文件。

## Goal

本阶段完成：

- 建立稳定、引擎无关的 ID、Session、Turn、Event、Interaction 和 Product 合同；
- 建立真正双向的 `AgentEngine` / `EngineTurnHandle` 合同；
- 实现不依赖模型、网络、浏览器和 Electron 的 deterministic Fake Engine；
- 用同一套合同测试证明文本流、Tool 回送、Question/Approval 回送、动态 Tool 投影、终态和 abort；
- 建立独立 Agent TypeScript 检查与测试命令；
- 保持普通 Slim、Electron Shell 和 Legacy Fill MCP 的现有行为完全不变。

## Non-Goals

本阶段不做：

- 不迁移或打包 OpenCode；
- 不实现 Pi；
- 不实现 DefAgentHost、HTTP/SSE 路由或 Electron utilityProcess；
- 不增加 Shell 的“打开 AI 模式”按钮；
- 不增加 React Agent UI 或隐藏路由；
- 不恢复三个 Main Workbench remote no-op；
- 不访问浏览器 SQLite、Timeline、Work Node 或任何业务 handler；
- 不实现真实 Provider、凭据、审批签名或 Product command 执行；
- 不恢复 `/AI CLI`、`host="ai-cli"`、`17321`、`17322` 或旧 Node 业务数据库；
- 不新增 OpenCode/Pi 运行依赖。

## Source Boundary

本阶段允许的源码边界：

```text
agent/core/contracts/**
agent/core/testing/**
```

依赖规则：

```text
Fake Engine → core contracts
core contracts → 无产品、UI、Electron、OpenCode 依赖
```

核心文件 SHALL NOT import：

- `src/**`；
- `electron/**`；
- OpenCode/Pi SDK；
- React；
- 浏览器数据库实现；
- Legacy Fill；
- Node 文件系统、进程或网络 API。

Fake Engine 同样保持纯内存，不读写磁盘，不启动端口。

## Core Identity Contract

至少定义以下互不混用的 opaque ID：

- `DefSessionId`；
- `ClientTurnId`；
- `DefTurnId`；
- `EngineSessionId`；
- `EngineTurnId`；
- `EngineMessageId`；
- `ToolCallId`；
- `InteractionId`；
- `CommandId`；
- `WorkspaceId`；
- `DatabaseGeneration`；
- `TimelineId`。

ID 的 TypeScript 类型 SHALL 阻止把 Session ID 直接当成 Turn、Tool 或 command ID 使用。测试和适配器可以通过显式 helper 构造 ID，但生产合同不得退化为一组无区分的裸 `string`。

## AgentEngine Contract

`AgentEngine` 至少提供：

```ts
interface AgentEngine {
  readonly kind: string;
  probe(): Promise<EngineHealth>;
  createSession(input: EngineSessionCreateInput): Promise<EngineSessionRef>;
  recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult>;
  startTurn(input: EngineTurnInput): Promise<EngineTurnHandle>;
  compact?(ref: EngineSessionRef): Promise<CompactionResult>;
  disposeSession(ref: EngineSessionRef): Promise<void>;
  shutdown(): Promise<void>;
}
```

`startTurn` SHALL 返回双向 `EngineTurnHandle`：

```ts
interface EngineTurnHandle {
  readonly ref: EngineTurnRef;
  readonly events: AsyncIterable<EngineEvent>;
  submitToolResult(input: EngineToolResultInput): Promise<void>;
  submitInteractionResult(input: EngineInteractionResultInput): Promise<void>;
  updateToolProjection(input: EngineToolProjectionInput): Promise<void>;
  abort(reason: EngineAbortReason): Promise<AbortResult>;
}
```

约束：

- `ref` 在 handle 创建时已经存在，abort 不依赖事后猜测 ID；
- Engine 发出 Tool request 后，可以通过同一 `toolCallId` 收到 typed result/error；
- Engine 发出 Interaction request 后，可以通过同一 `interactionId` 收到 answer/approve/reject/expire/cancel/stale；
- Tool projection 更新必须带单调 revision；
- handle 终止后拒绝新的回送和 projection；
- 相同 correlation ID、相同 payload 的重复回送幂等；同 ID 不同 payload 返回 typed protocol error；
- 每个 Turn 最多产生一个 Engine terminal event；
- abort 可重复调用，结果幂等，不产生第二个 terminal。

## Session Contract

`DefSessionV6` 至少保存：

- `schemaVersion = 6`；
- `eventSchemaVersion`；
- 稳定 `defSessionId`；
- 固定 `host = "workbench"`；
- `workspaceId`、最近 `databaseGeneration`、`timelineId`；
- 可选 axis/checkout context pointer；
- `engine.kind/sessionId/runtimeVersion/storeSchemaVersion`；
- Harness state version/revision；
- `createdAt/updatedAt`。

本阶段只定义 schema，不实现文件持久化、迁移或 Session registry。

## Event Contract

DEF Event 与 Engine Event SHALL 分开：

- Engine Event 表达 adapter loop 里的文本、Tool/Interaction request、projection acknowledgment 和 terminal；
- DEF Event 表达产品稳定的 Session、Turn、Tool、Interaction、command 和 terminal journal；
- Engine 私有 ID 只能作为可选诊断映射，不成为 DEF UI 主键。

DEF Event 公共 envelope 至少包含：

- `schemaVersion`；
- Session 内单调 `sequence`；
- `occurredAt`；
- `defSessionId`；
- 可选 `defTurnId/toolCallId/interactionId/commandId`；
- typed event payload。

本阶段定义事件类型，不实现 Event Journal 持久化。

## Interaction Contract

至少定义：

- `question` 与 `approval` 两类 interaction；
- `pending/answered/approved/rejected/expired/cancelled/stale` 状态；
- proposal hash、workspace/timeline/revision binding 的结构；
- typed response；
- approval capability claims 的数据结构。

本阶段不生成签名 capability，也不实现 InteractionBroker。合同 SHALL 保留后续 Ed25519 key epoch、nonce 和 expiry 所需字段。

## Product Contract

至少定义：

- `ProductBinding`；
- `ProductSnapshotEnvelope`；
- `ProductCommandEnvelope`；
- `ProductCommandReceipt`；
- `ProductCommandResult`；
- `ProductGateway` port。

每个 command SHALL 带：

- `workspaceId`；
- `databaseGeneration`；
- `timelineId`；
- checkout/revision/digest；
- `defSessionId/defTurnId/toolCallId/commandId`；
- typed operation payload。

本阶段只定义 port，不实现浏览器 command journal 或 mutation。

## Deterministic Fake Engine

Fake Engine SHALL：

- 支持预先排入确定性 Turn script；
- 产生稳定递增的 fake Session/Turn/Message ID；
- 支持 text delta；
- 支持发出 Tool request 并暂停，直到收到匹配结果；
- 支持发出 Interaction request 并暂停，直到收到匹配结果；
- 支持等待指定 Tool projection revision；
- 支持 completed、failed 和 aborted terminal；
- 记录每轮收到的 Tool、Interaction 和 projection trace；
- 支持 create/recover/compact/dispose/shutdown；
- shutdown 或 dispose 时有序 abort 活动 Turn；
- 不使用定时随机性、真实时钟作为断言来源、网络或模型。

Fake Engine 是后续 Host/UI/ProductGateway 测试夹具，不得引入产品业务捷径。

## Repository And Tooling

本阶段 SHALL：

- 新增独立 `tsconfig.agent.json`；
- 新增 `typecheck:agent`；
- 新增 `test:agent-core`；
- 把 Agent typecheck/test 接入仓库或 Electron 总检查；
- 修改 `check:repo` 为精确 Agent allowlist；
- 对任何未列入白名单的 `agent/**` 文件继续失败；
- 继续静态禁止 `ai-cli`、Sidecar、旧固定端口、Node 业务 SQLite 和 vendor runtime 回归。

## Required Verification

自动测试至少覆盖：

1. 健康探测、Session create/recover/compact/dispose/shutdown；
2. 文本事件顺序；
3. Tool request 在 result 前暂停，result 后继续；
4. Interaction request 在 response 前暂停，response 后继续；
5. Tool projection revision 只单调前进；
6. 重复相同回送幂等、冲突回送拒绝；
7. abort 只产生一个 terminal，迟到回送拒绝；
8. completed/failed 同样只产生一个 terminal；
9. dispose/shutdown 回收活动 Turn；
10. 核心源码没有 OpenCode、Electron、React、SQLite 或产品 import；
11. 旧 Agent 目录和入口仍不能回归。

## Acceptance

以下条件全部满足才完成 Phase 1：

- Spec 与 Tasks 已纳入索引；
- `AgentEngine` 是可运行验证的双向合同，不是单向接口草图；
- Fake Engine 通过完整合同测试；
- `npm run typecheck:agent` 通过；
- `npm run test:agent-core` 通过；
- `npm run typecheck` 通过；
- `npm run check:repo` 通过；
- 当前普通 `npm test` 通过；
- 没有 OpenCode/Pi/旧 AI runtime、业务数据库或 UI 行为变化。
