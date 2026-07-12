# Spec 7：DEF OpenCode 本地特色化前后端联合开发

## 状态

已定稿，等待任务拆分与实施。

## 背景

Spec 6 已完成 DEF tools 三类注册、隔离子节点中的 OpenCode 原生代码工具、Work Node 校验/审批/use 闭环，以及 Workbench AI mode 与 `/AI CLI` 对同一套 OpenCode 原生前端的复用。

真实手测同时暴露出两组问题：

1. Spec 6 的职责隔离尚有运行时缺口：Workbench 曾实际使用 `Def-operator`，否认自己可以排轴；主界面上下文虽传入组件却未进入 agent；OpenCode session 历史与 Work Node/checkout 历史尚未形成业务关联。
2. 原生 OpenCode 仍以通用代码项目产品形态出现：宿主残留“新建会话/工作节点”，原生 UI 暴露 `DEV`、Git“更改”、添加模型、server/project/provider 等综合入口，且视觉与项目黑白蓝线稿风格不一致。

Spec 7 负责补齐上述职责缺口，并在不重写原生聊天内核的前提下，把共享 OpenCode UI 产品化为两个职责不同、状态独立的 DEF 宿主界面。

## 原始工具架构约束

本阶段严格遵循用户定义的三类工具，不新增第四类：

> def-节点代码修改；def-节点简单增删改查；def-数据资源（武器干员装备填表这部分）。

对应正式注册 id：

- `def-node-code`：节点代码修改；
- `def-node-crud`：节点简单增删改查和生命周期；
- `def-data-resource`：武器、干员、装备、技能、Buff、伤害与填表数据资源。

“类写代码”是第一类 `def-node-code` 的执行方式，不是独立工具分类。三类工具可以在同一个 agent loop 中组合，但事实源、权限、职责和审批语义必须保持清晰。

## 总体目标

1. Workbench AI mode 强制使用 `def-workbench`，恢复排轴、自由节点修改、审查和应用职责。
2. `/AI CLI` 保持数据资源、填表、资料处理和独立 Agent 职责，不继承 Workbench 当前会话、节点或上下文。
3. 将 `def-node-code` 从巨型 JSON 原型升级为可靠的节点代码工作区协议。
4. 删除宿主重复按钮，将会话、节点变更和历史收敛到共享 OpenCode 原生界面。
5. 用 host profile 与 feature matrix 裁剪模型、server、project、Git、terminal 等越界综合入口。
6. 将原生“更改”改造成 DEF“节点变更”，复用原生 review/diff UI但切换到 Work Node 事实源。
7. 使用项目黑白蓝线稿主题适配原生 OpenCode，消除深色双顶栏和通用圆角聊天风格。
8. 对需要询问、确认或审批的 DEF tools 复用 OpenCode 原生交互协议。
9. 建立 session、host、agent、Work Node、revision、checkout 和历史恢复的联合模型。

## 总体架构

```text
Main Workbench AI mode ─┐
                        ├─ Shared DEF OpenCode UI
/AI CLI ────────────────┘        │
                                 ├─ host bootstrap profile
                                 ├─ feature matrix
                                 ├─ DEF theme adapter
                                 ├─ session/history controller
                                 └─ native timeline/tool/diff/permission UI

Workbench profile
  → locked def-workbench
  → current checkout/context
  → def-node-code + def-node-crud + def-data-resource
  → node workspace → rebuild → validate → diff → approval → use

AI CLI profile
  → independent DEF agent/profile
  → data-resource/fill/document tasks
  → optional own node workspace
  → never inherits Workbench active state
```

共享前端不等于共享 active session。两个宿主可以连接同一个 sidecar/OpenCode runtime并使用同一份工具注册代码，但必须隔离 agent、session、history、directory、context、active node、pending approval 和本地持久状态。

## 第一部分：补齐 Workbench 与 `/AI CLI` 职责隔离

### 1.1 Workbench agent 全链路锁定

Workbench session 必须从创建到结束始终绑定 `def-workbench`：

- native session create；
- session restore/switch；
- message send；
- retry/continue；
- compact/fork session；
- tool continuation与 permission resolve；
- sidecar/runtime 重启恢复。

不能只在 session create payload 写入 agent。OpenCode 前端本地 agent 选择、全局 `default_agent`、旧 localStorage、模型选择器和上一个会话状态均不得把 Workbench 切回 `Def-operator` 或其他 agent。

