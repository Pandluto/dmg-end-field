# DEF Agent 黑盒 / Mac Desktop Interop

本文档是当前 Agent Host 架构下的 DEF Agent 黑盒入口。它替代旧的
`agent/runtime/def-codex-interop.cjs` 行为说明；旧实现中的 REST 路由、sidecar
transcript 轮询和 Node SQLite 不属于当前测试入口。

## 当前拓扑

Mac Desktop Interop 通过正在运行的 Workbench bridge 访问：

```text
Computer Use / Mac Desktop Interop
  -> http://127.0.0.1:31457/agent-host/interop/v1
  -> Electron Agent bridge
  -> private DefAgentHost HTTP server
  -> DefAgentHost Event Journal + BrowserConsumerRegistry + Native UI Gateway
```

因此，自动化应使用 `127.0.0.1:31457` 上的相对路径。Electron bridge 会把请求转发到
当前 private Host，并注入 Host 私有认证头；不要重新实现旧 `/def-agent/**` 服务，也不要
直接读取 OpenCode transcript、Harness 私有存储或业务 SQLite。

当前公开的兼容 alias 只有：

```text
POST /agent-host/workbench-test/prompt
```

它与 `POST /agent-host/interop/v1/turns` 共用同一处理器，仅用于迁移旧黑盒脚本；旧
`/def-agent/interop/v1` 和旧 `/def-agent/workbench-test/prompt` 不是当前 browser route。

## 启动与授权

先用 `npm run electron:dev` 启动开发桌面 Workbench，进入 DEF OpenCode AI mode，并等待
可见 UI consumer 和 snapshot ready。该脚本显式设置 `DEF_AGENT_INTEROP_ENABLED=1`；打包
release 默认不开放 teacher Interop。Mac bridge 的固定地址仍是
`http://127.0.0.1:31457`，开发模式的 Web UI 可以来自 3030，但 Agent bridge 请求走
31457。若直接启动 Host 进行合同调试，需显式设置同一个环境变量。然后：

```bash
npm run test:agent-interop
```

该合同测试使用当前 `DefAgentHostHttpServer`、Fake Engine、Harness Manager、Browser
consumer 和 Event Journal；它不是生产 Harness/业务 mutation 的替代品。

### `GET /agent-host/interop/v1/status`

status 不要求 Interop bearer token，但仍必须经过当前 desktop bridge。重点字段：

- `bridge.ready`：当前 bridge 是否可用；
- `agent.ready` / `agent.state`：Engine 是否 ready；
- `nativeUi.available`：Native UI Gateway 是否挂载；
- `workbench.uiConnected`：是否有当前可见 writer consumer；
- `workbench.snapshotAvailable`：当前 Product snapshot 是否可读；
- `eventSource`：必须为 `DefAgentHost.eventJournal`；
- `sidecar.retired: true`、`sidecar.required: false`：确认没有启用旧 sidecar。

若 `uiConnected` 或 `snapshotAvailable` 为 false，先回到桌面 UI 等待 ready，不要创建
第二个 consumer 或绕过 Browser snapshot。

### `POST /agent-host/interop/v1/authorize`

这是一次性的本机 teacher authorization，不需要 body：

```json
{}
```

响应返回短期 `token` 和 `expiresAt`。之后除 status 外的 Interop 请求都使用：

```text
Authorization: Bearer <token>
```

token 只用于本机开发/测试入口，不应写入仓库、截图或测试报告。它过期后重新调用
`authorize`；不要复用旧的 global teacher token。

## Turn 入口

### `POST /agent-host/interop/v1/turns`

从当前 Workbench consumer 绑定的活动 Session 开始一轮：

```json
{
  "clientTurnId": "blackbox-20260808-001",
  "rawUserText": "读取当前队伍状态",
  "providerVisibleUserText": "读取当前队伍状态",
  "ingressMode": "pure-blackbox"
}
```

`rawUserText` 是唯一送入 provider 的用户文本；若提供
`providerVisibleUserText`，两者必须逐字一致。`clientTurnId` 用于重试幂等，复用同一 ID
时不能改变文本。`ingressMode` 默认是 `pure-blackbox`；只有记录诊断目的时才用
`diagnostic`，并且必须提供 `diagnostic.purpose`。

不要提交 `harnessSelector`。当前 Harness Manager 在每轮通过真实的
`def.harness.route` 固定业务 Revision；旧的 global Harness selector 会返回
`legacy-harness-selector-retired`。

响应为 `202`，其中包含 `testRunId`、`sessionId`、`defSessionId`、`turnId`、
`defTurnId`、`clientTurnId`、`eventCursor` 和观察 links。保存这些 ID，不要从文本或
UI 标题猜测 Turn 身份。

### `POST /agent-host/interop/v1/sessions/{defSessionId}/turns`

继续指定 Session 的下一轮。路径中的 Session ID 是必需的；body 可以省略
`sessionId`，也可以提供相同值。请求仍须使用新的 `clientTurnId` 和真实自然语言用户
文本。

### `POST /agent-host/interop/v1/sessions/{defSessionId}/turns/{defTurnId}/stop`

停止活动 Turn。它是幂等的：已到 terminal 的 Turn 会返回 already-terminal 状态。停止
不会伪造 Product command 成功，也不会绕过当前 Host 的 abort/reconcile 语义。

## 观察接口

