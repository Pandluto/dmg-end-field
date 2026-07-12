# Spec 6：DEF OpenCode 原生工具与原生前端回归

## 状态

已定稿，进入 Task 6-1。

## 背景判断

当前 DEF 已经积累了大量可用的自研 tools、Work Node、审批、验证、数据资源和主界面执行能力。这些能力不能因架构重构被简单删除。

真正需要纠正的是承载方式：现状把工具注册、REST 路由、Kernel registry、prompt 文案和前端交互拆成多套平行系统，OpenCode 只作为会话模型运行时，原生 tool loop、代码编辑工具和原生前端没有成为 DEF 的主体。

本阶段不以现有 `/api/def-tools` 的形状反推新架构，也不把现有每个 REST tool 原样包装成一个 OpenCode tool。先完整盘点和保留已有能力，再统一注册、建立旧新对照路由，最终收敛为三大工具族。

## 核心目标

1. 保留和整理现有自研 tools，建立唯一权威注册源及旧新对照关系。
2. 将 DEF 工具收敛为三大工具族：节点代码修改、节点简单增删改查、数据资源。
3. 恢复 OpenCode 原生代码工具，使 Agent 能在隔离的子节点工作区内自由读写和修改节点内容。
4. 支持“复制父节点 → 代码式修改子节点 → 校验与审批 → 直接使用子节点”的完整流程。
5. 用一套可复用的 OpenCode 原生前端子界面替换 AI 模式和 `/AI CLI` 中现有的自研 def-opencode 对话前端。
6. 两个宿主复用同一套前端代码和交互，但职责、会话、工作目录和历史记录相互独立。
7. 将 OpenCode 原生前端/TUI 的还原程度作为正式验收指标，而不是只模仿视觉样式。

## 总体架构

```text
Main Workbench AI mode ─┐
                       ├─ DefOpenCodeView（同一套可复用子界面）
/AI CLI ───────────────┘
                              │
                              ├─ 独立 Session Controller：Workbench
                              └─ 独立 Session Controller：AI CLI

OpenCode agent loop
  ↓
统一 DEF Tool Registry
  ├─ def-node-code
  ├─ def-node-crud
  └─ def-data-resource
  ↓
Work Node / domain service / data resource service
  ↓
validate → diff → approval → use child node
```

统一前端不等于共享会话。Workbench AI mode 和 `/AI CLI` 只共享组件、样式、事件模型和 OpenCode 原生交互实现，不共享 session id、消息历史、工作目录、默认 agent 或当前任务状态。

## 三大工具族

### 一、`def-node-code`：节点代码修改

该工具族负责让 OpenCode 以代码编辑方式自由修改隔离的子节点内容，而不是把每一种排轴操作固化成专用业务工具。

核心能力来自 OpenCode 原生代码工具：

- `read`
- `edit`
- `apply_patch`
- 必要时受限的 `glob` / `grep`

这些原生能力需要以 DEF 工具身份注册或由 DEF 注册层显式暴露，统一归入 `def-node-code`。它们只能访问当前 session 绑定的子节点工作区，不得访问项目源码、任意用户文件、当前 checkout 的直接存储或其他节点目录。

标准工作流：

```text
选择当前节点或指定父节点
  → fork/copy 出子节点
  → 为子节点建立代码式工作目录
  → OpenCode read/edit/apply_patch 修改节点文件
  → validate
  → diff
  → approval
  → 直接 use 子节点，或继续从该节点派生
```

节点内容应以适合代码工具操作的稳定文件结构呈现。具体拆分可在实现时确定，但必须满足：可读、可 diff、可 schema 校验、可从文件重建节点 payload、不会把临时编辑直接写入当前 checkout。

现有 `patch_and_validate`、`copy_staff_line_and_verify`、批量 Buff patch 等能力应作为迁移输入和兼容能力，不得继续限制新代码工具只能表达这些既有 DSL 操作。

### 二、`def-node-crud`：节点简单增删改查与生命周期

该工具族处理结构明确、无需自由代码编辑的节点操作：

- fork/copy 子节点
- list/read/create/update/delete
- validate/diff
- request approval / record approval
- use/checkout 子节点
- restore
- HEAD、父子关系及状态读取

简单操作可以保留结构化 schema。已有按钮增删、单项字段修改、验证和治理工具需要逐项对照：能够被通用 CRUD 或代码修改覆盖的，转为兼容 alias；确有独立副作用或独立审批语义的，保留专用 handler，但仍归入本工具族并从统一注册表注册。

`use` 的语义是把已允许使用的子节点作为当前有效节点。只有这一步可以触碰当前业务 checkout；节点编辑本身始终发生在子节点中。

### 三、`def-data-resource`：数据资源与填表

该工具族承载干员、武器、装备、技能、Buff 等数据资源能力，包括：

- search/list/read
- resolve/消歧
- 结构化数据摘要
- 填表和补全
- 与节点内容相关的资源引用校验

现有干员、武器、装备、配装、技能、Buff resolver 和填表能力必须保留并整理，不得因为节点代码化而退化为模型凭空生成数据。

数据资源工具负责提供可信业务数据；节点代码工具负责修改节点文件。两者可以在同一 agent loop 中组合，但不能把数据资源规则重新硬编码进 prompt。

## 统一注册与对照路由

必须建立唯一 DEF Tool Registry。每个注册项至少包含：

- canonical id
- tool family
- description
- input/output schema
- handler 或原生工具绑定
- risk / approval
- workspace scope
- verification policy
- legacy aliases
- exposure：Workbench / AI CLI / both
- migration status

以下内容必须从该注册表派生：

- OpenCode 原生 tool definitions
- 内部 REST/IPC transport 路由
- 旧工具名到 canonical tool 的对照表
- 开发诊断用工具清单

