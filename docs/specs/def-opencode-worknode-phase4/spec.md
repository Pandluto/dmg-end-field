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
- 中段：Work Node SQLite 树重构。把上部已经可运行的树原型升级成后端权威、可事务化、可迁移的历史数据结构，先解决树关系、HEAD、删除和加载性能问题。
- 后续中部：agent 回复风格和 skill / prompt 加载收敛。把 agent 从“编程助手口吻”调成 DEF 业务助手口吻，减少工具名、REST、schema 暴露。
- 下部：清理事实源和大文件边界。收敛 `/api/def-tools`、legacy registry、prompt 文案、adapter 文案之间的重复事实源，拆分过大的 UI / server 文件。

## Phase 4 中段：Work Node SQLite 树重构

### 问题定义

上部完成后，Work Node 树已经具备入口、路径高亮、分支、新增和删除等可运行交互，但底层仍是单个 `ai-timeline-worknodes.json`：

- list 为生成轻量响应，仍需同步读取和解析包含完整 payload 的大文件。
- `parentNodeId`、当前路径和删除状态没有完整的后端权威模型。
- 前端使用 parent override、deleted-id tombstone 和 active-id 补齐后端缺口，形成第二套事实源。
- Electron、31457 bridge 和 17321 REST 的树写入语义不一致。
- checkout 先改变前端 active-id，再异步应用 payload，失败时当前路径会失真。
- 删除约束只在 UI 判断，后端不能保证当前路径不被删除。

本中段不是继续压缩 JSON 响应，也不是把大 JSON 拆成多个小 JSON。目标是把 Work Node 建设为一个小型、可靠的本地版本历史子系统。

### 技术选择

- 使用 Electron 35 / Node 22 已内置的 `node:sqlite`，不引入 `better-sqlite3`、ORM 或独立数据库服务。
- SQLite 数据库是 Work Node 树、HEAD、提交关系和快照引用的唯一权威事实源。
- renderer 不直接访问数据库，只通过现有 Electron IPC / 31457 bridge / 17321 REST client 使用业务接口。
- 数据库访问封装在独立 store/repository 模块中，业务代码不直接依赖 `DatabaseSync`，为未来升级驱动保留边界。
- 本阶段使用完整不可变快照，不引入 delta chain、事件溯源或跨设备同步。

### 数据模型

数据库至少包含以下结构：

1. `work_node_snapshots`
   - `id`：内容 hash 或稳定 snapshot id。
   - `payload`：序列化后的完整 timeline payload。
   - `created_at`。
   - 相同内容复用同一 snapshot，节点列表查询不得选择 payload。
2. `work_nodes`
   - `id`、`save_id`、`branch_id`、`parent_id`。
   - `base_snapshot_id`、`working_snapshot_id`。
   - `label`、`status`、`approval_policy`。
   - `base_summary`、`working_summary`、`risk_flags`、`logs`。
   - `created_at`、`updated_at`。
3. `work_node_commits`
   - 保留现有 commit、approval、checkoutApplied 和 checkout 证据。
   - payload 改为 snapshot 引用，不在列表记录中内嵌。
4. `work_node_heads`
   - 按 `save_id` 保存唯一 `current_node_id` 和单调递增 `revision`。
   - HEAD 只在节点创建成功或 checkout/restore 应用成功确认后更新。
5. `work_node_meta`
   - 保存 schema version、legacy JSON migration 状态等数据库级元数据。

外键、唯一约束和必要索引至少覆盖：`parent_id`、`save_id + updated_at`、commit 的 `node_id`、snapshot 内容 hash。

### 权威树与 HEAD 语义

