# dmg-end-field

> 地表作业终端 / 本地战斗配置、排轴与数据编辑工作台

`dmg-end-field` 是一个面向《明日方舟：终末地》相关资料整理的本地工作台。它把干员、武器、装备、Buff、技能按钮、时间轴和伤害计算集中到同一套 Web 界面，并提供 Electron Shell、存档管理、图片资源管理和受控的本地 AI 工作流。

它不是在线服务，也不是自动战斗脚本；设计重点是让一套配置能够被编辑、计算、保存、比较、恢复和继续迭代。

## 这套工具解决什么

- 整理干员、武器、装备与 Buff 的本地资料和草稿。
- 在主界面配置角色、放置技能按钮、调整时间轴、叠加 Buff 与异常。
- 从面板、命中段、Buff 乘区一路追溯到伤害结果。
- 保存、恢复、分享本地排轴和配置，避免修改后失去来路。
- 通过 AI CLI 处理受约束的数据填表、资料查询、校验和修复。
- 通过主界面 AI 模式在隔离 Work Node 中审查排轴改动，再决定是否应用。

## 核心能力

| 工作区 | 作用 |
| --- | --- |
| 主界面 / 排轴 | 选择干员、配置技能按钮、Buff、目标抗性与时间轴，查看技能详情和伤害结果。 |
| 角色配置 | 编辑角色等级、潜能、属性、武器、装备、词条与技能等级。 |
| 数据编辑页 | 维护干员、武器、装备和 Buff 数据；装备支持导入导出。 |
| 伤害与报告 | 查看伤害表、面板计算与可导出的报告数据。 |
| 图片管理 | 管理本地图片资源、图片根目录和 Shell 侧图片更新。 |
| AI CLI | 用受控命令完成数据填表、校验、提案与保存。 |
| DEF OpenCode | 在 Workbench 与 AI CLI 两个隔离宿主中复用原生对话、tool、diff、question 与 permission 交互。 |

## 两种运行方式

```text
Web 开发模式
  Vite dev server (127.0.0.1:3030)
  └─ 直接调试主界面、编辑页和本地浏览器存储

Electron Shell 模式
  Electron Shell + Vite Web
  ├─ 本地存档、图片与运行时管理
  ├─ 打开浏览器 Web 主界面
  └─ 托管本地 DEF OpenCode / AI runtime
```

日常开发以 `npm run electron:dev` 为主。它会启动 Vite 与 Electron Shell；如果 3030 已在监听，复用现有进程，不要随意重启常驻开发实例。

## 快速开始

### 环境

- Node.js 与 npm
- Windows 开发 Electron 便携版；macOS 构建需要对应本机签名/打包环境

### 安装与启动

```bash
npm install

# 只启动 Web 开发服务：http://127.0.0.1:3030
npm run dev

# 常用：启动 Electron Shell，并等待 Web 服务就绪
npm run electron:dev
```

常用入口：

- Web 主界面：`http://127.0.0.1:3030/`
- AI CLI：`#/ai-cli`
- 角色编辑：`#/operator-studio`
- Buff / 武器 / 装备编辑：`#/buff-sheet`、`#/weapon-sheet`、`#/sheet-equipment`
- 图片管理：`#/image-manager`

### 打包

```bash
# 构建 Web 与嵌入式 OpenCode UI
npm run build

# Windows portable
npm run electron:build

# macOS dmg
npm run electron:build:mac
```

构建产物默认位于 `release/`，不应提交到 Git。

## Agent 与 Work Node

项目的 AI 能力分为两个职责不同的宿主：

```text
Main Workbench AI mode                 /AI CLI
  ├─ 排轴与当前主界面上下文              ├─ 数据资源、填表与资料处理
  ├─ def-workbench agent               ├─ 独立 agent / session / history
  ├─ Work Node 草稿、diff、审批、use    └─ 仅在自身任务需要时创建节点工作区
  └─ 不与 AI CLI 共享 active session       不继承 Workbench checkout/context
```

正式工具只有三类：

- `def-node-code`：在隔离节点工作区中使用原生 `read/edit/apply_patch` 修改规范化排轴源。
- `def-node-crud`：负责节点 fork、bind、校验、diff、审批、use、restore 等生命周期。
- `def-data-resource`：提供可信的干员、武器、装备、技能、Buff 和伤害数据。

排轴改动不会直接覆盖当前主界面：模型先在 Work Node 中修改，系统 rebuild、校验、生成语义 diff 与风险，再通过原生 permission 让用户决定是否 `use`。详情见 [Spec 7](docs/specs/def-opencode-local-productization-spec7/spec.md)。

