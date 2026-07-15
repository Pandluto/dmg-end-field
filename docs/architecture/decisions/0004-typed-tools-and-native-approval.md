# ADR-0004：typed tools 与原生审批构成副作用边界

- Status: Accepted
- Date: 2026-07-15

## Context

自由文件访问、猜测字段或仅靠提示词约束无法保护产品状态；用户也必须在应用配装等操作前看到完整预览。

## Decision

Agent 只通过有 scope/source/error 语义的 typed resources 读取产品数据。所有 mutation 先 prepare，再通过 OpenCode 原生 permission `ask`，获批后使用受限 capability apply；Harness 无权关闭审批。

## Consequences

安全边界进入可测试合同，代价是每个新领域写入都需要 adapter、审批内容和 postcondition，不能用通用文件工具快速绕过。

## Evidence

`agent/runtime/def-opencode-adapter/`、`agent/server/def-agent-server.cjs`、`scripts/ai-cli-rest-server.mjs`。
