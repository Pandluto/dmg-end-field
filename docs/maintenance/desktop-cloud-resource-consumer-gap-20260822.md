# Desktop Shell 国内资源兼容与 Slimming 下游叠加方案

记录日期：2026-08-22

状态：问题与目标方向已确认，尚未实施。短期必须让 Desktop Shell 与 Slimming 使用同一套服务器资源消费者；中期目标是把 Desktop 重构为 Slimming Web 基线上的单向挂件层。

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

## 架构判断

这不是只补一个下载 URL 就能彻底解决的问题。当前两个长期分支都拥有一份可独立演进的 Web 核心，导致相同页面、SQLite、资源消费者和领域代码不断分叉。

截至 2026-08-22，在共同提交 `622d4cf1` 之后：

- Desktop Shell 有 205 个独立提交，改动过 973 个路径；
- Slimming 有 107 个独立提交，改动过 233 个路径；
- 71 个路径被两边同时修改，其中包括 `src/App.tsx`、`src/main.tsx`、Web Bootstrap、资源清单、SQLite Worker、Timeline、Work Node、路由和发布脚本。

因此，继续把两边视为对等产品分支、再按 Bug 零散互相移植，只会继续扩大维护成本。更合适的目标不是合并成一个发布分支，而是建立明确的上下游关系：

```text
codex/v1.8-lts-slimming
  = 唯一 Web 应用基线、国内部署源、资源消费者真源
                ↓ 单向同步
codex/v1.8-lts-desktop-shell
  = 同一 Web 基线 + Electron/MCP/DEF Agent 宿主与本地运行适配
```

Slimming 不接收 Desktop 专属宿主代码；Desktop 的共享 Web 改动必须先进入 Slimming，再单向同步到 Desktop。MCP、Electron 与 DEF Agent 均应成为可失效、可卸载的挂件，不能反向拥有或复制 Web 核心。

当前 `docs/architecture/lts-branch-contract.md` 中“禁止整分支合并”的规则在迁移完成前继续有效。现有分支交叉修改过多，不能直接执行一次普通 merge 来得到目标架构；目标关系必须通过隔离迁移建立，再修改长期合同。

## 资源下载必须先实现同构

Desktop 与 Slimming 应复用同一份资源通道代码、清单 schema、版本绑定、缓存语义和 SHA-256 校验。两者只允许在传输适配层不同：

- Slimming/Web：继续同源读取 `dmgendfield.cloud` 的 `resources/stable.json` 与版本目录。
- Desktop 开发：Vite `127.0.0.1:3030` 提供一个固定目标的同源代理。
- Desktop 打包：本地宿主 `127.0.0.1:31457` 提供相同代理合同。
- 代理目标只能是固定的 `https://dmgendfield.cloud`，不得接受任意上游 URL，避免把本地宿主变成开放代理。
- 网络不可用时可回退到随应用打包的资源，但界面必须明确显示来源和版本，不能把旧内置数据伪装成服务器最新版。
- 下载的新标准资料保存为独立、带版本号的 Share Data/官方包；未经用户确认不得覆盖正在编辑的资料。

应用层不应到处判断“是否 Desktop”。更稳妥的边界是一个很小的资源传输适配器：Web 适配器返回同源路径，Desktop 适配器返回本地固定代理路径；其上的资源通道、安装流程和 UI 完全共用。

## MCP 作为挂件的边界

MCP 不应成为 Desktop 复制 Web 应用的理由。目标边界应满足：

- MCP/Agent Host 独立运行，通过带能力令牌的 loopback API 与浏览器工作台通信；
- Web 核心只依赖一个可选的 Host Capability 接口，不直接依赖 Electron、Node.js 或 MCP 实现；
- MCP 页面、命令和桥接代码按能力惰性加载；Host 不存在或启动失败时，普通工作台仍可完整使用；
- Desktop 专属代码集中在 `electron/`、`agent/`、宿主桥接和构建入口，不在共享组件中复制业务逻辑；
- 如果共享 UI 需要扩展点，先在 Slimming 基线上设计通用插槽，再由 Desktop 注册 MCP/Agent 功能。

## 建议迁移顺序

1. **资源同构**：先把 Desktop 数据/图片下载切到 Slimming 同一资源消费者，并补齐开发与打包宿主代理。这是当前可独立验收的缺口。
2. **建立挂件接口**：收敛 Desktop Marker、MCP 与 Agent 的散落判断，形成资源传输、Host Capability、可选路由/命令三个小接口。
3. **建立候选下游分支**：从当时最新 Slimming 提交新建隔离候选分支，只重放 Electron、MCP、DEF Agent、Desktop 打包和必要适配；现有 Desktop 分支保留为回滚点，不改写历史。
4. **消除共同文件分叉**：逐项对照当前 71 个双边修改路径。领域、SQLite、交互和资源消费者以 Slimming 为真源；确需 Desktop 差异的行为移到挂件接口后再接入。
5. **双端验收后切换**：验证浏览器站点、Desktop 本地服务器、打包 Desktop、MCP、Agent、SQLite 导入导出和统一资源 ZIP 后，再决定是否让候选分支接替现有 Desktop Shell。
6. **建立长期门禁**：CI 检查 Desktop 相对 Slimming 的差异只出现在允许的挂件路径或明确的适配入口；共享修复必须先进入 Slimming，再单向同步。

这一路线不要求把两个发布分支合并为一个，也不需要强推或重写现有分支历史。它把“专业能力分支”从两份应用，改成一个应用基线加一个专业宿主层。

## 建议验收点

- 本地开发服务器和打包后的 Desktop Shell 均能发现同一个 `.cloud` 稳定版本。
- 数据清单、图片清单和实际文件必须属于同一个 `releaseVersion`，且完成体积与 SHA-256 校验。
- 断网时仍可使用内置资源，不会破坏已有 SQLite、Local Data 或 Share Data。
- 下载新版本只产生可明确应用的数据包；未经用户确认不覆盖当前资料。
- 国内 Web/PWA 继续使用同源资源，不受 Desktop 专属代理影响。
- 在同一 Slimming 基线提交上，Web 与 Desktop 的普通工作台行为一致；关闭所有 Host Capability 后仍能通过核心回归。
- MCP 或 Agent Host 启动失败不阻塞普通工作台，且不会把 Electron、Node.js 或 MCP 运行时代码打进国内 Web 产物。
- Desktop 相对 Slimming 的长期差异可以由机器检查，新增共享文件分叉会在 CI 中失败。
