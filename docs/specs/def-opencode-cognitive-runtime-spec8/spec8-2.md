# Spec 8-2：DEF OpenCode 数据架构与会话权限收口

## 状态

已完成首轮实现 `5c90caa`，但尚未通过独立审计与真实 Mac Desktop 黑盒，因此不得 promotion。审计后的确定性与工作树返修见 [Spec 8-2-1](./spec8-2-1.md)；8-2-1 完成前，本规格仍视为未验收。

关联任务：[Task 8-2：收紧 DEF OpenCode 的 SQLite 与会话边界](./task8-2.md)。

## 一句话定调

**DEF OpenCode 可以创建自己的对话会话，但不能创建、转正、导出或另存排轴数据；Workbench AI 模式只能进入一个已经存在、非临时、且在会话创建时完成不可漂移绑定的 SQLite 工作区。**

## 背景

近期数据架构已经把排轴数据拆成四种边界清晰的对象：

- SQLite 工作区：当前可编辑排轴、Work Node 树、checkout 与审计的本机事实源；
- 临时 SQLite：选人确认后承载尚未首次保存的工作副本；
- 本地/共享存档：从正式 SQLite 工作区显式导出的可搬运排轴对象；
- Local Data / Share Data：包含浏览器资料投影与可选共享存档的完整数据包。

数据口径已经明确：临时 SQLite 不是存档；存档必须由用户显式保存或导出；下载的数据包不能自动切换 SQLite；存档也不能直接覆盖当前页面。

DEF OpenCode 的现有会话与绑定链路仍保留旧口径。它在进入 AI 模式时没有完整携带当前 SQLite 身份，后端又允许用 fallback id 补建 TimelineDocument，导致 Agent 会话具备了间接“新建存档/工作区”的能力。该能力与当前数据架构冲突，必须在进入受控训练前收口。

## 现状审计

本轮审计覆盖从临时 SQLite 引入到数据包/存档边界文档完成之间的近期改动，重点包括 `018cdd7`、`f1a841a`、`616698b`、`3b2a282`、`f1d9499` 与 `fed4f92`。

### 已成立的新数据事实

1. 选人确认会创建 `isTemporary=true` 的 SQLite 工作区，用于保存尚未首次命名/保存的队伍工作副本。
2. 临时 SQLite 只有经过用户发起的保存型动作并完成命名后，才能转为正式工作区。
3. 本地/共享存档由正式 SQLite 工作区显式导出，不能由进入 AI 模式、创建对话或读取上下文隐式产生。
4. 数据包、独立存档与 SQLite 工作区是三个互不替代、删除互不连带的生命周期对象。

### DEF OpenCode 当前偏差

1. `DefOpenCodeView` 创建 Workbench native session 时只提交 `host`，没有把当前 `timelineId` 作为必需绑定输入。
2. Workbench native session 的服务端接口把 `timelineId` 视为可选值；缺失时会回退到 `current-main-workbench`。
3. `def.workbench.bind_session_axis` 在绑定前调用 `ensureDocument()`，因此一次 AI 会话绑定可以隐式创建 TimelineDocument。
4. Workbench 的持久 session key 只按 host 区分，没有以绑定的 SQLite 工作区区分；切换工作区后存在复用旧会话的可能。
5. React 上下文刷新与服务端 axis binding 没有共同校验同一个 `timelineId`，会话上下文存在被另一个工作区覆盖的风险。
6. AI 模式入口、native session create、recover、context attach 和 typed tool executor 均未把 `isTemporary=true` 作为硬拒绝条件。

### 风险结论

- 进入 AI 模式可能制造用户没有显式创建的 SQLite 文档，形成“幽灵存档/工作区”。
- 同一 Workbench OpenCode session 可能在不同 SQLite 之间漂移，旧 transcript、draft、permission 与新排轴混在一起。
- 临时 SQLite 可能提前获得 Work Node、Agent mutation 或导出能力，绕过“首次保存后才转正”的产品口径。
- 临时 SQLite 被替换或回收后，旧 native session 仍可能保留失效绑定并继续接受 turn。
- prompt 中声明“会话绑定一棵树”不能弥补服务端仍可补建、改绑或跨工作区读取的权限缺口。

## 目标

1. 移除 DEF OpenCode 新建 TimelineDocument、SQLite 工作区和排轴存档的能力。
2. 让 Workbench native session 在创建时强制绑定一个既有正式 SQLite 工作区。
3. 让该绑定在 session 的 create、bootstrap、context attach、turn、tool、permission continuation 与 recover 全链路保持不变。
4. 禁止 Workbench AI 模式进入或绑定临时 SQLite。
5. 禁止一个 SQLite 的 OpenCode session 被另一个 SQLite 复用或覆盖上下文。
6. 保留用户主动“新建 DEF 会话”的能力，但新会话仍只能绑定当前既有正式 SQLite，不能借此创建数据对象。
7. 以服务端和 repository guard 为权限事实源；前端禁用与 Harness 文本只提供可见反馈和行为教学。

## 核心模型

