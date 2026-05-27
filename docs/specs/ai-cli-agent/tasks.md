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
  - [ ] 新增本地 TypeScript REST server 入口。
  - [ ] 只监听 `127.0.0.1`。
  - [x] 增加 `GET /api/ai-cli/spec` adapter。
  - [x] 增加 `POST /api/ai-cli/run` adapter。
  - [x] 增加 `GET /api/buff/current` adapter。
  - [x] 增加 `POST /api/buff/fill/check` adapter。
  - [x] 增加 `POST /api/buff/fill/apply` adapter。
  - [x] REST adapter 必须调用同一套 command service 和 validator。

- [ ] Task 8: 接入 Shell / 桌面壳生命周期
  - [ ] 提供启动 REST server 的脚本或桌面壳调用入口。
  - [ ] 提供关闭 REST server 的脚本或桌面壳调用入口。
  - [ ] 提供端口占用检查。
  - [ ] 提供健康检查。
  - [ ] Shell 不实现业务规则。

- [x] Task 9: Web UI 对齐
  - [x] `/ai-cli` 页面改为调用 command service。
  - [x] 保持 Web 端导航入口可用。
  - [x] 保持桌面端导航入口 disabled。
  - [x] 终端输出仍保持 `[ok] / [err] / [info]`。
  - [x] `/purpose` 保持中英双语。

- [ ] Task 10: 验证
  - [x] 运行 `npm run build`。
  - [x] 运行现有 Playwright AI CLI smoke test。
  - [ ] 新增 REST smoke test 或脚本。
  - [ ] REST smoke 覆盖 `spec / draft.show / fill.check / fill.apply`。
  - [x] 验证 invalid payload 不写入。
  - [x] 验证 valid payload 写入并生成 undo snapshot。
