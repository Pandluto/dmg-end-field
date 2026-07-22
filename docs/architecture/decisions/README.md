# Architecture Decision Records

ADR 记录已经落地、对后续实现有约束力的决策。状态使用 `Proposed`、`Accepted`、`Deprecated` 或 `Superseded by ADR-xxxx`。

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [0001](./0001-native-opencode-ui.md) | 使用原生 OpenCode UI，不重写聊天消费者 | Accepted |
| [0002](./0002-teacher-worker-judge.md) | Teacher / Worker / Judge 分离 | Accepted |
| [0003](./0003-work-node-and-cas.md) | mutation 使用 child Work Node 与 revision CAS | Accepted |
| [0004](./0004-typed-tools-and-native-approval.md) | typed tools 与原生审批是副作用边界 | Accepted |
| [0005](./0005-immutable-harness-session-pinning.md) | Harness 不可变并在 session 创建时 pin | Accepted |
| [0006](./0006-bounded-knowledge-reading.md) | 知识采用 allowlist 两阶段读取 | Accepted |
| [0007](./0007-deterministic-ci-draft-release.md) | 确定性 CI 与人工闸门 Draft Release | Accepted |
| [0008](./0008-observed-agent-release.md) | 记录完整 Agent 组合，但只承诺 Harness pinning | Accepted |

新增 ADR 使用四位编号，包含 Context、Decision、Consequences 和 Evidence。历史决策不得被静默改写。