不再允许 Kernel registry、REST definitions、adapter prompt 和 UI prompt 各自维护工具事实。

旧工具迁移必须遵循“先盘点、再对照、后删除”：

1. 每个旧工具必须进入盘点表。
2. 每个旧工具必须标记为 canonical、alias、absorbed、specialized 或 deprecated-candidate。
3. 旧路由在迁移期通过对照路由转发到统一 handler，不复制业务实现。
4. 没有对照证据、调用证据和替代能力前，不得删除旧工具。
5. 最终删除的是重复注册和重复编排，不是已验证的业务能力。

## Work Node 代码工作区

每个执行节点代码修改的 OpenCode session 必须绑定唯一子节点工作区。

工作区至少满足：

- 由指定父节点复制生成，不直接把父节点当作可写目录。
- 只暴露该子节点允许修改的节点文件。
- OpenCode 原生代码工具的 filesystem scope 被限制在该目录。
- 修改过程中不污染当前 checkout、父节点或其他分支。
- validate/diff 使用工作区文件作为待审内容。
- approval 记录必须绑定 node id、session id 和 diff 证据。
- 审批通过后可直接 `use` 该子节点，无需把修改重新翻译成另一套按钮级命令。

## 一套前端、两个独立宿主

### 共享子界面

新增一套可复用的 OpenCode 原生前端子界面，例如 `DefOpenCodeView`。AI 模式和 `/AI CLI` 都挂载这个子界面，禁止分别维护两份聊天 UI、tool card、stream 合并和 session 恢复逻辑。

共享范围包括：

- 会话时间线
- 流式输出和运行状态
- reasoning/思考过程展示
- tool call 与 tool result 卡片
- read/edit/apply_patch 展示
- 文件和 diff 视图
- permission、question、approval 交互
- stop/retry/continue
- session 列表与恢复
- 错误状态
- OpenCode 原生快捷键和 TUI 交互习惯

### Workbench AI mode 职责

- 面向当前主界面和当前 Work Node。
- 默认绑定当前节点或由本轮 fork 的子节点工作区。
- 重点执行节点代码修改、节点 CRUD、审批和 use。
- 与主界面时间轴、Work Node 树和当前 checkout 状态联动。
- 使用独立 Workbench session、agent profile 和历史记录。

### `/AI CLI` 职责

- 面向更广泛的 DEF 数据资源、填表、资料处理和独立 Agent 工作。
- 可以使用数据资源工具和它自己的节点/文件工作区，但不继承 Workbench 当前会话。
- 使用独立 AI CLI session、agent profile、工作目录和历史记录。

两者可以连接同一个 OpenCode runtime/server，也可以共享同一套工具注册代码，但不得以复用组件为理由共享 active session 或互相拼接 transcript。

## OpenCode 原生前端与 TUI 还原要求

本阶段不再以现有 `MainWorkbenchAiPanel`、`AiCliPage` 的自研对话实现为模板。应优先从 vendored OpenCode 的 `packages/app`、`packages/session-ui`、`packages/ui`、`packages/tui` 中复制、移植或包装原生实现，再做 DEF 宿主适配。

允许复制上游代码后修改，但必须：

- 记录来源文件和对应 upstream commit/version。
- 保留足够清晰的适配边界，方便后续与上游比较更新。
- 共享移植后的组件，不在两个宿主中各复制一份。
- 优先保持原生信息层级、交互状态、快捷键、工具呈现和 TUI 节奏。
- 不用一组外观相似的 React 卡片替代原生行为。

第一阶段必须尽可能还原：会话时间线、流式状态、工具调用、文件修改、diff、审批/提问、停止/重试、会话恢复和错误呈现。模型/provider 管理、通用项目首页、Git 管理和不受限终端是否引入，由 DEF 产品职责另行决定，不作为首轮强制范围。

TUI 还原度是功能验收项：不仅比较颜色和布局，还要比较消息生命周期、工具展开/折叠、键盘操作、等待/取消、错误恢复和 session 切换行为。

## 迁移原则

- 先统一注册和建立对照关系，再迁移执行入口。
- 先恢复原生节点代码工具，再用它替代僵硬的按钮级长链路。
- 自研工具能力先保留，不因命名或层次混乱直接删除。
- 新旧路径可以短期并存，但同一个 canonical handler 只能有一份业务实现。
- 前端迁移以共享子界面替换为目标，不继续修补两套旧对话 UI。
- 工具迁移和前端迁移必须分别可验收，不能靠 prompt 掩盖尚未接通的能力。

## 非目标

- 本阶段不恢复 OpenCode 对项目源码的不受限 shell/read/edit 权限。
- 不把 Work Node 实现成 Git worktree。
- 不要求将所有旧工具一对一暴露给模型。
- 不让 AI 模式和 `/AI CLI` 共享会话历史。
- 不在统一注册完成前批量删除旧工具。
- 不继续扩展以 `webfetch + prompt + REST JSON` 为主体的模型工具协议。

## 验收标准

- 所有现有自研 tools 均有盘点记录和明确迁移归属。
- 统一注册表只包含三大工具族，旧名称通过 alias/route map 对照。
- OpenCode 能在隔离子节点目录使用注册后的 DEF 节点代码工具自由修改节点文件。
- 父节点复制、子节点修改、校验、diff、审批、直接使用形成可观察闭环。
- AI 模式和 `/AI CLI` 使用同一套 OpenCode 前端子界面代码。
- 两个界面的 session、history、directory、agent profile 和职责保持独立。
- 现有自研聊天前端被替换后，不再各自维护 tool activity、stream 合并和 transcript 恢复实现。
- 原生前端/TUI 的关键交互有来源对照和验收记录。
