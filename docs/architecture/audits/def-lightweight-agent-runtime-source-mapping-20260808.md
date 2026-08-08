# DEF 轻量 Agent Runtime 源码映射与移植方案

日期：2026-08-08

性质：源码级架构分析与迁移设计，不是 Spec，不是 Tasks，也不表示代码已经开始迁移

当前分支：`codex/v1.8-lts-desktop-shell`

当前实现基线：`cab90253`

Pi 参考基线：`earendil-works/pi-mono@e47b8e37a6211ebd0b2942fa87059d64f81eec02`

Pi 发布包基线：`@earendil-works/pi-agent-core@0.84.1`、`@earendil-works/pi-ai@0.84.1`、`@earendil-works/pi-coding-agent@0.84.1`

OpenCode UI 参考基线：`anomalyco/opencode@67aec2212010d67775c35e696d8b8b54902eb338`，对应 `v1.17.11`

历史前置方案：[OpenCode 引擎回迁与可替换 Agent 架构调研（归档）](../archive/opencode-engine-reintegration-research-20260806.md)

当前有效 UI 决策：[ADR-0008：AI 模式复用原生 OpenCode UI](../decisions/0008-native-opencode-ui.md)。该 ADR 在新 Runtime 和新会话 UI 真正完成迁移前继续约束生产代码；本分析不能提前宣布它失效。

## 0. 最终结论

本项目不应把完整 Pi SDK 作为新的长期运行时依赖，也不应只拿 `pi-agent-core` 替换 OpenCode。正确方案是：

1. 把 Pi SDK 当作经过真实使用和大量测试验证的参考实现；
2. 源码级移植其中的消息模型、流式事件、Agent loop、Session、恢复、压缩和必要重试；
3. 按 DEF 的单一模型供应商、外置 Harness、浏览器业务数据库和独立 UI 边界重写外围；
4. 保留 OpenCode 会话 UI 的视觉结构、工具顺序和状态表达，不保留 OpenCode 服务端、Session API 和 99 MB 级 Runtime；
5. 保留现有 DEF Host、Harness、审批、ProductGateway、命令回执与浏览器 SQLite 边界；
6. 让最终代码成为 DEF 自己拥有、可以独立维护和测试的轻量 Agent Runtime。

一句话概括：

> 以 Pi SDK 为 Agent 行为参考，以 OpenCode 为会话 UI 参考，以现有 DEF 为业务与安全外壳，派生一套不依赖两者运行时的 DEF 自有实现。

这条路线成立并不依赖当前已经存在 `AgentEngine` 接口。现有接口只会降低集成成本；目标 Runtime 的内部设计必须首先忠于正确的 Agent、Session 和上下文生命周期，不能被当前接口过早限制。

并行开工结论：不能把整份迁移平均切成几块后同时改。第一步必须由主 Agent 用 Sol xhigh 冻结共享合同、Trace Schema、目标文件清单和仓库边界；随后才允许 Luna Max 编码 subagent 在互不重叠的目录中并行实现 Pi Golden Oracle、Provider、Profile、Agent loop、Session Log 和 Conversation Store。后续 Context/Compaction、Tool Bridge、Runtime Session、UI Surface 和 UI Gateway 按依赖进入第二波并行，最终由主 Agent 独占共享入口和联调。完整派工设计见第 20 节。

## 1. “对着源码抄”的工程定义

这里的“抄”不是复制整个目录，也不是看到类名后自行想象一套相似实现。它包含四层要求。

| 层次 | 做法 | 验收证据 |
| --- | --- | --- |
| 行为 | 先写清消息、事件、Tool、Session、压缩和恢复的不变量 | 行为合同与状态机表 |
| 源码 | 对照固定提交中的具体文件和函数移植 | 来源台账、提交号与文件路径 |
| 裁剪 | 每删一个 Pi/OpenCode 能力，都记录为什么 DEF 不需要 | 保留/改写/舍弃矩阵 |
| 验证 | 同一组确定性输入同时跑参考实现与 DEF 实现 | 规范化 trace、Session 和上下文对比 |

采用以下三种移植等级：

| 等级 | 含义 | 使用场景 |
| --- | --- | --- |
| A：源码移植 | 保留上游核心控制流，只改类型、命名和依赖 | Agent loop、流事件组装、部分 Session/compaction 算法 |
| B：行为复刻 | 保留可观察行为，按 DEF 边界重新实现 | Provider、Tool bridge、Host adapter、会话存储目录 |
| C：设计借鉴 | 只保留数据模型或视觉语法 | OpenCode Message/Part、ToolState、会话 UI |

禁止以下做法：

- 直接复制 `pi-coding-agent` 全包后逐渐删除到“能编译”；
- 把 Pi SDK 加入生产依赖，再在外面包一层 DEF adapter；
- 把 OpenCode HTTP/SSE API 原样模拟成新的永久协议；
- 同时让 Pi/DEF/OpenCode 三份 Session 都成为上下文事实源；
- 为了追求少量代码而省略异常中断、Tool 配对、压缩边界和恢复测试；
- 把 Pi 尚未实现完成的 Durable `AgentHarness v2` 当成成熟底座。

## 2. 源码审计事实

### 2.1 Pi SDK 确实包含 Core，但完整 SDK 的重量主要在外围

依赖关系为：

```text
@earendil-works/pi-coding-agent
├── @earendil-works/pi-agent-core
│   └── @earendil-works/pi-ai
├── @earendil-works/pi-ai
├── pi-client / pi-protocol / pi-tui
├── 内置 read/bash/edit/write/grep/find/ls 工具
├── Extension / Skill / Prompt / Theme / Package Manager
└── Model/Auth/Export/Interactive 等外围能力
```

固定基线的源码量级：

| 范围 | TypeScript 行数 | 对本项目的判断 |
| --- | ---: | --- |
| `packages/ai/src` | 约 22,412 | 多供应商兼容层很重，只取统一消息协议和 OpenAI-compatible 路径 |
| `packages/agent/src` | 约 12,416 | 包含新的 Harness；成熟 `Agent + loop + types` 只有约 2,000 行 |
| `packages/coding-agent/src/core` | 约 28,653 | Session 能力成熟，但混入大量 CLI/TUI/插件/工具外围 |
| `AgentSession` | 3,342 | 不能整体复制，需拆出会话、压缩、重试和队列最小集 |
| `SessionManager` | 1,714 | 可作为 append-only JSONL、树与恢复的主要参考 |
| `compaction.ts` | 969 | 可作为压缩边界和摘要算法的主要参考 |

### 2.2 Pi 中真正可用的会话层

可用主线是：

- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/types.ts`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/src/core/compaction/compaction.ts`
- `packages/coding-agent/src/core/agent-session-runtime.ts`

这些代码已经提供：

- user / assistant / toolResult 消息；
- text / thinking / toolCall 流式增量；
- Agent、Turn、Message、Tool 生命周期事件；
- Tool 串行或并行执行；
- steering / follow-up 队列；
- abort 和 idle settlement；
- append-only JSONL Session；
- Session 恢复、树导航和 fork；
- 手动、阈值和 overflow compaction；
- transient retry；
- 动态 Tool 和 Extension hook。

### 2.3 Pi 新 Durable Harness 不能采用

`packages/agent/src/harness/agent-harness.ts` 的接口设计很完整，但当前提交仍在多处抛出 `HarnessNotImplemented`。它可以作为未来观察对象，不能进入本轮实现基线。

DEF 已经拥有更贴合产品的 Harness、审批、事务、ProductBinding 和浏览器命令回执。迁移 Pi Harness 既没有必要，也会制造第二套业务状态机。

### 2.4 OpenCode UI 的真正价值

OpenCode UI 的好用并不来自 OpenCode 服务端本身，而来自以下稳定组合：

- `Message`：user / assistant；
- `Part`：text / reasoning / tool / file / compaction 等；
- `ToolState`：pending / running / completed / error；
- `message.updated`、`message.part.updated`、`message.part.delta` 等增量事件；
- `SessionTurn` 对一轮 user + assistant + tool 的组合显示；
- `ToolRegistry` 对不同工具卡片的可替换渲染；
- 严格保持实际 Tool 调用顺序。

主要源码：

- `packages/schema/src/session-v1.ts`
- `packages/app/src/context/server-session.ts`
- `packages/session-ui/src/components/session-turn.tsx`
- `packages/session-ui/src/components/message-part.tsx`
- `packages/session-ui/src/styles/`

这些源码证明 UI 与 OpenCode 上下文并非不可分离；真正的耦合点是消息数据结构和事件协议。只要 DEF Runtime 投影出等价的会话视图，UI 就不需要知道模型上下文由谁持有。

## 3. 必须保留的产品约束

| 约束 | 新架构中的结果 |
| --- | --- |
| 前端基线 | Slim LTS React 工作台继续是唯一业务页面 |
| AI 入口 | 主界面 SVG 的 AI 模式仍是唯一产品入口；AI CLI 不恢复 |
| Electron | 继续只做 Shell、进程、密钥、发包与浏览器唤起，不承载业务数据库 |
| 业务数据 | 浏览器 SQLite WASM/OPFS 继续是唯一业务事实源 |
| Agent 数据 | 本地 Runtime 只保存对话、模型上下文和 Agent 自身元数据 |
| 业务写入 | 必须经过 DEF Harness、审批、ProductGateway 和浏览器命令回执 |
| MCP | Legacy Fill MCP 继续独立；不作为 Agent Runtime 的内置插件系统 |
| 模型 | 首版只实现当前产品需要的 OpenAI-compatible/DeepSeek 路径 |
| Web LTS | 普通线上 Web 不依赖 Agent Runtime 才能工作 |
| 离线 | 本地 Agent 不承诺断网推理；Web LTS 现有离线保护不被本轮修改 |
| CI/CD | 第一轮只做本地合同、对跑和桌面验收，不把 CI/CD 改造混入迁移 |
| 业务语义 | 不借 Agent 重构修改伤害公式、数据或 Harness 业务含义 |

## 4. 目标架构

```mermaid
flowchart LR
  Shell["Electron Shell"] --> Host["DEF Agent Host · 单 utility process"]
  Browser["Slim Workbench · React"] --> Overlay["AI 模式 Overlay"]
  Overlay --> View["OpenCode-derived Session Surface"]
  View <-->|"DEF Conversation API / SSE"| Host

  Host --> Runtime["DEF Lightweight Agent Runtime"]
  Runtime --> Provider["OpenAI-compatible Model Driver"]
  Provider --> DeepSeek["DeepSeek / configured provider"]

  Runtime <-->|"Tool request / result"| Harness["DEF Harness"]
  Harness --> Approval["Interaction / Approval"]
  Harness --> Gateway["Browser ProductGateway"]
  Gateway <-->|"command + durable receipt"| Browser
  Browser --> DB["Browser SQLite / OPFS"]

  Runtime --> ChatLog["Runtime Session JSONL"]
  Host --> Audit["DEF Session / Harness / Command audit"]
  Shell --> Profile["Provider Profile / API Key"]
```

核心变化：

- 不再启动 OpenCode binary；
- 不再让 OpenCode Session 保存模型上下文；
- 不再代理 OpenCode 全套私有 API；
- Agent loop、Provider 和会话恢复在同一个 DEF Agent Host utility process 内运行；
- UI 继续保持 OpenCode 的视觉和工具顺序，但只消费 DEF 自有会话协议；
- 业务工具仍由 DEF Host/Harness 控制，不直接交给模型运行时写产品数据。

## 5. 事实源与所有权

| 数据 | 唯一权威 | 其他层可以保存什么 |
| --- | --- | --- |
| 对话消息、Tool call/result、compaction | DEF Runtime Session Log | UI 缓存和 Host 审计投影，不得反向重建模型上下文 |
| 当前模型上下文 | DEF Runtime `ContextBuilder` | UI 只看到可展示消息，不拥有裁剪规则 |
| Timeline、Buff、配置、伤害结果 | 浏览器 SQLite/OPFS | Agent 只能通过 snapshot 和 command receipt 观察 |
| ProductBinding | DEF Session | Runtime 只接收每轮最新的只读上下文 |
| Harness phase/transaction | DEF Harness Store | Runtime 只看到当前 Tool projection |
| Approval/Question | DEF InteractionBroker | UI 只投影待处理项和用户决议 |
| 产品命令执行结果 | Product Command Store + 浏览器 receipt | Runtime 只接收规范化 Tool result |
| Provider 密钥 | Electron Shell 的 0600 profile | Runtime 按 profile ref 读取；浏览器永远拿不到密钥 |
| UI 展开、滚动、折叠状态 | 浏览器 UI | 不进入模型上下文 |

