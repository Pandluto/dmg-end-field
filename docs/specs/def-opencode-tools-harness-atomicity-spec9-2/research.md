# Spec 9-2 Research：Tool 与 Harness 原子职责

## 状态

研究完成，未进入代码实施。

本研究以提交 `448f5688` 上的当前实现为对象，只回答一件事：

> Tool 与 Harness 分别应该决定什么；Harness 内部各单元如何只保留一个责任，避免重复、冲突和隐式覆盖。

旧的无效 Spec 9 已归档，不作为本研究输入。Harness 整包版本化、Session 固定、候选发布，以及任何配装术语都不是本研究主旨。

## 一、先说结论

当前项目还没有做到 Harness 原子化。

现有八个 slot 是文件分类，不是责任原子。相同规则同时存在于：

- OpenCode Agent 的固定系统提示；
- 每回合注入的宿主提示；
- Harness 的多个 slot；
- runtime Skill；
- Tool 的模型描述；
- Tool plugin 的可执行回合门禁；
- REST Tool registry、访问策略和具体 handler。

`def-harness.cjs` 能校验路径、hash、slot 名称和包兼容性，但不会判断两段内容是否拥有同一决定权，也不会判断它们是否矛盾。最终组合只是按固定顺序全文拼接。因此，当前系统依赖“多处文字刚好保持一致”，而不是依赖明确的唯一责任人。

原子化不等于增加文件、slot、manifest 或版本号。这里的原子定义为：

> 对一种决定拥有唯一解释权、具有明确输入输出、能独立修改和验证、且不需要另一处重复同一规则的最小责任单元。

用最直白的话说：

- Tool 回答“能做什么、接受什么、允许不允许、实际发生了什么”；
- Harness 回答“面对这个用户请求，应该选择哪个安全能力、按什么业务步骤使用、最后怎么说明”；
- 产品状态与知识源回答“事实是什么”；
- Judge 回答“做得对不对”。

任何一个问题同时由两处回答，都还没有原子化。

## 二、研究范围与证据

### 2.1 检查对象

| 层 | 当前主要入口 | 本研究关注点 |
| --- | --- | --- |
| Harness 包装与组合 | `agent/harness/def-harness.cjs` | slot 合同、组合方式、冲突检查 |
| Harness 内容 | `agent/harness/baseline/stable-v0/`、`agent/harness/examples/` | 单元是否独立、候选是否只改变一个假设 |
| 固定 Agent 提示 | `agent/runtime/def-opencode-adapter/index.cjs` | 是否另有一套未声明为 Harness 的行为规则 |
| 每回合宿主提示 | `agent/server/def-agent-server.cjs` | 状态注入是否夹带路由、工作流和回复规则 |
| runtime Skills | `agent/runtime/def/skills/**/SKILL.md` | Skill 是否是单一过程，还是第二套总 Harness |
| 模型侧 Tool | `agent/runtime/def-tools/opencode/def.js` | schema、描述、执行门禁和工作流是否混在一起 |
| Tool registry | `agent/runtime/def-tools/definitions.mjs`、`registry.mjs` | Tool 是否存在唯一合同 |
| Tool 执行端 | `scripts/ai-cli-rest-server.mjs`、`scripts/def-core/*` | 准入、执行、验证、错误和输出合同的实际归属 |
| 产品命令合同 | `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs` | 硬约束是否已由代码拥有 |

### 2.2 明确排除

本研究不：

- 修改任何运行时代码、Tool、Harness、Skill 或提示词；
- 设计整包版本、Session pinning、promotion 或 rollback；
- 研究任何具体配装算法或业务答案；
- 用旧无效 Spec 9 的研究结论倒推本轮目标；
- 把“当前实现存在”误写成“目标架构必须保留”。

## 三、当前真实结构

一次 Workbench 回合实际经过的行为来源大致如下：

