# DEF OpenCode Worknode Phase 4 Tasks

> 本文件先记录第四阶段任务大纲。具体任务拆分明日继续展开。

## Task 0：对齐第三阶段遗留问题

- [ ] 复读第三阶段 feedback，确认哪些问题属于前端闭环，哪些属于 tool/runtime 基础建设。
- [ ] 明确第四阶段不以攻略知识库为主线，先补齐 work node 产品闭环。

## Task 1：梳理现有 Work Node 能力

- [ ] 梳理当前已有 REST / typed tools / command queue 能力。
- [ ] 梳理 appdata/localdata work node 的数据结构。
- [ ] 梳理 checkout、restore、patch、validate、diff 的真实行为。
- [ ] 标记缺字段、缺状态、缺 verify 的地方。

## Task 2：设计前端闭环

- [ ] 设计 work node 列表入口。
- [ ] 设计节点详情和 diff 预览。
- [ ] 设计 validate / risk flags 展示。
- [ ] 设计 checkout / restore / discard 操作入口。
- [ ] 明确当前迁出态与 work node 预览态的区分。

## Task 3：边写边补基础建设

- [ ] 如果前端需要结构化 diff，就补 tool 输出。
- [ ] 如果状态机不清楚，就补状态字段。
- [ ] 如果 verify 不够，就补验收工具。
- [ ] 如果 agent prompt 与实际能力不一致，就同步修 prompt。

## Task 4：验收与手测

- [ ] 手测 AI 创建 work node 后前端可见。
- [ ] 手测 patch 后 diff 可见。
- [ ] 手测 validate 结果可见。
- [ ] 手测 checkout 前当前排轴不被污染。
- [ ] 手测 checkout 后当前排轴变化可见。
- [ ] 手测 restore / discard 行为可理解、可验证。

## Phase 4 上部任务：Work Node 明盒化

### Task A：右区入口与面板骨架

- [ ] 在主界面右区 AI 模式标题栏旁边新增 work node 入口按钮。
- [ ] 入口按钮使用节点树 / 分支语义的 SVG 图标。
- [ ] 点击入口后在 AI 模式区域打开 work node 面板。
- [ ] 面板必须和 AI 对话区共存，不跳转页面，不打断主界面排轴操作。

### Task B：节点树视图模型

- [ ] 新增 work node 树视图模型类型，区分底层存储节点和 UI 展示节点。
- [ ] 模型至少包含 nodeId、parentNodeId、source、title、createdAt、updatedAt、status、summary、diffSummary、riskFlags、conversationId、messageId、checkoutTouched。
- [ ] 支持 `manual-checkpoint`、`ai-turn`、`checkout`、`restore`、`discard` 等 source。
- [ ] 支持 `draft`、`validated`、`blocked`、`checked-out`、`restored`、`discarded` 等 status。
- [ ] 新增转换层，把 appdata/localdata work node 数据转换成可渲染树。

### Task C：专用组件和文件边界

- [ ] 新增独立 TSX 文件承载 work node 树面板，不继续堆进 `CanvasBoard/index.tsx`。
- [ ] 新增独立 TS 文件承载节点树转换、自动保存策略和类型。
- [ ] `MainWorkbenchAiPanel` 只负责挂入口和展示轻量状态，不承载节点树核心逻辑。
- [ ] 节点树 UI 至少能展示节点标题、来源、状态、创建时间、diff 摘要、风险提示。

### Task D：人工 checkpoint 与 AI turn 节点保存

- [ ] 用户手动点击进入 AI 模式时，自动保存一次 `manual-checkpoint` 节点。
- [ ] 每次自然语言对话触发 AI 变更时，自动保存一个新的 `ai-turn` 节点。
- [ ] AI turn 节点必须关联 conversationId 或 messageId，便于追溯到具体对话。
- [ ] AI 节点不能覆盖人工 checkpoint。
- [ ] 如果 AI 模式中用户又手动编辑当前排轴，必须产生新的人工 checkpoint 或标记当前 checkout 已被人工改动。

### Task E：AI 模式可视化闭环

- [ ] AI 模式 UI 显示当前回复计时 / 等待计时。
- [ ] AI 模式 UI 显示本轮是否创建 work node。
- [ ] AI 模式 UI 显示当前节点 id 或短标题。
- [ ] AI 模式 UI 显示节点状态：draft / validated / blocked / checked-out / restored。
- [ ] AI 模式 UI 显示当前节点是否触碰当前排轴。
- [ ] AI 模式 UI 显示节点数量和最新节点时间。
- [ ] checkout / restore / discard 结果必须同时能在 AI 对话区和节点树中看见。

### Task F：恢复排轴与 Work Node 语义拆分

- [ ] UI 文案区分传统恢复排轴、work node checkout、work node restore_base。
- [ ] `restore_base` 只能说明为回到某个 AI 节点的 basePayload，不能展示成任意历史版本管理。
- [ ] 如果恢复动作使用了 work node，节点树必须留下可见记录。
- [ ] checkout 前必须能看到将要应用的 diff / risk / validate 结果。
- [ ] restore 前必须能看到将要回到的 base 摘要。

## Phase 4 中部任务：回复风格与 Skill / Prompt 收敛

- [ ] 收敛 agent 回复口吻，使其像 DEF 业务助手，而不是编程助手。
- [ ] 默认不向用户暴露 REST、schema、tool call、work node 内部字段，除非用户主动询问。
- [ ] 收敛 skill / prompt 加载优先级，保证低风险编辑走 current checkout typed tools，高风险 / 批量 / 重排走 work node。
- [ ] 清理仍在 prompt 中出现的旧路径、重复工具说明和开发者口吻。

## Phase 4 下部任务：事实源和大文件收敛

- [ ] 收敛 `/api/def-tools`、legacy tool registry、adapter prompt、Electron/dev-agent prompt 之间的重复事实源。
- [ ] 评估拆分 `scripts/ai-cli-rest-server.mjs` 中的 DEF tools runtime 逻辑。
- [ ] 评估拆分 `electron/main.cjs` 中的 work node / bridge 逻辑。
- [ ] 评估拆分 `CanvasBoard/index.tsx` 中的 AI work node checkout / restore 逻辑。