## 架构概览

```text
React / Vite Web
  ├─ WorkbenchFrame：主界面、排轴、技能详情与伤害视图
  ├─ Sheet pages：干员、Buff、武器、装备与图片管理
  └─ local state / local data bridge
             │
             ├─ Electron Shell：存档、图片、桌面 bridge、打包运行时
             │
             └─ DEF OpenCode runtime：host profile、typed tools、Work Node、审批与历史
                         │
                         └─ timeline repository：节点、revision、diff、checkout 证据
```

前端负责用户编辑和展示；Electron 负责本地运行体验、文件/图片桥接和本地服务；Work Node 负责把高风险 AI 改动从当前 checkout 隔离出来。不要让 Agent 直接修改项目源码、浏览器存储或任意本地目录。

## 常用开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run electron:dev` | 常用开发入口：启动 Shell 和 Web。 |
| `npm run dev` | 只启动 Vite Web。 |
| `npm run build` | 构建嵌入式 OpenCode UI、执行 TypeScript 检查并构建 Web。 |
| `npm test` | 运行当前收录的核心单元测试与节点 codec 测试。 |
| `npm run smoke:work-node-sqlite` | 验证 Work Node SQLite、REST、备份恢复和迁移 smoke。 |
| `npm run smoke:ai-cli-rest` | 验证 AI CLI REST 基础链路。 |
| `npm run smoke:operator-config` | 运行 Electron 侧角色配置 smoke。 |
| `npm run akedb:extract` | 从本机 AKEDatabase 原始资料生成精简索引。 |
| `npm run electron:build` | 构建 Windows portable。 |

测试与验收不是只看命令成功。涉及 DEF agent / typed tools 时，按 [DEF Agent 黑盒测试口径](docs/testing/def-agent-blackbox.md) 从真实 Workbench prompt 入口验证用户可观察行为。

## 仓库地图

```text
src/                    React 页面、组件、领域服务、计算器与前端状态
electron/               Electron 主进程、preload、Shell 与本地 repository
agent/runtime/          DEF tools、OpenCode adapter、skills、节点 workspace codec
scripts/                构建、smoke、数据抽取和本地辅助脚本
public/data/            干员、武器、装备等静态资料
docs/specs/             Spec 驱动的需求、研究、任务、验收和维护记录
docs/testing/           跨 Spec 的测试口径
docs/architecture/      跨 Spec 架构审计
docs/guides/            用户指南
```

## 文档与 Spec 工作流

项目采用 Spec 驱动开发。一个开发主题以 `docs/specs/<spec-id>/` 为唯一主轴：

```text
research → spec → tasks → coding → verification → maintenance review/fix
```

| 文档 | 作用 |
| --- | --- |
| `spec.md` | 目标、范围、约束与验收标准，是需求事实源。 |
| `tasks.md` | 已确认范围内的执行清单与状态。 |
| `research*.md` | 规格前后的调查、架构判断与证据。 |
| `verification*.md` | 构建、测试、黑盒与手工验收记录。 |
| `fix-report*.md` / `health-review*.md` | 已完成 Spec 的维护修复和健康审查。 |

新一轮 Spec 或 Tasks 必须先有用户提供的标题、目标或具体内容；不能用空目录或自动拆分替代需求定义。新文档默认进入对应 Spec，只有跨多个 Spec 的审计进入 `docs/architecture/`。

入口：

- [项目文档导航](docs/README.md)
- [Spec 总索引](docs/specs/README.md)
- [用户快速上手](docs/guides/quick-start.md)
- [跨 Spec 测试口径](docs/testing/README.md)
- [架构审计](docs/architecture/README.md)

## 贡献与本地约定

- 不提交构建产物、临时文件、私有配置或本机数据。
- 已存在的用户改动默认属于用户；处理任务时避免覆盖无关工作区内容。
- 代码改动是否补测试取决于风险，避免为文档或低风险调整扩张无关测试。
- 每个完成的 research、spec/task、编码任务或修复按项目约定独立提交，便于回滚与审查。
- 数据和计算链路优先保持“能编辑、能保存、能回看、能解释”的主线。

## 使用说明与免责声明

这是一个个人工具和研究项目，不承诺成为开箱即用的商业化产品。它适合希望直接整理资料、试配、排轴和追踪配置来源的人，也适合在本地继续扩展自己的数据或流程。

本项目为非官方、同人性质的个人工具仓库，仅用于学习、研究和流程整理。README 的叙事风格借鉴《明日方舟：终末地》的工业基地与地表终端氛围，不代表任何官方设定、组织或授权关系。
