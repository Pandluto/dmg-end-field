# Spec 8-1-1：Runtime Harness 与真实黑盒基线

## 状态

规格已形成，等待后续任务拆分与实现。

## 一句话定调

**先让 `def-opencode` 的身份、真实能力、实时 Workbench 状态和用户原始输入成为分层、版本化、可审计的运行时事实，建立不带测试答案的真实黑盒基线。**

## 背景

Spec 7 已建立原生 OpenCode loop、三类 DEF tools、Work Node、节点代码 workspace、validation/diff、CAS、permission 与 host/session 隔离，但当前行为基础仍有三类混杂：

1. Workbench 身份、操作流程和安全提醒同时存在于 agent prompt、skills 和黑盒 per-message 包装中；
2. checkout、revision、selected operators 等实时状态尚未形成统一、精简、每 turn 重算的 contract；
3. `/def-agent/workbench-test/prompt` 虽然能驱动真实 MainWorkbenchAiPanel，却会给普通用户文本追加工具和流程教程，现有成功不能等价证明原生弱提示能力。

8-1-1 先修正这些事实基线，不引入 Teacher 自动返修和知识训练。

## 目标

1. 建立版本化 `DefAgentContract`；
2. 从真实权限和 provider-visible tools 生成 `DefCapabilityManifest`；
3. 建立每 turn 重算的 `WorkbenchTurnState`；
4. 明确 Agent Contract、skills、tool schema/result 和动态 state 的单一职责；
5. 让 Pure Blackbox 的 provider-visible user text 与用户原文完全一致；
6. 为 8-1-2 预留稳定的版本/hash 和 turn correlation 字段。

## Runtime Harness 结构

```text
DefRuntimeHarness
  ├─ Agent Contract          稳定身份与职责
  ├─ Capability Manifest     真实能力与权限
  ├─ WorkbenchTurnState      当前现场与 hard gate
  ├─ Skill Bundle            程序知识
  ├─ Tool Schema / Result    工具局部合同与下一动作
  └─ Response Policy         最终表达边界
```

它必须是可版本化组合，而不是把所有内容拼成一段 system prompt。

## 第一部分：Agent Contract

`DefAgentContract` 只描述稳定事实：

- agent id、host、任务使命；
- 三类工具边界；
- 能否读取当前轴、查询知识、建立草稿、校验、申请应用；
- 不可直接覆盖 checkout、不可绕过 approval/use；
- 回复语言以及事实、社区建议、草稿、已应用状态的基本区分。

示意：

```json
{
  "schemaVersion": 1,
  "agent": "def-workbench",
  "host": "workbench",
  "mission": "帮助用户理解、规划、审查并调整当前 DEF 战斗方案",
  "toolFamilies": ["def-node-code", "def-node-crud", "def-data-resource"],
  "canArrangeTimeline": true,
  "requiresReviewBeforeApply": true,
  "responseLanguage": "zh-CN",
  "contractVersion": "..."
}
```

Agent Contract 不包含当前角色、checkout、工具参数教程、完整操作步骤或 YZ 正文。变化必须产生新版本/hash。

## 第二部分：Capability Manifest

`DefCapabilityManifest` 必须由真实 host profile、permission 和 provider-visible tool allowlist 生成，不能由 prompt 手写推测：

```json
{
  "schemaVersion": 1,
  "host": "workbench",
  "agent": "def-workbench",
  "allowedFamilies": ["def-node-code", "def-node-crud", "def-data-resource"],
  "allowedTools": [],
  "deniedCapabilities": [],
  "knowledgeIndexVersion": null,
  "generatedAt": "..."
}
```

要求：

- Workbench 与 AI CLI 分别生成 manifest；
- manifest 与 provider 实际可见 tools 一致；
- legacy/迁移期近似工具不能只靠 prompt 要求“不使用”，必须在 allowlist/permission 层明确；
- manifest version/hash 进入 turn metadata；
- manifest 是事实输出，不允许模型修改。

## 第三部分：WorkbenchTurnState

建立统一的动态状态对象，至少表达：

