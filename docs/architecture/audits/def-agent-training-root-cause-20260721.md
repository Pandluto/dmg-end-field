# DEF Agent “训练”架构根因审计

## 研究状态

本研究形成于 2026-07-21，只读比较以下两个远端版本：

- `origin/main@de8f78b`
- `origin/codex/code-bloat-audit-20260721@7145142`

共同基线为 `e090404`。本轮不修改 Agent runtime，不合并两个分支，不 promotion Harness，也不提前编写下一轮 Spec 或 Task。

## 一、结论

Tools + Harness 的方向没有错，但当前“发现一个问题就训练一次”的单元选错了。

现在被称为“训练”的过程，实际会同时修改：

- 静态 system prompt；
- 每轮动态 system prompt；
- Harness 的八个文本槽；
- 真实 Runtime Skill；
- OpenCode Tool schema、description 与 turn policy；
- Sidecar Tool、planner 与状态；
- 游戏知识、约定与 artifact；
- Renderer、SQLite、checkout 和 postcondition。

Harness 却只钉住八个文本槽的 hash。因此它无法代表一个完整、可复现的 Agent 版本，也无法可靠回答“这次行为改善究竟来自哪一处修改”。

当前最深的架构问题可以概括为一句话：

> 系统把模型当成了工作流引擎，又把全局提示词包当成了可训练产品。

根治方向不是继续扩写 Prompt，也不是立刻再造一套 Agent framework。

最小路径只有三步：

1. 先锁定运行指纹，让 stable、candidate 和旧 session 的行为来源可追踪、可归因；
2. 再把真实领域 Scenario 接入 promotion，而不是检查教学句子是否存在；
3. 最后只收编一个确定流程：用一个高层 typed tool 完成“指定套装 3+1”。

只有三种以上任务反复出现同一种阶段、失效与恢复机制时，才提炼通用 `Task Contract`。只有组件确实需要独立发布或热更新时，才引入完整 `Runtime Bundle Registry`。

## 二、两个分支实际做了什么

### 2.1 `origin/main`

共同基线之后有 11 个独有提交，diff 规模约为：

```text
6530 / -425
新增 7 个模型可见 Tool
4 个新增、2 个强化的领域 Scenario
一个通用 Scenario verification evaluator
一份 Spec 9 预研究
```

Spec 9 汇总了五个真实黑盒会话，主要处理：

- 汤汤无指定套装 3+1；
- 别礼指定潮涌 3+1；
- 装备目录对比；
- 汤汤定位与专武；
- 赛希条件触发与武器选择。

roster 选择与 Work Node 协调来自另一条提交链，不能算进这五个会话。

它真实增强了 planner、combat conventions、evidence、typed transition 和 evaluator。但它不是严格的 Harness candidate 训练：七个 Harness 槽在 stable 与 candidate 中最终完全相同，只有原本用于演示的 response policy 标记不同。

提交顺序也暴露了补丁扩散：`0985f5f` 扩展战斗约定后，紧接着出现一次 Markdown 格式清理 `3e24220`，以及 `7446aaa`、`715763e`、`f518739` 三轮功能调整。这里既有正确下沉，也有继续教学措辞：

- `f518739` 把触发者变成结构化 `triggerActor`，属于正确的领域合同；
- `715763e` 混合了结构化 `responseConstraints`、合同测试，以及 Prompt/Judge 的禁用措辞；前者是合同，后者仍是回答层补丁；
- `0ebffc4` 增加 `DEF_EMPTY_ASSISTANT_RESPONSE` outcome guard，属于值得保留的运行时保护。

也就是说，新规则被直接同步写入了：

```text
stable baseline
+ candidate baseline
+ adapter Prompt
+ Runtime Skill
+ Tool description / guard
```

`stable-v0` 的版本仍是 `0.0.0`。在新的本地 Registry 上，`ensureBaseline()` 会直接从发布包内当前的 `stable-v0` 源构建 stable。因此一次全新安装可以得到这些未经 promotion 的新规则，而旧安装仍保留先前 Registry stable。相同产品版本的行为来源由本地历史决定。

