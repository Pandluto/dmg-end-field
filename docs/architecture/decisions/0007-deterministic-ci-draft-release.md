# ADR-0007：确定性 CI 与人工闸门 Draft Release

- Status: Accepted
- Recorded: 2026-07-15
- Decision period: New decision introduced with the CI/CD baseline recorded in commit `6d85548`.

## Context

项目同时包含可重复的静态/合同检查，以及依赖真实浏览器 OPFS、Cache Storage、Service Worker、文件选择器和多标签页交互的验收。把两者混成一个 PR job 会制造随机失败或用 mock 冒充真实链路；完全手工发布又缺少可追溯构建。

## Decision

所有 push/PR 在 GitHub Hosted Runner 上执行锁依赖的确定性 `npm run check`。版本 tag 生成包含资料 sidecar 的静态 Web 压缩包和 checksum，但只创建 Draft Release；真实浏览器验收后人工决定是否公开。

## Consequences

合并反馈快速且可信，发布产物可追溯；OPFS、PWA 离线与多标签页 E2E 暂时是独立浏览器门。若未来自动部署或增加服务端鉴权，需要新的发布决策。

## Evidence

`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`docs/architecture/verification-matrix.md`。