Workbench 界面不显示通用 agent 选择器。后端发送入口必须校验 session metadata 中的 `host=workbench` 与 `agent=def-workbench`；不匹配时拒绝或纠正，不能静默运行错误 agent。

### 1.2 Workbench 业务职责

Workbench 必须理解自己可以：

- 读取当前排轴和节点状态；
- 自由新增、删除、移动、复制或组合修改技能按钮；
- 调整组别、格位、顺序和节点内容；
- 解析并引用可信干员、技能、武器、装备和 Buff；
- 比较修改前后节点与伤害相关输入；
- 创建子节点、继续已有节点、校验、展示 diff；
- 根据用户表达停在预览或进入 approval/use；
- 恢复节点基线或继续从已应用节点派生。

用户询问“你可以排轴吗”时，不得回答“没有排轴工具，只能帮你查数据或辅助你手动排轴”。排轴不是一把专用 tool，而是三类工具组合后的核心 Workbench 能力。

### 1.3 Workbench 上下文 contract

主界面必须向 Workbench session 提供有版本、可按需读取的上下文：

- 当前 HEAD、checkout ref 与当前有效节点；
- 当前选中干员及稳定 id；
- 当前技能按钮、staff、组别、格位和顺序摘要；
- 当前 Buff 引用；
- 当前目标、抗性、异常和伤害摘要；
- 当前未应用/待审批节点；
- snapshot version、updatedAt 与来源。

`selectedCharacters`、`skillButtons` 和 `onWorkNodeChanged` 等宿主输入不得继续被接收后丢弃。上下文以只读 native tool、host context endpoint 或 session attachment 按需提供，不把完整巨型 payload永久硬编码进 system prompt。

### 1.4 `/AI CLI` 职责

`/AI CLI` 默认承担：

- 干员、武器、装备、技能、Buff、伤害等数据资源查询；
- 填表、校验、修复和资料处理；
- 自己的独立 Agent 工作；
- 明确任务需要时创建并修改它自己的节点工作区。

它不得继承 Workbench 当前 axis、active node、checkout context、session transcript 或 pending approval。即使两个宿主使用相同数据资源工具，也必须通过各自 session/profile 路由。

## 第二部分：落实 `def-节点代码修改`

### 2.1 正式定义

`def-node-code` 是隔离节点代码工作区中的自由文件修改能力：模型使用 OpenCode 原生 `read/edit/apply_patch` 修改规范化节点源文件，由 codec 重建完整 payload，再经过校验、语义 diff、风险分析、审批和 use。

禁止将其退化为：

- 为移动按钮、添加 Buff、复制技能等每个动作新增专用按钮级 tool；
- 旧 REST command/JSON 命令的模型编排；
- Patch DSL 的唯一表达方式；
- 查完数据后要求用户手动完成排轴；
- prompt 声称自由修改，实际没有原生文件编辑证据。

### 2.2 节点代码工作区协议

工作区至少区分：

```text
node/
  manifest.json          # node/session/revision/hash/schema，只读
  base/**                # repository 基线投影，只读
  working/**             # 规范化业务源，允许代码工具修改
  context/**             # checkout 与可信资源上下文，只读
  generated/**           # payload/validation/diff/risk，由 codec 生成，只读
```

首轮具体拆分可以按实现校准，但必须存在 editable source、read-only base/context 和 generated output 三种角色。不得继续把所有文件置于同一可写权限下。

### 2.3 规范化 editable source

当前 `TimelineSnapshotPayload` 同时包含时间轴、按钮表、Buff、配置输入、计算缓存、显示缓存和运行时快照。Spec 7 必须建立规范化源模型：

- 按钮业务事实只保存一次；
- 模型修改 slot/staff/skill/Buff 引用后，由 codec 生成 `occupiedNodes`、`nodeIndex`、`nodeNumber`、position、`skillButtonTable` 和 `timelineData` 镜像；
- 可重建的计算/显示缓存不作为可编辑事实；
- 真正属于用户输入的配置抽取为明确 source；
- 暂时无法建模但必须保真的字段由 codec 安全透传并参与 round-trip 检查。

模型执行“把按钮移到第三格”时应只修改一个规范化位置事实，不需要手工同步多份存储镜像；这仍是代码式自由编辑，不是移动按钮 DSL。

### 2.4 双向 codec

materialize：

