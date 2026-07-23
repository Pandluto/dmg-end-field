# Spec 9-2 Research：五业务原子 Harness 架构推导

## 状态

研究完成，工程实施尚未开始。

本研究不是一篇架构论文，也不追求抽象形式本身。它为同目录 [`spec.md`](./spec.md) 提供可复核的推导依据：

> 从 DEF 当前产品状态、Typed Tools、OpenCode 运行链路和旧 Harness 实现出发，证明为什么目标边界必须是五个业务 Harness，为什么 Harness 必须与业务上下文绑定，以及管理、热重载和迁移机制最少需要哪些组成部分。

研究结论必须同时满足三条标准：

1. **可追溯**：每个目标组件都能追溯到当前代码中的事实或冲突；
2. **可反驳**：必须说明相邻切法为什么不能满足同一组不变量；
3. **可落实**：每个关系都能转化为运行时合同、状态或验收证据。

## 一、研究问题

本轮只研究一个总问题：

> 在 Typed Tools 平级注册、游戏知识贯穿业务、方案状态互相依赖的前提下，如何让选人、配装、排轴、BUFF、计算统计各自拥有唯一的业务决定权，同时能够在同一 DEF Session 中独立注册、迭代和热重载？

该问题包含三个不可分割的子问题：

| 子问题 | 必须回答的内容 | 若不回答的后果 |
| --- | --- | --- |
| 解耦 | 当前业务规则究竟分散在哪里，目标 owner 是谁 | 新 Harness 与旧 Prompt、Skill、router 继续冲突 |
| 管理 | Harness 如何注册、实例化、绑定上下文、投影 Tool、追踪和失效 | 五个文件仍只是另一种静态 Prompt 拼接 |
| 原子业务 | 什么才是一个业务 Harness，Operation、实体和知识处于什么位置 | 再次按名词、Tool 或文件机械拆分 |

因此，“只拆内容”“只做管理器”或“只建五个空 Harness”均不能单独构成本轮答案。

## 二、研究方法与判定标准

### 2.1 证据范围

| 层 | 主要证据 | 研究目的 |
| --- | --- | --- |
| 旧 Harness | `agent/harness/def-harness.cjs`、`agent/harness/baseline/stable-v0/**` | 验证八槽组合、整包绑定和当前热插拔含义 |
| Agent 入口 | `agent/runtime/def-opencode-adapter/index.cjs` | 查明固定 Workbench Prompt、Session 绑定和调用链 |
| 回合路由 | `agent/runtime/def-opencode-adapter/harness-turn-router.cjs` | 查明当前业务识别是否足以承担五业务路由 |
| runtime Skill | `agent/runtime/def/skills/timeline-workbench/SKILL.md` | 查明是否存在第二套跨业务 Harness |
| Tool 注册 | `agent/runtime/def-tools/registry.mjs`、`opencode/plugin.js` | 验证 Tool 平级注册和现有执行前 hook |
| Tool 合同与执行 | `agent/runtime/def-tools/opencode/def.js`、`scripts/ai-cli-rest-server.mjs` | 识别 capability、approval、事务和 postcondition |
| OpenCode 核心 | `agent/vendor/opencode/packages/opencode/src/session/**` | 验证逐回合 Tool 投影是否具备实现基础 |
| 方案状态 | `agent/runtime/def-node-workspace/codec.mjs`、`timeline-invariant.mjs` | 查明五业务状态是否能按文件或 Tool 分割 |
| 产品硬合同 | `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs` | 区分 Harness 判断与不可绕过的产品校验 |
| 历史架构口径 | `docs/architecture/harness-training.md` | 比较旧“新 Session 选整包”和本轮在线迭代要求 |

### 2.2 原子边界判据

候选 Harness 边界记为 `h`。只有同时满足以下条件，`h` 才是业务原子：

1. 用户能够表达一个独立业务目标；
2. 它拥有唯一的直接语义写域，或明确为只读派生域；
3. 它具有独立完成判据和失败状态；
4. 它可以包含多个 Operation，而不需要另一个 Harness 共同决定同一结果；
5. 它与其他业务的关系可以表达为输入依赖、状态失效或显式 handoff；
6. 修改其业务策略时，不要求同步重写其他 Harness 的同义规则；
7. 它可以绑定当前方案、目标实体和知识证据形成一项真实事务。

这一定义排除了“一个文件就是一个原子”“一个名词就是一个原子”和“一个 Tool 就是一个原子”。

### 2.3 需要维持的四种原子性

| 原子性 | 含义 |
| --- | --- |
| 决定原子性 | 同一业务决定只有一个 Harness owner |
| 写入原子性 | 一次提交的直接修改只能落入当前业务写域 |
| 事务原子性 | 预览、确认、应用和验证属于同一业务事务 |
| 迭代原子性 | 可单独发布或回退一个业务 Revision，不替换其他业务 |

