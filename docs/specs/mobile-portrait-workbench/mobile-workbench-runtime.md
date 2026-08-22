# 移动端工作台运行时合同 · Web LTS

## 状态

已实现（2026-08-14 依据代码现状补写）。本文描述手机版工作台（/mobile）在首版之上的运行时契约：版本一致性、存档、报表、分享与设备适配。首版产品定位见 [手机版竖屏工作台 Spec](./mobile-portrait-workbench/spec.md)。

## 入口与启动

- 路由：`/mobile`（Cloudflare Worker 将 `/mobile` 与 `/mobile/*` 重写为根页面壳；移动端入口由 `window.__DMG_MOBILE_ENTRY__` 标记触发 `MobileBootstrap`）。
- 启动：访问门禁（AccessGate，mobile 变体）→ 读取线上目录（干员、武器、装备、Buff 与图片）→ 就绪。
- 数据与图片**强制同一版本**：目录从资源通道读取，`dataVersion` 与 `imageVersion` 来自同一 release；图片 URL 追加 `imageVersion` 查询参数并随版本切换。
- 后台每 5 分钟检查一次稳定通道；发现新数据/图片版本时提示更新（不打断当前草稿）。

## 用户规划状态

- 选人（≤ 4）、干员配置、技能排轴（slots）、Hit 微调、Buff 选择/层数/启用、目标抗性、报表批注均为可编辑状态，保存于 localStorage 草稿（`def.mobile-workbench.draft.v1`，schemaVersion 1）。
- 官方资料只读：干员、技能、武器、装备、Buff 定义与图片不能在手机版内编辑。

## 存档

- 存档集合：localStorage `def.mobile-workbench.archives.v1`（schemaVersion 1），每份存档含 `id`、`name`（默认按创建时间命名）、`createdAt`、`updatedAt`、`snapshot`（完整 MobileDraft 归一化克隆）。
- 按 `updatedAt` 降序展示；损坏项在读取时丢弃；写入保持该排序。
- 存档用于：分享导入落盘、报表导出前后快照、跨会话保留队伍方案。

## 报表（MobileReportPage）

- 四车道时间轴：最多 4 个干员各占一车道，空位显示"位置 N"占位；车道应用干员头像与技能色语义。
- 单元格批注：`reportNotes[<slotId>::lane-<laneIndex>]` 存储，每条 ≤ 160 字符（服务端校验同限），窄屏下保持可读。
- 导出：报表（含批注、头像、图表配色）经画布导出为图片；导出前检查浏览器能力。
- QR 分享：生成永久分享二维码并随导出进入画布；相同内容复用既有分享（见 [移动端 QR 分享与分享服务](../mobile-qr-share/spec.md)）。

## 设备适配

- 竖屏优先，但允许横屏与桌面访问；桌面浏览器打开 /mobile 也可使用（54f7fccb、bdc86d43）。
- Buff 编辑器、选人、配置、排轴、报表各页在窄屏/宽屏下的布局由 `MobileApp.css` 响应式规则保证。
- 门禁：AccessGate 移动端变体；与桌面共用 30 天访问凭据（accessLease）。

## 边界

- 手机版不参与桌面 SQLite 数据库；草稿与存档都在 localStorage，分享导入是跨设备唯一入口。
- 官方资料更新由用户明确确认后重新读取，不自动覆盖当前草稿数据。
