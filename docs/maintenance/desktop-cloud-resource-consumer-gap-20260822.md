# Desktop Shell 国内资源通道兼容缺口

记录日期：2026-08-22

状态：已确认，暂缓实现。该问题不阻塞 Desktop Shell 制作统一资源 ZIP，也不改变当前国内发布流程。

## 现象

在 `codex/v1.8-lts-desktop-shell` 运行 `npm run dev` 后，基础数据与图片下载仍读取当前分支 `public/` 中的相对路径：

- `web-data-manifest.json`
- `web-image-manifest.json`
- 清单中列出的本地数据、图片和压缩分片

因此，本地 `127.0.0.1:3030` 工作台不会自动读取 `https://dmgendfield.cloud/resources/stable.json`，也不会发现国内服务器上的最新稳定资源版本。

`npm run dev` 会重新生成本地 Web 数据清单并写入当前应用版本和生成时间，但这不会更新底层 `public/data/default-local-data.json`。清单看起来较新，并不能证明其中的数据是服务器最新版。

## 已核对事实

- Desktop Shell 与 Slimming 的最近共同提交是 `622d4cf1`，提交时间为 2026-08-06。
- Slimming 在 2026-08-11 的 `817b8780` 中完善标准数据安装，随后在 `62a7f160` 中加入 `resources/stable.json` 统一服务器资源通道。
- 这些资源消费者变更只存在于 Slimming；Desktop Shell 后来同步的是统一资源 ZIP 的生产与校验能力，并未同步服务器稳定通道消费者。
- 2026-08-22 检查时，国内稳定通道指向 `20260820.212429.c5dd6be2c082`，标准数据版本为 `20260820.212429.0d0a9409`。
- Desktop Shell 内置 `public/data/default-local-data.json` 的来源时间是 2026-08-09。与国内稳定版本相比，7 位干员资料不同：`chr_0007_ikut`、`chr_0021_whiten`、`chr_0022_bounda`、`chr_0023_antal`、`guanliyuan`、`linuo`、`peilika`；共享排轴集合也不同。
- `dmgendfield.cloud` 的静态资源响应当时没有返回允许本地源访问的 `Access-Control-Allow-Origin`。仅把前端 URL 改成绝对 `.cloud` 地址，会被浏览器 CORS 拦截。

## 后续实现建议

需要实现时，按最小行为移植，不整分支合并：

1. 将 Slimming 的稳定通道解析、版本绑定及 SHA-256 完整性校验移植到 Desktop Shell。
2. 为 Vite `127.0.0.1:3030` 和打包桌面端 `127.0.0.1:31457` 增加固定目标为 `dmgendfield.cloud` 的同源资源代理，避免开放任意代理或依赖宽泛 CORS。
3. 联网时优先读取服务器稳定通道；网络不可用时允许回退到随应用打包的本地资源，并明确显示来源与版本。
4. 下载到的新标准资料应保存为独立、带版本号的 Share Data/官方包；不得自动覆盖用户当前正在编辑的资料。
5. 保持发布职责不变：Desktop Shell 生成并校验 `dmg.resource-release.v1` ZIP，Slimming 负责物化、构建并部署到 `dmgendfield.cloud`。

## 建议验收点

- 本地开发服务器和打包后的 Desktop Shell 均能发现同一个 `.cloud` 稳定版本。
- 数据清单、图片清单和实际文件必须属于同一个 `releaseVersion`，且完成体积与 SHA-256 校验。
- 断网时仍可使用内置资源，不会破坏已有 SQLite、Local Data 或 Share Data。
- 下载新版本只产生可明确应用的数据包；未经用户确认不覆盖当前资料。
- 国内 Web/PWA 继续使用同源资源，不受 Desktop 专属代理影响。
