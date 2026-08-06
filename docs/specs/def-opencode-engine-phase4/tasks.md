# OpenCode EngineAdapter Phase 4 Tasks

## Status

待实施。

## Phase 0：证据与冻结

- [x] 固定当前基线、旧参考分支、OpenCode `1.17.11` 与旧动态 projection patch。
- [x] 固定本阶段只接 Engine，不恢复 UI、AI CLI、旧 REST、Node SQLite 或写 Tool。
- [ ] 重建并冻结 `darwin-arm64` 的 `1.17.11-def.1` runtime artifact。
- [ ] 记录 binary version、bytes、SHA-256、plugin hash、source ref 与 License。

## Phase 1：Runtime 与配置边界

- [ ] 定义 runtime manifest/checksum/profile schema 与 typed errors。
- [ ] 实现 runtime prepare/verify，拒绝 PATH 猜测和静默下载。
- [ ] 实现 target 解析、checksum/size/version/plugin 校验。
- [ ] 实现 Shell-owned profile 文件 reader 与测试 profile source。
- [ ] 缺 runtime/profile 时 probe unavailable 且零子进程。

## Phase 2：OpenCode 进程与私有桥

- [ ] 实现随机 loopback OpenCode supervisor、隔离 XDG/store/workspace 和有序退出。
- [ ] 实现 token-protected private Tool bridge。
- [ ] 实现 canonical ↔ safe Tool binding 与自包含 plugin bundle。
- [ ] plugin 每 step fail-closed 投影当前 Tool，terminal projection 为空。
- [ ] 禁用通用 OpenCode Tool、share、project config、自动升级和原生 UI。

## Phase 3：AgentEngine Adapter

- [ ] 实现 `probe/createSession/recoverSession/startTurn/disposeSession/shutdown`。
- [ ] DEF Session 与 OpenCode Session 分离，验证 runtime/store schema。
- [ ] 映射 text、Tool request、projection、failure、abort 与唯一 terminal。
- [ ] 实现 result/projection atomic resume 与幂等 correlation。
- [ ] 实现 abort/result/process-exit 竞态收口。
- [ ] 保持 interaction fail closed；本阶段不开放 permission/question。

## Phase 4：Host、构建与 Electron

- [ ] production Host 从 Pending Engine 切到 OpenCode Engine。
- [ ] Host health 动态反映 runtime/profile readiness，不泄露内部信息。
- [ ] Electron 只传私有 store/profile 路径并继续懒启动 Host。
- [ ] 构建 Host/plugin/runtime 到 `dist/agent/engine/opencode`。
- [ ] Electron 包仅 unpack 当前 target runtime，排除 vendor/UI/Bun/旧运行时。
- [ ] Shell/AI overlay 文案从“引擎待接入”改为真实 ready/unavailable 状态。

## Phase 5：测试

- [ ] runtime manifest/profile/target/checksum/version 合同测试。
- [ ] Tool binding、bridge auth、projection 与原子顺序合同测试。
- [ ] Engine Session/Turn/abort/dispose/shutdown conformance。
- [ ] deterministic provider stub 驱动真实 OpenCode calculation 纵向黑盒。
- [ ] 断言 provider 收到 route → context → damage → empty Tool 集。
- [ ] 真实 OpenCode 接入 Host/Harness/Tool/ProductGateway fixture。
- [ ] OpenCode crash、provider failure、stale/conflict/late input 负向测试。
- [ ] 更新 repository/package boundary checks。

## Phase 6：验证与交付

- [ ] `npm run typecheck`。
- [ ] `npm test`。
- [ ] `npm run test:agent-core`。
- [ ] `npm run test:agent-host`。
- [ ] `npm run test:agent-harness`。
- [ ] `npm run test:agent-engine:opencode`。
- [ ] `npm run check:repo`。
- [ ] `npm run check`。
- [ ] `npm run agent:runtime:verify`。
- [ ] `npm run electron:build:dir` 与 package boundary。
- [ ] 实际 Mac Agent smoke。
- [ ] 独立高智能审查无未关闭 P0/P1。
- [ ] 更新 validation 归档并提交实现。

## Exit Condition

Phase 4 只证明真实 OpenCode Engine 能在当前 DEF Host/Harness/Tool 边界内正确运行。下一阶段才开放 DEF 产品 Session/Turn API 和 Slim React 聊天 UI；不得让 UI 直接依赖 OpenCode API、Session 或事件格式。
