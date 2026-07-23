# 篇章 11：Harness

前面给 Agent 接上了 Typed Tools。它已经能读配装、改装备、跑计算，但我们很快遇到下一个问题：会调用 Tools，不等于会处理业务。

## 什么是Harness？

简单说，Harness 就是模型外面那套帮助它做事的东西。模型负责判断，Harness 把当前信息、可用能力和执行结果接到一起。

## 广义harness会指什么：

这个词没有一条公认的边界。有人只把 Prompt 和 Tool Loop 叫 Harness，也有人把 Context、Skills、Memory、权限、状态和结果检查都算进去。

本文说的是后一种。

## harness和tools/Workflow的关系

| 名词 | 是什么 | 在配装里是什么 |
| --- | --- | --- |
| Tool | 一个具体能力 | 读取配装、生成预览、应用修改 |
| Workflow | 一次任务走过的步骤 | 查询、预览、确认、应用 |
| Harness | 支撑整项业务的环境 | 把当前配装、游戏知识、Tools 和结果检查接起来 |

Tool 决定“能不能做”，Workflow 记录“这次怎么做”，Harness 负责让整件事能够发生。

## harness和skills的关系

| 对比 | Skill | Harness |
| --- | --- | --- |
| 提供什么 | 一组知识或做法 | 完整的做事环境 |
| 模型怎么用 | 看完以后自己决定用不用 | Runtime 按当前业务准备 |
| 是否强制 | 不强制 | 方法不强制，Tool 和写入边界可以强制 |
| 是否管状态 | 通常不管 | 可以接着上一次业务继续 |

Skill 可以告诉模型“通常应该怎么配装”，但它不能保证模型一定照做，也不能拦住一次错误写入。

## harness和context的关系

| 对比 | Context | Harness |
| --- | --- | --- |
| 是什么 | 模型这一轮实际看到的内容 | 决定这一轮应该准备什么 |
| 配装例子 | 当前角色、当前装备、用户要求、Tool Result | 选择这些内容并在下一轮更新 |
| 使用时间 | 一次模型请求 | 可以跨多个回合 |

Context 是这一轮摆在模型面前的材料，Harness 负责准备材料。

## harness和prompts的关系

Prompt 只是把一部分内容交给模型的文字。Harness 还包括 Tool、状态、权限和结果检查，所以不能把 Harness 简化成一份大 Prompt。

## 本项目harness特性：

本项目里有两类规则：

| 规则 | 例子 | 是否强制 |
| --- | --- | --- |
| 真正不能越过的边界 | 能看到哪些 Tools、能改什么、是否审批、结果有没有生效 | 强制 |
| 处理业务时参考的方法 | 先看什么、查什么知识、怎样给候选、什么时候追问 | 强参考 |

我们可以禁止模型调用不该出现的 Tool，却不能规定它必须按哪几句话思考。

### 为什么不能强制：

真实用户经常说不完整，也会中途改条件。同一个问题可能先追问，也可能先查资料；如果把每一步写死，最后得到的只是容易卡住的固定 Workflow。

## 什么是Runtime？ 在整个agent里面扮演什么角色，和harness的关系

模型自己不会一直运行。用户发来消息以后，需要一段程序把 Prompt、Context 和 Tools 交给模型，再把 Tool Result 送回来，这段程序就是 Runtime。

<div class="capability-strip" role="img" aria-label="Harness、Runtime 与 Agent 的关系">
  <div><small>准备什么</small><strong>Harness</strong></div>
  <b>→</b>
  <div class="accent"><small>真的跑起来</small><strong>Runtime</strong></div>
  <b>→</b>
  <div><small>判断与行动</small><strong>Agent + Tools</strong></div>
</div>

Harness 告诉 Runtime 这次应该准备什么，Runtime 负责把它真的跑起来。

## 典型的垂直领域harness：

### 1、垂直领域特性：解决实际问题

通用 Agent 什么都能聊，但每次都要由用户补充背景和判断标准。垂直领域 Agent 做的事情更少，却应该知道项目里的对象是什么、数据从哪里来，以及做到什么程度才算完成。

Multi-agent 解决的是“这件事分给几个 Agent”。垂直领域 Harness 解决的是“这件事本身应该怎么做”，不是同一个问题。

### 2、以本项目为例：

用户不会说“请调用装备修改 Tool”，而会说“给别礼配一套 3+1 潮涌装备”。Agent 得先看当前配装，再查角色和装备知识，给出一套完整候选；用户确认以后才能修改，最后还要回页面确认真的换上了。

