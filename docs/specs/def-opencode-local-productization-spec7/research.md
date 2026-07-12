# Spec 7 预研究：DEF OpenCode 本地特色化前后端联合开发

## 研究状态

预研究完成，尚未编写 `spec.md` 与任务拆分。

本轮以主界面 AI mode 的真实截图、真实对话、Spec 6 实现和 vendored OpenCode v1.17.11 源码为依据。研究目标不是重新制作聊天前端，而是判断同一套 OpenCode 原生前端在 Workbench AI mode 与 `/AI CLI` 两种宿主中应当保留、改造、替换或隐藏哪些能力，并区分 Spec 6 遗留缺陷与 Spec 7 本地产品化内容。

## 一、结论摘要

当前实现已经接通原生 OpenCode 会话、工具循环和前端，但仍是“DEF 外壳包着通用 OpenCode”，尚未形成 DEF 产品界面。主要存在四类问题：

1. Workbench 与 `/AI CLI` 的职责隔离没有完全落地，Workbench 实际出现 `Def-operator` 身份并否认排轴能力。
2. 宿主旧按钮与原生入口重复，用户面对两套“新建会话”和两套节点/变更概念。
3. OpenCode 的通用项目、服务器、模型、Git、开发调试入口超出 DEF 宿主职责。
4. 深色圆角宿主外壳、OpenCode 浅灰圆角界面与项目黑白蓝线稿风格割裂。

这些问题不能靠 iframe 外层 CSS 修补。需要在共享 OpenCode 前端内建立显式的 DEF host profile，由后端 session profile、前端 feature matrix、业务上下文桥和主题 token 共同驱动。

## 二、Spec 6 新暴露的遗留缺陷

以下内容不是 Spec 7 的新增范围，而是 Spec 6 已规定但真实使用后发现尚未兑现的内容。应在进入视觉本地化前先修复，避免用新设计掩盖职责串线。

### 2.1 Workbench agent 身份串线

截图中回复署名为 `Def-operator`，而不是 `def-workbench`。用户询问“你可以排轴吗”时，助手回答自己只能查干员、Buff、武器、装备和伤害报告，表现为 `/AI CLI` 数据资源助手进入了 Workbench。

代码现状：

- session 创建 payload 会填写 `def-workbench`；
- OpenCode 全局 `default_agent` 仍是 `def-operator`；
- 原生前端拥有自己的 agent 选择与持久状态，session 创建时填写 agent 不等于每次发送都锁定该 agent；
- Workbench 当前绑定历史 `rest-search` skill，名称和职责均偏查询；
- Workbench prompt 描述了 fork、文件编辑、validate、diff、use，却没有把“排轴”明确解释为这些能力的核心业务场景。

修复要求：Workbench host 必须从 session 创建、恢复、发送消息到 continue/retry 全链路锁定 `def-workbench`，不能被全局默认值、上次选择、模型选择器或本地持久状态覆盖。`/AI CLI` 继续使用自己的独立 agent/profile。

### 2.2 主界面上下文被接收后丢弃

`MainWorkbenchAiPanel` 接收 `selectedCharacters` 与 `skillButtons`，但渲染 `DefOpenCodeView` 时未使用；`onWorkNodeChanged` 同样没有参与联动。当前原生会话不知道用户正在看的干员、按钮、Buff、时间位置、HEAD 或 checkout。

需要建立带版本和更新时间的 Workbench context contract，至少包含：

- 当前 HEAD、checkout node 与活跃 Work Node；
- 已选干员及其稳定 id；
- 当前技能按钮、组别、格位和时间；
- 当前 Buff、目标抗性与伤害摘要；
- 是否存在未应用子节点或待审批变更；
- 主界面快照版本与更新时间。

上下文可以通过只读 native tool、session attachment 或宿主上下文端点按需读取，不应把完整 payload 长期硬塞进 system prompt。

### 2.3 “排轴”业务语义没有迁移

Workbench 不需要一把名为“排轴”的专用 tool；排轴应当是 `def-node-code + def-node-crud + def-data-resource` 的组合能力。Prompt 与 Workbench skill 必须明确把自然语言映射为节点流程：

