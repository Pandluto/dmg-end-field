# DEF OpenCode Worknode Phase 4 Spec

## 阶段定位

第四阶段不是另起一套 AI 能力，也不是先做攻略知识蒸馏。

本阶段先回到基础建设，补齐第三阶段暴露出来的前端闭环缺口：后端和 tools 已经有 work node、patch、validate、diff、checkout/restore 等基础能力，但主界面还没有把这些能力产品化展示出来。

目标是让 DEF agent 的本地工作节点真正成为用户可见、可理解、可验收、可回退的安全机制。

## 核心目标

- 对齐 work node 后端、typed tools、agent prompt、主界面前端之间的概念。
- 补全主界面对 work node 的展示、验收、应用、回退能力。
- 让用户知道 AI 创建了哪个节点、改了什么、校验是否通过、是否已经 checkout。
- 在写代码过程中，如果发现底层逻辑、数据结构、tool schema、verify 能力不完整，要同步修正，不把问题推给前端。
- 保持低阻塞原则：审批和验收应尽量是可见记录和柔性确认，不做无意义强拦截。

## 暂定范围

### 1. Work Node 前端闭环

需要让主界面至少能看见：

- 当前 AI work node 列表
- 节点状态
- 节点创建时间和来源
- 节点 base / working 的差异摘要
- validate / risk flags
- checkout / restore / discard 等操作入口
- restore 前后状态和当前迁出态变化证据

### 2. Agent 操作可见性

AI 对 work node 做过的事情应该能被用户理解：

- 创建节点
- patch 了什么
- validate 结果
- diff 摘要
- 是否触碰当前迁出态
- 是否等待用户验收

### 3. 当前迁出态与本地节点区分

必须继续明确：

- 当前迁出态不是 localStorage/sessionStorage 的抽象名词。
- work node 是 appdata/localdata 中独立保存的节点。
- checkout 才会把 work node 的 workingPayload 应用到当前主界面排轴。
- restore_base 才会把 work node 的 basePayload 应用回当前主界面排轴。
- 前端文案和状态展示不能把两者混淆。

### 4. 基础建设同步修正

本阶段写代码时，如果发现以下问题，要同步修：

- tool 输入/输出不适合前端展示
- diff 摘要不够结构化
- validate 结果缺字段
- work node 状态机不清晰
- checkout/restore/discard 缺少可验证结果
- restore_base 只能作为“回退到节点基线”，不能被展示成任意历史版本管理。
- agent prompt 与真实工具能力不一致
- REST 后门测试、前端 UI event、agent transcript 三者口径混乱

## 非目标

- 不优先做大型攻略知识库。
- 不优先做高级组合工具优化，除非它阻塞前端闭环验收。
- 不做录制回放式业务脚本。
- 不把固定角色、装备、Buff、排轴套路硬编码进产品逻辑。

## 验收方向

第四阶段完成时，用户应能在主界面回答这些问题：

- AI 是否创建了 work node？
- 这个节点改了什么？
- 当前排轴有没有被改？
- 这个节点是否校验通过？
- 我能不能应用它？
- 我能不能丢弃或回退它？
- 回退到底回到了哪个节点的 basePayload？
- 如果 AI 说完成了，前端是否有对应证据？

## 待明日展开

明日需要继续补充：

- 具体 UI 结构
- 具体 REST / typed tools 缺口
- work node 状态机
- 前端组件拆分
- task 列表
- 手测清单
- 与第三阶段 feedback 的风险项逐条对应

## Phase 4 上部：Work Node 明盒化

第四阶段优先解决的第一个问题是把 work node 从黑盒变成明盒。第三阶段已经打通了 work node / patch / validate / diff / checkout / restore 等能力，但用户目前看不见“AI 到底创建了哪些节点、节点之间如何发展、哪个节点影响了当前排轴、回退会回到哪里”。因此上部阶段不继续扩展新业务工具，而是先把本地节点管理产品化。

### 入口与布局

- 主界面右区 AI 模式标题栏旁边的空位用于新增一个 work node 入口按钮。
- 入口按钮优先使用一个简洁 SVG 图标，表达“节点树 / 分支 / 历史”的含义。
- 点击后在 AI 模式区域内打开 work node 面板；不额外创建独立页面，不打断当前主界面工作流。
- 面板可以是右区内的 tab / drawer / overlay，但必须和 AI 对话区并列理解：AI 对话负责自然语言交互，work node 面板负责节点事实和回退证据。

