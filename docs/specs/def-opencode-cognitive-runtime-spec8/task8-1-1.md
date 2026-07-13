# Task 8-1-1：打通 OpenCode 后门与 Codex 联调协议

## 状态

实施中：v1 bridge、真实 UI 链路、聚焦协议检查与黑盒记录已落地；完成勾选以本次 verification 证据为准。

Task 8-1-1 是 Spec 8-1-1 的唯一总实施任务，不是前置盘点。允许按检查点分批编码、黑盒验证和提交，但任务完成必须意味着高级 Codex 已能依赖稳定协议完成一次真实 DEF Workbench Agent 联调。

## 当前代码基线

实施前确认并保留以下事实：

- Electron bridge 监听 `127.0.0.1:31457`，主要实现位于 `electron/main.cjs`；
- 开发代理 `agent/dev-agent.cjs` 维护一份近似的后门与聊天转发实现；
- DEF sidecar 使用 `127.0.0.1:17322`，Workbench snapshot 当前来自 `127.0.0.1:17321`；
- 已存在 `POST /def-agent/workbench-test/prompt`、session events/transcript/message/stop 和 `GET /def-agent/workbench-test/ui-events`；
- `src/utils/defAgent.ts` 已有 session start/continue/stop、events、transcript 和 UI event helper；
- 当前 `buildWorkbenchTestPrompt()` 会给用户文本追加 native tools、legacy REST、Work Node、validate/diff/approval 教程，Pure Blackbox 被污染；
- `ui.prompt` 生产端和 `subscribeWorkbenchTestUiEvents()` helper 仍在，但当前非 vendor 前端代码中没有找到实际 consumer，必须确认原生 OpenCode UI 迁移后可见链路是否已经断开；
- 现有 `from` 参数支持 session event 续读，但 UI event history 只有内存中最近 20 条且没有正式 seq/cursor 合同；
- 当前 `clientTurnId` 默认使用时间戳字符串，尚未构成完整 testRun/session/turn/UI 关联模型。

如果实施审计发现上述事实已因并行改动变化，以实际代码为准更新本任务和验证记录，不能按旧文档臆测。

## 总目标

交付 `DefCodexInteropProtocol v1`：

```text
Codex Teacher Client
  → handshake / status
  → pure-blackbox 或 diagnostic turn.start
  → session continue / stop
  → events / transcript / state / ui-events
  → Computer Use 观察真实 DEF OpenCode UI
```

协议完成后，高级 Codex 不需要理解 Electron main、dev-agent、sidecar 的内部函数，也不需要临时拼 curl 脚本，便能可靠完成环境发现、发起 turn、继续会话、观察事件与 UI、读取状态、停止和错误恢复。

## 完成定义

以下八个部分必须全部完成：

1. 冻结 `DefCodexInteropProtocol v1` 合同和唯一事实源。
2. 建立只读 handshake/status 与本地教师授权。
3. 建立稳定的 run/session/turn/UI correlation 和幂等边界。
4. 修正 Pure Blackbox，并建立显式 Diagnostic 通道。
5. 统一 start/continue/stop/events/transcript/state/ui-events 命令面。
6. 建立带 seq/cursor 的事件与稳定错误合同。
7. 恢复当前真实 DEF OpenCode UI 的可见消费链路，并完成 Computer Use 联调。
8. 完成只读与 mutation preview 两组真实黑盒验收和协议文档。

---

## 第一部分：协议审计与唯一事实源

### 1.1 审计现有链路

