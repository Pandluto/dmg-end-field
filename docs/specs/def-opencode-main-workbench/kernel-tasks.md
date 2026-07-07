# def-opencode 主界面 Agent Kernel Tasks

## Status

已执行 Task 1-5。Task 6 保持临时重复清单，等待后续共享模块改造。

本任务集接在 `quick-fixes.md` 之后。quick fixes 到此为止，后续不再继续把能力堆进快照回答器，而是引入最小 DEF Agent Kernel。

## Goal

把主界面 def-opencode 从“prompt + REST 队列 + UI 兜底回答器”推进到“目标建模 + schema 校验 + 执行结果 + verifier”的最小架构。

第一阶段不追求完整 opencode tool/plugin 深集成，但要让 DEF 自己拥有明确的 agent kernel 边界。

## Kernel Shape

第一阶段新增一个轻量 TypeScript kernel：

```text
src/agentKernel/mainWorkbench/
  commandSchema.ts
  goalModel.ts
  verifier.ts
  answer.ts
  index.ts
```

职责：

- `commandSchema.ts`：声明支持的 op、最小 schema 校验、错误结构。
- `goalModel.ts`：从用户文本和快照中识别只读目标 / 变更目标的最小目标对象。
- `verifier.ts`：基于目标、命令结果、快照判断是否完成。
- `answer.ts`：把 verified result 转成 UI 可读回复。
- `index.ts`：暴露稳定 API，避免 UI 组件直接散落业务判断。

## Task List

### Task 1: 抽出主界面命令 schema

- 新增 `src/agentKernel/mainWorkbench/commandSchema.ts`。
- 维护 `MAIN_WORKBENCH_SUPPORTED_OPS`。
- 提供 `validateMainWorkbenchCommand(command)`。
- 提供 `validateMainWorkbenchCommands(commands)`。
- REST enqueue 和前端可复用同一套 op 列表。

验收：

- 未知 op 能被 schema 层拒绝。
- `addBuff` 缺少 `buff` 在 schema 层返回业务错误。
- `setTargetResistance` 缺少 `buttonId` 或 `targetResistance` 返回业务错误。

### Task 2: 抽出只读目标模型

- 新增 `src/agentKernel/mainWorkbench/goalModel.ts`。
- 支持识别：
  - `buffSummary`
  - `buffDetail`
  - `equipmentSummary`
  - `buttonSummary`
  - `topDamage`
  - `damageSummary`
  - `selectionSummary`
- 目标对象必须包含 `kind` 和可选 `characterNames`。

验收：

- `莱万汀有哪些 buff` -> `buffSummary` + `characterNames:["莱万汀"]`
- `详细列出莱万汀每个按钮的 buff` -> `buffDetail`
- `莱万汀最高伤害的技能是哪个` -> `topDamage`
- `莱万汀的装备有哪些` -> `equipmentSummary`

### Task 3: 抽出快照回答器

- 新增 `src/agentKernel/mainWorkbench/answer.ts`。
- 从 `MainWorkbenchAiPanel.tsx` 移出：
  - Buff 汇总/明细回答。
  - 装备回答。
  - 按钮列表回答。
  - 最高伤害回答。
  - 伤害摘要回答。
  - 默认已选干员回答。

验收：

- UI 组件不再直接承载大段快照业务回答逻辑。
- 回答器输入为 `goal + snapshot`。
- 回答器输出纯文本。

### Task 4: 引入最小 verifier

- 新增 `src/agentKernel/mainWorkbench/verifier.ts`。
- 先覆盖本轮已有验证：
  - mutating prompt 必须有 `done` 的实质命令。
  - 任一 `error` 命令直接失败。
  - 任一当前轮 `pending/running` 命令返回未确认。
- 暂不做完整领域目标字段校验。

验收：

- `MainWorkbenchAiPanel` 不再直接判断 `hasPromptRequiredCommand`。
- verifier 返回结构化结果：`success | pending | failed`。

### Task 5: UI 接入 kernel

- `MainWorkbenchAiPanel.tsx` 调用 kernel：
  - `inferMainWorkbenchGoal`
  - `buildMainWorkbenchSnapshotAnswer`
  - `verifyMainWorkbenchTurn`
- UI 只保留状态管理、流式事件和展示。

验收：

- 现有手测问题仍能回答。
- 文件内业务判断明显减少。

### Task 6: REST 接入 command schema

- `scripts/ai-cli-rest-server.mjs` 作为 Node ESM 脚本，短期不能直接 import TS kernel。
- 本阶段允许同步一份 op 列表，但需加注释标明与 `commandSchema.ts` 保持一致。
- 后续任务再考虑把 REST server 的命令校验迁移到可运行 JS 共享模块。

验收：

- REST 行为保持当前快修结果。
- 文档明确这是临时重复，不是最终架构。

## Task Review

### 本轮执行范围

本轮执行 Task 1-5，Task 6 只做注释和一致性确认。

执行结果：

- Task 1: 已新增 kernel command schema。
- Task 2: 已新增 goal model。
- Task 3: 已抽出快照回答器。
- Task 4: 已抽出 turn verifier。
- Task 5: 已接入 `MainWorkbenchAiPanel.tsx`。
- Task 6: 未迁移 REST import，保持既有 Node ESM 白名单。

理由：

- Task 1-5 能真正把 UI 业务判断迁到 kernel。
- 不需要改 opencode adapter。
- 不需要一次性实现 batchId、repair loop 或 tool plugin。

### 本轮不执行

- 不做 batchId / turnId 全链路。
- 不做 Buff 名称解析工具。
- 不做 executeBatch 事务。
- 不做 opencode plugin tool 注册。
- 不做长期 memory/skill 学习层。

### 风险

- goalModel 第一版仍是启发式，不是完整 NLU。
- answer 抽出后可能影响现有快照回答格式，需要保留手测清单。
- verifier 第一版仍不检查每个领域目标字段，只是从 UI 兜底迁到 kernel。

## Execution Order

1. 新增 kernel 文件。
2. 迁移只读回答逻辑。
3. 迁移 turn verification 逻辑。
4. 接入 UI。
5. 跑 `npm run build`。
6. 跑 `npm test`。
7. 确认 `npm run electron:dev` 仍可运行。
