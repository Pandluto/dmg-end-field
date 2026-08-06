# OpenCode EngineAdapter Phase 4 Tasks

## Status

实施完成；完整自动验证与发布包边界已通过。

## Phase 0：证据与冻结

- [x] 固定当前基线、旧参考分支、OpenCode `1.17.11` 与旧动态 projection patch。
- [x] 固定本阶段只接 Engine，不恢复 UI、AI CLI、旧 REST、Node SQLite 或写 Tool。
- [x] 重建并冻结 `darwin-arm64` 的 `1.17.11-def.1` runtime artifact。
- [x] 记录 binary version、bytes、SHA-256、plugin hash、source ref 与 License。

## Phase 1：Runtime 与配置边界

- [x] 定义 runtime manifest/checksum/profile schema 与 typed errors。
- [x] 实现 runtime prepare/verify，拒绝 PATH 猜测和静默下载。
- [x] 实现 target、source checksum、macOS 签名、normalized code digest、version/plugin 校验。
- [x] 实现 Shell-owned profile 文件 reader 与测试 profile source。
- [x] 缺 runtime/profile 时 probe unavailable 且不启动 OpenCode server。

## Phase 2：OpenCode 进程与私有桥

- [x] 实现随机 loopback OpenCode supervisor、隔离 XDG/store/workspace 和有序退出。
- [x] 实现 token-protected private Tool bridge。
- [x] 实现 canonical ↔ safe Tool binding 与自包含 plugin bundle。
- [x] plugin 每 step fail-closed 投影当前 Tool，terminal projection 为空。
- [x] 禁用通用 OpenCode Tool、share、project config、自动升级和原生 UI。

## Phase 3：AgentEngine Adapter

- [x] 实现 `probe/createSession/recoverSession/startTurn/disposeSession/shutdown`。
- [x] DEF Session 与 OpenCode Session 分离，验证 runtime/store schema 与 runtime epoch。
- [x] 映射 text、Tool request、projection、failure、abort 与唯一 terminal。
- [x] 实现 result/projection atomic resume 与幂等 correlation。
- [x] 实现 abort/result/process-exit 竞态收口。
- [x] SSE 异常先 abort 并隔离；recover 再 abort 且确认 Session idle。
- [x] Tool 绑定 Turn lease、user message、assistant message 与 projection revision。
- [x] 保持 interaction fail closed；本阶段不开放 permission/question。

## Phase 4：Host、构建与 Electron

- [x] production Host 从 Pending Engine 切到 OpenCode Engine。
- [x] Host health 动态反映 runtime/profile readiness，不泄露内部信息。
- [x] Electron 只传私有 store/profile 路径并继续懒启动 Host。
- [x] Electron/Host 实现父进程监视、启动前孤儿清理、进程出生身份核验与 TERM/KILL 两段退出确认。
- [x] 构建 Host/plugin/runtime 到 `dist/agent/engine/opencode`。
- [x] Electron 包仅 unpack 当前 target runtime，排除 vendor/UI/Bun/旧运行时。
- [x] Shell/AI overlay 文案从“引擎待接入”改为真实 ready/unavailable 状态。

## Phase 5：测试

- [x] runtime manifest/profile/target/checksum/version 合同测试。
- [x] Tool binding、bridge auth、projection 与原子顺序合同测试。
- [x] Engine Session/Turn/abort/dispose/shutdown conformance。
- [x] deterministic provider stub 驱动真实 OpenCode 五路线纵向黑盒。
- [x] 断言 provider 收到每条路线的 route → business Tool(s) → empty Tool 集。
- [x] 断言 provider 收到 Harness 原始动态 description 与 input schema。
- [x] 真实 OpenCode 接入 Host/Harness/Tool/ProductGateway fixture。
- [x] OpenCode crash、provider failure、stale/conflict/late input 负向测试。
- [x] SSE EOF/累计大帧、错误 assistant message、孤儿升级清理、PID 复用与停止失败后拒绝重复启动的 fail-closed 负向测试。
- [x] 更新 repository/package boundary checks。

## Phase 6：验证与交付

- [x] `npm run typecheck`。
- [x] `npm test`。
- [x] `npm run test:agent-core`。
- [x] `npm run test:agent-host`。
- [x] `npm run test:agent-harness`。
- [x] `npm run test:agent-engine:opencode`。
- [x] `npm run check:repo`。
- [x] `npm run check`。
- [x] `npm run agent:runtime:verify`。
- [x] `npm run electron:build:dir`、Mac app/binary 签名与 package boundary。
- [x] 实际 Mac OpenCode binary、Host/Harness 与打包 artifact smoke。
- [x] 独立高智能审查无未关闭 P0/P1。
- [x] 更新 validation 归档并提交实现。

## Exit Condition

Phase 4 只证明真实 OpenCode Engine 能在当前 DEF Host/Harness/Tool 边界内正确运行。下一阶段才开放 DEF 产品 Session/Turn API 和 Slim React 聊天 UI；不得让 UI 直接依赖 OpenCode API、Session 或事件格式。