| 顺序 | 来源 | 当前实际内容 |
| --- | --- | --- |
| 1 | `buildAgentPrompt("workbench")` | 身份、路由、工具选择、工作流、失败处理、回复要求 |
| 2 | runtime Skill | 某领域的详细步骤，同时再次包含路由、知识、失败和回复规则 |
| 3 | 每回合宿主状态提示 | 当前 checkout/selection，也夹带“必须先调用什么”等行为命令 |
| 4 | Harness 八槽 | 再次注入合同、路由、工具指南、工作流、知识和回复策略 |
| 5 | Tool 描述与 args | 本地能力说明，但部分描述继续规定前后 Tool、失败后的动作和回复方式 |
| 6 | plugin/REST 可执行门禁 | 实际阻止 Tool、判断权限、限制重试、执行状态转换 |
| 7 | Tool handler 与产品命令 | 执行领域逻辑、验证输入、产生副作用和 postcondition |

前三套较长的教学内容可以在同一回合同时出现：

- 固定 Workbench 提示的核心规则约 20 KB；
- `timeline-workbench/SKILL.md` 约 16.7 KB；
- stable Harness 八个 Markdown 合计约 11 KB。

字符数本身不是错误；问题是三者大量拥有相同的决定权，却没有组合合同。

## 四、证据化发现

### F1：八个 slot 只有名称边界，没有语义边界

`agent/harness/def-harness.cjs:11` 声明八个 slot；`agent/harness/def-harness.cjs:88` 之后只验证 slot 名、文件安全、能力标签和结构。

`agent/harness/def-harness.cjs:317` 的组合器按固定顺序把所有文本直接连接。它没有：

- 单元 id；
- 责任声明；
- 输入或输出；
- 依赖；
- 触发范围；
- 禁止拥有的责任；
- 冲突键；
- 重复规则检测；
- 语义优先级。

artifact 的 `when` 字段在 `agent/harness/def-harness.cjs:77` 被保存，但 `composeHarnessSystem()` 不读取它。也就是说，artifact 级条件目前不是有效的运行时组合语义。

结论：slot 目前只能证明“内容放在哪个文件”，不能证明“内容只负责什么”。

### F2：stable Harness 内部已经发生跨槽重复

以当前 stable 的同一装备推荐分流为例：

| slot | 实际承担的内容 |
| --- | --- |
| `agentContract` | 何时需要某类证据、哪些推断禁止、部分输出约束 |
| `routingPolicy` | 首个 Tool、后续分支、终止条件 |
| `toolGuidance` | 同一首个 Tool、分支、不可回退和参数传递 |
| `workflows` | 再次写出完整调用顺序、审批和结束条件 |
| `responsePolicy` | 再次写修订重算、token 处理、成功条件 |

这些不是五个不同决定，而是一个业务流程被拆成五份自然语言副本。

`roleCards` 只有“预留未来角色卡”，`skills` 只有“使用宿主 Skills”。它们是占位文本，不是拥有独立责任的运行单元。

结论：当前八槽同时存在“一个责任写进多个槽”和“为凑齐槽而存在的空责任”。

### F3：大多数主题 candidate 修改的是整套文件，不是一个训练假设

当前 `agent/harness/examples/` 中，专门用于展示单槽变更的 `candidate-v1` 只修改一个 slot；其余主题 candidate 相对 stable 普遍修改 7 至 8 个 slot。

`operator-config-atomic-failfast-v1` 尤其具有代表性：同一个“失败后停止”的假设同时写进 `agentContract`、`roleCards`、`skills`、`routingPolicy`、`toolGuidance`、`responsePolicy` 和 `workflows`。

这说明 candidate 的最小变更单位仍是“围绕一个主题重写一包提示词”，不是“替换一个责任原子”。

### F4：真正的大 Harness 不在 Harness 目录里

`agent/runtime/def-opencode-adapter/index.cjs:261` 开始的 Workbench 固定提示，同时规定：

- 何时读取当前上下文；
- 何时选择某个数据 Tool；
- 如何完成节点 mutation；
- 何时审批；
- 如何处理失败；
- 最终答案说什么或不说什么。

这已经是一套完整 Harness，只是没有进入 Harness slot 模型。