四者缺一不可。只做到文件独立或版本号独立，不构成 Harness 原子化。

## 三、当前实现事实

### F1：Tool 的注册面是平级的

`agent/runtime/def-tools/registry.mjs` 的 `DEF_NATIVE_TARGETS` 以平级 canonical id 记录 native binding、family、scope 和 exposure。`agent/runtime/def-tools/opencode/plugin.js` 遍历该数组，把所有可实现的 `def_*` binding 放进同一个 OpenCode `tool` map。

因此，Tool Registry 的结构事实是：

```text
ToolRegistry = { toolId → typed definition }
```

不是：

```text
selection/
loadout/
timeline/
buff/
calculation/
```

这并不妨碍 Harness 建立从属关系。从属关系应是“业务阶段引用 Tool”的图，而不是把注册表改成目录树。

### F2：Tool 与业务天然是多对多

现有 Tool 已经出现两类关系：

1. **共享事务能力**
   - `fork / bind / validate / diff / use / restore` 服务多个 mutation 业务；
   - native read/edit/apply_patch 是 Work Node 媒介，不等于排轴业务本身。
2. **有向能力链**
   - guide/profile 产生 planner profile capability；
   - catalog materialize 产生 artifact id；
   - preview 产生 proposal token；
   - approval、plan hash、node revision 和 checkout 构成后续调用前提。

如果强行规定“一个 Tool 只属于一个 Harness”，要么复制 Tool，要么让某个 Harness垄断公共事务能力，两种结果都会制造新的耦合。

结论：业务拥有 Tool 的**使用权边界**，不拥有 Tool 本身。

### F3：游戏方案状态不能按文件或字段树机械分割

`decodeDefNodePayload()` 当前投影出：

```text
selection.selectedCharacters
timeline.staffLines[].buttons[]
buffs.allBuffList
inputs.characterInputMap
inputs.operatorConfigPageCache
```

但 `selectedBuff` 位于 timeline button 内；同一个 button 同时承载技能身份、位置和 BUFF 绑定。`skillButtonTable` 与 `timelineData.staffLines` 又必须保持身份和字段收敛。

这说明：

- 排轴和 BUFF 会触碰同一物理对象；
- 选人变化会使 staff line 和 button 引用失效；
- 配装位于 inputs/config cache，但会改变计算输入，可能使排轴或 BUFF 结论过期；
- 计算结果是完整方案的派生，不是独立可随意写入的源状态。

因此，文件级权限既过宽又不准确。正确边界必须建立在 **semantic diff** 上。

### F4：当前业务行为存在多个并行 owner

`buildAgentPrompt("workbench")` 已经同时定义：

- 选人；
- 配装；
- 排轴；
- BUFF；
- 部分计算和事实查询；
- guide-first、3+1、source-only 等业务流程；
- Tool 顺序、失败停止、审批和最终回复。

`timeline-workbench/SKILL.md`、旧八槽 Harness、每 Turn 宿主 Prompt、Tool description 和 plugin policy 又分别持有其中一部分。

所以当前调用链不是：

```text
一个业务 Harness → 一组 Tool
```

而是：

```text
固定 Prompt
+ 总 Skill
+ Host 回合命令
+ 八槽全文
+ Tool description
+ plugin policy
+ server handler
```

其中前五项都可能向模型解释“下一步该做什么”。这构成决定权重复。

### F5：旧八槽是存储分类，不是业务原子

`agent/harness/def-harness.cjs` 声明八个 `SLOT_NAMES`，校验 manifest、文件 hash 和 package 结构。`composeHarnessSystem()` 按固定顺序读取八槽并全文拼接。

它没有建模：

- business；
- operation；
- phase；
- semantic write scope；
- Tool ref；
- context binding；
- dependency；
- postcondition；
- owner conflict。

一个业务规则可以同时出现在 agent contract、routing、tool guidance、workflow 和 response policy，组合器仍会判定合法。

结论：八槽 package 能证明字节完整，不能证明架构职责独立。

### F6：旧热插拔的单位是整包和新 Session

`createSessionBinding()` 把整个 Harness ref 和全部 slot hash 绑定到 Session。`getNativeHarnessSystem()` 读取该 binding，并以 Session 和 selector 缓存已加载内容。

`docs/architecture/harness-training.md` 对此给出的定义也很明确：

> promotion 或 rollback 只改变之后新 Session 的 stable 解析结果；正在对话的 Agent 不在线换包。

这满足旧训练实验的可复现性，但不满足本轮目标：

- 同一 Session 内五个业务不能独立演进；
- 修改一个配装规则需要替换整包；
- 新业务规则要等到新 Session 才生效；
- Session 生命周期远长于一项业务事务。