- `parent_id` 是唯一树关系，不再根据创建时间或 label 在前端推断父节点。
- list 返回轻量节点、轻量 commits、`heads`/当前 `headNodeId` 和 `revision`，不返回任何 snapshot payload。
- 新建 checkpoint 成功后，新节点成为对应 `save_id` 的 HEAD，因为它记录了当前主界面状态。
- 点击树节点只发起 checkout，不提前改变 HEAD。
- checkout 在 renderer 成功应用 working snapshot，并完成 `checkout-applied` 确认后，才把目标节点设为 HEAD。
- restore_base 成功确认后，需要留下明确操作证据；其 HEAD 语义由服务端统一处理，前端不得自行猜测。
- 当前路径由 HEAD 沿 `parent_id` 回溯得到；没有有效 HEAD 时才使用迁移期确定的兼容 head，不能长期用 latest-updated 猜测。

### 删除语义

- 删除由后端事务执行，前端只提交目标节点 id。
- 后端递归计算目标子树并删除整棵子树及其 commits。
- 如果目标子树包含任一有效 HEAD，删除必须失败。
- 删除成功后返回权威轻量树和新 revision。
- 删除后清理无引用 snapshot；清理可以在同一事务完成，本阶段数据规模不需要后台 GC。
- renderer 删除 parent override、deleted-id tombstone；不能再用本地隐藏伪装删除成功。

### Legacy JSON 迁移

- 首次打开数据库时，如果数据库没有 Work Node 且 legacy JSON 存在，执行一次迁移。
- 迁移在单个数据库事务中完成；失败时回滚，legacy JSON 保持不变。
- 保留已有 `parentNodeId`；仅对确实缺失父关系的 legacy 节点执行一次兼容推断，并把结果固化进数据库。
- snapshots 按内容 hash 去重导入，commits 改写为 snapshot 引用。
- 优先选择最近一次成功 checkout 的节点作为迁移 HEAD；没有 checkout 证据时选择最近更新节点。
- 迁移完成后写入 meta 标记。legacy JSON 只作为只读备份，不再双写。

### 运行时与接口收敛

- Electron IPC 和 31457 bridge 使用同一个 SQLite store 实例和同一套树操作。
- 17321 REST 使用同一 store 模块，但数据库路径仍遵循其开发环境路径。
- create/update/delete/list/commit/checkout-applied/rollback-applied 三条 transport 必须具有相同输入输出和错误语义。
- list cache 必须带 revision 或 generation；写操作不得让旧的 in-flight list 覆盖新状态。
- UI 打开树面板时只进行一次轻量查询，不做 health/probe 前置请求，不轮询完整树。

### 文件边界

- 新增独立 SQLite store/repository 文件，`electron/main.cjs` 只负责路径、IPC 和 HTTP 适配。
- `scripts/ai-cli-rest-server.mjs` 不再保留第二套 JSON Work Node CRUD。
- `localNodeClient.ts` 负责 transport 选择、协议归一化和 revision-aware cache，不保存业务真相。
- `WorkNodeTreePanel.tsx` 只消费后端返回的 HEAD 和树元数据，不持久化 parent/delete/active 补丁。

### 交互可靠性与对话呈现收敛（补充）

本节补充 SQLite 树重构之后暴露出的运行时闭环问题。重点不是继续用提示词约束模型，而是将“整组排轴复制”“checkout 应用”“时间轴渲染一致性”和“用户可见回复”分别固化在 DSL、校验器、前端状态恢复和展示层中。

#### 原子化批量排轴操作

- “把第一组所有按钮在第二组原封不动做一遍”必须使用单个 `copyStaffLine` Patch DSL 操作，不得由 agent 展开为多次 `addButton` 或逐按钮移动。
- `copyStaffLine` 必须显式提供 `sourceStaffIndex` 与 `targetStaffIndex`；源、目标相同或任一分组不存在时返回结构化错误。
- 默认保留源按钮的技能内容、运行时技能 ID、显示名称、命中配置和 Buff 关联，并生成新的按钮 ID；这样“原封不动”不会因重新解析技能而发生技能名或类型错位。
- 目标分组已有按钮时默认拒绝写入；只有用户明确要求覆盖时才允许 `replaceTarget:true`，并把覆盖作为风险项记录。
- 复制附带的 Buff 引用必须同步更新引用计数，不能只复制按钮文本或时间轴卡片。

#### 时间轴 payload 一致性

