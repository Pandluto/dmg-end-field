# DEF Agent Core Phase 1 Tasks

## Status

已完成（2026-08-06）。

## Phase 0：规格与边界

- [x] 将本 Spec/Tasks 加入 `docs/specs/README.md`。
- [x] 固定本阶段只做 core contracts + deterministic Fake Engine。
- [x] 修改仓库检查：由禁止整个 `agent/` 改为精确 allowlist。
- [x] 保持旧 AI CLI、Sidecar、REST、Node SQLite、vendor/runtime 禁止项。

## Phase 1：TypeScript 工程入口

- [x] 新增 `tsconfig.agent.json`。
- [x] 新增 `typecheck:agent` 命令。
- [x] 新增 `test:agent-core` 命令。
- [x] 将 Agent 检查接入总质量门。

## Phase 2：核心合同

- [x] 定义 opaque IDs 与 JSON value。
- [x] 定义 Engine health、Session ref/recovery/compaction。
- [x] 定义双向 `EngineTurnHandle`。
- [x] 定义 Engine event 与 terminal。
- [x] 定义 `DefSessionV6`。
- [x] 定义带强制 correlation/payload 的 DEF Event union。
- [x] 定义 Interaction/Approval claims，并约束 Question/Approval 的合法结果。
- [x] 定义 Product binding/snapshot/typed command/result/Gateway port。
- [x] 建立 core contracts barrel，保证依赖方向单一。

## Phase 3：Deterministic Fake Engine

- [x] 实现可排队的 scripted Turn。
- [x] 实现 async Engine event stream。
- [x] 实现 Tool request/result 暂停与恢复。
- [x] 实现 Interaction request/result 暂停与恢复。
- [x] 实现动态 Tool projection revision。
- [x] 实现相同 correlation payload 幂等与冲突拒绝。
- [x] 实现 completed/failed/aborted 唯一 terminal。
- [x] 实现 create/recover/compact/dispose/shutdown。
- [x] 暴露只读 trace 供测试使用。

## Phase 4：合同测试

- [x] 覆盖 Session 生命周期及 runtime/store schema 不兼容。
- [x] 覆盖文本事件顺序。
- [x] 覆盖 Tool 双向回送。
- [x] 覆盖 Question/Approval 双向回送及非法结果拒绝。
- [x] 覆盖 projection 单调 revision。
- [x] 覆盖重复回送与冲突回送。
- [x] 覆盖主动 abort、dispose abort、shutdown abort。
- [x] 覆盖 terminal 唯一性、迟到输入拒绝及 result/abort 两种竞态顺序。
- [x] 覆盖 DEF Event 与 Product operation 的正负向类型约束。
- [x] 覆盖仓库 import/文件边界，并以越界 import 负向探针验证。

## Phase 5：验证与交付

- [x] `npm run typecheck:agent`。
- [x] `npm run test:agent-core`。
- [x] `npm run typecheck`。
- [x] `npm test`。
- [x] `npm run check:repo`。
- [x] `npm run check`（含依赖审计、生产构建和离线检查）。
- [x] 更新本任务状态与验证摘要。
- [x] 通过本提交交付 Phase 1 实现。

## Implementation Summary

- 新增引擎无关的 ID、Engine、Session、DEF Event、Interaction 与 Product 合同。
- 新增真正双向、可暂停恢复的 deterministic Fake Engine。
- Agent 源码仅允许精确白名单文件，并通过 TypeScript AST 检查依赖不得逃逸 `agent/core/**`。
- 未恢复 OpenCode/Pi、AI CLI、Sidecar、REST、Node 业务 SQLite、旧固定端口或任何 AI UI。

## Verification Summary

- `npm run check`：通过；覆盖 Agent/主项目类型检查、全量测试、依赖审计、生产构建、Timeline smoke 与离线检查。
- `npm run test:agent-core`：通过；输出 `DEF_AGENT_CORE_FAKE_ENGINE_CONTRACT_OK`。
- 仓库边界负向探针：普通及带注释的越界 import 均被 `check:repo` 拒绝，撤销探针后恢复通过。
- Sol max 独立复核：最终无 P0/P1，Phase 1 可验收。

## Exit Condition

Phase 1 已完成。下一阶段才允许实现 DefAgentHost、Shell launch grant 和 Browser ProductGateway 骨架；OpenCode adapter 仍须复用本合同并通过同一套 conformance test 后方可接入。
