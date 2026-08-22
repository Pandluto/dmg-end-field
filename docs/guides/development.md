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

需要 Electron、MCP、DEF Agent 或桌面发包界面时运行：

```bash
npm run electron:dev
```

该命令会准备 MCP/Agent/统一发包运行时，再启动独立 Shell 和 `127.0.0.1:3030` 浏览器工作台。Shell 不承载业务 SQLite；工作台仍在系统浏览器中运行。

## 常用命令

```bash
npm run typecheck
npm test
npm run smoke:timeline-bundle
npm run electron:smoke:resource-release
npm run electron:smoke:boundaries
npm run check:repo
npm run check
```

`npm run check` 是确定性合并门，包含依赖审计、类型、测试、bundle smoke 和 PWA 构建。

## 本地生产包

```bash
npm run build:local
npm run preview
```

产物在 `dist/`，其中包含静态页面、Worker、SQLite WASM、JSON 资料、图片 ZIP、MCP/Agent 运行时和 Desktop 统一发包 runtime。这个命令只构建本地产物，不会部署或上传。

## 统一资源包

Desktop Shell 或命令行都可以从完整 Share Data 与图片目录生成同一格式：

```bash
npm run resource:build -- --share-data <share.json> --images <image-directory> --output <output>
npm run resource:verify -- <dmg-resource-release-*.zip>
```

输入必须是完整 `def.localdata.archive.v1`；员工增量或单一资料库导出要先合并，再从工作台重新导出 Share Data。详细合同见 [统一资源发包与交接](../architecture/resource-delivery.md)。

## 分支与部署

- Desktop/MCP/Agent 开发在 `codex/v1.8-lts-desktop-shell`。
- 国内 Web 应用、资源物化和生产部署在 `codex/v1.8-lts-slimming`。
- 两分支只同步共同补丁，不做整分支 merge。详见 [1.8 LTS 分支合同](../architecture/lts-branch-contract.md)。
- 部署或发资源请求必须使用 `.agents/skills/dmg-dual-deploy/SKILL.md`；默认只更新 `dmgendfield.cloud`。

## 浏览器调试注意

- OPFS 和 PWA 需要安全上下文；开发时使用 `127.0.0.1` 或 `localhost`。
- 第二标签页默认不会打开写数据库；要测试接管，请保留两个同源标签页。
- 清除站点数据会删除私人排轴和自定义图片，先从设置页导出 SQLite。
- 首次安装和重新安装会下载约 31 MB 图片包。
- 修改图片发布清单时，运行 `npm run assets:web-manifest`；该命令默认读取本机 v1.7.3 发布清单，也可通过 `DMG_IMAGE_RELEASE_MANIFEST` 指定来源。