- `skillButtonTable` 是按钮运行时配置的完整表；`timelineData.staffLines` 是其画布分组与顺序投影。迁出前必须校验两者一一对应。
- 每个按钮必须恰好存在于一个 staff line 中，且该行 `staffIndex` 与按钮表的 `staffIndex` 相同；重复出现、缺失或分组不一致均为校验失败，禁止 checkout。
- checkout 应用 payload 后，前端必须从完整 `skillButtonTable` 重建所有已选干员的 `staffLines`，而非只依赖可能过时或损坏的某一条时间轴行。这样即使旧节点曾把按钮错误塞入第一组，也不会继续导致其他干员整行缺失。
- 未通过上述校验时，必须返回具体错误码或错误信息；不得显示“已完成”，也不得把失败伪装为等待浏览器执行。

#### checkout 与用户可见状态

- 受保护的明确变更在 `patch_and_validate` 验证通过后默认直接发起无刷新 checkout；节点保护用于保留可回退基线，不应把正常确认动作拆成“暂存后等待用户再迁出”的额外阻塞流程。
- checkout 命令入队不代表已完成：在 renderer 回执或快照验证前，用户可见状态只能是“正在应用到当前时间轴，等待执行确认。”；超时、连接断开或校验失败必须明确显示对应错误。
- checkout 成功后，运行时按钮表、已选干员、时间轴行和画布渲染必须在同一轮状态恢复中同步更新，不能要求用户完整刷新浏览器才能看到正确按钮位置或启用正确操作按钮。

#### 对话回复与内部工作草稿

- AI 对话区只承载用户可见的结果：成功时用一条简短自然中文说明实际改变；等待确认时说明等待原因；失败时说明失败原因或错误码。
- `Goal`、`Constraints`、`Progress`、工具名、REST 地址、命令 ID、patch 细节、验证草稿等属于内部工作草稿，只能进入“正在思考”的悬停详情，不能作为最终回复直接落入会话历史。
- 此分层由前端流式消息处理与最终消息归并保证；prompt 只作为辅助，不得成为避免泄漏或防止“pending。”式回复的唯一防线。

#### 验收补充

- 在第一组有 N 个按钮、第二组为空时执行整组复制，结果必须只在第二组新增 N 个具有新 ID 的按钮；第一组数量和内容不变。
- 第二组非空且用户未要求覆盖时，操作必须失败并保持两组均不变。
- 构造“按钮表 staffIndex 与所在 staff line 不一致”或“同一按钮位于两行”的 payload，validate 必须失败，checkout 不得执行。
- checkout 后无需刷新浏览器，所有已选干员的时间轴行、按钮位置和交互状态应立即一致。
- 用户只能在聊天区看到结果句；完整工作过程仅在“正在思考”悬停处可见。

### 验收标准

- 现有 legacy JSON 能一次性迁移，节点数、commit 数、父子关系和 payload 可读取。
- 打开树面板不读取或解析 legacy JSON，也不加载 snapshot payload。
- 创建子节点和同级分支后，关闭并重开应用仍保持正确关系。
- checkout 失败时 HEAD 和高亮路径不变化；成功后 HEAD 与路径同步变化。
- 当前路径任一节点及包含 HEAD 的子树都无法删除；灰色分支父节点删除会删除完整子树。
- Electron IPC、31457 bridge、17321 REST 对树操作行为一致。
- renderer 不再存在 Work Node parent override、deleted tombstone 或 active-id 权威状态。
- SQLite 数据库写入使用事务，进程中断不会产生半棵树或节点存在但 snapshot 缺失的状态。
- `npm run build` 通过，并有针对迁移、HEAD、子树删除和轻量 list 的自动化 smoke 验证。

### 非目标

- 本阶段不重构全部 localStorage/sessionStorage。
- 不把普通 UI 展开状态、hover 状态或临时表单状态迁入 SQLite。
- 不实现多用户、云同步、CRDT、远程数据库或 Git worktree。
- 不在本阶段继续扩展节点树视觉设计，除非 SQLite 权威状态接入需要调整。
