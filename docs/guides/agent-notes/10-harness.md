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

垂直领域 Harness 会围绕一类反复出现的业务问题，固定组织领域知识、Tools、权限与审查机制。它不替 Agent 写死解法，而是让 Agent 根据每一次真实 Context 临场判断，并让关键操作可以被检查和追踪。

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

这也给了我们一个更具体的方向：既然 Tool 可以注册，Context 为什么不能注册？

## 从 Harness 拆出 Context 原子

我们一开始把这件事叫作“原子化 Harness”。

这个名字很容易让人误会：仿佛要先规定若干个“小 Harness”，再把每一项业务塞进去。

其实不是。

Harness 是整体。真正被拆出来、可以继续增加的原子，不必再叫 Harness。它就是一份 **Context Source（上下文源）**。

> **Context Source 是一份可以独立注册的 Context。它说明自己提供什么、什么时候需要，以及进入 Agent Loop（智能体循环）的哪个位置。**

原子的数量当然不固定。以后多一种知识、多一种 Tool 用法，或者多一种 Tool Result 的解释方式，都可以继续增加新的 Context Source。

### 像注册 Tool 一样注册 Context

Tool Registry（工具注册表）不会只保存一段 Tool 代码。它还要让系统知道这个 Tool 是什么、能做什么、怎样调用，以及调用发到哪里。

Context Registry（上下文注册表）要回答的是另一组问题：

| Tool Registry | Context Registry |
| --- | --- |
| 这是什么能力？ | 这是什么 Context？ |
| 什么情况下可以找到它？ | 什么情况下需要它？ |
| 输入和输出是什么？ | 来源和呈现内容是什么？ |
| 调用路由到哪里？ | 它进入 Agent Loop 的哪个位置？ |
| Tool 执行后返回什么？ | 状态变化后怎样更新或移除？ |

这张表不是要把模型的判断重新写死。Registry 只负责让每个 Context 原子有名字、有来源、有位置；模型仍然根据这些 Context 判断下一步。

### “位置”到底在哪里？

Context 不会异步插进一个正在执行的 Tool 中间。

对模型可见的 Context，最终都要在一次模型调用开始前到位：

```text
Context Sources
→ 在模型调用前组装
→ 模型决定是否调用 Tool
→ Tool 执行并返回结果
→ Context Sources 根据新状态刷新
→ 在下一次模型调用前重新组装
```

所以：

- “Tool 调用前的 Context”，是产生这次 Tool Call（工具调用）的模型回合开始前已经可见的内容；
- “怎样调用 Tool”的 Context，也在这个位置成为方法参考；
- “Tool 调用后的 Context”，是在 Tool Result 落定以后、下一次模型回合开始以前进入的内容。

硬能力仍然属于 Tool。Context Source 告诉模型当前有什么、可以怎样理解和使用；Tool Schema（工具结构定义）与 Handler（处理器）继续决定程序真正怎样执行。

这也是“非强制，但强参考”在工程上最直观的样子：方法没有被藏在一份可能不加载的目录里，也没有被写成唯一 Workflow；它被放到真正需要它的 Context 位置。

<details>
<summary>展开：OpenCode 已经使用的几个名字</summary>

OpenCode 当前把一个可独立观察、拥有稳定 key（键）、可以单独刷新和渲染的值叫作 **Context Source**。

多个 Context Sources 由 **System Context Registry（系统上下文注册表）** 注册和组合。第一次模型调用时，它们形成初始 Context；后续状态变化，则在 Tool Result 等内容落定以后、下一次模型调用以前进入。

这个位置叫 **Safe Provider-Turn Boundary（安全模型回合边界）**。

此前的一轮项目实现里，我们还使用过 **Bound Context Source（绑定上下文源）**：它强调某份 Context 绑定到一个具体阶段，而不是永远占据全局 Prompt。

[HarnessX](https://arxiv.org/abs/2606.14249)把可组合的 Harness 部件称为 Typed Harness Primitives（类型化 Harness 原语）。名称并不统一，但它提供了一个相近的思路：Harness 可以从一块整体，变成可以定位和单独调整的组成部分。

</details>

## Typed Tools 完成之后，迭代的是什么？

Typed Tools 完成，只表示 Agent 的手相对稳定了。

之后长期变化的，是它在每个位置拿到的 Context：

- 配装方法变了，修改对应的方法 Context；
- 攻略变了，更新知识来源；
- 新增 Tool，补上它的用途和调用前 Context；
- Tool Result 结构变了，调整调用后的解释 Context；
- 出现一种新问题，注册新的 Context Source。

这些改变不需要预先凑成固定数量的业务，也不需要重写一份总 Prompt。

Context Source 有稳定身份以后，变化才有位置；Registry 能增加、移除和组合它们以后，Harness 才真正变得可管理。

## 先停在这里

绕了一圈，Harness 仍然是最合适的主名称。

因为它说的是领域知识、问题求解方法、Context、能力、状态和运行条件围绕 Agent 形成的整体，而不是其中某一个 Context Source。

它不替模型预先解完问题，也不要求模型走唯一的路。它把需要的 Context 放到相应的位置，让方法成为**非强制，但强参考**。

所以本篇最后留下的，不是一张固定配装流程图，也不是一组固定数量的“小 Harness”，而是这样一个理解：

> **Harness 是整体；Context Source 是可以注册、增加、组合并绑定运行位置的原子。**

至于运行留下的经验怎样反过来改进这些 Context Sources，又怎样形成自训练，留到下一篇单独说。
