# DEF Harness 与五业务只读 Tool Phase 3 Tasks

## Status

待实施。

## Phase 0：规格与旧实现证据

- [ ] 将 Phase 3 Spec/Tasks 加入索引。
- [ ] 固定旧参考分支、五业务 Revision lineage 与只读 operation 白名单。
- [ ] 固定不复制旧 REST/OpenCode wrapper/Node 业务 SQLite。
- [ ] 建立旧 operation/Tool sequence parity fixture。

## Phase 1：Harness 与 Tool 合同

- [ ] 定义 business、operation、revision、phase、transaction 与 trace DTO。
- [ ] 定义 typed Tool descriptor、execution context、result 与 error。
- [ ] 扩展 DEF Event Journal 的 Harness 事件。
- [ ] 建立五个 immutable Slim read-only Revision。
- [ ] 验证 phase 图、Tool ceiling、零写域和 deterministic content hash。

## Phase 2：Harness Manager

- [ ] 实现 route-only 初始 phase。
- [ ] 实现 typed route 和 transaction pin。
- [ ] 实现当前 phase 最小 Tool projection。
- [ ] 实现 success/failure transition 与 terminal。
- [ ] 实现 projection revision 单调递增。
- [ ] 实现跨业务、未投影 Tool、terminal 后调用 fail closed。
- [ ] 记录 route、phase、projection 与 terminal trace。

## Phase 3：五业务只读 Tool

- [ ] 实现 `def.node.crud.context`。
- [ ] 实现 `def.data.resource.team_loadouts`。
- [ ] 实现 `def.node.crud.current`。
- [ ] 实现 `def.data.resource.buff`。
- [ ] 实现 `def.data.resource.damage`。
- [ ] 严格验证输入、snapshot payload 与 Session binding。
- [ ] 保证所有结果 JSON-safe、稳定排序、bounded 且零 mutation。

## Phase 4：Host 集成

- [ ] 新增 Harness Turn 入口，拒绝任意 caller-supplied projection。
- [ ] 将 route 与业务 Tool request 委托给 Manager/Registry。
- [ ] Tool result 后推进 phase 并更新同一 Engine Turn projection。
- [ ] Harness trace 写入 DEF Event Journal。
- [ ] consumer lost、abort、Tool error 与 terminal 有序收口。
- [ ] Pending Engine 产品状态保持不变。

## Phase 5：构建与边界

- [ ] 扩展 Agent runtime build 与精确文件 allowlist。
- [ ] 增加 `test:agent-harness` 并纳入 `check`/`electron:check`。
- [ ] 静态禁止 OpenCode/Pi/旧 REST/Node 业务 SQLite import。
- [ ] 打包边界验证新内核存在、旧运行时不回归。

## Phase 6：验证与交付

- [ ] Harness catalog/graph/hash 合同测试。
- [ ] 五业务 Tool typed fixture 测试。
- [ ] 五业务 deterministic Fake Engine blackbox。
- [ ] 旧参考 parity fixture 对比。
- [ ] stale binding、consumer lost、abort 与非法 Tool 负向测试。
- [ ] `npm run typecheck`。
- [ ] `npm test`。
- [ ] `npm run test:agent-harness`。
- [ ] `npm run check:repo`。
- [ ] `npm run check`。
- [ ] `npm run electron:check`。
- [ ] `npm run electron:verify:mac`。
- [ ] 独立高智能审查无未关闭 P0/P1。
- [ ] 更新状态与验证摘要。
- [ ] 提交 Phase 3 实现。

## Exit Condition

Phase 3 完成后，下一阶段才允许接 OpenCode 1.17.11 adapter。OpenCode 只能实现 `AgentEngine`，不得重新拥有 DEF Session、Harness、Tool、ProductGateway 或 UI 协议。
