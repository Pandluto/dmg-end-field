# ADR-0002：Teacher / Worker / Judge 分离

- Status: Accepted
- Recorded: 2026-07-15
- Decision period: Retrospective record of the Spec 8 research and implementation; see Evidence for the original artifacts.

## Context

让被训练 Agent 同时看到验收答案或修改评分器，会造成 evaluator leakage 和自证通过。

## Decision

DEF OpenCode 是 Worker；Codex + Computer Use + interop 是 Teacher；Scenario、replay、hidden/相邻回归和人工 reviewer 是 Judge。evaluator-only 输入不得进入 Worker、Harness 包或公开 trace。

## Consequences

返修证据更可信，但 promotion 需要额外 artifact 和人工判断，流程不会追求无条件全自动。

## Evidence

`scripts/def-harness-native-runner.mjs`、`scripts/def-harness-regression.mjs`、Spec 8 verification。
