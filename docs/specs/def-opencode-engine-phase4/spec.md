# OpenCode EngineAdapter Phase 4 Spec

## Status

实施完成，验证通过。

## Background

Phase 1 已建立引擎无关的 Session、Turn、Event 与双向 `AgentEngine` 合同；Phase 2 已建立独立 Agent Host、Electron 懒启动、隐藏 AI 模式和 Browser ProductGateway；Phase 3 已完成 DEF Harness 与 selection/loadout/timeline/buff/calculation 五条只读 Tool 链路。

本阶段第一次接入真实 Agent Loop，但不恢复旧 AI 产品栈。OpenCode 只是一套 `AgentEngine` 实现，DEF Session、Harness、Tool、ProductGateway、事件与 UI 仍由当前代码拥有。

证据与参考线：

- 当前基线：`3483b525`；
- 旧 AI 参考分支：`codex/def-opencode-spec9-2-implementation@bcea5f12`；
- 固定上游版本：OpenCode `1.17.11`；
- 旧动态 Tool projection 补丁：该分支的 `agent/vendor/opencode/packages/opencode/src/session/llm.ts` 与 `session/llm/request.ts`；
- 旧插件行为参考：`agent/runtime/def-tools/opencode/plugin.js`；
- [OpenCode 引擎回迁、可替换 Agent 架构与完整生命周期调研](../../architecture/audits/opencode-engine-reintegration-research-20260806.md)；
- [DEF Harness 与五业务只读 Tool Phase 3](../def-agent-harness-phase3/spec.md)。

旧分支只提供 OpenCode API、动态 projection patch 和进程行为证据。旧 `def-agent-server.cjs`、Sidecar、固定 `17321/17322`、Node SQLite、旧 Harness Manager、旧 Tool wrapper、原生 OpenCode UI 和 AI CLI 不得复制。

## Goal

本阶段完成：

- 实现生产 `OpenCodeEngineAdapter`，严格满足现有 `AgentEngine` / `EngineTurnHandle`；
- 使用固定、校验过的 OpenCode `1.17.11-def.1` runtime，不从 PATH 猜测版本；
- 使用私有随机 loopback OpenCode server 与私有 Tool bridge；
- 将 canonical DEF Tool 名映射为 provider-safe OpenCode binding，并在每个模型 step 只投影当前 Harness Tool；
- 把 OpenCode 文本流、Tool call、失败、abort 和 terminal 映射为稳定 `EngineEvent`；
- 保证 Tool result 与下一 projection 在 Engine 恢复推理前原子接受；
- 保证 DEF Session ID 与 OpenCode Session ID 分离，并支持同 runtime/store schema 下恢复、删除和 shutdown；
- 将 runtime、plugin、manifest、checksum 与许可证按窄边界打入 Electron 包；
- 用 deterministic OpenAI-compatible provider stub 驱动真实 OpenCode binary，完成五条只读业务路线的纵向黑盒；
- 保持普通 Slim、MCP、Browser SQLite 和现有 Electron Shell 独立正常。

## Phase Boundary

本阶段只恢复 Engine 层。

允许新增：

```text
agent/engines/opencode/**
scripts/prepare-opencode-runtime.mjs
scripts/verify-opencode-runtime.mjs
```

允许修改：

```text
agent/runtime/host-entry.ts
agent/host/http-server.ts
scripts/build-agent-runtime.mjs
scripts/check-desktop-package.mjs
scripts/repository-check.mjs
electron/agent-runtime.cjs
electron/agent-runtime.test.cjs
package.json
```

依赖方向：

```text
DefAgentHost → AgentEngine
OpenCodeEngineAdapter → core contracts
OpenCodeEngineAdapter → private runtime/process/HTTP bridge
OpenCode plugin bundle → private Tool bridge only
Electron → Host lifecycle and private filesystem paths only
```

禁止：

- `agent/core/**`、`agent/host/**`、`src/**` import OpenCode；
- OpenCode adapter import React、Electron、Browser SQLite、ProductGateway 实现或业务 Tool handler；
- 浏览器知道 OpenCode 端口、token、Session ID、provider secret 或插件协议；
- Electron 理解 Harness phase 或业务 Tool；
- OpenCode plugin直接读取产品数据、SQLite、Work Node 或旧 REST；
- 任意旧 `17321/17322`、Sidecar、AI CLI 或原生 OpenCode UI 回归。

## Non-Goals

本阶段不做：

