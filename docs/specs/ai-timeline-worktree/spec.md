# AI Timeline Worktree Spec

## 背景

主界面排轴当前的真实持久化底座不是按钮点击序列，而是一组可整体保存/恢复的 JSON payload：

- `selectedCharacters`
- `timelineData`
- `skillButtonTable`
- `allBuffList`
- `anomalyStateSnapshots`
- 干员输入、计算、展示缓存
- `operatorConfigPageCache`

既有 def-opencode 主界面链路把 AI 变更建模为“自然语言 -> REST command queue -> React 局部执行 -> 再同步快照”。这让模型在脆弱接口中猜 `buttonId`、`skillType`、`nodeIndex`，并把执行、验证和回答混在一起。

AI 排轴应改为“本地工作节点”模型：AI 在 appdata/localdata 里的独立节点上修改副本，系统 diff、校验、标记风险，低阻塞审批通过后再 checkout/apply 到真实排轴。

这里必须区分三类数据：

- `localStorage` / `sessionStorage`：当前前端迁出的工作副本，是正在运行的页面状态。
- `now-storage.json`：Electron/REST 与浏览器状态同步的当前迁出位，不是 AI 分支日志。
- appdata/localdata AI work node：AI 的独立工作节点和审计日志，每个 save id/branch 一个节点，不能挤占用户排轴快照和 now-storage。

## 目标

建立 AI Timeline Work Node 作为排轴智能体的新底层交互模型。

第一阶段目标：

- AI 不直接写真实 `sessionStorage` 排轴，也不把 `now-storage` 当作分支存储。
- 系统能复制当前 `TimelineSnapshotPayload` 成一份 appdata/localdata AI work node。
- work node 有独立日志，不挤占用户排轴快照和 now-storage。
- 系统能比较 base/working，给出结构化 diff。
- 系统能在校验通过、风险已标记后，把 working payload checkout/apply 回真实排轴。
- AI 可以在低风险策略内自行判断并继续；系统主要提供风险标记、diff、回退点，而不是默认强制拦截。
- 删除/修改类操作禁止模糊 fallback。

## 非目标

- 第一阶段不完整替换 def-opencode 面板。
- 第一阶段不实现全量自然语言 planner。
- 第一阶段不实现真正 MCP server。
- 第一阶段不让 AI 任意执行 JS 修改生产数据。
- 第一阶段不复刻 git 全功能，只做最小 worktree + diff + commit log。

## 数据模型

### 存储边界

AI work node 使用 appdata/localdata 下的独立文件或目录，开发环境对应 `data/localdata`，生产环境对应 runtime localdata。禁止把它写进：

- `def.timeline.snapshot-archive.v1`
- `def.ai-timeline.worktree-archive.v1` 这样的浏览器 localStorage key
- `now-storage.json`

浏览器 local/session storage 只允许表示“当前迁出”。如果前端保留 `timelineWorktree/storage.ts` 的 localStorage 版本，它只能作为 phase-0 checkout cache，不能视为最终工作节点实现。

建议 appdata 路径：

```text
data/localdata/ai-timeline-worknodes.json
```

或后续升级为目录：

```text
data/localdata/ai-timeline-worknodes/<saveId>/<nodeId>.json
```

### AI Work Node Archive

结构：

```ts
interface AiTimelineWorkNodeArchive {
  type: "def.ai-timeline.worknodes.v1";
  schemaVersion: 1;
  nodes: AiTimelineWorkNode[];
  commits: AiTimelineCommit[];
}
```

### Work Node

```ts
interface AiTimelineWorkNode {
  id: string;
  saveId: string;
  branchId: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  status: "open" | "ready" | "committed" | "applied" | "abandoned";
  basePayload: TimelineSnapshotPayload;
  workingPayload: TimelineSnapshotPayload;
  baseSummary: TimelinePayloadSummary;
  workingSummary: TimelinePayloadSummary;
  approvalPolicy: "auto-low-risk" | "ask-on-risk" | "manual";
  riskFlags: AiTimelineRiskFlag[];
  logs: AiTimelineWorkNodeLog[];
}
```

`saveId` 对应当前存档或排轴上下文。`branchId` 对应 AI 的一次独立尝试，语义类似轻量分支。

### Commit Log

```ts
interface AiTimelineCommit {
  id: string;
  nodeId: string;
  saveId: string;
  branchId: string;
  createdAt: number;
  label: string;
  summary: TimelinePayloadDiffSummary;
  basePayload: TimelineSnapshotPayload;
  appliedPayload: TimelineSnapshotPayload;
  riskFlags: AiTimelineRiskFlag[];
  approval: AiTimelineApproval;
  checkoutApplied: boolean;
}
```

commit log 是 AI 操作审计资产，不是用户排轴恢复资产。

### Risk Flag

```ts
interface AiTimelineRiskFlag {
  id: string;
  severity: "info" | "warning" | "blocker";
  code: string;
  message: string;
  path?: string;
}

interface AiTimelineApproval {
  mode: "auto" | "manual";
  approvedAt: number;
  approvedBy: "ai" | "user" | "system";
  rationale: string;
}
```

## Diff

第一阶段 diff 覆盖：

- selectedCharacters 变更。
- 技能按钮新增、删除。
- 技能按钮位置、技能、显示名变更。
- 按钮 selectedBuff 引用变更。
- Buff 实体新增、删除。
- 总数 summary。