1. 从 Work Node repository 读取 base/working payload；
2. 校验 payload 可解码；
3. 计算 node revision、base hash、working hash；
4. 解码为规范化 editable source；
5. 写入只读 base/context/manifest；
6. 以临时目录 + rename 原子生成工作区。

rebuild：

1. 只读取 manifest 声明的 editable source；
2. 解析语法和 schema；
3. 由 codec 重建所有重复镜像和派生结构；
4. 从 repository 安全合并保留字段，不信任工作区生成物或 base 回传；
5. 运行完整 validation、semantic diff 和 risk；
6. compare-and-swap 更新 node working revision；
7. 刷新 generated reports；
8. 不触碰 current checkout。

无修改 round-trip 必须保持业务等价。排序、缺省值和派生缓存重算等允许规范化差异必须有记录；未知字段无法保真时阻止 use。

### 2.5 第一类工具接口

原生编辑能力：

- `read`；
- `edit`；
- `apply_patch`；
- 必要且有界的 `glob/grep`。

工作区级 canonical bindings：

- materialize 当前 fork/bind 节点；
- 读取代码工作区 status；
- rebuild editable source 并校验；
- 处理 revision conflict/rebase；
- 经确认丢弃未同步代码修改并重新 materialize。

正式工具名可在 task 中确定，但必须注册进 `def-node-code`。fork/list/create/delete/diff/approval/use/restore 等节点生命周期仍属于 `def-node-crud`，不得借第一类名义重新混在一起。

### 2.6 写权限矩阵

| 路径 | read | edit/apply_patch |
| --- | --- | --- |
| `working/**` | 允许 | 允许 |
| `base/**` | 允许 | 拒绝 |
| `context/**` | 允许 | 拒绝 |
| `generated/**` | 允许 | 拒绝 |
| `manifest.json` | 允许 | 拒绝 |
| session/plugin/其他 node | 拒绝或内部只读 | 拒绝 |
| 项目源码、用户目录、外网 | 拒绝 | 拒绝 |

该矩阵必须由实际 permission/path guard 实现，不能只依赖 AGENTS.md、README 或 system prompt。

### 2.7 并发与陈旧基线保护

manifest 必须记录 node id、session id、node revision、base hash、working hash 和 schema version。rebuild/sync 使用 compare-and-swap；另一 session 已修改同一节点时，旧 revision 必须被拒绝，并提供重新读取、rebase 或另 fork 选项，禁止 last-write-wins 静默覆盖。

一个活跃代码工作区只绑定一个节点。bind 其他节点不得悄悄覆盖现有 dirty workspace。

## 第三部分：节点校验、diff、风险和 use

### 3.1 分层校验

每次 rebuild 按顺序执行：

1. syntax；
2. schema；
3. invariant；
4. resource reference；
5. calculation/rebuild；
6. policy/read-only boundary；
7. concurrency/revision。

校验至少覆盖按钮/table/timeline/occupiedNodes 镜像、格位冲突、staff 与选择角色、Buff 双向引用、可信资源 id、删除后的悬空引用、输入与派生缓存边界、NaN/Infinity 和 schema migration。

每个 issue 至少返回 code、severity、editable file、JSON pointer、用户可读说明和可选修复建议。

### 3.2 语义 diff

diff 至少包含：

- 干员选择和顺序；
- 按钮新增、删除、移动、换技能；
- Buff 绑定和 Buff 内容变化；
- hit/倍率输入；
- 武器、装备和角色输入；
- 目标、抗性和异常；
- 无法归类的 raw fallback diff。

不能只比较按钮数量、位置和 Buff id。未建模字段变化必须可见，无法解释的字段丢失应阻止 use。

### 3.3 风险分析

每次 rebuild 都重新计算风险，不沿用 fork 或上次 sync 的旧 `riskFlags`。至少识别批量删除/移动、角色替换、大范围变化、未知资源、自定义倍率、当前 HEAD 分叉、未知字段丢失和异常影响范围。

### 3.4 approval 与原子 use

只有 `use` 可以改变 current checkout。编辑、rebuild、validate、diff 和 approval request 均不得触碰 checkout。

use 前重新确认：

- node/revision 未变化；
- validation 仍通过；
- diff/risk 与审批证据一致；
- approval 满足当前策略；
- renderer checkout 可以执行。

repository commit、checkout command 和 renderer 应用状态必须分别记录。command pending 或 renderer 未确认时不得声称已应用。