`agent/runtime/def/skills/timeline-workbench/SKILL.md` 又重复了上述大部分内容。该 Skill 同时负责全局上下文规则、多个业务路由、多个 mutation 流程、重试、知识读取和回复格式，远超一个可复用 Skill 的单一责任。

结论：只整理 `agent/harness/` 不会得到原子化；必须先承认所有模型行为来源都属于同一责任盘点。

### F5：声明式 routing 与可执行 routing 混在两边

`agent/harness/baseline/stable-v0/routing.md` 声明模型如何分流。

与此同时：

- `agent/runtime/def-opencode-adapter/harness-turn-router.cjs` 用正则识别回合类型并切换 Harness/任务；
- `agent/runtime/def-tools/opencode/def.js:107` 为同一回合建立可执行 Tool policy；
- `agent/runtime/def-tools/opencode/def.js:321` 实际阻止不在 allowlist 内的 Tool；
- `agent/server/def-agent-server.cjs:994` 又向 system prompt 注入该回合必须采取的 Tool 行为。

需要硬阻止的权限或状态规则属于 Tool/Host enforcement；在若干安全 Tool 中选择哪一个则属于 Harness routing。当前实现没有按这个标准拆开，而是把“自然语言意图识别”直接做成了 Tool 全局门禁。

### F6：Tool 合同本身也不是单一来源

同一个能力目前可能分散在：

- `definitions.mjs` 的 dotted name、scope、risk、approval 和简短描述；
- `registry.mjs` 的 family、host exposure、workspace scope、canonical target；
- `scripts/ai-cli-rest-server.mjs` 的 input/output 元数据和 handler；
- `opencode/def.js` 的 snake_case 模型名、另一份 schema、另一份长描述和 wrapper；
- `commandSchemaRuntime.mjs` 的最终产品命令验证；
- `buildCapabilityPermission()` 的真实 OpenCode permission。

`registry.mjs:247` 以后还通过集合、名称前缀和正则推导 family/canonical target。`scripts/ai-cli-rest-server.mjs:8140` 为很多 Tool 生成泛化 input schema，并给所有 Tool 使用相同的 `{ ok, tool, result }` output 轮廓。

现有 registry 能检查“字段存在”，但不能证明：

- REST 名与模型名来自同一个 canonical contract；
- `approval` 元数据与实际 native permission 一致；
- scope 元数据与真正的准入 gate 一致；
- Tool 描述引用的结果字段真实存在；
- output state、错误和 postcondition 被准确建模。

结论：Harness 无法只引用一个稳定 Tool 合同，只能重复抄写 Tool 行为来补足缺失信息。

### F7：Tool 描述泄漏了 Harness 的职责

例如 `agent/runtime/def-tools/opencode/def.js:1624` 的一个数据 Tool 描述，不只说明自身能力，还规定：

- 它必须是某类请求的第一步；
- 哪些其他 Tool 不可调用；
- 后续调用哪一个 Tool；
- 什么状态下停止；
- 最终结果如何呈现。

其中只有“输入、输出、事实范围、是否产生副作用”属于 Tool 本地合同。首步选择、跨 Tool 顺序和呈现方式分别属于 Harness router、workflow 和 response policy。

Tool 描述承担这些职责，会与 Harness 自身产生两个路由真相。

### F8：当前已经存在可观察的文字冲突

“当前节点是什么”在同一最终 system prompt 中可能同时得到：

- `agent/server/def-agent-server.cjs:1033`：必须调用 `def_workbench_current_node`；
- `agent/server/def-agent-server.cjs:1067`：直接从注入字段回答，不要再调用 Tool；
- `agent/runtime/def-opencode-adapter/index.cjs:272`：调用 Tool，并只按 Tool 结果回复。

这不是模型偶发理解错误，而是三个责任源对同一决定给出了不同答案。当前组合器没有冲突报告，只能依赖文本顺序和模型自行取舍。

### F9：已有一些正确的硬边界，应保留而不是提示词化

以下责任已经较接近正确归属：

