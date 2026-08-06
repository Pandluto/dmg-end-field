# DEF Agent Host 与 Browser ProductGateway Phase 2 Tasks

## Status

已完成。

## Phase 0：规格与边界

- [x] 将 Phase 2 Spec/Tasks 加入索引。
- [x] 固定本阶段不接 OpenCode/Pi、不暴露生产 mutation。
- [x] 固定 Host、Browser、Electron 与 MCP 的依赖边界。
- [x] 扩展仓库精确 allowlist 和静态禁止项。

## Phase 1：Host Core 与 Fake Engine 闭环

- [x] 定义 Browser protocol/runtime DTO。
- [x] 实现 launch grant 与 UI capability authority。
- [x] 实现唯一 Browser consumer registry 与 heartbeat。
- [x] 实现 Remote Browser ProductGateway queue/result/reconcile。
- [x] 实现 DefAgentHost Session/Turn/event loop。
- [x] 覆盖 Fake Engine 文本、Tool、result、terminal 与 abort。

## Phase 2：Host Runtime 与 Electron Supervisor

- [x] 实现 Agent Host HTTP runtime 和私有 internal auth。
- [x] 使用随机 loopback 端口，不新增浏览器固定端口。
- [x] 新增 Host runtime build。
- [x] 实现 Electron Agent supervisor 的 lazy start/reuse/stop/crash state。
- [x] 将 `/agent-host/**` 通过 31457 桥接到 Host。
- [x] Shell 增加 Agent 状态与“打开 AI 模式”入口。
- [x] 完全退出时有序回收 Agent utilityProcess。

## Phase 3：Browser Identity 与 Product Journal

- [x] 建立 workspaceId/databaseGeneration/runtime schema。
- [x] 建立 runtime snapshot canonical digest。
- [x] 建立 browser command journal 与 typed reconciliation。
- [x] 建立整库恢复后的 generation rotation hook。
- [x] 建立 test-only atomic mutation fixture。
- [x] 验证 fixture mutation/revision/receipt 同一 batch transaction。

## Phase 4：隐藏 AI 模式与 Browser Bridge

- [x] 新增 `/timeline/ai` 隐藏路由，不加入普通导航。
- [x] 捕获 fragment grant、清理 URL、交换 capability。
- [x] 无授权路由在 workspace/bootstrap 前 fail closed。
- [x] 合法路由请求 writer 并注册可见 consumer。
- [x] 实现 heartbeat、close、刷新重连与失效降级。
- [x] 实现最小 Agent overlay 状态 UI。
- [x] 产品 UI 明确标记 Engine 待接入，不伪装真实聊天。

## Phase 5：恢复 Main Workbench 接缝

- [x] 恢复 `pullRemoteMainWorkbenchCommands`。
- [x] 恢复 `pushMainWorkbenchCommandResult`。
- [x] 恢复 `pushMainWorkbenchSnapshot`。
- [x] 普通页面保持零请求 no-op。
- [x] 只允许明确白名单只读/UI-safe command。
- [x] 现有复杂 mutation 保持不可达。

## Phase 6：验证与交付

- [x] Agent Host 合同测试。
- [x] Browser Agent 合同测试。
- [x] Electron supervisor/bridge smoke。
- [x] 隐藏路由与授权 E2E。
- [x] `npm run typecheck`。
- [x] `npm test`。
- [x] `npm run check:repo`。
- [x] `npm run check`。
- [x] `npm run electron:check`。
- [x] Sol max 独立审查无未关闭 P0/P1。
- [x] 更新状态与验证摘要。
- [x] 提交 Phase 2 实现。

## Verification Summary

2026-08-07 验收结果：

- `npm run check`：通过；仓库边界、依赖审计、类型、全量单测、Agent Core/Host/Supervisor、构建与离线工作区均通过，依赖漏洞为 0。
- `npm run electron:check`：通过；独立 Shell、随机私有 Host、隐藏 AI 路由、唯一 Browser writer/consumer、Browser SQLite、MCP 四业务域、发包工具、退出清理与重启持久化均通过。
- `npm run electron:verify:mac`：通过；实际 `mac-arm64` 应用完成打包边界检查和 packaged executable E2E。当前本机未配置 Apple 签名/公证凭据，因此该验证使用未签名目录包。
- Sol max 独立审查发现的“Host 心跳仅惰性过期”和“浏览器 stale 心跳后不自动重连”两个 P1 已修复，并由同一审查智能体复核关闭；无未关闭 P0/P1。
- OpenCode/Pi、Provider、生产 mutation、AI CLI 和旧 REST 仍按 Non-Goals 保持未接入；产品明确显示 Engine 待接入。

## Exit Condition

Phase 2 完成后，下一阶段才允许迁移 DEF Harness 与五业务只读 Tool；OpenCode adapter 必须等 Host、Browser ProductGateway 和同一套 conformance test 稳定后再接入。
