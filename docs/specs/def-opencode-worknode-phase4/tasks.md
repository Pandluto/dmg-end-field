# DEF OpenCode Worknode Phase 4 Tasks

> 本文件先记录第四阶段任务大纲。具体任务拆分明日继续展开。

## Task 0：对齐第三阶段遗留问题

- [ ] 复读第三阶段 feedback，确认哪些问题属于前端闭环，哪些属于 tool/runtime 基础建设。
- [ ] 明确第四阶段不以攻略知识库为主线，先补齐 work node 产品闭环。

## Task 1：梳理现有 Work Node 能力

- [ ] 梳理当前已有 REST / typed tools / command queue 能力。
- [ ] 梳理 appdata/localdata work node 的数据结构。
- [ ] 梳理 checkout、restore、patch、validate、diff 的真实行为。
- [ ] 标记缺字段、缺状态、缺 verify 的地方。

## Task 2：设计前端闭环

- [ ] 设计 work node 列表入口。
- [ ] 设计节点详情和 diff 预览。
- [ ] 设计 validate / risk flags 展示。
- [ ] 设计 checkout / restore / discard 操作入口。
- [ ] 明确当前迁出态与 work node 预览态的区分。

## Task 3：边写边补基础建设

- [ ] 如果前端需要结构化 diff，就补 tool 输出。
- [ ] 如果状态机不清楚，就补状态字段。
- [ ] 如果 verify 不够，就补验收工具。
- [ ] 如果 agent prompt 与实际能力不一致，就同步修 prompt。

## Task 4：验收与手测

- [ ] 手测 AI 创建 work node 后前端可见。
- [ ] 手测 patch 后 diff 可见。
- [ ] 手测 validate 结果可见。
- [ ] 手测 checkout 前当前排轴不被污染。
- [ ] 手测 checkout 后当前排轴变化可见。
- [ ] 手测 restore / discard 行为可理解、可验证。

