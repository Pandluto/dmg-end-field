# 开发与启动

[← 返回项目入口](../../README.md)

本项目的日常入口是 Electron Shell：它同时提供桌面壳和 Web 开发界面。若只调试页面，也可以只启动 Vite。

## 环境准备

安装 Node.js 与 npm 后，在仓库根目录执行：

```bash
npm install
```

## 日常开发

```bash
npm run electron:dev
```

该命令会先构建嵌入式 OpenCode UI，再启动 Vite（`127.0.0.1:3030`）和 Electron Shell。日常开发优先使用这一条；若它已经运行，不要重复启动第二个实例。

在弹出的桌面窗口中点击“打开浏览器界面”，或直接访问 <http://127.0.0.1:3030/>。

## 只调试 Web 页面

```bash
npm run dev
```

这只启动 Vite，不启动 Electron 主进程、本地桥接或桌面 Shell。适合纯界面迭代；需要验证本地数据、图片、AI 或桌面能力时，请回到 `npm run electron:dev`。

## 常用页面

| 页面 | 地址 |
| --- | --- |
| 主工作台 | `/#/` |
| AI CLI | `/#/ai-cli` |
| 角色编辑器 | `/#/operator-studio` |
| Buff、武器与装备编辑 | `/#/buff-sheet`、`/#/weapon-sheet`、`/#/sheet-equipment` |
| 图片管理 | `/#/image-manager` |

## 构建与打包

```bash
# 构建 Web、嵌入式 OpenCode UI，并执行 TypeScript 检查
npm run build

# Windows 便携版
npm run electron:build

# macOS arm64 DMG（需在 macOS 上构建）
npm run electron:build:mac
```

构建产物位于 `release/`，属于发布制品，不应提交到 Git。

## 验证入口

| 命令 | 用途 |
| --- | --- |
| `npm test` | 核心计算与 Work Node codec 测试。 |
| `npm run smoke:work-node-sqlite` | 验证 Work Node、SQLite、REST 与备份恢复链路。 |
| `npm run smoke:ai-cli-rest` | 验证 AI CLI REST 基础链路。 |
| `npm run smoke:operator-config` | 启动 Electron 的干员配置 smoke 验证。 |

关于打包版如何配置角色、排轴、资料和 AI CLI，请看[使用指南](./quick-start.md)。
