# OpenCode EngineAdapter Phase 4 Validation

## 结论

Phase 4 已把真实 OpenCode Agent Loop 接入现有 DEF `AgentEngine → Host → Harness → ProductGateway` 边界。生产 Host 不再使用 Pending Engine；五条只读业务路线均由同一个真实 OpenCode binary、动态 Tool projection 和确定性 OpenAI-compatible provider 完成纵向黑盒。

本阶段仍不开放 Browser Turn API、聊天 UI、AI CLI、Question/Approval、写 Tool 或 Pi adapter。下一阶段只能消费 DEF Event Journal，不能让浏览器直接依赖 OpenCode API、端口、Session 或 token。

## 冻结 Artifact

| 字段 | 值 |
| --- | --- |
| Upstream | OpenCode `1.17.11` |
| Runtime | `1.17.11-def.1` |
| Source ref | `codex/def-opencode-spec9-2-implementation@bcea5f12` |
| Target | `darwin-arm64` |
| Binary version | `0.0.0--202608061828` |
| Signed source bytes | `98,979,376` |
| Signed source SHA-256 | `9c6790175c2e704e856170ade1535da8f441c4285fb79da6b9c00c80f5dde34a` |
| Normalized code bytes | `98,768,172` |
| Normalized code SHA-256 | `1bd930b9024cd7cec391d73d9262e47fb89d17092f73f065e15a3250006dddd3` |
| License SHA-256 | `625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b` |
| Store schema | `1` |

Runtime 只通过受控 lock/manifest 进入 `dist/agent/engine/opencode`。prepare 不查 PATH、不联网下载；source lock 校验精确签名文件，运行时校验 target、有效 macOS 签名、签名归一化 code digest、realpath containment、可执行位、plugin hash、License hash 和真实 `--version`。Electron 用 ad-hoc 或 Developer ID 重签包内 Mach-O 时完整文件 hash 会改变，但去签名后的 code digest 保持不变。

上游 Bun 产物带有失效 linker signature；冻结 artifact 在不改 executable code 的前提下执行了确定性的 `codesign --force --sign - --timestamp=none`，并以 `darwin-adhoc-codesign` capability 留痕。发布构建可再用 Developer ID 重签。

## 已落实的边界

- 每个 Turn 使用独立 `engineTurnId + random turnLease + explicit userMessageId`；只接收 `parentID` 指向本轮 user message 的 assistant event，Tool 还必须绑定当前 projection revision 对应的 assistant message ID。
- OpenCode call ID 按 Engine Turn 命名空间生成 ToolCallId；旧 Turn 的 Tool、delta 和 idle 不能串入新 Turn。
- plugin 启动必须完成 token 鉴权的 protocol/build/process nonce/runtime/directory handshake；Supervisor 还会核对六个 DEF Tool 已注册。
- 每一步由 `experimental.chat.tools.transform` 删除非当前 Tool；非 terminal 精确一个 Tool，terminal 为零 Tool。
- Harness 的动态 description 与 input schema 被原样投影到 provider；插件不再维护第二份 route/buff schema。
- Tool result 与下一 projection 先原子接受并发出 `tool-projection.applied`，最后才释放 pending plugin execute。
- abort、provider failure、process exit、SSE EOF、idle 和 terminal 由同一 Turn lifecycle 收口；SSE 异常先 abort 远端推理并隔离 Session，recover 再次 abort 且确认 idle。
- runtime 每次启动递增 epoch；崩溃后旧 Session 标记 detached，只能显式 recover，不会静默创建替代 Session。
- Phase 4 只接受一个配置好的默认 profile。生产 profile 文件要求普通文件、非 symlink、最大 256 KiB、当前用户所有、POSIX `0600`；非精确 loopback 必须 HTTPS，额外 headers 有数量、名称和值限制。
- OpenCode 使用固定内部 provider ID，禁用 share、project config、自动更新、原生 UI 和通用 shell/file/web/task/permission Tool。
- Host 只写脱敏 Session metadata；provider raw error、startup output、API key、headers、内部路径和 token 不进入 DEF Event、health 或 Shell。
- Host 写权限受限的 OpenCode 进程所有权清单 v2，绑定 Host/OpenCode PID 与进程出生身份；Electron 每次 TERM/KILL 前都重新核验，PID 已复用时只清理旧清单而不发送信号。无法确认身份或退出时保留清单并失败；停止失败后 supervisor 拒绝启动第二个 child；Host 监视 Electron parent PID，并以有界强制退出兜底。

## 真实五路线黑盒

| 路线 | Provider 实际 Tool 顺序 | 最终文本 |
| --- | --- | --- |
| selection | route → context → empty | 当前选择了 1 名干员：测试干员。 |
| loadout | route → team_loadouts → empty | 测试干员已配置测试武器、3 件测试装备与测试套装。 |
| timeline | route → current → empty | 当前排轴包含 1 个技能按钮，结算目标为 node-opencode-blackbox。 |
| buff | route → buff(query + buttonId) → empty | 按钮 button-blackbox 当前包含灼热增伤。 |
| calculation | route → context → damage → empty | 当前总期望伤害为 1234.5。 |

总计 16 次真实 provider 请求。每次请求都断言实际 Tool 集、Harness 动态 description 和 input schema；产品结果来自 `DefReadToolRegistry + fixture ProductGateway`，没有由测试或 Agent 重算业务公式。

## 自动验证

以下命令于 2026-08-07 在 macOS arm64 本地通过：

- `npm run check`：包含依赖审计、全量 TypeScript、全部前端测试、Agent Core/Host/Harness、Electron supervisor、OpenCode Engine 合同、真实五路黑盒、Web 构建与离线工作区检查。
- `npm run test:agent-engine:opencode`。
- `npm run agent:runtime:verify`。
- `npm run electron:build:dir`。
- `npm run electron:smoke:package`。
- `npm run electron:smoke:agent-package`：直接启动 app.asar.unpacked 内的真实 Host/Engine artifact，验证随机私有 Host、脱敏 unavailable health 与有序退出。

负向合同覆盖：错误 profile、profile 权限/HTTP/header、bridge 未授权、错误 Turn lease、正确 lease 下的错误 assistant message、冲突 result、旧 projection、旧 Turn delta/idle、累计多行 SSE 大帧、SSE EOF 后 abort/idle recovery、pending Tool abort、runtime crash 后 detached/recover、provider secret redaction、Host TERM/KILL 升级、启动前孤儿清理、PID 复用不误杀、停止失败后拒绝第二次启动、握手中的同 profile 并发启动复用，以及无法确认 SIGKILL 时保留归属证据并 fail closed。

独立高智能审查先后发现并关闭 SSE/进程清理/签名/message correlation/schema projection/流式边界，以及 PID 复用、停止失败和并发启动三组问题；最终复核结论为无未关闭 P0/P1。

发布包检查确认：Host、plugin、runtime lock、manifest、MIT License 和唯一 `darwin-arm64` binary 均在 `app.asar.unpacked`；code digest/version/可执行位一致，binary 与整个 `.app` 通过 `codesign --verify --deep --strict`；无 OpenCode vendor source、Web UI、Bun、完整 node_modules、旧 REST 或 Node SQLite。

## 下一阶段前置约束

下一阶段才实现产品 Session/Turn HTTP API 与 Slim React AI 模式。Electron 当前 Browser proxy 会整体缓冲响应并带普通请求超时；开放 DEF Event SSE 前必须先实现真正的流式代理、断线语义与 capability 校验。Provider 设置 UI 和系统钥匙串也属于下一阶段，不应回填到 EngineAdapter。
