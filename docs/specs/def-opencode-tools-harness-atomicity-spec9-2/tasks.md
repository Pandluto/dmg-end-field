# Spec 9-2 Tasks：Tool 与 Harness 原子职责研究

## 状态

研究任务已完成。

本文件只执行同目录 [`spec.md`](./spec.md) 的研究目标，不包含软件开发任务。

## Task 1：盘点真实行为来源

- [x] 检查 Harness 包结构、slot 验证和最终组合方式。
- [x] 检查 stable 与主题 candidate 的跨槽变更。
- [x] 检查固定 Workbench Agent prompt。
- [x] 检查每回合 Host context/checkout prompt。
- [x] 检查 runtime Skills。
- [x] 检查模型侧 Tool schema、描述、wrapper 和回合门禁。
- [x] 检查 REST Tool definitions、registry、准入、handler 和产品命令验证。
- [x] 确认旧无效 Spec 9 不作为研究输入。

## Task 2：识别非原子职责

- [x] 证明当前 slot 只具有结构边界，没有语义责任边界。
- [x] 识别同一规则跨 Harness slot 重复。
- [x] 识别固定 prompt、Skill、Harness 和 Tool 描述之间的重复。
- [x] 识别声明式 routing 与可执行 routing 的混合。
- [x] 识别 Tool contract 在多份 registry/adapter 中分散。
- [x] 找到“当前节点”规则的直接冲突证据。
- [x] 区分应保留的可执行安全边界与可迁移的模型教学。
- [x] 说明 package hash/Session 固定为什么不能证明职责原子化。

## Task 3：建立目标职责模型

- [x] 定义“原子”不是文件、slot 或 package。
- [x] 定义 Tool contract、admission、executor、result 和 verifier 的责任。
- [x] 定义 Agent contract、role、knowledge、Skill、router、workflow 和 response 的责任。
- [x] 定义 Host context 只提供当前事实。
- [x] 定义 Judge 与 Worker/Harness 隔离。
- [x] 对现有八个 Harness slot 逐一给出处置结论。
- [x] 建立唯一决定权矩阵。
- [x] 建立组合冲突与无效判定。
- [x] 建立最小责任卡和原子 candidate 判定标准。

## Task 4：用不同场景校验模型

- [x] 校验当前节点只读查询的职责分配。
- [x] 校验精确技能事实查询的职责分配。
- [x] 校验干员配置 mutation 的职责分配。
- [x] 确认模型不依赖某个具体业务术语。

## Task 5：主旨与工作树检查

- [x] 文档只研究职责，不编写实现方案或代码任务。
- [x] 不把 Harness 版本化、Session pinning、promotion 或 rollback 作为目标。
- [x] 不修改 runtime、Tool、Harness、Skill、UI 或业务代码。
- [x] 不纳入用户已有的 `data/sharedata/**` 工作树变化。
- [x] 更新 Spec 总索引。
- [x] 提交本轮 research/spec/tasks 文档。

## 交付边界

本轮到研究结论和文档提交为止。

以下内容即使方向合理，也不属于本轮 Task：

- 合并 Tool registry；
- 生成 canonical Tool contract；
- 拆固定 prompt 或 `timeline-workbench` Skill；
- 删除或重命名 Harness slot；
- 实现责任 lint、依赖图或冲突检查器；
- 迁移 stable/candidate 内容；
- 运行真实 Agent 行为回归。

这些工作需要用户另行确认后建立新的实施规格，不能由本研究自行扩张。
