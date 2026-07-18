# Task 8-2-2：封闭 current tool 侧门并落地全队候选 C

## 状态

待实施。按 [Spec 8-2-2](./spec8-2-2.md) 收尾提交 `5ad5a72`。本任务只处理工具准入、全队原子候选与验收证据，不重做数据架构、手动配装 UI 或推荐算法。

## 目标

移除 dispatcher 中容易漏项的 current tool 手写白名单，让全部 current read/write/verify/worknode 能力自动使用 canonical gate；把全队配装从逐角色部分应用改为一个候选 C、一次审批、一次 apply，并完成自动合同、真实桌面和 Harness 行为验证。

## 实施原则

- 保留 `5ad5a72` 的 canonical gate 和单角色分支能力；
- 先建立工具分类事实源，再迁移 handler，最后删除旧白名单；
- gate 必须发生在读取 current snapshot 或写 command queue 之前；
- public library 与 current selection 必须可区分；
- 全队 prepare 可以计算多步，但只能产生一个候选节点和零 live mutation；
- 不允许 `PARTIAL` 作为全队 apply 的正常结果；
- Runtime 与合同通过后再构建新的 immutable Harness candidate；
- 不修改 vendor OpenCode，不触碰无关 sharedata。

## Task A：冻结基线与失败清单

- [ ] 记录代码基线 `5ad5a72`、文档基线和当前 stable Harness。
- [ ] 记录 `candidate/spec8-2-1-current-gate`、`8.2.1-candidate.2`、未 promotion 和 package-only 证据。
- [ ] 固化现有通过命令与真实桌面 `snapshotAvailable=false` 缺口。
- [ ] 建立明显不同的 formal A/formal B fixture：角色、技能、Buff、装备、damage、checkout 均可辨认。
- [ ] 冻结侧门清单：current data、command mutation、verification、legacy REST、internal governance。
- [ ] 冻结全队现状：逐角色循环、分支链、允许 `PARTIAL`。

## Task B：扩展 canonical tool metadata

- [ ] 为 registry 定义 `workspaceScope`、`projectionAccess`、`allowedHosts`、`requiresCheckout` 和 internal exposure。
- [ ] 分类全部 DEF tool，不只分类当前公开 typed tools。
- [ ] `public`：游戏知识、operator catalog、纯 weapon/equipment library 等不含 current state 的读取。
- [ ] `workbench-current`：当前 snapshot、角色、技能、按钮、Buff、配装、damage、current mutation/verify。
- [ ] `worknode-tree`：fork/list/read/patch/validate/diff/use/restore/delete 与 node workspace。
- [ ] `session-private`：question、permission、plan/capability 等私有状态。
- [ ] `internal-governance`：bind/assert/unbind/create cleanup。
- [ ] 增加 registry invariant：current read/write 或 commandOp 不得缺失明确 scope/host policy。
- [ ] 增加新增工具的 fail-fast 校验，避免默认 exposure 为 `['workbench','ai-cli']`。

## Task C：统一 dispatcher 和所有路由

- [ ] 在 handler 分派前根据 metadata 执行 policy/gate。
- [ ] 删除或收缩 `startsWith + explicit names` 的重复白名单逻辑。
- [ ] native typed adapter、generic `/api/def-tools/call`、per-tool legacy route 共用同一 policy。
- [ ] renderer command queue 入队前确认 gate 已通过并附带认证 identity。
- [ ] private prepare/apply/discard continuation 复用相同 gate/capability identity。
- [ ] Interop/Harness runner 不获得绕过生产 policy 的隐藏 current 通道。
- [ ] 错误沿用 stable binding/mismatch/stale/temporary 类别，不泄漏 B 内容。

## Task D：封闭 current data resource 侧门

