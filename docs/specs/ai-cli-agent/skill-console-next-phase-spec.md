# AI CLI 下一阶段：左右栏 Skill Console Spec

## 状态

本文件记录 `/ai-cli` 下一阶段产品与技术形态的共识，作为后续任务拆分和实现的上游规格。

本阶段不把 `/ai-cli` 改造成独立 Electron 应用，也不废弃现有 AI CLI 命令行。目标是把现有 `/ai-cli` 从单一终端页升级为左右栏 Agent Console：

```text
/ai-cli
  左栏：原 AI CLI 终端 / 专家模式 / proposal 审批兜底
  右栏：Codex 风格半 GUI 对话框 / 自然语言任务 / 结构化流程展示
```

## 背景

现有 `/ai-cli` 已经具备以下基础能力：

- 通过 `runAiCliCommand` 执行 AI CLI command service。
- 维护当前 `web-cli` session。
- 支持 `proposal.list/show/approve/reject/save/unsave`。
- 支持 `Y/N` 审批和保存。
- 订阅 `/api/agent/events`，并通过 `/api/agent/records` 做 snapshot 兜底。
- 能导入外部 REST 创建的 proposal。
- 外部 agent 创建 proposal 后，Web CLI 仍是用户审批与保存入口。

下一阶段的重点不是新增一个完全独立的 agent 产品，而是在现有 AI CLI 页面旁边放置一个可扩展的 skill 载体，让用户可以通过自然语言和任务卡片完成数据填表、查库、修复、审计等工作。

## 产品形态

### 总体布局

页面采用左右两栏：

```text
┌────────────────────────────────┬────────────────────────────────┐
│ AI CLI Terminal                │ def-opencode对话框                  │
│                                │                                │
│ 原命令行输入/输出               │ 任务类型按钮                    │
│ proposal 审批/保存              │ 自然语言任务输入                 │
│ agent logs / SSE handoff       │ 对话、任务步骤、证据、风险         │
│ 专家模式和兜底入口              │ proposal 卡片和修正入口           │
└────────────────────────────────┴────────────────────────────────┘
```

左栏保留原始 AI CLI 行为；右栏承载面向用户的 skill 工作流。

### 左栏：AI CLI Terminal

左栏必须保留现有功能：

- 命令行输入和输出。
- `help/spec/agent.logs/agent.sessions`。
- `proposal.list/show/approve/reject/save/unsave`。
- `Y/N` 审批和保存。
- 外部 proposal 自动导入和默认预览。
- SSE 事件订阅和 snapshot fallback。
- 作为右栏失败、歧义或高级操作时的兜底入口。

左栏不是废弃入口，而是专家模式。

### 右栏：def-opencode对话框

右栏是 Codex 风格半 GUI 对话框，也是独立 skill 载体。用户不需要直接理解 REST、OpenCode、agent runtime、模型配置或 proposal storage。

第一版建议承载以下界面块：

- 任务类型按钮：填干员、填武器、填装备、查库、修复错误、审计数据。
- 半 GUI 对话区：粘贴资料、描述目标、补充修正要求。
- 任务时间线：识别领域、读取模板、读取库、生成草稿、校验、修复、创建 proposal。
- 工具调用摘要：展示关键 REST/AI CLI 调用结果，不展示过长 JSON。
- Proposal 卡片：显示 proposal alias/id、domain、状态、风险字段。
- Evidence / Risk 区：展示关键字段证据、不确定项和需人工重点审核的字段。
- 修正入口：用户可以针对当前 proposal 或 draft 用自然语言要求修正。

右栏生成的 proposal 必须回到现有 AI CLI proposal 状态机，不得绕过审批保存。

## Skill 载体定位

本阶段把右栏定义为 skill 载体，而不是通用聊天机器人。

Skill 是某类任务的知识、流程、工具声明、校验规则和修复策略。Agent runtime 只负责承载 skill 的执行。

建议第一批 skill：

```text
operator-fill
weapon-fill
equipment-fill
rest-search
proposal-review
check-error-repair
library-audit
```

每个 skill 至少应描述：

