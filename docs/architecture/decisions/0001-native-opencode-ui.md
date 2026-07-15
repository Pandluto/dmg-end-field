# ADR-0001：保留原生 OpenCode UI

- Status: Accepted
- Date: 2026-07-15

## Context

项目需要让 DEF Agent 的实际 session、工具、问题卡和 provider 错误对用户可见。另建聊天面板会产生第二套 transcript/permission 状态，并让测试绕过真实产品链路。

## Decision

Workbench 的 AI 模式只宿主原生 `DefOpenCodeView` iframe。Interop 观察原生 session；不恢复旧 chat consumer，也不把可选 `ui-rendered` attest 当验收门。

## Consequences

UI 与 OpenCode 行为保持同源，但桌面验收必须具备真实 UI consumer；无头 CI 只能覆盖确定性合同。

## Evidence

`src/components/def-opencode/DefOpenCodeView.tsx`、`agent/server/def-agent-server.cjs`、`docs/testing/def-agent-blackbox.md`。