最重要的去重原则：

> DEF Runtime Session Log 是唯一对话事实源；DEF Host Event Journal 是业务审计，不是第二份模型历史。

## 6. 模块总映射

| 能力 | Pi / OpenCode 参考源码 | 当前 DEF 接缝 | 目标模块 | 移植等级 |
| --- | --- | --- | --- | --- |
| 统一消息类型 | `pi-ai/src/types.ts` | `engine.ts`、`json.ts` | `agent/runtime/kernel/messages.ts` | A/B |
| 流事件协议 | `pi-ai/src/types.ts`、`event-stream.ts` | `EngineEvent` | `agent/runtime/kernel/stream-events.ts` | A |
| Provider 接口 | `pi-ai` 的 `StreamFunction` | OpenCode runtime/profile | `agent/runtime/kernel/provider/model-driver.ts` | B |
| DeepSeek 流式实现 | `openai-completions.ts` | `OpenCodeProviderProfile` | `provider/openai-compatible-driver.ts` | B |
| Agent 状态 | `agent.ts` | `AgentEngine` session/turn | `runtime-session.ts` | A/B |
| Agent loop | `agent-loop.ts` | OpenCode adapter | `agent-loop.ts` | A |
| Tool 类型 | `agent/src/types.ts` | `EngineToolDescriptor` | `tool.ts` | B |
| Tool 执行桥 | Pi `AgentTool.execute()` | `submitToolResult*()` | `host-tool-bridge.ts` | B |
| 动态 Tool | Pi `agent.state.tools` | Harness projection revision | `tool-projection.ts` | B |
| Session JSONL | `session-manager.ts` | DEF Session Store | `session/session-log.ts` | A/B |
| 上下文重建 | `buildSessionContext()` | `systemContext` | `session/context-builder.ts` | A/B |
| Compaction | `compaction.ts` | `AgentEngine.compact?` | `session/compaction.ts` | A/B |
| Overflow 恢复 | `AgentSession._checkCompaction()` | OpenCode provider errors | `session/context-recovery.ts` | B |
| Retry | Pi retry helpers | OpenCode error projection | `provider/retry-policy.ts` | B |
| Abort/Idle | `Agent.abort()`、`waitForIdle()` | `EngineTurnHandle.abort()` | `run-controller.ts` | A/B |
| Session create/recover | `sdk.ts`、`AgentSessionRuntime` | `AgentEngine` | `def-runtime-adapter.ts` | B |
| DEF Session/Binding | 不采用 Pi 实现 | `session.ts`、`session-store.ts` | 保留现有 | 保留 |
| Harness/审批 | 不采用 Pi Harness | `manager.ts`、InteractionBroker | 保留现有 | 保留 |
| ProductGateway | 无对应 Pi 模块 | `remote-browser-product-gateway.ts` | 保留现有 | 保留 |
| UI Message/Part | OpenCode `session-v1.ts` | Native UI gateway | `agent/core/contracts/conversation.ts` | C/B |
| Conversation 投影 | OpenCode `server-session.ts` | OpenCode SSE proxy | `agent/host/conversation-projector.ts` | C/B |
| UI reducer | OpenCode `server-session.ts` | OpenCode SSE proxy | `src/agentSessionSurface/conversation-store.ts` | C/B |
| Turn/Tool 视图 | OpenCode `session-turn.tsx`、`message-part.tsx` | iframe | `src/agentSessionSurface/` | A/C |
| UI Gateway | 不保留 OpenCode API | `opencode-native-ui-gateway.ts` | `agent-ui-gateway.ts` | B |
| Shell 生命周期 | 无须抄 Pi | Electron Agent supervisor | 保留并换启动目标 | 保留/改写 |

## 7. 建议的目标目录

```text
agent/
├── core/                         # 现有 DEF 产品合同、Harness、Tool
│   └── contracts/
│       └── conversation.ts      # Runtime/Host/UI 共享的只读会话合同
├── host/                         # 现有 Host、ProductGateway、Interaction
│   ├── def-agent-host.ts
│   ├── conversation-projector.ts # 组合 Runtime transcript 与 Host audit
│   └── agent-ui-gateway.ts       # 替代 opencode-native-ui-gateway
├── runtime/
│   ├── NOTICE.md
│   ├── source-provenance.json
│   ├── host-entry.ts
│   └── kernel/
│       ├── ids.ts
│       ├── messages.ts
│       ├── stream-events.ts
│       ├── agent-loop.ts
│       ├── runtime-session.ts
│       ├── run-controller.ts
│       ├── tool.ts
│       ├── host-tool-bridge.ts
│       ├── tool-projection.ts
│       ├── provider/
│       │   ├── model-driver.ts
│       │   ├── openai-compatible-driver.ts
│       │   ├── sse-parser.ts
│       │   ├── provider-errors.ts
│       │   └── retry-policy.ts
│       └── session/
│           ├── entries.ts
│           ├── session-log.ts
│           ├── context-builder.ts
│           ├── compaction.ts
│           └── context-recovery.ts
├── engines/
│   ├── def-runtime/
│   │   ├── adapter.ts
│   │   └── profile.ts
│   └── opencode/                 # 迁移完成后删除

src/
└── agentSessionSurface/          # OpenCode-derived、独立 Vite UI 入口
    ├── index.html
    ├── main.tsx
    ├── conversation-store.ts
    ├── components/
    └── styles/
```

目标代码不使用 `pi` 命名空间。来源写在 provenance/NOTICE 中，产品 API 使用 DEF 自己的术语，避免未来错误地把上游内部 API 当成兼容承诺。

## 8. 各模块具体移植方法

### 8.1 消息模型

参考：

- Pi `packages/ai/src/types.ts`
- Pi `packages/agent/src/types.ts`
- OpenCode `packages/schema/src/session-v1.ts`

保留的最小消息：

```ts
type RuntimeMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CompactionSummaryMessage;

type AssistantContent =
  | TextBlock
  | ThinkingBlock
  | ToolCallBlock;
```

必须保留：

- 每条消息稳定 ID、timestamp 和 role；
- assistant 内容块原始顺序；
- Tool call 的稳定 ID、name 和结构化 arguments；
- Tool result 对应 `toolCallId`；
- assistant 的 stop reason、usage 和可安全展示的错误；
- text 与 thinking 分开，不能把思考混入最终正文；
- 附件只接受当前 `EngineUserAttachment` 已允许的 bounded data URL。

按 DEF 修改：

- 不带 Pi 的 CLI custom/bash message；
- 不带 OpenCode 的 patch/snapshot/subtask/todo 等编码 Agent 专属 part；
- JSON Schema 继续使用当前 `JsonObject` 合同，不引入 TypeBox；
- Provider 原始字段只存入有界 diagnostics，不进入 UI 和业务审计；
- 动态 Workbench 上下文不伪装成历史 user message。

### 8.2 流式事件

参考 Pi 的 `AssistantMessageEvent` 与 `AgentEvent`，保留以下两层事件。

Provider 层：

```text
response.start
text.start / text.delta / text.end
thinking.start / thinking.delta / thinking.end
tool-call.start / tool-call.delta / tool-call.end
response.done / response.error
```

Runtime 层：

```text
run.start / run.end
turn.start / turn.end
message.start / message.update / message.end
tool.start / tool.update / tool.end
compaction.start / compaction.end
retry.scheduled / retry.end
```

不直接把 Provider chunk 发给 UI。Provider 先组装为合法的 partial assistant message，Runtime 再发稳定事件，避免供应商字段污染 UI。

### 8.3 OpenAI-compatible / DeepSeek Model Driver

参考：

- Pi `packages/ai/src/api/openai-completions.ts`
- Pi `packages/ai/src/utils/event-stream.ts`
- Pi `packages/ai/src/utils/json-parse.ts`
- Pi provider retry/error helpers

首版只实现：

- OpenAI-compatible Chat Completions；
- configurable `baseUrl`、`modelId`、`apiKey`；
- text delta；
- DeepSeek/OpenAI-compatible reasoning delta；
- streamed tool call name 与 arguments；
- usage、finish reason 与响应 ID；
- auth、rate limit、server error、network drop、abort；
- 有界重试和用户可读错误映射。

明确舍弃：

- Anthropic、Gemini、Bedrock、Mistral、Vertex；
- OAuth 与模型目录；
- OpenRouter/Copilot 特殊头；
- 图片模型；
- prompt cache 的多供应商特例；
- telemetry；
- OpenAI Responses/Codex 专用协议，除非后续有明确需求。

实现建议：

- 使用 Node/Electron 已有 `fetch` 与自有 bounded SSE parser；
- 不引入完整 `openai` npm SDK；
- SSE parser 必须覆盖任意字节切分、跨 chunk UTF-8、多个 data 行、空行终止和 `[DONE]`；
- Tool arguments 使用增量字符串累积，结束时做严格 JSON 解析；失败不得执行半截参数；
- API Key 只由 profile source 注入，不进入错误、Session 或 trace fixture。

### 8.4 Agent loop

主要参考：Pi `packages/agent/src/agent-loop.ts`。

可直接保留的控制流：

```text
接收 user prompt
→ run.start
→ turn.start
→ 持久化 user message
→ 调用 model driver
→ 流式形成 assistant message
→ 若无 Tool：turn.end → run.end
→ 若有 Tool：按 assistant 内容顺序执行/等待 Tool result
→ 持久化 toolResult
→ 以新上下文进入下一 Turn
→ 直到模型停止或外部 abort
```

必须保留的不变量：

1. assistant message 完成后才能把其中 Tool call 交给执行层；
2. Tool result 必须与 call ID 一一配对；
3. 截断的 Tool arguments 不得执行；
4. Tool result 进入 Session 后，模型才能开始下一轮；
5. abort 后不得再接受晚到 Tool result 推进模型；
6. `run.end` 必须等待 message/session listener 完成，避免 UI 已显示完成但日志未落盘；
7. assistant 内容和 Tool result 的展示顺序可确定重放。

按 DEF 简化：

- 第一版只允许一个 active run；Host 已有 turn serialization；
- 第一版 Tool 执行按顺序等待，避免当前 Harness 被并行 mutation 破坏；
- steering/follow-up 不进入首个切换里程碑，可在核心稳定后按 Pi 队列语义增加；
- 不执行 Pi 内置 read/bash/edit/write；所有 Tool 都是 Host bridge；
- `prepareNextTurn` 只负责更新 Tool projection、system context 和 stop decision。

### 8.5 Tool Bridge 与动态投影

参考：

- Pi `AgentTool.execute()` 与 `tool_execution_*` 事件；
- 当前 `EngineTurnHandle.submitToolResult()`；
- 当前 `submitToolResultAndUpdateProjection()`；
- 当前 Harness revision 和 phase Tool projection。

目标流程：

```text
模型产生 ToolCall
→ Runtime 校验 name / arguments / 当前 projection revision
→ HostToolBridge 发出 engine tool.requested
→ DEF Host/Harness 决定 read/propose/mutate/interaction
→ Browser ProductGateway 执行或等待用户审批
→ Host 提交规范化 ToolResult
→ 同一临界区更新下一 phase 的 Tool projection
→ Bridge resolve
→ Runtime 追加 ToolResultMessage
→ Agent loop 进入下一 Turn
```

禁止：

- Runtime 直接访问浏览器数据库；
- Runtime 自己实现 Harness routing；
- Provider 看见未被当前 phase 投影的全部工具；
- Tool result 先 resolve、projection 后更新；
- UI 按工具名猜测成功，必须以真实 result 为准。

### 8.6 Runtime Session Log

主要参考：Pi `packages/coding-agent/src/core/session-manager.ts`。

首版采用 append-only JSONL，每个 DEF Session 对应一个 Runtime Session。建议 entry：

