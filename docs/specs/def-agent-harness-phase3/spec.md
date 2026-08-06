# DEF Harness 与五业务只读 Tool Phase 3 Spec

## Status

实现完成；自动化、目录包和包内容验收通过，待固定端口空闲后补跑 packaged Mac 实际启动验收。

## Background

Phase 1 已建立引擎无关的 Session、Turn、Event、Engine、Interaction 与 ProductGateway 合同；Phase 2 已完成 Electron Shell、随机私有 Agent Host、隐藏 AI 模式、唯一 Browser writer/consumer、Browser ProductGateway 与命令对账。

本阶段迁回旧 DEF 中仍有价值的 Harness 与 Tool 内核，但不复制旧 OpenCode wrapper、旧 REST、Node 业务 SQLite、写操作和混合式巨型工具文件。

事实与参考线：

- 当前基线：`a6e8accf`；
- 旧 AI 参考分支：`codex/def-opencode-spec9-2-implementation@bcea5f12`；
- 旧五业务默认 Revision：selection `v1`、loadout `v4`、timeline `v13`、buff `v1`、calculation `v1`；
- [OpenCode 引擎回迁、可替换 Agent 架构与完整生命周期调研](../../architecture/audits/opencode-engine-reintegration-research-20260806.md)；
- [DEF Agent Host 与 Browser ProductGateway Phase 2](../def-agent-host-phase2/spec.md)。

旧分支只作为语义和测试证据，不作为可直接复制的实现。所有当前产品读取都必须经过 Phase 2 的 ProductGateway snapshot，浏览器继续拥有唯一业务 SQLite。

## Goal

本阶段完成：

- 建立不依赖 OpenCode/Pi 的 `DefHarnessManager`；
- 建立严格 typed、默认拒绝的 `DefReadToolRegistry`；
- 新 Turn 首先只投影 `def.harness.route`，业务路由完成后才投影当前 phase 的最小 Tool 集；
- 将 business、operation、Revision、content hash、phase 与 Tool projection 固定到当前 Turn transaction；
- 接通 selection、loadout、timeline、buff、calculation 五条真实 Browser snapshot 只读链路；
- 让 Host 在 Tool result 后推进 Harness phase，并通过 `updateToolProjection` 更新同一 Engine Turn；
- 将 Harness route、phase、projection 与 terminal trace 写入 DEF Event Journal；
- 用 deterministic Fake Engine 和旧 Revision 记录的 parity fixture 验证五业务工具顺序、typed result、失败和终态；
- 保持普通 Slim、MCP、Electron Shell、Browser SQLite 和 Phase 2 授权边界不变。

## Phase 3 Read-Only Allowlist

本阶段的“完成五业务只读”定义为每个业务先恢复一条可由真实当前 Workbench snapshot 驱动的纵向链路。Tool ID 和 operation 沿用旧 Revision 的核心语义：

| Business | Operation | Pinned source lineage | Phase Tool sequence |
| --- | --- | --- | --- |
| selection | `inspect` | `selection@v1` | `def.node.crud.context` |
| loadout | `inspect` | `loadout@v4` | `def.data.resource.team_loadouts` |
| timeline | `current` | `timeline@v13` | `def.node.crud.current` |
| buff | `resolve` | `buff@v1` | `def.data.resource.buff` |
| calculation | `calculate` | `calculation@v1` | `def.node.crud.context` → `def.data.resource.damage` |

新的 Slim Revision 必须使用独立 content hash，不能冒充旧 Revision 原文未变。旧 Revision 中的其他只读 operation 只有在其数据源、typed result 和黑盒测试一起迁入后才能单独开放。

## Non-Goals

本阶段不做：

- 不打包、启动或调用 OpenCode/Pi；
- 不新增真实聊天入口、Provider、模型或凭据；
- 不恢复 AI CLI、旧 REST、`17321`、`17322` 或 Sidecar；
- 不恢复 selection/loadout/timeline/buff 的 mutation、proposal、approval 或 Work Node 写操作；
- 不开放旧 catalog search、配装推荐、知识检索、3+1 planning、timeline validate/diff 等未进入本阶段白名单的 operation；
- 不实现 Harness hot reload、candidate promote、rollback 或 revoke；这些留到会话恢复阶段；
- 不实现跨业务 plan、Question/Approval 或完整 Session UI；
- 不让 Host、Tool handler 或 Electron 直接读取浏览器 SQLite；
- 不把 Harness 内容写入 localStorage、URL、浏览器业务库或 MCP proposal 库。

