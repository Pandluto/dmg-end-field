# 开发与启动

[← 返回项目入口](../../README.md)

## 环境

- Node.js 24.x
- npm 11.x
- 当前桌面版 Chrome 或 Edge

```bash
npm ci
npm run dev
```

`npm run dev` 会：

1. 检查 `public/packages/` 中的官方图片 ZIP；
2. 缺失时按提交的 SHA-256 下载；
3. 更新 JSON 资料清单；
4. 在 `127.0.0.1:3030` 启动 Vite。

图片 ZIP 被忽略，不会进入 Git。已经运行的开发服务器无需重复启动。

## 常用命令

```bash
npm run typecheck
npm test
npm run smoke:timeline-bundle
npm run check:repo
npm run check
```

`npm run check` 是确定性合并门，包含依赖审计、类型、测试、bundle smoke 和 PWA 构建。

## 本地生产包

```bash
npm run build:local
npm run preview
```

产物在 `dist/`，其中包含静态页面、Worker、SQLite WASM、JSON 资料和图片 ZIP。当前阶段不执行 GitHub 部署。

## 浏览器调试注意

- OPFS 和 PWA 需要安全上下文；开发时使用 `127.0.0.1` 或 `localhost`。
- 第二标签页默认不会打开写数据库；要测试接管，请保留两个同源标签页。
- 清除站点数据会删除私人排轴和自定义图片，先从设置页导出 SQLite。
- 首次安装和重新安装会下载约 31 MB 图片包。
- 修改图片发布清单时，运行 `npm run assets:web-manifest`；该命令默认读取本机 v1.7.3 发布清单，也可通过 `DMG_IMAGE_RELEASE_MANIFEST` 指定来源。