```text
排轴 / 调轴 / 改顺序 / 改格位 / 加技能 / 加 Buff
  → 读取当前主界面上下文
  → fork 或继续当前子节点
  → 编辑 working payload
  → validate + diff
  → 按用户要求预览或审批 use
```

只读问题不创建节点；“先看看”“先不要应用”停在 diff；“应用”“就这样”才进入 approval/use。模型不得再回答“没有排轴工具，只能辅助你手动排轴”。

### 2.4 历史恢复只恢复了 OpenCode session，没有恢复 DEF 工作历史

当前具备 OpenCode session 列表和恢复能力，但产品需要的是会话、Work Node、checkout 三者的关联历史。恢复旧会话时需要知道：

- 会话属于 Workbench 还是 `/AI CLI`；
- Workbench 会话绑定哪个 Work Node；
- 节点是否仍存在、是否已应用、是否已删除或已落后于当前 HEAD；
- 当前页面状态与历史上下文是否已变化；
- 继续修改是在原节点上继续，还是从当前 HEAD 重新 fork。

这也是用户所说“历史功能反而缺失”的实质：聊天记录存在，但业务工作现场没有被可靠恢复。

## 三、宿主旧按钮审查

### 3.1 “新建会话”：删除宿主按钮

宿主顶栏“新建会话”与 OpenCode 原生标签栏 `+`/新会话命令重复。两套入口会导致用户不确定是否创建同一种 session，也可能绕过 host profile。

决策：删除宿主“新建会话”。保留原生会话入口，但必须改为 DEF-aware session factory：

- Workbench 创建的永远是 `def-workbench` session；
- `/AI CLI` 创建的永远是 AI CLI profile session；
- 创建、恢复、重试、fork session 均继承当前 host，不允许生成无 profile 的通用 OpenCode session；
- 原生 `+` 的 tooltip/文案应改成符合宿主职责的“新建排轴会话”或“新建 AI CLI 会话”。

### 3.2 “工作节点”：删除宿主按钮

宿主“工作节点”是 Spec 6 迁移期遗留跳转。它和原生“更改”、会话菜单及主界面原有 Work Node 树形成三套入口。

决策：删除宿主“工作节点”。Work Node 能力分两处承载：

- 主界面已有 Work Node 树继续作为全局节点历史和 checkout 管理入口；
- OpenCode 会话内的“更改”区域改造成“节点变更”，只呈现当前会话绑定节点的 diff、validation、approval 与 use 状态。

不在聊天头部再放一个跳转按钮，也不把完整 Work Node 树复制进 iframe。

### 3.3 “返回”：保留但降级为宿主级导航

“返回”属于主界面宿主职责，可以保留；但不应和 OpenCode 原生工具按钮使用同样高权重。建议改为线框图标/文字，放在统一的主界面导航层，而不是再造一条深色粗顶栏。

## 四、OpenCode 原生综合入口审查

原则不是“看到多余就 CSS display:none”，而是同时处理可见入口、快捷键、命令面板、路由和后端权限。否则用户仍可通过 `/` 命令、快捷键或持久状态进入被隐藏功能。

