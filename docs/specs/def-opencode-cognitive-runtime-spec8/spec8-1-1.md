# Spec 8-1-1：OpenCode 后门与 Codex 联调协议

## 状态

规格已形成，等待后续任务拆分与实现。

## 一句话定调

**打通 `def-opencode` 的本地调测后门，形成高级 Codex 可稳定发起 turn、继续会话、订阅事件、读取状态与关联真实 UI 的联调协议。**

## 背景

仓库仍保留 `/def-agent/workbench-test/prompt`、session transcript/events 和 `ui-events` 等旧后门能力，说明这条路线没有消失；但当前入口更像零散测试辅助：

1. `buildWorkbenchTestPrompt` 会把工具和安全流程拼进 provider-visible user text，污染真实黑盒；
2. prompt、session、SSE、Workbench snapshot 与 UI event 虽然存在，但没有一个面向高级 Codex 的统一协议；
3. start、continue、stop、timeout、sidecar/Electron 重启后的语义与错误结构尚未被稳定定义；
4. Computer Use 看到的前端 turn 与后门内部 session/trace 缺少统一 correlation id；
5. Diagnostic 与真实 Pure Blackbox 没有清晰分线，容易把带答案的调试成功误报为产品能力。

8-1-1 只解决“Codex 如何可靠接入和观察 DEF”，不提前建设 Harness 迭代算法。

## 目标

1. 定义 `DefCodexInteropProtocol v1`；
2. 保留并修正真实 Workbench 可见链路；
3. 区分 Pure Blackbox 与 Diagnostic；
4. 统一 run/session/turn/UI correlation；
5. 提供发起、继续、观察、停止和状态读取的最小能力；
6. 让外部 Codex/Computer Use 无需理解 Electron/sidecar 内部实现即可完成一次调测；
7. 将后门限制在本地开发环境，避免演化为生产远程控制接口。

## 协议角色

```text
Codex Teacher Client
  ├─ Repository tools      读取与返修代码
  ├─ Computer Use          观察真实桌面 UI
  └─ DEF interop client    调用后门、订阅事件、读取状态

Electron bridge
  ├─ 启动/发现 DEF sidecar
  ├─ 校验本地教师权限
  ├─ 关联 testRunId/sessionId/turnId
  └─ 转发 prompt、events、transcript、state

def-opencode
  └─ 作为普通 Workbench Agent 执行真实 turn
```

## 第一部分：Handshake 与能力发现

协议必须提供只读 handshake/status，至少返回：

```json
{
  "protocol": "def-codex-interop",
  "protocolVersion": 1,
  "developmentOnly": true,
  "bridge": { "ready": true, "version": "..." },
  "agent": { "ready": true, "version": "..." },
  "workbench": { "snapshotAvailable": true, "uiConnected": true },
  "capabilities": [
    "turn.start",
    "turn.continue",
    "turn.stop",
    "events.subscribe",
    "transcript.read",
    "state.read",
    "ui-events.subscribe"
  ]
}
```

Codex 应能在不发送测试消息的情况下判断缺少的是 Electron bridge、DEF sidecar、Workbench snapshot 还是 UI consumer。

## 第二部分：统一标识

协议至少使用：

- `testRunId`：一次完整教师联调；
- `scenarioId`：可选，指向后续 Harness scenario；
- `sessionId`：DEF/OpenCode 会话；
- `turnId`：服务端稳定 turn id；
- `clientTurnId`：调用端幂等与 UI 关联 id；
- `uiEventId`：真实前端消费事件；
- `traceCursor/seq`：事件断线续读位置。

所有 HTTP/SSE/文件证据均能通过这些 id 关联，不能继续依赖时间戳猜测某个 UI turn 对应哪次后门调用。

## 第三部分：Pure Blackbox 与 Diagnostic

| 模式 | 用途 | provider-visible user text | 调试注入 |
| --- | --- | --- | --- |
| `pure-blackbox` | 证明真实产品能力 | 与 `rawUserText` 完全一致 | 禁止 |
| `diagnostic` | 定位工具、状态或流程问题 | 完整记录最终文本 | 允许、显式声明 |

Pure Blackbox 要求：

- 移除 `buildWorkbenchTestPrompt` 对 user text 的工具/流程包装；
- host、agent、Workbench context 通过独立字段/source 传递；
- 继续走 `prompt → ui-events → MainWorkbenchAiPanel`；
- `rawUserText` 和 `providerVisibleUserText` 同时记录并相等；
- 不允许测试编号、预期工具、验收说明混入用户话术。

