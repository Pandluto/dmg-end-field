# 开发与启动

[← 返回项目入口](../../README.md)

## 环境

- Node.js 24.x
- npm 11.x

```bash
npm ci
npm run electron:dev
```

`electron:dev` 启动 Vite（`127.0.0.1:3030`）和 Electron Shell。已有常驻实例时不要重复启动。

只调试页面可运行：

```bash
npm run dev
```

这不会启动 Electron bridge，因而 SQLite、数据包与桌面图片能力不可用。

## 常用验证

```bash
npm run check
npm run smoke:work-node-sqlite
npm run smoke:data-management
npm run smoke:data-release-builder
npm run smoke:local-data-archive-flow
```

## 构建

```bash
npm run build
npm run electron:build
npm run electron:build:mac
```

产物位于 `release/`，不得提交。