- 不新增聊天框、会话列表、消息发送按钮或公开 Browser Turn API；
- 不恢复 AI CLI、bare OpenCode UI 或 iframe；
- 不实现 Question/Approval UI、mutation/proposal Tool 或产品写操作；
- 不实现 Provider 设置界面、凭据迁移或系统钥匙串；
- 不实现 Session/Event Journal 的跨 Host 持久化；
- 不实现 Engine A/B 升级、自动下载、自动更新或 Pi adapter；
- 不升级 OpenCode；
- 不把 OpenCode vendor source、UI assets、Bun 或完整 `node_modules` 放进发布包；
- 不承诺 Windows runtime 已完成；代码必须按 target 解析，当前验收 artifact 为 `darwin-arm64`。

Provider 设置 UI 和产品聊天生命周期属于后续阶段。Phase 4 可从 Shell-owned 私有 profile 文件读取配置，也可由测试注入 profile source；缺少 profile 时返回 typed unavailable，不创建半成品 Session。

## Runtime Artifact Contract

runtime 由受控 manifest 描述，至少包含：

- `schemaVersion`；
- `engineKind: opencode`；
- `runtimeVersion: 1.17.11-def.1`；
- `upstreamVersion: 1.17.11`；
- `sourceRef: codex/def-opencode-spec9-2-implementation@bcea5f12`；
- target、binary 相对路径、受控 source bytes/SHA-256、签名归一化 code bytes/SHA-256 与 `--version` 期望值；
- plugin bundle 相对路径与 SHA-256；
- store schema version；
- OpenCode MIT License。

`agent:runtime:prepare` 只接受显式 source binary 或已经存在且完全匹配的缓存。它不得从 PATH 取任意 `opencode`，不得静默联网下载，也不得接受 checksum、size 或 `--version` 不匹配的文件。

`agent-runtime:build` 构建 Host 和自包含 plugin bundle，并在已准备 runtime 存在时复制到：

```text
dist/agent/engine/opencode/
  manifest.json
  runtime-lock.json
  LICENSE
  plugin.mjs
  bin/<target>/opencode-1.17.11
```

Electron 发布包必须把上述目录放在 `app.asar.unpacked`。包内不得包含 vendor source、OpenCode Web UI、Bun 或另一个平台 binary。

`darwin-arm64` source binary 必须先有有效 macOS 签名。Electron 可用本地 ad-hoc 或发布 Developer ID 对包内 binary 重签；runtime manifest 因此校验“有效签名 + 去签名后的稳定 code digest”，而 runtime lock 继续精确锁定 source artifact。整个 `.app` 还必须通过 `codesign --verify --deep --strict`，避免“文件齐全但不可作为 Mac 应用执行”的假通过。

## Provider Profile Contract

Adapter 通过注入的 profile source 按 `providerProfileRef` 解析：

- profile ref；
- provider ID 与显示名；
- OpenAI-compatible base URL；
- model ID；
- API key；
- context/output limit；
- 可选额外 HTTP headers 的严格白名单。

生产 Host 默认只读 Shell-owned、权限受限的 JSON profile 文件。该文件路径由 Electron 传给 Host，不进入浏览器、DEF Event、日志、ready manifest 或 OpenCode Session metadata。

Profile 缺失、损坏或 ref 不存在时：

- `probe` 返回 `unavailable`；
- `createSession` / `startTurn` 返回 typed Engine 错误；
- 普通 Workbench 和 MCP 不受影响；
- 不启动 OpenCode 子进程。

## Runtime Process Contract

- `probe()` 校验 manifest、target、binary、plugin、checksum 和 profile readiness，但不启动 OpenCode；
- `createSession()` 首次需要时才启动 OpenCode；
- OpenCode 仅监听 `127.0.0.1` 随机端口；
- Tool bridge 仅监听 `127.0.0.1` 随机端口并要求每请求 constant-time token；
- runtime ready 必须同时通过 OpenCode health、六个 DEF Tool 注册和带 process nonce 的 plugin handshake；
- runtime 使用 adapter-owned XDG/store/workspace 目录，不读写用户全局 OpenCode 目录；
- 禁用 share、project config、通用 bash/edit/read/task/web/MCP Tool 和自动升级；
- 相同 runtime/profile 可复用进程；运行 profile 改变时不得热切正在执行的 Turn；
- 子进程异常退出时所有 active Turn 只产生一个 `turn.failed`；
- 每次进程启动递增 runtime epoch；崩溃后的 Session 必须显式 recover，不能继续使用旧端口；
- SSE 异常先对 OpenCode Session 发出 abort，再把 Session 标记 detached；recover 必须再次幂等 abort 并确认 `/session/status` 已 idle；
- `shutdown()` 先 abort Turn，再关闭 bridge，再停止 OpenCode，且幂等；
- Host 写入权限受限的进程所有权清单 v2，同时绑定 Host/OpenCode PID 与各自的进程出生身份；Electron 每次 TERM/KILL 前重新核验身份，PID 已复用时只移除过期清单、绝不发送信号；无法确认身份或退出时保留清单并 fail closed；
- 新 Host 启动前清理死 Host 遗留的受信清单；活 Host 清单视为冲突，不重复启动；Host 同时监视 Electron parent PID，父进程消失时自行有序 shutdown；
- OpenCode 停止失败后 supervisor 必须保留旧 child/清单并拒绝再次 start；Host shutdown 失败时由有界强制退出兜底，下一次 Electron 启动再按进程身份安全清理；
- Electron/App 退出后不得残留 OpenCode 子进程。

