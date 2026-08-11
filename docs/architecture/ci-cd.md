# CI/CD 与 Web 打包

## CI

`.github/workflows/ci.yml` 在 `main` push 与 pull request 上使用 Node 24、npm 11、`npm ci` 和 `npm run check`。第三方 Actions 固定到完整 commit SHA。

`npm run check` 以已提交的稳定通道和清单为准。若本机没有对应图片分片，会从海外正式站点的不可变版本路径下载，再逐片校验 SHA-256；不会访问 GitHub Release。

## 本地交付

本地交付：

```bash
npm ci
npm run build:local
npm run preview
```

图片分片被 `.gitignore` 排除。`assets:web-prepare` 按已提交清单从服务器版本目录补齐分片，重组并校验图片 ZIP，再为移动端物化同源图片文件。

## Tag 工作流

未来推送 `vMAJOR.MINOR.PATCH` tag 时：

1. 接受应用 tag；资源版本独立记录在 `resources/stable.json`；
2. 重跑质量门；
3. 从服务器不可变资源路径下载并验证图片包，生成自包含 `dist/`；
4. 打成单一 Web `.tar.gz` 并生成 `SHA256SUMS`；
5. 只创建或更新 GitHub Draft Release，人工浏览器验收后再决定公开。

该工作流不部署 GitHub Pages，不构建桌面安装包，也不上传用户数据。GitHub Draft Release 只保存 Web 应用归档，不是客户端官方资料来源。
