# 篇章 11：Harness

前面已经给 Agent 接上了 Typed Tools（类型化工具）。

它能读取当前队伍和配装，能修改装备、编辑排轴、添加 BUFF（CRUD 增删改查），

也能调用真实公式完成计算。

一个更难的问题，假如用户说

> 给我干员搭配一套适合的装备。
>
>

这是一个数学问题（排列组合数），还是一个知识问题（最简单粗暴的就是把什么都告诉AI）。

一个游戏领域大神是这么做的？

显然这句话**不止**要调用一个基本Tools，

why -> how。推理->表达。

一个游戏领域大神是这么做的？ 我的干员需要什么？哪些装备、武器满足？给出解法。



这是**Agent完成一项真实业务** ，我当然可以为此写专门的Tools（然后路由）

但 Agent 学会的只是调用程序，只能解决一模一样的问题，

并没有学会前因后果、举一反三。



我必须用Context（上下文）提示Agent，

我的 Tool Description（工具描述）在不太语境下也会不一样，

我的权限、审批逻辑、事务状态也要为Agent服务。



这太复杂了，我需要去管理他。

> 模型周围这整套工作条件，究竟由谁组织？

这就是这篇手记里的 Harness。

## 什么是 Harness？

Harness 是**围绕**模型建立的运行机制。

不是单独一份 Prompt，也不是一组 Tools。它描述的是模型在什么信息和能力条件下工作，以及模型输出怎样被系统接收、执行、拒绝、记录和反馈。

Harness直译是**控制**，工程化的问题，讲起来没有**调教**这么变态

## 广义 Harness 会指什么？

不同文章里的 Harness，边界并不完全一样。

最窄的说法，可能只指 System Prompt（系统提示词）和 Tool Loop（工具调用循环）；更宽的说法，会把 Context、Memory（记忆）、Skills、状态、权限、沙箱、审批和结果检查都算进去。

在这个项目里，还可以把定义再收紧一点：

> **本项目中的 Harness，是围绕一类业务问题建立的完整 Agent 求解环境。它将领域知识、问题求解方法、上下文、能力边界、执行状态与完成验证组织为可版本化、由运行时强制的整体，同时保留模型在边界内的自主推理能力。**

（Runtime 就是 Harness 实际运作的地方；缓存、状态机和内部执行机制，不在这里展开。）

## Harness 和 Prompt、Tool、Skill、Workflow 的关系

这几组关系不用讲复杂：

| 概念     | 它怎样作用于 Agent               |
| -------- | -------------------------------- |
| Prompt   | 直接告诉模型目标和要求           |
| Context  | 提供这一次判断所需的材料         |
| Tool     | 提供由程序执行的能力             |
| Skill    | 提供一份非强制的方法目录         |
| Workflow | 强制按确定顺序串联 Tools         |
| Harness  | 把这些东西和更多运行条件组织起来 |

Tool、Skill 、Workflow 与 Harness 显然不是同一层次。但如果只比较它们最终怎样影响模型，区别很清楚：

> **Tool 是强制性的能力，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是非强制，但强参考。**

## 面向业务的Harness：先从“解一道题”说起

一道普通证明题。

解题的人要看懂题目，想起可用的定理，选择证明办法；走不通，就换一条路。

