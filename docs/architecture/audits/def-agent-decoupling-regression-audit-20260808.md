# DEF Agent 解耦迁移回归审计

日期：2026-08-08

性质：只读架构与行为审计，不包含返修代码

当前分支：`codex/v1.8-lts-desktop-shell@5a7122b4`

旧稳定参考：`codex/def-opencode-spec9-2-implementation@bcea5f12`

共同基线：`de8f78bbca4ea39cb0cbad7da7ff50718ff07ea6`

## 0. 结论

用户观察到的现象属实，而且范围不止“AI 修改后没有自动创建节点”。

这次解耦的**架构方向是对的**：浏览器 SQLite/OPFS 继续作为唯一业务事实源，Electron、DEF Host、Harness、产品网关和 OpenCode 引擎之间已经形成了比旧实现更清楚的边界；审批签名、命令恢复和会话持久化也有可靠的新基础。

但迁移执行上发生了一个根本性偏差：旧 DEF 运行时被整体移除后，只按“最小可运行纵切面”迁回了少数能力。阶段测试证明的是这个新缩小合同自身能够运行，并没有证明旧产品能力已经复原。结果是：

- 五类业务 Harness 从 50 个操作缩到 18 个；
- 旧实现的 48 个规范化原生 Tool 目标、42 个 OpenCode DEF Tool 出口，缩到当前 15 个引擎绑定；
- 多数 AI 写操作绕过了“创建 Work Node → 编辑 → 校验 → 语义 Diff → 审批 → 切换 → 可见结果核验”的旧闭环；
- 配装建议与应用、跨业务计划、问题续接、知识与 Skill、节点审查 UI 等成熟能力没有迁回；
- 新事件日志在每个流式 delta 上全量重读并同步刷盘，产生随会话增长而恶化的性能问题；
- 页面通过 1.2 秒轮询领取产品命令，AI 模式进出又使用整页导航和懒启动，使单次操作额外变慢。

因此，**当前 AI 模式不能收尾，也不能称为旧 AI 模式的完整复原**。它更准确的状态是：

> 新架构的安全底座已经建立，原生 OpenCode UI 已接回，但旧 DEF 产品能力只迁回了一个有限演示子集。

正确返修方向不是整体回滚，也不是把旧 Node SQLite、旧 REST 和旧 Sidecar 合回来；应保留新边界，在其上逐项恢复旧的产品语义和性能合同。

## 1. 审计范围与比较方式

### 1.1 为什么采用旧稳定参考

旧参考提交 `bcea5f12` 包含已经长期演进过的五业务 Harness、Work Node 生命周期、Typed Tools、审批、会话续接、知识与 Skill，以及嵌入主工作台的 OpenCode UI 行为。它是本次“复原”应达到的行为参考线。

旧参考提交不是当前分支的祖先。两条线的共同基线为 `de8f78bb...`，因此本报告做的是**行为基线比较**，不是假设二者可以直接 merge 的父子差异比较。

### 1.2 当前迁移轨迹

当前分支的关键迁移顺序如下：

1. `9374fbf3 refactor: remove Agent and MCP runtimes from LTS`
2. `8e5f407c feat: establish DEF agent core contracts`
3. `a6e8accf feat: establish DEF agent host and browser gateway`
4. `3483b525 feat: restore DEF harness read-only core`
5. `3a8ddd3a feat: integrate OpenCode engine adapter`
6. `6d47616f feat: add Slim Agent product UI`
7. 后续接回原生 OpenCode UI、交互与少量写操作

这条轨迹说明问题不是“解耦时误删了一两个函数”，而是先删除旧运行时，再用更小的目标重新实现。当前缺口具有系统性。

### 1.3 审计对象

本轮检查了：

- 五类业务 Harness 的操作、阶段、写范围和终态；
- OpenCode 可见 Tool 与规范化 DEF Tool 合同；
- Timeline、Buff、选人、配装和计算的读写链路；
- Work Node 创建、校验、Diff、审批、切换、恢复和可见结果核验；
- 问题、续接、跨业务计划、Harness 事务和修订治理；
- 原生 OpenCode UI 的 DEF 嵌入功能开关；
- DEF Session、Engine Session、事件、命令和审批恢复；
- AI 模式进入/退出、命令派发、快照发布、流式事件持久化和启动恢复；
- 当前自动测试实际覆盖的合同，以及旧黑盒测试入口是否仍可使用。

## 2. 总体对比

