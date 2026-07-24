# 篇章 11：Harness

前面已经给 Agent 接上了 Typed Tools（类型化工具）。它能读取当前队伍的数据CRUD（增删改查），也能调用二次计算。

一个更难的问题，假如用户说：“帮我给当前角色搭一套适合当前队伍的装备。”

这是一个数学问题（排列组合数），还是一个知识问题（最简单粗暴的就是把什么都告诉AI）。一个游戏领域大神是这么做的？

why -> how。推理->表达。

我的干员需要什么？哪些装备、武器满足？给出解法。

这是**Agent完成一项真实业务** ，我当然可以为此专门写Tools（专项工具然后路由），但这和只会读稿的**血狼破军**有什么区别？

各位做题家此时可能反应过来了，这和做数学题有什么区别？

一个问题 -> 选择数学公式 -> 逻辑穿起来 -> 给出结论

没毛病，可惜AI不是你，你思考问题的时候只会想到“我在做题”不会想到那些“你是谁”，“你是干嘛的”，“我是读稿的”。

所以**血狼破军**做不出攻略，他的上下文是读稿。

那我把**血狼破军**的上下文改成做攻略不就可以了吗?

那可完蛋了，你得改什么呀？

Prompt（提示词：**血狼破军**是上交985）、

Host Prompt（宿主提示词：**血狼破军**是B站百万粉丝up主）、

Skill（技能包：**血狼破军**只会读稿）、

Tool Description（工具说明：**血狼破军**只会读稿）、

审批逻辑、事务状态等（骗你的，根本没人管他）

我们调教**血狼破军**（这里类比AI）是多维度，这里就需要引入harness

## 什么是 Harness？

Harness 是**围绕**模型建立的运行机制。

<div class="capability-strip" role="img" aria-label="模型、Harness 与真实环境的关系">
  <div><small>决定下一步</small><strong>模型</strong></div>
  <b>→</b>
  <div class="accent"><small>组织并约束执行</small><strong>Harness 系统</strong></div>
  <b>→</b>
  <div><small>产生真实结果</small><strong>Tools + 产品</strong></div>
</div>

不是单独一份 Prompt，也不是一组 Tools。它描述的是模型在什么信息和能力条件下工作，以及模型输出怎样被系统接收、执行、拒绝、记录和反馈。

这简直是**调教**。

我调教血狼破军吗？那太好了

Harness最窄的说法只包括 System Prompt（系统提示词）和 Tool Loop（工具循环）；

更宽的说法会把 Context（上下文）、Memory（记忆）、Skills（技能包）、状态、权限、沙箱、审批和结果检查都算进去。

不同文章使用同一个词时，谈论的可能不是完全相同的系统范围。

Harness直译是**控制**，工程化的问题，讲起来没有**调教**这么变态，

同一个模型接上不同 Harness，会表现得像不同的 Agent。差别不一定来自模型更聪明，而可能来自上下文、能力边界、状态、反馈和完成条件完全不同。

## 广义 Harness 会指什么？

Harness 没有一条被所有框架共同采用的边界。