## Canonical Tool Binding

OpenCode/provider-safe 名称只存在于 adapter/plugin 内部：

| Canonical DEF Tool | OpenCode binding |
| --- | --- |
| `def.harness.route` | `def_harness_route` |
| `def.node.crud.context` | `def_node_crud_context` |
| `def.data.resource.team_loadouts` | `def_data_resource_team_loadouts` |
| `def.node.crud.current` | `def_node_crud_current` |
| `def.data.resource.buff` | `def_data_resource_buff` |
| `def.data.resource.damage` | `def_data_resource_damage` |

映射必须双向、唯一、不可由字符串猜测扩大。Engine 对 Host 发出的事件仍使用 canonical 名称。

插件注册六个 read-only binding，但在每个 LLM step 的 `experimental.chat.tools.transform` 中向 private bridge 查询当前 projection，并删除所有未投影 Tool：

- 非空 projection：只保留精确一个 binding，`toolChoice=required`；
- terminal 空 projection：不保留 DEF Tool，`toolChoice=none`；
- bridge 不可达、token 错误、Session/Turn 不匹配或 projection revision 回退：该 step 失败，不回退为全 Tool；
- adapter 在 bridge 收到 Tool execute 时再次校验 current projection，插件过滤不能替代 Host 授权。
- Harness descriptor 是 description 与 input schema 的唯一权威来源；插件把当前 descriptor schema 原样替换到模型 Tool definition，不能再维护第二份 route/buff 静态 schema。

## Tool Bridge And Atomic Resume

插件 Tool execute 请求包含：

- OpenCode Session ID；
- OpenCode message/call ID；
- Engine Turn ID、随机 Turn lease、显式 user message ID 与当前 assistant message ID；
- safe binding；
- JSON input。

Adapter 校验后：

1. 映射为 canonical Tool；
2. 生成稳定 `ToolCallId`；
3. 发出一个 `tool.requested`；
4. 保持插件 HTTP 请求 pending；
5. 等待 Host 提交 Tool result。

`submitToolResultAndUpdateProjection(result, projection)` 必须在一个 Adapter 临界区内完成：

1. 校验 call correlation、result 幂等 fingerprint 与 projection revision；
2. 更新 adapter 当前 projection；
3. 记录该 projection 已接受；
4. 发出 `tool-projection.applied`；
5. 最后才解除插件 Tool execute 请求，让 OpenCode 继续下一 step。

如果 projection 更新失败，插件请求不能收到成功结果，OpenCode 不能继续推理。重复提交完全相同 payload 必须幂等；相同 correlation 的不同 payload 返回 `ENGINE_CORRELATION_CONFLICT`。

## Session Contract

- DEF Session ID 永远不等于 OpenCode Session ID；
- `EngineSessionRef.kind = opencode`；
- `runtimeVersion` 与 `storeSchemaVersion` 来自受控 manifest；
- create payload只写脱敏 metadata，不写 workspace snapshot、API key 或 DEF capability；
- adapter 使用隔离 workspace/store，并由 `EngineSessionRef` 和固定 workspace 定位 OpenCode Session；
- `recoverSession()` 先验证 kind/runtime/schema，再向当前 runtime查询 Session；
- 缺失返回 `missing`，版本不匹配返回 `incompatible`；
- `disposeSession()` abort 该 Session active Turn 后删除 OpenCode Session，幂等；
- Host 本轮仍只内存保存 DEF Session；跨 Host 产品恢复留到后续 Phase。

## Turn And Event Mapping

`startTurn()`：

- 验证 EngineSessionRef 和 provider profile ref；
- 固定本轮 profile/model；
- 注册 Session/Turn/projection bridge state；
- 先建立 OpenCode event stream，再异步发送 message；
- 返回可立即消费的 `EngineTurnHandle`。

事件映射：

