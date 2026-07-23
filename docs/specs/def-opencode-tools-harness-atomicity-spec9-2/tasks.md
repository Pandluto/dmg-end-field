# Spec 9-2 Tasks：五业务原子 Harness 解耦、管理与热重载重构

## 状态

规格重写完成，工程任务待实施。

本轮只有一个交付态：旧行为来源完成解耦，Harness Manager 正式接管，五个业务 Harness 全部可执行。以下任务可以按依赖分步实现和自动提交，但任何中间提交都不是可交付的部分完成。

## 实施顺序

```text
冻结现状合同
  → 建立 Type/Revision/Instance 基础
  → 建立 Manager 执行链
  → 实现五业务 Revision
  → 迁移并删除旧行为 owner
  → 一次切换正式主链路
  → 合同回归与真实 UI 黑盒
```

三项主工作之间的依赖为：

```text
解耦清单 ───────┐
                ├→ 五业务迁移 → 单一主链路
Manager 基础 ───┘
```

不得先上线只有 Manager 的空壳，也不得先让五业务 Harness 与旧巨型 Prompt 并行运行。

## Task 0：冻结架构基线与迁移账本

- [ ] 记录当前正式 Workbench 回合的完整行为来源：
  - [ ] 固定 Agent Prompt；
  - [ ] runtime Skill；
  - [ ] Host 每 Turn Prompt；
  - [ ] 八槽 Harness；
  - [ ] Harness turn router；
  - [ ] Tool description；
  - [ ] plugin gate；
  - [ ] REST/产品硬合同。
- [ ] 为每条有效规则指定唯一目标 owner：
  - [ ] Host Kernel；
  - [ ] Harness Type；
  - [ ] Harness Revision；
  - [ ] Knowledge；
  - [ ] Tool contract；
  - [ ] Tool/Host enforcement；
  - [ ] Judge；
  - [ ] 删除。
- [ ] 建立迁移账本，至少记录 `source / currentOwner / targetOwner / migrationTask / removalEvidence`。
- [ ] 固定五业务集合和 id：`selection / loadout / timeline / buff / calculation`。
- [ ] 固定 Operation、Phase、事务状态、dependency effect 和 typed failure 的公共枚举。
- [ ] 固定当前必须保留的 timeline、checkout、projection、approval、CAS、Work Node 和 postcondition 合同。
- [ ] 加入防回退检查：不得新增第六个万能业务 Harness、实体 Harness 或术语 Harness。

## 主工作一：解耦旧行为来源

### Task 1：收窄 Host Kernel

- [ ] 把 `buildAgentPrompt("workbench")` 收窄为：
  - [ ] 身份和产品边界；
  - [ ] 不可绕过的安全原则；
  - [ ] Harness Manager 接入合同；
  - [ ] 不包含五业务具体 Tool 顺序、攻略路线或回复模板。
- [ ] 把每 Turn Host 注入收窄为当前事实：
  - [ ] host/session identity；
  - [ ] timeline/checkout/scheme revision；
  - [ ] checkout transition 和 projection 状态；
  - [ ] 运行时不可绕过 gate 的事实结果。
- [ ] 删除 Host Prompt 中“先调用哪个业务 Tool”“业务失败后怎样回复”等 Harness 决定。
- [ ] 保留现有 binding、checkout 和 projection 的代码级拒绝，不把它们降级成文本教学。

### Task 2：退役全局 runtime Skill 与八槽主链路

- [ ] 盘点 `timeline-workbench/SKILL.md` 的规则并按迁移账本拆迁。
- [ ] 将可复用的纯业务过程迁入对应 Harness Revision 的 Operation/Phase。
- [ ] 将游戏事实迁入 Knowledge Binder 可读取的来源，不复制到五个 Revision。
- [ ] 将权限、审批、schema、CAS 和 postcondition 保留在 Tool/Host enforcement。
- [ ] 正式主链路不再加载 `timeline-workbench` 作为五业务总 Harness。
- [ ] 正式主链路不再调用八槽 `composeHarnessSystem()`。
- [ ] 正式 Session 不再创建或依赖 `DefHarnessSessionBindingV1` 整包 binding。
- [ ] 旧 baseline/examples/scenarios 若需保留历史价值，只能进入非运行时归档或迁移夹具，不能被正式 Workbench 解析。

### Task 3：收窄 router 与 Tool description