所有观察接口都从当前 Host projection 读取，响应带有
`protocol: "def-codex-interop"` 和 `protocolVersion: 1`。

| 路径 | 用途 |
| --- | --- |
| `GET /agent-host/interop/v1/sessions` | 列出当前 binding 下的 DEF Sessions |
| `GET /agent-host/interop/v1/sessions/{id}` | 读取 Session 元数据和 engine 标识 |
| `GET /agent-host/interop/v1/sessions/{id}/events` | 读取 Event Journal 分页 |
| `GET /agent-host/interop/v1/sessions/{id}/transcript` | 读取由 Event Journal 投影的 user/assistant/tool transcript |
| `GET /agent-host/interop/v1/sessions/{id}/questions` | 读取 question / approval cards 和状态 |
| `GET /agent-host/interop/v1/sessions/{id}/state` | 读取该 Session 的 binding、checkout、pending 汇总 |
| `GET /agent-host/interop/v1/state` | 读取当前 UI、snapshot、active Session/Turn 和 pending 汇总 |
| `GET /agent-host/interop/v1/ui-events` | 读取 UI consumer opened/closed/binding-changed |

### Event Journal

默认返回 JSON page：

```text
GET .../events?cursor=0&limit=256
```

`cursor` 是 Host `sequence`，也接受 `from` alias；响应的 `nextSequence`、`hasMore`、
`gap` 用于继续读取。事件至少应能观察到：

- `turn.accepted`、`response.first-token`、`response.delta`；
- `tool.requested`、`tool.started`、`tool.result`、`tool.error`；
- `interaction.requested`、`interaction.resolved`；
- `command.queued` / `command.result` / `command.reconciled`（有 Product mutation 时）；
- `turn.completed`、`turn.stopped`、`turn.interrupted` 或 `turn.failed`。

每个事件包含当前 `type`、`sequence`、`cursor`、Session/Turn/Tool/Interaction correlation
和 `payload`；部分事件还带 `legacyType`，它只是读取兼容字段，不代表旧协议已经恢复。

需要实时观察时发送 `Accept: text/event-stream`，或追加 `stream=1`。SSE 先发送 `ready`，
随后用事件名发送同样的 envelope；遇到 terminal event 后关闭，最长保持时间受当前
`streamTtl` 限制。客户端必须保存最后一个 `sequence`，断线后用该 cursor 重放，而不是
依赖连接不丢消息。

### Transcript

`transcript` 是当前 Event Journal 的只读 projection：它把 `turn.accepted`、response
deltas、tool result/error 和 terminal event 合成为 user/assistant/tool messages。它
不是 OpenCode native transcript 的镜像，因此报告中应同时保存原始 events 和 projection
结果；若两者不一致，以 Host journal 为证据并记录 projection 问题。

### Question / approval

`questions` 返回：

- `kind: "question"` 或 `kind: "approval"`；
- `status: "open"`、`answered`、`approved`、`rejected`、`cancelled`、`stale` 等；
- question 的 `prompt`、`questions[].options`；
- approval 的 `proposal`、`proposalHash`、`scope`、binding 和过期时间。

Interop 观察接口本身是只读的。实际回答 question 或批准 mutation 应通过当前可见的
Native UI/Computer Use 和现有 Agent UI interaction API；不要给 Interop 添加旧式直接
写入接口。合同测试为了确定性会在 Host 内部 resolve fake interaction，但这不是桌面
黑盒调用方式。

## Mac Desktop 黑盒记录口径

每次测试至少记录：

1. status readiness、浏览器/桌面 route 和授权时间；
2. 原始自然语言 prompt、`testRunId`、`defSessionId`、`defTurnId`、`clientTurnId`；
3. 首 token、terminal 的事件 sequence/时间；
4. 每个 tool 的 requested/started/result/error、interaction 状态和 Product command 状态；
5. `state` 的 binding、checkout、content revision、selected operators、pending counts；
6. transcript 最终投影、terminal 类型、失败 code/message；
7. 对“通过/失败/阻塞”的判断以及对应 event/可见 UI 证据。

纯黑盒 prompt 应保持自然，不把“请调用某工具”“必须返回某 JSON”或测试 case 名写进
用户文本。工具序列、Harness revision、provider error 和 approval 是否出现，应从
Event Journal 与可见 UI 观察，而不是从测试脚本预设。

若 UI 未 ready、consumer 丢失、snapshot 过期、Native UI 没有问题卡片或 Host event
stream 断开，标记为 blocked 并记录 `status/state` 和最后 cursor；不要删除 native
Session、清空 Host store、重启正在运行的 `electron:dev` 进程来掩盖问题。人工确认 UI
后，退出 AI mode 时使用界面上的“返回”，再结束本轮。

## 测试命令与边界

```bash
npm run test:agent-interop   # 当前 Interop route 合同测试
npm run test:agent-host      # Host 合同测试 + Interop 合同测试
npx tsc -p tsconfig.agent.json --noEmit
```

合同测试覆盖状态/授权、普通工具 Turn、幂等重试、Event Journal、SSE、transcript、
question、approval-stop、provider failure、text 一致性和旧 selector 拒绝。它不能替代
真实 Mac Desktop Computer Use 验收，也不证明 provider 网络、真实 OpenCode runtime 或
浏览器可见 postcondition；这些仍需按本目录的浏览器边界记录证据。
