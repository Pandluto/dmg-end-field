<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="终末地伤害模拟器图标" />
</p>

<h1 align="center">终末地伤害模拟器</h1>

<p align="center">为《明日方舟：终末地》配装、排轴、伤害计算与本地资料维护打造的桌面工作台。</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS-4b6bfb?style=flat-square" alt="支持 Windows 与 macOS" />
  <img src="https://img.shields.io/badge/技术栈-Electron%20%2B%20React%20%2B%20Vite-2ea44f?style=flat-square" alt="Electron、React 与 Vite" />
  <img src="https://img.shields.io/badge/数据-本地优先-f59e0b?style=flat-square" alt="本地优先" />
</p>

> 这不是自动战斗脚本，也不是在线服务。它把角色、武器、装备、Buff、技能按键、时间轴和伤害结果放进同一个可编辑、可追溯的本地工作流。

## 它能做什么？

| 模块 | 你可以完成的事 |
| --- | --- |
| 配装与计算 | 配置角色等级、潜能、武器、装备、词条与技能等级，查看面板、乘区和伤害结果。 |
| 排轴工作台 | 摆放技能按键、调整时间轴、叠加 Buff 与异常，并回看每一段命中如何影响结果。 |
| 本地资料库 | 维护角色、武器、装备、Buff 与图片资源；数据可编辑、可保存、可导入导出。 |
| AI 协作 | 在受控的本地工作流中查询资料、填写配置、生成提案，并在应用前检查差异与风险。 |

## 为什么是桌面工作台？

排轴与配装并不是一次性算出一个数字：你往往需要反复比较角色状态、技能时序、Buff 来源和目标抗性。终末地伤害模拟器将这些上下文留在本地，让一次配置能够被保存、复看、修改和继续推演。

```text
角色 / 武器 / 装备 / Buff
            │
            ▼
       配装与排轴编辑
            │
            ▼
   技能段、乘区与伤害结果
            │
            ▼
  保存、比较、恢复与继续迭代
```

## 快速开始

需要安装 Node.js 与 npm。日常开发推荐直接启动 Electron Shell：

```bash
npm install
npm run electron:dev
```

该命令会启动 Vite 开发服务和 Electron 桌面壳。若只需要调试 Web 界面：

```bash
npm run dev
```

然后访问 <http://127.0.0.1:3030/>。

### 常用页面

| 页面 | 地址 |
| --- | --- |
| 主工作台 | `/#/` |
| AI CLI | `/#/ai-cli` |
| 角色编辑器 | `/#/operator-studio` |
| Buff、武器与装备编辑 | `/#/buff-sheet`、`/#/weapon-sheet`、`/#/sheet-equipment` |
| 图片管理 | `/#/image-manager` |

## 打包

```bash
# 构建 Web 与嵌入式 OpenCode UI
npm run build

# Windows 便携版
npm run electron:build

# macOS arm64 DMG（需在 macOS 上构建）
npm run electron:build:mac
```

构建产物位于 `release/`，它们属于发布制品，不应提交到 Git。

## AI 与 Work Node

AI 的改动不会直接覆盖当前配置。涉及排轴或高风险内容时，系统会先在隔离的 Work Node 中生成草稿、重建并校验，再提供差异、风险与应用入口。

```text
提出需求 → 隔离修改 → 校验与差异 → 你决定是否应用
```

这套机制让 AI 能协助资料整理和配置推演，同时保留你对最终结果的控制权。详细测试方式见 [DEF Agent 黑盒测试口径](docs/testing/def-agent-blackbox.md)。

## 不只是内嵌一个聊天框

对使用者来说，AI 可以理解当前配置、协助查资料和准备修改；对项目来说，它背后是一条可检查、可回放的本地执行链路。

- **基于 OpenCode 的本地适配**：将 OpenCode 运行时嵌入桌面应用，并针对终末地资料、排轴和配置编辑补上受控工具、会话上下文与权限交互。
- **先在隔离区动手**：涉及排轴和配置的修改先进入 Work Node，而不是直接改动你正在看的结果；应用前能看到差异、校验结果与风险说明。
- **用 Harness 防止“这次碰巧能用”**：典型任务会被固化为场景和回放记录，持续检查工具调用、权限边界与最终状态是否一致。换句话说，AI 的能力不仅要能演示，也要能重复验证。

这让它更像一个面向本地资料与配置工作的 AI 协作层：能做事，但每一步都有边界，也有证据可追。

## 常用开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run electron:dev` | 推荐的日常开发入口：启动 Electron 与 Web。 |
| `npm run dev` | 只启动 Vite Web 开发服务器。 |
| `npm run build` | 构建 Web、嵌入式 OpenCode UI 并执行 TypeScript 检查。 |
| `npm test` | 运行当前核心单元测试与 Work Node codec 测试。 |
| `npm run smoke:work-node-sqlite` | 验证 Work Node、SQLite、REST 与备份恢复链路。 |
| `npm run smoke:ai-cli-rest` | 验证 AI CLI REST 基础链路。 |
| `npm run electron:build` | 构建 Windows 便携版。 |

## 仓库地图

```text
src/                    React 页面、组件、领域逻辑与计算器
electron/               Electron 主进程、预加载与本地能力桥接
agent/runtime/          DEF tools、OpenCode adapter 与 Work Node 运行时
scripts/                构建、数据处理与 smoke 脚本
public/data/            角色、武器、装备等静态资料
docs/specs/             需求、研究、任务与验收记录
docs/testing/           测试口径与验证说明
```

更多入口： [文档导航](docs/README.md) · [Spec 索引](docs/specs/README.md) · [快速上手](docs/guides/quick-start.md)

## 版本与开发分支

`main` 是持续集成的开发主线；每个可发布版本以不可变标签标记，例如 `v1.8.1`。较大的功能从 `main` 创建 `feature/*` 分支，合入后删除；修复使用 `fix/*` 分支。不要再为每个版本长期保留一条 `def-*` 分支。

## 说明

这是一个非官方的个人工具与研究项目，仅用于资料整理、配装推演和开发实践。项目中的名称、内容与素材不代表任何官方立场、组织关系或授权关系。