| 原生功能 | Workbench AI mode | `/AI CLI` | 研究结论 |
| --- | --- | --- | --- |
| 会话时间线、流式状态 | 保留 | 保留 | 原生核心能力 |
| reasoning、tool call/result | 保留 | 保留 | 使用 DEF 名称与风险文案 |
| stop/retry/continue | 保留 | 保留 | retry/continue 必须继承 host agent |
| session 列表、切换、归档 | 保留 | 保留 | 按 host 隔离，补 Work Node 关联状态 |
| 原生 `+` 新会话 | 保留并改造 | 保留并改造 | 取代宿主旧按钮，必须走 host factory |
| “更改” | 改造成“节点变更” | 按 profile 决定 | 当前读取 Git/turn diff，不是 DEF Work Node diff，不能原样保留 |
| 文件查看/diff | 保留 | 有界保留 | Workbench 仅限子节点工作目录；作为“节点变更”的底层呈现 |
| 模型选择器 | 隐藏并锁定 | 默认隐藏，可由宿主配置开放 | 当前 provider/model 由 DEF 配置管理，用户在会话内切换会破坏 agent/profile 一致性 |
| “添加模型/管理模型” | 删除 | 删除 | 会写 OpenCode provider/auth/config，与 DEF 配置权冲突 |
| agent 选择器 | 隐藏并锁定 | 可显示 DEF 允许的 profile，不显示通用 agent | Workbench 串线的直接风险点 |
| server 切换/添加服务器 | 删除 | 删除 | sidecar origin 是强制架构边界，不能让用户改回 17445 或外部 server |
| project/workspace 选择 | 删除 | 删除或宿主化 | session 目录由 DEF 创建，不允许打开任意项目 |
| 通用终端/PTY | 删除 | 删除 | 超出权限边界，后端也继续 deny |
| Git、branch、worktree | 删除 | 删除 | DEF Work Node 不是 Git worktree |
| 分享会话 | 删除 | 删除 | runtime 已禁用 share，前端入口也应消失 |
| provider/API Key 设置 | 删除 | 删除 | 继续由 DEF 宿主配置管理 |
| command palette | 裁剪后保留 | 裁剪后保留 | 只注册当前 host 可执行命令 |
| `/` commands | 裁剪后保留 | 裁剪后保留 | 不能暴露已隐藏功能的旁路 |
| `@` 文件上下文 | 限定节点文件 | 限定 session/声明资源 | 不允许访问项目源码或其他 session |
| 通知、错误恢复 | 保留 | 保留 | server 固定为各自 17322 origin |
| 设置页 | 只保留外观、语言、快捷键等安全子集 | 同左或稍宽 | server/model/provider/project 设置必须移除 |

### 4.1 “更改”不能简单删除

原生“更改”目前支持 Git、branch、turn diff，并在没有 Git 时提示创建 Git。DEF 子节点不是 Git worktree，原样保留会制造错误心智；但 diff 展示、文件查看、行级变更和 review panel 本身很有价值。

建议保留原生 review UI，替换其数据适配器：

- 标题由“更改”改为“节点变更”；
- 数据源由 Git/VCS diff 改为当前绑定节点的 base/working payload diff；
- 状态显示 validation、风险、审批、是否已应用；
- 禁止“创建 Git”、branch 和 uncommitted changes 文案；
- 未绑定节点时显示“本会话尚未创建工作节点”，并允许从对话自然触发 fork，不额外增加大按钮；
- `/AI CLI` 若当前任务没有节点工作区，可隐藏该 tab；一旦绑定节点再出现。

### 4.2 “添加模型”必须删除而不是改名

OpenCode 的“添加模型”会进入 provider、认证和 config 管理。DEF 当前由宿主统一提供 DeepSeek 配置，并且 Workbench 需要锁定 agent/model 才能保证职责、工具与权限一致。因此该入口没有可复用的业务价值，应从可见 UI、模型弹窗、命令面板、设置页和快捷键路径同时移除。

如果未来允许选择模型，应由 DEF 宿主提供受控白名单，并作为 host profile 的一部分，而不是恢复 OpenCode 通用 provider 管理。

### 4.3 `DEV` 与综合导航来自错误构建 profile

vendored app 中 `newLayoutDesignsDefault = VITE_OPENCODE_CHANNEL !== "prod"`；构建脚本未设置 channel。截图中的 `DEV`/开发式综合入口说明当前产物使用了不适合交付的前端 profile。

不能只把 `DEV` 文本隐藏。构建应显式声明 DEF embedded channel/profile，并由 profile 决定布局与功能矩阵。使用纯 `prod` 可以先关闭部分开发入口，但不足以完成 DEF 裁剪，因为 prod 仍包含模型、server、project、Git 等通用产品能力。

## 五、视觉与 CSS 研究

### 5.1 当前断层