```text
header
message
model_change
thinking_change
compaction
run_marker
```

Header 至少包含：

- schema version；
- runtime session ID；
- 对应 DEF Session ID；
- created time；updated time 由最后一条有效 entry 推导，避免回写 append-only Header；
- provider profile ref，不含密钥；
- 来源 Runtime version。

当前 leaf/last entry 同样由最后一条有效 entry 及 parent 链推导，不回写 Header。

每个 entry 至少包含：

- stable entry ID；
- parent entry ID；
- timestamp；
- type；
- bounded payload。

保留 `parentId` 的原因是成本很低，并能让未来 fork/回退不必更换磁盘格式；首版 UI 不提供树导航。

恢复规则：

1. Header 与 schema 必须先验证；
2. 不完整的最后一行可以安全截断；
3. 中间行损坏则 Session 标记 incompatible，不猜测修复；
4. user/assistant/toolResult 配对必须验证；
5. 未完成 run 在重启后标记 interrupted；
6. Runtime 恢复对话，DEF Host 负责恢复/对账业务命令；
7. 恢复不得重放已经执行过的产品 mutation。

### 8.7 Context Builder

参考 Pi `SessionManager.buildSessionContext()`，但按 DEF 分成三类上下文：

| 上下文 | 来源 | 是否持久化进对话 |
| --- | --- | --- |
| 稳定 Agent 指令 | DEF Runtime 版本化模板 | 只记录模板版本，不重复写消息 |
| 对话历史 | Runtime Session Log + compaction | 是，唯一模型历史 |
| 当前产品上下文 | DEF ProductBinding、最新 snapshot、Harness phase | 否，每轮即时注入 |

这样解决两个旧问题：

- UI 刷新不会丢对话，因为 Session Log 与 UI 无关；
- Timeline/Buff/节点变化不会被旧历史快照永久污染，因为当前产品上下文每轮重取。

构建顺序：

```text
稳定 system prompt
+ 当前 DEF/Harness 指令
+ 当前 ProductBinding 与有界 snapshot
+ 最新 compaction summary
+ summary 之后保留的完整消息
```

未解决的 Question、Approval、Tool call/result 对不得跨压缩边界拆开。

### 8.8 Compaction

主要参考：Pi `packages/coding-agent/src/core/compaction/compaction.ts` 与 `AgentSession` 的阈值/overflow 处理。

保留：

- token/window 阈值检查；
- 手动 compaction；
- threshold compaction；
- context overflow 后 compact-and-retry 一次；
- summary entry 与 `firstKeptEntryId`；
- 压缩后重建 Agent state；
- compaction start/end 事件；
- 摘要失败不破坏原 Session。

DEF 摘要模板至少保留：

- 用户当前目标；
- 已确认事实和约束；
- 已完成步骤；
- 未完成步骤；
- 关键 Tool 结果；
- 用户明确的偏好和否定项；
- 需要延续的错误或阻塞；
- 与当前 Workbench 相关的稳定业务结论。

不得把以下内容只留在 summary：

- 未决 Approval/Question；
- 未配对 Tool call/result；
- 产品写入的唯一 receipt；
- API Key 或 Provider 原始请求；
- 可以从当前 ProductGateway 重新读取的巨大 snapshot。

### 8.9 Retry、错误与 Abort

参考 Pi 的 Provider retry、AgentSession auto-retry 和 overflow recovery，按 DEF 缩减为：

| 情况 | 行为 |
| --- | --- |
| 401/403 | 不自动重试；提示在 Shell 更新 API Key |
| 400/schema | 不自动重试；保存有界诊断 |
| 408/429/5xx/network drop | 指数退避、有上限、有 jitter，可 abort |
| context overflow | compaction 后只重试一次 |
| malformed Tool args | 生成 Tool error result，让模型决定是否重发 |
| unknown/stale Tool | 生成投影错误，不执行产品命令 |
| browser consumer lost | Host abort active run，进入可恢复 terminal |
| user stop | 取消 Provider、Tool wait、retry timer 和 compaction |

所有错误必须经过当前产品错误映射，不能把密钥、请求头、完整响应体或本机路径显示到浏览器。

### 8.10 Runtime Session Facade

不复制 Pi 完整 `AgentSession` API。目标只提供产品需要的最小接口：

```ts
interface DefRuntimeSession {
  readonly id: RuntimeSessionId;
  readTranscript(): Promise<RuntimeTranscriptSnapshot>;
  subscribe(listener: RuntimeEventListener): () => void;
  start(input: RuntimeRunInput): Promise<RuntimeRunHandle>;
  compact(reason: CompactionReason): Promise<CompactionOutcome>;
  abort(reason: RuntimeAbortReason): Promise<RuntimeTerminal>;
  waitForIdle(): Promise<void>;
  close(): Promise<void>;
}
```

不进入首版的 Pi 能力：

- model cycling；
- theme 和 TUI binding；
- extension reload；
- slash commands；
- built-in bash；
- HTML/JSONL 用户导出；
- package/skill discovery；
- branch navigation UI；
- sub-agent runtime。

### 8.11 AgentEngine 适配

目标 Kernel 不围绕当前 `AgentEngine` 反向设计。完成 Kernel 后，由 `agent/engines/def-runtime/adapter.ts` 把它适配到现有：

- `probe()`；
- `createSession()`；
- `recoverSession()`；
- `startTurn()`；
- `compact()`；
- `disposeSession()`；
- `shutdown()`。

当前 `EngineEvent` 适合 Host 控制流，但不足以承载完整 UI。不要把 OpenCode `Message/Part` 塞进 `EngineEvent`。新增 Runtime transcript 合同，并由 Host 的 ConversationProjector 组合 Runtime transcript 与 Host audit：

```ts
interface RuntimeTranscriptSource {
  getRuntimeSnapshot(session: EngineSessionRef): Promise<RuntimeTranscriptSnapshot>;
  subscribeRuntime(
    session: EngineSessionRef,
    afterRuntimeSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<RuntimeTranscriptEvent>;
}

interface ConversationProjector {
  getSnapshot(session: DefSessionId): Promise<ConversationSnapshot>;
  subscribe(
    session: DefSessionId,
    cursor: ConversationCursor,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationEvent>;
}
```

这样：

- Host 的业务事件不被 UI 细节污染；
- UI 不直接读取 Runtime 内部 JSONL；
- 将来再换模型内核时，只需投影同一 Conversation 协议；
- Runtime Session 仍是对话事实源；
- Interaction、审批和业务 Tool 状态仍由 Host Journal 持有；
- ConversationProjector 只在读取时组合两份权威数据，不新增第三份永久日志。

### 8.12 DEF Host、Harness 与 ProductGateway

以下模块不从 Pi/OpenCode 重写：

- `agent/core/harness/manager.ts`
- `agent/core/tools/**`
- `agent/core/interactions/**`
- `agent/host/def-agent-host.ts`
- `agent/host/session-store.ts`
- `agent/host/product-command-store.ts`
- `agent/host/remote-browser-product-gateway.ts`
- `agent/host/browser-consumer-registry.ts`

只做必要适配：

- Engine kind/runtime version 改为 DEF Runtime；
- Session recovery 指向 Runtime JSONL；
- Runtime transcript 与 Host audit 分离；
- Tool lifecycle 增加 UI 可见状态投影；
- Provider profile 更新不再重启 OpenCode 子进程；
- 继续保留 accepted client turn 去重、Harness transaction 和 command reconciliation。

### 8.13 Conversation 协议

借鉴 OpenCode schema，但使用 DEF 名称：

```ts
type ConversationPart =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | { type: 'tool'; id: string; callId: string; name: string; state: ToolViewState }
  | { type: 'interaction'; id: string; interactionId: string; state: InteractionViewState }
  | { type: 'compaction'; id: string; state: 'running' | 'completed' | 'error' };

type ToolViewState =
  | { status: 'pending'; input: JsonObject }
  | { status: 'running'; input: JsonObject; startedAt: string; detail?: JsonValue }
  | { status: 'completed'; input: JsonObject; output: JsonValue; endedAt: string }
  | { status: 'error'; input: JsonObject; code: string; message: string; endedAt: string };
```

Conversation event：

```text
conversation.snapshot
message.upsert / message.remove
part.upsert / part.delta / part.remove
session.status
interaction.upsert / interaction.remove
```

Conversation 不伪造一个跨两份日志的永久全局序号。游标使用：

```ts
interface ConversationCursor {
  epoch: string;
  runtimeSequence: number;
  hostSequence: number;
}
```

其中：

- `runtimeSequence` 只推进 Runtime transcript；
- `hostSequence` 只推进 DEF Host Journal；
- `epoch` 标识当前 projector/gateway 实例；Host 重启、投影规则变化或任一日志无法补齐时必须换 epoch；
- epoch 不匹配时 UI 丢弃增量游标并重新获取 Snapshot；
- Snapshot 由 Runtime Log 与 Host Journal 即时组合，不写回第三份 Conversation 日志。

每个事件带：

- session ID；
- event source；
- 对应 source sequence；
- 应用事件后的复合 cursor；
- message/part stable ID；
- occurredAt；
- bounded payload。

UI 首次打开先取 Snapshot，再从 Snapshot cursor 订阅 SSE。断线后提交完整 cursor 补齐；不能只用单个 `Last-Event-ID` 猜测两份日志的位置。

HTTP 层把复合 cursor 编码为有界、版本化的不透明 token，可放在显式 query/header 或 `Last-Event-ID` 中；Gateway 必须完整校验后再解码，不能接受浏览器直接拼接的任意 sequence。

Snapshot 必须先分别捕获 Runtime/Host 的 high-water mark，再只读取到这两个边界，并把边界写入返回 cursor；随后订阅必须重放严格大于各自 high-water mark 的事件。任一来源无法保证这条 snapshot-to-subscribe 连续性时，Projector 必须返回 gap/epoch-changed，要求 UI 全量重取，不能静默跳过。

两份来源不按 wall-clock timestamp 强行排序。跨来源因果关系使用 `messageId`、`toolCallId`、`interactionId` 和 Turn correlation 合并：Runtime 先创建 Tool part，Host 再更新该 part 的 running/interaction/result 状态。若增量引用的父对象尚不存在，projector 只允许有界等待或要求重新取 Snapshot，不能凭时间猜顺序。

### 8.14 Pi Runtime 事件到 UI Part 的对应关系

| Runtime/Host 事件 | Conversation 投影 | OpenCode 视觉语义 |
| --- | --- | --- |
| user `message.start/end` | user message + text part | 用户气泡 |
| assistant `message.start` | assistant message | 新 Turn 开始 |
| `text.start/delta/end` | text part upsert/delta | 流式正文 |
| `thinking.start/delta/end` | reasoning part upsert/delta | 可折叠思考 |
| `tool-call.start` | tool part pending | 工具已生成 |
| Host 接受 Tool | tool part running | 工具执行中 |
| Tool update | tool part running detail | 进度/标题更新 |
| Tool success | tool part completed | 完成卡片 |
| Tool failure | tool part error | 错误卡片 |
| `interaction.requested` | interaction part pending | Question/Approval 卡片 |
| `interaction.resolved` | interaction update/remove | 已回答/批准/拒绝 |
| compaction start/end | compaction part | 上下文压缩提示 |
| run terminal | session status idle/error | 输入框与待命状态 |

Tool 顺序以 assistant content 中的 call 顺序为准，不以异步完成时间重新排序。

### 8.15 OpenCode-derived Session Surface

目标不是继续运行完整 OpenCode App，也不是重新设计聊天 UI。建议从锁定的 `v1.17.11` 提取一个独立小型会话视图：

保留：

- `SessionTurn` 的一轮布局；
- user/assistant 消息层次；
- text、reasoning、generic tool、error、compaction；
- Tool accordion、状态标题、输入输出区；
- 自动滚动和用户主动滚动保护；
- copy、stop、retry 等当前需要的操作；
- 原 OpenCode data-slot、间距、字体和颜色结构；
- DEF 主题变量接入。

删除：

- OpenCode workspace/project/file browser；
- terminal、LSP、formatter、VCS、worktree；
- provider/model 管理页；
- todo/task/sub-agent UI；
- OpenCode permission/question API 客户端；
- OpenCode 全局 sync、session cache 和 SDK client；
- 与编码文件 diff 无关的专用 renderer。