- [ ] 用结构化 Business Intent Resolver 替代 `harness-turn-router.cjs` 的总路由职责。
- [ ] 只保留可以证明无歧义的确定性 shortcut，并让结果通过 Type Registry 校验。
- [ ] 清理 Tool description，只保留：
  - [ ] Tool 本地用途；
  - [ ] 精确 input/output；
  - [ ] 事实范围；
  - [ ] 副作用；
  - [ ] typed error。
- [ ] 移除 Tool description 中的跨 Tool 顺序、业务首步、全流程停止条件和最终回复格式。
- [ ] 保留 plugin/REST 中真正可执行的失败熔断、scope、approval 和 invocation policy。
- [ ] 建立静态检查，阻止旧业务关键规则重新进入固定 Prompt、总 Skill或 Tool description。

## 主工作二：Harness 注册、管理、迭代与热重载

### Task 4：实现三层 Harness 合同

- [ ] 建立 `HarnessType` schema，至少包含：
  - [ ] `businessId`；
  - [ ] `operations`；
  - [ ] `toolCeiling`；
  - [ ] `directWriteScope`；
  - [ ] `postconditions`；
  - [ ] `dependencies`；
  - [ ] Tool/state/host 兼容版本。
- [ ] 建立 `HarnessRevision` schema，至少包含：
  - [ ] version/generation/contentHash；
  - [ ] Operation Phase graph；
  - [ ] Tool refs；
  - [ ] knowledge selectors；
  - [ ] resolver hints；
  - [ ] clarification/correction/abort policy；
  - [ ] result presentation policy。
- [ ] 建立 `HarnessInstance` schema，至少包含：
  - [ ] transaction/session/business/operation/revision identity；
  - [ ] timeline/checkout/base/current scheme revision；
  - [ ] targets/conversation focus；
  - [ ] evidence refs；
  - [ ] candidate/capability/approval refs；
  - [ ] phase/status。
- [ ] Type schema 与 Revision schema 分离，Revision 不得扩大 Type 硬边界。
- [ ] Instance schema 表达 scheme revision lineage，不能只保存当前 revision。
- [ ] 为三种合同提供稳定 typed validation error。

### Task 5：实现 Type Registry 与 Revision Registry

- [ ] Type Registry 只接受固定五业务 id。
- [ ] 注册时校验 Operation、Tool ceiling、write scope、dependency 和兼容性。
- [ ] Revision Registry 以 `businessId + generation/version + contentHash` 标识版本。
- [ ] 每个业务独立维护 `candidate / active / previous`。
- [ ] 支持 `register / validate / activate / inspect / rollback / revoke`。
- [ ] 激活一个业务 Revision 不重建其他四个业务，也不修改它们的 active ref。
- [ ] 无效 candidate 不得替换最后一个可用 active Revision。
- [ ] 不再生成覆盖五业务的全局 package hash 作为正式运行单位。

### Task 6：实现 Intent Resolver 与 Business Plan

- [ ] Resolver 输入包含用户文本、conversation focus、未完成 Instance 和当前方案上下文。
- [ ] Resolver 输出严格使用 `new / continue / pipeline / clarify`。
- [ ] 每个 step 输出 `businessId / operationId / targets / requestedEffect`。
- [ ] 高置信 continuation 只能续接兼容的未完成事务。
- [ ] Revision resolver hint 不能扩张 Type Operation 或认领其他业务写入目标。
- [ ] 单一效果出现多个 owner 时 clarify，不按激活顺序、文本顺序或正则先后覆盖。
- [ ] clarify 通过结构化 ambiguities/options 和现有 question 边界呈现，创建业务 Instance 前不开放业务 Tool。
- [ ] 用户纠正目标时旧 Instance 进入 `superseded`，新事务重新解析。
- [ ] 跨业务请求生成有序 Business Plan，不创建万能 Harness。
- [ ] Business Plan 保存 plan id、用户总目标、步骤、当前位置、scheme revision 和状态，但不拥有业务写域或 Tool。
- [ ] 后续 step 必须读取上一步提交后的新 scheme revision。
- [ ] 上游失败、拒绝、stale 或 revoke 时停止后续 step。
- [ ] Resolver 阶段不得调用业务 Tool 或修改方案。

### Task 7：实现 Instance Store 与事务生命周期

