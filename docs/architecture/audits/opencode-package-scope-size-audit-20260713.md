# OpenCode 生产打包范围与包体审计（2026-07-13）

## 结论

当前生产打包**不能认定为“仅打包所需内容”**，也不能用现有 `release/` 的 454.86 MB portable 文件作为当前代码的发布体积基线。

原因有三个，按优先级排序：

1. 现有构建产物是 2026-07-04，早于当前 OpenCode UI 和 runtime（均为 2026-07-12）；它没有包含 `agent/runtime/opencode-ui`，已过期。
2. 生产启动的 `scripts/ai-cli-rest-server.mjs` 依赖 Vite 动态加载 `src/*.ts`，但当前 `build.files` 不包含 `src/**`、`vite.config.ts` 或 Vite。因此当前“最小清单”会使 AI CLI REST sidecar 在打包版中缺少运行前提；先删依赖会扩大故障。
3. 当前 runtime 保留两份约 132 MB 的 OpenCode Windows 二进制；manifest 指向版本化二进制，旧的 `opencode.exe` 只是 fallback，却会被 `agent/runtime/**` 一并打进包。

推荐顺序是：**先产出独立的 production sidecar，再缩小依赖和 runtime 清单，最后重新构建并以新产物测量**。不要直接在现有 files 规则上继续排除文件。

## 审计范围与证据

审计读取了：

- `package.json` 的 `build.files`、`asarUnpack` 和 `compression`；
- `scripts/build-opencode-runtime.mjs`、`scripts/build-opencode-ui.mjs`；
- `electron/main.cjs`、`agent/server/def-agent-server.cjs` 与 sidecar 启动链；
- 当前 `agent/runtime/`；
- 已存在的 `release/win-unpacked` 与 portable 文件。

本轮未重新打包，不修改运行时代码或打包配置。

> 更新（2026-07-13）：后续已落实本审计中的无争议裁剪并完成 Windows portable 构建。以下“执行结果”覆盖这句历史记录；production sidecar bundle 缺口仍未解决。

## 执行结果：清理旧包体后的 Windows portable 构建

已删除旧 `release/`，然后成功运行 `npm run electron:build`。构建包含 Web/TypeScript build、OpenCode runtime build、OpenCode binary smoke 与 `electron-builder --win portable`。

| 项目 | 旧产物 | 新产物 | 变化 |
| --- | ---: | ---: | ---: |
| portable 下载文件 | 454.86 MB | **105.71 MB** | -349.15 MB（-76.8%） |
| `win-unpacked` 展开体 | 454.22 MB | **443.10 MB** | -11.12 MB（-2.4%） |
| `app.asar` | 37.78 MB | 67.58 MB | +29.80 MB；当前含 OpenCode UI。 |
| `app.asar.unpacked` | 132.31 MB | 132.49 MB | 单一 OpenCode binary。 |
| `locales/` | 41.58 MB（55 个） | 0.49 MB（仅 `zh-CN`） | -41.09 MB。 |

完成的裁剪：

- `compression` 从 `store` 改为 `normal`；portable 文件因此远小于展开体。
- `electronLanguages` 固定为 `zh-CN`。
- runtime build 在复制 manifest 指向的版本化 binary 后清理旧版本和无版本 fallback。
- 生产包排除 codec test 与 adapter README。

核验结果：

- source 与 packaged runtime 都仅保留 `opencode-1.17.11.exe`；
- `app.asar` 含 859 个 `opencode-ui` 条目；
- packaged OpenCode binary 执行 `--version` 成功，输出 `0.0.0-def-1.8-win-202607130229`；
- 本次只完成构建和 runtime binary smoke，尚未替代 production sidecar / AI CLI 的完整启动验收。

## 当前与旧产物的体积

### 旧 Windows 产物（仅作历史参照）

| 项目 | 大小 | 说明 |
| --- | ---: | --- |
| `release/dmg-end-field 1.7.1.exe` | 454.86 MB | 2026-07-04 的 portable 文件。 |
| `release/win-unpacked` | 454.22 MB | portable 文件几乎等于 unpacked，见 compression 结论。 |
| `resources/app.asar` | 37.78 MB | 应用脚本、Web 产物与 Node 依赖。 |
| `resources/app.asar.unpacked` | 132.31 MB | 其中 131.52 MB 是 OpenCode 二进制。 |
| `locales/` | 41.58 MB | 55 个 Chromium 语言包。 |
| 主 Electron exe | 191.91 MB | Chromium / Electron 平台成本。 |