## 第四部分：原生询问、确认与审批交互

### 4.1 总原则

DEF tool 需要用户补充信息、做选择、确认风险或审批时，优先调用 OpenCode 原生交互方案，不另造一套聊天气泡、宿主 modal 或 REST prompt 协议。

适用能力包括：

- native `question`：询问缺失输入、消歧和有限选项；
- native permission/`context.ask`：确认高风险 tool、use、restore、delete、discard/rebase 等；
- 原生 tool card/result：展示操作对象、风险、diff 摘要和执行结果；
- 原生 stop/retry/continue：处理中断与继续。

### 4.2 原生交互与 DEF 治理的分工

OpenCode 原生 UI负责与用户交互，DEF 后端负责持久治理证据：

```text
DEF tool requests approval
  → create DEF approval record bound to node/session/revision/diff hash
  → OpenCode native permission/question UI
  → user approve/reject/answer
  → record DEF decision
  → tool continues or stops
```

原生批准不等于可以绕过 DEF approval archive；DEF approval record 也不应迫使前端再弹一次重复确认。两者是一条交互链的 UI 层与治理层。

### 4.3 交互要求

- question 只在目标、必要输入或审批确实不明确时调用；
- 能从主界面 context 或数据资源可靠解析的信息不重复问用户；
- permission 卡必须显示具体对象和可理解风险，不只显示 tool id；
- approval 绑定 node id、session id、revision、diff/risk hash；
- 用户拒绝后记录 rejected，节点与工作区保留，checkout 不变；
- retry/continue 不得复用过期批准；diff/revision 变化后重新审批；
- 两个宿主的 question/approval 事件按 host + session 精确路由，禁止串线；
- 被 feature matrix 禁止的 tool 不能通过 question/permission 获得额外权限。

## 第五部分：共享 OpenCode host profile

### 5.1 bootstrap profile

共享 UI 启动时读取不可变 host bootstrap，至少包含：

- host id；
- locked/default agent；
- session id 与 directory；
- context endpoint；
- active node binding；
- feature matrix；
- theme id；
- storage schema version；
- permitted model/profile；
- tool families/exposure 摘要。

profile 不能只存在于 React props 或 prompt。sidecar、session metadata、message transport、tool permission 和前端 command registration 都必须校验它。

### 5.2 feature matrix

至少统一管理：

- `session.create/list/archive`；
- `node.review/files/approval`；
- `model.select`；
- `provider.manage`；
- `server.manage`；
- `project.manage`；
- `terminal.open`；
- `git.manage`；
- `share.session`；
- `settings.appearance/shortcuts`。

组件、菜单、command palette、slash commands、快捷键和路由均从同一矩阵派生。CSS 隐藏但命令或 URL 仍可达，视为未完成。

### 5.3 持久状态

host/profile/session/theme/feature 的 localStorage 必须版本化并按 host + origin 隔离。旧格式、失效 session、错误 server、错误 agent 或 profile 不匹配时安全迁移或重建，不能继续无条件复用。

## 第六部分：删除宿主重复入口

### 6.1 删除宿主“新建会话”

删除 `DefOpenCodeView` 外壳中的“新建会话”。保留 OpenCode 原生新会话入口，但改为 DEF-aware session factory：

- Workbench 创建 `def-workbench` session；
- `/AI CLI` 创建其独立 profile session；
- 原生 `+`、command、快捷键和 session fork 均继承当前 host；
- 文案按宿主显示“新建排轴会话”或“新建 AI CLI 会话”。

### 6.2 删除宿主“工作节点”

删除宿主“工作节点”。主界面已有 Work Node 树继续承担全局节点历史与 checkout 管理；OpenCode 会话内的“节点变更”承担当前绑定节点的审查。不得在 iframe 中复制另一棵完整 Work Node 树。

### 6.3 “返回”

保留宿主级返回能力，但降级为低权重线框导航，避免再造深色粗顶栏。其余标题、tabs、状态和节点变更由共享 OpenCode UI承载。

## 第七部分：裁剪原生综合入口

### 7.1 删除或禁用

Workbench 与 `/AI CLI` 均移除：

- `DEV`/debug bar；
- server 切换、添加与默认 server 配置；
- project/workspace 选择；
- provider/API Key 管理；
- 添加/管理模型；
- Git/branch/worktree 管理；
- 通用 terminal/PTY；
- share/unshare；
- 与上述能力对应的 settings、commands、slash commands、快捷键和路由。

