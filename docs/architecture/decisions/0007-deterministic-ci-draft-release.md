# ADR-0007：确定性 CI 与人工闸门 Draft Release

- Status: Accepted
- Date: 2026-07-15

## Context

项目同时包含可重复的静态/合同检查，以及依赖真实 Electron、OpenCode session、provider 和 UI permission 的桌面验收。把两者混成一个 PR job 会制造随机失败或用 mock 冒充真实链路；完全手工发布又缺少可追溯构建。

## Decision

所有 push/PR 在 GitHub Hosted Runner 上执行锁依赖的确定性 `npm run check`。版本 tag 在 Windows 和 macOS 分别构建并生成 checksum，但只创建 Draft Release；真实安装和桌面 smoke 后人工公开。

## Consequences

合并反馈快速且可信，发布产物可追溯；桌面 E2E 暂时是独立人工门，签名/公证和 scheduled native runner 需要后续 ADR。

## Evidence

`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`docs/architecture/verification-matrix.md`。