- [x] 逐项记录 Electron bridge、`agent/dev-agent.cjs`、DEF sidecar 和前端 helper 的实际 route、method、request、response、event 与错误结构。
- [x] 确认 `electron/main.cjs` 与 `agent/dev-agent.cjs` 分别在什么运行模式使用，禁止误删仍被 Windows/开发流程调用的入口。
- [x] 确认当前原生 DEF OpenCode UI 如何发现/切换/hydrate session，以及 `ui.prompt` 是否仍有真实 consumer。
- [ ] 确认 Workbench snapshot、checkout、revision 和 session metadata 的当前权威来源。
- [ ] 确认 sidecar `/api/chat/:session/events` 的 seq/from、重连、完成和错误语义。
- [x] 确认相同 `clientTurnId` 重试是否会重复执行 turn；没有幂等保证时明确补齐。
- [x] 形成旧 route → v1 capability 对照，不把遗留 route 数量直接当成协议能力。

### 1.2 建立协议 schema

- [x] 为 v1 定义 request/response/event/error schema，不再让 Electron、dev-agent、前端各自维护隐式结构。
- [x] schema 至少覆盖 status、start、continue、stop、events、transcript、state、ui-events。
- [x] 定义 `pure-blackbox`、`diagnostic` 两种 ingress enum。
- [x] 定义 stable ids、cursor、timestamps、component status 和 retryability。
- [x] 对未知字段保持向前兼容；对未知 protocol major version 明确拒绝。
- [x] schema 可被 CommonJS bridge 和 TypeScript 前端/client 共同消费或由同一源派生。

### 1.3 收敛重复实现

- [x] 将协议常量、id/error/event 构造和 request validation 收敛到可由 Electron bridge 与 dev-agent 复用的模块。
- [x] `electron/main.cjs` 与 `agent/dev-agent.cjs` 保留各自进程管理/transport 适配，但不再复制协议业务语义。
- [x] `src/utils/defAgent.ts` 的类型和 helper 从 v1 contract 对齐，不手写另一套相似返回结构。
- [x] sidecar adapter 只负责 OpenCode session/runtime，不承担 Teacher 协议的本地安全与 UI correlation。
- [x] 保留旧 route 兼容时，统一转到 v1 handler；禁止复制业务逻辑。

---

## 第二部分：Handshake、状态发现与教师授权

### 2.1 只读 handshake/status

- [x] 新增或整理一个不发送用户消息、默认不隐式创建 session 的 status 能力。
- [x] 返回 protocol name/version、developmentOnly、bridge/sidecar/workbench/UI readiness。
- [x] 返回 snapshot 是否可用、当前 UI consumer 数、可用 capability 清单。
- [ ] 返回 bridge/agent build/version 摘要，但不泄露用户目录、token、完整环境变量或敏感配置。
- [ ] sidecar 未启动时明确区分 `not-started`、`starting`、`unhealthy`，不统一报 500。
- [ ] snapshot 服务、UI consumer 或 OpenCode runtime 缺失时给出稳定 component code。

### 2.2 本地教师授权

- [x] Teacher/Diagnostic mutation 只在明确 development/test profile 启用。
- [x] bridge 继续只监听 loopback，拒绝非本地来源或错误 Host/Origin 组合。
- [x] 为教师 mutation 能力增加临时 token 或等价的本地能力证明。
- [x] token 不写入前端 bundle、Git、普通 transcript 或 UI event payload。
- [ ] Pure Blackbox 前端内部使用与外部 Codex 教师调用的授权边界明确，不破坏现有用户正常聊天。
- [x] production/release profile 对教师 mutation route返回稳定 `teacher-ingress-disabled`，而不是静默放行。
- [x] append-only audit 记录 testRunId、调用模式、时间、动作和结果，不记录敏感 token。

---

## 第三部分：统一标识、幂等与生命周期

### 3.1 Stable ids

- [ ] 使用 UUID 或等价稳定随机 id 生成 `testRunId`、`turnId`、`uiEventId`，不再仅依赖 `Date.now()`。
- [ ] 保留调用方提供的 `clientTurnId`，并验证长度、字符集和重复语义。
- [ ] 明确 `scenarioId` 为可选透传字段，8-1-1 不实现 Scenario engine。
- [ ] response、SSE event、transcript metadata、UI event 和 audit 均携带足够的关联 id。
- [ ] session continuation 保持同一 testRunId，新的用户消息产生新 turnId/clientTurnId。

