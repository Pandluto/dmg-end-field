# Spec 8-2-2：DEF current tool 全量准入与全队原子候选

## 状态

待实施。本规格是提交 `5ad5a72` 的审计收尾，只补齐 [Spec 8-2-1](./spec8-2-1.md) 未完成的工具侧门、全队候选和验收证据，不推翻已经成立的 canonical current gate、正式 SQLite 准入或统一 current projection。

关联任务：[Task 8-2-2：封闭 current tool 侧门并落地全队候选 C](./task8-2-2.md)。

## 一句话定调

**凡是会读取、验证或修改当前 Workbench 的能力，都必须由工具合同自动进入 canonical current gate，不能靠人工维护一小段工具名白名单；全队重新配装必须先从当前 checkout 一次生成完整候选 C，再统一 diff、审批和 apply，任何失败都不得部分应用。**

## 已经成立的部分

`5ad5a72` 已证明并保留：

- `activeWorkbench.timelineId = currentProjection.timelineId = sessionBinding.timelineId` 的 canonical gate；
- 当前投影带 `timelineId/activeTimelineId`；
- Work Node fork 使用认证后的当前 checkout parent，并校验 revision；
- team loadout、operator config 和 Work Node 主路径可拒绝 A/B mismatch；
- 单角色 prepare/discard/apply 携带 session、timeline、parent/candidate revision；
- native session binding/context 失败时清理本次新建的独立 session 目录；
- `candidate/spec8-2-1-current-gate` 已创建但未 promotion。

本轮不得回退这些保护，也不得把 current projection 改造成每个工具各读一套 SQLite。

## 审计确认的剩余问题

### 1. Gate 仍是残缺的工具名白名单

当前 dispatcher 只对 `def.workbench.*`、`def.worknode.*` 和少数显式名称调用 gate。以下 native data resources 仍可能直接读取全局 current projection：

- 当前已选角色：`def.character.resolve`；
- 当前排轴技能：`def.skill.resolve`；
- 当前按钮/配装 Buff：`def.buff.resolve`、`def.buff.search_candidates`；
- 当前已装备物：`def.equipment.resolve`、`def.gear.resolve` 的 current 部分。

因此 session 绑定 A、页面已经在 B 时，Agent 仍可能从这些侧门读到 B。

### 2. Current mutation 和 verification 仍有侧门

以 command queue 或 legacy REST 形式存在的 current mutation/verification 不能只因为没有直接暴露成一个常用 OpenCode 工具就被视为安全。至少包括：

- skill button add/remove；
- Buff add/remove 与批量修改；
- target resistance；
- damage calculate/verify；
- gear entry level；
- current snapshot/button/damage verification；
- 会读取或推进当前 checkout 的兼容路由。

无绑定、A/B mismatch 或 stale session 必须在入队前拒绝，不能先写 command queue 再由 UI 偶然失败。

### 3. 全队配装仍逐角色部分应用

现有 team apply 会循环调用单角色 prepare/apply：

```text
P -> C1（角色 1，立即 apply/checkout）
C1 -> C2（角色 2，立即 apply/checkout）
中途失败 -> PARTIAL
```

这会产生分支链和部分生效，不是用户确认的单一全队候选：

```text
P（保持不变）
└─ C（一次包含本轮全部角色变化）
    ├─ validate / diff
    ├─ 一次 permission
    └─ 批准后一次 apply / checkout
```

### 4. Evidence 尚不足

现有 current-gate contract 只覆盖 team loadout、fork、unbound team read、public knowledge 和 temporary admission，没有覆盖上述侧门、operator continuation、session cleanup、A -> B 的迟到 permission 或全队候选。

Harness candidate 已有完整八 Slot，但没有新增对应行为 scenarios；package check 只能证明包结构可用，不能证明 runtime 行为。真实桌面 `snapshotAvailable=false`，因此没有形成正式 SQLite 下的 prompt、permission 和 checkout 证据。

## 第一部分：以工具合同决定 current gate

### 禁止继续维护手写工具名白名单

是否需要 current gate 必须来自 canonical tool metadata，而不是在 dispatcher 中重复维护字符串数组。工具注册信息至少明确：

- `workspaceScope`: `public` / `session-private` / `workbench-current` / `worknode-tree` / `internal-governance`；
- `projectionAccess`: `none` / `public-only` / `current-read` / `current-write`；
- `allowedHosts`: `workbench`、`ai-cli` 或 internal-only；
- 是否进入 renderer command queue；
- 是否需要 current checkout/revision。

统一 dispatcher 在调用具体 handler、读取 snapshot 或写 command queue **之前** 根据 metadata 执行 gate。新增工具如果声明 current-read/current-write/worknode-tree，就自动继承 gate，不需要再补第二份名称列表。

### Scope 合同