| 维度 | 旧稳定实现 | 当前实现 | 判断 |
| --- | --- | --- | --- |
| 业务数据边界 | 仍夹带旧 Node 业务桥与历史兼容层 | 浏览器 SQLite/OPFS 为唯一事实源 | 当前更好，必须保留 |
| 引擎边界 | DEF 与 OpenCode Session、Server、Tool 较强耦合 | `AgentEngine → Host → Harness → ProductGateway` | 当前方向正确 |
| OpenCode UI | 嵌入主工作台并带 DEF 扩展 | 已恢复同版本原生 UI | 基础已恢复 |
| Harness 操作 | 五业务共 50 个 | 五业务共 18 个 | 大量能力未迁回 |
| Tool 表面 | 48 个规范原生目标；42 个 OpenCode DEF 出口 | 15 个 OpenCode 绑定 | 能力明显缩水 |
| Timeline/Buff 写入 | 默认建立隔离 Work Node，校验后使用 | 多数直接修改当前页面状态 | 核心审计链回归 |
| 配装 | 读取、评估、推荐、预览、应用、恢复 | 仅 inspect + ask | 核心业务缺失 |
| 事务与续接 | 持久事务、问题后续接、跨业务计划 | 每 Turn 一个内存事务；ask 后结束 | 长任务能力缺失 |
| 知识与 Skill | 游戏知识、Build、3+1、武器适配、填表/修复 Skill | 运行时 Skill 被禁用，知识 Tool 未迁回 | 能力缺失 |
| 节点 UI | 节点审查、文件、审批、会话归档启用 | 四项均关闭 | 可见性回归 |
| 会话/命令恢复 | 成熟但耦合旧运行时 | Session/Event/Command 恢复基础更清楚 | 新基础较好，但 Harness 未恢复 |
| 性能 | 页面内切换、即时事件链为主 | 整页导航、懒启动、1.2 秒命令轮询、逐 delta 同步持久化 | 当前明显退化 |
| 测试含义 | 覆盖旧业务与生命周期 | 主要覆盖缩小后的新合同 | 通过不等于迁移完成 |

## 3. 第一类严重回归：AI 修改不再稳定地产生 Work Node

### 3.1 旧稳定合同

旧 Timeline v13 的 add/remove/move/replace/copy 等写操作，以及旧 Buff v1 的 add/remove/replace/batch/stack 等写操作，都遵循同一条闭环：

1. 绑定当前 checkout 与 scheme version；
2. 解析准确业务对象；
3. `def.node.crud.fork` 创建一个 Agent 命名的子 Work Node；
4. 读取并修改该 Work Node 的规范源；
5. `validate` 重建并校验业务不变量；
6. `diff` 检查语义写范围，防止误改其他业务字段；
7. 在审批和 CAS 保护下 `use`；
8. 再读取可见工作区，核对精确目标已经出现；
9. 失败时保留隔离草稿或停止，不污染正式 checkout。

这不仅是“留一条历史记录”。它同时承担：

- AI 改动隔离；
- 改动范围审计；
- 用户审批时的可读 Diff；
- revision 冲突保护；
- 失败回滚与恢复；
- Session 与当前轴的可追踪绑定；
- 后续 Agent 可以继续在同一变更上下文中工作。

### 3.2 当前真实行为

当前 `agent/core/tools/interactive-workbench.ts` 将下列操作直接规划为浏览器命令：

- 添加技能按钮：`addSkillButton`
- 单个删除技能按钮：`removeSkillButton`
- 添加 Buff：`addBuff`
- 删除 Buff：`removeBuff`
- 设置目标抗性：`setTargetResistance`

`src/components/CanvasBoard/index.tsx` 收到后直接调用现有页面 mutation。只有两个窄路径明确走 `applyApprovedWorkNodePatch`：

- 分组/批量删除技能按钮；
- Agent 明确选择通用 `def.worknode.patch_and_validate` 的复杂编辑。

因此会出现不一致：同样是 AI 修改，一个单删不建节点，一组删除却建节点；一次普通加 Buff 不建节点，一个通用 Patch 可能建节点。用户无法从操作类型预测是否有审计记录。

### 3.3 影响

这是发布阻断级的产品语义回归：

- AI 修改后可能看不到节点，用户失去复核和恢复入口；
- Harness 声称写了 `timeline.work-node`，实际直接命令未必产生节点；
- 审批只证明用户允许执行命令，不再证明用户审阅了隔离后的语义变更；
- 同一 Session 后续无法可靠引用“刚才 AI 建立的节点”；
- 失败后的页面状态和 Session 状态更难重建；
- 当前测试可能通过，因为它只断言命令成功，而没有要求完整节点生命周期。