### 专用数据结构

需要为 UI 明盒化定义独立的视图模型，不直接把底层 `ai-timeline-worknodes.json` 原样塞给组件。

建议新增一层专用 TS 模型，至少表达：

- `nodeId`
- `parentNodeId?`
- `source`: `manual-checkpoint` / `ai-turn` / `checkout` / `restore` / `discard`
- `title`
- `createdAt`
- `updatedAt`
- `status`: `draft` / `validated` / `blocked` / `checked-out` / `restored` / `discarded`
- `summary`
- `diffSummary`
- `riskFlags`
- `conversationId?`
- `messageId?`
- `checkoutTouched`
- `basePayloadRef`
- `workingPayloadRef`

UI 使用这层模型渲染节点树，底层存储仍可继续沿用现有 appdata/localdata work node 存储，但需要在转换层里补齐树形关系和展示摘要。

### 专用文件边界

上部实现时应避免继续把逻辑塞进 `CanvasBoard/index.tsx` 或 `MainWorkbenchAiPanel.tsx`。

建议至少拆出：

- `WorkNodeTreePanel.tsx`：节点树主面板。
- `WorkNodeTreeNode.tsx`：单个节点行 / 节点卡片。
- `workNodeTreeModel.ts`：底层节点到 UI 树模型的转换。
- `workNodeAutosave.ts`：AI 模式进入、AI 对话前后自动保存节点的策略。
- `workNodeTreeTypes.ts`：节点树视图模型类型。

如果现有目录更适合放在 `src/components/CanvasBoard/` 下，也应保持独立文件，不把节点树 UI 写进主画布大文件。

### AI 编辑与人工编辑的区分

必须明确区分人工手动编辑节点和 AI 编辑节点。

- 用户手动点击进入 AI 模式时，系统自动保存一次 `manual-checkpoint` 节点，作为进入 AI 协作前的人工基线。
- 每次自然语言对话触发 AI 变更时，都要保存一个新的 `ai-turn` 节点。
- AI 节点必须关联对话轮次或消息 id，方便从节点树追溯到对应 AI 回复。
- AI 节点的保存不能覆盖人工基线；回退时用户应能看懂“回到进入 AI 模式前的人工状态”还是“回到某一次 AI 对话后的状态”。
- 如果用户在 AI 模式中又手动改了排轴，应产生新的人工 checkpoint 或至少标记当前 checkout 已被人工改动，不能继续把旧 AI 节点当作唯一事实源。

### 可视化闭环

AI 模式 UI 层需要顺手补齐轻量状态提示：

- 当前回复计时 / 等待计时。
- 当前对话是否创建了 work node。
- 当前节点 id / 简短标题。
- 当前节点状态：draft、validated、blocked、checked-out、restored 等。
- 当前节点是否触碰当前排轴。
- 当前节点数量和最新节点时间。
- checkout / restore / discard 的结果提示必须落在节点树和 AI 对话区两侧都能看见的位置。

这些状态提示不应暴露 REST、schema、tool call 等开发概念。用户看到的是“AI 保存了一个草稿节点”“草稿校验通过”“当前排轴未被改动”“已应用到当前排轴”。

### Restore 语义边界

恢复排轴和 work node 回退必须拆清楚：

- 传统恢复排轴是业务快照恢复。
- work node `restore_base` 是回到某个 AI 节点的 basePayload。
- work node `checkout` 是把某个 AI 节点的 workingPayload 应用到当前排轴。
- UI 文案不能把 work node base restore 展示成任意历史版本管理。
- 如果某个恢复动作背后使用了 work node，必须在节点树里留下可见记录。

## Phase 4 开发时序

- 上部：work node 明盒化。优先完成入口、节点树、专用数据结构、自动保存节点、AI 模式状态提示、checkout/restore 可见证据。
- 中部：agent 回复风格和 skill / prompt 加载收敛。把 agent 从“编程助手口吻”调成 DEF 业务助手口吻，减少工具名、REST、schema 暴露。
- 下部：清理事实源和大文件边界。收敛 `/api/def-tools`、legacy registry、prompt 文案、adapter 文案之间的重复事实源，拆分过大的 UI / server 文件。
