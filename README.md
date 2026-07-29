<p align="center">
  <img src="electron/assets/icon.png" width="112" alt="终末地伤害工作台图标" />
</p>

<h1 align="center">终末地伤害工作台</h1>

<p align="center">为《明日方舟：终末地》配装、排轴、伤害计算与本地资料维护打造的桌面工作台。</p>

<p align="center"><a href="https://pandluto.github.io/dmg-end-field/"><strong>查看项目展示页：实机功能与架构</strong></a></p>

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-Electron-47848F?style=flat-square" alt="Electron 桌面壳" />
  <img src="https://img.shields.io/badge/Timeline_Repository-SQLite-003B57?style=flat-square" alt="排轴 SQLite Repository" />
  <img src="https://img.shields.io/badge/Web_UI-React%20%2B%20Vite-646CFF?style=flat-square" alt="React 与 Vite" />
</p>

> 这不是自动战斗脚本。它把角色、武器、装备、Buff、技能按键、时间轴和伤害结果组织成可保存、可回看、可分享的本地方案。

## 为什么做这个？

从一次试配开始，换一件装备、改一次技能，整套排轴都得重算。真正花时间的往往不是按下计算，而是反复找资料、填配置、记住改动、比较两种思路，以及在改坏后找回原来的方案。

终末地伤害工作台想把这些试错留成可继续推演的过程，而不是一次算完就消失的数字。SQLite 工作区、快照和 Work Node 让不同方案可以并行保存、比较和恢复。

## 数据边界

- 排轴、快照、Work Node 与本地资料保存在本机；项目不提供云端排轴同步。
- 完整数据包分为 Local Data 与 Share Data；网络下载只写入 Share Data。只有你明确“应用数据”后，资料才会投影到浏览器数据，包内排轴会导入共享存档；本地/共享存档需转换为新的 SQLite 工作区才可使用。
- 伤害结果基于当前本地资料、队伍配置与计算规则。游戏版本、资料或配置变化后，应重新核验结果。

## 从这里继续

| 想了解什么 | 从这里开始 |
| --- | --- |
| 想先看排轴、报告与功能展示 | [项目展示页](https://pandluto.github.io/dmg-end-field/) |
| 它如何把桌面界面、本地数据与版本恢复接在一起 | [架构总览](docs/architecture/overview.md) |
| 如何安装依赖、启动开发环境和打包 | [开发与启动](docs/guides/development.md) |
| 核心技术为什么是这些，而不是一串泛泛的框架名 | [技术栈与技术选择](docs/technology-stack.md) |
| 如何使用打包版完成配置、排轴与资料维护 | [使用指南](docs/guides/quick-start.md) |
| 数据包、排轴存档和 SQLite 工作区如何分工 | [数据管理规格](docs/specs/data-management-sqlite-release/spec.md) |

## 说明

这是一个非官方的个人工具与研究项目，仅用于资料整理、配装推演和开发实践。项目中的名称、内容与素材不代表任何官方立场、组织关系或授权关系。