### 3.4 必须恢复的统一规则

除纯读取和纯计算外，任何改变当前业务方案的 AI 操作都应遵循一个统一合同：

> 先在隔离 Work Node 中形成候选变更，再校验、生成语义 Diff、审批、切换并核对精确可见结果。

可以继续复用 Slim 页面已有的 mutation 函数，但这些函数应成为 Work Node 应用器的底层实现，不能成为 Agent 绕过节点的旁路。

## 4. 第二类严重回归：Harness 只迁回了小子集

### 4.1 操作数量和内容

| 业务 | 旧稳定操作 | 当前操作 |
| --- | --- | --- |
| 选人 | 8：add、analyze、apply、inspect、remove、reorder、replace、search | 3：inspect、apply、ask |
| 配装 | 12：apply、compare、evaluate、inspect、preview、recommend、recommend_discovered_set、recommend_equipment、recommend_named_set、recommend_weapon、resolve、restore | 2：inspect、ask |
| 排轴 | 11：add、apply、copy、current、inspect、move、preview、remove、replace、restore、validate | 6：current、edit、add、remove、resistance、ask |
| Buff | 11：add、apply、batch、coverage、inspect、remove、replace、resolve、restore、source、stack | 4：resolve、add、remove、ask |
| 计算 | 8：aggregate、attribute、calculate、compare、diagnose、explain、export、skill_fact | 3：calculate、recalculate、ask |
| 合计 | 50 | 18 |

当前 Harness 目录中仍使用 `v13-slim-readonly`、`v4-slim-readonly` 等来源标识，代码注释也明确称它为“First interactive Slim catalog”。这说明当前实现本来就是分阶段的首批纵切面，不应被解释为完整复原。

### 4.2 Tool 能力缩水

旧 `DEF_NATIVE_TARGETS` 有 48 个规范化原生目标，覆盖：

- Work Node create/list/read/update/delete/validate/diff/use/restore；
- Node Code read/edit/apply_patch/materialize/status/rebuild/discard；
- 当前 checkout、按钮、Buff 排名；
- 干员、技能、Buff、武器、装备和配装候选；
- Build Guide、Build Profile、战斗约定和游戏知识；
- 武器适配、套装 shortlist、3+1 facts/plan；
- 配装计划 prepare/revise/apply；
- 干员配置 preview/patch；
- 伤害、核验和审批。

旧 OpenCode 适配层实际导出了 42 个 DEF Tool。当前 `agent/engines/opencode/tool-bindings.ts` 只有 15 个绑定：

1. `def.harness.route`
2. 五个只读 Tool
3. `def.user.ask`
4. 选人 apply
5. 添加/删除技能按钮
6. 添加/删除 Buff
7. 设置抗性
8. 通用 Work Node patch
9. 计算并核验

这里不主张把所有旧别名原样搬回。旧 Tool 表面可以重新归并成更少、更清楚的规范 Tool；但每个旧产品行为必须明确映射为“恢复、由新 Tool 替代，或经过产品决定正式退役”，不能像现在一样静默消失。

## 5. 第三类严重回归：配装业务基本未迁移

当前 loadout Harness 的 `writeScope` 为空，只有：

- inspect：读取当前队伍武器、装备、套装与技能等级；
- ask：问一个澄清问题。

旧稳定实现还具备：

- 对当前配装做有证据的评估和比较；
- 按干员 Build Guide 或受控 fallback profile 给建议；
- 区分通用建议、指定套装、自动发现套装、武器建议和装备建议；
- 解析本地武器/装备目录并明确完整度；
- 3+1 facts 与合法拓扑规划；
- 预览待应用配置；
- 等待明确确认；
- 通过水平 Work Node 应用干员配置；
- 核对配置、节点 payload、commit payload 与 Timeline 保持不变；
- 恢复原配装。

这意味着当前 AI 可以“读到你穿了什么”，但不能完成旧 AI 最重要的一类工作：有依据地建议、预览、应用和恢复配装。它不是小 Bug，而是整个业务域仍停留在只读阶段。

## 6. 第四类回归：成熟 Harness 机制被压扁

旧 `agent/runtime/def-harness-manager/` 包含 bridge、commit coordinator、context、downstream、host kernel、plans、registry、revision controller、router、runtime、semantic write scope、trace 和 transactions 等模块。