Diff 输出应可读且结构化：

```ts
interface TimelinePayloadDiff {
  summary: TimelinePayloadDiffSummary;
  addedButtons: TimelineButtonDiffItem[];
  removedButtons: TimelineButtonDiffItem[];
  changedButtons: TimelineButtonChange[];
  addedBuffs: TimelineBuffDiffItem[];
  removedBuffs: TimelineBuffDiffItem[];
  selectedCharactersChanged: boolean;
}
```

Appdata work node 必须提供独立 diff/readiness 入口：

- `diffAiTimelineWorkNode` 读取 appdata node，不读取当前迁出态。
- 输出 base/working 的结构化 diff 和 risk flags。
- 输出 `readyToCheckout`，用于低阻塞判断是否可以自动 checkout。
- 不修改 work node，不写 current checkout，不写 now-storage。

## 校验

第一阶段最小校验：

- `selectedCharacters` 必须存在。
- `timelineData.staffLines` 必须存在。
- `skillButtonTable` 必须存在。
- `timelineData` 中每个按钮必须能在 `skillButtonTable` 找到。
- `skillButtonTable` 中每个按钮必须能在 `timelineData` 找到。
- 每个按钮引用的 Buff id 必须存在于 `allBuffList`。
- 删除类操作不得通过“第一个候选” fallback。
- `saveId` / `branchId` 必须存在，节点状态必须允许写入。
- appdata node 的 `workingPayload` 与当前 checkout apply 前必须重新 diff。

## Apply

通过校验后，系统调用既有 `applyTimelineSnapshotPayload()` 将 `workingPayload` checkout 到真实排轴。本地 REST/Electron `commit` 只能表示 work node 已提交为可审计记录，不能代表浏览器真实排轴已被 apply；只有 renderer 成功执行 checkout 后才能标记 `applied`。

真实 checkout 必须发生在当前主界面 renderer：

- renderer 从 appdata/localdata 读取 work node。
- renderer 校验 `workingPayload`，并在 apply 前与当前迁出态重新 diff。
- renderer 调用 `applyTimelineSnapshotPayload(workingPayload)` 写入当前 `sessionStorage/localStorage` 迁出态。
- renderer 回写 appdata work node：`status: "applied"`，并将对应 commit 标记 `checkoutApplied: true`。
- 如果命令要求 reload，renderer 再刷新页面以让 React 重新挂载当前迁出态。

### Create From Current Checkout

AI 需要能先申请一份当前排轴副本，再在 appdata work node 上思考和修改。这个动作也必须发生在 renderer，因为当前迁出态只在页面的 `localStorage` / `sessionStorage` 中完整可见。

`createAiTimelineWorkNodeFromCurrent` 语义：

- renderer 调用 `getCurrentTimelineSnapshotPayload()` 读取当前迁出态。
- renderer 将 payload 作为 `basePayload` 和初始 `workingPayload` 写入 appdata/localdata work node。
- appdata node 记录 `saveId` / `branchId` / `approvalPolicy` / 初始 risk flags。
- 不创建用户 timeline snapshot。
- 不写 `now-storage.json`。
- 不修改当前排轴。

Apply 成功后：

- 创建 `AiTimelineCommit`。
- 将 work node 标记为 `applied`。
- 不自动创建用户 timeline snapshot。
- UI 可选择展示 diff 和 commit 摘要。

Apply 失败或风险过高时：

- 不修改真实排轴。
- 保留 appdata work node。
- 将失败原因写入 node logs 和 risk flags。

低阻塞规则：

- 无 blocker 时，AI 可以用 `auto` approval 自行 checkout。
- 有 blocker 时，必须显式传入 manual approval，或者 checkout 失败。
- checkout 不使用用户 timeline snapshot 做日志；回退依据是 appdata node 的 `basePayload` 和 commit log。

## 与旧 command queue 的关系

旧 command queue 保留为兼容层，但不再作为 AI 排轴主线。

短期止血要求：

- `removeSkillButton` 的 `buttonId` 如果不是内部 id，必须按 label 精确解析；解析失败或多匹配则失败。
- `addBuff/removeBuff/setTargetResistance` 也不能在 `buttonId` 失配后静默 fallback。
- `step.finish` 不能触发最终 verifier，只能等待 `done/error/stopped`。

## 未来扩展

后续可以将 work node 能力包装成 MCP-like tools：

- `timeline.create_work_node`
- `timeline.diff_work_node`
- `timeline.apply_patch`
- `timeline.commit_work_node`
- `timeline.abandon_work_node`

模型生成的是 patch/DSL，系统负责编译、校验、apply。

## 当前风险点

- 现有 `timelineWorktree/storage.ts` 仍是浏览器 localStorage 过渡实现，不能作为最终安全边界。
- REST 开发服务、Electron IPC、Electron bridge 已有 AI work node appdata 文件 API；renderer 已新增 checkout command，但仍缺少可视化审核面板和有效排轴上下文下的完整手测覆盖。
- 还没有真实 patch planner，模型仍可能退回口述或 command queue。
- 自动审批只能覆盖低风险结构变更；删除、覆盖、跨存档 apply 必须至少标记 warning/blocker。
- UI 暂未提供 work node diff 审核面板，短期需要通过日志和手测清单验收。
