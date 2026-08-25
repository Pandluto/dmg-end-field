# 移动端 QR 战术分享与分享服务 · Web LTS 合同

## 状态

已实现（2026-08-14 依据代码现状补写）。覆盖提交：`843f05f7`（QR 战术报告分享）、`e9da3e38`（永久分享）、`29226df7`（后端加固）及后续修复。

## 目标

手机版工作台生成战术报告后，可把队伍、配装、排轴、Buff 与报表批注打包成一份**永久有效的分享**；接收方通过 /mobile 分享链接或扫描二维码图片导入本机存档。分享由国内服务器 sidecar 提供，海外 Sites 构建默认不启用创建能力。

## 分享数据契约

- `MobileSharePayload`：`schemaVersion: 1`、`dataVersion`（≤ 80 字符）、`imageVersion`（≤ 80 字符）、`draft`（`schemaVersion: 1`）。
- draft 约束：`selectedOperatorIds` ≤ 4；`slots` ≤ 128；`operatorConfigs` 为对象；`reportNotes` ≤ 128 条、每条 ≤ 160 字符。
- 内容上限：`MOBILE_SHARE_MAX_PAYLOAD_BYTES = 256 KB`（请求体另有 16 KB 余量）。
- 分享 ID：16 位 `[A-Za-z0-9_-]`（`randomBytes(12).toString('base64url')`）。
- 新二维码 URL：`https://dmgendfield.cloud/mobile?share=<id>`，不再依赖扫码浏览器猜测入口；历史 `/share/<id>`、`/mobile?share=<id>`、`#/share/<id>` 与文本前缀 `DEFMS1:<id>` 仍接受。手机打开旧 `/share/<id>` 或旧 hash 地址时，入口脚本会立即规范化到 `/mobile?share=<id>`；桌面打开旧 `/share/<id>` 仍进入桌面节点树导入预览。

## 服务端（server/mobile-share-server.mjs）

### 接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | `/api/mobile-shares` | 创建分享；相同 payload（SHA-256 去重）返回既有分享（`reused: true`，HTTP 200），新分享返回 HTTP 201 |
| GET | `/api/mobile-shares/:id` | 读取分享；不存在返回 404 `SHARE_NOT_FOUND` |
| GET | `/api/mobile-shares/health` | 健康检查 + `stats`（总数、24h 创建数） |
| OPTIONS | `/api/mobile-shares` | 204 预检放行 |

错误统一为 `{ code, message }` + `no-store`，不泄漏堆栈。`content-type` 非 JSON 返回 415。

### 永久性

- 所有分享 `expires_at = 0`，无过期；历史带过期时间的行在启动时统一改为永久。
- 重复内容直接复用既有分享，不新增行（唯一索引 `mobile_shares_payload_hash`，历史空 hash 行启动时回填）。

### 限流（24 小时滑动窗口）

- 每设备（设备 token）：3 份；每 IP：10 份；全局：100 份。
- 超出返回 429（`DEVICE_DAILY_LIMIT` / `IP_DAILY_LIMIT` / `DAILY_LIMIT`）。
- IP 与设备 ID 都经 identity salt 哈希后存储，不存明文。

### 设备标识

- Cookie：`dmg_share_device`，值为 `<deviceId>.<HMAC-SHA256 签名>`（base64url，43 字符签名）。
- 属性：`HttpOnly`、`SameSite=Lax`、`Path=/api/mobile-shares`、Max-Age 365 天、HTTPS 下追加 `Secure`。
- 签名密钥为 SQLite meta 中的随机 secret；签名校验用 `timingSafeEqual`。无合法 token 时签发新设备。

### 存储

- SQLite STRICT 表（`mobile_shares`、`mobile_share_creation_events`、`mobile_share_meta`）；`WAL`、`busy_timeout 5000`；创建在事务中完成。
- 运行方式：独立 `npm run share:serve`（默认 127.0.0.1:8787，`DEF_MOBILE_SHARE_DB` 指定数据库）；开发模式由 Vite 插件挂载（`DEF_MOBILE_SHARE_DB` 可覆盖，默认 tmpdir）；国内部署拓扑 Caddy → Nginx 8080 → 8787。
- 部署纪律（见 ops/mobile-share/README.md）：换代码不换 SQLite；stage 新服务文件并保留旧文件；健康检查需过 8787、8080、公网三路；`/api/mobile-shares` 必须 `no-store`。

## 客户端（src/mobile/mobileShare.ts 等）

- 开关：`__DEF_MOBILE_SHARE_ENABLED__` 构建注入。开发默认开启；Sites 构建默认关闭；`DEF_MOBILE_SHARE_ENABLED=1` 可强制开启。
- 创建：报表页把当前 draft + 数据/图片版本 POST 到 `https://dmgendfield.cloud/api/mobile-shares`；线上站点为同源，本地 3030 与桌面壳 31457 由国内节点的精确 CORS 白名单放行。返回 `reused` 时提示"已复用相同内容的永久二维码"。
- 二维码：qrcode 库生成（纠错 H、边距 2、320px、深色 `#172d32` / 浅色 `#ffffff`），随报表导出进入画布（导出的图片中包含二维码）。
- 导入（MobileShareImporter）：新二维码直接打开 `/mobile?share=<id>` 并自动进入移动导入预览；手机打开旧 `/share/<id>` 时先规范化到同一手机路由，桌面打开旧路径则进入完整节点树预览。两端都需用户确认后才导入。也可选择图片文件（≤ 24 MB），用 jsqr 在整图、右侧 60%、中央横条三个区域解码（`inversionAttempts: 'attemptBoth'`），历史格式仍会并发查询国内与退役海外节点。
- 导入结果写入本机存档（加入排轴、配装、Buff 与批注），不覆盖既有存档。

## 边界

- 分享不等同于完整数据库备份；只有工作区快照（draft + 批注）。
- 海外 Sites 构建不启用创建，但读取端（fetchMobileShare）在部署了 sidecar 的站点可用。
- 限流是正常协作约束，不是恶意防护；服务无账号体系。