后端权限继续 deny，不因入口删除而放宽。

### 7.2 模型与 agent

Workbench 首轮锁定 agent 和 model，不显示通用选择器。`/AI CLI` 可在后续允许 DEF 白名单 profile/model，但不得恢复 OpenCode 通用 provider 管理；首轮同样默认锁定。

### 7.3 embedded build profile

构建必须显式声明 DEF embedded profile/channel，不能继续依赖 `VITE_OPENCODE_CHANNEL !== prod` 的开发默认值。纯 `prod` 只能去掉部分开发入口，仍需 feature matrix 裁剪通用产品能力。

## 第八部分：把“更改”改造成“节点变更”

### 8.1 复用与替换边界

保留 OpenCode 原生 review panel、文件 diff、折叠、滚动和行级呈现；替换数据适配器和业务文案：

- 标题改为“节点变更”；
- 数据源改为绑定 Work Node 的 generated semantic/code diff；
- 删除 Git、branch、uncommitted changes 和 create Git 语义；
- 显示 validation、risk、approval、revision、dirty 和 applied 状态；
- 未绑定节点时显示中性空状态，不虚构 Git 项目；
- `/AI CLI` 仅在自己的 session 绑定节点后显示该区域。

### 8.2 三层证据

节点变更应同时支持：

1. 用户层摘要，例如“某技能从第 1 格移动到第 3 格”；
2. 领域层 semantic diff；
3. 代码层 editable source diff。

approval 继续使用 OpenCode 原生 permission 卡片；节点变更负责提供审批所需证据，不另造重复审批弹窗。

## 第九部分：会话与业务历史

Workbench 历史必须关联：

- host、agent、session directory；
- node id、parent、revision 与状态；
- 相对当前 HEAD 是否陈旧；
- validation/risk/approval；
- draft、待审批、已应用、被拒绝、节点缺失等状态；
- 恢复策略：继续原节点、只读查看、基于当前 HEAD 新 fork。

恢复 session 不得静默 checkout。切换会话只切换对话和编辑上下文，只有明确 use 才改变主界面。

会话标题应由首个有效意图或节点摘要生成，不使用裸 ISO 时间戳作为主要显示名。

`/AI CLI` 历史保持独立；除非它自己的 session 创建节点，否则不显示 Workbench 节点关系。

## 第十部分：DEF 黑白蓝线稿主题

### 10.1 主题原则

- 白色与极浅蓝灰纸面；
- 黑/深蓝灰 1px 主线；
- 使用项目现有蓝色 theme token；
- 直角或极小圆角；
- 减少阴影与大色块；
- 选中态使用蓝色描边、底线或浅蓝纸面；
- 状态通过图标、线型、浅色网纹和文字组合表达；
- 保留原生 timeline/tool/diff/permission 结构，不重画聊天内核。

### 10.2 适配方式

在共享 OpenCode UI 内建立 DEF theme adapter，不从 iframe 外层尝试 CSS 穿透，也不复制两份 OpenCode CSS。宿主层尽量只保留返回导航，消除深黑 header + 原生 tabs 的双层壳。

Workbench 与 `/AI CLI` 使用同一主题实现，可通过少量 host token 表达职责差异，但不得形成两套视觉代码。

### 10.3 文案与信息层级

- 去除 `DEV` 和无意义技术入口；
- 中文业务文案优先；
- 模型技术名降级显示或隐藏；
- placeholder 按宿主本地化；
- session title 使用业务摘要；
- tool name 转为 DEF 用户可理解名称，技术 id 只在展开详情中显示。

## 第十一部分：失败与恢复

- syntax/schema 失败：保留工作文件并定位行列，不更新 repository；
- validation/resource 失败：生成报告，不允许 use；
- revision 冲突：拒绝覆盖，提供重新读取/rebase/另 fork；
- permission/approval 拒绝：记录 rejected，保留节点，checkout 不变；
- use 失败：明确区分 repository commit、command enqueue 和 renderer applied；
- session/node 失效：只读展示历史或重新 fork，不无限复用旧 id；
- sidecar/runtime 重启：恢复同 host/profile，校验 agent、node revision 和 directory；
- storage schema 变化：执行显式迁移，失败时安全重建而非进入错误循环。

## 非目标

