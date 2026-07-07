# AI Timeline Worktree Tasks

## Status

本轮执行第一阶段：规格落地、最小 worktree 核心、旧 command queue 止血。

## Task 1: 新增 worktree 类型和存储模块

- 新增 `src/agentKernel/timelineWorktree/types.ts`。
- 新增 `src/agentKernel/timelineWorktree/storage.ts`。
- 使用独立 key：`def.ai-timeline.worktree-archive.v1`。
- 提供：
  - `listAiTimelineWorktrees()`
  - `getAiTimelineWorktree(id)`
  - `createAiTimelineWorktree(payload, label)`
  - `updateAiTimelineWorktree(worktree)`
  - `listAiTimelineCommits()`

验收：

- 不写 `def.timeline.snapshot-archive.v1`。
- archive 读坏数据时返回空 archive。

## Task 2: 新增 payload diff

- 新增 `src/agentKernel/timelineWorktree/diff.ts`。
- 比较 base/working payload。
- 覆盖按钮新增、删除、变更、Buff 新增删除、selectedCharacters 变更。

验收：

- 对新增按钮返回 `addedButtons`。
- 对删除按钮返回 `removedButtons`。
- 对按钮位置或技能变化返回 `changedButtons`。

## Task 3: 新增 validator

- 新增 `src/agentKernel/timelineWorktree/validator.ts`。
- 校验 timelineData 与 skillButtonTable 一致。
- 校验 selectedBuff 引用存在。

验收：

- timeline 有按钮但 table 缺失时失败。
- table 有按钮但 timeline 缺失时失败。
- selectedBuff 引用不存在时失败。

## Task 4: 新增 service facade

- 新增 `src/agentKernel/timelineWorktree/index.ts`。
- 提供：
  - `createWorktreeFromCurrentTimeline(label)`
  - `diffWorktree(id)`
  - `commitWorktree(id, label)`
  - `abandonWorktree(id)`

验收：

- commit 前先 validate。
- commit 后调用 `applyTimelineSnapshotPayload`。
- commit 写入独立 commit log。

## Task 5: 旧 command queue 删除止血

- 修改 `removeSkillButton` 解析。
- 支持内部 id 精确匹配。
- 支持可读 label 精确匹配，例如 `莱万汀-燃烬@1-3`。
- 匹配不到或多匹配直接失败。
- 禁止 `buttonId` 失配后 fallback 到第一个候选。

验收：

- `buttonId:"不存在"` 不删除任何按钮，返回错误。
- `buttonId:"莱万汀-燃烬@1-3"` 只删除 label 精确匹配按钮。
- 多匹配时返回错误。

## Task 6: step.finish 不 finalize

- 修改 `MainWorkbenchAiPanel` 流处理。
- `step.finish` 只更新状态，不触发 `finishMessageWithSnapshotFallback`。
- 只有 `done/error/stopped` 结束 turn。

验收：

- verifier 不会早于最终 `done` 执行。

## Task 7: 验证

- 跑 `npm run build`。
- 跑 `npm test`。
- 用 Vite SSR 做 worktree diff/validate smoke。
- 确认 `electron:dev` 仍在。

## 本轮不做

- 不接入完整自然语言 patch planner。
- 不做真正 MCP server。
- 不做 worktree UI 面板。
- 不让 AI 执行任意 JS。
