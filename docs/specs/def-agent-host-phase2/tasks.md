# DEF Agent Host 与 Browser ProductGateway Phase 2 Tasks

## Status

待实施。

## Phase 0：规格与边界

- [ ] 将 Phase 2 Spec/Tasks 加入索引。
- [ ] 固定本阶段不接 OpenCode/Pi、不暴露生产 mutation。
- [ ] 固定 Host、Browser、Electron 与 MCP 的依赖边界。
- [ ] 扩展仓库精确 allowlist 和静态禁止项。

## Phase 1：Host Core 与 Fake Engine 闭环

- [ ] 定义 Browser protocol/runtime DTO。
- [ ] 实现 launch grant 与 UI capability authority。
- [ ] 实现唯一 Browser consumer registry 与 heartbeat。
- [ ] 实现 Remote Browser ProductGateway queue/result/reconcile。
- [ ] 实现 DefAgentHost Session/Turn/event loop。
- [ ] 覆盖 Fake Engine 文本、Tool、result、terminal 与 abort。

## Phase 2：Host Runtime 与 Electron Supervisor

- [ ] 实现 Agent Host HTTP runtime 和私有 internal auth。
- [ ] 使用随机 loopback 端口，不新增浏览器固定端口。
- [ ] 新增 Host runtime build。
- [ ] 实现 Electron Agent supervisor 的 lazy start/reuse/stop/crash state。
- [ ] 将 `/agent-host/**` 通过 31457 桥接到 Host。
- [ ] Shell 增加 Agent 状态与“打开 AI 模式”入口。
- [ ] 完全退出时有序回收 Agent utilityProcess。

## Phase 3：Browser Identity 与 Product Journal

- [ ] 建立 workspaceId/databaseGeneration/runtime schema。
- [ ] 建立 runtime snapshot canonical digest。
- [ ] 建立 browser command journal 与 typed reconciliation。
- [ ] 建立整库恢复后的 generation rotation hook。
- [ ] 建立 test-only atomic mutation fixture。
- [ ] 验证 fixture mutation/revision/receipt 同一 batch transaction。

## Phase 4：隐藏 AI 模式与 Browser Bridge

- [ ] 新增 `/timeline/ai` 隐藏路由，不加入普通导航。
- [ ] 捕获 fragment grant、清理 URL、交换 capability。
- [ ] 无授权路由在 workspace/bootstrap 前 fail closed。
- [ ] 合法路由请求 writer 并注册可见 consumer。
- [ ] 实现 heartbeat、close、刷新重连与失效降级。
- [ ] 实现最小 Agent overlay 状态 UI。
- [ ] 产品 UI 明确标记 Engine 待接入，不伪装真实聊天。

## Phase 5：恢复 Main Workbench 接缝

- [ ] 恢复 `pullRemoteMainWorkbenchCommands`。
- [ ] 恢复 `pushMainWorkbenchCommandResult`。
- [ ] 恢复 `pushMainWorkbenchSnapshot`。
- [ ] 普通页面保持零请求 no-op。
- [ ] 只允许明确白名单只读/UI-safe command。
- [ ] 现有复杂 mutation 保持不可达。

## Phase 6：验证与交付

- [ ] Agent Host 合同测试。
- [ ] Browser Agent 合同测试。
- [ ] Electron supervisor/bridge smoke。
- [ ] 隐藏路由与授权 E2E。
- [ ] `npm run typecheck`。
- [ ] `npm test`。
- [ ] `npm run check:repo`。
- [ ] `npm run check`。
- [ ] `npm run electron:check`。
- [ ] Sol max 独立审查无 P0/P1。
- [ ] 更新状态与验证摘要。
- [ ] 提交 Phase 2 实现。

## Exit Condition

Phase 2 完成后，下一阶段才允许迁移 DEF Harness 与五业务只读 Tool；OpenCode adapter 必须等 Host、Browser ProductGateway 和同一套 conformance test 稳定后再接入。