- [ ] 创建、读取、更新和结束业务 Instance。
- [ ] 支持 `active / awaiting-confirmation / completed / aborted / superseded / stale / revoked`。
- [ ] preview、confirmation、apply、verify 跨 Turn 使用同一 transaction id。
- [ ] confirmation 必须匹配原 proposal/candidate、Revision、scheme lineage 和 evidence refs。
- [ ] Session 中可以顺序或交错存在不同业务 Instance，但同一确认对象只能有一个 active owner。
- [ ] checkout 或 scheme 被外部改变时，按兼容判定继续、stale 或中止，不得静默重基。
- [ ] Instance 以机器可读状态保存，不得只依赖 transcript。
- [ ] 进程恢复后无法精确恢复 proposal/capability/lineage/evidence 时标记 stale 或 aborted。
- [ ] 清理 DEF Session 时，相关未完成 Instance 一并结束，不产生孤立可应用 token。

### Task 8：实现 Tool Graph、逐阶段投影与执行前 gate

- [ ] 把 `(Business, Operation, Phase) → Tool` 建成可校验关系。
- [ ] 每个 Phase 声明：
  - [ ] allowed Tool refs；
  - [ ] required capabilities；
  - [ ] accepted typed result states；
  - [ ] next transitions。
- [ ] 引用的 Tool 必须存在于 canonical flat registry。
- [ ] 计算 `ActiveTools = projected ∩ type ceiling ∩ registry exposure ∩ permission`。
- [ ] 在提交 Prompt 时只启用 `ActiveTools`。
- [ ] 扩展 `tool.execute.before`，校验 session、turn、transaction、operation、phase 和 Tool ref。
- [ ] 实现 `tool.execute.after`，把 typed result 交给 Instance 状态机并原子推进 Phase。
- [ ] 建立 Phase Projection Bridge：同一用户 Turn 的下一次 LLM request 重新读取 Phase、注入当前 Harness context 并重算 `ActiveTools`。
- [ ] 不允许用整个 Operation 的 Tool superset 冒充逐 Phase 投影。
- [ ] 未投影 Tool 即使被模型构造也返回稳定 typed denial。
- [ ] Tool Graph 只引用 Tool contract，不复制 schema、handler 或 description。
- [ ] proposal token、artifact id、plan hash、approval capability 等作为 typed edge 传递。

### Task 9：实现 Context Binder 与 Knowledge Binder

- [ ] Context Binder 读取并绑定：
  - [ ] timeline；
  - [ ] checkout；
  - [ ] scheme revision lineage；
  - [ ] 当前页面 projection；
  - [ ] conversation focus。
- [ ] 上下文不收敛时阻止业务执行，不把旧 transcript 当成当前事实。
- [ ] Knowledge Binder 使用 `businessId / operationId / targets / schemeRevision / userConstraints` 查询。
- [ ] 返回最小 evidence slice，记录 source、section、hash/revision、scope 和 conditions。
- [ ] 不把完整攻略永久拼进全局 Prompt。
- [ ] 不把某业务取出的攻略结论自动共享给无关业务。
- [ ] Mutation Instance 固定使用过的 evidence refs；确认时不得静默换源。
- [ ] 当前状态、catalog 事实、攻略解释和公式结果保持不同权威域。

### Task 10：实现 semantic write scope 与 Dependency Manager

- [ ] 定义 `Selection / Loadout / Timeline / Buff` 的 canonical semantic state view。
- [ ] Calculation 只读取带 revision 的完整方案，不直接写源状态。
- [ ] 每个 mutation 提交前生成 semantic diff。
- [ ] 把 diff 分类为：
  - [ ] `DirectBusinessDiff`；
  - [ ] `DeterministicReconciliation`；
  - [ ] `DerivedRecalculation`。
- [ ] 直接 diff 越过当前 Harness Type write scope 时拒绝提交。
- [ ] reconciliation 必须来自产品确定性规则，不能由 Harness 自由生成。
- [ ] 建立五业务 dependency graph。
- [ ] 每条边根据实际 diff 输出 `none / hard-invalid / stale / recompute`。
- [ ] hard-invalid 对象不得继续 apply；stale 结论不得继续复用；recompute 生成新的计算 revision。
- [ ] 同一 timeline/checkout 的 mutation commit 按 scheme revision 和 CAS 串行化。
- [ ] 一次提交后重新判定其他未完成 Instance；禁止 last-write-wins 和静默 rebase。
- [ ] effect 为 none 的旧 candidate/token 仍需 typed revalidation 才能绑定新 revision。
- [ ] Trace 中记录直接变化、级联变化和下游 effect，避免把所有差异归给当前 Harness。

### Task 11：实现单业务热重载、回退与撤销