该产物没有 `agent/runtime/opencode-ui` 条目，因而不能证明当前嵌入式 DEF OpenCode UI 的实际包体。

### 当前源码中将被选入的主要内容

当前 `build.files` 明确包含 `dist/**`、`electron/**`、两个 runtime script、`agent/server/**` 和 `agent/runtime/**`，并排除 `agent/vendor/**` 和 `agent/dev-agent.cjs`。

| 目录 | 源码大小 | 判断 |
| --- | ---: | --- |
| `dist/` | 5.90 MB | 必需：已构建 Web。 |
| `electron/` | 0.64 MB | 主要必需；当前 `electron/**` 也会带入少量非当前平台文件。 |
| `agent/server/` | 0.05 MB | 必需：本地 DEF agent server。 |
| `agent/runtime/opencode-ui/` | 27.47 MB | 必需：当前嵌入式原生 OpenCode UI。 |
| `agent/runtime/opencode-core/` | 263.19 MB | 含两份 Windows 二进制，存在严重冗余。 |
| 其余 `agent/runtime/` | 0.18 MB | skills、typed tools、codec、adapter；基本必需。 |
| 旧产物中的 production `node_modules/` | 31.61 MB | 大部分是前端构建依赖的重复随包。 |

在清理双份 binary 前，按当前源目录直接重新打 Windows portable 的未压缩展开体曾估算为 **610–615 MB**：

```text
旧 unpacked 454.22 MB
+ 当前缺失的 OpenCode UI 27.47 MB
+ 当前多出的版本化 OpenCode binary 131.67 MB
≈ 613 MB（构建结果需复测确认）
```

## 必需性审查

### 确认应保留

- `dist/**`：Electron/Web host 直接提供构建后的 React 资源。
- `electron/main.cjs`、preload、repository 与 web host：Electron 主流程需要。
- `agent/server/def-agent-server.cjs`：`electron/main.cjs` 启动 DEF agent server。
- `agent/runtime/opencode-ui/**`：agent server 从该目录提供嵌入式 UI；不能按“只是静态资源”删除。
- manifest 所指向的单一 OpenCode 二进制：adapter 必须启动本地 OpenCode server。
- DEF skills、typed tool registry、plugin、codec：原生 OpenCode tool loop 需要。
- `scripts/build-image-release-manifest.mjs`：主进程在运行时调用。

### 当前确认不应作为最终生产内容保留

| 内容 | 证据 | 建议 |
| --- | --- | --- |
| `agent/runtime/opencode-core/bin/win32-x64/opencode.exe` | 当前 manifest 指向 `opencode-1.17.11.exe`；adapter 先读 manifest，仅把无版本文件当 fallback。 | 在 runtime build 后清理旧 fallback/旧版本，只保留 manifest 指向的文件。预计节省约 131.52 MB。 |
| `agent/runtime/def-node-workspace/codec.test.mjs` | 仅由 `npm test` 调用。 | 在 `build.files` 排除。体积很小，但能保证生产树只含运行时。 |
| `agent/runtime/def-opencode-adapter/README.md` | 运行时不读取。 | 在 `build.files` 排除。体积很小。 |
| Electron 非目标平台的小型文件 | `electron/**` 会同时带入 Windows 不需要的 mac entitlements/icon，反之亦然。 | 改为平台专属 files 配置；收益很小，作为清单卫生处理。 |

### OpenCode UI：不能手工删除 assets

当前 UI 目录有 840 个 asset 文件（27.47 MB），其中 JS 为 22.82 MB，包含大量按语言加载的 Shiki/编辑器块和字体。它看起来很大，但原生 diff、Markdown、代码文件查看和语法高亮会按需加载这些 chunk。