## Source Boundary

允许新增：

```text
agent/core/contracts/harness.ts
agent/core/contracts/tool.ts
agent/core/harness/**
agent/core/tools/**
agent/core/testing/fixtures/**
```

依赖方向：

```text
DefAgentHost → DefHarnessManager
DefAgentHost → DefReadToolRegistry
DefHarnessManager → core contracts + immutable Revision catalog
DefReadToolRegistry → ProductGateway port + core contracts
ProductGateway → browser-published ProductSnapshotEnvelope
```

禁止：

- Harness/Tool import OpenCode、Pi、Electron、React 或 `src/**`；
- Tool handler import Browser SQLite、OPFS 或 Main Workbench组件；
- Electron import Harness/业务 Tool handler；
- Browser bridge理解 Harness phase；
- Harness 直接执行或伪造伤害公式；
- 任意未登记 Tool 被 Engine 名称猜中后执行。

## Harness Revision Contract

每个业务 Revision 至少包含：

- `businessId`、`displayName`、`sourceLineage`；
- 本阶段允许的 operation；
- immutable `contentHash`；
- `entryPhase`；
- phase 的 `id`、`kind`、Tool allowlist、instructions、success/failure transition；
- terminal phase 的 `completed` 或 `aborted`；
- `writeScope: []`。

Manager 启动时必须验证：

- 只有五个登记业务；
- operation/phase/transition 不重复、不悬空、无无终态环；
- phase Tool 全部存在于 typed registry；
- 所有 Tool risk 均为 `read`；
- write scope 和 phase writes 均为空；
- content hash 由 canonical Revision 内容确定；
- 相同输入重复加载得到相同 hash。

Turn 路由成功时 pin `businessId + operation + revision + contentHash`。一个 Turn 内不得切换 Revision 或业务；未完成的跨业务请求返回 typed unsupported，不自行拼接两个 transaction。

## Route And Projection Lifecycle

1. Host 接受 Harness Turn；
2. Engine 初始只看见 `def.harness.route`；
3. route input 必须明确提供 allowlisted `businessId` 与 `operation`；
4. Manager prepare pinned transition，但此时不改变当前 transaction；
5. Host 通过 `submitToolResultAndUpdateProjection` 原子回送 route result 与下一 projection；
6. Engine 接受后 Manager 才 commit transition；若 Engine 拒绝，prepare 被丢弃且当前 transaction 进入失败收口；
7. Engine adapter 在 result 与 projection 都接受前不得恢复推理或发出 terminal；
8. Engine Tool request 必须在任何 handler/ProductGateway 调用前命中当前 projection；
9. Tool registry读取与 Session binding 完全一致的最新 Product snapshot；
10. Host 原子回送 typed result 与下一 projection，再 commit Manager phase；
11. phase 改变后 projection revision 单调递增；
12. terminal phase 投影空 Tool 集；
13. Engine terminal 后 transaction 封存，迟到 Tool/result 一律拒绝。

route 不做自然语言规则猜测。未来 OpenCode/Pi adapter 可以让模型调用 route Tool，但 Harness Manager 只接受 typed route contract。

## Read Tool Result Contract

### `def.node.crud.context`

返回当前 snapshot binding、当前页面、checkout、选中干员摘要、按钮数量、配置数量和伤害报告可用性。不得返回任意文件路径或数据库 handle。

### `def.data.resource.team_loadouts`

以选中干员顺序返回当前武器、四件装备、套装效果和技能等级；同时返回 `complete` 与明确的 `missingCharacterIds`。缺失配置不得被解释为角色不存在。

### `def.node.crud.current`

返回当前 timeline/workspace identity、checkout identity、content revision，以及带稳定 ID、角色、技能、位置和 Buff 数量的按钮列表。不返回可变引用。

