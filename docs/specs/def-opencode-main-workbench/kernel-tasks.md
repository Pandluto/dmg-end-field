# def-opencode 主界面 Agent Kernel Tasks

## Status

已执行 Task 1-5。Task 6 保持临时重复清单，等待后续共享模块改造。Task 7-10 已完成，用于解除只读回答硬编码、恢复 def-agent 连续上下文，并统一 UI/REST 的只读 evidence/focus runtime。Task 11 记录前端专项，不在本轮底层架构 coding 中执行。Task 12 已完成，用于修正 removeBuff 别名字段和防误删边界。Task 13 已完成，用于共享主界面命令 schema runtime，减少 REST/UI 协议漂移。Task 14 已完成，用于给批量命令补批次级观测。Task 15 已完成，用于把批次摘要暴露给 def-agent 工具说明。Task 16 待执行，用于让 verifier 使用批次证据。

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

### Task 7: 只读证据交给 def-agent（已完成）

- 已移除 AI 面板中只读查询的本地短路回答。
- 已构建主界面只读证据包，包含：
  - 已选干员。
  - 技能按钮位置与按钮 id。
  - 每个按钮已选 Buff。
  - 装备配置。
  - 伤害报告摘要。
- 已把证据包放入 def-agent prompt，让模型自行组织答案。
- `answer.ts` 保留为故障兜底，不再作为正常只读路径。
- 同一主界面上下文中已使用 `sendDefAgentContinue` 续写已有 session，不再每轮清空会话。

验收：

- “莱万汀第一次燃烬”后追问“有什么 Buff 吗”，不得退回莱万汀全角色 Buff 汇总。
- “莱万汀第一次燃烬有什么 Buff”应能回答按钮级 Buff；若该按钮无 Buff，应明确说该按钮无 Buff。
- 只读查询不投递变更命令。
- def-agent 不可用时仍可使用本地快照回答器作为 fallback。
- `npm run build` 已通过。
- `npm test` 已通过。
- 静态检查已确认只读短路分支移除，正常路径注入 `MAIN_WORKBENCH_READONLY_EVIDENCE`。
- 离线 22 按钮 work node 已验证按钮级 Buff 证据不会被角色级唯一 Buff 汇总覆盖。

风险：

- 只读证据包会增加 prompt 体积；当前已控制按钮与 Buff 字段，不直接塞完整业务对象。
- 模型仍可能答错指代；本轮以连续会话和按钮级证据降低概率，后续可增加显式 focus evidence。
- 当前运行态已切到另一组干员且按钮数为 0，无法在不污染用户现场的情况下复现用户给出的莱万汀排轴手测。

### Task 8: 结构化 focus evidence（已完成）

- 已在 main workbench kernel 中新增只读焦点解析：
  - 支持 `角色 + 第 N 次/第 N 个 + 技能名`。
  - 支持 `角色-技能@行-列` 或自然语言行列定位。
  - 支持常见错字/别名的轻量归一化，例如 `燃尽` 指向 `燃烬`。
- evidence 包已新增：
  - `focus`：本轮从 prompt 解析出的技能按钮焦点。
  - `previousFocus`：上一轮主界面会话保存的焦点。
- AI 面板已在当前浏览器会话中保存最近焦点，用于下一轮“它/刚才那个/有什么 Buff”追问。
- focus 只属于当前迁出态上下文，不写 appdata work node，不与 work node branch/commit/rollback 混用。

验收：

- “莱万汀第一次燃尽”可解析到当前快照中第一个匹配的莱万汀-燃烬按钮。
- 紧接着追问“有什么 Buff 吗”时，evidence 带上 previousFocus。
- focus 按钮的 Buff 列表是按钮级，不是角色级/全局唯一 Buff 汇总。
- 无匹配焦点时不编造焦点，只给出候选按钮或保持 focus 为空。
- `npm run build` 已通过。
- `npm test` 已通过。
- 临时 SSR 验证已确认 `莱万汀第一次燃尽` -> `莱万汀-燃烬@1-1`，追问携带 previousFocus，按钮级 `buffCount=0`。
- 临时 SSR 验证已确认 `莱万汀有哪些 Buff` 不会误设按钮 focus，仍保留角色级查询空间。