```text
当前配装
→ 角色攻略和装备数据
→ 完整候选
→ 用户修正或确认
→ 应用并检查真实页面
```

这是一种常用的做事方法，不是唯一流程。用户只想了解“3+1”时不需要修改；目标不清楚时也可以先追问。

### 3、引入问题求解方法 PSM

知识工程把这种“一类问题通常怎样解决”叫作 **Problem-Solving Method（PSM，问题求解方法）**。它关心的不是某次具体调用，而是任务、方法和领域知识之间的关系。[知识工程对 PSM 的介绍](https://www.cs.vu.nl/~guus/papers/Schreiber07a.pdf)

| 知识工程名词 | Harness / Agent 对应名词 |
| --- | --- |
| Task（任务） | Domain Problem（领域问题） |
| Problem Instance（问题实例） | Transaction（业务事务） |
| Problem-Solving Method（问题求解方法） | Method / Solving Paradigm（求解范式） |
| Domain Model（领域模型） | Domain Knowledge（领域知识） |
| Knowledge Role（知识角色） | Context / Evidence（上下文与证据） |
| Control Structure（控制结构） | Phase / Workflow（阶段与流程） |
| Implementation（实现） | Runtime + Typed Tools（运行时与类型化工具） |

PSM 只是知识工程里用来描述“方法”的概念。Harness 还要把这个方法接到模型、Tools 和真实产品上。

## 垂直领域的知识（游戏知识）:

### 1、游戏知识和harness的关系

Harness 不需要把所有游戏知识都写在自己里面。它只要知道这次该查什么；角色定位、装备数据和攻略结论由各自的知识来源提供。

| 要知道什么 | 去哪里拿 |
| --- | --- |
| 当前队伍和配装 | 产品当前状态 |
| 装备、技能和 BUFF 数据 | Catalog |
| 角色定位和配装建议 | 带来源和条件的游戏知识 |
| 伤害结果 | 公式和计算引擎 |

### 2、问题：写死prompts？实际遇到的迭代问题。

项目早期直接把规则写进 Prompt，确实最快。后来同一条配装规则同时出现在固定 Prompt、Host Prompt、Skill 和 Tool Description 里，改一处就容易漏掉其他地方，模型还可能同时看到新旧两种说法。

这时问题已经不是 Prompt 长，而是谁才是这条规则的主人。

### 3、Typed Tools完成之后、迭代的是什么

Typed Tools 完成以后，读写接口相对稳定。接下来经常变化的，是游戏知识和处理业务的方法。

| 什么变了 | 应该改哪里 |
| --- | --- |
| 产品新增一种读写能力 | Typed Tool |
| 游戏数据或公式变化 | Catalog 或公式 |
| 攻略和适用条件变化 | 游戏知识 |
| 配装通常怎样分析、推荐和修改 | 配装 Harness |
| Session、事务和版本怎样加载 | Runtime |

所以不是继续手改一份全局 Prompt。应该修改对应的 Harness 或知识，Runtime 再把当前需要的内容放进这一轮 Prompt。

## 拆解业务—> 建模，再提PSM概念：

### 1、迭代与管理

如果选人、配装、排轴、BUFF 和计算都塞进同一个 Harness，改配装规则时就可能影响其他业务。把它们分开以后，每项业务可以单独更新、启用和回退。

正在进行的业务继续使用开始时的版本，下一项新业务再使用新版本。这样用户确认方案时，规则不会突然换掉。

### 2、形象的说法：原子化harness

这里的“原子”不是最小步骤，而是一件可以独立做完的业务。“3+1”只是配装条件，四件装备也不是四个 Harness；完整的配装才是一个 Harness。

| 原子 Harness | 负责什么 |
| --- | --- |
| 选人 | 队伍成员和顺序 |
| 配装 | 角色装备与配置 |
| 排轴 | 技能按钮和行动顺序 |
| BUFF | 按钮上的 BUFF 状态 |
| 计算统计 | 计算、比较和归因结果 |

### 3、业务拆分？ No 领域问题求解 Harness ，及其可迭代体系。

这不只是把代码分成五个模块。每一项业务还要有自己的方法、知识、Tools、进行中的状态和完成检查，并且能够独立更新。

最终要建立的是五个领域问题求解 Harness，以及管理它们持续迭代的体系。

## 开发与训练 （未完待续）

训练改变模型本身，Harness 开发改变模型工作的环境。一个问题到底应该训练，还是继续修改 Tools、知识和 Harness，留到下一部分继续。