Diagnostic 要求：

- 记录原始文本、注入内容、原因和最终 provider-visible messages；
- 显式标记 `ingressMode=diagnostic`；
- 不得在报告中冒充 Pure Blackbox 成功；
- mutation 默认停在 diff，除非测试环境明确授权。

## 第四部分：最小命令面

协议语义至少覆盖：

| 能力 | 作用 |
| --- | --- |
| `turn.start` | 创建 Workbench session 并发送首个 turn |
| `turn.continue` | 在同一 session 发送自然后续 |
| `turn.stop` | 停止进行中的生成/工具循环 |
| `events.subscribe` | 从 seq/cursor 订阅 Agent 事件 |
| `transcript.read` | 读取 provider-visible transcript |
| `state.read` | 读取当前 Workbench snapshot/checkout/revision 摘要 |
| `ui-events.subscribe` | 确认真实前端已消费 prompt/turn |

具体 REST 路径可以复用现有接口或在 tasks 中整理，但外部 Codex 只依赖协议语义，不依赖 Electron 内部函数名。

## 第五部分：事件与错误合同

事件至少区分：

- accepted / session-created；
- response-first-token；
- tool-start / tool-result / tool-error；
- permission/approval waiting；
- completed / stopped / timeout / max-step / provider-error；
- ui-prompt-consumed / ui-rendered；
- snapshot-unavailable / checkout-changed。

错误返回必须结构化包含：

- stable error code；
- retryable；
- failed component；
- run/session/turn ids；
- 建议的唯一恢复动作（若存在）；
- 原始内部错误引用，不把敏感堆栈直接暴露给 UI。

## 第六部分：Computer Use 关联

本阶段不在 DEF 内实现 Computer Use tool；外部高级 Codex 使用现有 Computer Use 能力。协议需要确保：

- testRunId/clientTurnId 能在 UI event 或可观察 DOM 属性中关联；
- Codex 能判断消息已经进入真实 MainWorkbenchAiPanel；
- UI 显示 ready/streaming/waiting/complete/error 的状态可与事件流核对；
- Computer Use 截图/观察记录能够附加同一 testRunId；
- UI 不可见但 API 成功时，协议必须报告为联调链路不完整。

## 第七部分：本地安全

- 只在 development/test profile 启用；
- 仅 bind localhost；
- 使用临时 token 或等价的本地授权；
- release 构建不得启用教师 mutation；
- 默认使用隔离 session/Work Node；
- 不提供任意文件读取、终端或跳过 permission 的后门；
- 协议调用写入 append-only audit；
- 不主动关闭或重启已有 `electron:dev`，除非修改 Electron bridge 或发生明确阻塞。

## 验收标准

- [ ] Codex 可通过 handshake 判断 bridge、sidecar、Workbench snapshot 和 UI consumer 状态。
- [ ] start、continue、stop、events、transcript、state、ui-events 具有稳定协议语义。
- [ ] testRunId/sessionId/turnId/clientTurnId 能关联一次完整调测。
- [ ] Pure Blackbox 的 raw/provider-visible user text 完全一致。
- [ ] Diagnostic 注入可审计，且不会被误报为真实黑盒结果。
- [ ] 一个普通只读 turn 能从后门进入真实 MainWorkbenchAiPanel，并被 Codex 同时从 UI 和事件流观察。
- [ ] 一个 mutation preview turn 能完成草稿/validation/diff，但不会未经批准 use。
- [ ] 断线后可以从 seq/cursor 恢复事件读取，不重复执行 turn。
- [ ] snapshot 缺失、sidecar 未就绪、timeout、stop 和 provider error 有稳定错误码。
- [ ] 非开发/release 环境无法调用教师 mutation 能力。

## 明确不做

- 不建立 replay 和 hidden regression；
- 不建立 HarnessProposal/Version；
- 不实施 Codex 自动返修；
- 不接入 YZ/Knowledge Runtime；
- 不创建 tasks 或提前进入 8-1-2。

## 完成定义

当高级 Codex 能依赖一份稳定协议，而不是临时脚本或内部实现知识，完成“发现环境 → 发起/继续 turn → 观察 UI/事件/状态 → 停止或收尾”的真实 DEF 联调时，8-1-1 完成。