当前核心主要集中在 `agent/core/harness/catalog.ts` 与 `manager.ts`。新 Manager 的原子 prepare/commit 边界是有价值的，但它还没有迁回以下产品机制。

### 6.1 Harness 事务不能跨重启恢复

当前事务保存在 `#transactions = new Map()` 中，并用 `harness:${defTurnId}` 建立。DEF Session、事件和产品命令会落盘，但 Harness 业务事务、计划和 trace 不会持久化。

结果是：进程重启可以恢复“有一个会话”和“某个命令是否执行过”，却不能恢复“用户正在进行哪一个多阶段业务任务、已经确认到哪一步、下一步该继续什么”。

### 6.2 问题回答不会续接原任务

当前 ask 是一个独立操作，收到回答后直接进入 done。它没有携带并恢复原始业务目标。

旧实现会在用户回答后重新进入原计划，匹配 confirm/reject/resume/correct，并继续先前未完成的业务步骤。当前行为容易变成：

1. Agent 问“你指甲还是乙？”
2. 用户回答“乙”；
3. Agent 只记录“用户选择了乙”；
4. 原本要做的选择、配装或修改没有继续。

### 6.3 跨业务计划消失

当前 route 一次只允许五业务中的一个业务和一个操作，明确拒绝跨业务路由。

旧 Business Plan 可以把“选人 → 配装 → 排轴 → Buff → 计算”拆成受控步骤，持久记录每一步、scheme version 和下游失效关系。当前长任务只能依赖模型在自然语言里自行记忆和重新发起多个 Turn，稳定性明显下降。

### 6.4 下游失效与重算不再由 Harness 统一治理

旧系统会知道一次上游修改使哪些下游结果失效，并要求重新验证。当前每个 Tool 只完成自己的窄命令，跨操作的一致性主要依赖页面副作用和模型自觉。

### 6.5 语义写范围验证变弱

旧 semantic write scope 根据真正的 before/after Diff 判断是否越界。当前 catalog 虽声明 `writes`，但普通直接命令没有统一经过隔离节点的语义 Diff，因此声明更像投影约束，不是最终状态的强验证。

### 6.6 修订治理和业务终态缩水

旧实现有 candidate/promote/rollback/revoke/hot reload 等 Harness 修订治理，以及 PARTIAL、AMBIGUOUS、NO_PLAN 等业务化终态。当前主要收敛为 completed/aborted 和普通错误码，诊断颗粒度下降。

## 7. 第五类回归：会话绑定和可见结果核验不完整

### 7.1 选人后的绑定更新不够原子

当前浏览器选人逻辑本身保留了有价值的 Slim 规则：

- 新旧阵容有交集时创建水平 Work Node；
- 完全不相交的四人队切换到新的临时浏览器 SQLite 工作区。

但 Host 在命令成功后没有立刻把 DEF Session 原子推进到新的 binding，测试中甚至需要下一 Turn 手工提供 `postMutationBinding`。临时工作区切换后，旧 Session 也没有完整、显式的 detached 生命周期。

旧实现会在 selection apply 后同时核对 branch parent、checkout、临时工作区和新的 axis binding。这个语义需要迁回新 Host，而不是只靠下一次快照碰巧纠正。

### 7.2 当前“可见结果成功”可能是假阳性

`BrowserAgentRuntime` 对多数 mutation 的等待条件主要是 snapshot digest 或 revision 发生变化。它没有统一解析 Tool 声明的 `visiblePostcondition` 并核对具体业务条件。

因此任何无关页面变化都可能让等待结束。例如 Agent 要添加按钮 A，但同时发生另一个快照变化，Host 可能把命令视为已经可见，而没有确认 A 的 ID、位置、干员线和节点归属。

Canvas 的通用 Work Node 路径保留了一些按钮 ID 核验和回滚，这是好基础；但应把每类命令的语义 postcondition 提升为统一协议，而不是依赖“快照变了”。

## 8. 第六类回归：知识、Skill 与直接对话能力消失

### 8.1 运行时 Skill 已不可调用

当前 `agent` 运行树中没有旧 DEF 产品运行时 Skill，OpenCode profile 还明确设置 `skill: 'deny'`。

旧实现中的下列能力因此不是“入口隐藏”，而是已不可调用：

- timeline-workbench；
- game-knowledge 及反应链、武器评价、干员配装参考；
- operator/weapon/equipment fill；
- check-error-repair；
- Build Guide/Profile；
- 3+1 与武器适配知识链。

这些内容是否全部继续保留，可以重新做产品判断；但当前没有替代层，不能算迁移完成。