| Scope | 无 Workbench binding | A/A/A | A/B mismatch |
| --- | --- | --- | --- |
| `public` | 允许 | 允许 | 允许，但不得混入 current 数据 |
| `session-private` | 只访问本 session 私有状态 | 允许 | 恢复 Workbench 操作前重新 gate |
| `workbench-current` | 拒绝 | 允许 | 拒绝 |
| `worknode-tree` | 拒绝 | 允许绑定树内节点 | 拒绝 |
| `internal-governance` | 仅可信 host 内部调用 | 允许精确内部操作 | 拒绝或清理本次对象 |

### 混合型 data resource

`buff/equipment/gear` resolver 同时包含 public library 与 current equipped/selected 数据时，不得把两者混为一个无标识结果。实施可以选择：

1. 整个工具按 `workbench-current` gate；或
2. 明确拆分/过滤结果：无 binding 只返回标注为 public library 的候选，通过 gate 后才附加 current selection/equipped 来源。

不论选择哪种实现，都必须满足：无绑定或 A/B mismatch 不能看到另一个 Workbench 的当前角色、按钮、Buff、装备、checkout 或 damage report。若保留 public-only 返回，响应必须明确 `scope/source`，不能让 Agent 把 catalog 候选误说成“当前已装备”。

### Internal governance 不得暴露给模型

session-axis bind/assert/unbind、失败 create cleanup 等治理能力只供 native host/server 内部调用：

- 不出现在模型可调用 registry/exposure 中；
- direct REST 必须验证可信调用上下文和精确 session/binding；
- unbind 只能删除本 session 的精确 binding，不能仅凭任意 binding id 删除别的 session；
- cleanup 只作用于本次 create 刚产生的 session/directory。

## 第二部分：所有入口使用同一策略

以下入口不得各自形成不同权限口径：

- OpenCode native typed tool adapter；
- `/api/def-tools/call`；
- legacy per-tool REST route；
- renderer command queue；
- private prepare/apply/discard continuation；
- verification route；
- Interop/Harness runner。

请求最终可以复用同一个 handler，但必须先经过同一 metadata policy。禁止出现“typed tool 会拒绝，直接 REST 同名调用却能读写”的旁路。

Current mutation 的拒绝后置条件：

```text
command queue count unchanged
command result log unchanged
current projection unchanged
checkout unchanged
Work Node tree unchanged
permission/question unchanged
```

## 第三部分：全队候选 C 的原子合同

### Prepare 阶段

给定 READY team plan 和认证后的当前 checkout P：

1. 锁定 session、timeline、axis binding、P id/revision/hash；
2. 以 P 的 payload 创建内存中的候选 payload；
3. 把本轮所有角色 exact patches 应用到同一候选 payload；
4. 任一角色解析、四槽装备、武器、revision 或 schema 校验失败时整体失败，不修改 live state；
5. 全部成功后只创建一个 child C；
6. C 的 base 为 P payload，working 为完整全队候选；
7. 返回 C id/revision/hash、P id/revision、完整 diff 和一次 permission metadata。

实现不得通过依次 apply 单角色来构造 C。若 renderer 才能计算配置，可增加一个 bounded batch preview，或在明确的 cloned payload 上顺序计算，但计算过程不能写 live cache、移动 checkout 或创建多个已应用节点。

### Permission 阶段

一次 permission 必须覆盖完整 `P -> C` diff，并绑定：

- session id；
- timeline id；
- axis binding id；
- team plan id/hash；
- P id/revision/hash；
- C id/revision/hash；
- 所有角色 exact patch 摘要；
- 预期 apply/checkout 后置条件。

不能先审批计划文字，再在 apply 时重新生成另一个候选。

### Apply 阶段

批准后：

1. 重新执行 canonical gate；
2. 校验 P 仍是 current checkout 且 revision/hash 未变；
3. 校验 C、plan 和 permission metadata 完全一致；
4. 一次把 C 的完整 payload 应用到 renderer；
5. 验证所有角色 live postcondition 与 C payload/commit 一致；
6. 仅在全部验证通过后把 checkout 标记并移动到 C。

运行时不得再返回 `PARTIAL`。任何 precondition、renderer 或 postcondition 失败都不得继续后续角色，也不得把 checkout 移到一个只完成部分角色的状态。

如果 renderer 在一次 batch apply 中发生无法回滚的中途异常，必须返回 reconciliation-required，保持 Work Node checkout 不变并阻止后续 mutation；不能把部分结果包装成成功。实现应优先设计为一次 payload hydrate，避免逐角色 live mutation。

### Reject / discard / stale

- reject/discard：P 与 live state 不变，C 按安全 leaf 规则删除或保留为明确未应用草稿；
- A -> B、P revision change、C revision/hash change、permission expiry：旧 capability 作废；
- 重试必须从最新 checkout 新建新的 plan/candidate，不能复用旧 permission。