推荐形态：

- 保留一个独立、很小的会话 UI bundle，由 `AgentModeOverlay` 继续 iframe 宿主；
- 直接派生 OpenCode 的会话组件和 CSS，避免重新发明视觉；
- 用 `DefConversationStore` 替代 OpenCode `createServerSession(client)`；
- 使用 DEF Conversation API，而不是模拟 `/session`、`/global/event` 等 OpenCode API；
- 只复制实际使用的 UI primitive，不能把整个 `@opencode-ai/ui` 工作区带入。

这一选择兼顾三件事：

1. 主 React 工作台不引入另一套复杂状态；
2. 原 OpenCode UI 视觉和 Tool 顺序得以保留；
3. OpenCode 服务端与完整前端应用可以一起退役。

### 8.16 Agent UI Gateway

`agent/host/opencode-native-ui-gateway.ts` 当前约 1,957 行，主要成本来自：

- 静态宿主完整 OpenCode UI；
- 转发 OpenCode 大量 read API；
- 拦截 session/prompt/archive/delete；
- 代理并清洗 OpenCode SSE；
- 注入 DEF permission/question；
- 维护 optimistic message reconciliation。

目标 `agent-ui-gateway.ts` 只负责：

- 验证短期 launch grant 和当前 Browser consumer；
- 服务小型 Session Surface 静态文件；
- Session list/create/archive/delete；
- prompt/stop/retry；
- transcript snapshot + SSE；
- Question/Approval 决议；
- bounded diagnostics。

它不再做代理，因此协议和代码都可以大幅缩小。

### 8.17 Electron、进程与打包

目标进程：

```text
Electron main
├── Shell window
├── 静态 Host / browser launcher
├── Legacy Fill MCP utility process
└── DEF Agent Host utility process
    ├── DEF Runtime Kernel
    ├── Harness / ProductGateway
    └── Agent UI Gateway
```

不再存在：

- OpenCode child process；
- OpenCode 私有端口和密码；
- OpenCode binary 下载/校验；
- 完整 OpenCode UI asset tree；
- OpenCode provider config 生成；
- OpenCode plugin/private bridge。

迁移结束后删除或替换：

- `scripts/prepare-opencode-runtime.mjs`；
- `scripts/verify-opencode-runtime.mjs`；
- `scripts/prepare-opencode-ui.mjs`；
- `agent/engines/opencode/runtime-lock.json`；
- `agent/engines/opencode/native-ui-lock.json`；
- OpenCode runtime/package smoke 断言。

保留“未完成前不删除”的顺序：新 Runtime、UI、测试和手测全部通过以后，才移除旧 runtime 和 gateway，确保可以按 feature flag 回退。

## 9. 当前文件逐项处理总账

| 当前文件/目录 | 处理 | 原因 |
| --- | --- | --- |
| `agent/core/contracts/engine.ts` | 保留并小幅扩展 | 继续作为 Host 控制接口，不承载 UI 全量消息 |
| `agent/core/contracts/events.ts` | 保留 | 业务审计事实，不作为模型上下文 |
| `agent/core/contracts/session.ts` | 保留 | DEF Session/ProductBinding 与 Runtime Session 分离 |
| `agent/core/harness/**` | 保留 | 已有产品业务状态机，不能换成 Pi Harness |
| `agent/core/tools/**` | 保留 | DEF typed business tools |
| `agent/host/def-agent-host.ts` | 保留并适配 | 继续管理 Harness、互动和业务生命周期 |
| `agent/host/session-store.ts` | 保留 | 保存 DEF metadata/audit/harness transaction |
| `agent/host/product-command-store.ts` | 保留 | 产品 mutation 去重与恢复依据 |
| `agent/host/remote-browser-product-gateway.ts` | 保留 | 浏览器 SQLite 唯一写入口 |
| `agent/host/opencode-native-ui-gateway.ts` | 由 `agent-ui-gateway.ts` 替换 | 不再代理 OpenCode API/SSE |
| `agent/engines/opencode/adapter.ts` | 由 DEF Runtime adapter 替换 | OpenCode 不再是模型引擎 |
| `agent/engines/opencode/runtime.ts` | 删除 | 不再启动 binary/server |
| `agent/engines/opencode/profile.ts` | 泛化后迁移 | profile 安全规则仍有效，名称不能继续绑定 OpenCode |
| `agent/engines/opencode/tool-bindings.ts` | 逻辑迁入 HostToolBridge | Tool call/result 映射仍需要 |
| `agent/engines/opencode/plugin-entry.ts` | 删除 | 不再有 OpenCode plugin |
| `agent/engines/opencode/private-bridge.ts` | 删除 | 不再有 OpenCode private bridge |
| `agent/runtime/host-entry.ts` | 修改组装目标 | 实例化 DEF Runtime adapter 和新 UI gateway |
| `src/components/AgentMode/AgentModeOverlay.tsx` | 保留并换 launch target | 主工作台 AI 模式和 iframe 宿主继续存在 |
| `src/platform/agent/desktopAgentBridge.ts` | 保留并改协议命名 | 浏览器仍通过 Shell/Host 窄桥进入 AI 模式 |
| `electron/agent-runtime.cjs` 等 supervisor | 保留并简化 | 继续管理一个 Agent utility process，不再管 OpenCode child |
| OpenCode contract/blackbox tests | 先保留，后迁移为 Runtime conformance | 迁移完成前提供回退证据 |
| OpenCode UI lock | 最终删除 | 新 Session Surface 使用独立来源台账和 bundle lock |

## 10. 依赖和体量目标

### 10.1 不进入生产依赖

- `@earendil-works/pi-coding-agent`；
- `@earendil-works/pi-agent-core`；
- `@earendil-works/pi-ai`；
- `@opencode-ai/*`；
- `openai` 全量 SDK；
- Pi TUI/client/protocol；
- TypeBox/YAML/diff/ignore 等只因 Pi 外围引入的包；
- OpenCode binary。

### 10.2 可以新增的最小依赖

优先使用 Node/Electron 内建能力和当前项目已有依赖。只有在源码和测试证明自写会明显降低正确性时，才允许引入：

- 一个小型、浏览器端可 tree-shake 的 UI primitive；
- Solid runtime，仅当直接保留 OpenCode Session Surface 比 React 机械移植更小、更可靠；
- 独立 JSON Schema validator，仅当现有 Tool schema 验证无法复用。

是否保留 Solid 由 UI 原型的产物体积和视觉对比决定，不在本文凭偏好预判。

### 10.3 代码量预估

| 模块 | 预估生产代码 |
| --- | ---: |
| 消息、事件与基础类型 | 500–900 行 |
| OpenAI-compatible Provider + SSE | 900–1,600 行 |
| Agent loop + controller | 1,200–2,000 行 |
| Tool bridge/projection | 500–900 行 |
| Session/context/compaction | 1,800–3,000 行 |
| Engine adapter/profile | 500–900 行 |
| Conversation protocol/store/gateway | 1,000–1,800 行 |
| 合计 | 约 6,400–11,100 行 |

这是架构预算，不是以少写行为优先的硬指标。任何为了压行数而删掉恢复、错误或 Tool 配对验证的实现都不合格。

## 11. 对称验证方案

### 11.1 参考实现对跑

固定 Pi `0.84.1/e47b8e37`，使用确定性 fake provider 和 fake tools。相同输入分别进入：

1. Pi `AgentSession` 参考 runner；
2. DEF Lightweight Runtime。

规范化后对比：

- message role/content block；
- text/reasoning delta 顺序；
- Tool call ID、name、arguments；
- Tool result 配对和顺序；
- Turn/run terminal；
- Session 恢复后的模型上下文；
- compaction summary 边界和保留尾部；
- abort/retry 后是否仍有晚到事件。

允许归一化：

- 随机 ID；
- timestamp；
- Runtime 名称；
- DEF 特有 Host/Harness 审计事件。

不允许归一化：

- 消息顺序；
- Tool 参数和结果；
- stop reason；
- 压缩后模型可见内容；
- terminal 状态。

参考 runner 不进入产品包。可以用临时 clone 或专用开发目录生成 golden trace；仓库只保存可复核 fixture、来源提交和派生测试。

### 11.2 Provider 测试矩阵

| 场景 | 必须验证 |
| --- | --- |
| 纯文本 | start/delta/end、usage、stop |
| reasoning + text | 两种 part 不串线，顺序稳定 |
| 单 Tool | name/args 累积、result 回传、下一 Turn |
| 多 Tool | call 顺序稳定；首版按序等待 |
| 任意 chunk 边界 | UTF-8、JSON、SSE 均可跨 chunk |
| arguments 截断 | 不执行，返回明确错误 |
| 401/403 | 不重试，不泄密，提示 Shell 配置 |
| 429/5xx | 有界退避，可停止 |
| 网络中断 | 已落盘消息保持一致，不重复执行 Tool |
| abort | provider stream、timer、Tool wait 全部终止 |
| context overflow | compact 一次、retry 一次、不会无限循环 |

### 11.3 Session 测试矩阵

- 新建、追加、关闭、恢复；
- incomplete tail 截断；
- 中间损坏拒绝；
- 未完成 run 重启；
- user/assistant/toolResult 配对；
- compaction 前后 `buildContext()`；
- 当前产品上下文更新但历史不被篡改；
- archive/delete 与 Runtime 文件清理；
- provider profile ref 变化；
- accepted client turn 去重；
- 不重放已完成产品命令。

### 11.4 UI 测试矩阵

- snapshot + SSE 接续不重复；
- text/reasoning/tool 严格按顺序；
- pending/running/completed/error 状态；
- Question/Approval；
- 刷新恢复完整历史；
- 长会话分页或虚拟化；
- 自动滚动不抢用户滚动；
- stop/retry；
- 主题变量只改颜色，不改变布局尺寸；
- 与 OpenCode v1.17.11 基准截图做视觉对比。

### 11.5 产品黑盒

继续使用 [DEF Agent 黑盒测试](../../testing/def-agent-blackbox.md) 和 `DefCodexInteropProtocol v1`。至少覆盖：

- 浏览器 SVG 入口在 Shell 未预开时可以启动完整 AI 模式；
- Session 新建、恢复、归档、删除；
- 多轮追问保留上下文；
- 只读 Tool；
- mutation → Work Node/审批 → Product command → visible postcondition；
- Question 回答后继续原任务；
- stop、刷新、Host 重启、浏览器 consumer 丢失；
- Provider 密钥错误后的 Shell 修复与重试；
- 一次完整 Harness 归档案例。

## 12. 迁移顺序

### M0：文档与来源冻结

- 归档旧 OpenCode-first 调研；
- 固定 Pi/OpenCode commit；
- 建立来源台账和 MIT NOTICE；
- 把模块、能力和测试映射冻结为本报告。

完成标志：任何准备移植的代码都能指出上游文件、目标文件和验证方法。

### M1：协议与 Golden Trace

- 定义 Runtime messages/events/session entries；
- 编写 Pi reference runner；
- 生成 text/reasoning/tool/error/abort/compaction fixtures；
- 建立规范化 trace comparator。

完成标志：尚未接产品，但“应该抄成什么行为”可以自动判定。

### M2：Provider 与 Agent loop

- 实现 SSE parser；
- 实现 OpenAI-compatible driver；
- 移植 Agent loop；
- 实现 fake Tool bridge；
- 完成与 Pi 的确定性对跑。

完成标志：纯内存 Runtime 可完成多轮 text/reasoning/tool loop。

### M3：Session、恢复与 Compaction

- 实现 Runtime JSONL；
- context builder；
- threshold/overflow compaction；
- restart、tail corruption、abort/retry 测试。

完成标志：不依赖 UI/Host 也能恢复同一上下文继续运行。

### M4：DEF Engine Adapter

- 包装 Kernel 为 `AgentEngine`；
- 接入 profile；
- 接 HostToolBridge 和动态 projection；
- 复用现有 Host/Harness 黑盒；
- 通过 feature flag 与 OpenCode adapter 并存。

完成标志：真实 Harness 场景可在不启动 OpenCode 的情况下通过。