- 触发条件。
- 需要读取的上下文。
- 可用工具。
- 标准流程。
- 硬规则。
- 失败修复策略。
- 何时必须询问用户。
- 何时允许创建 proposal。

## 技术边界

### 不新增独立 Electron

第一阶段不创建第二个 Electron 应用。`/ai-cli` 仍属于现有 `dmg-end-field` Web UI。

原因：

- 当前事实源、proposal 状态、Web CLI 审批链都在主应用内。
- 独立应用会增加窗口切换、状态同步和发布复杂度。
- 右栏可以直接复用现有 session、proposal 和 SSE 机制。

### 不废弃现有 AI CLI 核心

右栏不是替代 `AiCliCommandService`，而是调用或间接调用现有服务。

所有写入仍遵循：

```text
生成 draft
  -> fill.check
  -> fill.apply 创建 proposal
  -> Web CLI 用户 approve
  -> Web CLI 用户 save
```

禁止右栏直接写 domain library/localStorage。

### Runtime 决策：内置 OpenCode

下一阶段 runtime 方案收敛为：随应用内置 OpenCode 二进制，作为后台 skill runtime。

用户不直接接触 OpenCode。产品界面仍然是右栏def-opencode/资料解析/待审核修改工作台；OpenCode 只作为后台执行器，用于承载 DEF skills、tools 和 agent loop。

后台启停、DeepSeek API Key、Base URL、Model 等配置不放在 `/ai-cli` 右栏，而是放在 DEF Shell 的“服务与 Agent”独立区域。`/ai-cli` 右栏只负责用户任务对话、风险提示和待审核修改。

内置体积预估：

```text
Windows x64 OpenCode binary:
  npm 压缩包约 55 MB
  解压后约 165 MB
```

因此 Windows 发布包预计增加约 50-70 MB，安装/解压后体积增加约 165 MB 以上。该成本在本阶段接受。

边界：

- OpenCode 是后台 runtime，不是用户产品入口。
- `/ai-cli` 用户界面不出现 OpenCode、MCP、tool call、AGENTS.md、SKILL.md、API Key、Base URL 等开发者/模型配置概念。
- DEF Shell 可以出现后台、DeepSeek、模型配置等维护项。
- 前端只展示任务步骤、风险、证据、待审核修改和保存动作。
- OpenCode 不直接写业务 storage；写入仍必须通过 `ai-cli-rest`、domain adapter 和 proposal 审批链。
- OpenCode 配置、DEF skills 和 DEF tools 由应用随包提供，不要求普通用户安装或配置。
- 后续如需替换 runtime，必须保持右栏 UI 和业务协议不变。

## 建议组件拆分

现有 `AiCliPage` 建议拆成两栏组件：

```text
AiCliPage
  ├─ AiCliTerminalPane
  │   ├─ terminal output
  │   ├─ command input
  │   ├─ command history
  │   └─ SSE/proposal handoff display
  │
  └─ AiSkillWorkbenchPane
      ├─ TaskTypePicker
      ├─ SkillChatComposer
      ├─ SkillTaskTimeline
      ├─ SkillToolCallList
      ├─ SkillProposalCard
      ├─ SkillEvidencePanel
      └─ SkillDraftDiffView
```

拆分原则：

- `AiCliTerminalPane` 保持原行为不变。
- `AiSkillWorkbenchPane` 不直接实现业务写入。
- 两栏共享当前 session/proposal 状态。
- 右栏按钮如需审批/保存，应调用同一套 `runAiCliCommand`，不得复制 proposal 状态机。

## 通信模型

第一阶段可以先用前端本地状态模拟右栏任务流；接入真实 runtime 后建议使用本地 sidecar：

```text
AiSkillWorkbenchPane
  -> def-agent sidecar / embedded OpenCode runtime
  -> ai-cli-rest
  -> runAiCliCommand / domain adapter
  -> proposal storage / SSE handoff
  -> AiCliPage 两栏同步展示
```

建议 sidecar API 形态：

```text
POST /agent/tasks
GET  /agent/tasks/:taskId/events
POST /agent/tasks/:taskId/cancel
POST /agent/tasks/:taskId/user-message
```

