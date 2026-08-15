# Web LTS 通知中心 Tasks

## Status

实施中。

## NOT-1：Schema 与通知仓库

- [ ] `webDatabase.worker.ts` 新增 `notifications` 表与时间索引。
- [ ] 新建 `src/platform/notifications/notificationTypes.ts`：类型、severity/kind、action 合同。
- [ ] 新建 `src/platform/notifications/notificationStore.ts`：
  - `listNotifications()`（最近 100 条，`created_at DESC`）；
  - `notifyNotification(input)`：同 dedupe key 未读只刷新 `updated_at`，已读不复活；
  - `markNotificationRead(id)`；
  - `markAllNotificationsRead()`；
  - `markKindRead(kind)`：复检解除状态时使用；
  - `countUnreadNotifications()`。
- [ ] 时间身份的操作结果 key 每次唯一；更新类 key 只含目标版本。

## NOT-2：NotificationCenterProvider

- [ ] 新建 `src/platform/notifications/NotificationCenterProvider.tsx`：
  - 挂载时 hydrate；
  - 暴露 `notify`、`markRead`、`markAllRead`、`notifications`、`unreadCount`；
  - `notify` 后同步刷新列表与未读数。
- [ ] `WebBootstrap.tsx` 在 `AppProvider` 内包裹 `NotificationCenterProvider`。
- [ ] 新增纯策略辅助（dedupe/相对时间格式化），便于定向测试。

## NOT-3：铃铛与面板 UI

- [ ] 新建 `src/components/WebApp/NotificationBell.tsx`：铃铛按钮 + 未读徽标 + aria-label。
- [ ] 新建 `src/components/WebApp/NotificationPanel.tsx`：
  - 通知列表、严重级别标记、正文、相对时间、动作按钮；
  - 全部已读按钮；
  - 空态；
  - 点击卡片/动作 = 已读；动作执行后关闭面板。
- [ ] `AppShell.tsx`：
  - 将铃铛放入 `.web-shell-launcher`，与菜单按钮并列；
  - 管理 `notificationOpen`，与 `menuOpen` 互斥；
  - 点外部/Escape 关闭；
  - 向面板传入页面更新动作与路由跳转。
- [ ] `app-shell.css` 增加通知按钮、徽标、面板样式，复用 `--shell-*` 变量。

## NOT-4：接入页面更新通知

- [ ] AppShell 的 `usePageVersionUpdate` 发现 `update-available` 时发 `page-update` 通知。
- [ ] dedupe key 使用 `releaseVersion:shellVersion`。
- [ ] 更新成功重载后不复活旧通知。

## NOT-5：接入资料/图片版本检查

- [ ] 新建 `src/platform/notifications/useResourceStatusNotifications.ts`：
  - 只读检查，不下载、不应用；
  - 挂载/联网/回到前台/30 分钟轮询；
  - 监听 `dmg-resource-status-changed` 立即复检；
  - 按 spec 发出 `data-download` / `image-download` / `data-apply`；
  - 状态解除时调用 `markKindRead` 清理对应未读。
- [ ] `AppShell.tsx` 挂载该 hook。
- [ ] `DataWorkspacePage.tsx` 下载、应用、导入成功后 dispatch `dmg-resource-status-changed`，并发出对应结果通知。

## NOT-6：文档与验证

- [ ] `docs/specs/README.md` 索引增加通知中心条目。
- [ ] 新增通知策略定向测试（dedupe / read / kind 清理）。
- [ ] `npm run typecheck`。
- [ ] 运行通知相关定向测试。
- [ ] `git diff --check`。
- [ ] 按仓库约定分阶段提交。
