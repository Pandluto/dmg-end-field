# CI/CD 设计

## CI

`.github/workflows/ci.yml` 在 `main` push 与所有 pull request 上运行。它使用锁定的 Node 24/npm 11 环境和 `npm ci`，只执行可重复、无桌面依赖的 `npm run check`。并发提交会取消旧 CI，避免浪费 runner。

CI 不启动 Electron、provider 或真实 Workbench consumer。原因是这些测试依赖本机 UI、会话授权和可观察审批卡；在没有隔离 fixture 与可靠 UI runner 前，把它们放进普通 CI 会制造假绿或随机红。

GitHub 的 `main` 保护要求 `Repository quality gate` 成功、禁止 force push/delete，并要求分支保持线性历史。仓库维护者保留保护规则 bypass，仅用于单维护者直接发布或 CI/规则故障恢复；普通协作仍应从分支经绿灯合入。

## CD

`.github/workflows/release.yml` 由 `vMAJOR.MINOR.PATCH` tag 触发：

1. 校验 tag 与 `package.json` version 完全一致，并重跑质量门。
2. 单独抓取、校验并冻结一份 `models.dev` 目录快照，两个平台按同一 SHA-256 构建 OpenCode runtime。
3. 使用 Bun `1.3.14` 安装锁定的 vendored OpenCode workspace。
4. Windows x64 runner 构建 portable `.exe`，macOS arm64 runner 构建 `.dmg`。
5. 在各自平台从打包后的 asar 启动 sidecar 与 OpenCode core，验证 Electron 共用的环境编排、unpacked esbuild、runtime binary 与可写数据路径。
6. 扁平化汇总产物，生成不含 runner 临时目录的 `SHA256SUMS`。
7. 幂等创建或更新 GitHub Draft Release；已公开的 Release 不允许被工作流覆盖。

```mermaid
flowchart LR
  Commit["push / PR"] --> CI["npm ci + npm run check"]
  Tag["vX.Y.Z tag"] --> Validate["version + quality gate"]
  Validate --> Models["freeze models.dev + SHA-256"]
  Models --> Win["Windows package"]
  Models --> Mac["macOS arm64 package"]
  Win --> Hash["artifacts + SHA256SUMS"]
  Mac --> Hash
  Hash --> Draft["GitHub Draft Release"]
  Draft --> Manual["安装与桌面 smoke"]
  Manual --> Publish["人工发布"]
```

## 发布操作

```bash
NEXT_VERSION=1.8.3
npm version "$NEXT_VERSION" --no-git-tag-version
npm install --package-lock-only --ignore-scripts
npm run check
git commit -am "release: prepare v$NEXT_VERSION"
git tag "v$NEXT_VERSION"
git push origin main "v$NEXT_VERSION"
```

首次实际 tag 应视为 CD 的生产验收：记录两个 runner、产物名称、checksum、安装结果和 Draft 到发布的人工决定。没有这条证据前，文档只声称“发布流程已实现并经过本地静态验证”。

## 供应链取舍

- Actions 固定到完整 commit SHA 并保留版本注释，由 Dependabot 月度更新；关键发布前检查 action release notes。
- npm 和 Bun 都使用 frozen lock；根目录只允许 `package-lock.json`。OpenCode 的动态模型目录在 release workflow 中只抓取一次并校验 hash，禁止各 runner 自行联网获取不同快照。
- GitHub token 采用最小权限：普通 job 只读，仅 Draft job 获得 `contents: write`。
- 当前不在仓库保存签名凭据。签名/公证接入应使用环境保护和专用 secrets，并新增 ADR。

参考：[GitHub Actions 安全强化](https://docs.github.com/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)、[GitHub-hosted runner 架构与标签](https://docs.github.com/actions/reference/runners/github-hosted-runners)、[Electron code signing](https://www.electron.build/code-signing.html)。