- [ ] `def.character.resolve` 作为 current-only resource，A/B 与无绑定拒绝。
- [ ] `def.skill.resolve` 作为 current-only resource，A/B 与无绑定拒绝。
- [ ] `def.team.loadouts.read`、loadout candidates、operator config read 保持 gate。
- [ ] `def.buff.resolve/search_candidates` 区分 current button/equipment 与 public library 来源。
- [ ] `def.equipment.resolve/gear.resolve` 区分 current equipped 与 public library 来源。
- [ ] 若混合工具无 binding 仍返回 public 结果，剔除 current 字段并标记 `scope/source`。
- [ ] `def.weapon.resolve`、operator catalog、game knowledge 等纯 public 工具保持无绑定可用。
- [ ] OpenCode data resource 文案不能把 public candidate 表述成当前已装备/已选择。

## Task E：封闭 mutation 与 verification 侧门

- [ ] skill button add/remove 在入队前 gate。
- [ ] Buff add/remove/batch/verify 在读取按钮或入队前 gate。
- [ ] target resistance 与 gear entry level 在入队前 gate。
- [ ] damage calculate/report/verify 根据 current-read/write 合同 gate。
- [ ] current snapshot/button/damage verification 拒绝无绑定与 A/B mismatch。
- [ ] Work Node compatible/legacy route 继续验证 binding tree 与 current identity。
- [ ] 每个拒绝路径断言 command queue、result log、checkout、tree、snapshot 零变化。

## Task F：收紧 internal governance

- [ ] bind/assert/unbind 不出现在模型可调用 exposure 中。
- [ ] internal REST 调用携带可信 host context 与精确 session/binding identity。
- [ ] unbind 不能仅凭任意 binding id 删除其他 session binding。
- [ ] failed create cleanup 只接受本次 create 返回的 session/directory，不能作用于 recover/既有 session。
- [ ] 增加 binding/context failure 后 OpenCode session、directory、axis binding、question record 数量断言。

## Task G：设计全队 candidate capability

- [ ] 定义版本化 team prepared capability，包含 session/timeline/axis/plan/P/C/revision/hash/expiry。
- [ ] `plan.apply.prepare` 锁定当前 checkout P 与完整 READY plan。
- [ ] 在 P payload 的 clone 上应用全部角色 exact patches。
- [ ] 所有角色 schema、四槽、武器、skill levels 与 derived constraints 一次校验。
- [ ] 任一角色失败时零 live mutation、零 checkout、零 committed child。
- [ ] 全部成功后只创建一个 child C。
- [ ] C base=P，working=完整全队候选；diff 覆盖全部角色。
- [ ] 返回一次 approval patterns/diff 和精确 capability，不提前 apply。

## Task H：实现全队一次审批与原子 apply

- [ ] native tool 在 C 创建后请求一次 permission，审批内容绑定 P/C/plan/session/timeline。
- [ ] reject 调用安全 discard 或保留明确未应用 leaf，P/live/checkout 不变。
- [ ] approve 后重新 gate，并验证 P/C revision/hash、plan hash 和 permission identity。
- [ ] 用一次 batch payload hydrate/apply 更新 renderer，不循环调用单角色 live apply。
- [ ] 一次验证所有角色 live state、C working payload 与 commit payload 完全一致。
- [ ] 全部通过后一次把 checkout 移到 C。
- [ ] 删除正常结果中的 `PARTIAL`；异常中途状态返回 reconciliation-required 并阻止后续 mutation。
- [ ] 重试必须重新 prepare 新 C，不复用旧 capability/permission。

## Task I：表驱动 current tool 合同

- [ ] 测试直接从 registry metadata 枚举所有 current/worknode tools，避免人工测试清单再次漏项。
- [ ] 每个工具覆盖 A/A/A、A/B、unbound、stale/temporary。
- [ ] A/B fixture 使用不同角色/技能/Buff/装备/damage/node，证明不泄漏 B。
- [ ] current read 拒绝时不返回 current payload。
- [ ] current mutation/verify 拒绝时零 queue/result/checkout/tree/snapshot 变化。
- [ ] public tools 在无绑定场景通过，并断言不夹带 current state。
- [ ] generic REST 与 legacy per-tool route 得到同样结果。
- [ ] internal governance 不出现在模型 exposure/route map 中。

## Task J：分支、permission 与 cleanup 合同