- 不重新制作两套聊天前端；
- 不新增第四类工具；
- 不把每个排轴动作做成专用 typed tool；
- 不恢复不受限 shell、项目源码访问、外部目录或外网；
- 不把 Work Node 改成 Git worktree；
- 不让 Workbench 与 `/AI CLI` 共享 active session 或上下文；
- 不允许用户通过 OpenCode UI修改 server/provider/API Key；
- 不因视觉本地化删除原生 timeline、tool、reasoning、diff、permission、stop/retry/continue 和错误恢复；
- 不用 CSS 隐藏替代 feature/permission 裁剪。

## 验收标准

### A. 三类工具与代码修改

- 工具正式分类仍且仅有 `def-node-code`、`def-node-crud`、`def-data-resource`。
- Workbench 能通过原生 read/edit/apply_patch 自由完成跨字段、跨按钮、跨组和跨 Buff 的节点修改。
- 一次格位修改只编辑规范化事实，codec 自动生成所有镜像字段。
- base/context/generated/manifest 的写入被实际权限拒绝。
- 项目源码、其他 session/node 和用户外部目录继续不可访问。
- rebuild 具备 revision/hash compare-and-swap，不允许旧 session 静默覆盖。
- 完整 validation、semantic diff 和 risk 在每次 rebuild 后重新生成。
- 未建模字段不会静默丢失。

### B. Workbench 与 `/AI CLI`

- Workbench 创建、恢复、发送、retry、continue 始终使用 `def-workbench`。
- Workbench 对“你可以排轴吗”明确回答可以，并能进入真实代码式节点修改。
- 当前选中干员、按钮、checkout 和 Work Node 上下文可被 Workbench 按需读取。
- `/AI CLI` 保持独立数据资源/填表职责，不继承 Workbench 当前轴。
- 两个宿主同时运行时 agent、session、history、directory、context、node 和 approval 不串线。

### C. 原生交互

- 需要补充输入时使用 OpenCode native question。
- use/restore/delete/discard/rebase 等需要确认时使用 OpenCode native permission/ask。
- DEF approval record 与原生交互绑定同一 node/session/revision/diff hash。
- 拒绝、过期审批和 diff 变化均不能触碰 checkout或复用旧批准。
- 不存在第二套重复聊天确认 UI。

### D. 前端裁剪

- 宿主“新建会话”和“工作节点”按钮删除。
- 原生新会话成为唯一入口并走 DEF host factory。
- `DEV`、添加模型、provider、server、project、Git、terminal、share 等入口在 UI、commands、快捷键和路由均不可达。
- 通用 agent/model 选择不能使 Workbench 脱离 locked profile。
- 原生“更改”替换为 Work Node“节点变更”，不出现 create Git/branch 文案。

### E. 历史与节点变更

- session history 显示关联节点和 draft/validated/pending/applied/rejected/missing 状态。
- 恢复旧会话会校验 node revision，并提供明确恢复策略。
- 切换/恢复会话不会自动 checkout。
- 节点变更同时提供用户摘要、semantic diff 和代码 diff。
- validation/risk/approval/use 状态与后端事实一致。

### F. 视觉

- Workbench 与 `/AI CLI` 复用同一 DEF OpenCode theme adapter。
- 页面符合黑白蓝线稿、浅纸面、1px 边线和低圆角风格。
- 深色双顶栏、饱和 `DEV` 色块、通用圆角聊天壳和裸 ISO 标题消失。
- 原生 timeline、tool、reasoning、diff、permission、stop/retry/continue 行为保持可用。

### G. 整体验收

- 真实浏览器分别手测 Workbench 与 `/AI CLI`。
- 完成“查询资源 → fork → 代码修改 → rebuild → validate → diff → 原生审批 → use”的组合闭环。
- 完成“先不要应用”和审批拒绝路径，current checkout 均保持不变。
- 完成 revision conflict、失效 session、runtime 重启和历史恢复测试。
- 验证隐藏功能无法由按钮、命令、快捷键或 URL 旁路进入。
- 运行生产构建与必要的 DEF agent 黑盒测试。

## 研究依据

- [`research.md`](./research.md)：共享前端职责、入口裁剪、历史与视觉预研究；
- [`research-def-node-code.md`](./research-def-node-code.md)：第一类节点代码修改的工作区、codec、权限、校验和审查专项研究；
- Spec 6 的 registry、native tool、Work Node、shared UI 与真实手测结果。