- OpenCode 可见 text delta → `response.delta`；
- private Tool bridge call → `tool.requested`；
- Adapter 接受新 projection → `tool-projection.applied`；
- 正常最终 reply → `turn.completed`，output 只含可见文本和脱敏使用量；
- provider/OpenCode/plugin/bridge failure → `turn.failed`；
- Host/User abort → `turn.aborted`。

每个 Engine Turn：

- ordinal 从 1 单调递增；
- terminal 恰好一个且最后一个；
- terminal 后 events 关闭，所有迟到 input 拒绝；
- abort/result、abort/terminal 和 process-exit/HTTP-reply 竞态由同一 Turn lock 收口；
- 不输出隐藏 reasoning、raw provider payload、Authorization、API key、内部端口或 OpenCode filesystem path；
- 单 delta、Tool input/result 和 terminal output 均有明确 size 上限。

Phase 4 不产生 Engine interaction。`submitInteractionResult` 在没有 pending interaction 时 fail closed；OpenCode 通用 permission/question Tool 在 config 中禁用。

## Failure Rules

至少区分：

- runtime missing / target unsupported / checksum mismatch / version mismatch；
- provider profile missing / invalid；
- OpenCode start timeout / health failure / process exit；
- Session missing / incompatible；
- event stream failure；
- Tool bridge unauthorized / malformed / projection mismatch；
- Tool result correlation conflict / stale projection；
- provider/model rejection；
- abort / shutdown。

面向 Browser/Shell 的状态只提供 `kind + ready/pending/unavailable + 脱敏 reason`。内部错误可以保留 typed code，但不得把 secret、headers、完整 provider body 或本地绝对路径透出。

## Required Verification

自动验证至少覆盖：

1. runtime manifest schema、target、checksum、size、version、plugin hash 和 LICENSE；
2. 任意 runtime/profile 缺失均不启动子进程；
3. canonical ↔ safe Tool binding 唯一且精确，provider 实际收到 Harness 动态 description 与 input schema；
4. plugin bridge token、payload、Session/Turn/call correlation 和 size limit；
5. projection hook 每 step 只有当前一个 Tool，空 projection 为零 Tool；
6. result → projection → plugin resume 的原子顺序；
7. duplicate/conflicting result、stale projection、迟到 result；
8. create/recover/missing/incompatible/dispose/shutdown；
9. response delta、provider failure、OpenCode crash、abort 与 terminal 恰好一次；
10. Fake transport 合同与真实 OpenCode binary conformance；
11. 真实 OpenCode + deterministic provider stub 完成 selection、loadout、timeline、buff、calculation 五条路线与最终文本；
12. 同一真实黑盒中 provider 每 step 实际收到对应 route、业务 Tool 与 terminal empty Tool 集；
13. 同一真实黑盒接入 `DefAgentHost + DefHarnessManager + DefReadToolRegistry`，产品结果来自 fixture ProductGateway；
14. 普通 Slim、MCP、Browser SQLite、隐藏 AI 路由和 Electron supervisor 不回归；
15. 包中有且只有当前 target runtime/plugin/manifest/LICENSE，无 vendor/UI/Bun/旧 REST/Node SQLite；Mac app 与 binary 签名有效，重签后 code digest 不变；
16. `npm run check`、Engine 单测、真实 runtime smoke、目录包边界与实际 Mac Agent smoke；
17. 独立高智能审查无未关闭 P0/P1。

真实 provider stub 只监听随机 loopback，不能联网。它必须检查请求中的 Tool definitions，并用确定的 OpenAI-compatible stream 依次返回 route、context、damage 与最终中文回答。测试不能用 Fake Engine 代替这项证据。

## Acceptance

以下条件全部满足才完成 Phase 4：

- production Host 使用 `OpenCodeEngineAdapter`，不再使用 `PendingAgentEngine`；
- runtime/profile 就绪时 Engine health 为 `ready`，缺失时明确 `unavailable`；
- OpenCode 在每个 step 只看到当前 Harness projection；
- 五条只读业务路线的真实 OpenCode 黑盒完整通过，工具结果来自 Browser ProductGateway fixture；
- Tool result 与下一 projection 原子接受，OpenCode 不会抢跑；
- Session、abort、failure、process exit 和 shutdown 满足 `AgentEngine` conformance；
- 浏览器和 Electron 不获得 OpenCode 私有身份或 secret；
- 旧 AI 栈和业务数据副本没有回归；
- package 边界与实际 Mac Agent smoke 通过；
- 无未关闭 P0/P1。

Phase 4 完成后，下一阶段才允许开放产品 Session/Turn HTTP API 和 Slim React 聊天界面。UI 只能消费 DEF Event Journal，不得直接调用 OpenCode。