- selected operators；
- axis/timeline id；
- current checkout node/revision；
- bound workspace node/revision/phase；
- pending draft/approval；
- knowledge/strategy context version；
- checkout-changed 等 gate 与唯一 next action；
- schemaVersion、updatedAt 和来源。

```json
{
  "schemaVersion": 1,
  "selectedOperators": [],
  "checkout": { "nodeId": "...", "revision": 12 },
  "workspace": { "boundNodeId": "...", "phase": "checkout-changed" },
  "gate": {
    "code": "checkout-rebind-required",
    "nextAction": { "tool": "def_node_bind", "args": { "nodeId": "" } }
  },
  "updatedAt": "..."
}
```

TurnState 通过独立 system/context source 注入，不伪装成 user message，不重复完整工作流。checkout、revision、CAS 和 gate 继续由工具代码硬拒绝兜底。

## 第四部分：职责去重

| 载体 | 只负责 |
| --- | --- |
| Agent Contract | 稳定身份、能力边界和回复原则 |
| `timeline-workbench` | 排轴草稿、validate/diff、approval/use 与恢复流程 |
| `game-knowledge` | 术语、知识查询、冲突与交接策略 |
| Tool schema/result | 当前工具前置条件、参数、错误码和下一允许动作 |
| WorkbenchTurnState | 当前 turn 的动态事实与 hard gate |
| User message | 用户原始表达 |

现有重复规则需要按上表收敛。高频且必须遵守的安全性质应优先下沉到 runtime/tool，不继续堆叠 prompt。

## 第五部分：Pure Blackbox

现有 Workbench 测试入口应保留真实可见链路：

```text
prompt → ui-events → MainWorkbenchAiPanel
```

但 Pure Blackbox 必须满足：

- `rawUserText === providerVisibleUserText`；
- 不追加 native tools、legacy REST、fork、validate/diff/approval 等教程；
- host、agent、manifest 和 TurnState 通过独立字段/source 传递；
- 记录 session id、client turn id、ingress mode 和基础版本；
- 测试话术继续遵循 `docs/testing/def-agent-blackbox.md`；
- 如果需要调试注入，只能进入 8-1-2 定义的 Diagnostic 通道，不得污染 Pure Blackbox。

## 基础版本描述

本阶段建立最小 `DefHarnessDescriptor`：

```json
{
  "schemaVersion": 1,
  "contractVersion": "...",
  "manifestHash": "...",
  "turnStateSchemaVersion": 1,
  "skillVersions": {},
  "toolRegistryVersion": "...",
  "knowledgeIndexVersion": null,
  "codeCommit": "..."
}
```

8-1-1 不要求完整 trace bundle，只要求每 turn 可以关联这一基础描述，为 8-1-2 的观察与回放提供稳定键。

## 验收标准

- [ ] `DefAgentContract`、`DefCapabilityManifest`、`WorkbenchTurnState` 均有 schema、版本/hash 和单一来源。
- [ ] Workbench/AI CLI manifest 分离，且与 provider-visible tools 完全一致。
- [ ] checkout/revision/gate 每 turn 重新计算，工具硬门继续生效。
- [ ] Agent Contract、skills、tool schema 和动态 state 不再重复承载同一套完整教程。
- [ ] Pure Blackbox 的 raw/provider-visible user text 字节级一致。
- [ ] Pure Blackbox 仍能通过 UI event 驱动真实 MainWorkbenchAiPanel。
- [ ] 至少覆盖只读、歧义、预览、应用、checkout 切换五类普通话术，记录真实工具与状态结果。
- [ ] 每个 turn 能关联 HarnessDescriptor、session 和 client turn id。
- [ ] 现有 permission、approval/use、CAS、host/session isolation 不退化。

## 明确不做

- 不建立完整 Teacher trace/replay；
- 不接入 Computer Use 证据；
- 不生成 HarnessProposal；
- 不实现 Knowledge Runtime；
- 不自动修改 prompt/skills；
- 不创建 tasks 或提前进入 8-1-2。

## 完成定义

当普通用户原话可以在不携带测试教程的情况下进入真实 Workbench Agent，并且该 turn 使用的身份、能力、状态和 Harness 版本都可被准确导出时，8-1-1 完成。