### 3.2 幂等与重复请求

- [x] 同一 session + clientTurnId 的重复 start/continue 不得重复执行工具副作用。
- [x] 重复请求返回原 turn/session 状态或稳定 conflict，不创建第二条模糊 turn。
- [x] 网络超时但服务端已 accepted 时，Codex 能通过 clientTurnId 查询/恢复，而不是重新发送。
- [x] stop 对已完成/已停止 turn 幂等，并返回明确 reason。
- [ ] session 不存在、已归档、正在运行、等待 permission 等状态有明确生命周期错误。

### 3.3 Run 收尾

- [ ] 定义 completed、stopped、timeout、max-step、provider-error、bridge-error 的终态。
- [ ] run/session/turn 状态不会因 UI SSE 断开而自动取消。
- [ ] UI consumer 晚连接时可以关联当前 turn，而不会把历史 replay 当成新消息重复展示。
- [ ] 测试结束可显式关闭订阅和停止未完成 turn，不提供破坏其他 session 的全局 stop 作为默认路径。

---

## 第四部分：Pure Blackbox 与 Diagnostic 分线

### 4.1 修正 Pure Blackbox

- [ ] 删除 `buildWorkbenchTestPrompt()` 对 user text 追加工具、legacy REST、Work Node 和 approval 教程的行为。
- [ ] Pure Blackbox 保存 `rawUserText` 与 `providerVisibleUserText`，二者必须完全一致。
- [ ] host=`workbench`、agent=`def-workbench`、Workbench context 通过独立结构化字段/source 注入。
- [ ] 普通测试消息不包含“这是测试”、case id、expected tool、验收标准、安全说明或实现细节。
- [ ] current snapshot 缺失时显式记录 `snapshotAvailable=false`，不在 user text 中补偿说明。
- [ ] 继续使用真实 Workbench agent/session/profile，不允许改为直调某个 typed tool 的伪黑盒。

### 4.2 建立 Diagnostic

- [ ] Diagnostic 使用独立 ingress mode/route 或同一协议的显式 discriminated request。
- [ ] 请求分别保存 raw text、structured diagnostic instruction、最终 provider-visible messages。
- [ ] 注入内容必须说明目的、scope 和是否允许 mutation。
- [ ] Diagnostic 结果在 UI、trace、返回体和验证记录中都有醒目标记。
- [ ] Diagnostic 默认只读或停在 validated diff；需要 use 时只能在隔离 fixture 和明确授权下执行。
- [ ] 不允许 Diagnostic 成功覆盖/替代 Pure Blackbox 验收失败。

---

## 第五部分：统一命令面与状态读取

### 5.1 Start / Continue

- [ ] `turn.start` 能创建正确的 Workbench OpenCode session并返回 testRunId/sessionId/turnId/clientTurnId。
- [ ] `turn.continue` 在指定 session 内发送自然后续，保持 host/agent/session 绑定。
- [ ] start/continue 均支持 thinking effort，但默认选择逻辑不伪装为用户输入。
- [ ] session create/continue 后立即返回 accepted 与事件订阅位置，不等待完整模型结果。
- [ ] response 提供规范化 events/transcript/state/ui-events links 或 capability refs。

### 5.2 Stop

- [ ] `turn.stop` 精确停止指定 session/turn，不默认停止所有 DEF chat。
- [ ] stop 返回 stopped/already-complete/not-running 等稳定结果。
- [ ] 停止不会回滚已经完成的确定性工具副作用，也不会将未 use 草稿误报为已应用。
- [ ] legacy global stop 如需保留，明确标为兼容能力，不作为 Codex 协议默认调用。

### 5.3 Events / Transcript

- [ ] events 支持从 seq/cursor 续读，并在 ready payload 返回当前 head/earliest cursor。
- [ ] transcript 返回 provider-visible messages，并保留 session/turn/clientTurn 关联。
- [ ] transcript 不混入未标记的测试教程、内部敏感 prompt 或其他 host session。
- [ ] events 与 transcript 的 completed/failed 状态一致；不一致时返回诊断错误而非静默选一边。