在没有上游 build 配置和真实 UI 路由覆盖测试前，不能通过手工删语言文件来瘦身：Vite manifest/chunk import 会在运行时指向它们。若后续需要缩减 UI，应在 vendored OpenCode 构建中定义 DEF 支持的语言/字体集合，再执行完整 diff、Markdown 与 tool card 回归；这是独立实现任务，不是安全的清单调整。

## 生产 sidecar 缺口（阻断项）

`electron/main.cjs` 在打包版也会启动 `scripts/ai-cli-rest-server.mjs`。该脚本静态导入 `vite`，随后用 `vite.ssrLoadModule()` 动态加载：

- `src/aiCli/aiCliRestAdapter.ts`；
- `src/aiCli/buffFillAdapter.ts`；
- `src/aiCli/aiCliAgentInfrastructure.ts`；
- `vite.config.ts`。

但是当前 `build.files` 不包含 `src/**`、`vite.config.ts`；Vite 本身属于 `devDependencies`，旧 `app.asar` 也没有 `node_modules/vite`。这意味着当前最小清单不能独立启动该 sidecar。

正确方向不是把完整 `src/**` 与整个 Vite 工具链塞入发布包，而是为 sidecar 建立生产 bundle：

```text
TypeScript sidecar source
  → production bundle（含必要 adapter/codec）
  → Electron 主进程启动 bundle
  → 发布包只保留 bundle + 真正的运行时资产
```

完成 bundle 后再验证哪些 package dependencies 仍被 Node runtime 直接 require。当前旧包中约 31.61 MB 的 `node_modules` 主要来自 `exceljs` 及其 transitive dependencies；这些包的已知使用点在 `src/` 前端构建路径，不能在未 bundle sidecar 前直接判定全部可删，但它们是下一阶段最有价值的清理候选。

## 包体优化优先级

| 优先级 | 动作 | 预期收益 | 风险与验收 |
| --- | --- | ---: | --- |
| P0 | 编译 production sidecar，移除运行时对 Vite 与 `src/**` 的依赖 | 先修正确性 | 打包版启动 AI CLI REST、Workbench AI、工具调用与历史恢复。 |
| P0 | runtime build 只保留 manifest 指向的 OpenCode binary | 约 131.5 MB | 构建后核对 manifest/checksum，启动 OpenCode、创建会话并执行一次 tool call。 |
| P1 | 设置 Windows `electronLanguages` 为实际支持语言，例如 `zh-CN` 与 `en-US` | 约 40.6 MB | 验证应用启动、中文/英文 UI 与错误提示；确认产品不承诺其他 Electron UI 语言。 |
| P1 | 在 sidecar bundle 后审查 production `node_modules`，把纯前端构建依赖从发布包移除 | 最多约 31.6 MB（需复测） | 启动 Shell、AI CLI、导入导出、伤害 Excel 与所有动态模块。 |
| P2 | 将 `compression: store` 改为 `normal` 或发布渠道专属压缩策略 | 降低下载文件大小，展开体不变 | 用实际 portable 构建测量启动时间与大小；不对节省量做预估承诺。 |
| P3 | 定制 OpenCode UI 的语言/字体 build | 取决于支持集合 | 上游构建改造，必须做 native UI/diff/Markdown 回归。 |

实际构建表明，保留一份 binary、裁掉 locale 并加入 OpenCode UI 后，Windows unpacked 为 **443.10 MB**；portable 因 `normal` 压缩已降至 **105.71 MB**。生产 sidecar bundle 和 production `node_modules` 清理仍可继续降低展开体，但不能再把“portable 已低于 300 MB”与“安装后展开体低于 300 MB”混为一谈。

## 后续验收口径

每次调整后在干净输出目录运行 `npm run electron:build`，记录：

1. portable 文件、`win-unpacked`、`app.asar`、`app.asar.unpacked`、`locales` 的大小；
2. `app.asar` 与 unpacked tree 中的 OpenCode binary 数量、路径、manifest 与 checksum；
3. 打包版 Shell、Web、AI CLI REST、Workbench AI、OpenCode UI、node workspace rebuild、permission/use 的启动与最小闭环；
4. 已安装/展开体与下载文件大小分开报告；
5. 与上一版的体积差和保留/移除依据。

在 production sidecar 被 bundle 前，不应宣称当前 package files 是最小且可用的生产清单。
