# Agent CLI 代码框架规范

> 版本 1.2 | 2026-06-02 | Task 11 审查通过，Proposal 框架闭合确认

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────┐
│  aiCliAgentTypes.ts        类型定义层 (零依赖)    │
└────────────────────┬────────────────────────────┘
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
┌─────────┐  ┌──────────────┐  ┌─────────────┐
│ Infra   │  │ CommandEngine│  │ RESTAdapter │
│ 会话权限 │  │ 命令执行业务  │  │ HTTP → 引擎  │
│ 存储审计 │  │ Buff领域逻辑  │  │ 纯函数适配   │
└────┬────┘  └──────┬───────┘  └──────┬──────┘
     │              │                  │
     └──────────────┼──────────────────┘
                    ▼
          ┌─────────────────┐
          │ ai-cli-rest-    │
          │ server.mjs      │
          │ HTTP + SSE 服务  │
          └─────────────────┘
```

**原则：** 依赖单向流动。上层可引用下层，反之不可。不存在循环依赖。

---

## 2. 模块职责与边界

### 2.1 `aiCliAgentTypes.ts` — 类型定义

**职责：** 所有共享类型、接口、协议常量。不包含任何逻辑。

| 规则 |
|------|
| 跨模块共享类型必须在此定义；模块私有类型可留在对应模块内 |
| `AiCliCommandResponse` 的 `data` 字段用 `unknown`，由消费方断言 |
| 错误类型用字面量联合 `'xxx' | 'yyy'`，不用 `string` |
| 协议常量 (`AI_CLI_PROTOCOL_VERSION`) 统一维护 |

### 2.2 `aiCliAgentInfrastructure.ts` — 基础设施

**职责：** 会话生命周期、权限验证、存储读写、操作审计。

**公共 API：**
| 函数 | 用途 |
|------|------|
| `assertPermission(profile, cmd)` | 权限判断 → `AiAgentPermissionError \| null` |
| `ensureAgentSession(client)` | 获取或创建当前会话 |
| `appendOperationLog(log)` | 写入审计日志 |
| `readOperationLogs()` | 读取全部审计日志 |
| `readAgentRecordSnapshot()` | SSE 用的复合快照 |
| `readPermissionProfiles()` | 读取权限配置（含自动迁移） |

**边界规则：**
- 不包含任何 Buff 领域知识（存储 key 除外）
- 不引用 `aiCliCommandService.ts`
- `KNOWN_COMMANDS` 是命令存在性注册表
- `GUARANTEED_READONLY_COMMANDS` 只用于给已有 `readonly-agent` profile 自动补齐系统保证的基础读命令，不是所有新读命令的唯一注册点

### 2.3 `aiCliCommandService.ts` — 命令引擎

**职责：** 命令解析、业务验证、Buff 持久化、Undo 快照。

**公共 API：**
| 函数 | 用途 |
|------|------|
| `runAiCliCommand(req, draft, ctx)` | **唯一入口**，三阶段执行 |
| `createAiCliCommandRequest(cmd, client)` | 请求工厂 |
| `readCurrentBuffDraft()` / `readBuffLibrary()` | 存储读取 |
| `formatDraftSummary()` / `formatLibrarySummary()` | 格式化工具 |

**执行三阶段（`runAiCliCommand`）：**

```
阶段1 PRE:  确保会话 → 权限检查 → 记录用户消息
阶段2 EXEC: executeCommand() 或 权限拒绝/空命令/异常
阶段3 POST: 记录响应 → 更新会话 → 写入审计日志
```

**规则：**
| 规则 | 说明 |
|------|------|
| 新命令加到 `executeCommand` 的 if-else 链 | **短期可行，超过 35 个命令时必须拆成注册表** |
| 写操作必须调 `persistDraft` / `persistLibraryDraft` | 自动生成 Undo 快照 |
| 读操作用 `makeResponse`，写操作用 `writeResponse` | 区分 `effects.writes` |
| `fill.task` 返回的 AI 任务包放 `data` 字段 | **不放 `lines`，`lines` 只放摘要** |
| 不新增 `as never` 类型绕过 | 现有绕过属于技术债，应逐步用类型守卫替代 |

### 2.4 `aiCliRestAdapter.ts` — REST 适配器

**职责：** HTTP 语义 → 引擎 API 的纯函数转换。

**唯一入口：** `handleAiCliRestRequest(request, currentDraft, context) → { status, body }`

**规则：**
| 规则 | 说明 |
|------|------|
| 纯函数，不持有状态 | 所有状态通过参数传入 |
| GET 端点直接读 localStorage | 不走引擎（避免副作用） |
| POST 端点路由到 `runAiCliCommand` | 统一走引擎 |
| `fill.check`/`fill.apply` 桥接当前会将已解析 draft 序列化为 CLI 命令 | 若后续优化为直接对象传递，必须保持同一套校验、权限和审计路径 |
| HTTP 状态码保持当前策略 | `response.ok === false` 返回 400，响应体仍包含 `{ ok:false, error }`；不要随意改成统一 200 |
| 新增端点同步更新 `AI_CLI_REST_ENDPOINTS` 常量 | spec 端点读取此常量 |

### 2.5 `ai-cli-rest-server.mjs` — 服务器

**职责：** HTTP + SSE 服务、`window.localStorage` 模拟、请求生命周期。

**规则：**
| 规则 | 说明 |
|------|------|
| `NowStorageLocalStorage` 每次 `setItem` 调用 `refresh()` + `flush()` | 即时持久化但 O(n) I/O，瓶颈时加内存缓存 |
| SSE 广播迭代需包裹 `try/catch` | 防止断连客户端导致 EPIPE 崩溃 |
| 生产部署用预构建的 JS bundle | 替代 `vite.ssrLoadModule` |
| 新增端点需判断是否触发 `broadcastAgentRecords` | 排除纯读端点避免无效广播 |

---

## 3. 新增功能开发流程

### 3.1 新增 CLI 命令

```
1. aiCliAgentTypes.ts    — 无需改动 (command 是 string)
2. aiCliAgentInfrastructure.ts
   ├─ KNOWN_COMMANDS      — 添加命令名
   ├─ commandNeedsWrite?  — 如果是写命令
   ├─ allowedCommands?    — 如果是纯读命令，加到 readonly-agent
   └─ GUARANTEED_READONLY_COMMANDS? — 仅当它是老 readonly-agent profile 也必须自动补齐的基础读命令
