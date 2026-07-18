<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="终末地伤害工作台图标" />
</p>

<h1 align="center">终末地伤害工作台</h1>

<p align="center">为《明日方舟：终末地》配装、排轴、伤害计算与本地资料维护打造的桌面工作台。</p>

<p align="center"><a href="https://pandluto.github.io/dmg-end-field/"><strong>查看项目展示页：实机功能与架构</strong></a></p>

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-Electron-47848F?style=flat-square" alt="Electron 桌面壳" />
  <img src="https://img.shields.io/badge/AI_Runtime-OpenCode-111827?style=flat-square" alt="内置 OpenCode Runtime" />
  <img src="https://img.shields.io/badge/Agent_Runtime-Typed%20Tools%20%2B%20Harness-7C3AED?style=flat-square" alt="Typed Tools 与 Harness" />
  <img src="https://img.shields.io/badge/Timeline_Repository-SQLite-003B57?style=flat-square" alt="排轴 SQLite Repository" />
</p>

> 这不是自动战斗脚本，也不是在线配装网站。它把角色、武器、装备、Buff、技能按键、时间轴和伤害结果组织成可保存、可回看、可分享的本地方案。涉及方案结构、批量内容或配置的高影响 AI 变更会先生成可检查的草稿，再由你决定是否应用；少数低风险操作则按策略执行，并返回验证结果。

## 为什么做这个？

从一次试配开始，换一件装备、改一次技能，整套排轴都得重算。真正花时间的往往不是按下计算，而是反复找资料、填配置、记住改动、比较两种思路，以及在改坏后找回原来的方案。

终末地伤害工作台想把这些试错留成可继续推演的过程，而不是一次算完就消失的数字。AI 可以在受限的本地资料与攻略参考中检索、整理和辅助填写；它不能任意读取文件、执行 Shell 或替你做判断。每一次高影响建议都应当能被检查、应用或放弃。

## 数据与 AI 边界

- 排轴、快照、Work Node 与本地资料保存在本机；项目不提供云端排轴同步。
- 完整数据包分为 Local Data 与 Share Data；网络下载只写入 Share Data。只有你明确“应用数据”后，资料才会投影到浏览器数据，包内排轴会导入共享存档；本地/共享存档需转换为新的 SQLite 工作区才可使用。
- AI 运行时由桌面应用在本机启动，但模型推理使用你在 Shell 的 `Agent` 页面配置的 DeepSeek 兼容服务。使用 AI 前需要网络和 API Key；该次对话所需的提示与工作台上下文会发送给该模型服务。
- 伤害结果基于当前本地资料、队伍配置与计算规则。游戏版本、资料或配置变化后，应重新核验结果。

## 从这里继续

| 想了解什么 | 从这里开始 |
| --- | --- |
| 想先看真实会话、排轴、报告与 AI 架构的完整展示 | [项目展示页](https://pandluto.github.io/dmg-end-field/) |
| 想从真实开发过程理解 Agent、工具、状态和恢复 | [Agent 开发手记](https://pandluto.github.io/dmg-end-field/agent-notes/) |
| 它如何把桌面界面、本地数据与 AI 协作接在一起 | [架构总览](docs/architecture/overview.md) |
| 如何安装依赖、启动开发环境和打包 | [开发与启动](docs/guides/development.md) |
| 核心技术为什么是这些，而不是一串泛泛的框架名 | [技术栈与技术选择](docs/technology-stack.md) |
| 如何使用打包版完成配置、排轴与资料维护 | [使用指南](docs/guides/quick-start.md) |
| 数据包、排轴存档和 SQLite 工作区如何分工 | [数据管理规格](docs/specs/data-management-sqlite-release/spec.md) |

## 说明

这是一个非官方的个人工具与研究项目，仅用于资料整理、配装推演和开发实践。项目中的名称、内容与素材不代表任何官方立场、组织关系或授权关系。