### F7：当前回合 router 不能承担五业务解析

`harness-turn-router.cjs` 只处理少量正则场景：精确技能事实和 timeline 对 operator-config candidate 的覆盖。它没有输出 business、operation、targets、phase、未完成事务或跨业务 plan。

正则可以保留为确定性高置信 shortcut，但不能作为五业务总 resolver。

### F8：现有 OpenCode 具备逐回合 Tool 过滤基础，但尚缺 Phase bridge

OpenCode `PromptInput` 接受 `tools` 开关；Session Prompt 会把这些开关合入 permission。LLM request 的 `resolveTools()` 会同时根据：

- 本轮 user tool 开关；
- Agent permission；
- Session/请求 permission

过滤最终提交给模型的 Tool。`resolveTools()` 会在 LLM request 准备时运行。

同时，OpenCode plugin contract 提供 `tool.execute.before` 和 `tool.execute.after`；DEF plugin 当前只实现了 before。

这证明目标架构不需要把 OpenCode Tool Registry 改成业务树，但并不等于 Phase 投影已经完成。一次用户 Turn 内可能发生：

```text
evidence Tool result
  → Phase 从 evidence 进入 plan
  → 同一 Turn 的下一次模型请求
```

若只在用户 Prompt 进入时设置一次 Tool，后一 Phase 要么看不到需要的 Tool，要么必须一开始暴露整个 Operation 的 Tool 集。

因此本轮还必须增加一个窄的 Phase Projection Bridge：

1. 在回合开始时投影模型可见 Tool；
2. `tool.execute.after` 把 typed result 交给 Instance 状态机并推进 Phase；
3. 下一次 LLM request 准备时重新读取 Instance，投影 system context 和 Tool；
4. 在执行前再次校验 Instance、Operation 和 Phase；
5. 继续由服务端执行 host、checkout、approval 和 schema 硬门禁。

该 bridge 可以通过窄 plugin/core integration 实现，但不能靠 Prompt 自律，也不能把所有阶段 Tool 一次性暴露。

### F9：现有产品已经提供事务与验证积木

当前链路已有：

- Session 与 timeline/checkout binding；
- 页面投影与 checkout 收敛校验；
- Work Node fork/bind/patch/validate/diff/use/restore；
- proposal token、artifact id、planner capability、plan hash；
- native approval；
- CAS、revision 和重复调用控制；
- semantic diff 的部分结构；
- 可见页面 postcondition；
- 伤害计算和产品命令 schema。

这些能力不是旧 Harness 的附属品，而是目标 Manager 可以复用的执行基础。

### F10：游戏知识已经是流程输入，但当前绑定粒度不稳定

当前 guide、profile、catalog artifact、game knowledge section 和 planner capability 已经体现“证据 → 计划 → 应用”的消费链。

问题不在于没有知识，而在于：

- 业务查询策略写在巨型 Prompt 中；
- 某些知识路线被提升为全局规则；
- 预览后用户确认时，使用过的证据没有统一绑定到业务 Instance；
- 角色、术语和攻略片段容易被误当成 Harness 分类。

知识必须贯穿业务，但不能取代业务边界。

## 四、被排除的错误切法

| 切法 | 表面合理性 | 不能成立的原因 | 正确位置 |
| --- | --- | --- | --- |
| 一个角色一个 Harness | 角色拥有大量专属知识 | 角色同时参与选人、配装、排轴、BUFF、计算；会复制五类流程 | Instance target + knowledge key |
| `3+1` 一个 Harness | 是稳定游戏术语 | 它只是配装 Operation 的约束，不拥有独立状态和完成判据 | loadout 参数/知识 |
| 潮涌套一个 Harness | 是具体装备集合 | 实体数量会无限扩张，且仍只服务配装判断 | catalog entity |
| 新增、删除、换人各一个 Harness | 用户动作不同 | 三者共享队伍状态、规则和 postcondition | selection Operations |
| 一个 Tool 一个 Harness | Tool 可执行且 typed | 公共 Tool 被多个业务复用；业务常需多个 Tool 才完成 | Operation/Phase Tool graph |
| 一个文件一个 Harness | 容易做目录权限 | BUFF 与 timeline 同处 button，状态跨文件镜像 | semantic write scope |
| 八个 slot 各一个原子 | 已有 manifest | slot 没有唯一决定权，相同流程横跨多个 slot | 迁移后退出主链路 |
| 一个全局知识 Harness | 知识贯穿全部流程 | 知识没有独立用户业务结果，会重新形成万能上下文 | Knowledge Binder |
| 一个 Session 一个 Harness 包 | 容易复现 | Session 包含多项事务，无法单业务热更新 | Instance 绑定 Revision |
| 一个 Turn 一个 Harness 版本 | 更新最快 | 预览与确认可能跨 Turn，规则会中途改变 | 业务事务绑定 Revision |
| 一个万能 Workbench Harness | 能处理跨业务请求 | 决定权重新集中，无法独立迭代和验收 | ordered Business Plan |