### 5.4 State

- [ ] 提供有界、只读的当前 Workbench state 摘要，至少包含 snapshot availability、checkout、revision、selected operators 和 pending node/approval 摘要。
- [ ] state 标记 source、schemaVersion、updatedAt，不把陈旧 snapshot 当实时事实。
- [ ] state 不返回完整任意用户文件或未限定的 repository 数据。
- [ ] state 读取失败不阻止只读 handshake，但必须阻止依赖当前轴的 mutation preview 被误判通过。

---

## 第六部分：事件、Cursor 与错误合同

### 6.1 规范化事件

- [x] 至少规范化 accepted、session-created、response-first-token、tool-start、tool-result、tool-error。
- [ ] 至少规范化 permission-waiting、approval-waiting、completed、stopped、timeout、max-step、provider-error。
- [ ] 至少规范化 ui-prompt-consumed、ui-session-opened/ui-rendered、snapshot-unavailable、checkout-changed。
- [ ] 每个事件包含 protocolVersion、seq、at、testRunId、sessionId、turnId 和必要 payload。
- [ ] 不把内部 OpenCode 事件完整无界透传；保留 `rawEventRef` 或调试摘要供诊断。

### 6.2 UI event cursor

- [ ] 将当前“最近 20 条无 seq 内存历史”升级为带单调 seq/cursor 的有界事件缓存。
- [ ] 新 consumer 能声明 from/cursor，区分历史 replay 与实时事件。
- [ ] history 被截断时返回 earliest cursor 和 gap 标记。
- [ ] 同一 uiEventId 不会被当前 UI 重复消费成两条用户消息。
- [ ] SSE client 断开时清理资源，不影响 Agent turn。

### 6.3 稳定错误结构

- [ ] 错误包含 `code`、`message`、`component`、`retryable`、关联 ids 和可选 `nextAction`。
- [ ] 区分 bridge、sidecar、provider、session、snapshot、UI consumer、permission 和 protocol validation 错误。
- [ ] malformed request 使用 4xx；上游不可用/超时使用对应 5xx/504，不统一包装为假 `ok`。
- [ ] nextAction 只能给出安全、唯一且真实存在的恢复动作。
- [ ] UI 返回用户可理解摘要，完整堆栈只进入本地诊断日志引用。

---

## 第七部分：恢复真实 UI 消费与 Computer Use 联调

### 7.1 确认当前 UI 入口

- [ ] 识别 Spec 7 后真实 Workbench 使用的是哪一个原生 DEF OpenCode view/session controller。
- [ ] 不机械复活已经被替换的旧 `MainWorkbenchAiPanel`；后门必须驱动当前产品 UI。
- [ ] 清理或迁移没有 consumer 的 `subscribeWorkbenchTestUiEvents()` helper，避免保留误导性死接口。
- [ ] 若采用 native session focus/hydrate 取代旧 `ui.prompt` consumer，更新协议和测试文档，保持“后门 turn 对用户可见”的性质。
- [ ] UI 只消费属于当前 host/testRun/session 的事件，不串到 `/AI CLI`。

### 7.2 UI correlation

- [ ] 当前 DEF OpenCode UI 能显示后门发起的用户消息、流式回复、工具/permission/diff 状态。
- [ ] UI 可通过安全的 DOM/data attribute、session metadata 或事件状态关联 clientTurnId/testRunId，不向普通用户展示内部 id。
- [ ] history replay 不会重复插入已经由 native transcript hydrate 的消息。
- [ ] UI 显示 ready/streaming/waiting/complete/error 与协议事件一致。
- [ ] UI 不可见但 API/sidecar 成功时，验收明确失败。

### 7.3 Computer Use 验证

