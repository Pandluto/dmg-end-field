# Web LTS 通知中心 Spec

## Status

核心已实施。桌面端通知中心、未读徽标、单条/全部已读、页面更新与资料/图片版本通知均已接入；移动端保持既有“只读取线上最新版本”策略。

## Problem Statement

Web LTS 目前把“用户应该知道的事件”散落在各页面的 message 行、数据页按钮状态和移动端横幅里：

- 页面更新只在浮动菜单/设置页的小按钮上显示，用户不主动点开就不知道。
- 资料/图片包有新版本只影响数据页一个按钮文案，没有全局提示。
- 新资料已下载但未应用时，只有数据包列表里一个不醒目的“当前应用”标记。
- 应用、导入、导出、备份等操作完成后只有页面内一行 message，切走页面就消失，也没有已读概念。

本规格新增一个桌面端全局通知中心，统一收集这些事件，提供持久化未读/已读状态、未读徽标、单条已读与全部已读。

移动端不在本规格范围：移动端继续采用“只读取线上最新版本”的既有策略。

## Goals

- 通知是持久的：写入选定 SQLite 表，刷新/重载后仍存在。
- 已读是持久的：单条已读、全部已读都写回 SQLite。
- 未读数量有全局可见徽标，进入应用壳即可看到。
- 同一事件不重复堆积：每个通知有稳定 dedupe key，同 key 未读时只刷新时间，已读后不再自动重建。
- 通知只提示、不擅自下载或应用任何资料；所有资料动作仍由用户在对应页面确认。
- 通知可以携带动作（跳转路由或调用页面更新），点击动作自动标记已读。
- 现有页面 message 与移动端行为保持不变；通知中心是新增的全局通道，不替换页面内即时反馈。

## Non-goals

- 不实现移动端通知中心或“只读最新版”以外的移动逻辑。
- 不实现浏览器推送、服务端推送或账号同步。
- 不实现 Toast 队列、自动消失机制或“不再提醒”以外的偏好设置。
- 不改变资料应用的整体替换语义、备份语义或版本号规则。
- 不在本规格内做变更 diff / changelog 预览。

## Terminology

- 通知（notification）：一条已持久化的事件记录。
- 未读（unread）：`read_at` 为 NULL 的通知。
- 已读（read）：用户显式点击通知卡片、点击“全部已读”或点击通知动作后写回 `read_at`。
- Dedupe key：由 `kind + 版本/包身份` 组成的稳定键，用于抑制重复通知。
- 动作（action）：通知携带的可选跳转或执行入口，例如“更新页面”“去数据页”。

## Data Contract

