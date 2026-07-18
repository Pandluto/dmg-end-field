# Spec 8-2-1：当前工作区确定性与 Work Node 工作树统一返修

## 状态

已由提交 `5ad5a72` 完成 canonical current gate、A/B fork 防串线、单角色 continuation 和失败 session cleanup 的首轮实施。独立审计确认主门成立，但发现 current data/mutation 仍有未接 gate 的侧门、全队配装仍逐角色部分应用、真实 UI 与 Harness 行为证据未闭合。后续按 [Spec 8-2-2](./spec8-2-2.md) 返修；8-2-2 完成前，本规格不得验收或 promotion。

关联任务：[Task 8-2-1：闭合当前正式 SQLite 与工作树边界](./task8-2-1.md)。

## 一句话定调

**当前排轴作为 Workbench 的统一数据投影没有问题；DEF 只需先证明“当前打开的正式 SQLite = 当前会话绑定的 SQLite”，随后所有读取、Work Node 和重新配装都在这棵树内完成。重新配装不得覆盖当前节点，必须从当前 checkout 新建横向分支节点。**

## 为什么需要返修

Spec 8-2 首轮实现已经完成以下正确收口：

- Workbench session create 必须携带 `timelineId`；
- 临时、缺失、归档、stale 或 mismatch SQLite 会被拒绝；
- binding 写入后不可改绑；
- 前端 session storage 按 host + timeline 隔离，切换 timeline 会卸载旧 iframe；
- Work Node 工具开始从 session binding 解析目标 timeline。

但是独立审计发现，实现把“目标工作区从 binding 解析”和“当前排轴从全局投影读取”拆成了两条没有重新汇合的链路。结果不是数据架构本身有错，而是缺少一个统一的等值校验：工具知道要写 A，却可能仍拿到当前投影 B 的数据。

审计已复现：

```text
session binding = formal-a
current Workbench projection = formal-b

team loadout read -> 读到 B
worknode fork -> 节点建在 A，但 payload 来自 B
unbound ai-cli -> 可读到当前 Workbench 的 B
```

另有两个 AI 配装链路回归：

- `readDefWorkbenchAxisContext()` 收紧后要求 binding/timeline，但单角色配装和全队配装的旧调用方仍无参调用，合法流程会拿到空 context，并可能误报 checkout 已变化；
- 单角色配装的 prepare/discard/apply continuation 没有持续携带同一 session context，批准恢复时无法证明仍在原工作区和原分支上。

这里说的“配装被弄坏”只指 **DEF AI 自动配装链路**，不指用户手动配置页面。重新配装本来就应该产生新分支，这一产品思路保持不变。

## 本轮只解决两个问题

### 1. 当前对象必须确定

每次 Workbench AI 行为都必须能确定并证明：

```text
activeWorkbench.timelineId
  = currentProjection.timelineId
  = sessionBinding.timelineId
```

并且该 timeline 必须存在、未归档且 `isTemporary=false`。

### 2. 工作树必须统一

确定 timeline 后，当前 checkout、读取源、fork parent、draft、diff、permission 和最终 apply 必须属于同一 timeline、同一棵 Work Node 树和同一次受审阅分支操作。

```text
当前正式 SQLite T
  └─ 当前 checkout P（保留，不原地覆盖）
       └─ 横向新分支 C
            ├─ 写入新的单角色或全队配装
            ├─ validate / diff / permission
            └─ 批准后 checkout -> C
```

拒绝、失配或状态过期时，checkout 仍停留在 P，P 的数据不变。

## 架构定调

### 允许保留当前全局投影

Workbench 只有一个当前打开的排轴，使用统一的 current timeline payload、team snapshot 或 axis context 是合理的。本轮不要求每个 typed tool 各自重新打开 SQLite，也不要求为每个工具建立独立数据源。

但所有 Workbench 当前投影必须带有可验证的 `timelineId`。消费投影前必须经过同一个 authoritative gate，证明投影与 session binding 相等。没有 identity 的旧快照不能靠“它大概就是当前页面”继续使用。

### 禁止把 fallback 当成当前状态

“读取已经由 Workbench 明确打开并标识的当前投影”与“缺少 identity 时 fallback 到 `current-main-workbench`”是两件事：

