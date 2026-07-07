# AI Timeline Worktree Tasks

## Status

本轮已执行第一阶段止血，并开始第二阶段：把错误的浏览器 worktree 口径修正为 appdata/localdata AI work node。

执行结果：

- Task 1: 已新增 worktree 类型和独立存储模块。
- Task 2: 已新增 payload diff。
- Task 3: 已新增 validator。
- Task 4: 已新增 service facade。
- Task 5: 已完成 `removeSkillButton` / Buff 按钮定位止血。
- Task 6: 已禁止 `step.finish` finalize。
- Task 7: 已跑 build、test、worktree smoke。
- Task 8: 已完成，修正 spec/task 的存储边界。
- Task 9: 已完成，新增 appdata/localdata AI work node REST API 骨架。
- Task 10: 已完成，跑 build/test/REST smoke，并 review 风险。
- Task 11: 已完成，新增 Electron IPC/bridge AI work node appdata API，并让前端 client 桌面优先。
- Task 12: 已完成，新增 renderer checkout/apply command，把 appdata work node 应用到当前迁出态。
- Task 13: 待执行，新增 renderer create-from-current command，从当前迁出态创建 appdata work node。

## Task 8: 修正存储边界

- 明确 `localStorage` / `sessionStorage` 是当前前端迁出状态。
- 明确 `now-storage.json` 是当前迁出同步位。
- 明确 AI work node 必须保存在 appdata/localdata 独立文件或目录。
- 将现有浏览器 localStorage worktree 定位为 phase-0 checkout cache，而不是最终架构。

验收：

- spec 不再把 `def.ai-timeline.worktree-archive.v1` 描述为最终 AI 分支存储。
- spec 明确每个 save id/branch 对应独立工作节点。
- spec 明确修改日志不挤占用户排轴恢复位。

风险：

- 现有代码仍有浏览器 localStorage 过渡模块，后续需要迁移调用链。

## Task 9: 新增 appdata/localdata AI work node REST API 骨架

- 在本地 REST 服务中新增独立文件存储：`data/localdata/ai-timeline-worknodes.json`。
- 提供最小 API：
  - `GET /api/ai-timeline-worknodes`
  - `POST /api/ai-timeline-worknodes/create`
  - `GET /api/ai-timeline-worknodes/:id`
  - `POST /api/ai-timeline-worknodes/:id/update`
  - `POST /api/ai-timeline-worknodes/:id/commit`
- 节点字段包含 `saveId`、`branchId`、`basePayload`、`workingPayload`、`riskFlags`、`logs`、`approvalPolicy`。
- API 不写 `now-storage.json`，不写用户 timeline snapshot archive。

验收：

- `/health` 能暴露 work node 存储路径。
- create/update/commit 能落盘到 appdata/localdata 文件。
- update/commit 会记录日志和风险标记。
- commit 只标记本地节点 `committed`，不伪装成已 checkout 到真实排轴。
- 缺少 payload 或 id 不存在时返回结构化错误。

风险：

- REST API 只是开发期骨架，Electron IPC 仍需后续补齐。
- 尚未把主界面 AI 面板完全切换到这个 API。

## Task 10: 验证与 review

- 跑 `npm run build`。
- 跑 `npm test`。
- 重启 `npm run ai-cli:rest` 后跑 work node API smoke。
- 检查 git diff，确认没有误写 now-storage 或排轴 snapshot archive。

验收：

- 构建通过。
- 单测如现状通过。
- REST smoke 能创建、更新、提交一个独立 AI work node。
- 手测清单更新为新架构口径。

## Task 11: 新增 Electron appdata 入口

- 在 Electron main localdata 模块中新增 `ai-timeline-worknodes.json` 路径。
- 新增 Electron IPC：
  - `desktop:list-ai-timeline-worknodes`
  - `desktop:create-ai-timeline-worknode`
  - `desktop:read-ai-timeline-worknode`
  - `desktop:update-ai-timeline-worknode`
  - `desktop:commit-ai-timeline-worknode`