- 宿主头部硬编码 `#111318/#171a20/#20242c` 深色块，与主项目浅色纸面冲突；
- iframe 内部是 OpenCode 浅灰、圆角、通用 SaaS/聊天风格；
- 项目主题契约的 control/panel radius 为 0，强调黑白线条与蓝色；当前按钮、标签、输入框和气泡大量使用圆角；
- 外层头部和原生标签栏形成双导航；
- 饱和 `DEV` 蓝块成为最高视觉焦点；
- ISO 时间戳直接作为会话标题，信息密度和可读性较差；
- 英文 placeholder、模型技术名和中文业务文案没有层级；
- 大面积空白与大输入框更像通用聊天页，没有体现排轴工作台的节点、状态和变更关系。

### 5.2 建议的黑白蓝线稿主题

不建议从宿主 CSS 穿透 iframe，也不建议复制一份 OpenCode CSS。应在共享 OpenCode UI 内增加 DEF theme token adapter：

- 背景：白与极浅蓝灰；
- 主线：黑/深蓝灰 1px；
- 主强调：项目现有蓝色 token；
- 状态强调：用图标、线型、浅色网纹区分，而不是大色块；
- 控件：直角或极小圆角；
- 面板：减少阴影，使用线框和分隔线；
- 选中：蓝色描边、底部线或浅蓝纸面；
- tool/approval/diff：沿用原生结构，仅替换 token 与 DEF 文案，不重画聊天内核。

宿主层应尽量只保留一个轻量返回导航；标题、session tabs、状态、节点变更均由共享原生界面承担，从而消除双层壳。

## 六、前后端联合架构建议

### 6.1 单一共享前端，两个显式 host profile

```text
DEF host bootstrap
  ├─ workbench profile
  │    ├─ locked agent: def-workbench
  │    ├─ context: current checkout + Work Node + timeline summary
  │    ├─ features: session / node changes / tools / approval
  │    └─ commands: bounded workbench command set
  └─ ai-cli profile
       ├─ independent DEF agent/profile
       ├─ context: declared data/session workspace
       ├─ features: session / data tools / optional node changes
       └─ commands: bounded AI CLI command set

Shared OpenCode UI
  → reads immutable host capabilities from bootstrap endpoint
  → renders only authorized navigation and commands
  → sends every message with host/session/agent binding
```

profile 不能只存在于 React props 或 system prompt。至少应由以下层共同校验：

1. sidecar/native session 创建返回 profile；
2. session metadata 持久化 profile 与绑定节点；
3. OpenCode 前端以 profile 生成路由、菜单、快捷键和 command palette；
4. message/retry/continue 后端校验 session 对应 agent；
5. native tools 与 filesystem permission 继续做最终权限边界。

### 6.2 前端 feature matrix

建议不要散落 `if (host === ...)`，而是建立可审计能力表，例如：

```text
session.create
session.list
session.archive
node.review
node.files
node.approval
model.select
provider.manage
server.manage
project.manage
terminal.open
git.manage
share.session
settings.appearance
settings.shortcuts
```

组件、命令、快捷键、路由和菜单都从同一 feature matrix 派生。隐藏功能若仍可通过命令或 URL 到达，视为未完成。

### 6.3 历史模型

Workbench session history 建议显示业务状态，而不只是标题和更新时间：

- 会话标题：由首个有效意图或节点摘要生成，不使用裸 ISO 时间；
- 关联节点：节点名、状态、相对 HEAD；
- 状态：草稿、验证失败、待审批、已应用、已拒绝、节点缺失；
- 恢复策略：继续原节点、基于当前 HEAD 新建分支、只读查看历史；
- 会话切换不得自动 checkout；只有明确 use 才改变主界面。

`/AI CLI` 历史不显示或继承 Workbench 节点关系，除非该 AI CLI session 自己创建了节点。

## 七、本轮扫描出的其他特性与风险

### 7.1 已确认可保留的原生价值

- 原生 timeline、流式生命周期和错误呈现；
- tool call/result、reasoning、diff、permission；
- stop/retry/continue；
- session tabs、归档和恢复；
- 键盘操作、命令面板与上下文输入框；
- 同一套 UI 在两个宿主复用。

本地化应裁剪通用产品外壳，不应破坏这些已经恢复的原生能力。

### 7.2 iframe 边界已成为产品化阻力

当前 React 宿主只能显示 toolbar 和 iframe，无法自然注入主题、实时上下文、功能矩阵和受控导航。继续依赖 query/localStorage 注入会重复出现 stale session、server origin 和 profile 漂移类问题。