### M5：Conversation 协议与 Session Surface

- 实现 transcript source、snapshot/SSE；
- 派生 OpenCode SessionTurn/MessagePart UI；
- 接入 DEF theme；
- 替换 iframe launch target；
- 做截图、交互和 Computer Use 验收。

完成标志：用户看到的 Tool 顺序、会话信息密度和基础交互不低于旧 OpenCode UI。

### M6：完整生命周期与切换

- 多轮真实模型；
- 刷新/重启/归档/删除；
- Provider 更新；
- Work Node/审批/命令回执；
- Mac 和 Windows 手测；
- 长会话性能。

完成标志：默认引擎切到 DEF Runtime，仍可通过 flag 回退 OpenCode。

### M7：退役 OpenCode

- 删除 binary、runtime supervisor、plugin/private bridge；
- 删除完整 OpenCode UI 和 proxy gateway；
- 删除 prepare/verify scripts 与 locks；
- 更新打包、边界检查、ADR 和事实源；
- 移除回退 flag。

完成标志：发布包、进程列表、端口和源码均不再依赖 OpenCode Runtime。

## 13. 回滚策略

在 M6 验收前保留：

- OpenCode adapter；
- OpenCode runtime/UI locks；
- 当前 native UI gateway；
- 当前 OpenCode blackbox；
- `DEF_AGENT_ENGINE=opencode|def-runtime` 开发期开关。

Session 不做双写转换。测试期两套 Engine 使用独立 storage root；用户切换引擎时创建对应 Engine Session，DEF Session 只记录当前 ref。正式切换前提供一次明确迁移或重新建会话策略，不能让两套 Runtime 同时写同一个 transcript。

发生以下任一情况必须回退而不是勉强发布：

- 多轮上下文在刷新后变化；
- Tool call/result 配对错误；
- 产品 mutation 可能重复执行；
- compaction 后遗漏未完成任务；
- UI Tool 顺序或状态不可信；
- Provider 错误泄露密钥；
- Mac/Windows 任一平台无法从浏览器入口启动 AI 模式。

## 14. 风险与控制

| 风险 | 严重度 | 控制 |
| --- | --- | --- |
| 抄成“长得像”而非行为等价 | 高 | Pi reference runner + golden trace |
| OpenAI-compatible 边角协议复杂 | 高 | 从 Pi 测试迁移 chunk/tool/reasoning/error 用例 |
| Session/compaction 自研出错 | 高 | append-only、不可变 entry、恢复/损坏/overflow 对跑 |
| Tool bridge 死锁或晚结果推进 | 高 | 单 active run、abort token、原子 result+projection |
| 对话与 Host audit 双事实源 | 高 | Runtime transcript 唯一权威，Host 只审计 |
| UI 抽取后再次变成自研低质量 UI | 高 | 直接派生 OpenCode DOM/CSS/ToolState，截图对比 |
| 上游修复无法自动获得 | 中 | 固定来源台账，定期 diff 上游 release，不追 main |
| Pi 包名/架构继续变化 | 中 | 不依赖包名；只以固定 commit 为参考 |
| 许可证遗漏 | 中 | MIT NOTICE、源码头、来源清单和派生测试标注 |
| 迁移范围扩大到业务重写 | 高 | Harness/ProductGateway/公式保持原状，单独需求单独做 |

## 15. 来源、许可证与维护

Pi 和 OpenCode 参考代码均为 MIT。复制或实质改写时必须：

1. 在派生模块目录保留上游 LICENSE/NOTICE；
2. 每个实质移植文件头记录来源仓库、commit、路径和本地改动摘要；
3. 派生测试同样标注来源；
4. 建立 `source-provenance.json`，至少记录 source URL、commit、path、target、license、adaptation；
5. 不把临时 clone 或整个上游仓库提交进产品；
6. 后续升级按 provenance 逐文件 diff，不直接覆盖 DEF 改写。

建议来源记录：

```json
{
  "source": "https://github.com/earendil-works/pi-mono",
  "commit": "e47b8e37a6211ebd0b2942fa87059d64f81eec02",
  "path": "packages/agent/src/agent-loop.ts",
  "target": "agent/runtime/kernel/agent-loop.ts",
  "license": "MIT",
  "adaptation": "External HostToolBridge; sequential tools; DEF events"
}
```

## 16. 开工前必须锁定的决定

以下结论已经足够明确，可以直接进入后续 Spec/Tasks：

- 自有 Runtime，不使用 Pi/OpenCode 生产依赖；
- Pi `0.84.1/e47b8e37` 是首个参考基线；
- OpenCode `v1.17.11/67aec221` 是 UI 参考基线；
- 首版只做 OpenAI-compatible/DeepSeek；
- 首版 Tool 顺序执行；
- Runtime Session 是唯一对话事实源；
- 当前 DEF Host/Harness/ProductGateway 保留；
- OpenCode-derived UI 使用 DEF Conversation 协议，不模拟 OpenCode API；
- 新 Runtime 完成前保留 OpenCode 回退；
- CI/CD 暂不进入第一轮。

仍需在对应实施阶段用原型数据决定、不能凭空定死：

- Session Surface 保留 Solid 还是机械移植到 React；
- UI bundle 的最终体积预算；
- 首次正式切换时是否迁移已有 OpenCode 历史会话；
- branch/fork 何时暴露给用户；
- steering/follow-up 是否进入首版；
- 未来新增第二家 Provider 的触发条件。

这些未决项不阻塞 M1–M4；它们不能被用来重新讨论是否采用自有 Runtime。

## 17. 收尾标准

满足以下全部条件，才可以宣布 OpenCode → DEF Lightweight Runtime 迁移完成：

1. 发布和开发启动均不需要 OpenCode binary；
2. Agent loop、Tool chain、abort、retry 与 compaction 有 Pi 基线对跑；
3. 同一 Session 刷新、Host 重启后上下文一致；
4. Runtime transcript 与 Host audit 的事实源边界明确且无双写竞争；
5. 所有业务 Tool 仍经过 Harness、审批和 ProductGateway；
6. 产品 mutation 不会因 retry/recovery 重复执行；
7. UI 保留 OpenCode 的消息密度、reasoning、Tool 顺序和状态表达；
8. 浏览器 SVG 入口在 Shell 未预启动时可以完整拉起 AI 模式；
9. API Key 错误可在 Shell 修复并恢复，不泄露密钥；
10. 真实模型多轮、真实浏览器 SQLite、真实 UI 的 Computer Use 通过；
11. Mac 与 Windows 手测通过；
12. 长会话性能和发布包体积明显优于 OpenCode 版本；
13. OpenCode runtime、gateway、plugin、locks 和准备脚本已经删除；
14. 新 ADR、当前系统事实源、测试文档和打包检查同步更新；
15. 所有派生源码和测试都有可追溯 MIT 来源记录。

## 18. 最终判断

这不是一次“换 SDK”任务，而是一次有明确参考答案的轻量 Runtime 派生工程。它比直接装 Pi SDK多一部分移植和测试成本，但能得到四个长期收益：

- 只保留产品真正需要的 Agent 能力；
- 不被 Pi CLI/TUI/插件、多供应商和未来包名变化绑架；
- 不再承担 OpenCode 大服务端、binary 和兼容网关；
- Session、UI、Harness 和产品数据的所有权清楚，后续维护者能逐模块理解和升级。

最合理的执行方式不是一口气删除 OpenCode，而是先用 Pi 的源码和测试建立参考线，逐模块派生 DEF Runtime，在同一 Host/Harness 下完成对跑，再替换 UI 和退役旧 Runtime。这样才是真正“把作业抄明白”，而不是把新的依赖搬进来。

## 19. 主要证据索引

Pi 固定源码：

- `packages/ai/src/types.ts`
- `packages/ai/src/api/openai-completions.ts`
- `packages/ai/src/utils/event-stream.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/src/core/compaction/compaction.ts`
- `packages/coding-agent/src/core/agent-session-runtime.ts`
- `packages/agent/src/harness/agent-harness.ts`，仅用于证明新 Harness 尚未完成

OpenCode 固定源码：

- `packages/schema/src/session-v1.ts`
- `packages/app/src/context/server-session.ts`
- `packages/session-ui/src/components/session-turn.tsx`
- `packages/session-ui/src/components/message-part.tsx`
- `packages/session-ui/src/styles/`

当前 DEF 实现：

- `agent/core/contracts/engine.ts`
- `agent/core/contracts/events.ts`
- `agent/core/contracts/session.ts`
- `agent/core/harness/manager.ts`
- `agent/core/tools/interactive-workbench.ts`
- `agent/host/def-agent-host.ts`
- `agent/host/session-store.ts`
- `agent/host/product-command-store.ts`
- `agent/host/remote-browser-product-gateway.ts`
- `agent/host/opencode-native-ui-gateway.ts`
- `agent/engines/opencode/adapter.ts`
- `agent/engines/opencode/runtime.ts`
- `agent/runtime/host-entry.ts`
- `src/components/AgentMode/AgentModeOverlay.tsx`
- `src/platform/agent/desktopAgentBridge.ts`
- `docs/testing/def-agent-blackbox.md`

## 20. 多 Subagent 并行开工设计

### 20.1 拆分目标

多人并行不是为了让每个 Agent 同时“做一点”，而是让每个工作包满足：

1. 只有一个明确责任；
2. 写入文件集合互不重叠；
3. 输入合同在派发前已经冻结；
4. 不依赖另一个尚未完成工作包的内部实现；
5. 可以用 fake/stub 独立测试；
6. 最终只通过公开接口被主 Agent 组装；
7. 任何需要改变共享合同的发现必须上报，不能由 worker 自行扩展范围。

本工程的并行瓶颈不是代码量，而是五类共享事实：

- Runtime Message/Event；
- ModelDriver；
- ToolBridge；
- Session Entry/Context；
- Conversation Protocol。

这五类合同未冻结前，开更多 subagent 只会制造类型、命名和生命周期冲突。

### 20.2 Agent 角色与模型选择

| 角色 | 模型与思考档 | 适合工作 | 不应独立决定 |
| --- | --- | --- | --- |
| 主架构与联调 Agent | `gpt-5.6-sol`，`xhigh` | 合同冻结、依赖排序、共享文件、冲突处理、跨模块联调、最终判断 | 不把自身变成所有模块的编码 worker |
| 编码 Worker | `gpt-5.6-luna`，`max` | 在冻结合同下完成单一目录的生产代码、单元测试和 fixture | 不改共享合同、Host 总体语义或迁移范围 |
| 独立架构/安全 Reviewer | 新开的 `gpt-5.6-sol`，`xhigh` | 状态机、恢复、压缩、权限、密钥、幂等和 gate review | 不直接接管 worker 写集，避免审查与实现混在一起 |
| UI 编码 Worker | `gpt-5.6-luna`，`max` | OpenCode-derived 组件抽取、store、样式和交互测试 | 不重新设计产品 UI，不自行改变 Conversation 协议 |
| 测试编码 Worker | `gpt-5.6-luna`，`max` | trace comparator、provider fixture、黑盒场景和回归脚本 | 不因测试难写而放宽产品合同 |

模型选择原则：

- 凡是“合同已经定好，只需实现并验证”的任务，优先 Luna Max；
- 凡是会决定多个模块边界、涉及恢复/安全/幂等，或需要判断上游语义是否抄对的任务，使用 Sol xhigh；
- Luna Max 可以发现合同问题，但只能提交 `contract-change-request`，不能越权修改；
- Sol xhigh Reviewer 必须使用新上下文独立审查，不能只让主 Agent 自我确认；
- 不为简单机械任务额外开启 Sol，以免把高推理额度消耗在可并行编码上。
- 本轮不单独分配 Terra：任务已经自然分成“冻结合同后的编码”和“高风险架构判断”两类，引入中间档不会减少交接面。

### 20.3 总体依赖图