- [ ] 监听或显式触发单个 Harness Revision 变更。
- [ ] 按 `parse → type/tool/workflow/knowledge/write-scope/compatibility validate → compile → atomic activate` 发布。
- [ ] 新业务事务读取最新 active Revision。
- [ ] 未完成事务继续使用创建时 Revision。
- [ ] 热重载不重建 OpenCode Session，不修改旧 proposal 或 Work Node。
- [ ] rollback 只影响目标业务之后创建的事务。
- [ ] revoke 使引用目标 Revision 的未完成 Instance 进入 `revoked`。
- [ ] revoke 后旧事务必须重新规划，不能继续应用。
- [ ] 无效发布输出可观察错误并保留 last-known-good。

### Task 12：实现统一 Trace/Audit

- [ ] 每 Turn 至少记录：
  - [ ] session/turn/transaction；
  - [ ] business/operation/revision；
  - [ ] scheme revision；
  - [ ] phase before/after；
  - [ ] active Tools；
  - [ ] evidence refs；
  - [ ] Tool calls/results；
  - [ ] downstream effects；
  - [ ] final status。
- [ ] 区分 route ambiguous、load failed、Tool unavailable、context stale、write-scope violation、approval rejected、postcondition failed 等失败。
- [ ] 能按 transaction 还原完整消费链。
- [ ] Trace 不保存未脱敏密钥或不必要的完整攻略正文。

## 主工作三：实现五个原子 Harness

### Task 13：实现 selection Harness

- [ ] 注册 selection Type 和非空初始 Revision。
- [ ] 实现 inspect、search、add、remove、replace、reorder、analyze、apply。
- [ ] 复用 exact operator catalog 和正式 selection apply 能力。
- [ ] 建立候选、级联影响、确认/审批和 visible postcondition。
- [ ] 不通过 generic Work Node 文件模拟选人。
- [ ] 删除/换人触发正确的下游 invalid/stale/recompute。

### Task 14：实现 loadout Harness

- [ ] 注册 loadout Type 和非空初始 Revision。
- [ ] 实现 inspect、resolve、recommend、compare、preview、apply、restore。
- [ ] 把武器、装备、技能等级和配置输入纳入同一配装业务边界。
- [ ] 把 guide/profile、catalog artifact、planner、proposal/capability 组成 typed Phase 图。
- [ ] `3+1`、潮涌套、角色名只作为 constraint/entity/target。
- [ ] preview 与后续 apply 使用同一 proposal、Revision、scheme lineage 和 evidence。
- [ ] 用户修正或质疑候选时 supersede 旧 proposal，不把纠正当确认。
- [ ] 完成以 live operator-config postcondition 为准。

### Task 15：实现 timeline Harness

- [ ] 注册 timeline Type 和非空初始 Revision。
- [ ] 实现 inspect、add、remove、move、replace、copy、validate、preview、apply、restore。
- [ ] 使用 exact coordinate、skill identity 和当前 checkout 事实。
- [ ] 复用 Work Node fork/bind/validate/diff/use/restore。
- [ ] 直接写域只包含技能按钮身份、动作顺序、位置和排轴结构。
- [ ] 不把 selectedBuff 改动误归为排轴直接写入。
- [ ] 完成以 semantic diff、产品校验和真实页面排轴为准。

### Task 16：实现 buff Harness

- [ ] 注册 buff Type 和非空初始 Revision。
- [ ] 实现 inspect、resolve、source、add、remove、replace、batch、stack、coverage、apply、restore。
- [ ] 支持单体和批量 BUFF 操作，但保持一个 BUFF 业务 owner。
- [ ] 直接写域覆盖按钮 BUFF 绑定、层数、异常和相关战斗状态。
- [ ] BUFF 来源、覆盖、冲突和乘区知识按 Instance 绑定。
- [ ] timeline button 被删除或替换时，相关 BUFF Instance 正确 invalid/stale。
- [ ] 完成以 BUFF semantic diff 和真实页面状态为准。

### Task 17：实现 calculation Harness

- [ ] 注册 calculation Type 和非空初始 Revision。
- [ ] 实现 calculate、aggregate、compare、attribute、diagnose、export、explain。
- [ ] 输入绑定完整 scheme revision、catalog facts 和 formula version。
- [ ] 不直接修改 Selection、Loadout、Timeline 或 Buff 源状态。
- [ ] 结果明确统计口径、条件、缺失输入和 revision。
- [ ] 任一上游有效变化触发 recompute 或把旧报告标为 stale。
- [ ] 计算与统计均以 typed engine output 为依据，不让 Harness 重写公式。

## 集成切换