- [x] 按真实桌面流程进入 Workbench、打开 AI 模式并确认 DEF ready。
- [x] 通过协议发起自然语言 turn，同时用 Computer Use 观察消息和回复。
- [x] 保存关键 UI 观察/截图，并在验证记录中关联 testRunId/sessionId/clientTurnId。
- [ ] 验证 permission/diff 等交互真实可见，而不是只看 transcript。
- [ ] 如果使用 Chrome Extension 补充 Windows 路线，明确其不是桌面 Computer Use 结论。

---

## 第八部分：验收、文档与清理

### 8.1 协议级检查

- [x] 为 request validation、idempotency、cursor resume 和 error mapping 增加最小必要的自动检查；本任务协议风险高，允许增加聚焦测试，但不扩展成无关测试重构。
- [x] 检查同一 clientTurnId 重试不会重复执行。
- [x] 检查 events/UI events 断线续读不会重复 turn 或重复 UI 消息。
- [x] 检查 release/non-dev profile 拒绝教师 mutation。
- [ ] 检查 Workbench 与 `/AI CLI` 的 session/event/state 无串线。

### 8.2 自然语言黑盒矩阵

- [ ] 按 `docs/testing/def-agent-blackbox.md` 使用普通用户话术，不把预期工具和规则写进 prompt。
- [x] 只读 case：发起新 session，读取事件/transcript/state，并在当前 UI 可见。
- [ ] 多 turn case：Agent 正常追问后，用自然语言 continue，同一 session 正确延续。
- [ ] mutation preview case：创建隔离草稿，完成 validation/diff，未 use 当前轴。
- [ ] stop case：停止指定进行中 turn，不影响其他 session。
- [ ] snapshot unavailable case：返回明确错误/降级，不猜当前轴。
- [ ] UI consumer unavailable case：API 成功不能被判定为完整联调成功。
- [ ] 每个 case 记录 prompt、ids、首响/完成时间、工具、状态变化、pending command 和最终判定。

### 8.3 文档

- [x] 在 Spec 8-1-1 verification 中记录实际 route map、protocolVersion 和验收证据；具体 verification 文件在实施完成时创建。
- [x] 更新 `docs/testing/def-agent-blackbox.md`，将旧 `MainWorkbenchAiPanel` 表述校准为当前真实 DEF OpenCode UI。
- [x] 记录 Codex client 的 handshake/start/continue/events/state/stop 最小调用示例。
- [x] 明确 Pure Blackbox 与 Diagnostic 的报告用语。
- [x] 记录 Electron bridge 修改后需要重启、普通 sidecar/UI 改动的最小刷新方式。

### 8.4 清理

- [x] 删除失去 consumer 的旧 helper、重复 prompt builder 和无调用 route；删除前必须证明替代链路已验收。
- [x] 不保留 v1、新 route、旧 route 三套独立业务实现。
- [x] 不引入任意终端、文件或跳过 permission 的“万能教师后门”。
- [x] 工作区无临时 trace、截图、token、debug 文件或无关生成物。

## 交付物

- `DefCodexInteropProtocol v1` schema 与共享实现；
- Electron/dev-agent 的协议适配和本地授权；
- Codex 可用的 handshake/start/continue/stop/events/transcript/state/ui-events 能力；
- 修正后的 Pure Blackbox 与显式 Diagnostic；
- 当前真实 DEF OpenCode UI 消费与 Computer Use 联调链路；
- 聚焦协议检查与自然语言黑盒记录；
- 更新后的测试文档与 Spec 8-1-1 verification。

## 禁止越界

- 不实现 Spec 8-1-2 的 Turn Trace Bundle、Scenario Replay、Hidden Regression、HarnessProposal 或 HarnessVersion；
- 不接入 Spec 8-2 的 YZ/Knowledge Runtime；
- 不自动返修 prompt/skills；
- 不训练模型权重；
- 不用 Diagnostic 成功替代 Pure Blackbox；
- 不以恢复旧 UI 组件为目标，必须服务当前真实 DEF OpenCode 产品界面。