风险：

- 轻量文本解析仍可能误判复杂中文指代；后续应让 def-agent 通过 read tool 自行请求 focus 候选。
- 如果用户在两轮之间手动大改排轴，previousFocus 可能过期；本轮应通过 button id 仍存在与否判断焦点是否有效。
- Vite SSR 临时验证在当前沙箱会打印 HMR 端口 EPERM 噪音，但断言已通过。

### Task 9: REST 只读 evidence/focus 接口（已完成）

- 已在 `scripts/ai-cli-rest-server.mjs` 增加：
  - `GET /api/main-workbench/evidence`
  - query: `prompt`
  - query: `previousButtonId`
- 接口从 `MAIN_WORKBENCH_SNAPSHOT_KEY` 读取当前迁出态快照。
- 接口返回结构化 evidence：
  - `selectedCharacters`
  - `buttons`
  - `focus`
  - `previousFocus`
  - `equipment`
  - `damageReport`
- 接口只读，不写 command queue、不写 snapshot、不写 appdata work node。
- 已更新 `src/aiCli/aiCliRestAdapter.ts` 的 main workbench 指引，让 def-agent 优先读取 evidence endpoint 处理只读问题。

验收：

- `GET /api/main-workbench/evidence?prompt=莱万汀第一次燃尽` 可返回按钮级 focus。
- `previousButtonId` 仍存在时可返回 previousFocus。
- 角色级问题不误设按钮 focus。
- `GET /api/main-workbench/evidence` 不改变 command queue。
- `node --check scripts/ai-cli-rest-server.mjs` 已通过。
- `npm run build` 已通过。
- `npm test` 已通过。
- 17329 独立 REST smoke 已通过：focus/previousFocus 命中 `莱万汀-燃烬@1-1`，调用前后 command queue id 列表一致。

风险：

- REST 端会与 TS kernel 暂时重复一份 evidence/focus 逻辑；后续应抽成运行时共享 JS 模块。
- 只读接口暴露的是 current checkout snapshot，不是 appdata work node；文档和响应字段必须持续强调。
- 测试服务会读取既有本地 command queue，因此只读性用 before/after 队列 id 一致验证，而不是要求队列为空。

### Task 10: 共享 evidence/focus runtime（已完成）

- 已新增浏览器与 Node REST 都能 import 的 `evidenceRuntime.mjs`。
- 已将 focus 解析、previousFocus 校验、按钮级 evidence、装备/伤害 evidence 构建迁入共享模块。
- `src/agentKernel/mainWorkbench/answer.ts` 保留 fallback 文本回答和 evidence 字符串包装，正常只读路径继续把证据交给 def-agent。
- `scripts/ai-cli-rest-server.mjs` 已删除本地重复 focus/evidence 实现，改为 import 共享模块。
- 已提供 `.d.ts` 类型声明，并在 TS 侧使用 typed wrapper 保持调用边界。

验收：

- `buildMainWorkbenchSnapshotEvidence` 与 `GET /api/main-workbench/evidence` 共享同一套 runtime。
- `莱万汀第一次燃尽` 的 focus 结果在 UI evidence 与 REST evidence 中一致。
- `previousFocus` 过期时两条路径都标记 stale。
- `node --check scripts/ai-cli-rest-server.mjs` 已通过。
- `node --check src/agentKernel/mainWorkbench/evidenceRuntime.mjs` 已通过。
- `npm run build` 已通过。
- `npm test` 已通过。
- 共享 runtime 直测已通过：`莱万汀第一次燃尽` 命中 `莱万汀-燃烬@1-1`，`previousButtonId=b2` 保留为 `莱万汀-燃烬@1-5`。
- 17329 独立 REST smoke 已通过：同一输入命中相同 focus/previousFocus，读取 evidence 前后 command queue id 列表一致。