### 8.2 普通对话路由发生退化

旧 router 会确定性识别问候、表扬、确认、追问上一次结果、能力询问和 Session ID 询问，不把它们硬塞进业务 Harness。

当前 Harness route schema 只有 selection/loadout/timeline/buff/calculation。Engine 若在 Harness 尚未完成时直接回答，Host 会以 `HARNESS_INCOMPLETE` 失败。因此普通“你好”或“刚才改了什么”缺少干净的终态路径，模型要么虚构一个业务 route，要么失败。

这类对话看似不重要，却直接影响 AI 模式是否像一个连续助手，而不是一组孤立命令按钮。

## 9. 第七类回归：OpenCode UI 接回了，但 DEF 扩展被关闭

当前 UI 已经重新使用 OpenCode 1.17.11 的原生消息、工具顺序和 Session 界面。这一点应保留，不需要再自研一套聊天渲染。

但当前嵌入 profile 明确关闭：

- `sessionArchive: false`
- `nodeReview: false`
- `nodeFiles: false`
- `nodeApproval: false`

旧稳定 profile 中这四项都是 true。当前 Native UI Gateway 的节点审查接口也没有提供旧实现的真实节点 Diff/报告。

所以 UI 表面看起来像旧 OpenCode，实质上缺少用户最需要的 DEF 信息：

- 这个 AI Session 绑定了哪个 Work Node；
- 节点里有哪些文件/结构变化；
- 语义 Diff 是什么；
- 为什么需要审批；
- 如何归档旧 Session。

这与第 3 节的 Work Node 旁路叠加后，会让用户感觉“以前稳定的 Harness 全没了”。

## 10. 新架构已经做对、不能回滚的部分

本次审计不是主张恢复旧运行时全家桶。以下成果是可靠资产：

1. 浏览器 SQLite/OPFS 继续作为唯一业务事实源；
2. 没有恢复旧 Node Timeline/Work Node 业务数据库；
3. 没有恢复旧 `17321/17322` REST Sidecar；
4. `AgentEngine`、DEF Host、Harness 和 ProductGateway 的责任边界方向正确；
5. Browser consumer、origin、binding、workspace lease 和 capability 校验较清楚；
6. 用户审批使用 proposal hash 与一次性签名 capability，拒绝后不会派发命令；
7. DEF Session、Event、Client Turn 和 Engine Session 映射会持久化；
8. 产品命令有持久 receipt、重启 reconciliation 和防重复执行；
9. 异常退出时会中断遗留 Turn；
10. 最终文本和历史消息已有 DSML/Tool-call 标记清洗；
11. 原生 OpenCode UI 已恢复，能继续作为统一消息与 Tool 顺序视图；
12. OpenCode 被放在可替换 EngineAdapter 后，为未来 Pi 保留了真实边界。

返修应建立在这些能力上，不能为了补功能把双数据库、旧 REST 或直接 OpenCode 业务访问带回来。

## 11. 性能审计

### 11.1 阻断问题：事件日志随会话长度产生平方级重复工作

当前 `FileDefAgentSessionStore.append()` 每追加一个事件都会：

1. 调用 `readJournal()` 从头扫描该 Session 的整个 `events.ndjson`；
2. 校验序号和尾部；
3. append 一行；
4. `fsyncSync()` 文件；
5. 再同步目录。

与此同时，`DefAgentHost.#pump()` 会把：

- `response.first-token`；
- 每一个 `response.delta`

都作为独立事件调用 append。

对当前本地真实开发数据的只读统计：

| 项目 | 数值 |
| --- | ---: |
| Session 日志数 | 3 |
| 总事件数 | 1971 |
| 其中 response.delta | 1562 |
| 最终日志总大小 | 497,537 bytes，约 486 KiB |
| 按现实现产生的累计历史重读 | 约 225.8 MiB |
| 同步文件刷盘次数 | 约 1971 次 |
| 目录同步次数 | 约 1971 次 |

只有不到 0.5 MiB 的最终数据，却重复读取了约 225.8 MiB，并在模型流式输出期间同步刷盘近两千次。会话越长，每个新 token 越慢，符合用户观察到的“现在性能完全很差”。

必须改成：

- append 保持摊销 O(1)，不在每个事件上全量扫描；
- delta 在内存或受控缓冲中合并；
- 在 Tool、Interaction、Turn terminal 等事务边界批量持久化和 fsync；
- 保留 sequence、尾部截断和崩溃恢复能力；
- 对长会话建立性能回归测试。

