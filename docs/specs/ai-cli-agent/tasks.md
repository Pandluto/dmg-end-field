# AI CLI Agent Tasks

## Status

本任务用于把现有 `/ai-cli` 页面能力升级为可被 Codex、Claude、PowerShell、未来 MCP 接入的本地 agent 框架。

本轮边界已经确认：

- 继续用 TypeScript 写一方代码。
- Shell / 桌面壳只负责启动、关闭、端口和进程管理。
- Web 页面负责实时渲染和用户交互。
- Local REST Server 负责暴露接口、权限、日志、会话入口。
- TypeScript Service 负责命令解析、schema 校验、业务规则和写入。
- AI CLI 与本地数据双端同步无关。
- 桌面端 AI CLI 导航入口保持禁用，Web 端入口保留。

## Tasks

- [ ] Task 1: 固定架构边界
  - [ ] 在 `docs/ai-cli-agent-spec.md` 保持 Shell / Web / REST / Service / Storage 责任分层。
  - [ ] 明确 REST 是本地伴随服务，不是公网后端。
  - [ ] 明确 REST 代码由应用项目维护，不由 shell、Codex、Claude 维护。
  - [ ] 明确所有一方实现代码使用 TypeScript。

- [x] Task 2: 抽出 AI CLI command service
  - [x] 从 `src/components/AiCliPage.tsx` 抽出命令解析逻辑。
  - [x] 从页面抽出 `runCommand` 业务逻辑。
  - [x] 定义 `AiCliCommandRequest`。
  - [x] 定义 `AiCliCommandResponse`。
  - [x] 保持页面现有命令行为不变。
  - [x] 页面只负责输入、输出、复制和渲染。

- [x] Task 3: 建立 agent 基础设施类型
  - [x] 定义 `AiAgentSession`。
  - [x] 定义 `AiAgentMessage`。
  - [x] 定义 `AiAgentOperationLog`。
  - [x] 定义 `AiAgentPermissionProfile`。
  - [x] 定义 client 类型：`web-cli / powershell / codex / claude / rest / mcp`。
  - [x] 定义默认权限：`readonly-agent / confirmed-writer / trusted-local-dev`。

- [ ] Task 4: 实现会话记忆 service
  - [x] 新增 active session 读取。
  - [x] 新增 session 创建。
  - [x] 新增 session message 追加。
  - [x] 新增 session context 更新。
  - [ ] 支持清空或归档 session。
  - [x] 使用 `def.ai-agent.sessions.v1` 和 `def.ai-agent.active-session-id.v1`。

- [x] Task 5: 实现操作日志 service
  - [x] 每次命令执行前后记录日志。
  - [x] 记录 client、command、ok、duration、writes、storage。
  - [x] 错误时记录 errorCode 和 errorMessage。
  - [x] 长 JSON 不完整入日志，只记录摘要。
  - [x] 使用 `def.ai-agent.operation-logs.v1`。

- [ ] Task 6: 实现权限 service
  - [x] 根据 client 读取 permission profile。
  - [x] `fill.check` 校验 `canDryRun`。
  - [x] `fill.apply` 和写命令校验 `canWrite`。
  - [x] 默认 REST 和 PowerShell 为只读。
  - [ ] 权限变更写入日志。
  - [x] 使用 `def.ai-agent.permission-profiles.v1`。

- [ ] Task 7: 接入 Local REST Server
  - [x] 新增本地 REST TypeScript adapter。
  - [x] 新增本地 REST server 启动入口。
  - [x] 只监听 `127.0.0.1`。
  - [x] 增加 `GET /api/ai-cli/spec` adapter。
  - [x] 增加 `POST /api/ai-cli/run` adapter。
  - [x] 增加 `GET /api/buff/current` adapter。
  - [x] 增加 `GET /api/buff/library` adapter，作为 Buff 主真相读取入口。
  - [x] 增加 `GET /api/buff/library/<id>` adapter，读取单个 Buff 主库条目。
  - [x] 增加 `POST /api/buff/fill/check` adapter。
  - [x] 增加 `POST /api/buff/fill/apply` adapter。
  - [x] REST adapter 必须调用同一套 command service 和 validator。
  - [x] `fill.apply` 写入 `def.buff-editor.library.v1`，并同步当前 draft。

- [ ] Task 8: 接入 Shell / 桌面壳生命周期
  - [x] 提供启动 REST server 的脚本或桌面壳调用入口。
  - [x] 提供关闭 REST server 的脚本或桌面壳调用入口。
  - [ ] 提供端口占用检查。
  - [x] 提供健康检查。
  - [x] Shell 不实现业务规则。

- [x] Task 9: Web UI 对齐
  - [x] `/ai-cli` 页面改为调用 command service。
  - [x] 保持 Web 端导航入口可用。
  - [x] 保持桌面端导航入口 disabled。
  - [x] 终端输出仍保持 `[ok] / [err] / [info]`。
  - [x] `/purpose` 保持中英双语。
  - [x] `/ai-cli` 支持 `agent.logs` 查看访问记录。
  - [x] `/ai-cli` 支持 `agent.sessions` 查看会话记录。