- `registry.mjs` 的 host/workspace exposure；
- `applyDefToolInvocationPolicy()` 的服务端准入；
- `commandSchemaRuntime.mjs` 的产品命令验证；
- native permission 与 approval capability；
- current checkout/session 绑定 gate；
- handler 的副作用、幂等和 postcondition；
- plugin 对已发生 Tool 失败的可执行熔断。

这些属于 Tool/Host enforcement。Harness 可以解释结果并决定下一条安全业务路径，但不应重复声明或假装能改变这些边界。

### F10：hash、包不可变和 Session 固定不能解决职责冲突

当前 Harness runtime 能证明一组字节没有变化，也能把它绑定到 Session。它不能证明这些字节：

- 没有跨槽重复；
- 没有和固定 Agent prompt、Skill、Tool 描述冲突；
- 每个 candidate 只修改了一个假设；
- 组合后存在唯一行为含义。

因此，版本化是运输和复现机制，不是原子化机制。本研究不把它作为答案。

## 五、目标责任模型

### 5.1 判断归属的四个问题

遇到任何规则，按以下顺序判断：

1. 违反它会越权、写错状态、绕过审批或错误宣称成功吗？
   - 是：必须由 Tool/Host 代码强制。
2. 它描述输入、输出、错误、事实范围或一次业务副作用吗？
   - 是：属于 Tool contract。
3. 它决定面对某种用户意图选择哪个安全能力，或如何组合多个安全能力吗？
   - 是：属于 Harness router/workflow/Skill。
4. 它只决定答案的结构、语气和披露方式吗？
   - 是：属于 Harness response policy。

当前事实不放 Harness；测试期望不放 Worker；无法归入上述任一项的规则，应先证明其必要性，而不是再建一个 slot。

### 5.2 Tool 的原子职责

一个模型可见 Tool 应代表一个清楚的业务能力或一个清楚的业务效果，并拥有唯一 canonical contract。

| Tool 子责任 | 必须拥有 | 不得拥有 |
| --- | --- | --- |
| Capability contract | canonical id、用途、精确 input/output schema、事实范围、副作用类型 | 用户意图分类、跨 Tool 流程 |
| Admission gate | host、workspace、current-state、permission、approval、capability、CAS 前置条件 | 用提示词请求模型自觉遵守 |
| Executor | 确定性的读取、计算或一次业务事务 | 最终回复措辞 |
| Result contract | 明确状态、错误码、`retryable`、`stateChanged`、postcondition、证据来源 | “接下来必须调用某 Tool”的长篇教学 |
| Verifier/audit | 成功判定、可见后置条件、审计证据 | 由模型自行猜测成功 |
| Exposure adapter | 从 canonical contract 派生 REST/OpenCode 名称和 schema | 复制出另一份独立合同 |

Tool 原子化不要求把内部每一步都暴露成小 Tool。一个用户可见的原子 mutation 可以在内部完成 prepare、审批、提交、回滚和验证，只要它只有一个可说明的业务效果，并准确报告未执行、部分执行或完成。

反过来，也不能让 Harness 调用许多低级 Tool 后自行拼出事务正确性。

### 5.3 Harness 的目标单元

现有八槽不应被默认保留。先按责任判断其去留：

| 当前 slot | 目标责任 | 处理结论 | 明确禁止 |
| --- | --- | --- | --- |
| `agentContract` | 跨任务恒定的身份、使命、认识论和全局不变量 | 保留但大幅收窄 | Tool 名、领域步骤、参数、回复模板 |
| `roleCards` | 某一工作角色的协作姿态和决策关注点 | 可选保留；没有真实差异时不加载占位符 | 权限、路由、工作流、安全门禁 |
| `knowledgePacks` | 有来源、范围和时效说明的非实时解释性知识 | 保留并与产品事实隔离 | 当前状态、Tool schema、调用顺序 |
| `skills` | 只引用可加载 Skill 及其适用范围 | 改成 Skill reference/binding；不再写第二份 Skill 内容 | 重复实际 `SKILL.md`、全局规则 |
| `routingPolicy` | 用户意图到一个 `workflowId` 或 `skillId` 的选择 | 保留并只负责入口选择 | 完整步骤、Tool 参数、回复格式 |
| `toolGuidance` | 当前没有独立决定权 | 不再作为可手写规范源；若保留，只能由 canonical Tool contract 生成只读模型视图 | 另写 schema、权限、跨 Tool 顺序、回复规则 |
| `responsePolicy` | 把已确定的结果状态转换为用户可读结构 | 保留并只负责表达 | 触发 Tool、改变结果状态、执行 mutation |
| `workflows` | 基于 typed state 的跨能力状态机 | 保留；实际 Skill 也按同一合同视为可复用 workflow | 复制 Tool schema、当前事实、全局角色、回复文案 |

