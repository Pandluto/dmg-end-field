# Agent 开发随记

这些笔记来自 DEF Agent 的开发过程。

问题通常一个接一个出现：

- 模型要调用工具；
- 工具需要权限；
- 对话变长，需要压缩；
- 经验变多，需要 Skill。

第一次读，可以按目录顺序走。

以后查概念，直接打开对应笔记。

贯穿示例只有一个：

> 读取当前配装，准备更换武器。

1. [从聊天到 Agent](./00-chat-to-agent.md)
2. [Tool Use：让模型碰到外部世界](./01-tool-use.md)
3. [Permission 与 Hook](./02-permission-and-hooks.md)
4. [上下文、Skill 与 Memory](./03-context-skill-memory.md)
5. [Plan、Task 与 Subagent](./04-plan-task-subagent.md)
6. [这些概念在 DEF 里怎样落地](./05-def-and-opencode.md)
7. [运行中的状态、持久化与恢复](./06-state-persistence-recovery.md)
8. [开发者自己的 Skill](./07-developer-skill.md)

项目实现有变化时，
以[架构事实源](../../architecture/README.md)为准。