- 新增 31457 bridge HTTP：
  - `GET /local-data/ai-timeline-worknodes`
  - `POST /local-data/ai-timeline-worknodes/create`
  - `GET /local-data/ai-timeline-worknodes/:id`
  - `POST /local-data/ai-timeline-worknodes/:id/update`
  - `POST /local-data/ai-timeline-worknodes/:id/commit`
- `localNodeClient` 在 Electron 环境优先走 `window.desktopRuntime`，否则回退 REST。
- `listLocalDataArchives()` 排除 `ai-timeline-worknodes.json`，避免本地工作节点出现在用户存档列表里。

验收：

- Electron IPC/bridge 均写入 appdata/localdata 的 `ai-timeline-worknodes.json`。
- work node 文件不写入 `now-storage.json`。
- commit 仍只标记 `committed`，`checkoutApplied:false`，不伪装成真实排轴已应用。

风险：

- 真实 checkout apply 流程还未实现。
- REST 与 Electron 目前有重复的 work node 存储逻辑，后续应抽共享模块减少漂移。

## Task 12: 新增 renderer checkout/apply command

- 新增主界面命令 `checkoutAiTimelineWorkNode`。
- 命令在 renderer 中执行：
  - 从 appdata/localdata 读取 work node。
  - 校验 `workingPayload`。
  - 无 blocker 风险时允许 AI auto approval 继续。
  - 有 blocker 风险时要求 manual approval。
  - 调用 `applyTimelineSnapshotPayload(workingPayload)` 写入当前迁出态。
  - 回写 appdata：node `status: "applied"`，commit `checkoutApplied:true`。
  - 可选 reload，让 UI 重新挂载迁出态。
- 不创建用户 timeline snapshot。
- 不写 `now-storage.json`。
- REST/Electron appdata API 新增 `checkout-applied` 回写动作。

验收：

- command queue 已支持 `checkoutAiTimelineWorkNode`。
- renderer 命令已调用 `applyTimelineSnapshotPayload(workingPayload)`。
- appdata commit 已支持标记 `checkoutApplied:true`。
- REST 与 Electron bridge 的 `checkout-applied` smoke 已通过。
- blocker 风险无 explicit approval 时在 renderer 命令中失败且不 apply。

风险：

- 还没有 UI 审核面板；短期通过 command result、work node log 和手测 smoke 验证。
- 还没有 patch planner；AI 仍需要先生成/更新 work node，再 checkout。
- 当前自动化 smoke 未覆盖有效已选干员排轴上下文里的完整 renderer reload 后视觉验收，需要后续手测。
- renderer apply 与 appdata 回写不是事务；若回写失败，命令结果会返回 `checkoutMarkError`，需要后续补偿重试入口。

## Task 13: 新增 renderer create-from-current command

- 新增主界面命令 `createAiTimelineWorkNodeFromCurrent`。
- 命令在 renderer 中执行：
  - 调用 `saveTimelineData()` 刷新当前迁出态。
  - 调用 `getCurrentTimelineSnapshotPayload()` 读取完整 payload。
  - 调用 appdata/localdata work node client 创建节点。
  - 返回 node id、save id、branch id、summary、risk flags。
- 默认 `saveId` 使用当前显式参数；没有参数时使用 `current-main-workbench`。
- 默认 `branchId` 使用时间戳生成。
- 不创建用户 timeline snapshot。
- 不写 `now-storage.json`。
- 不修改当前排轴。

验收：

- command queue 支持 `createAiTimelineWorkNodeFromCurrent`。
- 有效排轴上下文下可创建 appdata work node。
- 创建后的 work node 的 `basePayload` 与 `workingPayload` 都来自当前迁出态。
- 缺少当前 payload 时失败且不写空节点。

风险：

- 还没有 UI 按钮；短期由 AI/REST command queue 调用。
- 自动 saveId 仍是粗粒度默认值，后续应与真实存档 id/branch 管理绑定。

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
- 不把 appdata work node 和 now-storage 合并。
