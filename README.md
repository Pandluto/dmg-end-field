<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="终末地伤害模拟器图标" />
</p>

<h1 align="center">终末地伤害模拟器</h1>

<p align="center">为《明日方舟：终末地》配装、排轴、伤害计算与本地资料维护打造的桌面工作台。</p>

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-Electron-47848F?style=flat-square" alt="Electron 桌面壳" />
  <img src="https://img.shields.io/badge/AI_Runtime-OpenCode-111827?style=flat-square" alt="内置 OpenCode Runtime" />
  <img src="https://img.shields.io/badge/Agent_Runtime-Typed%20Tools%20%2B%20Harness-7C3AED?style=flat-square" alt="Typed Tools 与 Harness" />
  <img src="https://img.shields.io/badge/Timeline_Repository-SQLite-003B57?style=flat-square" alt="排轴 SQLite Repository" />
</p>

> 这不是自动战斗脚本，也不是在线配装网站。它把角色、武器、装备、Buff、技能按键、时间轴和伤害结果组织成可保存、可回看、可分享的本地方案；AI 的修改先成为草稿，再由你决定是否应用。

从一次试配开始，换一件装备、改一个按键，整套排轴都得重算。我们想留下每次试错，让 AI 代劳繁琐操作，判断始终交给你。

## 可验证的 AI 协作能力

对使用者来说，你可以让 AI 查资料、准备配装或调整排轴，但它不会直接覆盖正在使用的方案。复杂修改会先生成一个可检查的草稿，显示差异、校验和风险；确认后才会进入当前排轴。

这条体验背后不是给页面塞进一个聊天框，而是对 OpenCode 运行时做了面向终末地工作流的本地适配：项目内置并启动经构建的上游 OpenCode 源码，为 Workbench 和 AI CLI 分别约束会话、技能与可见能力。

| 机制 | 对你意味着什么 |
| --- | --- |
| 受控工具边界 | AI 只能通过角色、武器、装备、伤害与排轴这几类已定义工具完成任务，不能任意读取项目文件、运行 Shell 或修改未知目录。 |
| Work Node 草稿 | 排轴改动写入隔离子节点；它带有基线、工作副本、补丁、校验、Diff 和风险信息，不会把试验直接变成正式方案。 |
| 明确应用与回退 | 只有校验和必要确认通过后，草稿才可切换为当前排轴；快照、当前应用目标和审计事件独立保存。 |

### Harness：让能力能复现，而不只是一场演示

Agent 的规则、技能、路由和工作流会被打包为带版本与内容哈希的 Harness。候选改动必须在真实本地会话中回放场景，并与稳定版本比较：目标问题是否从失败变为成功、原本可用的流程是否退化、预览是否意外改动用户状态。裁判输入与 Agent 可见上下文分离，避免为了“通过测试”而记住答案。

它更像一个面向本地资料与配置工作的 AI 执行层：能做事，但每一步都有边界、状态和证据可追。

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

## 排轴数据如何保存？

排轴的正式事实源是桌面应用 AppData 中的 SQLite 文档库，不是浏览器缓存，也不是远程数据库。一份排轴文档由以下对象组成：

```text
TimelineDocument
├─ Snapshot：用户保存的不可变恢复点
├─ Work Node：AI 产生的分支草稿
├─ CheckoutRef：当前已应用的是哪一个版本
└─ Audit Event：保存、恢复、校验、审批与删除证据
```

- 完整配置按内容哈希保存，快照和 Work Node 引用同一份不可变 payload，避免重复且便于校验。
- `localStorage`、`sessionStorage` 与旧 JSON 存档只承担迁移或缓存职责，不作为排轴版本管理的依据。
- 渲染器访问 `127.0.0.1` 的 REST/SSE，是桌面界面、本地 SQLite 与本地 Agent 之间的进程内桥接，不是云端同步。
- 分享时会从本地库组装版本化的可移植包；导入会校验 schema、哈希和引用，再作为新的排轴文档原子写入。
- 图片资源的检查与下载是独立的版本化发布包机制，和排轴数据、Work Node 及 SQLite 文档库互不混用。

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