排除这些切法后，剩余边界必须同时满足“端到端业务结果”和“唯一语义写域”。

## 五、五业务边界的推导

### 5.1 为什么从业务流程切

本项目不是通用 Agent。它的工具面服务于一个固定游戏方案生命周期：

```text
选人 → 配装 → 排轴 → 上 BUFF → 计算与统计
```

这五项分别改变不同的玩家可见业务结论，并且每一步都能建立独立 postcondition。它们是产品业务，不是 Agent 技术层。

### 5.2 五业务最低边界

| Business | 拥有的直接决定 | 典型 Operation | 完成判据 | 对下游的影响 |
| --- | --- | --- | --- | --- |
| selection | 队伍成员及顺序 | inspect、add、remove、replace、reorder、analyze、apply | 新队伍可见且 selection postcondition 通过 | 配装/排轴/BUFF 可能失效，计算重算 |
| loadout | 角色武器、装备、技能等级和配置输入 | inspect、resolve、recommend、compare、preview、apply、restore | 目标配置可见且 loadout postcondition 通过 | 排轴/BUFF 结论可能过期，计算重算 |
| timeline | 技能动作身份、顺序、位置和排轴结构 | inspect、add、remove、move、replace、copy、preview、apply、restore | 排轴结构合法且页面可见 | BUFF 绑定可能失效，计算重算 |
| buff | 按钮 BUFF 绑定、层数、异常和覆盖状态 | inspect、source、add、remove、replace、batch、stack、coverage、apply、restore | BUFF 语义和覆盖结果可见 | 计算重算 |
| calculation | 完整方案的派生计算与统计 | calculate、aggregate、compare、attribute、diagnose、export、explain | 输出标明输入 scheme revision 和统计口径 | 不直接写回四类源状态 |

这里的 Operation 集可以扩展，但业务集合不能因出现新角色、新套装、新 Tool 或新术语而扩张。

### 5.3 “别礼 3+1 潮涌套”的归属证明

用户请求：

```text
给别礼配置 3+1 潮涌套
```

结构化后是：

```text
business = loadout
operation = preview/apply（由用户措辞和当前事务决定）
target = 别礼
constraint = 3+1
requestedSet = 潮涌套
context = 当前队伍、当前配置、catalog、适用攻略知识
```

“别礼”是 target，“3+1”是配装术语，“潮涌套”是 catalog entity。三者都不产生新的业务状态 owner。因此只创建一个 loadout Instance。

若请求改为：

```text
把队伍里的某人换成别礼，再给别礼配 3+1 潮涌套
```

则 Resolver 生成：

```text
selection.replace
  → 读取新的 scheme revision
  → loadout.preview/apply
```

这是两个业务事务组成的有序 plan，不是一个万能 Harness。

## 六、上下文强绑定的最小模型

### 6.1 为什么 Harness 不能脱离上下文

同一句“换上这套”只有结合以下信息才有确定含义：

- 正在继续哪个 proposal；
- proposal 针对哪个角色；
- 当前 timeline/checkout 是否仍是原方案；
- 配置或 catalog revision 是否变化；
- 用户是否已明确确认；
- 预览使用了哪些知识证据。

因此 Harness 不是一段独立 Prompt。真正执行单位是：

```text
Harness Instance
  = Harness Revision
  + Business Transaction
  + Scheme Context
  + Conversation Focus
  + Knowledge Evidence
  + Current Phase
```

### 6.2 为什么绑定单位是业务事务

| 绑定单位 | 问题 |
| --- | --- |
| Session | 太大；同一 Session 会连续处理多项业务，新 Revision 无法及时生效 |
| Turn | 太小；preview → confirmation → apply 会跨 Turn，中途换规则会破坏一致性 |
| Tool call | 更小；无法表达业务完成、用户确认和多 Tool 状态机 |
| Business transaction | 同时覆盖跨 Turn 连续性和下一项业务使用新版的需求 |

所以 Revision 必须在 Instance 创建时绑定，并保持到该事务结束；Session 本身不再绑定整个五业务包。

### 6.3 上下文身份

Instance 至少需要记录：

```text
sessionId
transactionId
businessId
operationId
harnessRevision
timelineId
checkoutId
baseSchemeRevision
currentSchemeRevision
targets
conversationFocus
knowledgeEvidenceRefs
candidateArtifact
phase
status
```

这里既要保存稳定身份，也要保存 revision lineage。事务提交后可以得到新 scheme revision，但不能因此丢失它基于哪个 revision 规划。