### 11.2 严重问题：产品命令只有 1.2 秒轮询主路径

`CanvasBoard` 每 1200ms 调用一次 `processMainWorkbenchCanvasCommand()`。虽然本页事件可以主动唤醒本页处理，但从 Host 到浏览器的远端命令没有完整的即时推送通路，正常 mutation 会平白增加 0–1.2 秒、平均约 0.6 秒的领取等待。

旧实现有即时事件/SSE 通知并保留轮询兜底。新实现也应恢复“推送为主、轮询为后备”，而不是只缩短 interval。

### 11.3 严重问题：进入和退出 AI 模式都整页重载

当前进入 AI 模式会：

1. 向 Shell 请求 launch grant；
2. 懒启动 Agent Host/OpenCode；
3. 修改 URL marker；
4. `window.location.assign()` 整页导航。

退出也会再次整页导航。旧主工作台 AI 模式是页面内状态切换，并在应用启动阶段预热必要运行时。

懒启动对“不使用 AI 的 Slim 用户”有好处，不应简单取消；但 AI 模式应避免重复销毁整个 Workbench。可以采用页面内模式切换、后台预热和可失效的新 grant，而不是以整页刷新作为安全边界。

### 11.4 每轮强制 route 增加模型往返

当前每个 Harness Turn 都从模型可见的 `def.harness.route` 开始。当前真实黑盒 9 个场景产生 28 次 provider 请求，平均约 3.1 次请求/场景。

旧实现也有 route 阶段，但对问候、续接、当前节点、技能事实和强确定性意图会使用确定性路由或已有事务，不必每次再花一次模型往返。当前应恢复这些无歧义快路径，同时保留 Harness 对 Tool projection 的最终控制权。

### 11.5 启动恢复会串行处理全部 Session

Host 初始化时遍历所有存储 Session，逐个调用 Engine recovery；归档 Session 也会进入该流程。OpenCode 冷启动和 Session idle 恢复可能超过 30 秒，而 Electron 对 Agent Host ready 的等待更短。

随着 Session 增长，这会造成：

- 启动时间线性增加；
- 归档历史拖慢当前会话；
- Shell 可能先报告启动失败，后台随后才准备好；
- Provider 更新时重启整个 Host，所有会话重新走恢复。

应优先恢复当前/最近活动 Session，其他 Session 按需恢复；Host ready 与 Engine ready 需要分层状态，超时口径必须一致。

### 11.6 快照和交互轮询仍有额外浪费

- 浏览器快照进入 promise chain 后没有按最新 digest/revision 合并，过时快照仍可能排队序列化和发送；
- 原生 Interaction UI 以 250ms 周期轮询；
- Provider 配置更新会重启整个 Host，使现有 UI capability 失效，页面内“重试”不一定能自动取得新的 grant。

这些不是当前最严重的瓶颈，但会放大长会话和频繁编辑的卡顿。

### 11.7 当前进程内存观察

一次开发态进程采样中，Vite、Electron 主进程/Helpers、Agent utility process 和 OpenCode 合计约 0.75–0.85 GiB RSS，其中 OpenCode 约 170–350 MiB，随运行阶段浮动。

这只能作为当前体量观察，不能直接证明相对旧版本发生了内存回归，因为开发构建、Helper 数量和会话状态不完全可比。当前有硬证据的性能问题是日志写放大、命令轮询、整页切换和串行恢复。

## 12. 当前测试为什么“都通过了”仍没发现这些问题

本轮重新执行的目标测试：

| 测试 | 结果 | 实际证明什么 |
| --- | --- | --- |
| `agent/core/harness/harness.contract.test.ts` | 通过，约 0.11s | 当前缩小 catalog 的状态机合同自洽 |
| `agent/host/interactive-host.contract.test.ts` | 通过，约 0.15s | ask、选人 apply、分组删除、拒绝、停止等少量 Host 交互 |
| `agent/engines/opencode/opencode.real-blackbox.test.ts` | 通过，约 11.48s | 真实 OpenCode loop 能完成 9 个脚本化场景，共 28 次 provider 请求 |

这些结果是真的，但覆盖面不足以证明旧能力已经复原。

### 12.1 只读“parity”文件自己声明不是完整迁移证据

Phase 3 的只读迁移只保留五个只读纵切面：

- selection inspect；
- loadout inspect；
- timeline current；
- buff resolve；
- calculation calculate。

其设计说明明确不把旧 mutation/recommendation 路径视为已验证迁移。后续交互测试只在这个小底座上添加了少量命令。