知识工程里有一个概念叫 Problem-Solving Method（问题求解方法，PSM），讨论的就是“一类问题可以怎样解”。[知识工程对 PSM 的介绍](https://www.cs.vu.nl/~guus/papers/Schreiber07a.pdf)



Agent 的运行看起来也很像：理解用户的话，取得需要的信息，调用 Tools（循环），处理返回结果；就退出循环并给出答案。



PSM 让这件事变得好懂，但是呢

> **PSM 没有智能；“怎样解一道题”是写不能死的**

### 为什么不能写死？

同一句“帮我配一套装备”，合法的走法并不只有一条。

- 用户只想听建议，Agent 不必进入写入。
- 目标角色不清楚，Agent 可以先追问。
- 现有证据不够，Agent 可以先读攻略，也可以先看装备数据。

<details>
<summary>还有一种运行中的变化</summary>

- Tool 返回结果以后，新的事实可能让模型改变原来的判断。

</details>

这些情况当然可以全写成分支。但分支越写越多，最后得到的是一条巨大的 Workflow，不是一个仍能临场判断的 Agent。

> **当你把这一切都写死，还有什么意义？到底是你在管这些问题，还是 Harness 在管？**

Harness 不固定唯一解法。它要做到的，是让合适的方法在合适的时候成为模型的**强参考**。

## 典型的垂直领域 Agent

游戏场景是具体内容，我们和通用Agent做一下区分

通用 Agent 面对开放问题，临时组织这一轮需要的材料；

垂直领域 Agent 反复处理同一类问题，因此可以持续复用领域知识、问题求解方法和 Tools，同时仍然根据每一次真实场景临场判断（Context）。

因此，垂直领域 Harness 的特色不是把流程写死，而是把领域知识、Tools、权限与审查机制稳定地组织在一起，这也专业又灵活，快速又稳定。

## 垂直领域的知识

**Harness 使用知识，但不复制知识。**

它要组织的是：这类问题需要哪些知识，去哪里读，什么时候读。攻略更新不该迫使整个 Harness 重写；方法调整也不该复制一份新的装备数据库。

<details>
<summary>展开：配装时可能出现的几类材料</summary>

| 材料 | 来源 | 用来做什么 |
| --- | --- | --- |
| 当前事实 | 真实产品状态 | 看清角色、队伍和现有配装 |
| 游戏事实 | Catalog（数据目录）、Formula Engine（公式引擎） | 核对装备与计算结果 |
| 策略知识 | 带来源和适用条件的攻略 | 形成候选、解释选择 |
| 运行结果 | Tool Result | 把已经发生的事情带进下一轮 |

文字可以解释证据，不能代替证据。

</details>

这里最重要的变化，是不要再把所有材料一次塞满。

有些 Context 从任务开始就需要；有些只在准备调用某个 Tool 时有用；还有一些，必须等 Tool Result 回来以后才成立。

到了这里，Context 已经不只是一大段“背景资料”。它开始有自己的**来源、用途和运行位置**。

## 写死 Prompt 以后，我们实际遇到了什么？

项目早期把业务规则写进 Prompt，没有错。业务还没稳定时，这是验证想法最快的地方。

后来遇到一个很实际的问题：Skill 偶尔没有加载。

为了保险，我们把关键规则复制进固定 Prompt。接着又复制到 Tool Description 和 Runtime。同一句“应用配装前必须确认”，到处都有一点。

这时问题已经不是“Prompt 太长”，而是：

> **我们没有一个地方说清楚：一份 Context 由谁提供，又应该在什么时候出现。**

[Harness Handbook](https://ruhan-wang.github.io/Harness-Handbook/#one-behavior-many-implementation-sites)把类似问题称为“一个行为，多个实现位置”。一条行为可能同时经过 Prompt、Tool Wrapper（工具包装器）、权限、状态和执行环境。只看文件树，很难知道它真正散落在哪里。

Harness Handbook 的做法，是把这些位置重新画成一张 Behavior Map（行为地图）。

这也给了我们一个更具体的方向：如果 Tool 可以被统一管理，Context 也应该有明确的来源和使用时机。

## Harness 对 Context 的管理

<details id="context-anthropic" class="context-viewpoint context-viewpoint--anthropic">
<summary><span class="context-viewpoint__label">Anthropic</span><span class="context-viewpoint__thesis">把系统指令、Tools、MCP、外部数据和消息历史视为不同的上下文组成部分；每次调用模型前重新决定哪些内容应该进入窗口。</span></summary>

[Anthropic：Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Anthropic 讨论的是模型眼前这一轮。

Context 不只是 Prompt，还包括 Tools、MCP、外部数据、消息历史和刚刚返回的 Tool Result。它们都在争夺有限的 Context Window（上下文窗口），放得越多，并不代表模型理解得越好。

所以重点不是把材料一次塞满，而是保留少量高价值信息。固定规则可以先给；文件、查询和链接只保留轻量索引，需要时再由 Agent 使用 Tools 读取。每一次读取又会产生新的事实，帮助 Agent 决定下一步还要看什么。

这是一种 Progressive Disclosure（渐进披露）：Agent 一层一层取得材料，只把当前判断真正需要的部分留在工作记忆里。

长任务也不能只靠更大的 Context Window。Anthropic 使用 Compaction（压缩）、结构化笔记、Memory（记忆）和 Subagent（子 Agent），让旧信息被概括、外置或者隔离，而不是永远堆在主 Agent 眼前。

</details>

<details id="context-openai" class="context-viewpoint context-viewpoint--openai">
<summary><span class="context-viewpoint__label">OpenAI</span><span class="context-viewpoint__thesis">强调不要把所有知识塞进一个巨大 Prompt，而是让简短的 AGENTS.md 充当地图，指向结构化的知识源；Agent 再按任务读取相关内容。</span></summary>

[OpenAI：Harness Engineering](https://openai.com/index/harness-engineering/)

OpenAI 讨论的是这些材料怎样成为 Agent 可以找到、理解和验证的工作环境。

他们试过把说明全部写进一个巨大的 AGENTS.md，结果很快出现问题：重要内容互相淹没，规则容易过期，也很难检查到底是谁维护、是否仍然正确。

后来 AGENTS.md 只保留为地图。真正的知识进入版本化的 docs、架构文档、执行计划和生成资料；Agent 从一个小入口出发，再根据任务找到更深的来源。这同样是渐进披露，但重点从“模型窗口”转向了“知识怎样组织”。

只让 Agent 读到文档还不够。OpenAI 还让 UI、日志、指标和测试对 Agent 可见，并把架构边界交给 Linter（静态检查）和结构测试强制。文档负责说明，Tools 负责行动，程序负责守住不能违反的规则。

这套 Harness 的原则可以概括为：边界集中强制，边界之内保留自主。

</details>

### 管理 Context 的来源与生命周期

Anthropic 从一次模型调用向内看，回答“这一轮应该看什么”；OpenAI 从整个工程环境向外看，回答“材料去哪里找、能做什么、结果怎样验证”。

两者放在一起，Harness 不负责把所有 Context 塞进一个 Prompt；它负责让模型在需要时找到合适的材料，也让这些材料随状态变化及时更新或退出。

> **Harness 对 Context 的管理：Context 从哪里来、解决什么问题、什么时候需要，以及状态变化后怎样更新或退出。**

## Typed Tools 完成之后，迭代的是什么？

Typed Tools 完成，只表示 Agent 的手相对稳定了。

之后长期变化的，是它在每个位置拿到的 Context：

- 配装方法变了，修改对应的方法 Context；
- 攻略变了，更新知识来源；
- 新增 Tool，补上它的用途和调用前 Context；
- Tool Result 结构变了，调整调用后的解释 Context；
- 出现一种新问题，补上对应的知识、读取路径或审查规则。

这些改变不需要预先凑成固定数量的业务，也不需要重写一份总 Prompt。

只要每份材料的来源、用途、触发时机和退出条件清楚，Harness 就能让它们各自变化，而不互相淹没。

## 先停在这里

绕了一圈，Harness 仍然是最合适的主名称。

因为它说的是领域知识、问题求解方法、Context、能力、状态和运行条件围绕 Agent 形成的整体，而不是其中某一份 Prompt 或知识。

它不替模型预先解完问题，也不要求模型走唯一的路。它把需要的 Context 放到相应的位置，让方法成为**非强制，但强参考**。

所以本篇最后留下的，不是一张固定配装流程图，也不是一组固定数量的“小 Harness”，而是这样一个理解：

> **Harness 是整体；它让 Context 在合适的时机进入，在不再适用时更新或退出。**

至于运行留下的经验怎样反过来改进 Context 管理，又怎样形成自训练，留到下一篇单独说。
