# def-opencode 主界面快速修复 Tasks

## Status

草案中，已完成首轮任务审核。

## Task List

### Task 1: 修正 addSkillButton 坐标写入

- 文件：`src/components/CanvasBoard/index.tsx`
- 修改 `addSkillButtonFromWorkbenchCommand` 中写入 `addTimelineButton` 的参数。
- 保持 runtime button 与 timelineData 的 `staffIndex` / `nodeIndex` 语义一致。
- 不改拖拽路径和人工添加路径。

验收：

- `addTimelineButton` 不再传 `staffIndex: lineIndex`。
- `addTimelineButton` 不再传 `nodeIndex: staffIndex * GRID_NODE_COUNT + nodeIndex`。
- 返回 result 仍包含 `staffIndex`、`lineIndex`、`nodeIndex`。

### Task 2: REST enqueue 增加 op 白名单

- 文件：`scripts/ai-cli-rest-server.mjs`
- 新增 main workbench 支持 op 集合。
- `/api/main-workbench/commands/enqueue` 过滤/拒绝未知 op。
- 未知 op 返回 400，不写入队列。

验收：

- 未知 op 返回 `invalid-main-workbench-command-op`。
- 单条和批量命令都校验 op。
- 支持列表与 `src/utils/mainWorkbenchControl.ts` 中当前 op 保持一致。

### Task 3: 修正只读/变更意图判断

- 文件：`src/components/CanvasBoard/MainWorkbenchAiPanel.tsx`
- 移除 `Buff|buff` 单独触发 mutating 的逻辑。
- 增加“明确动作词 + Buff”才视为 Buff 变更。
- 保持“加 Buff / 移除 Buff / 改 Buff”仍为 mutating。

验收：

- “当前有哪些 Buff”进入快照只读分支。
- “给 X 加 Buff”仍进入变更分支。

### Task 4: 收窄自动回退点创建

- 文件：`src/components/CanvasBoard/MainWorkbenchAiPanel.tsx`
- 新增 `shouldCreateWorkbenchRollback`。
- 只有高风险操作或用户明确要求回退时创建回退点。
- 单个技能按钮/Buff 添加删除不默认创建回退点。

验收：

- `sendWorkbenchPrompt` 不再直接用 `isMutatingWorkbenchPrompt` 决定回退点。
- 高风险关键词仍创建回退点。

### Task 5: 命令证据只接受 done

- 文件：`src/components/CanvasBoard/MainWorkbenchAiPanel.tsx`
- `hasPromptRequiredCommand` 只从 `status === 'done'` 的命令中找完成证据。
- 如果本轮命令仍 pending/running，应返回执行未确认。

验收：

- pending/running 不再被算作完成。
- error 仍优先报告错误。

### Task 6: settle 等待限定本轮

- 文件：`src/components/CanvasBoard/MainWorkbenchAiPanel.tsx`
- `hasActiveWorkbenchCommands` 支持 `since`。
- `waitForWorkbenchCommandsToSettle` 只等待 `createdAt >= activePromptStartedAt` 的命令。
- 不改 REST API，先在客户端过滤。

验收：

- 历史 pending 不影响当前轮次 settle。
- 当前轮次 pending/running 仍会等待。

### Task 7: addBuff 缺 payload 显式错误

- 文件：`src/components/CanvasBoard/index.tsx`
- 在 `addBuff` 分支访问 `command.buff` 前先校验。

验收：

- 缺少 `buff` 返回 `addBuff requires buff`。

### Task 8: refreshSnapshot 显式分支

- 文件：`src/components/CanvasBoard/index.tsx`
- 在默认 `calculateDamage` 逻辑前单独处理 `refreshSnapshot`。
- 返回当前 snapshot 或刷新摘要。

验收：

- `refreshSnapshot` 不再落入伤害计算分支。

## Task Review

### 本轮执行

本轮执行 Task 1-8。

理由：

- 全部是局部修复，风险可控。
- 不需要新增完整 agent kernel。
- 能直接降低假完成、队列污染、只读误判和状态错位。

### 暂缓任务

以下任务暂缓，不进入本轮：

- `batchId / turnId` 全链路。
- Buff 名称解析工具。
- 批量命令事务执行器。
- verifier 独立模块。
- opencode 原生 tool/plugin 深集成。

理由：

- 这些属于下一阶段架构任务。
- 当前先把已有链路中明确错误和误判修掉。

### 风险审核

- Task 1 可能影响通过 AI 命令新增按钮后的持久化位置，需要重点人工检查。
- Task 3/4 是启发式文本规则，只能改善常见场景，不能替代后续 intent parser。
- Task 6 只在客户端过滤历史命令，REST 队列历史污染仍存在，后续应引入 turnId/batchId。
- Task 8 的 snapshot 可能依赖当前 React effect 异步更新，本轮只做语义分支，不保证强实时刷新。