这些字段必须进入机器可读 Instance Store，而不是只写入 transcript。若进程恢复时不能还原 proposal、capability、scheme lineage 或 evidence，正确状态是 `stale/aborted`，不是让模型根据旧对话续猜。

### 6.4 事务状态

```text
active
awaiting-confirmation
completed
aborted
superseded
stale
revoked
```

- 用户修正目标：旧事务 `superseded`；
- 方案被外部修改：依据依赖和 revision 检查进入 `stale`；
- 用户拒绝：`aborted`；
- Revision 被紧急撤销：`revoked`；
- typed postcondition 通过：`completed`。

不得仅靠对话文本猜测这些状态。

## 七、目标关系模型

### 7.1 对象

设：

```text
B = {selection, loadout, timeline, buff, calculation}
O_b = 业务 b 的 Operation 集
P_(b,o) = Operation 的 Phase 集
T = 平级 Typed Tool 集
K = 带来源的游戏知识集合
X = 当前方案语义状态
```

Harness 分为三个不同生命周期对象：

| 对象 | 决定内容 | 变化频率 |
| --- | --- | --- |
| Harness Type | 业务 id、Operation 上限、Tool ceiling、直接写域、依赖、兼容合同 | 低；通常需代码迁移 |
| Harness Revision | resolver hints、Phase 图、知识选择、Tool refs、业务策略和表达 | 高；允许热重载 |
| Harness Instance | 本次事务的 context、target、evidence、phase、candidate 和状态 | 每项业务事务 |

三者不能合并。否则要么 Revision 可以越过硬边界，要么每次业务都复制完整类型合同。

### 7.2 Intent Resolver

Resolver 是纯分类与规划边界：

```text
R(userText, conversationFocus, activeInstances, schemeContext)
  → new | continue | pipeline | clarify
```

其输出必须结构化：

```text
steps[] = {
  businessId,
  operationId,
  targets,
  requestedEffect
}
transactionId?
confidence
ambiguities
```

Resolver 不调用业务 Tool，不修改状态，也不承载五业务详细工作流。正则只能作为确定性 shortcut；其输出仍必须通过 Type Registry 校验。

Revision 的 resolver hint 只能帮助识别本 Type 已声明的 Operation，不能扩张业务边界。若用户明确请求多个效果，输出 pipeline；若一个效果出现多个可能 owner，输出 clarify。禁止用 Revision 激活顺序、文本顺序或正则先后形成隐式优先级。

### 7.3 Harness 与 Tool 的从属关系

定义：

```text
Use ⊆ (Business × Operation × Phase) × Tool
```

则某一 Instance 当前 Phase 的候选 Tool 为：

```text
ProjectedTools(i, p)
  = { t | ((i.business, i.operation, p), t) ∈ Use }
```

最终可用集合为：

```text
ActiveTools(i, p)
  = ProjectedTools(i, p)
  ∩ TypeToolCeiling(i.business)
  ∩ RegistryExposure(i.host, i.workspace)
  ∩ Permission(i.session, i.turn)
```

这同时表达了：

- Tool 仍平级注册；
- 一个 Tool 可被多个业务引用；
- 同一业务不同 Phase 看到不同 Tool；
- Harness 不能扩大 registry、host 或 permission 边界。

共享 Tool 必须在所有需要它的 Operation/Phase 上分别建立显式边；不设一个隐式全局业务 Tool 集，否则它会成为新的归属旁路。

### 7.4 Operation 是有限状态图

每个 Operation 必须编译成：

```text
Phase
  → allowedTools
  → requiredCapabilities
  → acceptedTypedResults
  → transition
```

例如配装应用不是一句自然语言顺序，而是：

```text
evidence
  → plan
  → preview(proposalToken)
  → awaiting-confirmation
  → apply(exact proposalToken)
  → verify(postcondition)
```

proposal token、artifact id、plan hash 和 approval capability 是图上的 typed edge。Harness 只能传递和消费，不能伪造。

### 7.5 四层执行约束

| 层 | 责任 | 被绕过时的结果 |
| --- | --- | --- |
| 模型可见性 | 只向模型提交当前 Phase Tool | 减少误选和上下文污染 |
| 执行前 gate | 校验 Instance、Operation、Phase、Tool ref | 即使模型构造调用也拒绝越界 |
| 服务端合同 | host、workspace、checkout、permission、approval、capability、CAS、schema | 保持不可绕过的产品安全 |
| semantic diff/postcondition | 验证直接写域、级联类型和可见结果 | 防止“调用成功”被误报为业务完成 |

模型可见性是精度机制，不是安全机制；安全仍由后三层闭合。

## 八、语义状态、写域与级联

### 8.1 状态模型

源状态记为：