风险：

- `.mjs + .d.ts` 会引入跨 TS/Node 的维护成本；后续若 REST 可以直接使用构建产物，可再收敛。
- `src/vite-env.d.ts` 当前为 `.mjs` import 提供了通用声明，后续若继续增加 `.mjs` 模块，应收窄声明或迁移到更明确的共享包边界。
- 移动共享逻辑时要确保不把 fallback 文本回答器重新变成正常只读路径。

### Task 11: AI 面板前端展示专项（记录，待后续执行）

- 统一接入全局 markdown 渲染库。
- 隐藏或折叠底层工具调用/DSML 片段，避免把协议噪音直接暴露给用户。
- 对长输出提供摘要、展开原文、查看日志的分层展示。
- 为批量命令增加批次级进度、失败点、已完成摘要和剩余命令展示。
- 在 UI 文案中区分：
  - `localStorage` / `sessionStorage` 当前迁出态。
  - 用户排轴快照。
  - appdata/localdata AI work node。
- 为 appdata work node diff / checkoutDecision 补可视化审核面板。

验收：

- markdown 表格、列表、粗体、代码块在 AI 面板中展示稳定。
- 批量删除 Buff 等场景不直接露出 DSML/tool call 原文。
- 批量命令能看到批次总数、已完成数、失败点和剩余数。
- 回退入口明确标注是用户快照还是 appdata work node basePayload。

风险：

- 前端专项不应阻塞当前底层 agent kernel 和 appdata work node 继续迭代。
- 修 UI 时不得改变 command queue、evidence、work node 的事实源边界。

### Task 12: removeBuff 参数归一与防误删（已完成）

手测暴露问题：模型投递批量 `removeBuff` 时使用了 `buffDisplayName` 字段。该字段不在当前 canonical command 类型中；如果执行器忽略它，可能退回到按钮首个 Buff，形成误删风险。

- 已扩展 canonical command，允许 `removeBuff.buffDisplayName` 作为兼容别名。
- REST/schema 层已将 `buffDisplayName` 归一化为可执行的 `displayName`，并保留原字段供审计。
- renderer `removeBuff` 匹配时已支持 `buffDisplayName`。
- 当 `removeBuff` 未提供 `buffId` / `displayName` / `name` / `buffDisplayName` 且没有 `all:true` 时，命令会失败。
- 当提供了 Buff 条件但无匹配时，命令会失败，不再 fallback 到第一个 Buff。
- 删除按钮全部 Buff 必须显式 `all:true`。

验收：

- `removeBuff { buttonId, buffDisplayName:"长息·队友伤害+16%" }` 只删除显示名匹配的 Buff。
- `removeBuff { buttonId, buffDisplayName:"不存在" }` 不删除任何 Buff，并返回错误。
- `removeBuff { buttonId }` 不删除任何 Buff，并返回错误提示需要指定 Buff 或 `all:true`。
- `removeBuff { buttonId, all:true }` 才允许删除该按钮全部 Buff。
- `node --check scripts/ai-cli-rest-server.mjs` 已通过。
- `npm run build` 已通过。
- `npm test` 已通过。
- 17329 隔离 REST smoke 已通过：
  - 无 selector 的 `removeBuff` 返回 `invalid-main-workbench-remove-buff`。
  - `buffDisplayName:"长息·队友伤害+16%"` 入队时带上归一化后的 `displayName`。

风险：

- 这会收紧旧行为；若已有 agent 依赖“不写 Buff 条件就删第一个 Buff”，需要改成显式条件或 `all:true`。
- 这是 command queue 止血，不等同于完整批量事务；批量命令仍需要后续 batchId/transaction 设计。

