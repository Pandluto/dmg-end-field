# CI/CD 与 Web 打包

## CI

`.github/workflows/ci.yml` 在 `main` push 与 pull request 上使用 Node 24、npm 11、`npm ci` 和 `npm run check`。第三方 Actions 固定到完整 commit SHA。

`npm run check` 不下载 31 MB 图片压缩包，因此保持确定性；它仍会验证已提交的图片清单、浏览器索引和所有声明 hash。

## 本地交付

当前阶段只做本地部署：

```bash
npm ci
npm run build:local
npm run preview
```

图片 ZIP 被 `.gitignore` 排除，`assets:web-prepare` 会按提交的 URL、大小和 SHA-256 下载到 `public/packages/`。Vite 随后复制它到 `dist/packages/`。

## Tag 工作流

未来推送 `vMAJOR.MINOR.PATCH` tag 时：

1. 校验 tag 与 `package.json` 版本；
2. 重跑质量门；
3. 下载并验证图片包，生成自包含 `dist/`；
4. 打成单一 Web `.tar.gz` 并生成 `SHA256SUMS`；
5. 只创建或更新 GitHub Draft Release，人工浏览器验收后再决定公开。

该工作流不部署 GitHub Pages，不构建桌面安装包，也不上传用户数据。
