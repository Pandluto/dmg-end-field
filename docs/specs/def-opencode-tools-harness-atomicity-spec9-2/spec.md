# Spec 9-2：Tool 与 Harness 原子职责研究

## 状态

研究规格已完成，未进入软件开发。

本规格是独立的新一轮研究，不续写已经无效化归档的旧 Spec 9。

## 一、唯一主旨

本轮只研究：

> 如何让 Tool 与 Harness 各自拥有清楚、唯一、可验证的职责，并让 Harness 内部单元可以独立变化而不互相覆盖或冲突。

本轮不以修复某个业务答案为目标，也不以 Harness 整包版本、Session 固定或候选发布为目标。

## 二、必须回答的问题

1. 当前模型行为由哪些真实来源共同决定？
2. 什么叫 Tool 原子，什么叫 Harness 原子？
3. Tool、Host context、Harness、Skill、Knowledge、Response 和 Judge 各自负责什么？
4. 当前八个 Harness slot 是否都具有独立责任？
5. 哪些当前规则被重复写在多个层？
6. 哪些规则必须由代码强制，哪些才适合由 Harness 教学？
7. 冲突发生时如何判定无效，而不是依赖文本顺序？
8. 如何判断一个候选只改变了一个责任假设？

## 三、研究定义

### 3.1 原子

一个原子责任单元必须：

- 只拥有一种决定权；
- 有明确输入和输出；
- 有明确依赖和禁止范围；
- 能独立修改；
- 能独立验证；
- 不要求其他位置重复同一规则。

文件、目录、slot、package 和版本号都不天然等于原子。

### 3.2 Tool

Tool 是可执行能力合同，负责：

- canonical capability identity；
- 精确 input/output；
- 事实范围；
- host/workspace/state 准入；
- permission/approval；
- 一次读取、计算或业务副作用；
- 错误、重试语义；
- postcondition 与审计证据。

Tool 不负责：

- 对用户自然语言做全局任务分类；
- 规定跨 Tool 的完整工作流；
- 规定最终答案的语气和版式；
- 复制 Judge 的验收答案。

### 3.3 Harness

Harness 是模型行为组合，负责：

- 长期 Agent contract；
- 用户意图到 workflow/Skill 的路由；
- 多个安全能力的业务工作流；
- 非实时知识的信任与使用边界；
- 可复用 Skill 的选择；
- 结果表达策略。

Harness 不负责：

- 创造或改变 Tool schema；
- 绕过 host、permission、approval 或 state gate；
- 代替 Tool 判定副作用是否成功；
- 硬编码当前产品事实；
- 携带 evaluator-only 信息。

## 四、研究结论合同

本轮以同目录 [`research.md`](./research.md) 为完整证据记录，并固定以下结论：

1. 当前八槽不是原子职责模型。
2. `toolGuidance` 不应继续作为独立、可手写的规范真相；Tool 本地说明应从 canonical Tool contract 派生，跨 Tool 决策进入 workflow。
3. `skills` slot 只应绑定实际 Skill 及其适用范围，不应复制 `SKILL.md`。
4. 实际 Skill 是一种有边界的可复用 workflow，不应成为第二套全局 Harness。
5. Host context 只注入当前事实，不夹带 Tool 路由、重试和回复命令。
6. 权限、审批、状态、事务、错误和 postcondition 由 Tool/Host 可执行边界唯一拥有。
7. Harness router 只选择 workflow/Skill 入口；workflow 只按 typed state 组合能力；response policy 只负责表达。
8. Harness 单元之间不得依赖拼接先后解决矛盾。
9. 同一决定出现两个 owner 时，组合必须判为无效。
10. 一个原子候选不应要求同步重写多个单元的同义规则。

## 五、当前八槽的处置结论

| slot | 结论 |
| --- | --- |
| `agentContract` | 保留，限制为跨任务恒定的不变量 |
| `roleCards` | 可选；无真实角色差异时不加载占位符 |
| `knowledgePacks` | 保留，只放带来源和范围的非实时知识 |
| `skills` | 改为 Skill reference/binding，不复制 Skill 内容 |
| `routingPolicy` | 保留，只做 intent → workflow/Skill |
| `toolGuidance` | 取消独立手写规范责任，改由 Tool contract 派生或并入 workflow 的具体步骤 |
| `responsePolicy` | 保留，只负责已确定结果的表达 |
| `workflows` | 保留，只做基于 typed state 的跨能力状态机 |

这是一项职责研究结论，不是本轮代码迁移授权。

## 六、冲突判定

以下任一情况都表示原子化失败：

- Harness 重写 Tool schema、permission、approval、错误或 postcondition；
- Tool 描述规定完整跨 Tool 路由或最终回复文案；
- Skill 重复全局 Agent contract、router 或 response policy；
- Host context 同时提供事实并命令模型采取某个业务流程；
- Knowledge 覆盖当前 typed fact；
- 两个 route 对同一触发范围都声称唯一入口；
- 两个 Harness 单元拥有同一决定；
- workflow 引用 Tool contract 中不存在的状态或字段；
- candidate 需要同步修改多个单元中的同义规则；
- 组合结果依赖“后出现的文字赢”。

## 七、最小交付物

本轮交付且只交付：

- `research.md`：当前实现证据、问题分析和目标责任模型；
- `spec.md`：研究范围、定义、固定结论和验收标准；
- `tasks.md`：研究任务与完成记录；
- Spec 总索引入口。

## 八、验收标准

研究完成必须同时满足：

- 覆盖所有实际行为来源，而不只检查 `agent/harness/`；
- 用当前代码指出至少一个跨层重复和一个真实矛盾；
- 给出 Tool 与 Harness 的唯一职责边界；
- 对现有八个 slot 逐一给出处置结论；
- 给出 Skill、Knowledge、Host context 和 Judge 的归属；
- 给出不依赖文本优先级的冲突规则；
- 给出原子 candidate 的判定标准；
- 用多个不同业务场景验证同一责任模型；
- 不把版本化、Session 固定或具体业务术语提升为主旨；
- 不实施任何运行时代码修改。

## 九、明确不做

本轮不做：

- Tool registry 合并；
- Tool schema 或 handler 改造；
- Harness slot schema 改造；
- prompt、Skill 或 Knowledge 内容迁移；
- 组合器、lint 或冲突检查器实现；
- Harness package、channel、promotion、rollback 或 Session binding 改造；
- 任何产品功能、业务算法、UI 或 Electron 改动；
- 自动化测试或真实 Agent 回归。

如需实施，必须由用户另行确认目标和范围，并建立新的实施规格。

## 十、完成定义

当同目录研究能够让后续开发者对每条规则回答以下问题时，本规格完成：

1. 谁拥有这条决定？
2. 它的输入输出是什么？
3. 哪些层只能消费它，不能重写它？
4. 与另一单元重叠时为什么应判冲突？
5. 修改它时哪些相邻责任必须保持不变？

本轮已经满足上述条件。完成不表示当前代码已经原子化，只表示原子化的职责边界已经研究清楚。