- 前者允许，但必须带 identity 并通过等值校验；
- 后者继续禁止，因为它是在无法确定对象时猜一个对象。

### 准入与执行都要校验

产品正常路径保证 AI 模式只能从非临时 SQLite 打开，但服务端不能只相信入口。旧 session、恢复、直接 REST/Interop 调用、permission continuation 和切换页面并发仍可能绕开入口状态，因此执行点必须重新校验。

前端负责不让用户进入错误状态；服务端和 repository guard 负责即使进入错误状态也不会读写数据。

## 第一部分：统一的 Workbench current gate

建立一个 canonical resolver/gate，供 Workbench session bootstrap、context attach、turn、Workbench-scoped typed tool、question/permission continuation 和 recover 共用。它至少返回：

- OpenCode session id；
- binding timeline id；
- active Workbench timeline id；
- current projection timeline id；
- document lifecycle state；
- current checkout node id 与 revision；
- session-axis binding id。

成功条件：

1. session 存在且 `host=workbench`；
2. session binding 存在且不可变；
3. active/current projection 明确标注 timeline id；
4. 三个 timeline id 完全相等；
5. document 存在、未归档且非临时；
6. checkout 属于该 timeline。

任一失败都 fail-closed，不得 fallback、ensure、猜测、改绑或继续使用旧快照。

### 工具分类

- Workbench-scoped：当前排轴、当前队伍/单角色配装、当前 checkout、Work Node fork/read/diff/use、会改变当前工作树的工具。必须经过 current gate。
- Session-private：transcript、draft、question、permission 等会话私有状态。必须按 session 隔离，并在恢复执行 Workbench 操作前重新经过 current gate。
- Public/shared：静态游戏资料、公开 catalog、与当前排轴无关的知识读取。可以保持共享，不应被错误地强制绑定 SQLite。

`host=ai-cli` 或任何无 Workbench binding 的 session 不得调用 Workbench-scoped current 工具。它仍可调用明确属于 public/shared 的资源。

## 第二部分：投影与绑定的一致性

### Current projection 必须自证身份

`readDefCurrentTimelinePayloadSource()`、team snapshot、axis context 及等价 current reader 返回的数据必须携带来源 timeline id。只有来源 id 等于 gate 的 binding timeline id 时，数据才能成为 fork/read/plan 的输入。

禁止出现：

```text
target timeline = 从 binding 得到 A
payload source = 从无标识全局状态得到 B
```

### Axis context 调用统一

所有依赖 `readDefWorkbenchAxisContext()` 的调用方必须显式传递或从 canonical gate 获得同一 binding context。不能一部分工具收紧、另一部分仍按旧无参合同调用。

合法正式 SQLite 上，单角色配装和全队配装不能因为缺少内部参数而误报 checkout change；真正 checkout/revision 变化时仍按 CAS 规则拒绝。

### 页面切换

从 A 切换到 B 时：

- A 的 iframe/session UI 卸载；
- A 的 pending permission 不得在 B 上恢复；
- B 使用自己的 session，或创建绑定 B 的新 session；
- 后端即使收到 A 的迟到请求，也会因为 active/current/binding 不相等而拒绝。

## 第三部分：统一 Work Node 分支语义

### 重新配装必须新建分支

无论是单角色配装还是全队配装，只要产生新的配置结果，都必须：

1. 以当前 checkout P 为 parent；
2. 在同一 timeline 中创建新的横向分支节点 C；
3. 把新配置写入 C；
4. 保留 P 和其他既有分支不变；
5. 在 C 上完成 validate、diff 和 approval；
6. 仅在批准后把 checkout 移到经过审阅的 C。

不得直接覆盖 P，不得把 A 的配置写进 B 的节点，也不得先改 current payload 再补一个形式上的分支节点。

### 单角色与全队保持同一合同

- 单角色重新配装：C 包含该角色的候选配置，其余队伍状态继承 P；
- 全队重新配装：C 包含同一轮完整队伍候选，所有角色变化在同一个受审阅分支结果中保持一致；
- 两者都使用同样的 parent/revision 校验、diff、permission 与 checkout 后置条件；
- 若现有内部实现分多个步骤计算，全步骤仍必须固定在同一 timeline、同一 parent 和同一候选分支上，不能中途跳树。