### 12.2 真实 OpenCode 黑盒使用脚本化 Provider

黑盒确实启动真实 OpenCode binary，但 Provider 是确定性的测试桩，预先给出 route、Tool 输入和最终回答。它能证明协议、投影和 Agent Loop 接线，不证明真实模型能稳定规划完整业务任务。

当前 9 个场景只包含一个选人 mutation，没有覆盖：

- add/move/copy/replace/restore Timeline；
- Buff batch/stack/coverage/source/restore；
- 配装 preview/apply/restore；
- Work Node list/diff/use/restore/delete；
- 知识、Build、武器适配和 3+1；
- 问题回答后继续原任务；
- 跨业务计划；
- Harness 重启恢复；
- 节点 UI 审查；
- 长会话性能。

### 12.3 测试按新合同写，导致“能力消失”不算失败

当前 catalog 只声明 18 个操作，测试自然只要求这些操作正确。旧 50 个操作没有形成迁移总表，因此删除一个旧能力不会让当前测试红。

这正是本次回归的核心：**测试很严格地证明了一个过小的目标，而不是证明产品等价。**

### 12.4 旧 Mac 黑盒与 Interop 测试入口丢失

项目 `AGENTS.md` 仍要求按 `docs/testing/def-agent-blackbox.md` 和 `DefCodexInteropProtocol v1` 联调，但当前分支中：

- `docs/testing/def-agent-blackbox.md` 不存在；
- `agent/runtime/def-codex-interop.cjs` 已删除。

文档在原仓库参考线仍可找到，但当前开发分支没有可执行的新等价入口。以后 Agent 很难用同一协议验证真实 UI、Turn、Tool、问题和失败。

### 12.5 存在失效代码和矛盾规格

- `src/platform/agent/agentEventPoller.ts` 目前只有自身测试引用，生产未使用；
- 早期 Phase 5 文档仍写“使用 Slim React UI，不恢复 OpenCode UI”；
- 已接受 ADR-0008 和当前代码则使用原生 OpenCode UI。

这些残留会误导下一轮维护者，也说明阶段文档没有随产品决策闭环。

## 13. 根因判断

本次问题不是 OpenCode 本身，也不是“解耦必然损失功能”。主要根因有五个：

1. **先整体删除、后按阶段重建，却没有一份旧能力迁移总账。** 旧能力不在新阶段目标中，就会悄悄消失。
2. **把 Slim 的目标从运行时和边界瘦身，扩大成了产品能力瘦身。** 用户要的是更易维护的实现，不是更少的 AI 功能。
3. **验收以架构阶段为单位，而不是以用户行为等价为单位。** 每阶段都能通过，但最终产品不等价。
4. **安全持久化做到了每事件最强同步，却没有把流式 token 与事务事件区分。** 可靠性设计反而产生严重写放大。
5. **原生 UI 接回后没有同步恢复 DEF 节点、审批和归档扩展。** 看起来接近旧 UI，实际上产品状态不可见。

## 14. 建议返修顺序

### 第一轮：先把性能和观察基础救回来

1. 重构 Event Journal：增量 append、delta 合并、边界 fsync、长会话基准；
2. Host → Browser 命令改为即时推送，1.2 秒轮询仅作兜底；
3. 快照按最新 binding/digest/revision 合并；
4. Host ready 与 Engine ready 分层，当前 Session 优先恢复，归档 Session 按需恢复；
5. Provider 更新只重启 Engine/profile epoch，或自动给 UI 续发新 grant，不重启整个产品 Host；
6. 恢复稳定、引擎无关的 `DefAgentProtocol/Interop` 观察入口，为后续每轮返修提供证据。

### 第二轮：恢复统一 Work Node 写入合同

1. Timeline、Buff、抗性、干员配置和配装的所有 AI mutation 统一建立隔离 Work Node；
2. 恢复 create/list/read/validate/diff/use/restore/delete；
3. 恢复 Node Code materialize/status/rebuild/discard；
4. 在审批前生成用户可读语义 Diff；
5. 每类命令实现精确 visible postcondition，不再用“任意快照变化”代替；
6. selection/workspace 切换后原子更新 Session binding 或明确 detached；
7. 重新打开 nodeReview、nodeFiles、nodeApproval，并让 Gateway 返回真实节点报告。

### 第三轮：逐业务恢复 Harness

按旧 50 操作建立迁移总表，每一项只能处于以下三种状态之一：

- 已按原行为恢复；
- 被新的规范 Tool/流程明确替代，并有等价测试；
- 经产品决定正式退役，并记录原因和用户替代路径。

