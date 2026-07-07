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

AI 排轴应改为“工作树”模型：AI 修改副本，系统 diff、校验、dry-run，只有通过后才 apply 到真实排轴。

## 目标

建立 AI Timeline Worktree 作为排轴智能体的新底层交互模型。

第一阶段目标：

- AI 不直接写真实 `sessionStorage` 排轴。
- 系统能复制当前 `TimelineSnapshotPayload` 成一份 AI workspace。
- workspace 有独立日志，不挤占用户排轴快照。
- 系统能比较 base/working，给出结构化 diff。
- 系统能在校验通过后把 working payload apply 回真实排轴。
- 删除/修改类操作禁止模糊 fallback。

## 非目标

- 第一阶段不完整替换 def-opencode 面板。
- 第一阶段不实现全量自然语言 planner。
- 第一阶段不实现真正 MCP server。
- 第一阶段不让 AI 任意执行 JS 修改生产数据。
- 第一阶段不复刻 git 全功能，只做最小 worktree + diff + commit log。

## 数据模型

### AI Worktree Archive

AI worktree 使用独立 localStorage key，不使用 `def.timeline.snapshot-archive.v1`。

建议 key：

```text
def.ai-timeline.worktree-archive.v1
```

结构：

```ts
interface AiTimelineWorktreeArchive {
  version: "v1";
  worktrees: AiTimelineWorktree[];
  commits: AiTimelineCommit[];
}
```

### Worktree

```ts
interface AiTimelineWorktree {
  id: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  status: "open" | "committed" | "abandoned";
  basePayload: TimelineSnapshotPayload;
  workingPayload: TimelineSnapshotPayload;
  baseSummary: TimelinePayloadSummary;
  workingSummary: TimelinePayloadSummary;
  logs: AiTimelineWorktreeLog[];
}
```

### Commit Log

```ts
interface AiTimelineCommit {
  id: string;
  worktreeId: string;
  createdAt: number;
  label: string;
  summary: TimelinePayloadDiffSummary;
  basePayload: TimelineSnapshotPayload;
  appliedPayload: TimelineSnapshotPayload;
}
```

commit log 是 AI 操作审计资产，不是用户排轴恢复资产。

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

## 校验

第一阶段最小校验：

- `selectedCharacters` 必须存在。
- `timelineData.staffLines` 必须存在。
- `skillButtonTable` 必须存在。
- `timelineData` 中每个按钮必须能在 `skillButtonTable` 找到。
- `skillButtonTable` 中每个按钮必须能在 `timelineData` 找到。
- 每个按钮引用的 Buff id 必须存在于 `allBuffList`。
- 删除类操作不得通过“第一个候选” fallback。

## Apply

通过校验后，系统调用既有 `applyTimelineSnapshotPayload()` 将 `workingPayload` 写回真实排轴。

Apply 成功后：

- 创建 `AiTimelineCommit`。
- 将 worktree 标记为 `committed`。
- 不自动创建用户 timeline snapshot。
- UI 可选择展示 diff 和 commit 摘要。

## 与旧 command queue 的关系

旧 command queue 保留为兼容层，但不再作为 AI 排轴主线。

短期止血要求：

- `removeSkillButton` 的 `buttonId` 如果不是内部 id，必须按 label 精确解析；解析失败或多匹配则失败。
- `addBuff/removeBuff/setTargetResistance` 也不能在 `buttonId` 失配后静默 fallback。
- `step.finish` 不能触发最终 verifier，只能等待 `done/error/stopped`。

## 未来扩展

后续可以将 worktree 能力包装成 MCP-like tools：

- `timeline.create_worktree`
- `timeline.diff_worktree`
- `timeline.apply_patch`
- `timeline.commit_worktree`
- `timeline.abandon_worktree`

模型生成的是 patch/DSL，系统负责编译、校验、apply。