```mermaid
flowchart TD
  F0["F0 · 合同、文件清单与 Trace Schema<br/>主 Agent · Sol xhigh"]

  P0["P0 · Pi Golden Oracle<br/>Luna Max"]
  P1["P1 · Provider Transport<br/>Luna Max"]
  PS["PS · Profile Security<br/>Luna Max"]
  P2["P2 · Agent Loop<br/>Luna Max"]
  P3["P3 · Session Log<br/>Luna Max"]
  P4["P4 · Conversation Projection + Store<br/>Luna Max"]

  P5["P5 · Context + Compaction<br/>Luna Max"]
  P6["P6 · Tool Bridge + Projection<br/>Luna Max"]
  P7["P7 · Runtime Session<br/>Luna Max"]
  U0["U0 · UI 技术门禁<br/>Luna Max spike + Sol xhigh decision"]
  P8["P8 · Session Surface UI<br/>Luna Max"]
  P9["P9 · Agent UI Gateway<br/>Luna Max"]

  P10["P10 · Engine Adapter<br/>Luna Max"]
  I1["I1 · Kernel/Host 联调<br/>主 Agent · Sol xhigh"]
  P11["P11 · UI/Browser 接入<br/>Luna Max + 主 Agent"]
  T1["T1 · 生命周期黑盒<br/>Luna Max"]
  P12["P12 · Packaging + Retirement<br/>Luna Max + 主 Agent"]
  V1["V1 · 独立 Gate Review<br/>Sol xhigh"]
  A1["A1 · Computer Use / 双平台验收<br/>主 Agent"]

  F0 --> P1
  F0 --> P0
  F0 --> PS
  F0 --> P2
  F0 --> P3
  F0 --> P4
  P1 --> P5
  P3 --> P5
  P2 --> P6
  P1 --> P7
  P0 --> P7
  P2 --> P7
  P3 --> P7
  P5 --> P7
  P6 --> P7
  P4 --> U0
  U0 --> P8
  P4 --> P9
  P7 --> P10
  PS --> P10
  P9 --> I1
  P10 --> I1
  I1 --> P11
  P8 --> P11
  I1 --> T1
  P8 --> T1
  P11 --> V1
  T1 --> V1
  V1 --> P12
  P12 --> A1
```

### 20.4 并行波次

| 波次 | 可同时运行的工作包 | 主 Agent 同期工作 | 进入条件 | 退出门禁 |
| --- | --- | --- | --- | --- |
| Wave 0 | 只有 F0 | 直接完成合同、Trace Schema、文件清单和仓库边界 | 本文已接受 | G0 合同冻结 |
| Wave 1 | 可运行池：P0、P1、PS、P2、P3、P4；最多同时四个 | 审查 worker 反馈、维护 contract change queue | G0 | G1 各包独立测试 |
| Wave 2A | P5、P6、P9、U0；U0 通过后启动 P8 | 准备 Runtime Session 集成 fixture | 对应 Wave 1 包通过 | G2 子系统合同通过 |
| Wave 2B | P7 | 对 P5/P6 做 Sol xhigh 复核 | P0/P1/P2/P3/P5/P6 通过 | G3 Kernel 可独立多轮运行 |
| Wave 3A | P10；P8/P9 遗留收口可并行 | 只准备 I1 fixture，不提前修改共享入口 | G3，且 PS 已通过 | P9/P10 均达到可集成状态 |
| Wave 3B | 只有 I1 | 主 Agent 修改共享 Host/entry/contracts | P9/P10 完成 | G4 Host Harness 黑盒通过 |
| Wave 4 | P11、T1 | 主 Agent 做真实模型与浏览器联调 | G4，且 P8 完成 | G5 UI/生命周期通过 |
| Wave 5 | P12 的机械打包修改 | 主 Agent 负责删除决策、ADR 和发布候选构建 | 独立 V1 review 通过 | 无 OpenCode 的可回退发布候选 |
| Wave 6 | 只有 A1 | 主 Agent 做 Computer Use 与 Mac/Windows 验收 | Wave 5 发布候选完成 | G6 OpenCode 退役验收 |

建议并发上限：

- Wave 1 最多四个编码 subagent；
- Wave 2 最多四个编码 subagent；
- 同一时间最多一个 Agent 拥有现有共享文件写权；
- Reviewer 不与被审查 worker 共用写集；
- 不为了填满并发槽提前启动尚未满足依赖的工作包。

默认四槽调度：Wave 1 先派 P0/P1/P2/P3，任一完成后依次补 P4/PS；Wave 2 先派 P5/P6/P9/U0，U0 出结论后用释放的槽位派 P8。这样优先推进 Runtime 关键路径，同时不让 UI 路径空等。

#### 20.4.1 快速派工表

| ID | 工作包 | 主模型 | 复杂度 | 强制复核 | 可与谁并行 |
| --- | --- | --- | --- | --- | --- |
| F0 | 合同、文件清单与 Trace Schema | Sol xhigh | XL | 新 Sol xhigh | 不并行，所有包前置 |
| P0 | Pi Golden Oracle | Luna Max | M/L | Sol xhigh 语义 review | P1/PS/P2/P3/P4 |
| P1 | Provider/SSE | Luna Max | L | Sol xhigh 安全 review | P2/P3/P4 |
| PS | Provider Profile 安全 | Luna Max | M | Sol xhigh 安全 review | P0/P1/P2/P3/P4 |
| P2 | Agent Loop | Luna Max | L | Sol xhigh 状态机 review | P1/P3/P4 |
| P3 | Session Log | Luna Max | L | Sol xhigh 恢复 review | P1/P2/P4 |
| P4 | Conversation Projector/Store | Luna Max | M/L | Sol xhigh cursor review | P0/P1/PS/P2/P3 |
| P5 | Context/Compaction | Luna Max | L | Sol xhigh 强制 gate | P6/P9/U0 |
| P6 | Tool Bridge/Projection | Luna Max | M/L | Sol xhigh 强制 gate | P5/P9/U0 |
| U0 | React/Solid UI spike | Luna Max + Sol xhigh | S | 主 Agent 决策 | P5/P6/P9 |
| P8 | Session Surface | Luna Max | L | 主 Agent + 视觉验收 | P5/P6/P9，需 U0 |
| P9 | Agent UI Gateway | Luna Max | L | Sol xhigh 安全 review | P5/P6/U0/P8 |
| P7 | Runtime Session | Luna Max | XL | 主 Agent + Sol xhigh | 依赖 P0/P1/P2/P3/P5/P6 |
| P10 | Engine Adapter | Luna Max | L | 主 Agent | P8/P9 收口 |
| I1 | Kernel/Host 联调 | Sol xhigh 主 Agent | XL | 新 Sol xhigh | 不委派整体联调 |
| P11 | UI/Browser 接入 | Luna Max | M | 主 Agent + Computer Use | 测试补充 worker |
| T1 | 生命周期自动黑盒 | Luna Max | M | 主 Agent | 与 P11 并行 |
| V1 | 独立全生命周期审查 | 新 Sol xhigh | L | 主 Agent 只接收结论 | 不与 P12 并行 |
| P12 | Packaging/Retirement | Luna Max 机械修改 + 主 Agent | XL | 独立 Sol xhigh | 最后一波 |
| A1 | Mac/Windows 手动验收 | Sol xhigh 主 Agent | L | 用户实机结果 | 不委派最终判断 |

### 20.5 F0：合同、文件清单与 Trace Schema 冻结

负责人：主 Agent，Sol xhigh。

性质：串行关键路径，不委派给普通编码 worker。

独占写集：

```text
agent/runtime/kernel/messages.ts
agent/runtime/kernel/stream-events.ts
agent/runtime/kernel/tool.ts
agent/runtime/kernel/ids.ts
agent/runtime/kernel/provider/model-driver.ts
agent/runtime/kernel/session/entries.ts
agent/core/contracts/conversation.ts
agent/core/contracts/conversation.contract.test.ts
agent/core/contracts/index.ts
agent/runtime/kernel/testing/trace-schema.ts
agent/runtime/kernel/testing/trace-schema.test.ts
agent/runtime/source-provenance.json
agent/runtime/NOTICE.md
scripts/repository-check.mjs
package.json
```

交付物：

- 最小消息与事件 union；
- ModelDriver/ModelStream 接口；
- ToolBridge/ToolProjection 接口；
- Session entry schema；
- Conversation snapshot/event 协议；
- 规范化 trace schema；
- 来源台账和 MIT NOTICE；
- 完整目标文件清单、唯一 owner 和 `allowedAgentFiles` 预登记；
- `agent/engines/def-runtime/` 的 Node builtin/外部依赖边界规则。

验收：

- TypeScript 编译；
- schema/validator 测试；
- Trace schema 可以在不加载 Pi SDK 的情况下验证；
- 每个合同字段都能追溯到 Pi/OpenCode/DEF 中至少一个明确需求；
- Runtime run/message/run-marker 持久保存 `DefTurnId`，冻结 `RuntimeTurnId ↔ DefTurnId` 关联；
- assistant `message.start` 使用 draft，不伪造尚未产生的 usage/stopReason/completedAt；
- Reviewer 确认不存在 UI 类型反向污染 Runtime；
- `npm run check:repo` 接受预登记的目标骨架，后续 worker 不需要争改仓库白名单。

F0 完成后形成一个明确的 gate commit。后续所有 Wave 1 worker 必须从该提交创建独立 worktree。

F0 修改 `scripts/repository-check.mjs` 不是放宽检查：必须按最终工作包精确登记新文件，并继续禁止 Pi/OpenCode 生产依赖、Node 业务 SQLite、退役 REST 和 Agent core 越界 import。

本地只读参考源码可以放在未跟踪的 `agent/vendor/`；仓库检查只跳过其中未跟踪的文件。一旦文件被暂存或跟踪，仍按普通 `agent/**` 文件执行白名单和依赖检查并失败，防止参考仓库进入产品提交。

#### 20.5.1 P0：Pi Golden Oracle

负责人：Luna Max 编码，Sol xhigh 复核参考语义。

独占写集：

```text
scripts/agent-runtime-pi-reference.mjs
agent/runtime/kernel/testing/trace-normalizer.ts
agent/runtime/kernel/testing/golden-trace.test.ts
agent/runtime/kernel/testing/fixtures/**
```

输入：F0 Trace schema、Pi `0.84.1/e47b8e37` 临时源码根目录。

输出：可重复生成的 text/reasoning/tool/error/abort/compaction trace、规范化器和 fixture hash。

约束：

- reference runner 通过显式 `PI_REFERENCE_ROOT` 使用临时 clone；
- Pi 包不进入 package.json、产品 bundle 或运行时依赖；
- fixture 记录上游 commit 和生成参数；
- 随机 ID/timestamp 可以规范化，消息顺序、Tool、terminal 和 context 不得规范化掉；
- worker 不写产品 Runtime 实现。

验收：同一固定源码和输入重复生成相同规范化 trace/hash；Sol xhigh 确认 fixture 没有误读 Pi 的 Session/compaction 语义。

### 20.6 P1：Provider Transport

负责人：Luna Max。

独占写集：

```text
agent/runtime/kernel/provider/openai-compatible-driver.ts
agent/runtime/kernel/provider/sse-parser.ts
agent/runtime/kernel/provider/provider-errors.ts
agent/runtime/kernel/provider/retry-policy.ts
agent/runtime/kernel/provider/openai-compatible-driver.test.ts
agent/runtime/kernel/provider/sse-parser.test.ts
agent/runtime/kernel/provider/retry-policy.test.ts
```

输入：F0 的 `messages.ts`、`stream-events.ts`、`model-driver.ts`。

输出：实现 `ModelDriver` 的 OpenAI-compatible/DeepSeek driver。

必须测试：

- 任意 chunk 边界；
- UTF-8 跨 chunk；
- text/reasoning；
- Tool name/arguments 增量；
- 401/403、429、5xx、network drop；
- abort 与 retry timer；
- 错误脱敏。

禁止触碰：

- `agent/core/**`；
- `agent/host/**`；
- Session、ToolBridge 和 UI；
- F0 合同。

审查：Sol xhigh 只审查 provider 安全、重试边界和 Tool 参数完整性。

#### 20.6.1 PS：Provider Profile 安全

负责人：Luna Max 编码，Sol xhigh 安全复核。

独占写集：

```text
agent/engines/def-runtime/profile.ts
agent/engines/def-runtime/profile.test.ts
```

输入：当前 `agent/engines/opencode/profile.ts` 的 0600、owner、symlink、schema 和脱敏规则，以及 F0 登记的目标文件/依赖边界。

