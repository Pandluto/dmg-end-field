# ADR-0005：Harness 不可变并在 session 创建时 pin

- Status: Accepted
- Recorded: 2026-07-15
- Decision period: Retrospective record of the Spec 8-1-2 implementation; see Evidence for the original artifacts.

## Context

直接覆盖运行中的提示词会使同一会话前后行为不可复现，也无法可靠区分 stable、candidate 和 rollback。

## Decision

Harness package 完整物化后按内容 hash 不可变存储。native session 创建时解析 selector 并写入 `DefHarnessSessionBindingV1`；后续 turn 只能使用该 binding。promotion/rollback 只影响新 session。

## Consequences

候选可热插拔、可比较、可回滚；验证需要创建新 session，不能期待已有对话实时变更。

## Evidence

`agent/harness/def-harness.cjs`、`scripts/def-harness-cli.mjs`、Spec 8-1-2 verification。