### `def.data.resource.buff`

从当前按钮 Buff、装备词条和套装效果建立稳定去重候选；支持可选 `query`、`buttonId`，返回来源、命中按钮和 bounded candidates。空结果只表示当前 snapshot 未命中。

### `def.data.resource.damage`

返回当前产品生成的 typed damage report、`damage-report-v1` 语义版本、snapshot digest 与统计范围。产品 snapshot 必须明确标记 `damageReportStatus: ready`，且报告来自 Canvas、结构完整、按钮与当前 timeline 一致。选择页 carry/placeholder、缺失或过期报告返回 typed unavailable，不伪造 0 伤害。

所有结果都必须是 JSON-safe、可排序、可做 deterministic snapshot 的值。

## Failure Rules

- 无 active Browser consumer：`AGENT_CONSUMER_REQUIRED`；
- snapshot 与 Session binding 不一致：`AGENT_BINDING_CONFLICT`；
- route 业务或 operation 不在白名单：`HARNESS_ROUTE_UNSUPPORTED`；
- Tool 不在当前 phase projection：`HARNESS_TOOL_NOT_PROJECTED`；
- Tool input 不符合 schema：`DEF_TOOL_INPUT_INVALID`；
- snapshot payload 结构不可用：`DEF_TOOL_PRODUCT_SNAPSHOT_INVALID`；
- damage report 缺失：`DEF_DAMAGE_REPORT_UNAVAILABLE`；
- transaction 已 terminal：`HARNESS_TRANSACTION_TERMINAL`。

Tool 失败后进入该 operation 的 failed terminal，projection 清空；Engine 可以生成失败说明，但 Host 不把失败 Turn 标记成业务成功。

## Trace And Event Journal

新增事件至少覆盖：

- `harness.routed`：business、operation、revision、content hash；
- `harness.phase.entered`：phase、kind；
- `harness.tool.projected`：projection revision 和 Tool names；
- `harness.terminal`：completed/aborted 与最终 phase。

Trace 不记录 capability、Host token、数据库 handle 或未裁剪的敏感内部错误。Tool result 继续走现有 `tool.result/tool.error`。

## Required Verification

自动验证至少覆盖：

1. 五业务 Revision catalog、hash、图结构和零写域；
2. 初始 projection 只有 route Tool；
3. 非白名单 operation、mutation Tool 和跨业务切换 fail closed；
4. 每次 phase 只投影最小 Tool 集，revision 单调递增；
5. selection、loadout、timeline、buff、calculation 五条 Fake Engine Turn 完整结束；
6. 五个 Tool 都读取同一个 ProductSnapshotEnvelope，结果与 fixture golden 精确相等；
7. calculation 不重算公式，报告缺失 typed fail；
8. stale binding、consumer lost、abort 与 terminal 后迟到调用；
9. Harness trace 与 DEF Event Journal 顺序稳定；
10. 旧参考 Revision 的 operation/Tool sequence parity fixture；
11. 普通 Slim、Browser SQLite、MCP 与 Electron Shell 不回归；
12. 打包产物包含新 Host 内核，不包含旧 REST/OpenCode/Pi；
13. `npm run check`、`npm run electron:check` 和实际 Mac packaged smoke；
14. 独立高智能审查无未关闭 P0/P1。

## Acceptance

以下条件全部满足才完成 Phase 3：

- 五个业务各有一条真实、typed、ProductGateway-backed 的只读纵向链路；
- Host 不再接受 Harness Turn 的任意 caller-supplied Tool projection；
- 当前 phase 之外的 Tool 无法执行；
- 通用 Harness/Tool 目录零 OpenCode/Pi/Electron/React/`src` import；
- Browser 仍是唯一业务数据事实源；
- mutation 白名单仍为空；
- deterministic Fake Engine blackbox 与旧参考 parity fixture 通过；
- 全量与 packaged 验收通过；
- 无未关闭 P0/P1。

Phase 3 完成后，Phase 4 才允许实现 `OpenCodeEngineAdapter`，并要求 OpenCode 与 Fake Engine 运行同一套 Harness/Tool conformance。