输出：不绑定 OpenCode 的 ProviderProfileSource。

必须测试：

- 文件 owner/mode；
- symlink 和非普通文件；
- profile ref 唯一性；
- base URL scheme/host/header 边界；
- model ID 和 API Key 有界；
- 错误、日志和序列化永不包含密钥。

禁止触碰：Provider HTTP driver、Electron profile writer、OpenCode profile 和 Engine adapter。

### 20.7 P2：Agent Loop

负责人：Luna Max。

独占写集：

```text
agent/runtime/kernel/agent-loop.ts
agent/runtime/kernel/run-controller.ts
agent/runtime/kernel/agent-loop.test.ts
agent/runtime/kernel/testing/fake-model-driver.ts
agent/runtime/kernel/testing/fake-tool-bridge.ts
```

输入：F0 消息、事件、ModelDriver 和 ToolBridge 合同。

输出：不依赖真实 Provider/Host/磁盘的纯 Agent loop。

必须测试：

- 纯文本；
- reasoning + text；
- 单 Tool；
- 多 Tool 按调用顺序执行；
- Tool failure 后继续；
- malformed/truncated Tool 不执行；
- abort before stream / during stream / waiting tool；
- `run.end` 在 listener settlement 后发出。

禁止触碰：Provider 实现、Session、Host、UI 和共享合同。

审查：Sol xhigh 复核状态机、terminal 唯一性和晚到事件。

### 20.8 P3：Session Log 与恢复

负责人：Luna Max。

独占写集：

```text
agent/runtime/kernel/session/session-log.ts
agent/runtime/kernel/session/session-reader.ts
agent/runtime/kernel/session/session-validator.ts
agent/runtime/kernel/session/session-log.test.ts
```

输入：F0 message 和 entry schema。

输出：append-only JSONL、恢复、tail 截断和 incompatible 判定。

必须测试：

- create/append/reopen；
- 不完整尾行；
- 中间损坏；
- parent 链和循环；
- Tool call/result 配对；
- interrupted run；
- 0600 文件和路径边界；
- 不保存 API Key。

禁止触碰：Context/Compaction、Host Session Store、Provider 和 UI。

审查：Sol xhigh 复核损坏处理、幂等和产品 mutation 不重放原则。

### 20.9 P4：Conversation Projection 与 Store

负责人：Luna Max。

独占写集：

```text
agent/host/conversation-projector.ts
agent/host/conversation-projector.test.ts
agent/host/testing/conversation-fixtures.ts
src/agentSessionSurface/conversation-store.ts
src/agentSessionSurface/conversation-store.test.ts
src/agentSessionSurface/testing/**
```

输入：F0 Conversation 协议和 Trace Schema。P4 在自己的 testing 写集中构造最小 Runtime/Host synthetic fixture，不等待 P0，因此仍可并行开工；G1 时再用 P0 Golden Trace 做一次字段与顺序交叉核验。

输出：Runtime/Host 事件到 Conversation Message/Part 的确定性投影、复合游标，以及浏览器 snapshot/delta reducer。Projector 与 UI 框架无关，Store 不依赖 Runtime 内部类型。

必须测试：

- Runtime transcript + Host Journal 组合 Snapshot；
- 双来源 high-water mark 与 snapshot/subscribe 并发窗口；
- `{epoch, runtimeSequence, hostSequence}` 断点续传；
- epoch 变化强制重新取 Snapshot；
- duplicate/out-of-order source sequence；
- part upsert/delta/remove；
- Runtime text/reasoning/tool/compaction 到 Part 的逐项映射；
- Tool 四状态；
- interaction；
- reconnect 和 gap recovery；
- disconnect/reconnect 必须通过 `AbortSignal` 终止并等待旧的 Runtime/Host 订阅；
- 同一 message/part 不重复。

禁止触碰：OpenCode UI 抽取、Host Gateway、Runtime 和协议定义。

P4 必须由 Sol xhigh 复核复合 cursor、双来源 gap recovery 和“无第三份永久日志”；如果 reducer 试图改变协议，则退回 F0 contract review。

### 20.10 P5：Context 与 Compaction

负责人：Luna Max 编码，Sol xhigh 强制复核。

独占写集：

```text
agent/runtime/kernel/session/context-builder.ts
agent/runtime/kernel/session/compaction.ts
agent/runtime/kernel/session/context-recovery.ts
agent/runtime/kernel/session/compaction-prompt.ts
agent/runtime/kernel/session/context-builder.test.ts
agent/runtime/kernel/session/context-recovery.test.ts
agent/runtime/kernel/session/compaction.test.ts
```

输入：P1 ModelDriver、P3 SessionLog、F0 entry/message。

输出：上下文重建、threshold/manual/overflow compaction 和一次恢复重试。

必须测试：

- product context 每轮更新但不污染历史；
- latest compaction + retained tail；
- unresolved Tool/Interaction 不被拆开；
- summary 失败保留原历史；
- overflow 只重试一次；
- compaction 后 restart 上下文一致；
- 旧 usage 不触发连续压缩。

禁止触碰：Agent loop、Host、UI 和 Provider 实现。

这是高风险包。Luna Max 完成编码后不能直接进入 P7，必须经过独立 Sol xhigh gate review。

### 20.11 P6：Host Tool Bridge 与 Projection

负责人：Luna Max 编码，Sol xhigh 强制复核。

独占写集：

```text
agent/runtime/kernel/host-tool-bridge.ts
agent/runtime/kernel/tool-projection.ts
agent/runtime/kernel/host-tool-bridge.test.ts
agent/runtime/kernel/tool-projection.test.ts
```

输入：P2 Agent loop 的 ToolBridge 合同、当前 `EngineTurnHandle` 语义、Harness fixture。

输出：外置 Tool wait、result/abort、原子 projection 更新。

必须测试：

- stale/unknown tool；
- duplicate/late result；
- result + projection 原子顺序；
- abort waiting tool；
- interaction pending；
- parallel result 被首版策略拒绝；
- Tool result 序列化有界。

禁止触碰：现有 `DefAgentHost`、Harness manager、ProductGateway 和共享合同。

Sol xhigh 重点审查：审批绕过、晚结果推进、projection race 和 mutation 幂等。

### 20.12 P7：Runtime Session Orchestrator

负责人：Luna Max 编码，主 Agent 集成，Sol xhigh 复核。

独占写集：

```text
agent/runtime/kernel/runtime-session.ts
agent/runtime/kernel/runtime-session.test.ts
agent/runtime/kernel/testing/runtime-fixtures.ts
```

输入：P0 Golden Trace，以及 P1、P2、P3、P5、P6 的公开接口。

输出：create/recover/start/compact/abort/waitForIdle/close 的最小 Runtime Session。

必须测试：

- 新 Session 多轮；
- Tool chain；
- restart 后继续；
- threshold/overflow compaction；
- Provider retry；
- consumer abort；
- Session close settlement；
- 同一 Session 单 active run。

禁止触碰各下层模块内部和现有 Host。发现接口缺口时提交 change request，由主 Agent 决定修改哪一个上游包。

### 20.13 U0：Session Surface 技术门禁

负责人：Luna Max 做有界 spike，主 Agent/Sol xhigh 做决定。

目的：在 P8 正式编码前，用同一份 Conversation fixture 比较两个最小原型：

- 直接保留 OpenCode-derived Solid micro-bundle；
- 按相同 DOM/data-slot/CSS 机械移植到 React。

Spike 只能放在临时 worktree 或明确的 prototype 目录，不得直接改生产 Overlay。比较指标：

- text/reasoning/generic tool 三种最小视图的视觉差异；
- production bundle 增量；
- 需要复制的 `@opencode-ai/ui` primitive 数；
- 独立 build/tsconfig 复杂度；
- 主题变量接入；
- 后续 Tool renderer 的维护成本；
- OpenCode MIT 来源追踪是否清楚。

决策原则：长期维护明显更优时选 React；只有 Solid 能以显著更低的改写量保持原 UI 且 bundle 可控时才选 Solid。U0 只决定技术承载，不允许重新设计 UI。

U0 输出一个短 decision record 和固定截图。未通过 U0，不派发 P8。

U0 的原型源码不进入产品提交。Luna Max 只提交以下证据写集，主 Agent 另行在 ADR 中记录最终选择：

```text
docs/architecture/audits/agent-session-surface-ui-spike-evidence.md
docs/architecture/audits/assets/agent-session-surface-ui-spike/**
```

下节列出的 `src/agentSessionSurface/**` 是 React 方案的正式写集。若 U0 最终选择 Solid，主 Agent 必须先用单独 gate commit 把正式写集改到独立于 `src` 的 UI 根目录，并补独立 tsconfig/Vite 配置与仓库文件清单；禁止把 Solid TSX 直接塞进当前 `jsx: react-jsx` 的前端编译边界后让 P8 自行修补。

### 20.14 P8：OpenCode-derived Session Surface

负责人：Luna Max。

独占写集：

```text
src/agentSessionSurface/index.html
src/agentSessionSurface/main.tsx
src/agentSessionSurface/components/**
src/agentSessionSurface/styles/**
src/agentSessionSurface/session-surface.spec.ts
vite.agent-session-surface.config.ts
```

输入：P4 Conversation Store、U0 技术决定和固定 OpenCode `v1.17.11` 视觉源码。

输出：独立小型会话 UI bundle。

必须保留：SessionTurn、text、reasoning、Tool 四状态、interaction、compaction、自动滚动、copy/stop/retry 和主题变量。

必须删除：OpenCode client/global sync、文件浏览、终端、VCS、provider 管理、task/todo/sub-agent。

必须测试：

- fixture render；
- Tool 顺序；
- 长会话滚动；
- pending/running/completed/error；
- snapshot/SSE 更新；
- 与 OpenCode 基准截图视觉对比；
- CSS 主题只改变颜色，不改变布局。

该目录必须拥有独立的 Vite UI 构建/测试入口。当前 `tsconfig.agent.json` 只覆盖 Agent `.ts`，前端 `tsconfig.json` 只覆盖 `src`；因此 UI 放在 `src/agentSessionSurface/`，但必须使用独立 Vite entry 输出到 Agent UI 静态目录。P8 不得为了 `.tsx` 偷偷扩大 Agent Host 的 TypeScript 编译边界。

禁止触碰：`src/components/AgentMode/**`、Host Gateway、Conversation 协议和 Runtime。

### 20.15 P9：Agent UI Gateway

负责人：Luna Max 编码，Sol xhigh 安全复核。

独占写集：

```text
agent/host/agent-ui-gateway.ts
agent/host/agent-ui-gateway.test.ts
```

输入：F0 Conversation 协议、P4 `ConversationProjector`/reducer fixture、现有 token/consumer 能力。

输出：静态 UI、Session CRUD、prompt/stop、snapshot/SSE、interaction API。

必须测试：

- grant/token/origin；
- Session 只显示当前 ProductBinding；
- Snapshot/SSE 复合 cursor；
- prompt 去重；
- stop；
- archive/delete；
- interaction；
- consumer lost；
- bounded error 和路径逃逸。

禁止触碰：旧 Gateway、Host 组装、Runtime、Overlay 和共享协议。

### 20.16 P10：DEF Runtime Engine Adapter

负责人：Luna Max。

独占写集：

```text
agent/engines/def-runtime/adapter.ts
agent/engines/def-runtime/errors.ts
agent/engines/def-runtime/transcript-source.ts
agent/engines/def-runtime/adapter.test.ts
```

输入：P7 Runtime Session、PS ProviderProfileSource、当前 AgentEngine 合同。

输出：`AgentEngine + RuntimeTranscriptSource` 实现。

必须测试：

- probe/create/recover/start/compact/dispose/shutdown；
- profile ref 与密钥脱敏；
- accepted client turn/message ID；
- Tool result/interaction；
- terminal/abort；
- transcript snapshot/SSE；
- Host restart recovery。

禁止触碰：`engine.ts`、`host-entry.ts`、旧 adapter、Host 和 UI。共享接口适配由主 Agent负责。

### 20.17 I1：Kernel 与 DEF Host 联调