```text
正式 SQLite 工作区 T（既有、isTemporary=false）
  └─ Workbench native session binding B（不可漂移）
       └─ OpenCode session S
            ├─ transcript / question / permission
            ├─ session-isolated node workspace
            └─ typed tools -> 只能读取或修改 T 的 Work Node 树
```

必须满足：

```text
B.timelineId = T.id
B.opencodeSessionId = S.id
S.host = workbench
T.exists = true
T.isTemporary = false
```

任何一项不成立都必须 fail-closed，不能 fallback、补建、猜测或自动改绑。

## 权限口径

### OpenCode 可以做什么

- 为当前正式 SQLite 创建一个新的 DEF 对话 session；
- 恢复与同一 SQLite 绑定的既有 DEF 对话 session；
- 在绑定 SQLite 的 Work Node 树内读取当前 checkout、创建隔离 child draft、校验、diff，并按现有 permission/use 规则应用；
- 使用不改变数据生命周期的有界 `def_data_*` 资源；
- 在绑定失效时停止 turn，并向用户说明需要返回主界面重新建立合法会话。

### OpenCode 不可以做什么

- 创建 TimelineDocument 或 SQLite 工作区；
- 把临时 SQLite 转正、命名或保存；
- 导出本地/共享/参考存档；
- 转换、迁移、删除或搬运存档；
- 为缺失 `timelineId` 自动使用 `current-main-workbench` 或其他默认工作区；
- 把既有 session 改绑到另一个 SQLite；
- 枚举其他 SQLite 后自行选择“最新”“默认”或名称相似项；
- 通过 native file、REST fallback、typed tool 或 Harness 绕过上述边界。

## 第一部分：AI 模式准入

### 1.1 前端准入

Workbench AI 模式入口只有在以下条件全部满足时可用：

- timeline session 已完成初始化；
- 当前 `timelineId` 非空；
- 当前 SQLite document 存在；
- `isTemporary=false`。

临时 SQLite 上的 AI 模式入口必须禁用或在点击时明确拒绝，提示用户先通过现有保存流程完成首次命名/转正。拒绝不得触发 runtime ensure、native session create、session recovery、context attach 或任何 DEF tool。

前端拒绝只改善体验，不作为唯一安全门。

### 1.2 服务端准入

`host=workbench` 的 native session create 必须要求明确 `timelineId`。服务端在创建 OpenCode session directory 之前查询 repository：

- 不存在：拒绝；
- 已归档或不可读：拒绝；
- `isTemporary=true`：拒绝；
- 合法正式 SQLite：允许创建并写入 binding。

`host=ai-cli` 保持独立，不得因为本轮改动继承 Workbench timeline。

## 第二部分：不可漂移的会话绑定

### 2.1 创建时绑定

Workbench native session 的持久 binding 至少记录：

- schema version；
- OpenCode session id；
- host/profile/agent；
- timeline id；
- axis binding id；
- Harness binding；
- createdAt/updatedAt。

同一个 binding 文件中的 `timelineId` 一经写入不得由 context attach、普通 turn、tool call 或 recover 修改。需要切换 SQLite 时，退出当前 AI 模式并为目标 SQLite 创建或恢复它自己的 session。

### 2.2 前端 session 隔离

Workbench 的持久 session 索引必须包含 timeline identity。恢复候选至少同时匹配：

- `host=workbench`；
- candidate session id/directory 有效；
- candidate binding 的 timeline id 等于当前 timeline id；
- 当前 document 仍存在且非临时。

仅按 `host` 复用 session 不再允许。切换 SQLite 时不能把原 iframe、transcript、question、pending permission 或 node workspace 带到新工作区。

### 2.3 上下文一致性

React 上报的 `context.timeline.id` 必须与持久 binding、SQLite session-axis binding 三者一致。任一不一致时：

- 不写 `.def-workbench-context.json`；
- 不更新 checkout state；
- 不接受后续 Workbench turn；
- 返回稳定、可诊断的 mismatch error。

上下文刷新只能更新同一 SQLite 内的 checkout、selected node 与只读摘要，不能承担改绑职责。

### 2.4 恢复与失效

recover/bootstrap 必须重新验证 document 存在且非临时，并验证 session/directory/host/timeline 全部一致。

如果绑定 SQLite 已被删除、归档、替换或意外变成临时状态：

- session 标记为不可继续；
- pending tool/permission continuation 不得执行；
- 不自动改绑到当前或默认 SQLite；
- 用户可返回主界面，为合法工作区建立新 session。

## 第三部分：移除新建存档权限

### 3.1 绑定工具只绑定既有文档

`def.workbench.bind_session_axis` 及等价内部入口不得调用 `ensureDocument()`、import、clone、convert 或任何具有创建语义的 repository 方法。

绑定前必须读取既有 document 并验证：

- id 精确匹配；
- document 未归档；
- `isTemporary=false`；
- optional bound node 属于同一 timeline。

绑定失败不得留下空 document、半写 binding、session context 或 audit 假记录。

### 3.2 工具与 API 面收口

Workbench DEF tool registry 不新增下列能力，已有兼容 API 也不得通过 Agent 路由暴露：

