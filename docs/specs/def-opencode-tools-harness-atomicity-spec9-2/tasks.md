# Spec 9-2 Tasks：五业务原子 Harness 施工任务

## 状态

实现完成，最终验收未闭环（2026-07-23）。

Task 1—14 已实现并提交；Task 15 的自动合同、五业务只读黑盒和真实
Workbench 可见性已通过；Selection 非空换人和反向恢复也已在真实页面通过。
其余 mutation、approval 拒绝、跨业务计划和运行时热重载的完整 UI 矩阵尚未在
隔离测试工作区执行，因此本轮不能标记为全部交付。
证据和剩余边界见 `verification.md`。

这份任务单按一条真实施工路线编写，不再按架构名词罗列组件。

每个 Task 完成后按项目规则自动提交；但只有全部 Task 完成并通过真实 UI 验证，本轮才算交付。

## 总施工路线

| 顺序 | 要解决的问题 | 完成后的可见产物 |
| --- | --- | --- |
| 1—3：解耦 | 把旧系统拆出清楚边界，并建立唯一回合入口 | Host、Harness、Tool 不再互相复制责任 |
| 4—8：新系统 | 建立能路由、绑定、执行、更新 Harness 的 Manager | 一项业务事务可以完整跑通并独立换版 |
| 9—13：五个 V1 | 把五项游戏业务写成真实 Harness | 五个业务都能通过现有 Typed Tools 完成 |
| 14：切换 | 删除兼容桥和旧运行链 | 正式 Workbench 只走新 Manager |
| 15：验证 | 合同、黑盒、真实 UI 验证 | 证明不是“文档完成”，而是产品完成 |

## 任务交接关系

| Task | 状态 | 前置 | 它交给下一步什么 |
| --- | --- | --- | --- |
| 1 | [x] | 无 | 旧规则迁移清单、硬合同保护 |
| 2 | [x] | 1 | 唯一 `prepareWorkbenchTurn()` 接缝 |
| 3 | [x] | 1、2 | 新链路专用的最小 Host/Tool contract |
| 4 | [x] | 2 | 五业务 Registry 和单业务 Revision Controller |
| 5 | [x] | 4 | route state、业务选择和跨业务 Plan |
| 6 | [x] | 2、4、5 | 可恢复的业务事务与真实上下文 |
| 7 | [x] | 4、5、6 | route/business phase runtime 和动态 Tool |
| 8 | [x] | 6、7 | 写入隔离、提交协调和下游状态 |
| 9 | [x] | 4—8 | selection V1 |
| 10 | [x] | 4—8 | loadout V1 |
| 11 | [x] | 4—8 | timeline V1 |
| 12 | [x] | 4—8 | buff V1 |
| 13 | [x] | 4—8 | calculation V1 |
| 14 | [x] | 1—13 | 单一正式主链路 |
| 15 | [ ] | 14 | 可交付证据 |

---

## 第一部分：解耦

### Task 1：盘清旧规则，并冻结不能丢的硬合同

#### 目标

在改代码前，把“业务教学”和“产品硬合同”分开，防止解耦时误删 checkout、审批、CAS 或真实后置验证。

#### 代码入口

- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/server/def-agent-server.cjs`
- `agent/runtime/def-opencode-adapter/harness-turn-router.cjs`
- `agent/runtime/def/skills/timeline-workbench/SKILL.md`
- `agent/harness/def-harness.cjs`
- `agent/harness/baseline/stable-v0/**`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/runtime/def-tools/opencode/plugin.js`
- `agent/runtime/def-tools/registry.mjs`
- `scripts/ai-cli-rest-server.mjs`
- `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs`

#### 实施

1. 对现有规则逐类标记最终归属：
   - Host 当前事实；
   - Harness 业务流程；
   - Knowledge 游戏知识；
   - Tool 本地合同；
   - Tool/Host 硬执行；
   - 删除。
2. 固定下列硬合同，后续任务不得把它们迁成 Prompt：
   - Workbench Session 与 timeline/checkout 绑定；
   - 页面 projection 收敛；
   - host/workspace exposure；
   - native permission 和 approval；
   - proposal/capability/token；
   - revision/CAS；
   - Work Node validate/diff/use/restore；
   - 产品命令 schema、公式和真实 postcondition。
3. 为固定 Prompt、Host Prompt、总 Skill、旧八槽和 Tool description 中的重复业务段落建立迁移清单。
   - 保存到本 Spec 目录的 `migration.md`；
   - 每项记录源文件/函数、规则摘要、目标 owner、目标文件、迁移状态和删除证据。
4. 补齐必要的现状保护测试，只保护上述硬合同，不给旧巨型 Prompt 做全文快照。

#### 产物

- `docs/specs/def-opencode-tools-harness-atomicity-spec9-2/migration.md`；
- 硬合同的现有测试入口或本轮新增的最小保护测试。

#### 通过条件

- 每条旧业务规则都知道要迁到哪个业务 Harness，或明确删除；
- 每条硬合同都能指出实际执行代码；
- 没有把“当前代码存在”直接当成“目标架构必须保留”。

---

### Task 2：建立唯一的 Workbench 回合入口

#### 目标

让 Server 不再自己拼接 Host Prompt、旧 Harness 和业务命令。所有正式回合先经过同一个入口，为后续替换新 Manager 留出唯一接缝。

#### 代码入口

- `agent/server/def-agent-server.cjs`
  - OpenCode `/session/:id/message` proxy
  - `sendNativeInteropPromptOnce()`
- `agent/runtime/def-opencode-adapter/index.cjs`
  - `getNativeHarnessSystem()`
  - Workbench Session 创建与恢复

#### 实施

1. 新建 `agent/runtime/def-harness-manager/index.cjs`。
2. 暴露一个明确入口，例如：

```text
prepareWorkbenchTurn({
  binding,
  axisContext,
  workbenchContext,
  userText,
  incomingSystem,
  diagnostic
})
```

3. 入口统一返回：
   - 本次发送给模型的 system context；
   - 本次允许的 Tool；
   - 当前业务事务和阶段标识；
   - 需要写入 Trace 的最小元数据。
4. Server 的普通消息入口和 Mac Desktop Interop 入口都改为调用这一处。
5. 本 Task 可以用一个短期 compatibility adapter 调用旧 `getNativeHarnessSystem()`，只为了保持开发分支可运行。
6. compatibility adapter 不得形成第二个正式入口，也不得延续到 Task 14。

#### 产物

- `agent/runtime/def-harness-manager/index.cjs`
- 两条 Workbench ingress 都经过同一 `prepareWorkbenchTurn()`。

#### 通过条件

- 普通 UI 和 Interop 对同一输入得到相同的 Host/Harness 入口行为；
- Server 文件不再直接决定加载哪个旧 Harness；
- 现有 Session、checkout 和黑盒入口仍可运行。

---

### Task 3：抽出干净的 Host Kernel 和 Tool 本地合同

#### 目标

把新主链路需要的 Host 与 Tool 边界准备好。业务流程暂由 compatibility adapter 保持，最终在 Task 14 一次删除。

#### 代码入口

- `agent/runtime/def-opencode-adapter/index.cjs`
  - `buildAgentPrompt("workbench")`
- `agent/server/def-agent-server.cjs`
  - `buildWorkbenchCheckoutSystemPrompt()`
  - `buildWorkbenchContextSystemPrompt()`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/runtime/def-tools/registry.mjs`

#### 实施

1. 抽出一份供新 Manager 使用的最小 Workbench Agent Prompt：
   - Agent 身份；
   - 当前事实不得伪造；
   - mutation 不能越过 typed Tool 和真实 postcondition；
   - 从 Harness Manager 接收当前业务教学。
2. 抽出一份供新 Manager 使用的最小 Host 回合内容：
   - Session/timeline/checkout 身份；
   - checkout transition；
   - projection 状态；
   - 当前不可绕过 gate 的事实。
3. 为 canonical Tool contract 增加一份本地能力视图，只包含：
   - Tool 做什么；
   - 需要什么输入；
   - 返回什么状态；
   - 是否有副作用；
   - capability/token 的真实来源；
   - 本 Tool 的 typed error。
4. 标出 legacy description 中“必须第一个调用”“下一步调用谁”“整个流程如何结束”“最终怎样回复”的段落，交给 Task 9—13 逐项迁移。
5. Task 14 前，compatibility adapter 可以继续使用旧 Prompt/description 保持开发分支行为；新 Manager 路径只能读取最小 Host 和本地 Tool contract。
6. Task 14 在五个 V1 完成后切换 exposed description，并删除 legacy view。
7. 不改变 Tool handler、approval、scope、schema 和产品执行结果。

#### 产物

- 可供新 Manager 使用的最小 Host Kernel；
- 不携带完整业务工作流的 Tool 本地合同视图；
- 旧业务教学已进入 Task 9—13 的迁移待办。

#### 通过条件

- 新 Manager 使用的固定 Prompt 和 Tool contract 已经无法拼出一套第二业务流程；
- checkout、permission、approval、CAS、失败熔断和 postcondition 仍由代码强制；
- compatibility adapter 仍能在开发期间补足尚未迁移的业务教学。

---

## 第二部分：新的 Harness 系统

### Task 4：实现业务定义、版本注册和单业务热重载

#### 目标

先让系统能够认识“五个业务”和“每个业务自己的版本”，替代旧的八槽整包与 Session package binding。

#### 代码入口

- 新目录 `agent/runtime/def-harness-manager/`
- 新目录 `agent/harness/business/`
- 旧参考 `agent/harness/def-harness.cjs`

#### 实施

1. 在 Manager 中实现 Registry 和 Revision Controller。
2. 定义两个清楚的文件合同：
   - `definition.json`：业务硬边界；
   - `revisions/<version>/manifest.json`：可更新的阶段、Tool 引用和知识入口。
3. Registry 只注册：
   - `selection`
   - `loadout`
   - `timeline`
   - `buff`
   - `calculation`
4. Task 4 可以用测试夹具验证 Registry，但不得把空 definition/Revision 注册成正式 active；真实五业务源由 Task 9—13 交付。
5. 注册时检查：
   - 业务 id 是否有效；
   - 动作是否属于该业务；
   - Tool id 是否存在于 `DEF_NATIVE_TARGETS`；
   - mutation 阶段是否有验证步骤；
   - Revision 是否扩大了业务写入边界；
   - 阶段是否存在死路。
6. 每个业务分别保存 candidate、active 和 previous。
7. 支持：
   - register；
   - validate；
   - activate；
   - inspect；
   - rollback；
   - revoke。
8. 暴露 `reloadBusiness(businessId)` 一类的单业务重载入口：
   - 开发态可由经过 debounce 的文件变更触发；
   - 合同测试和管理流程可显式触发；
   - 普通热重载只接受 `revisions/**`，`definition.json` 硬边界变化要求代码迁移/重启；
   - 只有完整校验通过后才原子切换 active Revision。
9. 激活一个业务时，只替换该业务的新事务版本。
10. 校验失败时保持 last-known-good，并返回可读错误。
11. 新 Manager 的合同不得读取或生成全局 Harness package ref；旧 Session binding 的实际删除留到 Task 14 一次切换。

#### 产物

- 可独立加载和更新五个业务的 Registry；
- 单业务 Revision 的校验、启用、回退和撤销能力。

#### 通过条件

- 更新 `loadout` 不改变另外四个业务 active version；
- 无效 Revision 无法上线；
- 不新建 Session，也能让下一项新业务使用新版；
- 尚未完成的旧事务不会被自动换版。

---

### Task 5：实现 Router 和跨业务 Plan

#### 目标

把一句用户话语可靠地变成“新业务、继续事务、跨业务计划或追问”，不再用少量正则承担总路由。

#### 代码入口

- 新建或实现：
  - `agent/runtime/def-harness-manager/router.cjs`
  - `agent/runtime/def-harness-manager/plans.cjs`
- 迁移参考：
  - `agent/runtime/def-opencode-adapter/harness-turn-router.cjs`

#### 实施

1. Router 先检查是否在继续一个明确的待确认事务。
2. 为新自然语言请求建立一个 Manager route phase：
   - system 只包含五业务简短定义；
   - 不加载五个业务 Revision；
   - 不开放任何业务 Tool。
3. 在 canonical registry 中增加一个 internal-governance route 提交能力，例如：
   - canonical id：`def.harness.route`；
   - OpenCode binding：`def_harness_route`；
   - 只接受结构化 route 结果；
   - 只在 Manager route phase 可见。
4. route 提交内容包括：
   - 新业务；
   - 业务内动作；
   - 目标；
   - 用户要求的效果；
   - 是否存在歧义。
5. `def_harness_route` 只做 schema/Type 校验并把结果交给 Manager；它不读取攻略、不修改方案、不返回业务答案。
6. route Tool 完成后，Manager 创建事务；同一用户回合的下一次模型请求才加载目标业务 Revision。
7. 确定性 shortcut 只能处理明确 continuation 或完全无歧义的系统命令，最终结果仍通过同一 route schema。
8. 一个请求明确包含多个业务效果时，建立有序 Plan。
9. 一个效果同时可能属于两个业务时，返回结构化追问，不按正则或加载顺序覆盖。
10. 角色、装备、套装、技能、BUFF 和 `3+1` 只能成为目标或条件。
11. Plan 只保存总目标、步骤、当前位置、方案版本和状态；每一步仍创建对应业务事务。

#### 必须覆盖的例子

| 用户请求 | Router 结果 |
| --- | --- |
| “给别礼配置 3+1 潮涌套” | 一个 `loadout` 事务 |
| “换成别礼” | 一个 `selection.replace` 事务 |
| “换成别礼，再配 3+1 潮涌套” | `selection` 后接 `loadout` |
| “确认应用刚才那套” | 继续唯一匹配的待确认 `loadout` 事务 |
| 同时存在两个可确认候选时说“确认” | 追问，不猜 |

#### 产物

- 结构化 Router；
- 可暂停、继续和停止的跨业务 Plan。

#### 通过条件

- Router 不再返回旧 Harness selector；
- 新自然语言请求的第一次模型请求只看到 route 能力；
- route Tool 后的下一次模型请求才看到目标 Harness 和它的阶段 Tool；
- 跨业务请求没有创建“万能 Harness”；
- 继续事务必须匹配原目标、候选和当前上下文；
- 歧义通过现有 question/interaction 边界呈现。

---

### Task 6：实现机器可读的业务事务和上下文绑定

#### 目标

让“预览—确认—应用”不再依赖模型翻聊天记录，并让 Harness 真正绑定当前游戏方案。

#### 代码入口

- 新建或实现：
  - `agent/runtime/def-harness-manager/transactions.cjs`
  - `agent/runtime/def-harness-manager/context.cjs`
- 复用：
  - `agent/server/def-agent-server.cjs` 的 Session-axis/checkout 同步
  - Workbench Session 工作目录

#### 实施

1. 每个业务事务保存：
   - transaction id；
   - Session、timeline、checkout；
   - 起始和当前方案版本；
   - business、operation、Harness Revision；
   - 目标与用户限制；
   - 当前阶段；
   - 知识 evidence refs；
   - proposal、artifact、capability、Work Node ref；
   - 状态。
2. 状态至少包含：
   - active；
   - awaiting-confirmation；
   - completed；
   - aborted；
   - superseded；
   - stale；
   - revoked。
3. 事务状态保存到受管 Workbench Session 目录中的机器可读文件，使用原子写入；不能只存在内存或 transcript。
4. Session 清理时，这些事务随受管目录一起删除。
5. 恢复 Session 时：
   - 能恢复完整引用则继续；
   - proposal、capability、方案版本或证据不完整则标记 stale/aborted；
   - 禁止从旧对话猜出 token 后继续。
6. 用户纠正目标时，将旧候选标记 superseded，再建立新事务。
7. Context 层把当前 checkout/catalog 事实与攻略证据分开：
   - 当前状态只能来自 Host/typed Tool；
   - 攻略由业务 Revision 的 evidence phase 按目标和条件读取；
   - Tool 返回的 reference/section/hash/适用条件写入事务；
   - 后续确认不能静默换 evidence。
8. 为每个事务追加一条机器可读 Trace，至少记录：
   - route 与 Harness Revision；
   - 起始/当前方案版本；
   - phase 变化；
   - Tool call/result state；
   - evidence refs；
   - 最终状态。

#### 产物

- 可创建、继续、恢复和结束的业务事务存储；
- 事务与真实 Workbench 上下文的绑定。
- 可按 transaction id 读取的 Trace。

#### 通过条件

- “确认应用”能精确找到原候选和原 Harness 版本；
- checkout 或方案版本变化后，旧候选不能直接应用；
- 重启/恢复不会让丢失 capability 的事务假装可继续；
- 删除 Workbench Session 后没有孤立的可应用事务。

---

### Task 7：实现阶段运行和 Tool 动态投影

#### 目标

让当前 Harness 真正控制“当前阶段能看到什么 Tool”，而不只是往 Prompt 里写一段建议。

#### 代码入口

- `agent/runtime/def-harness-manager/`
- `agent/runtime/def-tools/opencode/plugin.js`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/vendor/opencode/packages/opencode/src/session/llm/request.ts`
- OpenCode plugin hook contract

#### 实施

1. Runtime 同时处理：
   - 尚未创建业务事务的 Manager route phase；
   - 已创建事务后的 business operation/phase。
2. 每次模型请求前，根据当前 phase 生成：
   - 本阶段 Harness instructions；
   - 本阶段允许的 Tool binding；
   - 当前业务上下文摘要。
3. 在 OpenCode request preparation 增加一个窄的 Tool projection 接缝，或实现等价的逐请求 permission bridge。
4. Server、OpenCode request projection 和 Tool plugin 必须通过同一个内部 bridge 读写 Transaction Runtime；不得各自维护一份内存状态。
5. 不能只在用户消息进入时过滤一次；同一用户回合中 Tool result 推进阶段后，下一次 LLM request 必须重新投影。
6. `tool.execute.before` 校验：
   - Session；
   - turn；
   - route state 或 transaction；
   - business/operation/phase；
   - 当前 Tool 是否在阶段 allowlist。
7. `tool.execute.after` 将 typed result 交给 Runtime：
   - 保存结果引用；
   - 推进到下一个阶段；
   - 标记失败、待确认或完成；
   - 为下一次模型请求准备新 Tool 集。
8. 未投影 Tool 即使被模型构造，也返回稳定拒绝。
9. Harness 只引用 canonical Tool id，不复制 Tool schema 和 handler。

#### 产物

- 可执行的 phase runtime；
- OpenCode 的逐模型请求 Tool projection；
- Tool before/after 与事务状态机闭合。

#### 通过条件

- 证据阶段看不到 apply Tool；
- proposal 完成后，下一次模型请求进入待确认或下一阶段；
- 当前 phase 之外的 Tool 在执行前被拒绝；
- 一个 Tool 被多个业务使用时，各业务阶段仍独立；
- 整个 operation 的 Tool 没有被一次全部暴露。

---

### Task 8：实现业务写入边界、并发提交和下游影响

#### 目标

让五个 Harness 即使共享 Work Node 和按钮对象，也不能互相写坏状态。

#### 代码入口

- `agent/runtime/def-harness-manager/`
- `agent/runtime/def-node-workspace/codec.mjs`
- `agent/runtime/def-node-workspace/timeline-invariant.mjs`
- `scripts/ai-cli-rest-server.mjs` 的 semantic diff 与 mutation 结果
- 现有 revision/CAS/postcondition

#### 实施

1. 为五业务建立语义写入视图：
   - selection：队伍成员和顺序；
   - loadout：武器、装备、技能等级和配置输入；
   - timeline：按钮身份、位置、顺序和排轴结构；
   - buff：BUFF 绑定、层数、异常和相关战斗状态；
   - calculation：无源状态写入权。
2. mutation 返回后，将变化区分为：
   - 当前业务主动要求的变化；
   - 产品为了保持合法状态自动完成的同步/清理；
   - 公式或统计重算；
   - 无法解释的越界变化。
3. 出现越界变化时阻止提交并返回明确错误。
4. 同一 timeline/checkout 的 mutation commit 串行执行，并继续使用现有 revision/CAS。
5. 一个提交成功后，重新检查其他未完成事务：
   - 无关但需重新验证；
   - stale；
   - hard-invalid；
   - calculation recompute。
6. 禁止 last-write-wins、静默 rebase 和旧确认跨方案版本应用。
7. Trace 记录主动变化、产品级联和下游处理，不把所有变化都归给当前 Harness。

#### 产物

- 五业务 semantic write-scope；
- mutation 提交协调；
- 下游事务失效/过期/重算处理。

#### 通过条件

- 排轴不能直接改 `selectedBuff`；
- BUFF 可以改按钮 BUFF，但不能移动按钮；
- 换人后产品可以确定性清理离队角色按钮，但选人 Harness 不因此获得排轴写权；
- 任一方案更新后，旧 proposal 不能绕过 CAS；
- 计算结果始终标明使用的方案版本。

---

## 第三部分：五个 Harness V1

### V1 统一文件结构

每个业务使用同一结构：

```text
agent/harness/business/<businessId>/
├── definition.json
└── revisions/
    └── v1/
        ├── manifest.json
        └── instructions.md
```

`definition.json` 写稳定边界；`manifest.json` 写 operation、phase、Tool refs、knowledge query 和完成出口；`instructions.md` 写面向模型的领域业务教学。

V1 必须引用 `DEF_NATIVE_TARGETS` 中真实存在的 canonical Tool id。缺少能力时返回 unsupported，不允许编造 Tool。

以下是 V1 的起始 capability pool，不是一次全部暴露的 allowlist。每个 operation/phase 只能选用当时真正需要的子集：

| 业务 | 起始 canonical Tool refs |
| --- | --- |
| selection | `def.node.crud.context`、`def.data.resource.operator`、`def.data.resource.operator_catalog`、`def.team.selection.apply` |
| loadout | `def.data.resource.team_loadouts`、`loadout_candidates`、`operator_build_guide/profile`、`combat_conventions`、`game_knowledge/section`、`weapon/weapon_fit_plan`、`equipment/native_catalog/3plus1`、`def.operator.config.preview/patch`、team plan/revise/apply |
| timeline | `def.node.crud.context/current/buttons`、`def.data.resource.skill`、`def.node.code.*`、fork/bind/validate/diff/use/restore |
| buff | `def.node.crud.context/buttons/buff_ranking`、`def.data.resource.buff`、`def.node.code.*`、fork/bind/validate/diff/use/restore |
| calculation | `def.node.crud.context`、`def.data.resource.damage` |

实现时必须把表中的简称解析回 `DEF_NATIVE_TARGETS` 的完整 canonical id，并在 manifest 校验中拒绝不存在的引用。

---

### Task 9：实现选人 Harness V1

#### 目标

让查看、新增、删除、替换和调整队伍都由一个 selection Harness 完成。

#### 代码入口

- 新目录 `agent/harness/business/selection/`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/atomic-team-command-state.mjs`
- `agent/runtime/def-tools/atomic-team-candidate.mjs`
- `agent/runtime/def-tools/atomic-team-rollback.mjs`
- 旧教学入口 `agent/runtime/def/skills/timeline-workbench/SKILL.md`

#### 实施

1. 建立 `selection/definition.json` 和 `revisions/v1/**`。
2. 支持：
   - inspect；
   - search；
   - add；
   - remove；
   - replace；
   - reorder；
   - analyze；
   - apply。
3. 阶段最少覆盖：
   - 读取当前队伍；
   - operator catalog 精确解析；
   - 生成候选和下游影响；
   - apply/approval；
   - 真实页面验证。
4. 使用正式 `def.team.selection.apply` 能力，不通过 Work Node JSON 模拟选人。
5. 将当前固定 Prompt 和总 Skill 中的选人规则迁入该 Revision。

#### 产物

- 可被 Registry 激活的 selection V1；
- 从读取当前队伍到真实页面验证的完整 selection 工作流；
- 已从固定 Prompt 和总 Skill 迁出的选人教学。

#### 通过条件

- 新增、删除、换人和排序都只创建 selection 事务；
- 同队伍 no-op、部分保留和全队替换继续遵守现有产品规则；
- 真实页面 selection 与 postcondition 一致；
- 下游排轴、BUFF、配装结论和计算得到正确处理。

---

### Task 10：实现配装 Harness V1

#### 目标

让角色配置、武器装备分析、推荐、预览、确认和应用成为一项完整配装业务。

#### 代码入口

- 新目录 `agent/harness/business/loadout/`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/runtime/def-tools/opencode/operator-config-input.mjs`
- `agent/runtime/def/skills/game-knowledge/`
- 旧教学入口 `agent/runtime/def/skills/timeline-workbench/SKILL.md`

#### 实施

1. 建立 `loadout/definition.json` 和 `revisions/v1/**`。
2. 支持：
   - inspect；
   - resolve；
   - recommend；
   - compare；
   - preview；
   - apply；
   - restore。
3. 将现有以下链路按 operation/phase 迁入：
   - current team/loadout；
   - guide/profile；
   - combat conventions；
   - weapon/equipment catalog；
   - native catalog artifact；
   - weapon fit；
   - equipment set shortlist；
   - 3+1 facts/plan；
   - operator/team proposal；
   - native approval 和 live postcondition。
4. proposal 必须绑定：
   - 目标角色；
   - 用户条件；
   - Harness Revision；
   - 知识证据；
   - 当前方案版本。
5. 用户纠正、质疑或改变条件时 supersede 旧 proposal。
6. 应用只能消费用户明确确认的原 proposal。
7. 将固定 Prompt、总 Skill 和 Tool description 中的配装流程迁入该 Revision。

#### 产物

- 可被 Registry 激活的 loadout V1；
- 读取证据、形成 proposal、接受纠正、确认应用和页面验证的完整配装工作流；
- 已从固定 Prompt、总 Skill 和巨型 Tool description 迁出的配装教学。

#### 通过条件

- “给别礼配置 3+1 潮涌套”只创建一个 loadout 事务；
- `3+1`、角色和套装都没有成为额外 Harness；
- 预览不会创建应用分支；
- 后续确认使用同一 proposal 和知识条件；
- 纠正不是确认；
- 完成以真实 Operator Config 页面为准。

---

### Task 11：实现排轴 Harness V1

#### 目标

让查看、添加、删除、移动、替换、复制和应用技能按钮由 timeline Harness 完成。

#### 代码入口

- 新目录 `agent/harness/business/timeline/`
- `agent/runtime/def-node-workspace/codec.mjs`
- `agent/runtime/def-node-workspace/timeline-invariant.mjs`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/opencode/def.js`
- 旧教学入口 `agent/runtime/def/skills/timeline-workbench/SKILL.md`

#### 实施

1. 建立 `timeline/definition.json` 和 `revisions/v1/**`。
2. 支持：
   - inspect；
   - add；
   - remove；
   - move；
   - replace；
   - copy；
   - validate；
   - preview；
   - apply；
   - restore。
3. 迁移当前：
   - checkout/rebind；
   - exact coordinate；
   - skill identity；
   - Work Node fork/bind；
   - node read/edit/apply_patch；
   - rebuild/validate/diff/use/restore。
4. direct write 只允许按钮身份、位置、顺序和排轴结构。
5. `selectedBuff` 变化不计入 timeline 的主动写入。
6. 将固定 Prompt、Host 业务命令和总 Skill 中的排轴流程迁入该 Revision。

#### 产物

- 可被 Registry 激活的 timeline V1；
- 从精确按钮事实到 Work Node 提交和真实页面验证的完整排轴工作流；
- 明确排除 BUFF 字段的 timeline 写入边界。

#### 通过条件

- 精确坐标和技能身份仍由 typed fact 约束；
- 排轴 mutation 使用正确 Work Node；
- validation/diff/approval/use 顺序由 phase runtime 执行；
- 页面真实排轴与 semantic diff 一致；
- BUFF 字段没有被 timeline Harness 越权改写。

---

### Task 12：实现 BUFF Harness V1

#### 目标

让单体与批量 BUFF、层数、覆盖和异常处理由 buff Harness 完成。

#### 代码入口

- 新目录 `agent/harness/business/buff/`
- `agent/runtime/def-node-workspace/codec.mjs`
- `agent/runtime/def-node-workspace/timeline-invariant.mjs`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/opencode/def.js`
- 旧教学入口 `agent/runtime/def/skills/timeline-workbench/SKILL.md`

#### 实施

1. 建立 `buff/definition.json` 和 `revisions/v1/**`。
2. 支持：
   - inspect；
   - resolve；
   - source；
   - add；
   - remove；
   - replace；
   - batch；
   - stack；
   - coverage；
   - apply；
   - restore。
3. 阶段最少覆盖：
   - 读取当前按钮和 BUFF；
   - 读取 BUFF catalog 与知识；
   - 生成单体/批量候选；
   - Work Node 修改；
   - validation/diff/approval/use；
   - 页面验证和计算更新。
4. direct write 只允许 BUFF 绑定、层数、异常和明确归属 BUFF 业务的战斗状态。
5. 不能移动、替换或删除技能按钮本身。
6. 将固定 Prompt、总 Skill 和 Tool description 中的 BUFF 流程迁入该 Revision。

#### 产物

- 可被 Registry 激活的 buff V1；
- 从 BUFF 解析到单体/批量应用和真实页面验证的完整工作流；
- 与 timeline 相邻但不重叠的 BUFF 写入边界。

#### 通过条件

- 单体和批量操作都只创建 buff 事务；
- button 上的 `selectedBuff` 虽与 timeline 同文件，仍由 buff Harness 独占主动修改；
- BUFF 引用、层数和冲突经过验证；
- 页面真实 BUFF 与 semantic diff 一致；
- 计算事务得到 recompute。

---

### Task 13：实现计算统计 Harness V1

#### 目标

让计算、汇总、比较、归因、诊断和解释成为一个只读完整方案的 calculation Harness。

#### 代码入口

- 新目录 `agent/harness/business/calculation/`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/server/def-agent-server.cjs` 中现有 damage/report 能力
- 旧教学入口 `agent/runtime/def/skills/timeline-workbench/SKILL.md`

#### 实施

1. 建立 `calculation/definition.json` 和 `revisions/v1/**`。
2. 支持：
   - calculate；
   - aggregate；
   - compare；
   - attribute；
   - diagnose；
   - export；
   - explain。
3. 每次计算绑定：
   - 完整方案版本；
   - 公式版本；
   - 用户统计口径；
   - 需要的 catalog/知识条件。
4. 使用现有 damage/report 和公式引擎。
5. 结果说明方案版本、条件、统计口径和缺失输入。
6. 不给 calculation 任何修改 selection/loadout/timeline/buff 的直接写权。
7. 将固定 Prompt 和 Tool description 中的计算/回复流程迁入该 Revision。

#### 产物

- 可被 Registry 激活的 calculation V1；
- 绑定方案版本、公式版本和统计口径的计算报告工作流；
- 不持有上游业务写权的计算边界。

#### 通过条件

- 同一方案可计算、汇总、比较和归因；
- 上游变化后旧报告标记 stale 或重新计算；
- Harness 没有重写产品公式；
- 结果能追溯到准确方案版本。

---

## 集成切换

### Task 14：切换正式 Workbench，并删除旧运行链

#### 目标

让真实 Workbench 只使用新 Manager 和五个 V1，不留下长期双轨。

#### 代码入口

- `agent/server/def-agent-server.cjs`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-opencode-adapter/harness-turn-router.cjs`
- `agent/runtime/def/skills/timeline-workbench/SKILL.md`
- `agent/harness/def-harness.cjs`
- `agent/harness/baseline/**`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/runtime/def-tools/opencode/plugin.js`

#### 实施

1. 让 `prepareWorkbenchTurn()` 正式使用：
   - Router；
   - Registry active Revision；
   - 业务事务；
   - phase runtime；
   - Tool projection；
   - knowledge/context；
   - trace。
2. 普通 UI 与 Interop 同时切换。
3. 删除 Task 2 的 compatibility adapter。
4. 停止在 Session 创建/恢复中调用：
   - `resolveNativeHarness()`；
   - `createSessionBinding()`；
   - `getNativeHarnessSystem()`；
   - `composeHarnessSystem()`。
5. Workbench 不再加载 `timeline-workbench` 作为总 Skill。
6. 旧 `harness-turn-router.cjs` 不再控制正式业务；仍有价值的确定性识别迁入新 Router 后删除或归档。
7. 应用 Task 3 准备好的最小固定 Prompt、Host Prompt 和 Tool description。
8. 旧 baseline/examples/scenarios 若保留，只能进入历史归档或迁移测试，不得再被正式 loader 发现。
9. 全仓检索并逐项关闭 Task 1 的迁移清单。
10. 不保留 `useLegacyHarness`、`newHarnessEnabled` 等长期 feature flag。

#### 产物

- 单一的新 Workbench 主链路；
- 旧八槽、总 Skill、正则 router 和重复业务 Prompt 退出正式运行时。

#### 通过条件

- 一条真实请求只注入一个业务 Harness；
- Session binding 中不存在全局 Harness package；
- 五个业务都由 Registry active Revision 加载；
- 旧运行路径无法被 UI、Interop 或恢复 Session 重新触发；
- AI CLI host 仍保持禁用。

---

## 最终验证

### Task 15：合同、热重载、黑盒与真实 UI 验证

#### 目标

证明三部分已经作为一个产品改动闭合，而不是只完成目录和文档。

#### 当前进度

- 自动合同、既有回归、构建和仓库检查已通过；
- selection、loadout、timeline、buff、calculation 五业务只读黑盒已覆盖；
- selection 已在非空存档完成一次换人和一次独立反向恢复，真实 UI 终态一致；
- 最新 timeline 回合已验证业务级上下文投影和真实 iframe 可见结果；
- 下述其余 mutation、approval 拒绝、跨业务和真实热重载 UI 矩阵仍待隔离验收。

#### 代码入口

- 新增 `agent/runtime/def-harness-manager/**/*.test.*`
- 新增五业务 manifest/写域合同测试
- 现有 `agent/runtime/def-node-workspace/codec.test.mjs`
- `docs/testing/def-agent-blackbox.md`
- Electron 主界面和 DEF Workbench

#### 实施

以下四组验证全部执行；任何一组失败都回到对应 Task 修复，不能通过放宽断言绕过。

##### 自动合同验证

必须覆盖本轮新增的高风险边界：

1. 五业务 definition/Revision 加载；
2. 不存在的 Tool、越界 Tool、无出口 phase 和扩大写域的 Revision 被拒绝；
3. Router 的新业务、继续、跨业务和追问；
4. 事务跨回合保存、恢复、supersede、stale 和 revoke；
5. 同一用户回合 Tool result 后重新投影下一阶段 Tool；
6. `tool.execute.before` 拒绝当前阶段之外的 Tool；
7. 单业务 activate/rollback/revoke 和 last-known-good；
8. 旧事务保持旧版本，新事务使用新版；
9. semantic write-scope 和越界拒绝；
10. 同一 timeline/checkout 的 revision/CAS 提交；
11. 下游继续、stale、hard-invalid 和 recompute；
12. 旧八槽、总 Skill 和巨型业务 Prompt 没有进入正式请求。

##### 五业务最小黑盒

| 业务 | 至少验证 |
| --- | --- |
| 选人 | 查看、换人及真实页面已覆盖；新增、删除、approval 拒绝和完整下游影响待覆盖 |
| 配装 | “别礼 3+1 潮涌套”、预览、纠正、确认、真实页面 |
| 排轴 | 添加/移动/删除技能、Work Node、审批、真实页面 |
| BUFF | 单体和批量 BUFF、写域隔离、真实页面 |
| 计算统计 | 计算、比较或归因、方案版本、上游重算 |

##### 跨业务与热重载黑盒

1. “换人后配装并计算”按顺序执行，每一步读取新方案版本；
2. 更新 loadout V1 时：
   - Session 不重建；
   - 其他四个业务不变；
   - 旧待确认配装继续使用旧版本；
   - 新配装事务使用新版；
3. revoke 旧配装版本后，旧事务不能 apply；
4. 一个 mutation 提交后，其他旧候选不能静默覆盖。

##### 真实 UI

1. 按 `docs/testing/def-agent-blackbox.md` 的 Mac Desktop Interop Route 执行；
2. 读取真实 turn、Tool、question、failure 和 Harness trace；
3. 用 Computer Use 确认页面当前队伍、配置、排轴、BUFF 和计算结果；
4. mutation 不得只凭 Tool acknowledgement 或模型回复判定成功；
5. 验证失败、拒绝、过期、恢复和热重载；
6. 确认 `data/sharedata/**` 和其他用户数据未被本轮改写或清理。

#### 产物

- 可重复执行的 Manager、Revision、Router、事务、Tool 投影和写域合同测试；
- 五业务、跨业务、热重载和旧链删除的黑盒记录；
- 以真实 UI 状态为终点的最终验收记录。

#### 通过条件

- Task 1—14 全部完成；
- 新增合同测试、现有关键回归和真实 UI 黑盒全部通过；
- 正式运行只有一条新主链路；
- 五个 V1 都能真实完成业务；
- 本轮代码从干净启动可以重现；
- 按任务完成点均已自动提交。

以下情况不能通过：

- 只有 Manager 目录；
- 只有五个空 manifest；
- 只迁移配装或 `3+1`；
- Tool 仍一次全部暴露；
- 热重载仍要求新 Session；
- 新旧链路仍可同时生效；
- 模型说成功但真实页面没有变化。
