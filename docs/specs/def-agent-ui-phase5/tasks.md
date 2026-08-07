# DEF Agent Product API and Slim AI Mode Phase 5 Tasks

## Status

Complete.

## Phase 0：合同冻结

- [x] 固定本阶段为产品 Session/Turn/Event API + Slim React 只读 AI 模式。
- [x] 固定不恢复 AI CLI、旧 REST、OpenCode UI、Node SQLite、Question/Approval/mutation。
- [x] 固定 Event Journal 为唯一 transcript 来源，首版使用 cursor JSON polling 而非伪 SSE。

## Phase 1：Host product API

- [x] 扩展 DEF event/HTTP contracts，`turn.accepted` 保存 user message。
- [x] 实现 Session list/create/read 与严格 consumer binding 校验。
- [x] 实现 bounded Event cursor feed。
- [x] 实现 Harness Turn start、clientTurnId retry/conflict 与 abort API。
- [x] 保证所有错误 typed、脱敏且不泄露 OpenCode/Provider 私有字段。

## Phase 2：Browser bridge

- [x] 为 `DesktopAgentBridge` 增加 Session/Turn/Event typed methods。
- [x] 校验所有 Host response，401/403 保持 fail-closed。
- [x] 增加 Event polling controller，隐藏/卸载/失权时停止并保留 cursor。

## Phase 3：Slim React AI mode

- [x] 建立 Event Journal → transcript/tool/terminal 的纯投影 model。
- [x] 把状态占位卡升级为可收起的右侧 AI 工作面板。
- [x] 实现新建会话、输入发送、active Turn 锁定与停止。
- [x] 显示 assistant Markdown、Tool lifecycle、terminal 与 typed error。
- [x] 显示当前 Timeline/checkout/consumer/engine readiness，不显示 OpenCode 私有身份。

## Phase 4：纵向验证

- [x] Host HTTP API 合同覆盖 Session/Turn/Event/abort/idempotency/binding。
- [x] Browser bridge 与 transcript model 合同测试通过。
- [x] Fake Engine 通过产品 API 完成 create → send → event terminal → abort。
- [x] 真实 OpenCode calculation 路线通过产品 HTTP API，文本来自 Event Journal。
- [x] 普通 Slim、MCP、Browser SQLite、Electron proxy/package boundary 不回归。

## Phase 5：交付

- [x] `npm run typecheck`、相关测试与 `npm run check` 通过。
- [x] 本地 `/timeline/ai` 手工/浏览器截图检查通过。
- [x] 独立高智能审查无未关闭 P0/P1。
- [x] 更新 validation 归档并提交实现。

## Exit condition

本阶段结束时，Slim AI 模式已经能真实使用五业务只读 Agent，但仍不支持写操作、Question/Approval 或跨 Host 重启恢复。下一阶段再建设 InteractionBroker 与 mutation。