负责人：主 Agent，Sol xhigh。禁止委派整个联调给单个 worker。

独占共享写集：

```text
agent/core/contracts/**
agent/host/def-agent-host.ts
agent/runtime/host-entry.ts
agent/host/http-server.ts
agent/host/def-agent-interop.ts
package.json
tsconfig.agent.json
scripts/build-agent-runtime.mjs
```

主 Agent 职责：

- 按公开接口组装 P7/P9/P10；
- 处理实际合同缺口；
- 保持 Harness、ProductGateway 和审计语义；
- 运行全部 Agent core/tool/host/harness/engine tests；
- 处理跨包错误映射和生命周期；
- 决定 feature flag 默认值；
- 按 worker 交接的来源条目更新中央 `source-provenance.json`/NOTICE；
- 不在联调时顺手重写 worker 模块内部。

G4 门禁：

- fake provider 完整 Host 黑盒通过；
- 真实 Provider 最小 text/tool 多轮通过；
- Session restart 通过；
- Harness mutation 不重复；
- Interop 能读取 turn/tool/question/failure；
- OpenCode 仍可通过 flag 回退。

### 20.18 P11：UI 与浏览器接入

Luna Max 可负责有界 UI/bridge 代码，主 Agent 负责最终联调。

建议 worker 独占写集：

```text
src/components/AgentMode/AgentModeOverlay.tsx
src/components/AgentMode/AgentModeOverlay.css
src/components/AgentMode/AgentModeOverlay.test.ts
src/platform/agent/desktopAgentBridge.ts
src/platform/agent/desktopAgentBridge.test.ts
```

开始前主 Agent 必须冻结 Host launch/Conversation API；worker 不得同时修改 Electron supervisor。

验收：

- SVG 入口可冷启动；
- iframe 指向新 Session Surface；
- 创建/恢复/归档/删除；
- prompt/stop/retry；
- Provider 配置错误恢复；
- 主题、大小和现有 AI 模式布局不退化。

#### 20.18.1 T1：生命周期自动黑盒

负责人：Luna Max；只写测试，不修改生产代码。

独占写集：

```text
agent/host/def-runtime-harness-blackbox.test.ts
agent/host/def-runtime-lifecycle-blackbox.test.ts
tests/e2e/agent-mode-def-runtime.spec.ts
```

输入：G4 Host 候选、P8 Session Surface、固定 fake provider 和 `DefCodexInteropProtocol v1`。

必须覆盖：多轮上下文、Tool/Interaction 顺序、产品 mutation 回执唯一性、stop/abort、Host restart recovery、Provider 错误映射、归档/删除、SSE 重连和浏览器 SVG 冷启动。测试发现生产问题时只提交 finding，不得顺手修生产文件。

#### 20.18.2 V1：独立全生命周期审查

负责人：新开的 Sol xhigh，只读审查，不与 I1/P11 共用上下文，也不直接改代码。

输入：G5 候选提交、Pi Golden Trace、OpenCode UI 基准截图、Host/Harness/Interop 测试结果。

必须逐项审查：浏览器 SVG 冷启动、Session 创建与恢复、多轮上下文、Tool 调用顺序、Question/Approval、产品 mutation 回执、stop/abort、compaction、刷新、Host/Shell 重启、Provider 认证失败后恢复、归档和删除。输出按“阻断/高/普通”分级的 finding；存在“阻断”或“高”问题时禁止进入 P12。

### 20.19 P12：Packaging 与 OpenCode Retirement

Luna Max 负责机械修改和测试更新；主 Agent 负责删除批准、最终 diff 和回滚判断。

Luna Max worker 的允许写集必须在派工时从下列范围中精确选择，默认只负责新增/改写构建和验证脚本：

```text
electron/agent-runtime.cjs
electron/agent-runtime.test.cjs
electron/agent-provider-profile.cjs
electron/agent-provider-profile.test.cjs
scripts/build-agent-runtime.mjs
scripts/check-packaged-agent-host.mjs
scripts/check-desktop-runtime-boundaries.mjs
```

`package.json`、OpenCode prepare/verify scripts、`agent/engines/opencode/**` 和旧 Gateway 的删除只由主 Agent 执行。P12 跨域且包含删除，不能与 I1/P11 并行修改。开始前必须满足 G5，并创建最后一个可回退提交。

执行顺序：

1. 先让 build/package tests 不再依赖 OpenCode；
2. 再删除 prepare/verify scripts 和 locks；
3. 再删除 Gateway/adapter/runtime/plugin/private bridge；
4. 最后删除打包 vendor/runtime；
5. 更新 ADR、architecture facts 和 smoke tests；
6. 将 `agent/runtime/NOTICE.md` 与 `source-provenance.json` 复制进最终 Agent Runtime 发行目录并验证 commit/license；
7. 运行完整 Electron build/verify。

#### 20.19.1 A1：最终手动验收

负责人：主 Agent，Sol xhigh；Mac 使用 Computer Use，Windows 使用实际发布候选并记录用户实机结果。

验收必须从“Shell 未预启动、浏览器已打开工作台”开始，覆盖 SVG 进入 AI 模式、单实例 Electron、会话创建、多轮追问、至少一次 Tool/Interaction、刷新、Shell 重启、Provider 错误恢复、归档/删除和长会话滚动。任何一次上下文丢失、重复产品 mutation、图片/工作区回归、空白窗口或第二个 Electron 实例都阻断 G6。

### 20.20 主 Agent 专属文件

为避免合并事故，下列文件默认只有主 Agent可以修改；worker 只有在派工中被明确授权才例外：

```text
agent/core/contracts/**
agent/host/def-agent-host.ts
agent/runtime/host-entry.ts
agent/host/http-server.ts
agent/host/def-agent-interop.ts
electron/main.cjs
electron/agent-runtime.cjs
package.json
tsconfig.agent.json
scripts/repository-check.mjs
scripts/build-agent-runtime.mjs
agent/runtime/source-provenance.json
agent/runtime/NOTICE.md
docs/architecture/decisions/**
docs/testing/def-agent-blackbox.md
```

`agent/host/def-agent-host.ts` 当前约 5,000 行，是本轮最大的冲突热点，任何 worker 都不得顺手修改。旧 OpenCode 文件在退役前也视为主 Agent 专属，避免一个 worker 为了“清理”提前破坏回退线。P12 如需修改上表中的构建或 supervisor 文件，必须获得一次性的精确文件授权，且不能与主 Agent 同时写入。

### 20.21 Subagent 派工模板

每次派工必须包含以下内容，不能只说“实现 Provider”或“做 Session”：

```text
工作包 ID：P?
基线提交：<gate commit>
参考源码：<repo@commit:path>
允许写入：<精确目录/文件>
禁止写入：<共享合同与其他包>
输入合同：<类型/接口/fixture>
交付物：<生产代码、测试、来源记录>
必须通过：<命令和场景>
不得实现：<明确排除范围>
发现合同缺口时：停止扩域，提交 contract-change-request
交接内容：commit、changed files、tests、deviations、risks
```

编码 worker 必须直接在独立 worktree 修改并提交一个可审查的原子 commit。不得把多个工作包混在一个 commit，也不得自动合并回主分支。

F0 结束时，主 Agent 还要为每个包写明实际测试命令。Node 侧至少包含该包自有 `node --experimental-strip-types <test-file>`、`npm run typecheck:agent` 和 `npm run check:repo`；UI 侧至少包含定向测试、独立 bundle build 和 fixture render。worker 不得只汇报“测试通过”而不列命令。

`contract-change-request` 必须写清：触发 fixture、现有合同为何无法表达、建议的最小字段/语义变化、受影响工作包以及不改会造成的错误。主 Agent 在单独 gate commit 中处理；其他 worker 继续以旧合同工作或暂停受影响部分，不能各自发明兼容字段。

### 20.22 Worker 交接模板

```text
Package: P?
Commit: <sha>
Changed files:
- ...

Contracts consumed:
- ...

Tests run:
- <command>: pass/fail

Upstream behavior copied:
- <source path/function>

Provenance entries proposed:
- <source@commit:path -> target>

Intentional deviations:
- ...

Contract change requests:
- none / ...

Known risks:
- ...
```

主 Agent 先检查写集是否越界，再检查测试和来源，最后才按依赖顺序 cherry-pick/rebase。发现越界时优先要求 worker 修正原 commit，不在主分支默默吸收。

### 20.23 合并门禁

| Gate | 负责人 | 必须证明 | 通过后可启动 |
| --- | --- | --- | --- |
| G0 合同冻结 | 主 Agent + Sol xhigh Reviewer | 共享合同、Trace Schema、文件清单、边界规则和 provenance schema 稳定 | Wave 1 |
| G1 独立模块 | 主 Agent | P0/P1/PS/P2/P3/P4 各自测试、无写集越界 | Wave 2 |
| G2 高风险子系统 | Sol xhigh Reviewer | P5/P6 的压缩、恢复、Tool/approval 安全 | P7 |
| G3 Kernel | 主 Agent + Reviewer | 多轮、Tool、Session、compaction、abort | P10；P9/P10 完成后 I1 |
| G4 Host | 主 Agent | Harness、ProductGateway、Interop、重启 | P11 |
| G5 产品 UI | 主 Agent + Computer Use | OpenCode 视觉等价、完整生命周期 | V1；V1 无阻断后 P12 |
| G6 退役 | 主 Agent + 独立 Sol xhigh | 无 OpenCode 依赖、可打包、双平台通过 | 发布 |

每个 Gate 都要形成一个提交和简短记录。未通过 Gate 时，不允许靠“下一阶段顺便修”推进。

### 20.24 独立 Review 分配

以下内容必须由 Sol xhigh 独立复核：

- F0 message/event/session/conversation 合同；
- P0 Golden Oracle 的上游语义；
- P1 密钥、错误和 retry；
- PS profile 文件与密钥安全；
- P2 terminal/abort/tool ordering；
- P3 corruption/recovery；
- P4 双来源投影、复合 cursor 和 gap recovery；
- P5 compaction/context overflow；
- P6 approval/projection/mutation 幂等；
- P7 Runtime Session 生命周期；
- U0 React/Solid 技术决定；
- P9 grant/origin/SSE replay；
- P10 Engine recovery；
- G5 后的全生命周期；
- OpenCode 删除前的最终 diff。

以下内容通常不需要 Sol 单独编码或长时间审查：

- 明确 fixture 下的 reducer；
- CSS/DOM 的机械抽取；
- 已冻结 schema 下的 serializer；
- build script 的路径替换；
- 测试名称和文档链接更新。

### 20.25 主 Agent 最终联调清单

主 Agent 不只是把 commit 合在一起。最终联调必须逐条核对：

1. Provider event 能否无损进入 Runtime message；
2. Runtime Tool call 能否经过 Harness 返回 Tool result；
3. projection 是否在下一模型 Turn 前原子更新；
4. Runtime Session 与 DEF Session ID 是否稳定绑定；
5. Runtime transcript 与 Host audit 是否没有双事实源；
6. compaction 后 UI 历史和模型上下文是否各自正确；
7. snapshot/SSE 断线恢复是否无重复和缺口；
8. InteractionBroker 与 UI 卡片是否同一状态；
9. Browser consumer 丢失是否停止 Provider/Tool wait；
10. Provider 配置更新是否不破坏已有 Session；
11. SVG 冷启动、刷新、Shell 重启和归档是否完整；
12. OpenCode 回退线在删除前是否始终可用；
13. 最终包是否没有 OpenCode binary、私有服务和多余依赖；
14. Mac/Windows 实测和 Interop 记录是否一致。

### 20.26 并行方案的最终判断

按此拆分后，真正可并行的是模块实现，不是架构决策：

- 主 Agent/Sol xhigh 掌握合同、共享文件、Gate 和联调；
- Luna Max subagent 负责边界冻结后的高密度编码；
- 高风险模块由新的 Sol xhigh reviewer 独立复核；
- 每个 worker 有互斥写集、可独立测试和原子 commit；
- OpenCode 删除始终位于最后一波，不会因为前面并行而失去回退能力。

这能把开工初期从“一个 Agent 顺序写完所有模块”缩短为两轮主要并行开发，同时不牺牲 Session、Tool、审批和上下文正确性。
