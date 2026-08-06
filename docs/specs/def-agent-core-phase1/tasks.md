# DEF Agent Core Phase 1 Tasks

## Status

待实施。

## Phase 0：规格与边界

- [ ] 将本 Spec/Tasks 加入 `docs/specs/README.md`。
- [ ] 固定本阶段只做 core contracts + deterministic Fake Engine。
- [ ] 修改仓库检查：由禁止整个 `agent/` 改为精确 allowlist。
- [ ] 保持旧 AI CLI、Sidecar、REST、Node SQLite、vendor/runtime 禁止项。

## Phase 1：TypeScript 工程入口

- [ ] 新增 `tsconfig.agent.json`。
- [ ] 新增 `typecheck:agent` 命令。
- [ ] 新增 `test:agent-core` 命令。
- [ ] 将 Agent 检查接入总质量门。

## Phase 2：核心合同

- [ ] 定义 opaque IDs 与 JSON value。
- [ ] 定义 Engine health、Session ref/recovery/compaction。
- [ ] 定义双向 `EngineTurnHandle`。
- [ ] 定义 Engine event 与 terminal。
- [ ] 定义 `DefSessionV6`。
- [ ] 定义 DEF Event envelope/union。
- [ ] 定义 Interaction/Approval claims。
- [ ] 定义 Product binding/snapshot/command/result/Gateway port。
- [ ] 建立 core contracts barrel，保证依赖方向单一。

## Phase 3：Deterministic Fake Engine

- [ ] 实现可排队的 scripted Turn。
- [ ] 实现 async Engine event stream。
- [ ] 实现 Tool request/result 暂停与恢复。
- [ ] 实现 Interaction request/result 暂停与恢复。
- [ ] 实现动态 Tool projection revision。
- [ ] 实现相同 correlation payload 幂等与冲突拒绝。
- [ ] 实现 completed/failed/aborted 唯一 terminal。
- [ ] 实现 create/recover/compact/dispose/shutdown。
- [ ] 暴露只读 trace 供测试使用。

## Phase 4：合同测试

- [ ] 覆盖 Session 生命周期。
- [ ] 覆盖文本事件顺序。
- [ ] 覆盖 Tool 双向回送。
- [ ] 覆盖 Interaction 双向回送。
- [ ] 覆盖 projection 单调 revision。
- [ ] 覆盖重复回送与冲突回送。
- [ ] 覆盖主动 abort、dispose abort、shutdown abort。
- [ ] 覆盖 terminal 唯一性和迟到输入拒绝。
- [ ] 覆盖仓库 import/文件边界。

## Phase 5：验证与交付

- [ ] `npm run typecheck:agent`。
- [ ] `npm run test:agent-core`。
- [ ] `npm run typecheck`。
- [ ] `npm test`。
- [ ] `npm run check:repo`。
- [ ] 更新本任务状态与验证摘要。
- [ ] 提交 Phase 1 实现。

## Exit Condition

Phase 1 完成后，下一阶段才允许实现 DefAgentHost、Shell launch grant 和 Browser ProductGateway 骨架；在 Fake Engine 合同没有全部通过前，不接 OpenCode。