在 `src/platform/database/webDatabase.worker.ts` 的 schema 中新增：

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info', 'success', 'warning', 'error')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  read_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at DESC);
```

- `id` 由客户端生成，例如 `crypto.randomUUID()` 的等价实现。
- `dedupe_key` 唯一约束决定“同一条通知”的身份。
- `action_json` 只保存可序列化数据，不保存函数；格式为 `{ label: string; route?: string; handlerKey?: NotificationHandlerKey }`。
- 查询默认按 `created_at DESC` 排序，并限制返回最近 100 条；数据库不自动删除历史行。

## Notification Kinds

| kind | severity | dedupe key | 触发 |
| --- | --- | --- | --- |
| `page-update` | info | `page-update:<releaseVersion>:<shellVersion>` | 页面版本检查发现可更新 |
| `data-download` | info | `data-download:<dataManifest.version>` | 已下载资料包版本落后于服务器 |
| `image-download` | info | `image-download:<imageManifest.version>` | 已下载图片包版本落后于服务器 |
| `data-apply` | warning | `data-apply:<officialPackageId>` | 最新官方数据包已下载但未应用 |
| `apply-result` | success | `apply-result:<packageId>:<updatedAt>` | 数据包应用成功 |
| `install-result` | success | `install-result:<resourceVersion>:<updatedAt>` | 资料/图片包下载校验成功 |
| `import-result` | success | `import-result:<scope>:<packageId>:<updatedAt>` | 数据包导入成功 |
| `backup-created` | info | `backup-created:<backupPackageId>` | 应用前自动创建 Local Data 备份 |

`apply-result`、`install-result`、`import-result` 的 dedupe key 包含时间戳或 `updatedAt`，因此每次操作都是独立通知；更新类通知（`page-update`、`data-download`、`image-download`、`data-apply`）只以目标版本为身份。

## Read Contract

- `markNotificationRead(id)` 只更新单条，重复调用幂等。
- `markAllNotificationsRead()` 只更新当前未读记录，返回受影响条数。
- 点击通知卡片主体 = 单条已读；点击动作 = 单条已读并执行动作。
- “全部已读”按钮始终可见，未读数为 0 时禁用。
- 徽标只统计未读数；已读历史保留在列表中，但默认视觉弱化。
- 相同 dedupe key 已存在时：
  - 已存在且未读：只刷新 `updated_at`，不新增行。
  - 已存在且已读：不新增、不恢复未读。
  - 操作结果类通知（key 含时间身份）不受该规则影响。
- 已读状态写回 SQLite；重新加载后状态一致。

## UI Contract

- 浮动启动器（`.web-shell-launcher`）旁增加通知铃铛按钮。
- 铃铛上显示未读数量徽标；未读为 0 时不显示徽标。
- 点击铃铛展开通知面板；菜单弹层与通知面板互斥。
- 面板包含：
  - 标题“通知”；
  - “全部已读”按钮；
  - 最近通知列表（含严重级别标记、标题、正文、相对时间、可选动作按钮）；
  - 空态文案。
- 点击面板外区域或按下 Escape 关闭面板。
- 通知动作支持：
  - `handlerKey: 'page-update'`：调用当前页面更新动作；
  - `handlerKey: 'data-workspace'`：跳转 `#/data`；
  - `handlerKey: 'settings'`：跳转 `#/settings`；
  - 或 `route` 直接跳转。
- 面板使用 `role="dialog"` 与 `aria-live` 等可访问性标注；主题颜色跟随现有 `--shell-*` 变量，不新增主题专用实现。

## Source Rules

### 页面版本

- 页面版本检查继续由 `usePageVersionUpdate` 在应用壳执行；设置页复用同一状态或保持本地检查，但只允许应用壳实例发通知。
- 发现 `update-available` 且 dedupe key 未读过时发 `page-update` 通知，动作为 `page-update`。
- 点击更新并成功重载后，新页面版本不再满足旧 key；旧通知保持已读或未读均不自动重建。

### 资料与图片版本

- 应用壳新增只读状态检查（不下载、不应用）：
  - 对比 `readInstalledResourcePackage().version` 与 `fetchResourcePackageManifest().version`；
  - 对比 `readInstalledImagePackage().version` 与 `fetchImagePackageManifest().version`；
  - 读取 `listLocalDataPackages('share')` 判断最新官方包是否 active。
- 检查时机：应用壳挂载后、重新联网、回到前台、每 30 分钟；失败静默，不产生错误通知。
- 数据页完成下载/应用后通过 `dmg-resource-status-changed` 窗口事件触发立即复检。
- 已下载未应用时，发 `data-apply`，动作为 `data-workspace`。
- 已安装版本落后时，发 `data-download` / `image-download`，动作为 `data-workspace`。
- 复检发现某类状态已解除时，把对应 kind 的未读通知标记为已读。

### 数据页操作结果

- 数据页在下载校验成功、应用成功、导入成功后发对应结果通知，并在通知中心保留已读历史。
- 页面内原有 message 保留；通知是跨页面的持久记录，不替代 message。

## Acceptance Scenarios

1. 未读通知显示徽标；点击“全部已读”后徽标消失，刷新页面后仍为已读。
2. 同一个页面新版本只产生一条 `page-update` 通知；用户已读后重复检查不恢复未读。
3. 资料包有新版本时产生 `data-download` 通知；进入数据页下载后复检自动把该通知标为已读，并产生 `install-result`。
4. 已下载最新官方包但未应用时产生 `data-apply`；应用成功后该通知被标为已读，并产生 `apply-result` 与 `backup-created`（备份存在时）。
5. 点击通知动作跳转到目标页面并把该通知标为已读。
6. 铃铛与菜单弹层互斥；点击面板外或 Escape 关闭。
7. 检查失败（离线/服务器异常）不产生错误通知、不打扰用户。
8. `npm run typecheck` 通过；通知相关定向测试通过。