## 第四部分：自动证据矩阵

必须用表驱动或从 tool metadata 派生的合同测试覆盖全部工具，防止以后新增 current tool 又漏 gate。

### Current tool matrix

对每一个 `workbench-current` / `worknode-tree` 工具至少验证：

- A/A/A 合法请求通过或到达预期业务校验；
- binding A + projection B 在 handler/queue 前拒绝；
- unbound AI CLI 拒绝；
- stale/temporary 拒绝；
- read 不返回 B 数据；
- mutation/verification 拒绝路径零 queue、零 checkout、零 tree 变化。

Public tools同时验证无绑定可用，且不夹带 current snapshot 字段。测试 fixture 的 A/B 内容必须明显不同，不能两个 timeline 都使用同一个角色/按钮值。

### 分支与 continuation matrix

- 单角色 prepare -> reject/discard：P 不变；
- 单角色 prepare -> A/B switch -> approve：拒绝；
- session create binding/context failure：只清理新 session，无孤儿 binding/directory；
- 全队两人及四人 plan：只创建一个 C；
- 全队 C diff 包含全部角色；
- 全队 approve：一次 checkout 到 C，所有 postcondition 通过；
- 第二个角色故意失败：零 live/checkout 变化，不出现 `PARTIAL`；
- P/C revision 或 hash 被修改后 approve：拒绝。

## 第五部分：真实 UI 与 Harness

### Mac Desktop 黑盒

按 `docs/testing/def-agent-blackbox.md` 使用 Mac Desktop Interop Route。必须在一个可验证的正式 SQLite 投影下取得：

- `snapshotAvailable=true`；
- UI consumer 与 session/binding/timeline 可关联；
- current read 正常；
- 单角色或全队 candidate 在 UI Work Node 树可见，P 保留；
- permission reject 零变化；
- permission approve 后 checkout 指向精确 C；
- pending permission 后 A -> B，旧批准拒绝。

如果环境没有合法正式 SQLite 或 projection bridge 故障，应记录并修复环境/bridge，不能用“iframe 可见”替代行为证据，也不能在 `snapshotAvailable=false` 时发送盲目 mutation prompt。

### Harness

`candidate/spec8-2-1-current-gate` 已经提前写入“全队单候选分支”教学，但当时 runtime 尚未实现。该候选保持 immutable，不原地修改；将它标记为被本轮 supersede 的审计样本，不得作为行为通过证据或 promotion target。

本轮创建新 candidate，并新增至少覆盖以下行为的 scenarios：

- current data side-door A/B mismatch；
- unbound current read/mutation；
- public-only resource remains available；
- stale permission after timeline switch；
- single candidate team apply；
- team apply failure has zero partial state。

必须区分 package check 与 native regression。只有八 Slot 完整不等于行为通过；promotion 仍由人工决定。

## 验收标准

- [ ] 工具 metadata 是 current gate 的唯一分类事实源，dispatcher 不再维护残缺名称白名单。
- [ ] 所有 current data resources 在 A/B 或无绑定场景拒绝/过滤 current 内容。
- [ ] 所有 current mutation/verification 在 command queue 前完成 gate，拒绝路径零变化。
- [ ] typed tool、generic REST、legacy route、private continuation 与 Interop 使用同一策略。
- [ ] internal bind/unbind/cleanup 不向模型或任意 session 暴露。
- [ ] 全队 plan 从 P 只创建一个完整候选 C。
- [ ] 全队只有一次完整 diff、一次 permission、一次 apply 和一次 checkout。
- [ ] 全队任意角色失败不产生 `PARTIAL` live state 或 checkout。
- [ ] operator continuation、session cleanup、A -> B stale permission 有自动合同证据。
- [ ] 正式 SQLite 下取得真实 Mac Desktop Interop/UI 的 read、reject、approve、switch 证据。
- [ ] 新 Harness candidate 有行为 scenarios 与 native regression，不只 package check。
- [ ] 未经人工审阅不 promotion。

## 明确不做

- 不重做 SQLite、TimelineDocument、存档或 current projection 架构；
- 不让每个工具各自打开 SQLite；
- 不修改用户手动配装页面；
- 不开放临时 SQLite AI 模式；
- 不开放 workspace/archive create、temporary promote、session rebind；
- 不扩展新的配装推荐算法或游戏知识；
- 不修改 vendor OpenCode；
- 不自动 promotion。

## 完成定义

当任何能接触当前 Workbench 的工具都会由 metadata 自动进入同一 canonical gate，所有 typed/REST/command/continuation 入口不存在侧门，全队重新配装只产生一个完整候选 C 并以一次精确审批原子应用，同时自动矩阵、真实 Mac Desktop 与 Harness native regression 形成可复核证据，Spec 8-2 系列权限返修才算闭合。