因此，目标不是“八个 slot 各写一点”，而是“只有确有独立决定权的单元才存在”。

### 5.4 Skill 的位置

实际 `SKILL.md` 是 Harness 的可复用过程单元，不是 Tool，也不是知识包。

一个原子 Skill 应：

- 只解决一种有边界的任务；
- 声明适用输入和完成输出；
- 引用 Tool capability id，而不复制 schema；
- 使用 typed result state 进行流程转换；
- 依赖全局 `agentContract`，不重复它；
- 依赖全局 `responsePolicy`，不重写通用回复规范；
- 不包含其他领域的总路由。

Harness 的 `skills` slot 若存在，只负责“可用 Skill 与触发范围”的绑定。它不应再装一份自然语言 Skill。

### 5.5 Host context 的位置

宿主注入只应提供不可从对话可靠推断的当前事实，例如：

- 当前 host；
- 当前 timeline/checkout identity；
- 当前可见 selection；
- 是否发生 checkout transition；
- 对应事实的更新时间或 revision。

它不应同时写“先调用哪个 Tool、最多调用几次、最后怎么回答”。这些分别属于 Harness workflow 或 Tool gate。

### 5.6 Knowledge 与当前事实

| 内容 | 唯一来源 |
| --- | --- |
| 当前 checkout、当前角色、当前配置 | Host context 或 typed Tool result |
| 产品 catalog、id、数值、状态 | typed Tool/data service |
| 经审核但非实时的解释性知识 | Knowledge unit，带来源与适用范围 |
| 用户本轮偏好与修正 | 当前 conversation state |
| 回归期望、正确答案、评分规则 | Judge，禁止注入 Worker/Harness |

Harness 可以规定信任顺序，但不能复制当前事实本身。

## 六、唯一决定权矩阵

| 决定 | 唯一 owner | 其他层如何使用 |
| --- | --- | --- |
| Tool 是否存在、叫什么、输入输出是什么 | canonical Tool contract | Harness 只引用 capability id 和 typed state |
| Tool 能否在当前 host/workspace 调用 | Tool admission gate | Harness 接受允许/拒绝结果 |
| mutation 是否需要审批 | Tool admission/permission | Harness 不得降低或伪造 |
| mutation 是否成功 | Tool verifier/postcondition | response 只转述已验证状态 |
| 当前产品事实 | Host context / Tool result | Knowledge 与 Harness 不得覆盖 |
| 用户意图属于哪类任务 | Harness router | Tool 不写“我是第一步” |
| 多个安全能力如何衔接 | Harness workflow/Skill | Tool 只返回足够的 typed state |
| Tool 失败是否可重试 | Tool result contract | workflow 依据字段选择重试、转向或停止 |
| 安全上绝不允许的 fallback | Tool gate | Harness 不重复承担安全责任 |
| 结果如何排序、摘要和披露 | Harness response policy | Tool 返回结构化语义，例如 `ordered: false` |
| Agent 的长期使命与事实纪律 | Harness agent contract | Skill/route 不重复 |
| 评估通过条件 | Judge | 不进入 Tool 描述或 Worker 提示 |

## 七、组合与冲突规则

### 7.1 不使用“后写覆盖前写”

Tool enforcement 永远高于模型教学，但这不是让矛盾文本继续存在的优先级机制。

