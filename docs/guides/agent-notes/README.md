# Agent 开发随记

第一次给模型接上工具，很容易以为 Agent 已经做完了。等它真的开始读数据、改状态，问题才一个接一个出现：工具怎么描述，谁来批准修改，对话太长怎么办，程序中途退出又该从哪里继续。

这组笔记沿着一次真实开发过程往下写。它不是术语大全，也不要求先懂 OpenCode；每一页只回答当前遇到的问题，再自然带出下一个概念。

为了让前后说的是同一件事，文中会反复使用一个小任务：**读取当前配装，准备替换一名角色的武器，并说明最终是否真的换上。**

## 从哪里开始

| 此刻遇到的问题 | 接着看 |
| --- | --- |
| 模型为什么回答得了问题，却不能自己完成操作 | [从聊天到 Agent](./00-chat-to-agent.md) |
| 模型怎样准确调用程序里的能力 | [Tool Use：让模型碰到外部世界](./01-tool-use.md) |
| 参数正确以后，谁来决定这次操作能不能做 | [Permission 与 Hook](./02-permission-and-hooks.md) |
| 对话、知识与长期记忆应该放在哪里 | [上下文、Skill 与 Memory](./03-context-skill-memory.md) |
| 任务变大以后，怎样规划和分工 | [Plan、Task 与 Subagent](./04-plan-task-subagent.md) |
| 这些概念在当前项目里怎样连成一条链 | [这些概念在 DEF 里怎样落地](./05-def-and-opencode.md) |
| 工具卡住、进程退出或响应丢失后怎么办 | [运行中的状态、持久化与恢复](./06-state-persistence-recovery.md) |
| 哪些重复开发经验适合整理成 Skill | [开发者自己的 Skill](./07-developer-skill.md) |
| 页面、正式节点和 AI 会话怎样避免各说各话 | [AI 进入 Workbench 以后，谁才算“当前”](./08-workbench-state-machine.md) |
| 内置 Agent 之外，MCP 怎样成为另一种解决路线 | [MCP 作为另外一种解法](./09-mcp-as-another-solution.md) |
| 篇章 11：Harness | [Harness（待补充）](./10-harness.md) |

这里讲的是理解 Agent 所需的主干。项目实现继续变化时，以[架构事实源](../../architecture/README.md)为准。

如果想集中浏览并点击查看名词解释，可以使用[本地网页预览](./web/README.md)。