### Task 18：接入正式 Workbench 主链路

- [ ] DEF Workbench 新 Turn 先进入 Harness Manager。
- [ ] Resolver 选择 continue/new/pipeline/clarify。
- [ ] Instance 绑定当前 context 和 evidence。
- [ ] Revision 生成当前 Phase Prompt/Tool projection。
- [ ] Tool result 驱动 Phase transition。
- [ ] mutation 经 semantic diff、approval、commit 和 visible postcondition 闭合。
- [ ] 跨业务 plan 顺序消费每一步的新 scheme revision。
- [ ] 同一 Session 顺序执行五业务时，各自使用独立 Revision 和 Instance。

### Task 19：删除双轨并确认唯一 owner

- [ ] 正式运行时只保留：

```text
Host Kernel Contract
+ 当前 Harness Instance
+ 本轮 Knowledge Slice
+ 当前 Scheme Context
+ Typed Tool contract/result
```

- [ ] 不再同时注入旧八槽 package。
- [ ] 不再加载旧总 Workbench Skill。
- [ ] 固定 Agent Prompt 不再拥有五业务具体规则。
- [ ] Tool description 不再拥有跨 Tool 工作流。
- [ ] 旧 router 不再决定正式五业务主链路。
- [ ] 迁移账本每一项都有 removal evidence。
- [ ] 全仓检索确认同一关键业务规则不存在第二个 active owner。

## 验证

### Task 20：合同与架构验证

- [ ] 为本次高风险运行时合同增加必要自动测试：
  - [ ] Type/Revision/Instance schema；
  - [ ] 非法 Operation、Tool ref、Phase edge 和写域拒绝；
  - [ ] Tool projection 与执行前二次 gate；
  - [ ] 同一 Turn 的 Tool result 后重算下一 Phase projection；
  - [ ] Resolver 的单业务、continuation、pipeline 和 clarify；
  - [ ] preview/confirm/apply 跨 Turn 一致性；
  - [ ] semantic diff 分类；
  - [ ] 同一 timeline/checkout 的 revision/CAS 并发提交；
  - [ ] dependency invalid/stale/recompute；
  - [ ] 单业务 activate/rollback/revoke；
  - [ ] 同 Session 新事务使用新版、旧事务保持原版；
  - [ ] last-known-good；
  - [ ] 旧主链路不再被加载。
- [ ] 保留并运行现有 checkout/projection/approval/CAS/Work Node/postcondition 回归。
- [ ] 对五业务各运行至少一个只读场景、一个 mutation 或明确不支持场景。
- [ ] 对“给别礼配置 3+1 潮涌套”断言只创建 loadout Instance。
- [ ] 对“换人后配装并计算”断言形成有序多业务 plan，并逐步更新 scheme revision。
- [ ] 对 hot reload 断言只影响目标业务的新事务。

### Task 21：DEF 黑盒与真实 UI 验证

- [ ] 按 `docs/testing/def-agent-blackbox.md` 的 Mac Desktop Interop Route 执行。
- [ ] 读取真实 turn、Tool、问题、typed failure 和 transaction trace。
- [ ] 用真实 UI 确认选人、配装、排轴、BUFF、计算结果。
- [ ] mutation 不能仅凭 Tool acknowledgement 或模型回复判定成功。
- [ ] 验证用户拒绝、proposal 过期、上下文变化、Revision revoke 和 postcondition failure。
- [ ] 验证热重载过程中 OpenCode Session 不重建。
- [ ] 验证旧八槽、总 Skill 和巨型业务 Prompt 未进入真实请求。

## 最终完成门

- [ ] 主工作一“解耦”全部完成。
- [ ] 主工作二“Manager/迭代/热重载”全部完成。
- [ ] 主工作三“五业务 Harness”全部完成。
- [ ] 集成切换和双轨删除全部完成。
- [ ] 合同测试、现有关键回归和真实 UI 黑盒全部通过。
- [ ] 用户数据和 `data/sharedata/**` 不因本轮迁移被改写或清理。
- [ ] 按任务对应代码完成点自动提交；最终提交能从干净启动重现正式单一主链路。

以下情况一律不能勾选本轮完成：

- 只建立目录或 manifest；
- 只注册五个空 Type；
- 只实现 Manager 但仍加载旧全局 Prompt；
- 只迁移配装或 `3+1` 场景；
- 热重载仍要求新 Session；
- 依靠模型自觉遵守写域；
- 旧链路和新链路长期双轨；
- 仅自动测试通过但真实页面未验证。
