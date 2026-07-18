# Agent 开发随记

写 DEF Agent 的时候，许多概念不是一开始就摆在桌面上的。通常是先让模型调用一个工具，随后发现权限要单独处理；对话跑久了，又要考虑上下文和压缩。这些笔记把类似的问题记在一起，方便以后回看。

第一次读，可以顺着下面的顺序走。以后碰到某个词，再回来单独查也行。

笔记里会反复用到一个简单任务：**读取当前配装，准备把一名角色的武器换掉，并说明发生了什么**。它不覆盖所有场景，只是让前后几页谈论的是同一件事。

1. [从聊天到 Agent](./00-chat-to-agent.md)
2. [Tool Use：让模型碰到外部世界](./01-tool-use.md)
3. [Permission 与 Hook](./02-permission-and-hooks.md)
4. [上下文、Skill 与 Memory](./03-context-skill-memory.md)
5. [Plan、Task 与 Subagent](./04-plan-task-subagent.md)
6. [这些概念在 DEF 里怎样落地](./05-def-and-opencode.md)
7. [开发者自己的 Skill](./06-developer-skill.md)

项目实现有变化时，以[架构事实源](../../architecture/README.md)为准。