右栏只展示任务和用户交互，不直接持有最终业务真相。

## 数据与状态

右栏需要展示三类状态：

- Skill task state：当前任务步骤、工具调用、错误、修复记录。
- Agent session state：当前对话、上下文、用户补充。
- Proposal state：现有 `AiAgentProposal` 的 approval/save 状态。

Proposal 状态仍以现有 `def.ai-agent.proposals.v1` 和 command service 为准。

任务 trace 可作为后续新增持久化内容：

```text
def.ai-agent.skill-tasks.v1
def.ai-agent.skill-traces.v1
```

第一阶段如果没有真实 runtime，可以先不落地持久化 trace。

## 用户流程

### 填表流程

```text
用户在右栏选择“填干员”
  -> 粘贴资料或描述目标
  -> skill 识别 domain=operator
  -> 读取 template/current/library
  -> 生成 draft
  -> fill.check
  -> 如失败，进入修复循环
  -> check 通过后创建 proposal
  -> 右栏显示 proposal 卡片和风险字段
  -> 左栏同步出现 proposal preview
  -> 用户通过左栏 Y/Y 或右栏按钮审批保存
```

### 修正流程

```text
用户指出某字段错误
  -> 右栏把修正要求绑定到当前任务/proposal
  -> skill 重新生成或局部修改 draft
  -> 再次 fill.check
  -> 创建新的 proposal 或更新当前待审草稿策略由后续任务决定
```

第一阶段建议保守处理：已有 pending proposal 时，不静默覆盖，提示用户先拒绝/清理旧 proposal 或显式创建新 proposal。

## 安全规则

- 右栏 skill runtime 默认可以自由执行 read-only 和 dry-run 工具。
- `fill.apply` 只能创建 proposal，不能保存 library。
- `proposal.approve/save` 是用户确认动作，必须走 Web CLI 权限语义。
- `proposal.clear`、删除、覆盖类动作需要显式确认。
- 右栏不得直接写 `def.*.library.v1`。
- 右栏不得引导用户在浏览器重新执行已由 REST 创建的 `fill.apply`。
- 多个 pending proposal 时，不允许默认选择最新 proposal 执行 `Y/N`。

## 非目标

本阶段不做：

- 独立 Electron Agent App。
- 废弃或隐藏原 AI CLI 终端。
- 重写 proposal 状态机。
- 让外部 agent 自动 approve/save。
- 让用户直接使用 OpenCode CLI/TUI。
- 一次性实现完整 skill marketplace。
- 一次性实现所有 domain 的智能填表质量闭环。

## 第一阶段验收标准

- `/ai-cli` 页面呈现左右栏布局。
- 左栏原命令行行为保持可用。
- 左栏仍能完成 proposal `Y/Y` 审批保存。
- 右栏能展示半 GUI 对话区、任务类型按钮和任务时间线骨架。
- 右栏不展示后台启动、DeepSeek API Key、Base URL、Model 等配置项。
- DEF Shell 的“服务与 Agent”页能展示 DEF Agent 后台启停和 DeepSeek 配置。
- 右栏能读取并展示当前 pending proposal 摘要。
- 右栏按钮如触发 proposal 操作，必须调用现有 `runAiCliCommand` 路径。
- 外部 REST proposal handoff 仍能同步到左栏，并可被右栏感知。
- 第一阶段 UI 可以先不接入真实 OpenCode runtime，但技术路线按“内置 OpenCode 后台 runtime”设计。

## 后续演进

后续可以按以下顺序推进：

1. 先完成 `/ai-cli` 左右栏和右栏静态 skill 载体。
2. 把现有终端逻辑拆成 `AiCliTerminalPane`。
3. 右栏接入 proposal 摘要和 agent records。
4. 随应用打包 OpenCode Windows x64 binary，并由本地 sidecar 管理启动/停止。
5. 接入一个最小 DEF skill，先支持 `rest-search` 或 `check-error-repair`。
6. 接入 `operator-fill / weapon-fill / equipment-fill`。
7. 引入任务 trace、证据面板和 draft diff。
