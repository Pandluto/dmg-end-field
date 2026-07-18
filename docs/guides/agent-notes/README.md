# Agent 开发随记

这些笔记不是 Agent 百科，也不打算把仓库里出现过的名词全抄一遍。它们记录的是开发过程中反复遇到的几个问题：模型怎么从回答问题变成连续做事，工具为什么要有类型，权限应该卡在哪里，上下文装不下怎么办，Skill、Memory 和 Subagent 又各自解决什么。

第一次读，可以顺着下面的顺序走。以后碰到某个词，再回来单独查也行。

1. [从聊天到 Agent](./00-chat-to-agent.md)——先把 LLM、Session 和 Agent Loop 放到同一张图里。
2. [Tool Use：让模型碰到外部世界](./01-tool-use.md)——工具如何注册、调用，又如何把结果交还给模型。
3. [Permission 与 Hook](./02-permission-and-hooks.md)——哪些事能做，哪些事必须停下来问人。
4. [上下文、Skill 与 Memory](./03-context-skill-memory.md)——模型看到了什么，装不下时怎么办，长期信息应该放哪里。
5. [Plan、Task 与 Subagent](./04-plan-task-subagent.md)——任务变大以后，规划、状态和分工怎样拆开。
6. [这些概念在 DEF 里怎样落地](./05-def-and-opencode.md)——用当前项目做一次完整串联。
7. [开发者自己的 Skill](./06-developer-skill.md)——把反复使用的工作方法整理成可路由、可复用的能力。

这里有意省略了许多实现名词。只有当一个细节真的影响理解时，它才会出现。更精确的系统边界仍以[架构事实源](../../architecture/README.md)为准。