不要求立即取消 iframe，但需要正式 bootstrap contract；长期可选择：

- 继续 iframe，同源 bootstrap + postMessage/context endpoint + 原生 UI 内 profile；或
- 将构建后的共享 OpenCode 子应用作为同一前端路由挂载。

无论选择哪种，都不能回到两套聊天 UI。

### 7.3 持久状态需要版本化和宿主隔离

Spec 6 已暴露两类持久状态故障：失效 session 被复用、默认 server 残留 17445。Spec 7 新增 profile/theme/feature 后，应统一定义 storage schema version 与迁移策略，按 host + origin 隔离，发现旧格式时可安全重建。

### 7.4 “视觉隐藏”不等于“能力删除”

OpenCode 的模型、server、project、Git、share 等功能同时存在于按钮、设置、命令、快捷键和路由。仅加 CSS 会留下旁路，也会让升级时入口重新出现。必须从 feature registration 层裁剪，并由后端权限兜底。

### 7.5 上游升级边界

本地化代码应集中在 DEF bootstrap、host profile、feature adapter、theme adapter 和 node-review adapter，避免在多个上游组件中散改条件。每项上游修改需记录源文件、原因和对应 profile 功能，以便从 v1.17.11 升级时重新对照。

## 八、建议实施顺序

1. 先补 Spec 6 回归：锁定 `def-workbench`、恢复排轴语义、接入主界面上下文、建立 session/Work Node 关联。
2. 建立共享 host profile 与 feature matrix，前后端共同校验。
3. 删除宿主“新建会话/工作节点”，将新会话收口到 DEF-aware 原生入口。
4. 将原生“更改”改造成 Work Node review；移除 Git/branch/create-Git 语义。
5. 删除 model/provider/server/project/terminal/share 等综合入口及所有旁路。
6. 显式设置 embedded build profile，去除 `DEV` 和开发布局默认值。
7. 建立 DEF 黑白蓝 theme adapter，消除双顶栏和圆角深色外壳。
8. 补齐 Workbench 与 `/AI CLI` 的独立历史、恢复和状态提示。
9. 真实手测两个宿主的问答、排轴、预览、审批、应用、恢复、快捷键和不可达入口。

## 九、预研究验收场景建议

后续 Spec 7 至少应覆盖以下真实场景，但具体范围与验收标准仍等待用户确认：

- Workbench 问“你可以排轴吗”，应明确可以并解释预览/应用边界，不再退化为数据查询助手；
- Workbench 发出真实排轴请求，使用当前主界面上下文并生成可审节点变更；
- `/AI CLI` 同样的问题保持其独立数据/资料职责，不继承 Workbench 当前轴；
- 页面只保留一个新建会话入口，创建后 agent/profile 正确；
- 宿主旧“工作节点”消失，节点历史仍可从主界面访问；
- “节点变更”展示 Work Node diff，不出现 Git/branch/create-Git；
- 找不到“添加模型”、server、project、terminal、share 等入口，命令、快捷键和直达路由也不可用；
- Workbench 与 `/AI CLI` 同时打开时，主题一致但会话、agent、历史、上下文和节点状态独立；
- 切换或恢复历史会话不会静默 checkout，也不会复用失效 session/profile；
- 整体视觉符合项目黑白蓝线稿体系，同时保留 OpenCode 原生 timeline、tool、diff、approval 和错误恢复行为。

## 十、需要用户在 Spec 7 定稿前确认的产品选择

1. Workbench 是否允许用户选择一组受控模型，还是完全锁定当前模型；本研究建议首轮完全锁定。
2. `/AI CLI` 是否显示 agent/profile 选择器；本研究建议只显示 DEF 白名单，不显示通用 agent。
3. “节点变更”是否首轮就承担 approval/use 操作，还是仅展示证据、审批仍在原生 permission 卡片完成；本研究建议首轮以展示为主，审批沿用 permission 卡片。
4. Workbench 历史入口采用原生 session tabs + 会话列表，还是在主界面增加统一历史抽屉；本研究建议先复用原生 session UI并增加节点状态，不再造新抽屉。