```text
X = (Selection, Loadout, Timeline, Buff)
```

计算统计是派生：

```text
Calculation = F(X, CatalogFacts, FormulaVersion)
```

五个业务拥有的是语义决定，不是底层 Tool 或物理文件。

### 8.2 实际差异分类

一次 mutation 产生的全部差异必须满足：

```text
ActualDiff
  = DirectBusinessDiff
  ⊎ DeterministicReconciliation
  ⊎ DerivedRecalculation
```

`⊎` 表示三类互斥；每个 change 只能有一个 owner。

| 差异 | owner | 例子 |
| --- | --- | --- |
| DirectBusinessDiff | 当前 Harness Type | selection 直接替换队员；timeline 直接移动按钮 |
| DeterministicReconciliation | 产品代码 | 删除离队角色的非法按钮引用；同步镜像字段 |
| DerivedRecalculation | 公式/统计引擎 | 配装或 BUFF 变化后重算伤害 |

任何不能归类的变化都必须拒绝。这样既不让 selection Harness 获得 timeline 写权，也允许产品为保持合法状态执行确定性清理。

### 8.3 依赖图

```text
selection → loadout
selection → timeline
selection → buff
selection → calculation
loadout   → timeline
loadout   → buff
loadout   → calculation
timeline  → buff
timeline  → calculation
buff      → calculation
```

一条边不应永久固定成单一结果；它应有一个根据具体 semantic diff 判定的 effect classifier：

```text
effect(edge, diff, downstreamState)
  → none | hard-invalid | stale | recompute
```

典型结果如下：

| 上游差异 | 下游 | 典型 effect |
| --- | --- | --- |
| 删除/替换角色 | 该角色的按钮或 BUFF 绑定 | `hard-invalid` + 确定性清理 |
| 保留角色但改变队伍结构 | 旧配装推荐、排轴分析 | `stale` |
| 武器/技能等级变化 | 依赖旧配置的排轴或 BUFF 判断 | `stale`，必要时 `hard-invalid` |
| 删除 timeline button | 绑定在该 button 的 BUFF | `hard-invalid` |
| 任一源状态有效变化 | 计算统计 | `recompute` |

不得用 Prompt 中一句“注意重新检查”代替状态失效。

### 8.4 并存不等于并发覆盖

同一 Session 可以有多个只读、分析或待确认 Instance，但同一个 timeline/checkout 的 mutation commit 必须按 scheme revision 串行化：

```text
expectedRevision(instance) = currentRevision(checkout)
```

是提交的必要条件。一次 commit 得到新 revision 后，其他未完成 Instance 由 Dependency Manager 根据实际 semantic diff 重新分类。即使分类为 `none`，旧 token/candidate 也只能在 typed revalidation 通过后绑定新 revision。

这条规则把“业务 Harness 相互独立”和“共享一个产品方案”统一起来：允许决策并存，但不允许 last-write-wins、静默 rebase 或跨 revision 偷用确认。

## 九、游戏知识的架构位置

### 9.1 知识不是第六业务

知识没有独立的方案写域，也没有与玩家业务目标对应的完成态。它是五业务的证据输入：

| Business | 典型知识问题 |
| --- | --- |
| selection | 定位、队伍机制、替代关系、适用场景 |
| loadout | 武器装备适配、套装术语、属性阈值、条件收益 |
| timeline | 资源循环、触发条件、技能衔接、冷热启动 |
| buff | 来源、覆盖、层数、冲突、乘区 |
| calculation | 公式解释、统计口径、归因和比较条件 |

### 9.2 Knowledge Binder

知识读取键至少包含：

```text
businessId
operationId
targets
schemeRevision
userConstraints
```

返回 evidence ref，而不是把整篇攻略并入永久 Prompt：

```text
sourceId
sectionId
contentHash/revision
claimScope
applicableConditions
retrievedAt
```

Mutation 事务必须保存实际使用的 evidence refs。用户确认旧 proposal 时，不得静默换用另一篇攻略或另一组条件。

### 9.3 不同事实域不能互相覆盖

| 问题 | 权威来源 |
| --- | --- |
| 当前队伍、配置、按钮、BUFF | 当前 checkout/projection 或 typed Tool |
| catalog id、数值、槽位、效果 | typed product catalog |
| 攻略判断、适用条件、策略解释 | 带来源的 knowledge evidence |
| 伤害结果 | 指定 formula version 对当前 scheme revision 的计算 |
| 用户偏好与确认 | 当前业务 Instance 的 conversation focus |

“知识贯穿全链路”不等于“攻略可以覆盖当前产品事实”。

## 十、Harness Manager 的必要组成

每个组件都由一个已观察问题推导，不是为了完整感而堆叠：