- [ ] 单角色 prepare -> reject/discard：只处理 C，P/checkout 不变。
- [ ] 单角色 prepare -> A 切 B -> approve：mismatch 拒绝。
- [ ] 单角色 P/C revision 或 hash 变化 -> approve：stale 拒绝。
- [ ] 两人和四人 team plan 只创建一个 C。
- [ ] team C diff/permission 包含所有角色且 hash 固定。
- [ ] team approve 只产生一次 apply/checkout，postcondition 全部通过。
- [ ] 注入第二角色计算失败：零 live/checkout 变化，不返回 `PARTIAL`。
- [ ] 注入 renderer/postcondition failure：checkout 不移动并进入明确 reconciliation state。
- [ ] session binding/context create failure：无可恢复孤儿 session/directory/binding。

## Task K：既有自动检查

- [ ] 运行并记录 `npm run test:def-workbench-current-gate`。
- [ ] 运行并记录 `npm run test:def-workbench-binding`。
- [ ] 运行并记录 `npm run test:def-workbench-binding-rest`。
- [ ] 运行新增 metadata/current-tool/team-candidate contracts。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run harness:check`。
- [ ] 运行 Harness package check 与 native regression，区分两种结果。

本轮必须新增测试：权限矩阵、原子全队操作和 cleanup 都属于高风险状态边界，无法靠普通全量单测证明。

## Task L：Mac Desktop Interop/UI 黑盒

- [ ] 完整阅读并按 `docs/testing/def-agent-blackbox.md` 使用 Mac Desktop Interop Route。
- [ ] 已运行 Electron 不主动重启；3030 未监听时按项目约定启动。
- [ ] 在既有正式 SQLite 中取得 `snapshotAvailable=true`，记录 timeline/session/binding/UI consumer。
- [ ] 做一次 current-only data read，核对返回与 UI 当前排轴一致。
- [ ] 做一次单角色或全队 candidate prepare，确认 Work Node 树出现一个 C、P 保留。
- [ ] permission reject 后确认 live/checkout/P 零变化。
- [ ] 新 prepare 后 approve，确认 checkout 精确移到 C，UI 配装与 C 一致。
- [ ] pending permission 后 A -> B，旧 permission 拒绝且 B 零变化。
- [ ] 临时 SQLite 继续拒绝 AI 模式且无 create/recover/context。
- [ ] `snapshotAvailable=false` 时不发送 mutation prompt；先修复/记录 projection bridge 阻塞。

## Task M：新 Harness candidate 与行为回归

- [ ] 保持 `candidate/spec8-2-1-current-gate` immutable，并记录其文案早于 runtime、不得 promotion、由新 candidate supersede。
- [ ] Runtime 和合同完成后创建新的完整八 Slot candidate。
- [ ] Harness 文案只教学 runtime 已实现的 current policy 与单一 team candidate。
- [ ] 新增 current data side-door、unbound mutation、public-only、stale permission、single team C、zero-partial scenarios。
- [ ] baseline/candidate 每个 scenario 使用新 native session。
- [ ] package check 只记录结构结果；native regression 记录真实 turn/tool/permission/checkout 结果。
- [ ] 形成独立 promotion decision artifact，但不自动 promotion。

## 完成检查

- [ ] Spec 8-2-2 每项验收标准有实现和证据。
- [ ] registry metadata 与 dispatcher policy 没有第二份漂移白名单。
- [ ] public/shared 资源没有被误报为 current state。
- [ ] 全队配装不再产生分支链或正常 `PARTIAL`。
- [ ] Harness 不早于 runtime 宣称能力。
- [ ] 未修改数据架构、手动配装 UI、vendor OpenCode、真实 transcript/runtime session 或无关 sharedata。
- [ ] candidate 未 promotion。
- [ ] 完成后按仓库规则自动提交。

## 完成定义

当所有 current tool 由 metadata 自动 gate、所有入口无旁路、全队配装只创建并原子应用一个候选 C，并由表驱动合同、真实 Mac Desktop 与 Harness native regression 共同证明后，本任务完成。