3. aiCliCommandService.ts
   ├─ executeCommand      — 加 if 分支
   └─ splitAiCliCommand   — tokenizer 已足够，一般不动
4. aiCliRestAdapter.ts    — 一般无需改动 (走 POST /api/ai-cli/run)
5. smoke test             — 参考 scripts/ai-cli-rest-smoke.mjs 加断言
```

### 3.2 新增 REST 端点

```
1. aiCliAgentTypes.ts    — 如需新的 req/res 类型
2. aiCliRestAdapter.ts
   ├─ AI_CLI_REST_ENDPOINTS — 加路由声明
   └─ handleAiCliRestRequest — 加 GET/POST 分支
3. ai-cli-rest-server.mjs
   └─ 判断是否触发 broadcastAgentRecords
4. smoke test             — 加 HTTP 断言
```

### 3.3 新增 Fill 工作流能力

```
1. buffFill/catalog.ts   — 加 modifier type (含别名/正负例/注释)
2. buffFill/schema.ts    — 加 JSON Schema 字段
3. buffFill/validator.ts — 加验证规则
4. buff-sheet-ai-system-prompt.md — 加抽取规则
```

---

## 4. 反模式清单 (禁止事项)

| # | 反模式 | 说明 |
|---|--------|------|
| 1 | **新增或扩散 `as never` 绕过类型** | 现有绕过作为技术债处理，新代码用类型守卫替代 |
| 2 | **把结构化数据塞进 `lines` 字符串** | 用 `data` 字段，`lines` 只放人类可读摘要 |
| 3 | **在 `executeCommand` 外内联命令逻辑** | 所有命令处理统一在 `executeCommand` 或拆分后的注册表中 |
| 4 | **硬编码存储 key 字符串** | 用 `BUFF_DRAFT_STORAGE_KEY` 等常量 |
| 5 | **新增写命令不写审计日志** | `runAiCliCommand` 自动记录，确保不绕过 |
| 6 | **在 REST adapter 中直接写 localStorage** | 一律走引擎 |
| 7 | **重复 `readJsonStorage` / `createId`** | 统一用 infrastructure.ts 的版本 |
| 8 | **未 lowercase 就做 `startsWith` 匹配** | 命令比较前先 normalize |
| 9 | **随意改变 REST HTTP 状态策略** | 当前失败命令返回 400 + `{ok:false}`；调整前需同步客户端和 smoke |
| 10 | **在 REST adapter 内联大型静态数据** | 外置到常量文件或独立模块 |

---

## 5. 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 存储 key | `SCREAMING_SNAKE_CASE` + 导出 | `BUFF_DRAFT_STORAGE_KEY` |
| 内部常量 | `SCREAMING_SNAKE_CASE`，非导出 | `BUFF_UNDO_LIMIT` |
| 函数 | `camelCase`，动词开头 | `readCurrentBuffDraft`, `appendOperationLog` |
| 接口/类型 | `PascalCase` | `AiCliCommandRequest` |
| 响应行前缀 | `[ok]` / `[err]` / `[info]` | 用 `ok()` / `fail()` / `info()` 生成 |
| 权限配置 id | `kebab-case` | `readonly-agent`, `confirmed-writer` |
| 命令名 | `namespace.action`，小写 | `buff.list`, `fill.check` |

---

## 6. 测试策略

| 层级 | 工具 | 覆盖目标 |
|------|------|---------|
| 单元测试 | `scripts/run-ts-test.mjs`（轻量 TS/Vite runner）；vitest 待引入 | `runAiCliCommand`, `parseAiFillResult`, `validateBuffFillAiDraft`, `sanitizeBuffFillAiDraft` — 每个关键路径至少 1 个 case |
| 集成测试 | `scripts/ai-cli-rest-smoke.mjs` | 每个端点至少 1 个 happy path + 1 个 error case |
| E2E 测试 | Playwright (待配置) | `scripts/ai-cli-smoke.spec.js` — fill.check→fill.apply 完整链路 |

**当前状态：** 已有轻量单测 `src/aiCli/aiCliCommandService.test.ts`，通过 `node scripts/run-ts-test.mjs /src/aiCli/aiCliCommandService.test.ts` 运行；smoke 测试覆盖 20+ 断言。Playwright 脚本存在但缺配置文件。

---

## 7. 已识别技术债

| 优先级 | 项 | 影响 |
|--------|-----|------|
| P1 | `executeCommand` 仍是巨型函数 | 每加命令都在膨胀，后续可拆 handler/registry |
| P1 | `as never` 绕过类型 (`commandService`, `buffFill/validator`, `BuffDraftPage`) | 类型安全失效，重构时风险较高 |
| P1 | `readJsonStorage` 2 文件重复 | DRY 违反 |
| P1 | Vite SSR 作为 REST 开发服务入口 | 开发便利；若生产化应预构建 bundle |
| P2 | 无认证/无速率限制 | 若暴露到非本机网络会有安全风险 |
| P2 | 静态数据内联 | 可读性差 |

**近期已修复：**
- `fill.task` 已改为 `lines` 摘要 + `data` 结构化任务包；`web-cli` 自动补 `copyText`，REST 不重复返回。
- 空命令已返回 `[info] type help`。
- `GUARANTEED_READONLY_COMMANDS` 已补齐 `route`、`operator.show`、`fill.source`。
- `ALL_BUFF_STORAGE_KEYS` 已抽出，完整三键写入场景已复用。
- SSE 写入失败会清理断开的客户端。
- `summarizeAiCliCommand` 已对命令名前缀做 lowercase 匹配。
- AI CLI 已新增轻量单测。

**Task 11 收尾项（3 个小补丁，进入 Task 12 前完成）：**

| 优先级 | 项 | 位置 | 影响 |
|--------|-----|------|------|
| P2 | `AiAgentSession.context` 补 `pendingProposalId` | `aiCliAgentTypes.ts:67` | 与 spec 对齐，UI 可快速定位 pending proposal |
| P2 | `AiAgentSession.state` 类型化 `proposalId/approval/save` | `aiCliAgentTypes.ts:74` | 编译期防拼写错误，替代 `Record<string, unknown>` |
| P3 | `AiAgentProposal` 加 `summary?: string` | `aiCliAgentTypes.ts:18` | `proposal.list` 可展示人类可读摘要 |

---

## 8. Task 11 审查结论：Agent Proposal 审批/保存框架

**审查日期：** 2026-06-02

**结论：Task 11 通过。** TypeScript 核心层（类型 → 存储 → service → 状态机 → CLI → 日志 → 单测）已完整闭合。

### 属实项（25 项全部通过）

| 类别 | 检查点 |
|------|--------|
| 类型 | `AiAgentProposal` domain 支持 `buff/operator/weapon/equipment`，非 Buff 专用 |
| 类型 | `AiCliCommandResponse.proposal` 可选字段，透传 `id/domain/approval/save/nextAction` |
| 类型 | `AiAgentOperationLog` 含 `proposalId/approval/save` |
| 存储 | `def.ai-agent.proposals.v1` 作为 proposal 存储 key |
| Service | `createAgentProposal` / `readAgentProposals` / `readPendingAgentProposals` / `readPendingAgentProposal` |
| Service | `approveAgentProposal` 仅允许 `approval=Wait` |
| Service | `rejectAgentProposal` 仅允许 `approval=Wait`，自动设 `save=No` |
| Service | `markAgentProposalSaved` 仅允许 `approval=Yes && save=Wait` |
| Service | `markAgentProposalUnsaved` 仅允许 `approval=Yes && save=Wait` |
| 过滤 | `readPendingAgentProposals` 包含 `approval=Wait` 和 `approval=Yes && save=Wait`，排除已闭环 |
| CLI | `proposal.list` 命令已注册，对 readonly-agent 可读 |
| CLI | `agent.logs` 展示 approval/save 列 |
| CLI | `agent.sessions` 展示 approval/save 列 |
| 状态保持 | `runAiCliCommand` 写 session state 时，普通命令保留已有 proposalId/approval/save |
| 审计 | operation log 记录 proposalId/approval/save |
| 权限 | `proposal.list` 在 `KNOWN_COMMANDS`、`readonly-agent.allowedCommands`、`GUARANTEED_READONLY_COMMANDS` |
| 单测 | proposal 创建/持久化、pending 过滤、approve/reject/markSaved/markUnsaved、非法状态转移拒绝、session 状态保留 |
| 越界 | 未提前改 `fill.apply` 为 proposal-first（Task 12 边界） |
| 越界 | 未触碰 `now-storage` 作为 Agent CLI 写入机制 |
| 越界 | 未把 `ok:true` 解释成已保存 |

### 已知缺口（非阻断，Task 12 解决）

| 缺口 | 严重性 | 解决任务 |
|------|--------|---------|
| 缺 `proposal.approve/reject/save/unsave` CLI 命令 | Task 12 前置 | Task 12 |
| Web CLI 缺用户审批入口（Y/N 交互） | Task 12 前置 | Task 12 |
| `AiAgentSession.context` 缺 `pendingProposalId` | 低 | Task 11 收尾 |
| `session.state` 为 `Record<string, unknown>` 弱类型 | 低 | Task 11 收尾 |
| `AiAgentProposal` 缺 `summary` 字段 | 低 | Task 11 收尾 |
| REST smoke 未覆盖 `proposal.list` | 低 | Task 12 |
| `agent.guide` 未提 proposal 工作流 | 低（提前写会误导） | Task 12 后 |

### 关键设计约束（不可违反）

1. **审批权在用户，不在 agent。** Agent 创建 proposal。用户审批。保存再单独确认。REST 端点只能作为受控用户审批入口，不能让外部 agent 自行批准自己。
2. **`ok:true` ≠ 已保存。** 命令处理成功只表示请求被接受。外部 agent 必须检查 `proposal.approval` 和 `proposal.save` 状态。
3. **Proposal 不是 Buff 专用。** domain 覆盖 buff/operator/weapon/equipment，Task 13 的 Domain Adapter 在此基础上抽象。

---

## 9. 版本历史

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-06-02 | 1.0 | 初始框架，基于 def-1.5-agent 现状 |
| 2026-06-02 | 1.1 | 对齐当前实现：REST 状态策略、测试状态、已修复技术债、权限命令注册语义 |
| 2026-06-02 | 1.2 | Task 11 审查结论：Proposal 框架闭合确认 + 收尾项 + 设计约束 |
