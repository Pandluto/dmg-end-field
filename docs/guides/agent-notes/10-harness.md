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

所有**血狼破军**做不出攻略，他的上下文是读稿。

那我把**血狼破军**的上下文改成做攻略不就可以了吗?

那可完蛋了，你得改什么呀？

Prompt（提示词：**血狼破军**是上交985）、

Host Prompt（宿主提示词：**血狼破军**是B站百万粉丝up主）、

Skill（技能包：**血狼破军**只会读稿）、

Tool Description（工具说明：**血狼破军**只会读稿）、

审批逻辑、事务状态等（骗你的，根本没人管他）

我们调教**血狼破军**（这里类比AI）是多维度，这里就需要引入harness

## 什么是 Harness？

广义上，Harness 是围绕模型建立的运行机制。模型负责生成下一步回复或行动请求；Harness 则把模型连接到上下文、工具、状态、权限、执行环境和结果反馈，使这些输出能够成为一次真实、连续并可检查的工作过程。

<div class="capability-strip" role="img" aria-label="模型、Harness 与真实环境的关系">
  <div><small>决定下一步</small><strong>模型</strong></div>
  <b>→</b>
  <div class="accent"><small>组织并约束执行</small><strong>Harness 系统</strong></div>
  <b>→</b>
  <div><small>产生真实结果</small><strong>Tools + 产品</strong></div>
</div>

这里的 Harness 不是单独一份 Prompt，也不是一组 Tools。它描述的是模型在什么信息和能力条件下工作，以及模型输出怎样被系统接收、执行、拒绝、记录和反馈。

同一个模型接上不同 Harness，会表现得像不同的 Agent。差别不一定来自模型更聪明，而可能来自上下文、能力边界、状态、反馈和完成条件完全不同。

## 广义 Harness 会指什么？

Harness 没有一条被所有框架共同采用的边界。

最窄的说法只包括 System Prompt（系统提示词）和 Tool Loop（工具循环）；更宽的说法会把 Context（上下文）、Memory（记忆）、Skills（技能包）、状态、权限、沙箱、审批和结果检查都算进去。不同文章使用同一个词时，谈论的可能不是完全相同的系统范围。