从系统角度看，广义 Harness 可以理解为模型与外部环境之间的**运行支架**。它组织模型怎样获得信息、提出行动、接收反馈、延续状态，并把行动连接到真实执行。[AI Harness Engineering（AI Harness 工程）](https://arxiv.org/abs/2605.13357) 进一步把 Agent 能力放在“模型—Harness—环境”这个整体中讨论，而不是只归因于模型本身。

下文用 **Harness 系统**指这套完整运行环境；**业务 Harness** 指其中一类完整领域问题的责任边界，**业务 Harness 版本**则保存该边界内某次发布的具体方法与执行合同。

## Harness 和 Tools、Workflow 的关系

Tools、Workflow 和 Harness 经常一起出现，但它们回答的是三种不同问题：一个动作怎样执行、哪些控制关系必须固定，以及一类完整业务怎样处理。

| 名词 | 它定义什么 | 是否预先规定路径 | 配装例子 |
| --- | --- | --- | --- |
| Typed Tool（类型化工具） | 一个动作的输入输出 Schema（结构定义）与错误语义；前置条件、权限和副作用约束由 Guardrail（护栏）或执行层绑定 | 不定义完整业务路径 | 读取当前装备、应用配装方案 |
| Workflow（工作流） | 预先编码的控制拓扑，包括顺序、条件分支、循环、并行、重试和结束条件 | 规定全部或部分控制路径 | 用户确认后应用方案，再重新读取 |
| 业务 Harness | 一类完整业务的目标、求解方法、知识、能力边界和完成条件 | 可以引用 Workflow，也可以让模型动态选择 | 从理解配装目标到验证真实结果 |

<div class="article-diagram relation-diagram" role="img" aria-label="配装 Harness、Tools 与 Workflow 的关系">
  <div class="diagram-heading"><small>RELATION</small><strong>一项配装业务怎样使用能力</strong></div>
  <div class="relation-root">
    <small>业务 HARNESS</small>
    <strong>定义一类配装问题的完整处理责任</strong>
    <span>目标 · 方法 · 知识 · 边界 · 完成条件</span>
  </div>
  <div class="relation-runtime"><span>由运行时加载并执行</span><i>↓</i></div>
  <div class="relation-branches">
    <div>
      <small>TYPED TOOLS</small>
      <strong>可以调用的动作</strong>
      <span>读取当前装备</span>
      <span>查询装备数据</span>
      <span>比较计算结果</span>
      <span>应用配装方案</span>
    </div>
    <div>
      <small>WORKFLOW</small>
      <strong>预先编码的控制关系</strong>
      <span>用户确认</span>
      <i>→</i>
      <span>应用方案</span>
      <i>→</i>
      <span>重新读取</span>
    </div>
  </div>
</div>

同一个 Tool 可以被多个业务 Harness 使用；业务 Harness 只在顺序必须固定时引用 Workflow，其余步骤仍可由模型根据当前情况选择。[LangGraph：Workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)

在本项目的责任划分中，跨 Tool 的领域求解方法由业务 Harness 版本拥有；需要确定性保证的控制关系，则由 Workflow、Runtime Guard（运行时守卫）或 Tool Contract（工具合同）落实。

Tool 与 Workflow 的边界清楚以后，还要区分另一组容易混淆的东西：提供可复用材料的 Skill，与负责完整业务的 Harness。

## Harness 和 Skills 的关系

Skill 和业务 Harness 都可能包含领域知识和做法，因此最容易被混为一谈。关键区别不在内容长短，而在它们是否承担一类完整业务的声明职责。

| 对比 | Skill | 业务 Harness 版本 |
| --- | --- | --- |
| 核心用途 | 提供可复用的方法说明、脚本、模板或其他资源 | 声明一类完整领域问题怎样处理 |
| 加载方式 | 可被检索、显式加载或由宿主要求读取 | 由运行时按业务事务选择并固定版本 |
| 对模型的作用 | 提供知识和操作方法 | 同时规定目标、知识角色、工具策略、阶段策略和完成条件 |
| 状态职责 | 通常不是业务状态的权威来源 | 声明需要什么状态，由事务存储保存 |
| 执行能力 | 资源是否可执行取决于 Tool、运行时或沙箱 | 通过运行时与 Tools 接入真实执行 |
| 强制能力 | 方法说明本身不能保证模型服从 | 求解方法同样不能保证服从；硬边界由程序强制 |

“Skill 非强制”不是说宿主不能强制加载 Skill，也不是说 Skill 只能包含文字。关键在于：**被加载不等于其中的方法已经被执行**。自然语言方法仍然只是模型决策的输入；即使 Skill 附带脚本，脚本能够执行也是因为运行时、Tool 或沙箱提供了执行能力。

因此，Skill 适合提供“通常应该怎样做”；“绝对不允许发生什么”仍然必须落在 Tool、权限、审批和产品代码中。业务 Harness 可以引用 Skills，但不能把硬边界寄托在 Skill 的服从率上。

可跨业务复用的方法材料可以封装成 Skill；某项业务采用哪套方法、采用哪个版本以及何时失效，仍由业务 Harness 版本负责。接下来再看，一次具体工作需要的信息从哪里来，又由谁组装。

## Harness 和 Context 的关系

一次配装同时依赖真实产品状态、攻略、业务事务和对话历史，它们并不来自同一个地方。

Context 不是一个单独的存储位置，而是“当前代码或模型在这一刻可以使用哪些信息”的统称。讨论 Context 时，必须先说明这些信息来自哪里、保存多久、由谁使用，以及模型能不能看到。

OpenAI Agents SDK 区分本地运行上下文（Local Run Context）与模型可见上下文（Model-visible Context）：前者供 Tools、Hooks（钩子）和应用代码使用，后者才会进入模型请求。对话历史可以由 Session（会话记忆）管理；一次配装进行到哪里，则仍要由项目自己的业务事务保存。[OpenAI Agents SDK：Context management](https://openai.github.io/openai-agents-python/context/)

<div class="article-diagram context-diagram" role="img" aria-label="事实、业务事务和会话怎样被运行时组装成本地上下文与模型可见上下文">
  <div class="diagram-heading"><small>CONTEXT FLOW</small><strong>信息从哪里来，最后给谁使用</strong></div>
  <div class="context-flow">
    <div class="context-sources">
      <small>模型调用之外保存的信息</small>
      <span><b>权威事实源</b>当前装备、装备数据、公式及其版本</span>
      <span><b>带来源和条件的领域知识</b>攻略原文或检索片段</span>
      <span><b>业务事务存储</b>目标、待确认方案、确认状态、Harness 版本</span>
      <span><b>会话记忆</b>对话、Tool 调用与 Tool 结果历史</span>
    </div>
    <i class="diagram-arrow">→</i>
    <div class="context-runtime">
      <small>HARNESS 运行时</small>
      <strong>绑定 · 选择 · 压缩 · 刷新</strong>
      <span>决定当前阶段真正需要什么</span>
    </div>
    <i class="diagram-arrow">→</i>
    <div class="context-outputs">
      <span><b>本地运行上下文</b>身份、权限、事务引用、写入范围<br><em>只供代码使用</em></span>
      <span><b>模型可见上下文</b>当前目标、必要事实、对话片段、可用 Tools<br><em>进入本次模型调用</em></span>
    </div>
  </div>
  <div class="diagram-feedback"><b>Tool 结果</b><i>→</i><span>成为新的读取证据；有副作用时更新产品状态或业务事务</span><i>→</i><b>运行时重新组装</b></div>
</div>

以配装为例，当前装备必须来自真实产品状态，装备数值必须来自装备数据目录，策略建议可以来自带适用条件的攻略，计算结果必须来自公式引擎。业务 Harness 声明需要哪些信息；运行时负责选择和组装；事实源与事务存储负责保存。

信息被选出来以后，Runtime 还要决定哪些进入模型可见请求、哪些只留在代码侧。Prompt 与 Instructions（指令）只是模型可见请求的一部分；身份、权限和验证状态仍属于本地运行上下文。

## Harness 和 Prompts 的关系

Prompt 经常同时指可以独立编写和版本化的 Prompt Template（提示词模板），以及某次调用最终发送给模型的内容。两者必须分开。

Prompt 模板和指令（Instructions）是模型侧的重要行为控制资产。它们可以定义目标、角色、概念、方法、示例和表达要求，也可以通过消息角色建立指令优先级。但这种模型侧权威仍然不能替代代码侧权限：模型即使收到“不得越权”的高优先级指令，执行层仍要对真实 Tool 调用再做检查。

| 层次 / 对象 | 是什么 | 生命周期 | 主要作用 | 能否直接阻止副作用 |
| --- | --- | --- | --- | --- |
| Prompt 模板 | 可复用、可版本化的内容模板 | 跨多次调用 | 保存角色、概念、方法、示例和表达要求 | 不能 |
| 指令（Instructions） | 本次 Agent 运行提供给模型的高优先级指令 | 静态或动态生成 | 建立模型侧目标与指令权威 | 不能单独保证 |
| 最终模型请求（Final Model Request） | 本次模型调用的消息输入、可见 Tool Schema（工具结构定义）、Tool 结果和证据 | 一次模型调用 | 为模型形成当前工作视图 | 不能 |
| 运行时硬边界 | 权限、审批、Tool 可见性、版本一致性、写入范围和后置检查 | 完整业务过程 | 在代码侧允许、拒绝、保存和验证 | 可以在覆盖范围内阻止 |

这些对象也不是四选一：Instructions 可以由 Prompt Template 生成，再与对话、证据和可见 Tool Schema（工具结构定义）一起进入 Final Model Request；运行时合同仍然留在代码侧。

在本项目中，Prompt Template、Skill 和 Tool Policy（工具策略）可以独立维护，但业务 Harness 版本必须固定它们的具体版本或内容摘要。业务事务固定一个 Harness 版本，也就固定了这次工作依赖的行为资产；若领域知识允许读取最新版本，待确认方案则要记录实际证据版本，并在确认前重新检查是否过期。

反过来，权限、审批、版本一致性、写入范围和后置条件并不依赖模型输入是否完整，而应由运行时、Tool 和产品代码强制执行。

到这里，模型侧输入与代码侧约束已经分开。下面回到本项目：哪些规则应当强制，哪些规则只能作为求解方法交给模型？

## 本项目 Harness 的特性

本项目最重要的设计，不是把更多规则改名叫 Harness，而是把两类性质完全不同的规则分开。

第一类是**求解方法**：通常先看什么、需要哪些知识、怎样比较候选、什么时候追问。业务 Harness 版本把它作为强参考交给模型。第二类是本文概括可执行约束的项目术语——**硬边界**：权限、审批、状态不变量、写入范围和后置验证。这些必须落实为 Workflow、Runtime Guard（运行时守卫）、Tool Contract（工具合同）或产品代码，而不能只写给模型看。

“强参考”不是随便看看。业务 Harness 版本可以要求模型交付符合 Output Schema（输出结构）的候选装备组合、待确认配装方案和证据；这是可以验证的输出合同。系统可以检查模型交出了什么，却不能据此证明模型内部采用了唯一的推理路径。

本项目的业务 Harness 还需要具备四个特性：

1. **面向完整业务问题**：它负责的是配装、排轴这类可以独立完成的用户目标，不是某个 Tool 或某个实体；
2. **由业务事务承载**：目标、用户限制、证据、候选、当前阶段和 Harness 版本不能只存在于聊天记录；
3. **以真实结果结束**：模型说“已经完成”不是完成，产品状态满足后置条件才是完成；
4. **可以独立迭代**：修改配装方法，不需要同时重新发布选人、排轴、BUFF 和计算。

### 为什么不能强制？

本项目不把整套**问题求解方法**实现成唯一强制路径。方法中可观察且必须保证的部分，仍然会抽成 Workflow、运行时前置条件、Output Schema（输出结构）和 Validator（验证器）；模型保留的是在这些合同之间分析、追问、取证和重新规划的空间。

第一个原因是，真实用户的表达经常不完整。用户说“这几件装备怎样组合更合适”，可能只想了解搭配原则，也可能想比较几套方案，或者已经准备应用其中一套。系统必须根据对话和当前状态追问、解释或行动。

第二个原因是，同一业务可以有多条合理路径。目标清楚时可以直接读取证据；目标含糊时应先追问；用户只比较两套方案时不需要进入写入阶段；某个 Tool 失败后还可能需要换一个证据来源。

第三个原因是，模型的内部推理并不是运行时可以逐句检查的程序。把自然语言方法伪装成强制状态机，只会让系统在例外情况中变得僵硬。

<div class="article-diagram dual-track-diagram" role="img" aria-label="配装求解方法可以灵活调整，但所有真实副作用都必须通过硬边界">
  <div class="diagram-heading"><small>METHOD × CONTRACT</small><strong>方法可以变化，产生真实后果的边界必须通过</strong></div>
  <div class="diagram-track flexible">
    <div class="track-label"><small>求解方法</small><strong>强参考</strong><span>允许跳过、返回和重新规划</span></div>
    <div class="track-nodes">
      <span>理解目标</span><i>↔</i><span>查看当前装备</span><i>↔</i><span>查知识与计算</span><i>↔</i><span>比较装备组合</span><i>↔</i><span>追问或解释</span>
    </div>
  </div>
  <div class="diagram-track enforced">
    <div class="track-label"><small>运行时硬边界</small><strong>程序强制</strong><span>任何真实副作用都不能绕过</span></div>
    <div class="contract-flow">
      <div class="contract-phase">
        <small>写入前硬检查</small>
        <div class="contract-nodes"><span>模型提出写入</span><i>→</i><span>Tool 与参数允许？</span><i>→</i><span>用户确认有效？</span><i>→</i><span>方案与产品版本仍有效？</span><i>→</i><span>写入范围允许？</span></div>
      </div>
      <i class="contract-down">↓</i>
      <div class="contract-phase">
        <small>执行与完成验证</small>
        <div class="contract-nodes"><span>执行写入</span><i>→</i><span>重新读取产品状态</span><i>→</i><span>与确认方案一致？</span></div>
      </div>
    </div>
  </div>
</div>

一句话概括：**程序强制执行边界，并检查可观察的证据状态和操作结果；求解方法作为强参考，保留模型在边界内的判断空间。**

程序可以检查证据是否存在、来源和版本是否正确，也可以验证产品状态是否满足确定的后置条件；证据是否足以支持某个复杂判断，仍可能需要模型评估、领域评测或人工复核。

谁把方法、状态和硬边界落实到一次具体工作中？这就是 Runtime 的职责。

## Runtime 在整个 Agent 中扮演什么角色？它和 Harness 是什么关系？

单次模型调用只会产生一次输出。要让一项业务跨越多次模型调用、Tool 执行、用户确认和状态变化，需要一段持续协调这些过程的程序。本文把这段应用层程序称为 Harness 运行时。

业务 Harness 版本是一份声明；Harness Runtime（Harness 运行时）是解释并执行这份声明的应用层程序。

OpenAI Agents SDK 提供模型与 Tool 之间的基础运行循环、对话记忆和审批恢复；项目自己的 Harness Runtime 再叠加业务事务、版本固定、Tool Policy（工具策略）和领域完成验证。[OpenAI Agents SDK：Running agents](https://openai.github.io/openai-agents-python/running_agents/)

<div class="article-diagram runtime-diagram" role="img" aria-label="业务 Harness 版本如何由运行时变成一次可以暂停恢复并验证结果的配装任务">
  <div class="diagram-heading"><small>HARNESS RUNTIME</small><strong>声明怎样变成一次真实业务过程</strong></div>
  <div class="runtime-layout">
    <div class="runtime-input">
      <small>业务 HARNESS 版本</small>
      <strong>声明这类配装怎样处理</strong>
      <span>目标</span><span>求解方法</span><span>所需知识</span><span>可用能力</span><span>完成条件</span>
    </div>
    <i class="diagram-arrow">→</i>
    <div class="runtime-core">
      <small>HARNESS 运行时</small>
      <span>创建或恢复本次配装任务</span>
      <i>↓</i>
      <span>组装本轮信息与可用 Tools</span>
      <i>↓</i>
      <span>模型提出下一步</span>
      <i>↓</i>
      <span>检查 Tool、参数、权限、审批与版本</span>
      <i>↓</i>
      <span>执行 Tool，并把结果交回模型继续判断</span>
      <i>↓</i>
      <span>保存进度、等待确认或继续处理</span>
    </div>
    <i class="diagram-arrow">→</i>
    <div class="runtime-output">
      <small>真实产品</small>
      <strong>重新读取并验证</strong>
      <span>符合确认方案<br><b>完成</b></span>
      <span>不符合或状态已变<br><b>进入恢复或重新规划</b></span>
    </div>
  </div>
  <div class="runtime-state"><b>业务事务保存</b><span>Harness 版本</span><span>产品版本</span><span>待确认方案</span><span>用户确认</span><span>当前阶段</span></div>
</div>

业务 Harness 版本声明 Completion Contract（完成合同）；Runtime 在关键结束点调用 Validator（验证器），根据重新读取的真实状态判定是否完成。运行时还要留下**执行轨迹（Execution Trace，后文简称 Trace）**，记录 Harness 版本及其固定的 Prompt、Skill、Tool Policy 版本、当时的产品状态、Tool 调用、用户确认，以及 Validator 使用的证据与结论。Trace 不负责判定完成，它负责保存判定过程。

有了执行机制以后，再看为什么垂直领域值得把这类业务方法长期建模。

## 典型的垂直领域 Harness

这种区分在所有 Agent 中都有意义，但在问题类型和业务对象相对稳定的垂直领域里，它尤其值得单独建模。

### 1、垂直领域的特性：解决实际问题

垂直领域 Agent 与通用 Agent 的区别，不在于谁能不能解决真实问题，也不在于谁的 Tool 副作用更强。通用编码 Agent 同样可以修改文件、执行命令和验证测试。

真正的区别是：垂直领域面对的是一组相对稳定、可以提前建模的问题。领域对象、事实来源、写入范围、求解方法和完成条件可以沉淀成长期合同，而不是每次都由用户临时说明。

| 对比 | 通用 Agent | 垂直领域 Agent |
| --- | --- | --- |
| 问题范围 | 面对开放任务，问题结构多由用户临时提供 | 面对相对稳定的领域问题集合 |
| 领域模型 | 通常按任务临时建立 | 可以预先定义对象、关系、术语和不变量 |
| 事实来源 | 根据任务临时连接文件、网页、代码或服务 | 可以提前规定每类事实的权威来源 |
| Tools | 强调跨任务复用的通用能力 | 强调领域 Schema（结构定义）、语义写入范围和业务前置条件 |
| 完成条件 | 每个任务临时确定，可能依靠测试、文件或用户判断 | 可以沉淀稳定的领域后置条件和验证规则 |
| 安全边界 | 同样需要权限、审批、沙箱和副作用控制 | 在通用安全边界上增加领域级写入与状态约束 |
| 迭代重点 | 模型、通用能力、路由和任务适应性 | 领域知识、求解方法、业务事务、版本与领域评测 |

这张表描述的是工程重心，不是绝对分类。成熟的通用 Agent 也可以沉淀领域模型和稳定合同；垂直领域只是更适合提前把它们做成产品能力。

Multi-agent（多 Agent）解决的是执行者怎样分工；垂直领域的业务 Harness 解决的是业务责任怎样定义。一个业务 Harness 可以由一个 Agent 执行，也可以由多个 Agent 协作执行。增加 Agent 数量不会自动补齐缺失的领域建模。

### 2、以本项目为例

继续看“帮我给当前角色搭一套适合当前队伍的装备”。

几件装备放在一起，只是**装备组合**；当它绑定目标角色、用户限制、选择理由，以及形成方案时读取到的当前配装，才成为一份可以交给用户确认的**待确认配装方案**。这份 Proposal（待确认方案）不是一段聊天文字，而是需要持久化的业务对象：它记录产品状态快照和实际证据版本，供确认前判断方案是否已经过期。完整的配装业务要处理它的形成、确认、应用和验证。

<div class="article-diagram business-flow-diagram" role="img" aria-label="一次装备搭配业务可以解释、追问、推荐、确认、应用或重新规划">
  <div class="diagram-heading"><small>BUSINESS FLOW</small><strong>一项装备搭配业务实际怎样分支</strong></div>
  <div class="flow-step start"><small>用户请求</small><strong>给当前角色搭一套装备</strong></div>
  <i class="diagram-down">↓</i>
  <div class="flow-decision">
    <strong>用户只是询问搭配原理？</strong>
    <div><span class="branch-stop"><b>是</b>解释组合规则后结束，不写入</span><span><b>否</b>继续形成具体方案</span></div>
  </div>
  <i class="diagram-down">↓</i>
  <div class="flow-decision">
    <strong>目标角色、队伍条件和搭配目标清楚吗？</strong>
    <div><span class="branch-loop"><b>否</b>追问，补齐目标与限制</span><span><b>是</b>读取当前装备与必要知识</span></div>
  </div>
  <i class="diagram-down">↓</i>
  <div class="flow-build">
    <small>按当前任务需要读取</small>
    <span>当前装备</span><span>装备数据</span><span>必要时：适用攻略</span><span>必要时：公式计算</span>
    <b>↓</b>
    <strong>候选装备组合 → 待确认配装方案</strong>
  </div>
  <i class="diagram-down">↓</i>
  <div class="flow-decision">
    <strong>用户确认应用这套方案吗？</strong>
    <div><span class="branch-loop"><b>否</b>修改候选、保留建议或结束</span><span><b>是</b>进入写入前检查</span></div>
  </div>
  <i class="diagram-down">↓</i>
  <div class="flow-decision">
    <strong>等待确认期间，真实配装发生过变化吗？</strong>
    <div><span class="branch-loop"><b>是</b>旧方案过期，重新读取和规划</span><span><b>否</b>应用方案并重新读取页面</span></div>
  </div>
  <i class="diagram-down">↓</i>
  <div class="flow-finish"><span><b>不一致</b>报告失败、恢复或重新规划</span><strong>真实页面与确认方案一致</strong><span><b>一致</b>留下证据并完成</span></div>
</div>

这张图描述的是不能丢失的业务责任，不是模型必须逐句遵循的思考顺序。目标要被理解，事实要有来源，候选要完整，修改要确认，写入要受限，结果要验证；具体路径则可以根据用户意图和当前状态改变。

同一条业务链也可以用于审计：这次使用了哪些证据、形成了哪份待确认方案、用户确认了什么、写入是否被允许、最终产品状态怎样证明完成。

### 3、引入问题求解方法 PSM

上面的完整业务链中，还有一层没有正式命名：一类问题通常怎样组织知识、分析输入并形成结果。知识工程为这一层提供了一个成熟概念。

知识工程把“一类任务通常怎样使用领域知识得到结果”称为**问题求解方法（Problem-Solving Method，PSM）**。它是一种知识层的建模概念，用来分开任务、求解方法和领域知识，并说明某类知识在不同推理步骤中扮演什么角色。[知识工程对 PSM 的介绍](https://www.cs.vu.nl/~guus/papers/Schreiber07a.pdf)

这个概念对垂直领域 Agent 很有帮助，因为它提醒我们：配装不是一串 Tool 调用，而是一类可以反复出现的问题；攻略和装备数据也不是方法本身，而是方法在求解过程中使用的领域知识。

这里只借用几个概念解释方法层，不把知识工程与现代 Agent 工程强行逐项等价：

| 知识工程概念 | 中文 | 在本项目中帮助解释什么 |
| --- | --- | --- |
| Task / Task Model | 任务 / 任务模型 | 一类领域问题负责什么 |
| Problem Instance | 问题实例 | 本次具体目标、输入和限制；业务事务还会增加运行状态 |
| Problem-Solving Method | 问题求解方法 | 这类问题通常怎样使用知识形成结果 |
| Domain Knowledge | 领域知识 | 求解方法使用的游戏事实、攻略、装备数据目录和公式 |

PSM 解释的是业务 Harness 中的方法层：一类问题怎样组织知识并形成结果。Harness 系统还要把方法连接到模型、Context、Tools、状态与真实环境，因此 PSM 是理论参照，不是 Harness 的替代名称。

PSM 可以描述任务分解、知识角色和控制结构；这些结构是否由 Workflow 或程序严格执行，取决于具体实现。本项目只是不强制模型采用唯一的内部推理路径。

方法已经有了理论名字，但方法仍然需要领域知识才能得到具体结论。

## 垂直领域的知识（游戏知识）

### 1、游戏知识和 Harness 的关系

求解方法规定怎样使用知识，却不等于知识本身。一次配装同时使用跨任务复用的领域知识，以及只属于本次工作的产品状态与用户选择；它们都会进入求解，但权威来源和生命周期不同。

| 信息 | 权威来源 | 在业务中的角色 |
| --- | --- | --- |
| 当前队伍、配装、排轴与 BUFF | 当前打开的方案和真实产品页面 | 这次问题的真实起点 |
| 武器、装备、技能和 BUFF 数值 | 装备数据目录 | 可核对的游戏事实 |
| 角色定位、配装建议和适用场景 | 带来源与条件的攻略知识 | 候选生成与解释依据 |
| 战斗约定和统计口径 | 用户条件、项目约定 | 约束比较范围 |
| 伤害与统计结果 | 公式和计算引擎 | 可复现的计算证据 |
| 历史选择与用户修正 | 业务事务（Business Transaction） | 本次业务的决策上下文 |

业务 Harness 版本要声明当前问题需要哪些知识、从哪里读取、适用条件怎样记录、哪些内容交给模型，以及状态或知识变化后旧结论是否仍然有效。它不复制装备数据库，也不把某篇攻略的当前结论永久写进流程；否则数据变化和方法变化会纠缠在一起。

待确认方案还要记录实际使用的攻略、数据与公式版本，确认之前才能判断原结论是否已经过期。

模型可以负责解释，事实仍要回到各自来源：当前状态由产品读取，游戏数值来自装备数据目录，策略结论保留来源和条件，写入成功由真实页面证明。文字负责把证据讲明白，不能替代证据本身。

知识、方法和执行规则都会变化。真正需要解决的不是把它们全部写进 Prompt，而是让每种变化回到自己的归属位置。

### 2、问题：写死 Prompts？实际遇到的迭代问题

项目早期把规则直接写进 Prompt，是最快也最合理的做法。流程还没有稳定时，一段文字就能迅速验证模型是否理解业务。

问题出现在规则不断增长以后。

同一项业务决定可能同时写进固定 Prompt、宿主提示词、总 Skill、工具说明、运行时和产品代码。这时问题已经不是 Prompt 太长，而是**同一个业务决定有多个主人**。

<div class="article-diagram ownership-diagram" role="img" aria-label="应用配装前必须确认这条规则，从多个重复副本重构为不同层次各自负责">
  <div class="diagram-heading"><small>BEFORE × AFTER</small><strong>“应用配装前必须确认”应该由谁负责</strong></div>
  <div class="ownership-columns">
    <div class="ownership-before">
      <small>重构以前 · 一句话复制多遍</small>
      <strong>多个副本，彼此可能冲突</strong>
      <div><span>固定 Prompt</span><span>宿主提示词</span><span>总 Skill</span><span>Tool 说明</span><span>运行时</span><span>产品代码</span></div>
    </div>
    <i class="diagram-arrow">→</i>
    <div class="ownership-after">
      <small>重构以后 · 不同责任各有主人</small>
      <span><b>业务 Harness</b>声明什么时候需要确认</span>
      <span><b>业务事务</b>保存确认的是哪套方案及其产品版本</span>
      <span><b>运行时</b>检查确认是否存在、方案是否仍然有效</span>
      <span><b>Tool / 产品</b>无有效确认时拒绝真实写入</span>
      <span><b>执行轨迹</b>记录确认、检查、写入与验证</span>
    </div>
  </div>
</div>

开发者关心的是“应用配装前是否真的确认”，这项行为的实现却分散在 Prompt、Skill、Tool 和运行时等位置。[Harness Handbook（Harness 手册）](https://ruhan-wang.github.io/Harness-Handbook/#one-behavior-many-implementation-sites) 所说的行为与实现之间的断层，就是从一个可观察的行为出发，却找不到唯一对应的实现位置。

重构不是把一句规则换个地方再复制，而是把说明、状态、强制执行和证据分别放回正确位置。单一主人也不等于只检查一次：Runtime 与 Tool 可以同时防御，但确认规则的业务含义和版本必须只有一个权威来源，其他检查从它派生或引用。文件树仍然告诉我们代码放在哪里；业务 Harness 与执行轨迹则让人能够从一项行为找到这些实现怎样共同工作。

### 3、Typed Tools 完成之后，迭代的是什么？

Typed Tools 稳定以后，项目并不会停止变化。只是变化的中心从“Agent 有没有能力”转向了“Agent 怎样使用这些能力解决业务”。

| 发生了什么变化 | 应该修改哪里 | 不应该主要修改哪里 |
| --- | --- | --- |
| 产品新增一种读取或写入能力 | Typed Tool 与产品接口 | 全局 Prompt |
| Tool 参数、返回值或错误合同变化 | Tool 参数结构 / Tool 实现 | 业务攻略 |
| 游戏数据或公式变化 | 装备数据目录 / 公式引擎 | 业务 Harness 的求解方法 |
| 攻略结论和适用条件变化 | 领域知识（Domain Knowledge） | 工具说明 |
| 一类业务通常怎样分析、追问和形成候选 | 业务 Harness 版本 | 固定 Agent Prompt |
| 宿主会话、事务、阶段和版本怎样运行 | Harness 运行时 | Skill |
| 权限、审批、版本一致性或写入范围变化 | Harness 运行时 / 产品执行层 | Prompt 中的警告 |
| 怎样判断系统是否做对 | 完成合同、Validator（验证器）、合同测试与真实界面（UI）验证；Trace 保存证据和结论 | 运行时教学 |

Tool Contract 发生不兼容变化时，通常还要发布新的 Tool Schema（工具结构定义）版本，并更新 Harness Revision 的引用，或者提供兼容适配器。

Prompt 当然仍然会独立迭代。需要改变的是：不再把所有业务规则都塞进一份全局 Prompt。Prompt Template（提示词模板）和 Instructions（指令）继续作为可版本化来源；运行时再结合当前 Harness 版本、事务状态、可见 Tool Schema、对话历史和事实证据，组装本轮 Final Model Request（最终模型请求）。

只有把变化放回正确的归属处，系统才能回答两个重要问题：

- 这次行为为什么变了？
- 我只改配装，会不会意外改变选人、排轴或 BUFF？

## 拆解业务 → 建模：从方法走向可迭代体系

当一类业务已经拥有自己的定义、方法、状态和验证以后，下一个问题才是：这些业务单元的边界应该画在哪里？

### 1、迭代与管理

发布配装方法 V2 时，已经按 V1 开始并等待用户确认的任务不能在中途静默换版。要让方法可以迭代、进行中的任务又保持一致，至少要分清三种记录。

| 记录 | 稳定性 | 负责什么 | 例子 |
| --- | --- | --- | --- |
| 业务定义（Business Definition） | 相对稳定 | 稳定业务身份、完整责任、支持动作类型，以及最大的 Tool 与写入边界 | 配装可以改装备，不能改队伍成员 |
| 业务 Harness 版本（Business Harness Revision） | 单个版本不可变；通过发布新版本持续迭代 | 具体求解方法、阶段、知识入口、Tool Allowlist（工具允许列表）、Tool Policy（工具策略）、异常处理、完成验证规则和表达要求 | 配装 V1、V2 |
| 业务事务实例（Business Transaction） | 每次工作独立产生 | 目标、限制、当前阶段、证据、待确认方案、审批、产品版本和固定的 Harness Revision | 正在为当前角色准备一套配装 |

这三者对应三个不同问题：

- 这项业务究竟负责什么？
- 当前发布的方法是什么？
- 这一次具体工作进行到哪里？

单个 Revision 还必须固定它引用的 Prompt、Skill 和 Tool Policy 的版本或内容摘要；Transaction 固定 Revision，才不会在运行途中悄悄换掉其中一项行为资产。

这里的“业务事务”就是一次可以跨回合暂停和恢复的业务任务。它通过持久化状态跨回合推进，不是数据库事务，也不具备数据库事务的 ACID（原子性、一致性、隔离性和持久性）语义。副作用不会自动回滚；重试、补偿和重新规划都必须显式定义。

<div class="article-diagram version-timeline-diagram" role="img" aria-label="配装 Harness 发布并启用新版本以后，已经开始的任务继续使用原版本，新任务使用新版本">
  <div class="diagram-heading"><small>VERSION TIMELINE</small><strong>发布新方法，不会偷偷替换正在进行的任务</strong></div>
  <div class="version-track">
    <div><small>时间 01</small><strong>配装方法 V1 发布并启用</strong><span>成为新任务的默认版本</span></div>
    <i>→</i>
    <div class="transaction-a"><small>时间 02</small><strong>配装任务 A 开始</strong><span>固定使用 V1</span></div>
    <i>→</i>
    <div><small>时间 03</small><strong>配装方法 V2 发布</strong><span>启用为新任务的默认版本；任务 A 仍使用 V1</span></div>
    <i>→</i>
    <div class="transaction-b"><small>时间 04</small><strong>配装任务 B 开始</strong><span>使用 V2</span></div>
  </div>
  <div class="version-revoke"><b>如果 V1 必须撤销</b><span>任务 A 应停止、迁移或重新规划，不能静默切换方法。</span></div>
</div>

同一个宿主会话可以先选人、再配装、然后排轴；每个新业务事务使用当前启用或分配的版本，进行中的任务又不会在用户确认以后偷换规则。

版本解决的是同一类业务怎样迭代；接下来还要回答，不同业务之间的边界应该画在哪里。这就引出原子化 Harness。

### 2、形象的说法：原子化 Harness

“原子 Harness”是本文项目架构中的说法。这里的“原子”不是越小越好，也不是最小文件、最小 Tool、最小实体或最小步骤。它指的是一类能够独立负责、独立版本化，并且独立验证完成的业务。

判断一个边界是否适合作为原子 Harness，可以看五件事：

1. 用户是否会把它当作一件完整工作提出；
2. 它是否拥有明确的输入、输出和完成条件；
3. 它是否有相对独立的求解方法与知识角色；
4. 它是否拥有明确的直接写入范围或只读责任；
5. 它是否值得独立启用、回退和撤销版本。

按这个标准，本项目得到五个业务 Harness：

| 原子 Harness | 完整业务责任 | 直接写入范围 | 完成证据 |
| --- | --- | --- | --- |
| 选人 | 查看、增加、删除、替换和调整队伍 | 队伍成员与顺序 | 真实页面中的当前队伍 |
| 配装 | 分析、推荐、比较、预览和应用角色配置 | 武器、装备、技能等级与配置输入 | 真实角色配置页 |
| 排轴 | 查看、添加、移动、替换和应用技能按钮 | 按钮身份、位置、顺序与排轴结构 | 真实时间轴 |
| BUFF | 查询、添加、替换和批量处理 BUFF | BUFF 绑定、层数与相关战斗状态 | 真实按钮 BUFF 状态 |
| 计算统计 | 计算、比较、归因、诊断和解释 | 不直接改前四类状态 | 绑定方案与公式版本的结果 |

某种套装效果只是配装时使用的知识或限制；角色只是业务操作的对象；单件装备只是领域对象；几件装备组成的是候选装备组合。真正值得独立建成业务 Harness 的，是“为角色分析、推荐、确认并应用整套装备”这项完整责任。

同样，`read_current_loadout` 和 `apply_loadout` 不是两个业务 Harness。它们是同一项配装业务在不同阶段使用的 Tools。

原子化要保护的是业务责任和迭代生命周期，不是把系统拆成尽可能多的小块。

### 3、业务拆分？No，是领域问题求解 Harness 及其可迭代体系

如果只是把代码分成五个目录，这件事还没有完成。每个业务 Harness 都要拥有自己的方法版本、知识来源、业务事务、写入边界、失败恢复方式、完成验证和执行证据。

五个业务 Harness 共享 Tool Registry（工具注册表）、执行基础、知识来源和同一份产品状态；每个 Revision 再暴露自己的 Tool Allowlist（工具允许列表），因此共享能力不等于共享权限。

业务边界不一定等于物理文件边界。例如 BUFF 字段即使存放在时间轴按钮对象里，排轴业务仍只负责按钮身份、位置和顺序，BUFF 业务只负责 BUFF 状态。字段存放在同一个对象中，不代表同一个业务 Harness 可以修改全部内容。

跨业务请求也不需要再建立一个“万能 Harness”。用户说“换人、配装、排轴、上 BUFF 后计算”时，管理器负责依赖图、结果传递，以及失败、取消和过期的传播；必要时还要按合同执行重试或补偿。各业务 Harness 仍然各自负责领域判断、写入和完成验证。

<div class="article-diagram harness-ecosystem-diagram" role="img" aria-label="管理器把跨业务请求拆成五个独立业务 Harness，它们共享工具、知识和产品状态，但各自拥有写入范围与完成验证">
  <div class="diagram-heading"><small>ATOMIC BUSINESS HARNESSES</small><strong>共享能力，不共享模糊的业务责任</strong></div>
  <div class="ecosystem-manager"><small>管理器</small><strong>按用户请求和依赖关系创建一个或多个业务任务</strong></div>
  <div class="ecosystem-dependency"><span>下面只是一种组合请求的示例依赖图</span><i>↓</i></div>
  <div class="ecosystem-harnesses">
    <div><small>01</small><strong>选人</strong><span>成员与顺序</span></div>
    <i>→</i>
    <div><small>02</small><strong>配装</strong><span>角色配置</span></div>
    <i>→</i>
    <div><small>03</small><strong>排轴</strong><span>时间轴结构</span></div>
    <i>→</i>
    <div><small>04</small><strong>BUFF</strong><span>战斗状态</span></div>
    <i>→</i>
    <div><small>05</small><strong>计算</strong><span>只读并统计</span></div>
  </div>
  <div class="ecosystem-contracts"><span>各自的方法版本</span><span>各自的业务事务</span><span>各自的写入范围</span><span>各自的完成验证</span></div>
  <div class="ecosystem-shared"><small>共同基础</small><span>Tool Registry 与执行基础</span><span>游戏知识与公式</span><span>同一份产品状态</span><span>执行轨迹</span></div>
  <div class="ecosystem-stop"><b>前一步失败、被拒绝或过期</b><span>依赖该结果的后续任务不得继续使用旧方案</span></div>
</div>

这条箭头链只是一种请求形成的 DAG（有向无环依赖图），其他请求可以得到不同的依赖关系。它不是五份更长的 Prompt，而是五个面向领域问题求解、可以独立实例化、版本化和验证的业务 Harness，以及管理它们持续演进的体系。

## 开发与训练（未完待续）

训练改变模型本身，Harness 系统开发改变模型工作的环境。

当 Agent 做错一件事时，应该先判断错误发生在哪一层：

| 问题 | 更可能需要修改 |
| --- | --- |
| 模型普遍无法理解某种语言或稳定完成基础推理 | 模型、训练或推理能力 |
| 缺少一项真实读取、计算或写入能力 | Typed Tool / 产品接口 |
| 游戏事实错误或已经过期 | 装备数据目录、公式或领域知识 |
| 一类业务经常漏查证据、候选不完整或不会处理修正 | 业务 Harness 版本 |
| 模型能绕过审批、越界写入或使用已经过期的待确认方案 | Harness 运行时 / 产品执行层 |
| 系统说完成，但真实页面没有变化 | 完成合同与 Validator（验证器）；Trace 用于定位和举证 |

不能把所有失败都归因于模型不够强，也不能把所有失败都继续堆进 Prompt。

一个更强的模型可以提高判断质量；一个更成熟的 Harness 系统则让判断发生在正确的事实、能力和边界中，并让结果可以验证、追溯和修改。垂直领域 Agent 最终交付的不是某个模型单独的聪明程度，而是模型、Harness 系统与真实产品共同形成的业务能力。