| 当前问题 | 必要组件 | 最小职责 |
| --- | --- | --- |
| Revision 不能越过业务硬边界 | Type Registry | 校验 Operation、Tool ceiling、写域、依赖和兼容性 |
| 旧整包不能单业务更新 | Revision Registry | 按 business 保存 candidate/active/previous |
| 正则 router 不足 | Intent Resolver | 输出结构化单业务或跨业务 plan |
| preview/confirm 跨 Turn | Instance Store | 保存事务、Phase、candidate、evidence 和状态 |
| Tool 平级但业务有从属关系 | Tool Graph/Projector | 计算当前 Phase 可见 Tool |
| Harness 必须绑定真实方案 | Context Binder | 绑定 timeline、checkout、scheme revision 和页面投影 |
| 游戏知识贯穿但不能全局注入 | Knowledge Binder | 获取并固定最小证据切片 |
| 上游修改影响下游 | Dependency Manager | 产生 invalid/stale/recompute |
| 同 Session 需要下一事务用新版 | Hot Reload Controller | 校验并原子替换单业务 active Revision |
| 当前故障难定位 | Trace/Audit | 记录 route、Revision、context、Tool、transition 和结果 |

删除其中任一组件都会恢复一个已确认的问题。

## 十一、热重载推导

### 11.1 三种生命周期

| 生命周期 | 对象 | 更新规则 |
| --- | --- | --- |
| 类型期 | Harness Type | 改硬边界需代码和迁移，不是热重载 |
| 发布期 | Harness Revision | 校验后可按单业务 activate/rollback/revoke |
| 事务期 | Harness Instance | 创建时绑定 Revision，直到完成或终止 |

### 11.2 为什么不能原地修改活跃事务

若用户先获得配装预览 `P`，随后 Revision 从 `r1` 更新到 `r2`，确认时有两种错误：

- 用 `r2` 解释 `r1` 生成的 proposal：规则和证据可能不一致；
- 重新生成 proposal 但仍把用户原确认视为有效：用户确认的对象已改变。

所以：

```text
Instance(P).revision = r1
```

必须保持到 `P` 完成、放弃、过期或撤销。

### 11.3 为什么同一 Session 的新事务必须用新版

Session 只是容纳多项业务的会话。若 `r2` 已激活，用户在同一 Session 发起一项新的配装事务，继续使用 `r1` 没有业务一致性理由。

因此：

```text
new Instance(loadout).revision = activeRevision(loadout)
```

无需重建 Session，也不影响 selection/timeline/buff/calculation 的 active Revision。

### 11.4 发布算法

```text
source changed
  → parse
  → Type boundary validation
  → Tool reference validation
  → workflow graph validation
  → knowledge selector validation
  → write-scope validation
  → compatibility validation
  → compile generation
  → atomic swap activeRevision[businessId]
```

校验失败保留最后一个可用 Revision。严重缺陷通过 `revoke` 使相关未完成 Instance 进入 `revoked`，不能让它继续 apply。

这比“Session 整包不可变”更小，也比“每 Turn 自动换文本”更安全。

## 十二、解耦迁移的逻辑

### 12.1 行为来源分类

迁移前必须把每条现存规则归入且只归入一个类别：

| 类别 | 应保留的内容 |
| --- | --- |
| Host Kernel | Session/checkout 事实、不可绕过的系统边界 |
| Harness Type | 业务硬边界、Operation 上限、Tool ceiling、写域、依赖 |
| Harness Revision | 业务判断、Phase 图、Tool refs、追问、纠错、表达 |
| Knowledge | 有来源、有范围的游戏知识 |
| Tool contract | 本 Tool 输入、输出、副作用和 typed error |
| Tool/Host enforcement | permission、approval、capability、CAS、schema、postcondition |
| Judge | 测试场景、评分和预期结果 |
| 删除 | 重复、冲突、占位或已失效规则 |

同一规则不能为了“加强效果”在多处重复。

### 12.2 必须退出主链路的内容

- 固定 Workbench Prompt 中的五业务详细流程；
- `timeline-workbench` Skill 中的全局路由和重复工作流；
- Host 每 Turn Prompt 中的业务教学；
- 八槽全文拼接和 Session 整包 binding；
- 少量正则组成的总 router；
- Tool description 中的跨 Tool 工作流和最终回复规范；
- stable Harness 中围绕局部术语形成的全局规则。

### 12.3 必须保留的内容

- timeline/session/checkout 真实绑定；
- 当前页面投影收敛；
- canonical Tool schema 和 exposure；
- permission、native approval、capability、CAS；
- Work Node validation/diff/use/restore；
- 产品命令和公式；
- semantic postcondition；
- Judge 与运行中 Harness 的隔离。

### 12.4 为什么三项必须同轮切换

存在一个迁移闭环：

