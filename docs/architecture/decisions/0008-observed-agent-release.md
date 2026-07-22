# ADR-0008：记录完整 Agent 组合，但只承诺 Harness pinning

- Status: Accepted
- Recorded: 2026-07-22

## Context

`DefHarnessSessionBindingV1` 只能证明八个 Harness slot 没有变化。

真实行为还取决于模型、基础 Prompt、动态 Prompt、Runtime Skill、Tool、知识、Sidecar 和 Workbench。把 Harness binding 称为完整 Agent 版本，会让训练归因失真。

旧实现还会在读取 session 时覆盖 workspace 中的 Tool 与 codec 副本。与此同时，真正的 native Tool 来自进程级 plugin。这个副本既不是权威实现，也不应被当作 pinning 证据。

## Decision

每个新 native session 生成 `AgentReleaseV1`。它记录：

- runtime commit 与包版本；
- 模型和 reasoning 配置；
- 基础 Prompt 与动态 Prompt hash；
- Harness ref 与 slot hashes；
- Skill tree、Tool catalog、Tool implementation 和权限策略 hash；
- knowledge revision；
- Sidecar、状态合同、Workbench Host 与 OpenCode runtime hash。

该合同明确声明：

```text
sessionGuarantee = harness-only
harness = immutable
runtime = observed-not-pinned
```

turn router 只做任务分类，不得改变 session selector。Harness V1 不执行条件 artifact；清单出现 `when` 时直接拒绝构建。

session 读取不再刷新 Tool 或 codec 副本。恢复若观察到新的运行组合，会保存新 release，并记录前一个 release hash。

Harness regression 必须在 session 与每个 turn 中看到同一 `AgentReleaseV1.releaseHash`。缺少或漂移时，结果为不完整证据。

## Consequences

训练记录现在能回答“这次到底训练了哪一套 Agent”。它也不会把 Harness-only pinning 包装成完整 runtime pinning。

旧会话仍可在新运行时下恢复。这是兼容策略，不是完全复现。若以后需要逐字节重放，必须把 `AgentReleaseV1` 对应组件物化为不可变 release package，再新增 ADR。

## Evidence

- `agent/runtime/def-opencode-adapter/agent-release.cjs`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-opencode-adapter/harness-turn-router.cjs`
- `agent/harness/def-harness.cjs`
- `scripts/def-agent-release-contract-test.mjs`
- `scripts/def-harness-regression.mjs`