### Task 13: 共享 main workbench command schema runtime（已完成）

当前问题：`src/agentKernel/mainWorkbench/commandSchema.ts` 和 `scripts/ai-cli-rest-server.mjs` 各自维护 op 列表、别名归一化和基础校验。Task 12 已经暴露这种重复会造成协议漂移：模型投递 `buffDisplayName` 时，REST 与 renderer 如果不同步就会出现“入队成功但执行误删/失败”的不稳定行为。

- 已新增浏览器与 Node REST 都能 import 的 command schema runtime。
- runtime 暴露：
  - `MAIN_WORKBENCH_SUPPORTED_OPS`
  - `normalizeMainWorkbenchCommand(command)`
  - `validateMainWorkbenchCommand(command)`
  - `validateMainWorkbenchCommands(commands)`
  - `isMainWorkbenchCommandOp(op)`
- `commandSchema.ts` 已改为 TS 类型包装，不再维护第二份业务规则。
- `scripts/ai-cli-rest-server.mjs` 已使用共享 runtime 做 op 校验、别名归一化和基础字段校验。
- 保持 runtime 只校验协议边界；按钮存在性、Buff 实体匹配、排轴位置等仍由 renderer 业务执行器校验。

验收：

- REST 和 TS kernel 使用同一份 supported ops。
- `removeBuff.buffDisplayName` 在 REST 和 TS kernel 中得到相同归一化结果。
- `removeBuff { buttonId }` 在 REST 和 TS kernel 中都返回 `invalid-main-workbench-remove-buff`。
- `addBuff` 缺少 `buff`、`setTargetResistance` 缺字段、work node op 缺 `nodeId` 的错误码保持一致。
- `node --check src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs` 已通过。
- `node --check scripts/ai-cli-rest-server.mjs` 已通过。
- `npm run build` 已通过。
- `npm test` 已通过。
- 17329 隔离 REST smoke 已通过：
  - 未知 op 返回 `invalid-main-workbench-command-op`。
  - 无 selector 的 `removeBuff` 返回 `invalid-main-workbench-remove-buff`。
  - `buffDisplayName:"长息·队友伤害+16%"` 入队时带上归一化后的 `displayName`。
- runtime 直测已通过：supported ops 数量、`buffDisplayName` 归一化、无 selector 错误码一致。

风险：

- `.mjs + .d.ts` 的共享 runtime 继续增加，后续应收敛成明确的 runtime shared package，而不是长期依赖 `vite-env.d.ts` 的通用声明。
- schema runtime 只负责低成本协议校验；不能把业务实体校验提前到 REST，否则会错误读取 current checkout 或 appdata node。

### Task 14: 批量命令批次级观测（已完成）

手测暴露问题：批量删除长息 Buff 时，AI 只能从一串松散 command 中自行数 pending/done，导致回答里出现“已入队/待处理/再确认”的混杂状态。低阻塞不应等于不可观察；AI 应能读取批次摘要，自行判断继续等待、报告失败或建议回退。

- REST 多命令 enqueue 时已生成或接受 `batchId`。
- 每条队列记录已写入：
  - `batchId`
  - `batchIndex`
  - `batchSize`
- 单命令可接受显式 `batchId`，但默认不强制生成。
- `GET /api/main-workbench/commands` 已支持按 `batchId` 过滤。
- 已新增只读批次摘要入口，返回 total、pending、running、done、error、failedCommand、remainingCommands。
- 批次摘要只读，不写 current checkout，不写 appdata work node。
- 本任务不实现事务停止、依赖跳过或自动回滚。

验收：

