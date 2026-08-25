<p align="center">
  <img src="public/app-icon.svg" width="112" alt="终末地伤害工作台图标" />
</p>

<h1 align="center">终末地伤害工作台 · Desktop LTS 1.8</h1>

<p align="center">在浏览器里完成配装、排轴、Buff 管理、伤害计算与方案恢复。</p>

<p align="center">
  <img src="https://img.shields.io/badge/Runtime-Web%20PWA-4B8B3B?style=flat-square" alt="Web PWA" />
  <img src="https://img.shields.io/badge/Local_Data-SQLite%20WASM%20%2B%20OPFS-003B57?style=flat-square" alt="SQLite WASM 与 OPFS" />
  <img src="https://img.shields.io/badge/UI-React%20%2B%20Vite-646CFF?style=flat-square" alt="React 与 Vite" />
</p>

> 这不是自动战斗脚本。它把角色、武器、装备、Buff、时间轴和伤害结果组织成可保存、可回看、可分享的浏览器本地方案。

## 1.8 LTS 的边界

- 当前 `codex/v1.8-lts-desktop-overlay` 保留独立 Electron 控制壳、MCP 填表、DEF Agent 和统一资源发包工具；工作台页面仍在系统浏览器中运行。
- 私人排轴、快照、Work Node、配置和自定义图片写入当前浏览器的 SQLite WASM/OPFS 数据库，不上传云端。
- MCP 使用隔离的提案/审计数据库，Agent 通过受控宿主访问产品能力；两者都不能替代浏览器业务 SQLite 的权威写入。
- 官方 JSON 与图片资料从国内站点的同源资源通道下载，经过 SHA-256 校验后进入浏览器 Cache Storage；旧海外 URL 会保留路径跳转到国内域名。
- 一个浏览器配置中只允许一个标签页写入；其他标签页显示占用状态并可显式接管。
- 国内站点已公开访问，不再使用客户端密码门禁；私人数据仍只保存在当前浏览器。
- 国内网站只从 `codex/v1.8-lts-slimming` 部署；Desktop 是该分支的单向下游叠加层，不能反向污染 Web 基线。
- 不读取或迁移旧桌面 SQLite；需要保留的数据应通过 Web LTS 自身的导入/导出能力流转。

## 本地启动

需要 Node.js 24 和 npm 11：

```bash
npm ci
npm run dev
```

第一次执行 `npm run dev` 会准备约 35 MB 的官方图片压缩包，然后在
`http://127.0.0.1:3030` 启动站点。首次进入页面只需确认下载资料。

启动完整 Desktop Shell：

```bash
npm run electron:dev
```

生产式本地预览：

```bash
npm run build:local
npm run preview
```

`build:local` 生成包含当前稳定资源、MCP/Agent 和统一发包 runtime 的自包含 `dist/`。客户端运行时不依赖 GitHub Release；当前分支也不直接部署网站。

## 文档

- [快速上手](docs/guides/quick-start.md)
- [开发与验证](docs/guides/development.md)
- [架构总览](docs/architecture/overview.md)
- [1.8 LTS 分支合同](docs/architecture/lts-branch-contract.md)
- [数据生命周期](docs/architecture/data-lifecycle.md)
- [统一资源发包、服务器通道与交接](docs/architecture/resource-delivery.md)
- [安全边界](docs/architecture/security-boundaries.md)
- [技术栈](docs/technology-stack.md)

## 说明

这是一个非官方的个人工具与研究项目，仅用于资料整理、配装推演和开发实践。项目中的名称、内容与素材不代表任何官方立场、组织关系或授权关系。
