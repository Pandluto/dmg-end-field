# def-1.6 迭代清理统计

## 迭代方向

本轮建议将产品形态收敛为：

- 保留：Web 主界面
- 保留：Electron 版 Shell / Agent / AI CLI 相关能力
- 删除：Electron 托管 Web 主界面的桌面端形态
- 删除：MAA / MaaEnd / 桌面捕获自动化相关能力
- 清理：历史 storage/localdata 同步机制
- 清理：历史路由别名和桌面桥接代码

## 已确认的主要遗留

## 2026-06-14 已执行调整

- 已创建并切到 `codex/def-1.6` 分支。
- `npm run electron:dev` 已改为启动 Electron Shell，不再启动 Electron 托管 Web 主界面。
- Electron 托盘和 Shell 控制台已移除“打开主界面 / 收起主界面 / 桌面倍率”等 Web 主窗口入口。
- Electron 主进程已删除 `mainWindow` 相关创建、恢复、隐藏、Web preload bridge 和桌面主窗口 localdata 即时同步链路。
- Web 主界面中的“桌面端未启动”文案已改为 Shell 语义。
- 历史路由别名 `APP_ROUTE_ALIASES` 已删除。
- Shell 控制台已全面升级为“总览 / 服务 / 数据 / 图片 / 日志”结构。
- Shell 总览已新增“打开浏览器 Web”按钮，由本地 bridge 打开浏览器 Web 主界面。
- Shell 默认窗口已从窄面板调整为 1120x760，最小尺寸调整为 900x640。
- Shell 控制台已移除 MAA/捕获/探针相关入口、事件绑定、preload 暴露和主进程 IPC。
- Shell 数据页已重排为“状态栏 / 存档列表 / 操作面板”，避免保存、应用、列表混在同一布局中。
- Shell 数据页用户口径已收敛为“当前数据 / 本机存档 / 共享存档”，不再在界面暴露 `localdata`、`sharedata`、`now-storage` 等实现名。
- Shell 数据页已将本机存档 / 共享存档分栏展示，并支持全部 / 本机 / 共享筛选。
- 应用存档前已新增确认弹窗，可选择先保存当前数据到本机/共享、跳过保存或取消应用。
- 新存档文件名改为 `local-时间-名称.json`、`share-时间-名称.json`、`backup-时间-名称.json`；旧 `localdata-*.json` 继续兼容读取。
- 数据管理短期保留并重做为“当前数据 + 存档管理器”工作流：浏览器 Web 同步当前数据，Shell 保存/应用存档，刷新 Web 后生效。
- 图片管理短期保留为 Web 页面 + Shell 本地图片 bridge；Shell 控制台新增图片桥接状态和图片目录入口。
- 图片资产路径策略已收敛：开发态和打包态的主图片目录统一为 `data/images`，可通过 Shell 添加额外图片根目录。
- 图片 bridge 现在按文件名映射 `/user-images/<文件名>`；旧路径 `/user-images/任意中间目录/<文件名>` 会自动忽略中间目录后兼容访问。
- 图片根目录按优先级解析同名文件：主目录优先，其次配置根目录，最后兼容旧 AppData 图片目录；Shell 图片页会提示重名映射数量。
- Shell 图片页已从“最近资产列表”改为“图片根目录维护”，只展示主目录、配置目录和兼容目录，不再滚动展示大量图片文件。
- `@maaxyz/maa-node` 已从依赖移除，`native/win-capture-helper` 和旧 `electron/shell/index.html` 已删除。
- Shell 模型接口页、Electron Ark/LLM IPC、Web GUI AI 填表入口和弹窗已删除；AI 填表后续收敛到 Agent CLI / AI REST。

验证：

- `node --check public/shell/shell.js`
- `npm run build`

### 1. Electron 桌面端主界面

状态：删除 Electron 托管 Web 主界面；保留 Electron Shell。

涉及位置：

- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/shell/index.html`
- `package.json`
- `package-lock.json`
- `scripts/run-electron-smoke.mjs`
- `scripts/electron-smoke-operator-config.cjs`
- `scripts/desktop-web-host.test.cjs`

确认到的问题：

- `electron/main.cjs` 同时管理 Shell 窗口和 Web 主界面窗口
- 托盘菜单仍有“打开主界面 / 收起主界面”
- Shell 页面仍有“打开主界面”和桌面倍率入口
- `electron:dev` 原先会启动 Electron 托管 Web 主界面
- localdata 桥接会通过 Electron 主窗口读写 Web storage

建议动作：

- 保留 `electron:shell`
- 让 `electron:dev` 指向 `electron:shell`
- 删除 `mainWindow` / `createMainWindow` / `restoreMainWindow` / `hideMainWindow`
- 删除托盘主界面入口
- 删除 Shell 中的“打开主界面”和桌面倍率入口
- 删除 `desktop:open-web` 和主窗口 localdata bridge
- 保留 Shell 所需的 `desktopRuntime` 能力

### 2. MAA / MaaEnd

状态：已删除主链路。

涉及位置：

- `package.json`
- `package-lock.json`
- `electron/main.cjs`
- `electron/shell/index.html`
- `.codex-temp-maa-image.bin`

确认到的问题：

- `package.json` 仍依赖 `@maaxyz/maa-node`
- `electron/main.cjs` 仍 `require('@maaxyz/maa-node')`
- shell 页面文案仍提到 MaaEnd、捕获、OCR、指针自动化
- 根目录存在 `.codex-temp-maa-image.bin`

已执行：

- 删除 `@maaxyz/maa-node`
- 删除 Shell 控制台中的 MAA/捕获/探针入口
- 删除主进程 MAA require、捕获会话函数、捕获 IPC 和探针 IPC
- 删除 preload 中的捕获与 `runAction` 暴露
- 保留 Electron Shell 的非 MAA 能力

### 3. Native 捕获 helper

状态：已删除。

涉及位置：

- `native/win-capture-helper/`
- `native/win-capture-helper/src/WinCaptureHelper.cs`
- `native/win-capture-helper/bin/WinCaptureHelper.exe`
- `native/win-capture-helper/build-helper.ps1`

确认到的问题：

- 该目录明显服务于桌面捕获能力
- 当前方向不再保留桌面端/MAA/捕获自动化

已执行：

- 删除 `native/win-capture-helper/`
- 从 package build files 中移除 `native/**`

### 4. Shell 启动与桌面进程管理

状态：需要重构。

涉及位置：

- `agent/dev-agent.cjs`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/utils/localAgent.ts`
- `public/shell/index.html`
- `public/shell/shell.js`

确认到的问题：

- `agent/dev-agent.cjs` 仍通过 Electron 启动 shell
- 仍有 `/open-shell`、`/close-shell`、`/open-web`
- 主界面底部仍显示“打开Shell / 收起Shell / 桌面端未启动 / 后台待命”
- `public/shell` 依赖 `window.desktopRuntime`

建议动作：

- 明确 Electron 只负责 Shell，不再负责 Web 主界面窗口
- local agent 打开 Shell 时始终使用 `--shell-only`
- Web 主界面不再展示“桌面端未启动”
- Shell 页面保留 `desktopRuntime`，但移除打开主界面和桌面倍率入口

### 5. Storage / localdata 同步机制

状态：已从“Electron 主窗口即时同步”改为“当前数据 + Shell 存档管理器”的异步工作流。底层仍使用 now-storage 文件中转，但界面只表达当前数据、本机存档、共享存档。

涉及位置：

- `src/utils/localDataBridge.ts`
- `src/main.tsx`
- `src/App.tsx`
- `public/shell/index.html`
- `public/shell/shell.js`
- `data/localdata/`
- `data/sharedata/`

确认到的问题：

- 当前没有活跃 `/storage` React 路由
- 旧 storage 功能实际沉淀为 Shell 的“数据存档”页
- `src/main.tsx` 启动时仍执行 `bootstrapLocalDataBridge()`
- localdata 机制依赖 `http://127.0.0.1:31457/local-data/...`
- 存在 `now-storage.json`、`now-storage-state.json`、`active-localdata.json`
- 用户可见命名已收敛，底层文件名和目录名保留用于兼容旧存档。

建议动作：

- 保留 `localDataBridge.ts` 的 now-storage 生成与应用能力
- 删除或重命名旧“desktop import/export”语义
- 保留 Shell 数据页，但只表达当前数据、本机存档、共享存档、刷新 Web 生效
- 新保存文件名使用 `local-...`、`share-...`、`backup-...` 前缀，避免资源管理器中全是 `localdata-*.json`
- 清理 `data/localdata`、`data/sharedata` 中确认无用的运行态文件，不能直接删除用户存档

保留项：

- `src/utils/storage.ts`
- `src/types/storage.ts`
- `src/constants/storage-keys.ts`

说明：这些是业务状态层，不是遗留页面，不能按 storage 页面直接删除。

### 6. 遗留路由和历史别名

状态：建议清理。

涉及位置：

- `src/utils/appRoute.ts`
- `src/App.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`

当前主路由：

- `/`
- `/operator-studio`
- `/buff-sheet`
- `/weapon-sheet`
- `/sheet-equipment`
- `/operator-config`
- `/damage-sheet`
- `/image-manager`
- `/ai-cli`

历史别名：

- `/draft`
- `/character-studio`
- `/buff-studio`
- `/buff-draft`
- `/sheet-buff`
- `/sheet-weapon`
- `/equipment-sheet`
- `/sheet`

建议动作：

- 删除 `APP_ROUTE_ALIASES`
- 保留 `/ai-cli`
- 评估是否删除 `/image-manager`
- 业务编辑页是否继续保留，按产品范围决定

### 7. 图片管理页

状态：短期保留，定位为 Web 图片管理页 + Shell 本地图片 bridge。

涉及位置：

- `src/components/ImageManagerPage.tsx`
- `src/components/ImageManagerPage.css`
- `src/components/ImageManager/`
- `src/utils/imageBridge.ts`
- `src/utils/assetHostApi.ts`
- `docs/image-manager-architecture.md`

确认到的问题：

- 图片管理支持 `electron`、`web-bridge`、`browser-readonly` 多模式
- 仍存在 `electron-writable`、`electron-readonly` 文案和样式
- 大量操作依赖 `window.desktopRuntime`
- 文档仍写明 Electron preload/main 提供桌面桥接

建议动作：

- 保留 `/image-manager`
- 将 `electron-writable`、`electron-readonly` 等文案改为 Shell bridge / Browser readonly 语义
- 评估 `src/utils/assetHostApi.ts` 是否为旧路径，若未被当前页面使用则清理
- 后续如要完全 Web 化，再把图片管理迁到明确的 Web API

### 8. Web 页面中的桌面桥调用

状态：需要清理。

涉及位置：

- `src/vite-env.d.ts`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/components/EquipmentSheetPage.tsx`
- `src/components/BuffDraftPage.tsx`
- `src/components/ImageManagerPage.tsx`
- `src/utils/imageBridge.ts`
- `src/utils/assetHostApi.ts`

确认到的问题：

- `window.desktopRuntime` 类型仍存在
- 装备页通过桌面桥读写装备库
- Buff AI 填充通过桌面桥读取模型配置和调用模型
- 图片管理大量依赖桌面桥

建议动作：

- 将模型调用收敛到 AI REST / Web Shell
- 装备库保存改为浏览器 localStorage 或 Web API
- 图片管理不再走 desktopRuntime
- 最后删除 `DesktopRuntimeBridge` 类型

## 建议删除清单

高确定性删除：

- `.codex-temp-maa-image.bin`
- `native/`
- `scripts/run-electron-smoke.mjs`
- `scripts/electron-smoke-operator-config.cjs`
- `scripts/desktop-web-host.test.cjs`
- `@maaxyz/maa-node`

高确定性保留：

- `electron/`
- `electron`
- `electron-builder`
- `electron:shell`

高确定性修改：

- `package.json`
- `package-lock.json`
- `src/main.tsx`
- `src/App.tsx`
- `src/utils/appRoute.ts`
- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `agent/dev-agent.cjs`

待决策：

- `public/shell/`
- `src/components/ImageManagerPage.tsx`
- `src/components/ImageManager/`
- `src/utils/imageBridge.ts`
- `src/utils/assetHostApi.ts`
- `data/localdata/`
- `data/sharedata/`

## 推荐执行顺序

1. 收缩 Electron 主进程为 Shell 宿主
2. 删除 MAA / native / smoke 脚本
3. 清理 `package.json` 和 lockfile
4. 移除 Web 启动链路中的 `localDataBridge`
5. 清理主界面中的桌面端状态和 shell 按钮逻辑
6. 删除历史路由别名
7. 决定 `/image-manager` 去留
8. 执行一次 `npm run build` 验证

## 风险点

- `localDataBridge` 当前仍在 `main.tsx` 启动链路中，不能只删文件不改入口。
- `desktopRuntime` 调用分散在多个业务页；保留 Shell 能力时不能整体删除，需要逐项区分。
- 图片管理页与桌面桥绑定较深，不建议半删。
- `data/localdata` 和 `data/sharedata` 可能包含用户手工保存数据，删除前需要确认是否仍有保留价值。
- `package-lock.json` 需要通过 npm 重新生成，避免手改残留依赖。

## 初步结论

`/storage` 路由本身已经不是活跃路由，可以视为已废弃；真正需要在 def-1.6 清理的是 storage/localdata 同步机制、Electron 托管 Web 主界面、MAA 依赖、native 捕获 helper、历史路由别名，以及非 Shell 必需的 `desktopRuntime` 桥接调用。
