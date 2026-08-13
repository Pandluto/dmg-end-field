# Web 页面更新策略与缓存恢复 · Web LTS 合同

## 状态

已实现（2026-08-14 依据代码现状补写）。覆盖提交：`45375ea4`（网络专用缓存恢复路由）、`1eb5fcfd`（根 URL 恢复）、`d0ac4e75`（开发图片缓存绕过）、`817b8780`（规范数据包安装）及页面版本更新体系。

## 目标

页面版本采用"自动检查、用户确认更新"策略：正常启动与受控导航继续使用当前完整安装的 Service Worker 页面壳；联网后只自动读取轻量 `version.json`，不下载、不切换运行文件。发现服务器版本不同时，菜单与设置页才开放更新按钮；用户点击后完整缓存、校验、激活并重新载入。启动文件损坏时的恢复流程仍可主动修复。

## 版本清单

- `/version.json`：`PageVersionManifest`（`schemaVersion: 1`、`releaseVersion`、`shellVersion`）。
- `shellVersion`：16 位十六进制（开发环境为 `development`），由构建生成并写入 `meta[name="dmg-app-shell-version"]`。
- 应用壳缓存命名：`dmg-app-shell-<shellVersion>`。

## 更新检查（pageVersionRuntime）

1. 离线直接失败，不检查。
2. `fetch(version.json?check=<ts>, { cache: 'no-store' })` 拉取最新清单；HTTP 非 2xx 或格式无效即失败。
3. 当前版本判定（优先级）：Service Worker controller 通过 MessageChannel `GET_PAGE_VERSION` 上报（750 ms 超时）→ 缓存壳版本推断 → 文档 meta。
4. 多缓存壳时：存在 waiting worker 则用非最新壳；否则优先文档壳，再取非最新壳。
5. 更新可用 = 存在 waiting worker，或 `releaseVersion` 不同，或可比较的 `shellVersion` 不同。

## 更新执行（serviceWorkerRuntime / usePageVersionUpdate）

- UI 状态机：checking → up-to-date / update-available / check-failed / offline；用户点击后 updating → reloading / update-failed。
- 仅 `update-available` / `update-failed` 允许发起更新；更新进行中忽略重复检查（序列号防竞态）。
- 自动检查间隔 30 分钟；`navigator.onLine` 离线时置 offline 态。
- `reloadLatestPageVersion`：在 registration 的 waiting/installing/active 中寻找与目标 shellVersion 匹配的 worker，等待其进入可激活状态（ready 90 s / control 30 s 超时）→ 激活 → 等待成为 controller → 重新载入页面；`__sw_recovery` 参数参与恢复跳转。
- 激活后新壳完整缓存并校验，失败不伪造已激活状态。

## 缓存恢复

- `/cache-recovery.html`：独立 no-store 恢复页（meta 级禁缓存、noindex），在应用壳或 Service Worker 损坏时提供"检查并重新载入"入口。
- 网络专用恢复路由：Cache Storage 与 Service Worker 无法提供页面时，页面可通过网络专用路径重新获取最新壳（`1eb5fcfd` 将恢复入口回到根 URL）。
- 恢复流程挂到 `window.__DMG_RECOVER_STARTUP__`；`App` 的路由加载失败页（PageLoadFailure）调用它；不存在时退化为 `location.reload()`。
- 启动时若图片包已安装但图片 SW 未接管页面（`ensureImageServiceWorkerController` 失败），启动失败并提示保持联网重试，本地存档不受影响。
- 开发环境：`d0ac4e75` 使开发图片缓存不被陈旧 SW 命中，避免开发期看到旧图。

## 服务端配合

- `/version.json`、`/sw.js`、`/cache-recovery.html`、`/manifest.webmanifest` 与导航请求：`no-store, no-cache, must-revalidate`（Cloudflare Worker 与国内 Nginx 两侧一致）。
- `/sw.js` 响应带 `Service-Worker-Allowed: /`。
- 静态哈希资源（`/assets/*`）一年不可变；用户点击更新后才会完整缓存新壳。

## 验证

- `pageVersionRuntime.test.ts`、`serviceWorkerRuntime.test.ts`、`sitesWorkerRouting.test.ts`（详见 [验证矩阵](../architecture/verification-matrix.md)）。
- `npm run build:web` 后 `check:offline-shell`、`check:offline-workspace` 校验原子壳与离线工作区引导。