- [x] Task 9.5: Shell Agent 记录渲染
  - [x] REST 暴露 `GET /api/agent/logs`。
  - [x] REST 暴露 `GET /api/agent/sessions`。
  - [x] REST 暴露 `GET /api/agent/records`。
  - [x] REST 暴露 `GET /api/agent/events` SSE 事件流。
  - [x] Shell 独立界面新增 Agent 页面。
  - [x] Shell Agent 页面渲染 operation logs。
  - [x] Shell Agent 页面渲染 sessions。
  - [x] AI REST 运行时 Shell Agent 页面通过 SSE 刷新。
  - [x] Shell Agent 页面保留轮询兜底。

- [ ] Task 10: 验证
  - [x] 运行 `npm run build`。
  - [x] 运行现有 Playwright AI CLI smoke test。
  - [x] 新增 REST smoke test 或脚本。
  - [x] REST smoke 覆盖 `spec / buff.list / library / draft.show / fill.check / fill.apply`。
  - [x] 验证 invalid payload 不写入。
  - [x] 验证 valid payload 写入并生成 undo snapshot。

- [x] Task 11: 建立 Agent Proposal 审批/保存框架
  - [x] 定义 `AiAgentProposal` 类型：`id / domain / operation / payload / approvalStatus / saveStatus / client / sessionId / createdAt / updatedAt`。
  - [x] domain 支持 `buff / operator / weapon / equipment`，不要把框架写成 Buff 专用。
  - [x] 新增 proposal 存储 key，例如 `def.ai-agent.proposals.v1`。
  - [x] 新增 proposal 读写 service：create / read pending / approve / reject / mark saved / mark unsaved。
  - [x] `AiCliCommandResponse` 增加可选 `proposal` 字段，向外部 agent 返回 `approval` 和 `save` 状态。
  - [x] `AiAgentOperationLog` 增加 `proposalId / approval / save` 字段。
  - [x] `agent.logs` 和 `agent.sessions` 输出审批/保存状态。
  - [x] Task 11 收尾：`AiAgentSession.context` 增加 `pendingProposalId`，用于 UI/会话快速定位当前待处理 proposal。
  - [x] Task 11 收尾：将 `AiAgentSession.state` 中的 `proposalId / approval / save` 类型化，避免继续使用裸 `Record<string, unknown>` 承载关键闭环状态。
  - [x] Task 11 收尾：`AiAgentProposal` 增加 `summary?: string`，让 `proposal.list` 能展示人类可读摘要。
  - [x] Task 11 收尾：REST smoke 增加 `POST /api/ai-cli/run` + `proposal.list` 断言。

- [ ] Task 12: 改造 Buff fill.apply 为 proposal-first
  - [ ] 边界：审批和保存是用户动作，不是外部 agent 自批自存；agent 只能创建/查询 proposal，不能默认绕过用户确认。
  - [ ] 边界：如新增 `proposal.approve/reject/save/unsave` CLI 命令或 REST 端点，必须标记为用户确认入口，并受权限/客户端约束。
  - [ ] 边界：REST 端点不能让 readonly 外部 agent 直接推进 `approval/save` 状态。
  - [ ] 保留 `fill.check` 纯校验不写入。
  - [ ] 外部 agent 路径的 `fill.apply` 校验通过后创建 Buff proposal，初始 `approval=Wait / save=Wait`。
  - [ ] `fill.apply` 响应返回 `proposal.id`、`approval=Wait`、`save=Wait`、`nextAction='reply Y/N to approve'`。
  - [ ] `fill.apply` 不再把 `ok:true` 表述为业务已保存。
  - [ ] Web CLI 支持对当前 pending proposal 输入 `Y` / `N`。
  - [ ] `Y`：把 proposal 应用到 Web 工作态，记录 `approval=Yes / save=Wait`。
  - [ ] `N`：拒绝 proposal，记录 `approval=No / save=No`。
  - [ ] 审批通过后支持保存确认 `Y` / `N`。
  - [ ] 保存 `Y`：写入 app 主真相 localStorage，记录 `save=Yes`。
  - [ ] 保存 `N`：不写入 app 主真相，记录 `save=No`。

- [ ] Task 13: 抽象横向 Domain Adapter
  - [ ] 定义 `AgentProposalDomainAdapter` 接口。
  - [ ] 接口包含 `validateProposal / summarizeProposal / applyToWorkingState / saveToLocalTruth / discardProposal`。
  - [ ] 实现 `buff` adapter，复用现有 Buff validator、normalizer、undo 逻辑。
  - [ ] 为 `operator / weapon / equipment` 预留 adapter 注册位，但不急于实现完整业务。
  - [ ] 命令层只通过 adapter 调用领域能力，不直接分叉写四套审批逻辑。

- [ ] Task 14: 验证 proposal 闭环
  - [ ] 单测覆盖 create proposal：`approval=Wait / save=Wait`。
  - [ ] 单测覆盖 approve Y：`approval=Yes / save=Wait`。
  - [ ] 单测覆盖 reject N：`approval=No / save=No`。
  - [ ] 单测覆盖 save Y：写入目标 storage，`save=Yes`。
  - [ ] 单测覆盖 save N：不写入目标 storage，`save=No`。
  - [ ] REST smoke 覆盖外部 agent `fill.apply` 不直接宣称保存完成。
  - [ ] agent logs/sessions smoke 覆盖审批和保存状态字段。