- 批量 enqueue 3 条命令返回同一个 `batchId`，且 `batchIndex` 为 0/1/2、`batchSize=3`。
- `GET /api/main-workbench/commands?batchId=...` 只返回该批次命令。
- 批次摘要能按状态统计 pending/running/done/error。
- 当某条命令 error 时，批次摘要返回 `failedCommand`。
- 只读批次摘要不会改变 command queue。
- `node --check scripts/ai-cli-rest-server.mjs` 已通过。
- `npm run build` 已通过。
- `npm test` 已通过。
- 17329 隔离 REST smoke 已通过：
  - 批量 enqueue 3 条命令返回同一个 `batchId` 与正确序号。
  - 按 `batchId` 读取只返回该批次命令。
  - 标记第二条命令 error 后，批次摘要返回 total=3、pending=2、error=1、failedCommand。

风险：

- 这只是观测层，不是事务执行器；浏览器仍按队列逐条处理。
- 如果 agent 依赖批次全部成功，需要结合 verifier 或后续 batch executor，不能只看 enqueue 成功。

### Task 15: def-agent 批次观测提示接入（已完成）

当前问题：Task 14 已提供批次级 REST 摘要，但 def-agent 的 REST spec 和主界面 prompt 仍只提示读取 `/commands` 或 `/snapshot`。这会让模型继续自行数命令，无法稳定使用 `batchId` 判断批量操作进度。

- 已更新 `src/aiCli/aiCliRestAdapter.ts` 的 main workbench control spec：
  - endpoints 增加 `GET /api/main-workbench/commands?batchId=<batchId>`。
  - endpoints 增加 `GET /api/main-workbench/commands/batch?batchId=<batchId>`。
  - rules 明确批量 enqueue 后优先保存响应里的 `batchId`，再读取 batch summary 判断 pending/done/error。
- 已更新 `MainWorkbenchAiPanel` 给 def-agent 的主界面 prompt：
  - 多步 commands enqueue 会返回 `batchId`。
  - 批量操作确认优先读 `/api/main-workbench/commands/batch?batchId=...`，不要手工数全局队列。
- 不改变底层 command queue，不新增业务执行能力。

验收：

- REST spec 中能看到批次摘要 endpoint。
- 主界面 prompt 中能看到批次摘要使用规则。
- 文案继续强调 enqueue 成功不等于执行完成。
- `rg` 已确认 `aiCliRestAdapter.ts` 和 `MainWorkbenchAiPanel.tsx` 都包含 `commands/batch` / `batchId` 指引。
- `npm run build` 已通过。
- `npm test` 已通过。

风险：

- 这只是提示接入，模型仍可能不遵守；后续应把 batch summary 变成正式 tool 调用路径或 verifier 输入。
- 批次摘要不提供事务保证，不能代替后续 batch executor。

### Task 16: verifier 批次证据接入（待执行）

当前问题：主界面 fallback verifier 只看单条 command 的 pending/error/done，不理解 batchId。批量命令出现未完成或失败时，用户只能看到某条 op 未完成，缺少“批次总数、已完成、失败、剩余”的可操作上下文。

- 扩展 `MainWorkbenchCommandEvidence`，保留 `batchId`、`batchIndex`、`batchSize`。
- `verifyMainWorkbenchTurn` 从 evidence 聚合批次摘要。
- 如果批次中有 error，错误信息应包含 batchId、done/error/pending/running 统计和失败命令。
- 如果批次中仍有 pending/running，未完成信息应包含 batchId、done/error/pending/running 统计和剩余数量。
- 无 batchId 的旧单命令 evidence 保持原行为。
- 本任务不实现 batch executor，不改变命令执行顺序。

验收：

- 单条 error 旧提示仍可用。
- 带 batchId 的 error evidence 返回批次级失败摘要。
- 带 batchId 的 pending/running evidence 返回批次级未完成摘要。
- 全 done 批次仍进入原有 expected op 验证。
- `npm run build` 通过。
- `npm test` 通过。

风险：

- 批次摘要基于当前 evidence；如果 evidence 采集遗漏某些命令，统计仍可能不完整。
- verifier 仍只验证命令状态和预期 op，不验证每个业务字段是否真的达到用户目标。

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