从系统角度看，广义 Harness 可以理解为模型与外部环境之间的**运行支架**。它组织模型怎样获得信息、提出行动、接收反馈、延续状态，并把行动连接到真实执行。[AI Harness Engineering（AI Harness 工程）](https://arxiv.org/abs/2605.13357) 进一步把 Agent 能力放在“模型—Harness—环境”这个整体中讨论，而不是只归因于模型本身。

本文接受这个广义定义，但为了讲清本项目的设计，会继续分出三个层次：

| 层次 | 正式称呼 | 后文简称 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- | --- |
| 整体运行层 | Harness 系统（Harness System） | Harness 系统 | 连接模型、上下文、Tools、状态、权限、执行环境与反馈 | 不等于某一份业务方法 |
| 业务声明层 | 业务 Harness 版本（Business Harness Revision） | 业务 Harness / Harness 版本 | 声明某类领域问题的目标、求解方法、知识角色、工具策略和完成条件 | 不直接执行 Tool，也不自行保存运行状态 |
| 程序执行层 | Harness 运行时（Harness Runtime） | 运行时 | 路由业务、加载 Harness 版本、组装上下文、维护事务、执行检查并推进过程 | 不把领域方法硬编码成一套全局流程 |

这三个词不是行业统一标准，而是本文为了避免“所有东西都叫 Harness”而采用的项目内边界。“业务 Harness”是配装、排轴这类长期存在的业务单元；“Harness 版本”是运行时为某次业务事务实际加载的不可变版本。后文只有讨论版本固定、发布或回退时，才强调“版本”。

## Harness 和 Tools、Workflow 的关系

定义本身还不够。要看清 Harness 的边界，需要把它与几个最容易混淆的概念逐一分开。

| 名词 | 它定义什么 | 是否预先规定路径 | 配装例子 |
| --- | --- | --- | --- |
| Typed Tool（类型化工具） | 一个动作的输入输出、前置条件、副作用、错误和权限要求 | 不定义完整业务路径 | 读取当前装备、应用配装方案 |
| Workflow（工作流） | 多个动作之间固定的顺序、分支、重试和结束条件 | 规定全部或部分路径 | 用户确认后应用方案，再重新读取 |
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
      <strong>必须固定时的控制关系</strong>
      <span>用户确认</span>
      <i>→</i>
      <span>应用方案</span>
      <i>→</i>
      <span>重新读取</span>
    </div>
  </div>
</div>

同一个 Tool 可以被多个业务 Harness 使用；业务 Harness 也只在顺序必须固定时引用 Workflow，其余步骤仍可由模型根据当前情况选择。[LangGraph：Workflows and agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)

Tool 可以声明与自身安全执行直接相关的前置条件，例如提交时必须携带有效版本号、删除必须经过审批。完整业务的跨 Tool 方法则不属于某一个 Tool：如果只是推荐做法，它属于业务 Harness；如果顺序必须由程序固定，它属于 Workflow。

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

“Skill 非强制”不是说宿主不能强制加载 Skill，也不是说 Skill 只能包含文字。Skill 可以携带说明、脚本、模板和其他资源，宿主也可以要求模型在特定任务中读取它。

真正不能被 Skill 单独保证的，是模型一定按照其中的方法逐条行动。Skill 里的自然语言方法进入模型以后，仍然是模型决策的输入；即使 Skill 附带脚本，脚本能够执行也是因为运行时、Tool 或沙箱提供了执行能力。

因此，Skill 适合提供“通常应该怎样做”；“绝对不允许发生什么”仍然必须落在 Tool、权限、审批和产品代码中。业务 Harness 可以引用 Skills，但不能把硬边界寄托在 Skill 的服从率上。

方法材料归 Skill，完整业务责任归 Harness。接下来再看，一次具体工作需要的信息从哪里来，又由谁组装。

## Harness 和 Context 的关系

Context 不是一个单独的存储位置，而是“当前代码或模型在这一刻可以使用哪些信息”的统称。讨论 Context 时，必须先说明这些信息来自哪里、保存多久、由谁使用，以及模型能不能看到。

OpenAI Agents SDK 区分本地运行上下文（Local Run Context）与模型可见上下文（Model-visible Context）：前者供 Tools、Hooks（钩子）和应用代码使用，后者才会进入模型请求。对话历史可以由 Session（会话记忆）管理；一次配装进行到哪里，则仍要由项目自己的业务事务保存。[OpenAI Agents SDK：Context management](https://openai.github.io/openai-agents-python/context/)

<div class="article-diagram context-diagram" role="img" aria-label="事实、业务事务和会话怎样被运行时组装成本地上下文与模型可见上下文">
  <div class="diagram-heading"><small>CONTEXT FLOW</small><strong>信息从哪里来，最后给谁使用</strong></div>
  <div class="context-flow">
    <div class="context-sources">
      <small>模型调用之外保存的信息</small>
      <span><b>权威产品事实</b>当前装备、装备数据、公式及其版本</span>
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

信息被选出来以后，还要决定哪些交给模型、哪些留在代码侧检查；这就是 Prompt 与 Harness 的边界。

## Harness 和 Prompts 的关系

Prompt 经常同时指两种东西：一是可以独立编写和版本化的 Prompt 模板（Prompt Template），二是某次调用最终发送给模型的完整输入。两者必须分开。

Prompt 模板和指令（Instructions）是模型侧的重要行为控制资产。它们可以定义目标、角色、概念、方法、示例和表达要求，也可以通过消息角色建立指令优先级。但这种模型侧权威仍然不能替代代码侧权限：模型即使收到“不得越权”的高优先级指令，执行层仍要对真实 Tool 调用再做检查。

| 名词 | 是什么 | 生命周期 | 主要作用 | 能否直接阻止副作用 |
| --- | --- | --- | --- | --- |
| Prompt 模板 | 可复用、可版本化的内容模板 | 跨多次调用 | 保存角色、概念、方法、示例和表达要求 | 不能 |
| 指令（Instructions） | 本次 Agent 运行提供给模型的高优先级指令 | 静态或动态生成 | 建立模型侧目标与指令权威 | 不能单独保证 |
| 最终模型输入（Final Model Input） | 本次发送给模型的指令、消息、Tool 参数结构、结果和证据 | 一次模型调用 | 为模型形成当前工作视图 | 不能 |
| 运行时硬边界 | 权限、审批、Tool 可见性、版本一致性、写入范围和后置检查 | 完整业务过程 | 在代码侧允许、拒绝、保存和验证 | 可以在覆盖范围内阻止 |

Prompt 负责把问题和方法交给模型；运行时负责决定这次交给模型什么，并对模型提出的真实行动再次检查。

在本项目中，Prompt 模板和指令继续作为可独立版本化的来源；运行时结合当前 Harness 版本、事务状态、Tool 参数结构、对话历史和事实证据，组装本轮最终模型输入。对话历史、Tool 结果和检索证据都是模型输入的一部分，但不因此变成 Prompt 模板。

反过来，权限、审批、版本一致性、写入范围和后置条件并不依赖模型输入是否完整，而应由运行时、Tool 和产品代码强制执行。

OpenAI Agents SDK 已经提供模型与 Tool 之间的基础运行循环、会话记忆和审批能力；本项目仍要自己管理业务事务、Harness 版本和领域完成条件。[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)

到这里，模型侧输入与代码侧约束已经分开。下面回到本项目：哪些规则应当强制，哪些规则只能作为求解方法交给模型？

## 本项目 Harness 的特性

本项目最重要的设计，不是把更多规则改名叫 Harness，而是把两类性质完全不同的规则分开。

第一类是**求解方法**：通常先看什么、需要哪些知识、怎样比较候选、什么时候追问。业务 Harness 把它作为强参考交给模型。第二类是本文的项目术语——**硬边界**：什么 Tool 可以出现、谁能写哪些字段、是否已经确认、方案版本是否仍然有效、真实页面是否真的变化。这些必须由程序检查。

“强参考”不是随便看看。业务 Harness 可以要求模型形成结构化的候选装备组合、待确认配装方案或解释，但不要求模型采用唯一的内部思考顺序。

本项目的业务 Harness 还需要具备四个特性：

1. **面向完整业务问题**：它负责的是配装、排轴这类可以独立完成的用户目标，不是某个 Tool 或某个实体；
2. **由业务事务承载**：目标、用户限制、证据、候选、当前阶段和 Harness 版本不能只存在于聊天记录；
3. **以真实结果结束**：模型说“已经完成”不是完成，产品状态满足后置条件才是完成；
4. **可以独立迭代**：修改配装方法，不需要同时重新发布选人、排轴、BUFF 和计算。

### 为什么不能强制？

这里不能强制的，是**问题求解方法本身**，不是安全与写入边界。

第一个原因是，真实用户的表达经常不完整。用户说“这几件装备怎样组合更合适”，可能只想了解搭配原则，也可能想比较几套方案，或者已经准备应用其中一套。系统必须根据对话和当前状态追问、解释或行动。

第二个原因是，同一业务可以有多条合理路径。目标清楚时可以直接读取证据；目标含糊时应先追问；用户只比较两套方案时不需要进入写入阶段；某个 Tool 失败后还可能需要换一个证据来源。

第三个原因是，模型的内部推理并不是运行时可以逐句检查的程序。把自然语言方法伪装成强制状态机，只会让系统在例外情况中变得僵硬。

<div class="article-diagram dual-track-diagram" role="img" aria-label="配装求解方法可以灵活调整，但所有真实写入都必须通过硬边界">
  <div class="diagram-heading"><small>METHOD × CONTRACT</small><strong>方法可以变化，产生真实后果的边界必须通过</strong></div>
  <div class="diagram-track flexible">
    <div class="track-label"><small>求解方法</small><strong>强参考</strong><span>允许跳过、返回和重新规划</span></div>
    <div class="track-nodes">
      <span>理解目标</span><i>↔</i><span>查看当前装备</span><i>↔</i><span>查知识与计算</span><i>↔</i><span>比较装备组合</span><i>↔</i><span>追问或解释</span>
    </div>
  </div>
  <div class="diagram-track enforced">
    <div class="track-label"><small>运行时硬边界</small><strong>程序强制</strong><span>任何写入都不能绕过</span></div>
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

业务 Harness 版本负责声明“这类问题应当怎样处理”；运行时负责让这个版本在一次业务事务中真正执行。二者不是互相包含的同一个对象。

OpenAI Agents SDK 已经提供模型与 Tool 之间的基础运行循环、对话记忆和审批恢复；本项目运行时还要知道这次配装进行到哪里、使用哪个 Harness 版本、用户确认了哪套方案，以及修改后是否真的生效。[OpenAI Agents SDK：Running agents](https://openai.github.io/openai-agents-python/running_agents/)

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

运行时还要留下**执行轨迹（Execution Trace，后文简称 Trace）**，记录本次使用的 Harness 版本、当时的产品状态、Tool 调用、用户确认、状态变化和完成证据。要判断“修改前是否真的等待了确认”，不能只看 Prompt 里有没有这句话，而要检查确认、执行和结果验证是否真的发生。[Harness Handbook](https://ruhan-wang.github.io/Harness-Handbook/#one-behavior-many-implementation-sites)

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
| Tools | 强调跨任务复用的通用能力 | 强调领域 Schema、语义写入范围和业务前置条件 |
| 完成条件 | 每个任务临时确定，可能依靠测试、文件或用户判断 | 可以沉淀稳定的领域后置条件和验证规则 |
| 安全边界 | 同样需要权限、审批、沙箱和副作用控制 | 在通用安全边界上增加领域级写入与状态约束 |
| 迭代重点 | 模型、通用能力、路由和任务适应性 | 领域知识、求解方法、业务事务、版本与领域评测 |

Multi-agent（多 Agent）解决的是执行者怎样分工；垂直领域的业务 Harness 解决的是业务责任怎样定义。一个业务 Harness 可以由一个 Agent 执行，也可以由多个 Agent 协作执行。增加 Agent 数量不会自动补齐缺失的领域建模。

### 2、以本项目为例

继续看“帮我给当前角色搭一套适合当前队伍的装备”。

几件装备放在一起，只是**装备组合**；当它绑定目标角色、用户限制、选择理由，以及形成方案时读取到的当前配装，才成为一份可以交给用户确认的**待确认配装方案**。完整的配装业务要处理两者之间的形成、确认、应用和验证。

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

PSM 解释得最准确的是业务 Harness 中的“求解方法”这一层：一类问题怎样组织知识并形成结果。它本身不提供让 Agent 持续运行、调用能力和验证真实结果的执行环境。

因此，PSM 是这篇文章的理论参照，不是 Harness 系统或业务 Harness 的替代名称：

> PSM 描述一类问题可以怎样求解；Harness 系统把这套方法连到模型、Context、Tools、状态与真实环境。

PSM 可以描述任务分解、知识角色和控制结构；这些结构是否由程序严格执行，取决于具体实现。本项目选择把它作为求解方法层的强参考，而不是要求模型机械遵循唯一推理路径。

方法已经有了理论名字，但方法仍然需要领域知识才能得到具体结论。

## 垂直领域的知识（游戏知识）

### 1、游戏知识和 Harness 的关系

求解方法规定怎样使用知识，却不等于知识本身。游戏知识是业务 Harness 解决问题时使用的证据，不应该全部写进 Harness 版本本身。

| 信息 | 权威来源 | 在业务中的角色 |
| --- | --- | --- |
| 当前队伍、配装、排轴与 BUFF | 当前打开的方案和真实产品页面 | 这次问题的真实起点 |
| 武器、装备、技能和 BUFF 数值 | 装备数据目录 | 可核对的游戏事实 |
| 角色定位、配装建议和适用场景 | 带来源与条件的攻略知识 | 候选生成与解释依据 |
| 战斗约定和统计口径 | 用户条件、项目约定 | 约束比较范围 |
| 伤害与统计结果 | 公式和计算引擎 | 可复现的计算证据 |
| 历史选择与用户修正 | 业务事务（Business Transaction） | 本次业务的决策上下文 |

业务 Harness 版本要声明当前问题需要哪些知识、从哪里读取、适用条件怎样记录、哪些内容交给模型，以及状态或知识变化后旧结论是否仍然有效。它不复制装备数据库，也不把某篇攻略的当前结论永久写进流程；否则数据变化和方法变化会纠缠在一起。

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

重构不是把一句规则换个地方再复制，而是把说明、状态、强制执行和证据分别放回正确位置。文件树仍然告诉我们代码放在哪里；业务 Harness 与执行轨迹则让人能够从一项行为找到这些实现怎样共同工作。

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
| 怎样判断系统是否做对 | Trace、合同测试与真实界面（UI）验证 | 运行时教学 |

Prompt 当然仍然会独立迭代。需要改变的是：不再把所有业务规则都塞进一份全局 Prompt。Prompt 模板和指令继续作为可版本化来源；运行时再结合当前 Harness 版本、事务状态、Tool 参数结构、对话历史和事实证据，组装本轮最终模型输入。

以后迭代配装方法，修改的是配装业务的 Harness 版本；迭代游戏攻略，修改的是知识；新增修改能力，修改的是 Tool；改变审批和版本一致性，修改的是运行时或产品代码。

只有把变化放回正确的归属处，系统才能回答两个重要问题：

- 这次行为为什么变了？
- 我只改配装，会不会意外改变选人、排轴或 BUFF？

## 拆解业务 → 建模：从方法走向可迭代体系

当一类业务已经拥有自己的定义、方法、状态和验证以后，下一个问题才是：这些业务单元的边界应该画在哪里？

### 1、迭代与管理

要让业务 Harness 真正可以迭代，至少要分清三种记录。

| 记录 | 稳定性 | 负责什么 | 例子 |
| --- | --- | --- | --- |
| 业务定义（Business Definition） | 相对稳定 | 业务边界、支持动作、最大 Tool 范围、写入范围和完成条件 | 配装可以改装备，不能改队伍成员 |
| 业务 Harness 版本（Business Harness Revision） | 单个版本不可变；通过发布新版本持续迭代 | 业务方法、阶段、知识入口、Tool 引用、异常处理和表达方式 | 配装 V1、V2 |
| 业务事务实例（Business Transaction） | 每次工作独立产生 | 目标、限制、当前阶段、证据、待确认方案、审批、产品版本和运行中的 Harness 版本 | 正在为当前角色准备一套配装 |

这三者对应三个不同问题：

- 这项业务究竟负责什么？
- 当前发布的方法是什么？
- 这一次具体工作进行到哪里？

这里的“业务事务”就是一次可以跨回合暂停和恢复的业务任务。它通过持久化状态跨回合推进，不是数据库事务。

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

这里的“原子”不是越小越好，也不是最小文件、最小 Tool、最小实体或最小步骤。它指的是一类能够独立负责、独立版本化，并且独立验证完成的业务。

Harness Handbook 的行为单元（Behavior Unit）用于组织实现证据；这里的原子 Harness 用于划分完整业务责任。

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

五个业务 Harness 共享 Tools、知识来源和同一份产品状态，但不共享模糊的业务所有权。

业务边界不一定等于物理文件边界。例如 BUFF 字段即使存放在时间轴按钮对象里，排轴业务仍只负责按钮身份、位置和顺序，BUFF 业务只负责 BUFF 状态。字段存放在同一个对象中，不代表同一个业务 Harness 可以修改全部内容。

跨业务请求也不需要再建立一个“万能 Harness”。用户说“换人、配装、排轴、上 BUFF 后计算”时，管理器只保存跨业务计划，并按照用户请求和依赖关系创建对应的业务事务。

<div class="article-diagram harness-ecosystem-diagram" role="img" aria-label="管理器把跨业务请求拆成五个独立业务 Harness，它们共享工具、知识和产品状态，但各自拥有写入范围与完成验证">
  <div class="diagram-heading"><small>ATOMIC BUSINESS HARNESSES</small><strong>共享能力，不共享模糊的业务责任</strong></div>
  <div class="ecosystem-manager"><small>管理器</small><strong>按用户请求和依赖关系创建一个或多个业务任务</strong></div>
  <div class="ecosystem-dependency"><span>下面是一次组合请求的依赖关系</span><i>↓</i></div>
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
  <div class="ecosystem-shared"><small>共同基础</small><span>Typed Tools</span><span>游戏知识与公式</span><span>同一份产品状态</span><span>执行轨迹</span></div>
  <div class="ecosystem-stop"><b>前一步失败、被拒绝或过期</b><span>依赖该结果的后续任务不得继续使用旧方案</span></div>
</div>

这不是五份更长的 Prompt，而是五个面向领域问题求解、可以独立运行和版本化的业务 Harness，以及管理它们持续演进的体系。

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
| 系统说完成，但真实页面没有变化 | 完成验证与 Trace |

不能把所有失败都归因于模型不够强，也不能把所有失败都继续堆进 Prompt。

一个更强的模型可以提高判断质量；一个更成熟的 Harness 系统则让判断发生在正确的事实、能力和边界中，并让结果可以验证、追溯和修改。垂直领域 Agent 最终交付的不是某个模型单独的聪明程度，而是模型、Harness 系统与真实产品共同形成的业务能力。
