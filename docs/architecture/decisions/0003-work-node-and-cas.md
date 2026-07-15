# ADR-0003：mutation 使用 child Work Node 与 revision CAS

- Status: Accepted
- Date: 2026-07-15

## Context

直接修改 live 配置无法可靠预览、拒绝和恢复，并会在并发/过期状态下覆盖用户修改。

## Decision

prepare 在当前 checkout 下创建临时 child Work Node，绑定 parent/child revision、plan hash 和 capability；批准时用 `contentRevision` CAS 提交，随后验证 commit、child 和 live mirror。

## Consequences

拒绝可以做到零变化，过期写入 fail-closed；实现需要显式清理临时 child 和处理 `PARTIAL`，不能依靠模型重试 409。

## Evidence

`electron/timeline-repository.cjs`、`scripts/ai-cli-rest-server.mjs`、Spec 8-1-3 verification。