目标规则是：

- Harness 与 Tool 冲突：Harness 无效；
- 两个 Harness 单元拥有同一决定：组合无效；
- 两个 Harness route 对同一输入同时成为唯一入口：组合无效；
- workflow 引用不存在的 Tool、state 或字段：组合无效；
- response policy 改变 Tool 的状态含义：组合无效；
- Knowledge 声称覆盖当前 typed fact：组合无效。

同一层内部不得依赖“拼接顺序”解决冲突。

### 7.2 最小责任卡

后续任何原子单元至少需要能回答以下字段；这是一张责任卡，不是版本系统：

```text
id
kind
owns
inputs
outputs
dependsOn
mustNotOwn
evidence
```

其中 `owns` 必须是唯一的决定描述。若两个单元填写出相同 `owns`，应先合并或重新切分，不能直接组合。

### 7.3 原子变更判定

一个候选或修改只有同时满足以下条件，才叫原子：

1. 只改变一个责任卡的 `owns` 或实现；
2. 不要求同步改写其他单元中的同义规则；
3. 依赖者只通过输入输出合同受影响；
4. 能说明预期改变哪些场景；
5. 能说明哪些相邻场景必须不变；
6. 失败时能精确回退该单元，而不是回退整包教学内容。

如果一次修改必须同时改 `agentContract + routing + toolGuidance + workflow + response` 才能保持一致，说明责任切分仍然失败。

## 八、用三个现有问题验证模型

### 8.1 当前节点查询

目标分配：

- Host context：提供当前 checkout 的事实；
- Tool：在需要重新读取时返回唯一 current-node 结果；
- Harness route：根据“上下文已足够/需要刷新”选择直接回答或调用 Tool；
- response policy：规定只显示用户需要的名称/id。

不得再由三份 system text 同时规定“必须调用”和“禁止调用”。

### 8.2 精确技能事实查询

目标分配：

- Harness route：识别这是技能事实任务并选择对应 workflow；
- Tool schema/validation：要求完整查询并返回命中范围；
- Tool result：返回每个 hit 的可信类型、数值和缺失状态；
- Tool gate：只阻止越权或不合法输入，不负责通用自然语言路由；
- response policy：按 Tool 事实回答，不扩写未返回结论。

“这个自然语言请求只能调用哪个 Tool”不应同时出现在 router、Skill、宿主 prompt 和 plugin gate。

### 8.3 干员配置应用

目标分配：

- Harness workflow：预览、等待明确确认、提交一次应用请求；
- Tool：proposal/capability 校验、native approval、事务执行、错误、postcondition；
- Host：当前 checkout 与 session identity；
- response policy：区分预览、拒绝、未执行、失败和已验证完成。

Harness 不重写审批条件和成功判定；Tool 不规定最终中文文案。

这三个不同场景均能落入同一责任模型，说明该模型不是围绕某个业务术语临时设计。

## 九、研究结论

1. 当前最主要的问题是“决定权重复”，不是 Harness 包是否可版本化。
2. 八槽只是当前存储形式，不是目标原子模型；`toolGuidance` 尤其不具备独立规范责任。
3. 固定 Agent prompt、runtime Skill、每回合宿主提示都必须纳入 Harness 责任盘点，否则只改 `agent/harness/` 没有意义。
4. Tool 应先形成唯一 canonical contract；REST、OpenCode 和文档视图都从它派生。
5. 安全、权限、状态、审批、副作用和成功判定必须留在可执行 Tool/Host 边界。
6. 意图路由、跨能力流程、Skill 选择和回复表达才是 Harness 的核心责任。
7. Harness 单元之间不设文字覆盖优先级；重复 owner 或矛盾必须在组合前判为无效。
8. 原子 candidate 应只改变一个责任卡，不再围绕一个主题同步重写七八个文件。

本轮已经把职责模型研究清楚，但没有授权或实施迁移。任何代码重构、slot 调整、Tool registry 合并、prompt 去重或 Skill 拆分，都应在用户确认后另开实施规格。
