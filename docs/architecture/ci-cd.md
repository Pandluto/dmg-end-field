# CI/CD 与数据包发布

## CI

`.github/workflows/ci.yml` 在 `main` push 与 pull request 上使用 Node 24、npm 11、`npm ci` 和 `npm run check`。Actions 固定到完整 commit SHA。

## 应用发布

`vMAJOR.MINOR.PATCH` tag 触发：

1. 校验 tag 与 `package.json` version；
2. 重跑质量门；
3. Windows 构建 portable `.exe`，macOS 构建 arm64 `.dmg`；
4. 汇总产物并生成 `SHA256SUMS`；
5. 创建或更新 GitHub Draft Release，人工安装验收后再公开。

1.8 LTS 的发布流程不下载模型目录、不安装 Bun、不构建 OpenCode，也不运行 packaged sidecar smoke。

## 独立发布链

完整数据包和图片资源不由应用 tag 自动生成。数据维护者应分别运行数据与图片 smoke，并验证下载、完整性校验、Share Data 落盘、显式应用和图片版本切换。