最后的 [Spec 9 预研究](https://github.com/Pandluto/dmg-end-field/blob/de8f78b/docs/specs/def-opencode-evidence-runtime-spec9/research.md) 已经正确识别：高价值任务需要证据运行时和可执行阶段机。这个诊断尚未成为当前实现。

### 2.2 `origin/codex/code-bloat-audit-20260721`

共同基线之后有 14 个独有提交，其中一个是代码体积审计。其余 13 个提交可分为：

- 9 个真实代码、状态、持久化或投影修复；
- 4 个 Harness 教学补丁。

九个提交包含正确定位的修复意图或实现切片，包括：

- 重启后的内部 authority；
- 本地干员 checkout hydration；
- 精确攻略来源的持久化；
- 空轨道的 timeline invariant；
- 攻略装备 slot compatibility；
- idle reconciliation；
- checkout hydration 前不抢占命令；
- 攻略武器与装备的原子 patch；
- 完整角色输入持久化。

它们不能被视为九个已经独立验证、可以直接 cherry-pick 的纯代码修复。部分提交触碰了 `main` 已重写的 Sidecar 或 CanvasBoard；`08e20e1` 还夹带精确攻略 manifest。正确做法是逐项重放不变量与合同测试，并按当前 source hash 重新验证知识资产。

以下提交则把具体失败继续写成自然语言：

| 提交 | 教给模型的补丁 | 真正所属层级 |
| --- | --- | --- |
| `fec0c8c` | 攻略团队路线必须保持 sticky | 团队计划状态机 |
| `606e38a` | 使用精确 Tool 名，不得发明别名 | Tool Contract / 静态检查 |
| `6250232` | 加载 Skill、记住按钮完整 schema | Timeline authoring API |
| `7145142` | 大 timeline 不得一次 write，要按 staff line 分块 | Workspace authoring contract |

这四次修改没有新增对应 Scenario，也没有行为 regression。`harness:check` 只确认这些句子已经存在于 candidate。

### 2.3 合并模拟揭示的问题

两个分支做一次 `git merge-tree`，会产生四个文本冲突：

- `candidate-v1/routing.md`
- `candidate-v1/workflow.md`
- `scripts/ai-cli-rest-server.mjs`
- `src/components/CanvasBoard/index.tsx`

但真正危险的是自动合并成功的文件。

例如两个分支都把不同训练目标写进同一个 `candidate-v1/tool-guidance.md`。Git 可以把两段文字拼在一起，却不能证明“装备证据规则 + 攻略团队规则 + timeline 大文件规则”组合后仍然成立。

所以这里不是普通 Git 冲突，而是训练单元不可组合。

## 三、已经存在的直接矛盾

### 3.1 不存在的团队计划 Tool

真实模型 Tool 是：

```text
def_data_team_loadout_plan
```

审计分支的 candidate 明确写着：

```text
Never invent or call def_team_loadout_plan.
```

但同一分支的基础 Workbench system prompt 仍然要求：

```text
A later user confirmation ... must call def_team_loadout_plan exactly once.
```

`606e38a` 没有修正错误来源，只在更晚的 Harness 中加入相反指令。模型只能依赖消息顺序和注意力猜测哪个是真的。

### 3.2 当前节点既要调用 Tool，又禁止调用 Tool

动态 checkout system 要求直接当前节点问题调用 `def_workbench_current_node`。

随后拼接的 live selection system 又要求直接使用注入字段，不要调用 Tool 重新发现。

两段都被标记为 authoritative system instruction。这里没有正式优先级，也没有编译期冲突检测。

### 3.3 通用单人配置与攻略团队配置重叠

Runtime Skill 的通用装备规则允许逐干员调用 `def_operator_config_patch`。

Candidate routing 又规定：命名攻略团队一旦进入 unified plan，就永远不得退回逐干员 patch。

后者业务上更具体，但系统没有正式的 task state 来证明当前是否已进入这条路线。

### 3.4 Artifact producer 与 consumer 合同冲突

`origin/main` 的 equipment full fallback producer 会生成两个 data file，consumer 却硬编码要求恰好一个文件。

这是确定性的 Tool 合同错误，却曾表现成 Agent 工具失败。Prompt 无论多完整都无法根治。

## 四、当前学习闭环为什么失真

### 4.1 Harness 只钉住文本，不钉住 Agent

`DefHarnessSessionBindingV1` 当前记录 Harness package 与 slot hashes，但没有记录：

- Runtime Skill bundle；
- Tool registry 和 schema；
- Tool implementation；
- turn router / orchestrator；
- Evidence schema；
- Knowledge index 与来源 revision；
- runtime build；
- model configuration。

更严重的是，`readNativeSessionBinding()` 读取既有 session 时，会调用 `syncNativeSessionWorkspaceFiles()`。当前仓库的 `def.js` 与 codec 因此会覆盖旧 session workspace。

旧 workspace 已经漂移。Tool 重新发现、session 恢复或 OpenCode instance 重建后，它会使用新实现。当前进程是否立刻切换，则取决于缓存生命周期。

真实 Skill 也始终从全局 `skillsRoot` 加载。它没有进入 session binding；session 恢复或 OpenCode instance 重建时，可能加载与最初 trial 不同的 Skill 版本。

当前 pinning 只能证明八个 Harness 文本没有漂移，不能证明 Agent 行为没有漂移。

### 4.2 Session pinning 又被 turn router 打破

`harness-turn-router.cjs` 可以让某些 specialized candidate session 在 timeline turn 临时切回 stable Harness。

这与 ADR 中“后续 turn 只能使用同一 pinned binding”的声明不一致，也让 candidate 的失败或成功无法归因到单一版本。

### 4.3 八个 Harness slot 是全局文本容器

`composeHarnessSystem()` 不解释 artifact 的 `when`，而是把八个 slot 全部拼进每一轮 system prompt。

因此当前的 `skills.md` 不是真正的 Runtime Skill，`routing.md` 也不是路由器，`workflow.md` 也不是工作流。它们只是不同标题下的全局提示词。

在 `origin/main` 中：

```text
buildAgentPrompt              约 21,500 字符
timeline-workbench/SKILL.md   约 16,000 字符
stable Harness 业务文本       约 10,000 字符
模型可见 Tool                41 个
```

这些内容尚未包括动态 Workbench system 和 Tool schemas。新增一条经验时，很难知道它是否已经在另一个来源存在、是否与更具体的规则冲突、最终在上下文中排在什么位置。

### 4.4 Tool Contract 仍有双重真相

Sidecar 的 definitions/registry 维护一套名称、schema、权限和 route。

OpenCode 的 `def.js` 又手写一套模型 Tool、schema、description、permission 与 turn policy。

当前 registry 不是生成源。`canonicalTarget` 主要用于描述和路由，无法阻止 system prompt 写出不存在的 `def_team_loadout_plan`，也无法保证 Sidecar 与模型 schema 永远一致。

### 4.5 Evaluator 已增强，promotion suite 仍未连接

`origin/main` 新增的 evaluator 已经能执行：

- required / forbidden tools；
- 每轮 Tool；
- Tool 顺序；
- 重复次数；
- 条件分支；
- forbidden assistant text；
- 产品状态不变。

这是应当保留的资产。

`origin/main` 已把 operator planning 检查和 `harness:check` 接入 `npm run check`。它也有独立的 `test:def-harness-turn-routing` 合同测试。因此，问题不是“完全没有测试”。

真正的缺口是：turn-routing 测试未接入 `npm run check`。领域 Scenario 和 turn routing 也没有进入 `runNativeRegression()` / promotion 的决定性证据。

`runNativeRegression()` 仍固定运行三个场景：

```text
single-profile-v1
pass-to-pass-v1
safety-preview-v1
```

FAIL_TO_PASS 仍以回答是否包含 `candidate-v1` 字符串为核心；PASS_TO_PASS 是“你好”；本轮四个新增、两个强化的领域 Scenario 没有进入 promotion suite。

审计分支则连新的 Scenario 都没有。Candidate 同时修改五个 slot，manifest 却仍描述为 sticky team planning，无法判断哪条规则产生效果。

Git 中虽然留下了五个 session ID 和总结，却没有原始 Interop trace、模型配置或可重放 run artifact。这些材料可以支持根因调查，却还不足以复现实验。

### 4.6 单次失败被直接编译成全局规则

当前过程接近：

```text
一次真实失败
  → 找到一句可能有帮助的话
  → 同步写入 Prompt / Skill / Harness / Tool description
  → 手测原问题
  → 继续下一次失败
```

缺失的中间对象是结构化 Finding。对随机行为，它还需要聚合为“失败簇”。系统没有先证明：

- 随机失败是否能在多个 fresh session 形成同类模式；
- 它是 Tool 合同、状态机、知识、路由还是模型表达问题；
- 修复是否是一条可泛化的不变量；
- 哪些相邻行为可能被影响。

确定性的 schema、Tool 名或 producer/consumer 合同错误，一次 trace 加一个确定性复现就足够进入修复；不应为了凑多个 trial 延迟已证实的代码问题。随机行为才需要多个 trial 和 failure cluster。

否则，训练集中的措辞会逐渐进入系统，而不是让系统得到一个更小、更稳定的规则。

### 4.7 Workbench 运行生命周期仍是独立 Finding

审计分支中的 authority、checkout hydration、空轨道、命令早到和 reconciliation 修复并不是五个独立偶发错误。它们共同说明 SQLite、Sidecar、Renderer 与 React cache 之间缺少一个显式生命周期：

```text
BOOTSTRAPPING → READY → APPLYING → RECOVERING / FAILED
```

不同状态目前分别依靠布尔变量、轮询、缓存和提示词约束。持久化策略也不统一：authority、guide source、proposal、approval capability、pending command 各自决定是否跨重启。

本研究不把它塞进 Runtime Provenance 或 3+1 纵切。它应作为独立 Finding 继续验证。

若以后引入统一 owner，其范围只能是 readiness、command admission 与 command journal。授权、CAS、提交和回滚仍由 Mutation Gateway 独占。未进入 `READY` 的投影不得领取新命令。

## 五、真正应该保留的资产

根治不是推倒重来。以下安全不变量和经验证的 primitive 方向正确，应保留或抽取；具体实现仍需按新的运行指纹与评测边界复审：

- 产品状态由 Workbench / repository 持有；
- Work Node 隔离草稿；
- revision、hash 和 CAS；
- native approval capability；
- validate、diff 与 apply 前复验；
- Renderer、checkout、commit 和可见 UI postcondition；
- bounded typed knowledge；
- typed resource 与结构化错误；
- Interop trace；
- immutable Registry、promotion 和 rollback 原语；
- `origin/main` 新增的通用 Scenario verification evaluator；
- Spec 9 提出的证据边界和阶段编排方向；
- 审计分支九个修复意图中的确定性不变量。

这些是系统最难替代的部分。问题只在于它们尚未由可追踪的运行指纹、明确的领域合同和真实评测闭环连接起来。

## 六、最小目标架构

### 6.1 先建立 Runtime Provenance Gate

第一步不是保存并恢复所有历史可执行代码，而是让产品 session 与评测 release 都有最小、明确的运行指纹。

产品侧扩展现有 `.def-session.json`：

```text
ProductSessionBinding
  runtimeBuildId
  harnessRef
  toolCatalogHash
  skillTreeHash
  stateSchemaVersion
```

`runtimeBuildId` 是 DEF adapter、plugin、codec 与 Sidecar 运行产物的组合内容 hash，不是整个桌面应用的营销版本号。

恢复规则保持简单：

```text
current runtimeBuildId == session runtimeBuildId
  → 可以继续调用 Tool 或进入 mutation

runtime 不一致
  → STALE_RUNTIME
  → 历史只读可查看
  → 继续执行时要求迁移或新建 session
```

这避免了把旧 `def.js`、旧 Skill、旧 OpenCode build 和旧依赖永久打包运行。若未来确实要支持旧 runtime 执行，还必须先解决 retention、GC、安全撤销和 state migration；不能把第二套包管理器藏在“pinning”名下。

评测侧另建 `EvalReleaseManifest`，记录：

```text
commit / build artifact
runtimeBuildId
harnessRef
toolCatalogHash / skillTreeHash
modelId / provider config hash
evaluatorVersion
```

baseline 与 candidate 通过隔离 worktree、隔离构建产物或隔离进程运行。一次结论实际使用的知识来源，则记录在 Evidence 的 `sourceRevision` 中，不把整个知识索引永久钉在 session 上。

这能保证版本**可追踪、可归因**。远程模型服务和采样仍可能变化，因此不能承诺行为完全可复现。

### 6.2 先做一个 3+1 复合 typed tool

第一条纵切不建立通用 `Task Runtime`。直接增加一个高层、只读的能力：

```text
def_data_equipment_3plus1_recommend
```

模型只提交：

```text
operatorQuery
setQuery
userConstraints?
priorPlanDigest?
correction?
```

工具内部用普通 TypeScript 顺序调用现有领域函数，不让模型编排 Tool-to-Tool 调用：

```mermaid
flowchart LR
  O["Resolve operator"] --> G["Guide / profile"]
  G --> C["Bind catalog revision"]
  C --> S["Resolve named-set facts"]
  S --> P["Produce 3+1 plan"]
  P --> E["EvidenceEnvelope<EquipmentPlan>"]
```

在这条指定套装流程中，模型不再逐步选择 guide、profile、artifact、facts 和 planner。复合 Tool 的内部阶段不新增模型 export。已有原子 Tool 仍可能被其他流程使用，必须等全部消费者迁移后才能弃用，不能立即全局隐藏。

输出保持领域强类型：

```ts
type EvidenceEnvelope<T> = {
  contract: string
  state: 'READY' | 'NEEDS_INPUT' | 'UNRESOLVED'
  sourceRefs: SourceRef[]
  sourceRevisions: string[]
  completeness: 'complete' | 'partial'
  missing: MissingFact[]
  ambiguities: Ambiguity[]
  result: T
}
```

首个纵切必须覆盖反例矩阵，而不只覆盖 happy path：

- `GUIDE_FOUND / PARTIAL / NOT_FOUND`；
- 指定套装存在、歧义、缺失；
- stale artifact 或 catalog revision；
- 用户纠正后重新计算最早受影响输入；
- 全程只读，前后产品 state hash 不变。

完成武器适配、攻略团队等至少三个同构实现后，再判断是否值得抽取通用 `Task Contract`。在此之前，它只是一个清晰的领域合同，不是新的工作流框架。

### 6.3 建立规则唯一归属

| 规则类型 | 唯一拥有者 |
| --- | --- |
| DEF Tool 名、schema、scope、risk、handler、权限类别 | Tool Catalog |
| 何时绑定一种能力 | Intent resolver / task binder |
| 确定流程的顺序、分支、重试、失效传播 | 领域 typed tool；重复后才提炼 Orchestrator |
| 领域结果、来源、revision、缺失项 | Typed result + Evidence Envelope |
| 名词、别名、游戏事实 | Knowledge Index |
| readiness、command admission、command journal | 未来 Workbench lifecycle owner；独立 Finding 验证 |
| 授权、安全、Work Node、CAS、审批、postcondition | Permission / Mutation Gateway |
| 能力解释、识别示例、用户沟通 | 真实 Runtime Skill |
| 身份、语言、交互风格 | 极小 System Contract |
| 产品 stable/default 与发布版本 | Product release manifest |
| session 继续执行的运行指纹 | Product session binding |
| baseline/candidate 选择与行为评分 | Eval Harness / Scenario grader |

判断一条新经验放在哪里，只需要问：

```text
必须永远成立？      → 代码 / Tool Contract
描述确定步骤和状态？→ 领域代码
是事实或术语？      → Knowledge
帮助模型理解和解释？→ Runtime Skill
只是表达实验？      → teaching overlay candidate
```

Prompt 可以说明安全边界，却不能拥有或执行它。权限和 mutation 必须由代码 enforce。Skill 可以给出任务识别示例，却不能与 resolver 同时决定真实路由。

### 6.4 先建立最小 Tool Catalog

第一版不设计新的全量 codegen DSL。先为所有 **DEF-owned、model-visible Tool** 建立 canonical catalog：

```text
id
modelVisibleName
sidecarRoute
modelSchemaFingerprint
routeSchemaFingerprint
adapterMappingRef?
exposure: model | internal
risk / scope / permission class
handler binding
deprecatedAliases
```

CI 只做五类确定性检查：

- 每个 DEF model export 必须登记；
- Sidecar route 与 handler 必须存在；
- identity route 的 schema fingerprint 必须一致；非 identity route 必须有 adapter mapping contract test；
- internal continuation 不得暴露给模型；
- 所有模型可见文本与 JS prompt literal 中出现的 `def_*` token 都必须在 catalog 或 deprecated alias 中。

最后一项不能只扫描 Markdown 反引号。当前错误名 `def_team_loadout_plan` 就位于普通 JS system prompt 字符串中。

只有 schema parity 仍反复漂移时，再把 catalog 升级为生成源。Tool description 只说明“做什么、需要什么、返回什么”，不承担完整业务工作流。

### 6.5 先减少新增暴露，再考虑动态 Tool 子集

`origin/main` 已有 41 个模型可见 Tool。它们平铺在每轮上下文中，增加选择错误和 schema token。

第一版让新的 3+1 复合 Tool 直接调用领域函数，不把内部阶段继续导出给模型；已有原子 Tool 按消费者逐步迁移。mutation 继续使用现有权限边界。这样不需要假设 intent resolver 已经足够可靠。

Vendored OpenCode 的 permission 机制确实可以在 LLM 请求前移除被 deny 的 Tool schema；当前 DEF 配置尚未建立按任务的 deny/catalog。等 task binder 有独立评测后，再验证动态 Tool 子集。它是后续 token 与误选优化，不是第一阶段根治的前置条件。

### 6.6 Evidence 是强类型结果的信封

不要把所有领域事实压成 `factPath / value` 的 EAV 式通用 DTO。装备、武器、技能与团队计划继续保留自己的 typed result；统一层只包装：

- 来源与 revision；
- 完整或部分；
- 缺失项；
- 歧义与冲突；
- `READY / NEEDS_INPUT / UNRESOLVED` 状态。

`EvidenceEnvelope<T>` 本身不会阻止模型在自然语言中越界推断。首版把“回答不超出证据”作为可测目标：grader 对照 structured result 检查关键 claim；若某领域仍反复过度声称，再增加 claim validator 或确定性 formatter，而不是先发明万能 claim graph。

游戏知识可以继续扩张，但新增知识只增加 versioned typed evidence，不增加全局路由句子。

### 6.7 Harness V2 的职责要缩小

建议区分两个容易混淆的概念：

- Agent Runtime：让模型运行、选择 Tool、维护任务状态；
- Eval Harness：运行 trials、收集 trace、评分和比较版本。

当前八槽 Harness 不再把 routing、workflow、skills、knowledge 全部拼进 system。Harness V2 只需要：

- 选择一个 `EvalReleaseManifest`；
- 为 trial 记录完整运行指纹；
- 运行指定 Eval Suite；
- 保存 baseline/candidate trial；
- 生成 promotion / rejection / rollback decision。

如需测试提示词差异，只保留一个有尺寸限制、明确适用 task、不能修改权限的 `teachingOverlay`。一个 candidate 只验证一个因果假设；为实现同一假设而同时修改 schema、adapter、implementation 和测试是合法的。

## 七、正确的学习闭环

### 7.1 先形成 Finding，而不是先改 Prompt

```text
真实失败 trace
  → 结构化 Finding
  → 确定性复现，或随机 failure cluster
  → root-cause owner
  → 单一因果假设 candidate
  → 分层 Eval Suite
  → 人工 promotion / rejection
```

Finding 至少记录：

```text
taskId
traceRefs
failureClass
affectedStage
expectedOutcome
observedOutcome
reproductionCount
candidateOwner
```

### 7.2 修复分流

| Failure class | 处理方式 |
| --- | --- |
| 错误 schema、别名、状态、CAS、持久化 | 代码修复 + contract test |
| Tool 太低层、返回不完整、结果不可读 | Tool Contract / authoring API |
| 缺失游戏事实或来源 | Knowledge revision |
| 一个明确的多阶段业务流程 | 高层复合 typed tool |
| 三种以上重复的编排机制 | 再评估 Task Contract |
| 意图识别或任务解释错误 | Runtime Skill / resolver |
| 语言风格、简洁度 | teaching overlay |
| 测不出差异 | evaluator，不得同时声称 Agent 已改善 |

安全、schema、Tool 名和 producer/consumer 合同等确定性问题，一次 trace 加可重复 contract test 即可下沉到代码。随机行为需要多个独立 trial 形成同类失败，才能新增可泛化规则。

### 7.3 Eval 必须评价 outcome、trace 和质量

每个任务至少需要三类 grader：

1. Outcome：最终产品状态、Evidence 完整性、是否真正应用；
2. Trace：越权 Tool、必需安全阶段、重复调用、错误恢复；
3. Quality：答案是否回应用户、事实正确、取舍清楚。

不要把每个成功路径都写成唯一 Tool 名序列。安全和事务阶段可以严格；开放式只读任务优先检查 evidence obligations 和最终 outcome，允许等价的合法路径。

随机行为 Scenario 应运行多个 fresh-session trials，并报告成功率、延迟、Tool 次数和 token。确定性 schema、安全和纯函数合同仍用快速单次测试，不必把所有检查都变成昂贵 trial。

### 7.4 Candidate 与 Judge 必须分离

- Candidate 不得同时放宽自己的 grader；
- 未识别的 Scenario verification 字段必须 fail closed；已经声明却无人执行的字段应实现或删除；
- grader schema 变化必须单独版本化并重新建立 baseline；
- 原失败进入 FAIL_TO_PASS；
- 相邻能力进入 PASS_TO_PASS；
- mutation 进入 zero-change / stale-CAS / rejection safety；
- holdout 不进入 Worker prompt、Skill 或公开 trace；
- promotion 记录 `EvalReleaseManifest` 与运行指纹，而不是只记录 Harness 文本 hash。

## 八、两个分支应如何处理

### 8.1 不要直接整体合并

先冻结两个证据基线。Git 冲突不能替代架构选择，自动合并也不能证明组合后的 Agent 有效。

### 8.2 审计分支

以下九个提交应作为修复意图与证据清单：

```text
554779d f24688e f0abb53 271d9b0 08e20e1
2a84dfd 9ceaa75 f538c2d 703fae9
```

禁止机械 cherry-pick。`f24688e` 已被 `main@8bd5d3e` 部分覆盖，多个提交又修改了 `main` 已大幅重写的 Sidecar 或 CanvasBoard。应逐项比较当前实现，只移植仍缺失的不变量、postcondition 和确定性测试；攻略 manifest 与代码修复分开复验。

以下四个提交只应保留为 Finding 与失败 Scenario 的输入，不应原样并入全局 Prompt：

```text
fec0c8c 606e38a 6250232 7145142
```

它们分别应进入团队计划状态机、Tool name linter 和新的 timeline authoring contract。

### 8.3 `main`

应保留：

- deterministic planner / convention / evidence 能力；
- roster typed transition；
- `triggerActor` 等结构化触发合同；
- `DEF_EMPTY_ASSISTANT_RESPONSE` outcome guard；
- 通用 Scenario verification evaluator；
- 四个新增、两个强化的领域 Scenario；
- Spec 9 研究结论。

但 `b53686b`、`0985f5f`、`85b6dde` 和 `0ebffc4` 不同程度混合了 runtime、Prompt、Skill、Scenario 或 Judge；前三个还修改了 Harness 教学文本。不能把整批提交直接视作已验证的 candidate。迁移时应拆分代码合同、运行 guard 与教学文本，重复规则不得继续同步复制。

特别要移除 exact-skill 的训练题关键词硬编码，例如 `水龙卷 | 图腾 | 层`。正确根治是 resolver fail closed 和结构化 hit identity，而不是为见过的技能建立强制 turn policy。

## 九、迁移顺序

### 阶段 0：止血

不等新架构，先修五个已经证实的确定性缺陷，并各加一个合同测试：

1. 统一 equipment artifact producer 与 consumer 的文件数量合同；
2. exact-skill resolver 未命中时 fail closed；
3. 删除不存在的 `def_team_loadout_plan`，由 Tool catalog 检查所有模型可见字符串；
4. 合并 current-node 两条相反的 system instruction；
5. 删除 `水龙卷 | 图腾 | 层` 等训练题关键词硬编码。

同时禁止没有 Finding、唯一 owner 和 Scenario 的 prompt-only 补丁。紧急修复可以进入 Prompt，但必须留下这三项，并尽快迁移到权威层。

### 阶段 1：Runtime Provenance Gate

- 给 `.def-session.json` 增加最小运行指纹；
- 停止用当前仓库 `def.js` 覆盖既有 session workspace；
- runtime 不一致时允许历史只读，继续 Tool 或 mutation 则 `STALE_RUNTIME` fail closed；
- stable 指向明确 release manifest，不再由 fresh install 从可变源码隐式构建；
- specialized candidate 遇到跨 task turn 时先 fail closed 或显式重绑，随后删除静默切 stable；
- baseline/candidate 用隔离 worktree、构建产物或进程运行。

这一步的目标是可追踪、可归因，不是长期运行任意历史代码。

### 阶段 2：把评测真正接上 promotion

- 把 `origin/main` 的 24 个 Scenario 按 deterministic、native integration 和 desktop black-box 分 suite；
- 四个新增、两个强化的领域 Scenario 进入 FAIL_TO_PASS / PASS_TO_PASS；
- 未知 verification 字段 fail closed；
- 移除依赖 `candidate-v1` 字符串的假 F2P；
- 保存原始 Interop trace、trial 配置和 run artifact；
- evaluator 在 Worker 合同之外选择 suite，holdout 不向 candidate 暴露。

测试分三层：

1. PR 快速层：hermetic schema、catalog、producer/consumer、纯函数合同；
2. runtime integration 层：Sidecar、OpenCode、端口与 session lifecycle；
3. promotion / hosted 层：桌面黑盒、多个随机 trial、质量 grader。

不要把 Bun、Electron、实时端口等环境依赖测试全部塞进普通 headless CI。

### 阶段 3：迁移第一个只读纵切

首个纵切选择“指定套装的 3+1 配装”，实现为一个 `def_data_equipment_3plus1_recommend`：

```text
Resolve Operator
  → Build Authorized Profile
  → Bind Catalog Revision
  → Resolve Named Set Facts
  → Produce Ranked Plan
  → Evidence Ready / Minimal Question / Unresolved
```

选择它的原因：

- 已有真实失败和 Scenario；
- 同时覆盖 guide、profile、artifact、planner 与 correction；
- 结果可以完全只读；
- 不需要先改写最危险的 mutation gateway；
- 成功后可以删除一大段 Prompt、Skill 和 Harness 重复规则。

验收同时覆盖 guide 缺失、套装歧义、stale revision、correction 和 state unchanged。通过前只称为 3+1 领域合同，不宣称通用 Task Runtime 已成立。

### 阶段 4：证明可以删除规则

纵切完成的标准不是“新状态机能跑”，而是：

- 删除对应 `buildAgentPrompt()` 规则；
- 删除 Harness routing/workflow/tool-guidance 副本；
- Runtime Skill 只保留任务识别与用户解释；
- Tool description 只保留合同；
- 全部 Scenario 仍通过。

如果新架构只能新增文件，不能删除旧规则，它没有根治问题。

### 阶段 5：用重复实现决定是否抽象

建议顺序：

1. 不指定套装的 3+1；
2. 武器适配与 trigger reachability；
3. 精确技能 / hit facts；
4. source-only guide；
5. 攻略团队计划；
6. timeline authoring；
7. 最后接入 mutation。

Mutation 继续复用已有 Work Node、审批、CAS 与 postcondition，不重新设计安全底座。

至少完成 3+1、武器适配和攻略团队三个复合能力后，再比较它们是否真的共享：

- 相同的 stage lifecycle；
- correction 失效传播；
- retry / recovery；
- Evidence terminal state。

只有这些机制重复出现，才提炼 `Task Contract`。否则保留三个清晰的领域 typed tool，比维护一个通用 workflow framework 更便宜。

## 十、明确不做什么

- 不再建立一个更大的万能 Prompt；
- 不把所有自然语言任务都硬编码成状态机；
- 不先引入 LangGraph 或另一套通用 Agent framework；
- 不设计新的复杂 DSL；
- 不用 exact tool sequence 评价所有只读任务；
- 不在 evaluator 可信前做自动 Skill 改写或自动 promotion；
- 不让 Knowledge 承担流程，或让 Skill 承担安全；
- 不为单个技能名、攻略名或用户措辞继续增加代码关键词。

## 十一、最低成功门槛

### 11.1 成功门槛

架构根治是否成立，应由以下事实判断：

- 修改仓库 Skill 或 Tool 后，既有 session 不会继续执行新代码；runtime 不匹配会明确进入 `STALE_RUNTIME`；
- stable/candidate 不在同一 session 静默混用；
- 所有 DEF-owned model-visible Tool 都登记在唯一 catalog，未知名称与 schema 漂移在 CI 失败；
- 一个 candidate 只验证一个因果假设，并有一个权威 owner；
- 3+1 复合 Tool 的输入、typed result、Evidence 和 terminal state 可观测；
- 3+1 反例矩阵覆盖 guide、套装、revision 与 correction；
- 只读流程前后产品 state hash 相同；
- 用户纠正不会复用旧 plan digest 或过期证据；
- mutation 拒绝保持零变化，陈旧 revision/hash fail closed；
- promotion suite 运行真实领域任务、负例、安全例和 holdout；
- 随机行为有多个 fresh-session trials 和成功率；确定性合同有快速复现；
- 第一条纵切完成后，Prompt / Skill / Harness 总业务文本明显减少；
- 游戏知识增加时，不需要同步增加全局 routing 规则。

### 11.2 止损条件

出现以下任一情况就停止扩大架构，而不是继续补抽象：

- 运行指纹仍不能解释一次 trial 使用了哪套 Tool、Skill、Harness 和 evaluator：停止 candidate / promotion；
- 领域 Scenario 仍没有 trace、outcome 与 run artifact：不得声称训练有效；
- 3+1 复合 Tool 上线后不能删除对应全局教学文本：停止迁移，先查清重复 owner；
- 第二、第三个领域实现没有复用同一生命周期：不提炼通用 `Task Contract`；
- 新 Registry、adapter 与兼容层的维护量大于被删除规则：回退到领域 typed tool；
- runtime mismatch、安全撤销或 state migration 未定义：旧 session 只读，不允许静默继续执行。

## 十二、外部研究对照

本项目的本地证据与外部一手实践一致：

- [Anthropic 的 Agent 构建实践](https://www.anthropic.com/engineering/building-effective-agents)区分预定义 code path 的 workflow 与模型自主选择的 agent；明确流程适合 workflow，并建议从最简单、可组合的模式开始。它还记录过把相对路径问题修进 Tool 接口，而不是继续要求模型记住路径规则。
- [OpenAI Agents SDK 的编排指南](https://openai.github.io/openai-agents-js/guides/multi-agent/)指出 code orchestration 在速度、成本和表现上更确定、可预测，并建议通过 structured output 把模型判断交给代码检查。
- [Anthropic 的 Agent eval 指南](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)把 task、trial、grader、trace、outcome、suite 分开，并强调随机系统需要多次 trial，最终陈述不能替代环境 outcome。
- [OpenAI 的 evaluation flywheel](https://github.com/openai/openai-cookbook/blob/main/examples/evaluation/Building_resilient_prompts_using_an_evaluation_flywheel.md)要求先分析并聚类失败，再建立 dataset 和 grader，最后才做针对性改进，而不是 prompt-and-pray。
- [MCP Client Best Practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)指出 Tool 数量增长后，全量注入会增加 token、延迟并降低模型表现，应采用 progressive discovery 或受控调用。

## 十三、建议拆成两个后续规格

在用户分别提供正式标题、目标和范围后，先后处理：

> **DEF Runtime Provenance Gate**：停止 session 工具漂移，记录最小运行指纹，并让 stable/candidate 的真实领域回归可归因。

然后再处理：

> **3+1 Composite Typed Tool**：把一个已知多阶段流程收进代码，并删除对应的全局 Prompt、Skill 与 Harness 教学副本。

不要把两个主题合并成一次“Executable Task Runtime”大改。第一个解决评测可信度，第二个验证系统能否把一次经验压缩成更少、更明确、可执行、可删除旧规则的实现。