- workspace/document create；
- timeline archive export/create；
- archive convert/import/transfer/delete；
- temporary workspace promote；
- arbitrary timeline list-and-bind。

这些操作继续属于用户可见的数据管理或保存流程。即使未来需要 Agent 协助，也必须另起规格定义用户意图、原生审批与产品后置条件，不能从本轮放宽。

### 3.3 Work Node 边界保持不变

“禁止新建存档”不等于禁止 `def_node_fork`。Work Node child draft 是绑定 SQLite 内的编辑分支，不是新的 SQLite、TimelineDocument 或独立排轴存档。

`fork / bind / validate / diff / use / restore` 继续遵守现有 revision、checkout、permission 与 postcondition 规则，并额外校验目标 node 属于当前 session binding 的 timeline。

## 第四部分：Harness 与运行时教学

本轮首先修复 runtime 权限，再调整 Harness。Harness 只能教学以下事实：

- 当前 session 只服务一个绑定 SQLite；
- 临时 SQLite 不开放 AI 模式；
- Agent 不能新建、转正或导出存档；
- 绑定缺失或失效时停止，不寻找替代工作区；
- Work Node child draft 不等于新建存档。

Harness 不得承担安全门，也不得用文字掩盖 runtime 仍可 fallback、ensure 或跨 timeline 调用的事实。

候选训练至少包含：

- 缺失 timeline id 的 session create 拒绝；
- 临时 SQLite 的 UI 与服务端双重拒绝；
- session A 不能读取/写入 timeline B；
- context timeline mismatch 拒绝；
- 合法正式 SQLite 内的只读与 Work Node draft 正常通过；
- 用户“新建 DEF 会话”只产生新的对话 session，不产生新数据对象。

## 错误合同

至少形成下列稳定错误类别，具体 code 可在任务实施时统一命名：

| 场景 | 状态 | 语义 |
| --- | --- | --- |
| Workbench create 缺少 timeline id | `BLOCKED_BINDING` | Workbench session 必须显式绑定既有 SQLite |
| timeline 不存在/归档 | `BLOCKED_BINDING` | 绑定目标不可用，不创建替代对象 |
| timeline 为临时 SQLite | `BLOCKED_TEMPORARY_WORKSPACE` | 临时工作副本不开放 AI 模式 |
| session/context timeline 不一致 | `BLOCKED_SESSION_MISMATCH` | 会话不得跨 SQLite 漂移 |
| 绑定已失效 | `BLOCKED_BINDING_STALE` | 原 session 不可继续，需从合法工作区重建 |
| Agent 请求存档/工作区创建 | `DENIED_CAPABILITY` | 数据生命周期操作不属于 DEF OpenCode 权限 |

错误响应不得泄漏其他 timeline 的名称、id、目录、transcript 或节点摘要。

## 验收标准

- [ ] 进入正式 SQLite 的 AI 模式时，native session 明确绑定当前 timeline id。
- [ ] 临时 SQLite 的 AI 模式在前端可见拒绝，且没有创建或恢复 OpenCode session。
- [ ] 直接调用 Workbench session create 绑定临时 SQLite 时，服务端拒绝且 SQLite 无变化。
- [ ] 缺失、错误、归档或不存在的 timeline id 不再 fallback 到 `current-main-workbench`。
- [ ] `def.workbench.bind_session_axis` 不再调用任何 document/workspace/archive 创建方法。
- [ ] 新建 DEF 对话 session 只创建 session 隔离目录与对话记录，不创建 TimelineDocument、SQLite 工作区或存档。
- [ ] 一个 timeline 的 session/context/tool/permission continuation 不能作用于另一个 timeline。
- [ ] 切换 SQLite 后不复用原 iframe、transcript、question、permission 或 node workspace。
- [ ] recover/bootstrap 会重新验证绑定，绑定对象删除或失效后 fail-closed。
- [ ] 合法正式 SQLite 内的只读、fork、validate、diff 与经批准 use 保持可用。
- [ ] `/AI CLI` 与 Workbench 的 session、timeline 和权限仍相互隔离。
- [ ] Harness candidate 通过 FAIL_TO_PASS、PASS_TO_PASS、safety 与真实 UI 验证后，才允许人工 promotion。

## 明确不做

- 不重做 SQLite、数据包或排轴存档 schema；
- 不修改临时 SQLite 的创建与用户保存流程；
- 不让 Agent 自动替用户命名或转正临时工作区；
- 不移除用户主动新建 DEF 对话 session 的能力；
- 不把 Work Node child draft 误当成独立存档；
- 不恢复旧自研聊天 UI；
- 不在本轮扩展 YZ/游戏知识、玩家表达或人格训练；
- 不以 prompt/Harness 代替服务端权限校验；
- 不自动 promotion candidate。

## 完成定义

当 Workbench AI 模式只能在既有正式 SQLite 中建立不可漂移的 session binding，临时 SQLite 与所有隐式存档/工作区创建路径均被前后端和 repository guard 拒绝，同时合法绑定内的 DEF Work Node 能力通过回归并形成可审阅 Harness evidence，本轮完成。