优先级建议：

1. Timeline 完整编辑、预览、校验和恢复；
2. Buff batch/stack/coverage/source/replace/restore；
3. 配装 evaluate/recommend/preview/apply/restore；
4. 计算 compare/diagnose/explain/attribute/skill_fact/export；
5. 选人 analyze/search/reorder/replace 与完整绑定语义；
6. Build Guide/Profile、战斗约定、武器适配、装备与 3+1；
7. 问题后续接原任务、跨业务计划、下游失效与业务终态；
8. Harness transaction/plan/trace 持久化和修订治理。

### 第四轮：恢复完整产品生命周期和 UI

1. 页面内进入/退出 AI 模式，避免整页销毁；
2. 保留原生 OpenCode 消息/Tool 顺序 UI；
3. 恢复 Session 归档、节点审查、文件与审批入口；
4. 恢复问候、追问、结果解释和能力询问的直接对话路径；
5. 清理过时 Slim React UI 规格和未使用 EventPoller；
6. 用真实模型、真实浏览器 SQLite 和真实 UI 跑全生命周期黑盒。

## 15. 收尾标准

满足以下条件前，不应再宣布 AI 模式“完成”或“可以收尾”：

1. 每个 AI mutation 都能预测性地产生并绑定 Work Node；
2. 用户能在原生 OpenCode UI 中看到节点、语义 Diff、审批和结果；
3. 旧 50 个业务操作全部有明确迁移结论，没有静默缺失；
4. 配装建议、预览、应用和恢复完整跑通；
5. 问题回答会继续原任务，跨业务任务可恢复；
6. Session、Harness transaction、approval、command 和 binding 在刷新/重启后保持一致；
7. visible postcondition 对每类命令核对精确业务结果；
8. 长会话追加事件保持摊销 O(1)，不逐 delta 全量扫描和 fsync；
9. Host 到浏览器命令以即时推送为主，不再固定等待 1.2 秒轮询；
10. 真实模型黑盒覆盖旧能力矩阵，而不只覆盖预脚本化的五个只读纵切面；
11. Mac Interop/Computer Use 能从稳定协议读取 Turn、Tool、问题、审批和失败；
12. 继续满足 Slim 的硬边界：浏览器 SQLite 唯一事实源、不恢复旧 Node 业务库、不恢复旧 REST/Sidecar。

## 16. 最终判断

这次解耦不是应该废弃的工程，它已经完成了最难的一部分基础设施分层；但它被过早当成了产品复原完成。

最合理的做法是：

> 保留新 Agent Host、EngineAdapter、Browser ProductGateway、审批与恢复底座；以旧稳定分支作为行为参考，先修掉日志与命令链性能问题，再恢复 Work Node 不可绕过的写入合同，最后按旧 50 项业务能力逐项迁回和对测。

这样既不会把旧双数据库和旧服务端包袱带回来，也不会接受当前功能缩水的 AI 模式。完成后得到的才是目标产品：Slim LTS 前端与浏览器数据库不变，桌面端提供可替换 Agent 引擎，OpenCode 保留成熟 UI，DEF Harness 保留旧版本的可审计业务能力，并能在未来替换为 Pi。

## 17. 主要证据索引

当前实现：

- `agent/core/harness/catalog.ts`
- `agent/core/harness/manager.ts`
- `agent/core/tools/interactive-workbench.ts`
- `agent/engines/opencode/tool-bindings.ts`
- `agent/engines/opencode/runtime.ts`
- `agent/host/def-agent-host.ts`
- `agent/host/session-store.ts`
- `agent/host/opencode-native-ui-gateway.ts`
- `src/platform/agent/browserAgentRuntime.ts`
- `src/components/CanvasBoard/index.tsx`
- `docs/architecture/decisions/0008-native-opencode-ui.md`

旧稳定参考（通过 `git show bcea5f12:<path>` 读取）：

- `agent/harness/business/selection/revisions/v1/manifest.json`
- `agent/harness/business/loadout/revisions/v4/manifest.json`
- `agent/harness/business/timeline/revisions/v13/manifest.json`
- `agent/harness/business/buff/revisions/v1/manifest.json`
- `agent/harness/business/calculation/revisions/v1/manifest.json`
- `agent/runtime/def-harness-manager/`
- `agent/runtime/def-tools/registry.mjs`
- `agent/runtime/def-tools/opencode/def.js`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-codex-interop.cjs`
- `agent/runtime/def/skills/`
