# 上下文、Skill 与 Memory

模型准备下一步时，
需要看到几类材料：

- 用户目标；
- 当前配装；
- 可用工具；
- 已有对话。

它们共同组成当前 Context。

## System Prompt 不是一整块

实际项目通常分成两部分。

稳定部分：

- Agent 身份；
- 基本规则；
- 通用工具说明。

动态部分：

- 当前任务；
- 选中对象；
- 刚加载的知识。

动态内容按本轮状态加入。

## Context Window 有上限

上下文装不下全部历史。

接近上限时，
系统会做 Compaction：

- 总结较早对话；
- 裁掉旧工具输出；
- 保留近期原文。

压缩不等于删除记录。

两者关注点不同：

| 概念 | 回答的问题 |
|---|---|
| Session History | 发生过什么 |
| Context | 模型此刻看到什么 |
| Compaction | 哪些内容继续进入 Context |

Prompt Cache 是性能优化。

它复用相同请求前缀，
减少成本或延迟。

它不负责记忆，
也不替代 Compaction。

## Skill、Knowledge 与 Memory

资料不能全部塞进 System Prompt。

Skill 可以按需加载。

运行时先暴露名称和描述。

任务命中后，
再加载流程、引用或脚本。

仍以调整配装为例：

| 类型 | 示例 |
|---|---|
| Skill | 读取、核对、预览、审批的步骤 |
| Knowledge | 武器属性和角色机制 |
| Memory | 用户不想替换限定武器 |

某次 Tool Result，
不会自动变成 Memory。

Skill 也不是事实数据库。

Context 决定现在看到什么。

Memory 决定长期保留什么。

任务怎样拆分，
见 [Plan、Task 与 Subagent](./04-plan-task-subagent.md)。
