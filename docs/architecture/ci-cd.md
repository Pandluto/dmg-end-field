# CI/CD、Desktop 打包与国内发布

## CI

`.github/workflows/ci.yml` 在 `main` push 与 pull request 上使用 Node 24、npm 11、`npm ci` 和 `npm run check`。第三方 Actions 固定到完整 commit SHA。

`npm run check` 先验证 `desktop-overlay.json` 记录的 Slimming commit 是当前 Desktop 的祖先，并阻止共享源码产生未登记分叉；随后以已提交的稳定通道和清单为准。若本机没有对应图片分片，会从国内正式站点的不可变版本路径下载，再逐片校验 SHA-256；不会访问 GitHub Release。

## 本地构建与交付

```bash
npm ci
npm run build:local
npm run preview
```

图片分片被 `.gitignore` 排除。`assets:web-prepare` 按已提交清单从服务器不可变版本目录补齐分片，重组并校验图片 ZIP，再为移动端物化同源图片文件。Desktop 下游随后把 MCP、Agent 和统一资源发包 runtime 写入同一个 `dist/`，供 Electron 打包使用。

## Tag Draft 工作流

仓库仍保留 `vMAJOR.MINOR.PATCH` tag 的人工审核 Draft 工作流：

1. 接受应用 tag；资源版本独立记录在 `resources/stable.json`；
2. 重跑质量门；
3. 从服务器不可变资源路径下载并验证图片包，生成自包含 `dist/`；
4. 打成单一 Web `.tar.gz` 并生成 `SHA256SUMS`；
5. 只创建或更新 GitHub Draft Release，人工浏览器验收后再决定公开。

该工作流不部署生产站点，不构建桌面安装包，也不上传用户数据。Draft Release 只是可追溯的 Web 构建物，不是生产数据/图片通道；统一资源 ZIP 禁止上传 GitHub Release。

## 生产发布

- `codex/v1.8-lts-desktop-shell` 只制作桌面应用和统一资源 ZIP，不是网站部署源。
- `codex/v1.8-lts-slimming` 是唯一维护中的 Web 发布分支。
- `https://dmgendfield.cloud` 是唯一维护中的应用与资源源站。
- 海外 `.online` 只保留同路径跳转、PWA 迁移端点和历史分享 API；普通发布不得重建海外完整应用。

应用或资源上线必须使用 `.agents/skills/dmg-dual-deploy/SKILL.md`。该流程要求先锁定并推送 Slimming 源提交，再构建国内静态归档、做远端原子切换与公开 HTTPS 验证。Desktop 产生的资源 ZIP 要先在 Slimming 中校验并物化，详见 [统一资源发包、服务器通道与交接](./resource-delivery.md)。