### Permission 恢复必须绑定精确候选

prepare/permission/apply 至少共同绑定：

- session id；
- timeline id；
- parent node id + parent revision；
- candidate node id + candidate revision/hash；
- permission/question id；
- 预期 checkout 后置条件。

批准恢复时重新检查 current gate、parent/candidate revision 和 checkout。任何一项变化都拒绝旧批准，不把它套用到新页面、新 checkout 或新候选。

拒绝或 discard 必须零 checkout 变化、零 parent 改写；候选节点是否保留按既有可审计草稿语义处理，但不能成为当前生效节点。

## 第四部分：会话创建的一致性

正式 SQLite 准入应在创建 OpenCode session directory 前完成。若底层创建顺序受限，则任何后续 binding/context 失败都必须清理本次新建的 session 残留，不能出现“创建失败但留下可恢复 session”的半成功状态。

该要求不允许删除已有合法 session，只处理本次请求刚创建且尚未完成 binding 的孤儿对象。

## 错误合同

沿用 Spec 8-2 的稳定错误类别，并补充可诊断阶段；外部响应不泄漏另一 timeline 的 id、名称或内容。

| 场景 | 结果 |
| --- | --- |
| active/current projection 缺少 timeline identity | `BLOCKED_SESSION_MISMATCH` |
| active/current/binding timeline 不相等 | `BLOCKED_SESSION_MISMATCH` |
| 无 Workbench binding 调用 Workbench current tool | `BLOCKED_BINDING` |
| projection source 与 fork target 不相等 | `BLOCKED_SESSION_MISMATCH` |
| parent/candidate/checkout revision 已变化 | 现有 checkout/CAS stale 错误 |
| 临时 SQLite | `BLOCKED_TEMPORARY_WORKSPACE` |

## 验收标准

- [ ] 正式 A 已打开，session/binding/projection 均为 A 时，当前排轴读取、配装读取和 Work Node 流程正常。
- [ ] session 绑定 A、当前投影为 B 时，所有 Workbench-scoped 读取、fork、配装与 permission continuation 均拒绝，A/B 零变化。
- [ ] `readDefCurrentTimelinePayloadSource()` 的 B payload 不能被 fork 到 A 的节点。
- [ ] 无 Workbench binding 的 `/AI CLI` 不能读取当前队伍/配装/checkout，但共享游戏知识仍可用。
- [ ] 从 A 切到 B 后，A 的 iframe 和待审批操作不能在 B 继续执行。
- [ ] 临时 SQLite 不能进入 AI 模式，拒绝路径不创建、恢复或附加 session/context。
- [ ] 合法单角色重新配装从当前 checkout 新建横向分支；parent 不变，批准后 checkout 精确移动到已审阅分支。
- [ ] 合法全队重新配装遵守同一分支合同，不原地覆盖、不拆到另一棵树。
- [ ] 拒绝、discard、stale 或 mismatch 均不会改变当前 checkout 或 parent payload。
- [ ] 合法配装流程不会因缺少 axis context 参数误报 checkout change。
- [ ] session create/binding 失败不留下可恢复的半绑定 session。
- [ ] native contract、定向回归、Mac Desktop Interop/UI 黑盒和 Harness candidate regression 全部形成证据后，才允许人工 promotion。

## 明确不做

- 不要求每个工具单独打开或查询 SQLite；
- 不移除 Workbench 的 current timeline/global projection；
- 不重做 SQLite、TimelineDocument、存档或数据包架构；
- 不改变“AI 模式只从正式 SQLite 打开”的产品入口；
- 不把重新配装改回原地覆盖；
- 不扩展 DEF 的存档创建、导出、转正或改绑权限；
- 不修改用户手动配装页面；
- 不扩展 YZ/知识训练；
- 不自动 promotion Harness candidate。

## 完成定义

当系统能在每次 Workbench AI 行为前证明当前正式 SQLite、current projection 与 session binding 是同一个对象，并且单角色/全队重新配装都从当前 checkout 在同一棵树内创建明确的新分支，跨 timeline、无绑定、临时、stale 与迟到 permission 全部零变化拒绝，同时合法流程通过真实 UI 与 native evidence，本轮返修完成。
