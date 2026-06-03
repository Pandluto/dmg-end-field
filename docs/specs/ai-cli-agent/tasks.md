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

- [ ] Task 12: 完成横向 Fill Proposal 框架，并改造 Buff/Weapon 分支
  - [ ] 边界：审批和保存是用户动作，不是外部 agent 自批自存；agent 只能创建/查询 proposal，不能默认绕过用户确认。
  - [ ] 边界：如新增 `proposal.approve/reject/save/unsave` CLI 命令或 REST 端点，必须标记为用户确认入口，并受权限/客户端约束。
  - [ ] 边界：REST 端点不能让 readonly 外部 agent 直接推进 `approval/save` 状态。
  - [ ] 定义 `AgentFillDomainAdapter` 横向接口，至少包含 `domain / workflow / commandPrefix / draftStorageKey / libraryStorageKey / buildTaskPackage / validateAiDraft / summarizeProposal / createProposalPayload / applyToWorkingState / saveToLocalTruth / discardProposal`。
  - [ ] 明确文件落点：建议新增 `src/aiCli/aiCliFillDomains.ts` 存放 `AgentFillDomainAdapter`、registry 和共享 fill command handlers。
  - [ ] 建立 fill domain registry，以 `commandPrefix` 为 key 分发 `*.fill.task/check/apply`，不要在 `executeCommand` 中为每个领域复制一套状态机。
  - [ ] registry 未命中时返回 `unknown-command`；registry 命中但 action 非 `task/check/apply` 时返回 usage error。
  - [ ] `AiCliCommandRequest` spec 和实现都必须包含 `client` 字段，权限判断不能依赖隐式客户端。
  - [ ] 把现有 Buff fill 逻辑迁入 `buff` adapter：task package、schema、validator、normalizer、proposal summary、working-state apply、local-truth save。
  - [ ] 所有 domain 的 `*.fill.task` 都必须返回 `data` 结构化任务包，`lines` 只放摘要。
  - [ ] 所有 domain 的 `*.fill.check` 都必须只校验不写入。
  - [ ] 所有 domain 的 `*.fill.apply` 都必须只创建 proposal，不直接保存。
  - [ ] 明确 adapter 状态落点：`applyToWorkingState` 只能更新当前可见/活动 draft，不能写 library/local truth。
  - [ ] 明确 adapter 保存落点：只有 `saveToLocalTruth` 可以写 domain library storage。
  - [ ] 明确 adapter 输入输出：`validateAiDraft` 输出 normalized；`createProposalPayload(normalized, rawCommand)` 生成 `AiAgentProposal.payload`；approve/save 都消费这个 proposal payload。
  - [ ] 明确 proposal operation：`*.fill.apply` 创建 proposal 时 `operation` 统一用 `<commandPrefix>.apply`。
  - [ ] 明确失败顺序：approve 时先 `applyToWorkingState` 成功，再 `approveAgentProposal`；save 时先 `saveToLocalTruth` 成功，再 `markAgentProposalSaved`。
  - [ ] 明确失败回滚：adapter 调用失败时保持 proposal 原状态，返回 `ok:false` 并写 operation log。
  - [ ] 明确重复 proposal 策略：同 domain + 同 target id 已有 pending proposal 时，新 `*.fill.apply` 必须失败并提示，不得静默创建竞争 proposal。
  - [ ] Buff 保存迁移：`fill.apply` 不再调用 `persistLibraryDraft`，不写 undo，不写 `def.buff-editor.library.v1`。
  - [ ] Buff 审批落点：`proposal.approve` / `Y` 只应用到当前 Buff working draft。
  - [ ] Buff 保存落点：`proposal.save` / 保存 `Y` 才写 `def.buff-editor.library.v1`、同步 `def.buff-editor.draft.v1`，并创建 undo snapshot。
  - [ ] 新增 `proposal.show <proposalId>`，展示 proposal 摘要、domain、operation、approval/save、payload 摘要。
  - [ ] 新增 `proposal.approve <proposalId>`，仅作为用户确认入口，调用 `approveAgentProposal`。
  - [ ] 新增 `proposal.reject <proposalId>`，仅作为用户确认入口，调用 `rejectAgentProposal`。
  - [ ] 新增 `proposal.save <proposalId>`，仅作为用户确认入口，调用 domain adapter 的保存逻辑后标记 `save=Yes`。
  - [ ] 新增 `proposal.unsave <proposalId>`，仅作为用户确认入口，丢弃/取消保存并标记 `save=No`。
  - [ ] Web CLI 支持短输入 `Y` / `N`：当前 session 只有一个 pending proposal 时，按状态自动映射到 approve/reject 或 save/unsave。
  - [ ] `Y/N` 作为特殊短输入接入命令解析和权限判断，不作为普通 namespace.action 命令处理。
  - [ ] `Y/N` 使用 session-scoped pending 查询：实现 `readPendingAgentProposals(sessionId?)` 或 `readPendingAgentProposalsForSession(sessionId)`。
  - [ ] `Y/N` 在没有 pending proposal 时必须失败并提示没有待处理 proposal。
  - [ ] `Y/N` 在多个 pending proposal 时必须失败并提示使用显式 `proposal.show/approve/reject/save/unsave <proposalId>`。
  - [ ] `Y/N` 不能默认选择最新 proposal。
  - [ ] 默认只有 `web-cli` 作为用户确认客户端支持短输入 `Y/N`。
  - [ ] 默认 `rest / powershell / codex / claude / mcp` 只能查询 proposal，不能推进 `approval/save`。
  - [ ] `proposal.approve/reject/save/unsave` 不加入 readonly-agent 默认权限，也不加入 `GUARANTEED_READONLY_COMMANDS`。
  - [ ] 每次 proposal 状态转移都更新 proposal storage、session context/state、operation log 和 command response。
  - [ ] 保留 `fill.check` 纯校验不写入。
  - [ ] 外部 agent 路径的 `fill.apply` 校验通过后创建 Buff proposal，初始 `approval=Wait / save=Wait`。
  - [ ] `fill.apply` 响应返回 `proposal.id`、`approval=Wait`、`save=Wait`、`nextAction='reply Y/N to approve'`。
  - [ ] `fill.apply` 不再把 `ok:true` 表述为业务已保存。
  - [ ] `Y`：把 proposal 应用到 Web 工作态，记录 `approval=Yes / save=Wait`。
  - [ ] `N`：拒绝 proposal，记录 `approval=No / save=No`。
  - [ ] 审批通过后支持保存确认 `Y` / `N`。
  - [ ] 保存 `Y`：写入 app 主真相 localStorage，记录 `save=Yes`。
  - [ ] 保存 `N`：不写入 app 主真相，记录 `save=No`。
  - [ ] 对接横向 `weapon.fill` 分支：`AiAgentWorkflow` 支持 `weapon.fill`，并通过 fill domain registry 注册。
  - [ ] 对接横向 `weapon.fill` 分支：实现 `weapon` adapter，不得复用 Buff storage key、Buff draft type、Buff validator 或 Buff prompt contract。
  - [ ] 对接横向 `weapon.fill` 分支：实现 `weapon.fill.task / weapon.fill.check / weapon.fill.apply` 三个命令的真实命令路径。
  - [ ] 对接横向 `weapon.fill` 分支：明确并使用目标 storage 边界 `def.weapon-sheet.draft.v1` 与 `def.weapon-sheet.library.v1`，但外部 agent 不得直接写。
  - [ ] 对接横向 `weapon.fill` 分支：定义最小可测 `WeaponFillAiDraft` schema，至少覆盖 weapon id/name/rarity/description/skills/effects 的基本结构。
  - [ ] Weapon adapter 声明 `supportedEffectTypes: string[]`，第一版可以很小但必须显式，并用于 validation。
  - [ ] `weapon.fill.task` 返回当前 weapon draft、最小 schema、supportedEffectTypes 和审批/保存警告；不得复用 Buff modifier catalog。
  - [ ] `WeaponFillAiDraft.skills` 只允许 `skill1 / skill2 / skill3`。
  - [ ] `WeaponFillAiEffect.bucket` 只允许 `value / effect`。
  - [ ] `WeaponFillAiEffect.value` 和 `levels.*` 必须是 number，不接受字符串数字。
  - [ ] Weapon adapter 必须明确 unsupported effect type 的处理：拒绝或显式 drop，不允许猜成 Buff modifier type。
  - [ ] Weapon 保存路径必须对齐现有 Sheet-Weapon 保存行为；若当前没有 undo，本轮不得暗中新增隐藏 undo。
  - [ ] 对接横向 `weapon.fill` 分支：`weapon.fill.check` 能拒绝无效 payload，`weapon.fill.apply` 能创建 `domain='weapon'` proposal。
  - [ ] 对接横向 `operator.fill / equipment.fill`：本轮不要求实现完整业务，但 registry 和 adapter 类型必须能无结构性改动地注册这两个领域。
  - [ ] proposal 存储增加上限或清理策略，至少避免无限增长；可保留最近 N 条 closed proposals。
  - [ ] 测试：`fill.apply` 创建 proposal 后不直接写 `def.buff-editor.library.v1`。
  - [ ] 测试：`fill.apply` 创建 proposal 后不写 `def.buff-editor.undo.v1`。
  - [ ] 测试：Buff approve 后、save 前，`def.buff-editor.library.v1` 仍不变化。
  - [ ] 测试：Buff save 后，`def.buff-editor.library.v1` 才变化，且 undo snapshot 在 save 阶段创建。
  - [ ] 测试：`proposal.approve/reject/save/unsave` 状态流正确，readonly-agent 不能执行推进状态命令。
  - [ ] 测试：`Y/N` 只在当前 session 单一 pending proposal 时生效。
  - [ ] 测试：无 pending proposal 时 `Y/N` 返回提示，不改变任何 proposal。
  - [ ] 测试：多个 pending proposal 时 `Y/N` 返回歧义提示，不默认选择最新 proposal。
  - [ ] 测试：`weapon.fill.task/check/apply` 走 registry，proposal 使用 `domain='weapon'`，且不触碰 Buff storage。
  - [ ] 测试：`weapon.fill.check` 拒绝缺 id/name、非法 skill key、非法 bucket、字符串数字 value。
  - [ ] 测试：`weapon.fill.apply` 创建 proposal 后不写 `def.weapon-sheet.library.v1`。
  - [ ] 测试：同 domain + 同 target id 已有 pending proposal 时，第二次 apply 返回错误且不创建竞争 proposal。
  - [ ] 测试：adapter apply/save 抛错时 proposal 状态不变化，并产生 `ok:false` 响应和错误日志。
  - [ ] 测试：registry 至少覆盖 `buff.fill` 和 `weapon.fill` 两个 domain，新增 domain 不需要复制审批/保存状态机。

- [ ] Task 13: 扩展横向 Domain Adapter 到干员/装备
  - [ ] 基于 Task 12 的 `AgentFillDomainAdapter` 和 registry，接入 `operator.fill`。
  - [ ] 基于 Task 12 的 `AgentFillDomainAdapter` 和 registry，接入 `equipment.fill`。
  - [ ] 为 `operator.fill` 定义独立 schema、validator、storage boundary 和 proposal summary。
  - [ ] 为 `equipment.fill` 定义独立 schema、validator、storage boundary 和 proposal summary。
  - [ ] 复用 Task 12 的 proposal 审批/保存状态机，不复制新的审批逻辑。

- [ ] Task 14: 验证横向 proposal 闭环集成
  - [ ] 汇总 Task 12/13 的单测和 smoke 结果，避免重复维护同一批 case。
  - [ ] REST smoke 覆盖 proposal 查询端点/命令、`buff.fill` proposal-first、`weapon.fill` proposal-first。
  - [ ] Shell Agent 页面或 `/ai-cli` 输出能看到 proposal approval/save 状态。
  - [ ] 回归确认 readonly 外部 agent 不能推进审批/保存。