```text
旧规则退出
  → 需要新 Harness 承担业务决定
  → 新 Harness 需要 Manager 才能绑定上下文和 Tool
  → Manager 需要真实五业务 Revision 才能验证主链路
  → 主链路成立后旧规则才能安全退出
```

工程上可以按依赖分 task 和 commit，但发布态只能有一次完整切换。长期双轨会使唯一 owner 不变量失效。

## 十三、可行性与缺口

### 13.1 可直接复用

| 目标能力 | 当前基础 |
| --- | --- |
| 平级 Tool 注册 | `DEF_NATIVE_TARGETS` + OpenCode plugin |
| 回合开始时的模型侧 Tool 过滤 | `PromptInput.tools`/permission + `resolveTools()` |
| Tool 前后 hook | OpenCode `tool.execute.before/after`；DEF 当前已使用 before |
| Host/workspace admission | registry exposure + REST invocation policy |
| 事务 token/capability | proposal、artifact、planner、approval 现有链路 |
| 方案上下文 | Session-axis、timeline、checkout、scheme revision |
| 工作副本与提交 | Work Node fork/bind/validate/diff/use/restore |
| semantic evidence | 当前 diff、timeline invariant、页面 postcondition |
| 计算 | 现有公式和 damage report |

### 13.2 必须新增或重构

- 五个 Harness Type schema；
- 单业务 Revision schema、编译与 registry；
- 结构化 Intent Resolver；
- 跨 Turn Instance Store；
- Operation/Phase Tool graph；
- Phase Projection Bridge；
- Context/Knowledge Binder；
- semantic write-scope classifier；
- 五业务 dependency effects；
- 单业务 hot reload/rollback/revoke；
- 统一 trace；
- 旧 Prompt、Skill、八槽和 Tool description 的责任迁移；
- 五个非空、可执行的初始 Revision。

这说明目标具有工程可完成性，但不是一次简单的 Prompt 拆文件。

## 十四、可证伪的不变量

目标架构必须让以下命题能够由自动合同或黑盒证据判真伪：

1. 任一时刻，一个业务事务只有一个 active Harness Instance。
2. 任一 Instance 只引用一个 Harness Type 和一个 Revision。
3. 每次模型请求的可见 Tool 与当前 Operation/Phase 完全一致。
4. 任一 Tool call 都能追溯到当前 Operation/Phase 的 Tool ref。
5. 未投影 Tool 即使被模型构造，也会在执行前被拒绝。
6. 任一直接 semantic diff 都属于当前业务写域。
7. 任一额外 diff 都能被标记为确定性 reconciliation 或派生 recomputation。
8. 任一 mutation commit 都匹配当前 checkout revision 并通过 CAS。
9. 任一知识结论都能追溯到 evidence ref 和适用条件。
10. 任一 proposal 的确认使用创建它的 Revision、方案 lineage 和 evidence。
11. 单业务 Revision 激活不改变其他四个业务。
12. 新事务使用最新 active Revision，未完成事务不被静默换版。
13. 上游状态变化以 typed invalid/stale/recompute 传播。
14. 固定 Prompt、旧总 Skill 和八槽不再拥有五业务规则。
15. 业务完成以产品 postcondition 和真实 UI 为证据，不以模型自述为证据。

如果其中任一命题只能靠“模型应该理解”成立，则实现尚未完成。

## 十五、研究结论

1. DEF 的 Harness 原子必须从五个游戏业务切分，不能从角色、术语、Tool、文件或旧 slot 切分。
2. 选人、配装、排轴、BUFF、计算统计是稳定业务边界；新增、换人、3+1、批量 BUFF 等是内部 Operation 或约束。
3. Harness 与上下文不可分。运行单位必须是绑定方案 lineage、目标、知识证据和 Phase 的业务 Instance。
4. Session 太大、Turn 太小；业务事务是兼顾连续性和热更新的最小 Revision 绑定单位。
5. Typed Tools 保持平级注册；从属关系由 `(Business, Operation, Phase) → Tool` 工作流图表达。
6. 业务拥有 semantic state 和 postcondition，不拥有通用 Tool 或物理文件。
7. 上游业务变化必须通过 `hard-invalid / stale / recompute` 传播，确定性级联由产品代码拥有。
8. 游戏知识是五业务的有来源证据输入，不是第六 Harness，也不是全局巨型 Prompt。
9. Harness Manager 的各组件都由现存问题推导；它是五业务原子真正可运行、可管理、可热重载的必要条件。
10. 本轮必须一起完成旧行为来源解耦、Manager 和五个真实 Revision；任何局部完成都会保留双重 owner。

这些结论共同构成 [`spec.md`](./spec.md) 的架构依据，后续任务不得通过删减其中任一关系来换取表面上的快速完成。
