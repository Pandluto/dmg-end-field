# DEF Typed Tools 架构审计：三层定义系统与「左右脑互搏」

## Status

Phase 4 下部前置研究。

## 背景

第三阶段（`def-opencode-tools-phase3`）规划了 typed tools 的 7 层架构（Read / Resolver / Current-checkout Edit / Work Node / Verification / Governance / Discovery），第四阶段（`def-opencode-worknode-phase4`）补了 work node 前端闭环。但在实现过程中，工具定义系统在 **Kernel、REST、Agent Prompt 三层中各自独立演化**，形成了事实上的三套平行事实源。第四阶段下部已规划"收敛 `/api/def-tools`、legacy registry、prompt 文案、adapter 文案之间的重复事实源"，本文档是该工作的前置审计。

## 目标

- 精确审计当前三层定义系统的重叠与矛盾。
- 以 opencode 运行实体的视角补充模型面对的矛盾。
- 为 Phase 4 下部的事实源收敛提供可执行路线。

---

## 一、三层定义架构全貌

```
┌─────────────────────────────────────────────────┐
│  Layer A: toolRegistry.ts (Kernel, 13 tools)    │
│  src/agentKernel/mainWorkbench/                 │
│  字段: name, scope, riskLevel, approval,        │
│        verification[], rollback, description    │
│  verification 可选值: schema / snapshot / diff  │
│                       / damage-report           │
├─────────────────────────────────────────────────┤
│  Layer B: buildDefToolDefinitions() (REST, 41)  │
│  scripts/ai-cli-rest-server.mjs                 │
│  字段: name, scope, riskLevel, approval,        │
│        status, inputSchema, outputSchema,        │
│        verification[], rollback, idempotency,    │
│        modelOutputPolicy, auditLog              │
│  verification 可选值: command_result /          │
│                       snapshot_delta /          │
│                       schema / diff             │
├─────────────────────────────────────────────────┤
│  Layer C: Agent Prompt (自然语言, 4 处)         │
│  - def-opencode-adapter/index.cjs:210-267       │
│  - electron/main.cjs:1875-1901                  │
│  - agent/dev-agent.cjs:498-523                  │
│  - MainWorkbenchAiPanel.tsx:250 (EXECUTION     │
│    CONTRACT)                                    │
└─────────────────────────────────────────────────┘
```

三层**不是层叠关系，是平行关系**——每层独立告诉系统"工具长什么样"，无自动同步。

---

## 二、六大矛盾（核实结果）

### 矛盾 1：Kernel 与 REST 完全不互通

| 维度 | `toolRegistry.ts` (Kernel) | `buildDefToolDefinitions()` (REST) |
|---|---|---|
| 工具数量 | 13 | 41 |
| 命名风格 | `addSkillButton` | `def.workbench.add_skill_button` |
| scope 值 | `current-checkout` / `appdata-work-node` | 上述 + `read` / `governance` / `verification` |
| verification 策略 | **每工具独立配置**，如 `addSkillButton` → `['snapshot']`，`addBuffToButtons` → `['snapshot', 'damage-report']`，`patchAiTimelineWorkNode` → `['schema', 'diff']` | **按 scope 一刀切覆盖**（`ai-cli-rest-server.mjs:3294-3295`） |
| rollback 策略 | 每工具独立配置：`none` / `optional` / `required` | **按 scope 一刀切覆盖** |

**关键代码**（`ai-cli-rest-server.mjs:3294-3295`）：

```javascript
verification: tool.scope === 'current-checkout'
  ? ['command_result', 'snapshot_delta']
  : tool.scope === 'appdata-work-node'
    ? ['schema', 'diff']
    : ['schema'],
rollback: tool.scope === 'appdata-work-node'
  ? 'required'
  : tool.scope === 'current-checkout'
    ? 'optional'
    : 'none',
```

Kernel 为每个工具精细配置了不同的 verification/rollback 策略，REST 层全部按 scope 覆盖。Kernel 的 `buildDefToolCommandVerification` 完全不参与 REST 的 `def.verify.*` 体系。

**`inputSchema` 是唯一保留细粒度的字段**——在 `.map()` 中按工具名选择性注入 `addSkillButtonSchema`、`patchAndValidateSchema` 等。这说明技术上完全可以不按 scope 一刀切，当前设计是主动选择而非被迫。

### 矛盾 2：两套完全不兼容的 Verification 体系

**Kernel Verifier** (`src/agentKernel/mainWorkbench/verifier.ts`):

- `getExpectedCommandOps`：用正则从用户 prompt 猜测期望的 command op（如匹配 `add|cast|use|place|create` → `addSkillButton`）
- `hasPromptRequiredCommand`：检查 batch evidence 中是否有命令匹配期望 op
- 返回 `{ok: true}` 或 `{ok: false, message: "本轮没有检测到符合请求的实际主界面命令"}`

**REST Verification Tools** (`def.verify.*`):

- `verifyDefSnapshotDelta`：BEFORE/AFTER 快照 delta 比较（buttonCount、staffIndex）
- `verifyButtonsHaveBuff`：检查按钮是否包含特定 buff
- `buildDefToolCommandVerification`：轮询命令状态直到 done/error
- 返回结构化证据（pass/fail、expected/actual、note）

两套体系**互不调用、互不知晓**。Kernel verifier 不知道 REST 有 snapshot delta 能力；REST verify tools 不知道 Kernel 有意图匹配逻辑。

**Agent Prompt 同时描述了两套体系**，LLM 面对这两套验证方式只能随机选择。

### 矛盾 3：「_and_verify」模式缺乏公共抽象

所有 `_and_verify` 工具遵循同一 4 步模式：

```
1. before = readSnapshotMirror()
2. enqueue = enqueueDefToolCommand(definition, input)
3. waitForCommand() + after = waitForSnapshot()
4. return {ok: verification_logic(before, after)}
```

**5 个实现 + 1 个自动触发：**

| 函数 | 行数 | 特殊验证逻辑 |
|---|---|---|
| `executeDefAddSkillButtonAndVerify` (`3623`) | 70 行 | 额外 placementVerification（staffIndex + nodeIndex 精确匹配） |
| `executeDefAddBuffToButtonAndVerify` (`3694`) | 86 行 | 额外 preflight 重复检查 + buffNeedle 解析 + equipment-library 查询 |
| `executeDefDamageCalculateAndVerify` (`3566`) | 56 行 | 额外 damageVerification（generatedAt + buttonCount） |
| `executeDefWorkNodeApplyAndVerify` (`3493`) | 71 行 | 额外 staffIndexVerification（每个 staffLine 的按钮数量匹配） |
| `patch_and_validate` auto-checkout (`4152`) | 14 行 | 内联调用 `executeDefWorkNodeApplyAndVerify` |
| `copy_staff_line_and_verify` auto-checkout (`4152`) | 同上 | 同上 |

**核实结论：** 报告的"copy-paste"描述偏激进。每个 `_and_verify` 的 verification 逻辑**确实不同**——有的是 snapshot button count，有的是 buff presence，有的是 staff index 对齐。**真正缺失的是公共模板/策略模式抽象**，使得：
- after snapshot 等待策略（waitForDefSnapshotButtonCount / waitForDefDamageReport / waitForDefButtonsHaveBuff）各写一遍
- before/after 证据收集格式不统一
- ok 判断逻辑各有不同的组合方式

**共享基础设施存在：** `enqueueDefToolCommand`、`buildDefToolCommandVerification`、`verifyDefSnapshotDelta`、`snapshotButtonCount` 已提取。但 `_and_verify` 的编排逻辑没有抽象。

### 矛盾 4：`patch_and_validate` 的自动 checkout

**代码**（`executeDefTool:4156`）：

```javascript
if (result.ok && result.checkout === true && result.dryRun !== true
    && !result.checkoutDecision?.requiresManualApproval) {
  const applied = await executeDefWorkNodeApplyAndVerify(
    'def.worknode.checkout_and_verify', {
      nodeId: result.nodeId, reload: false,
      waitMs: input.waitMs ?? 20000,
      snapshotWaitMs: input.snapshotWaitMs ?? 8000,
    }, false);
  result = { ...result, checkout: applied, ... };
}
```

4 个条件全部通过时自动 checkout：`patch ok` + `checkout !== false` + `not dryRun` + `no manual approval`。

**Agent Prompt 产生了信息不一致：**

- `def-opencode-adapter/index.cjs:231`：说明 "validates and immediately performs protected no-reload checkout by default"
- 同文件 `:232`：描述了 "legacy long flow"（create→patch→validate→diff→checkout）
- `electron/main.cjs:1890`：说"用户明确要应用/回退时优先用 checkout_and_verify"
- `MainWorkbenchAiPanel.tsx:250`：说 "call def.worknode.patch_and_validate once"

LLM 可能：
- 先调 `patch_and_validate`（自动 checkout），又调 `checkout_and_verify`（重复 checkout）
- 试图分步调（legacy flow），但 `patch_and_validate` 已一步完成

### 矛盾 5：`patch_and_validate` 的 code review 是形式上的

当前 pipeline：`patch → validate（schema 校验）→ diff（结构差异）→ checkoutDecision（风险评估）`

问题：
1. **validate** 只做按钮-表格交叉引用、staffIndex 对齐、buff 引用完整性——这是 schema 校验，不是语义 review
2. **checkoutDecision** 只看 `riskFlags` 的数量和严重程度，不做语义分析
3. 没有任何一步回答"这个变更**合理**吗？"——只回答"这个变更**合法**吗？"
4. pipeline 硬编码在 `applyDefWorkNodePatchAndValidate`（约 140 行）中，不可组合

### 矛盾 6：工具行为描述散落四处（核实结果）

| 位置 | 行号 | 内容性质 |
|---|---|---|
| `def-opencode-adapter/index.cjs` | `210-267` | Agent 主 System Prompt（58 行） |
| `electron/main.cjs` | `1875-1901` | Workbench test agent prompt（27 行） |
| `agent/dev-agent.cjs` | `498-523` | Dev agent test prompt（26 行，与 main.cjs **近乎逐字重复**） |
| `CanvasBoard/MainWorkbenchAiPanel.tsx` | `250` | EXECUTION CONTRACT 注释 |

重复示例：同一规则"低风险单步加按钮用 add_skill_button_and_verify"在三处出现，措辞强度不同：
- `def-opencode-adapter` → "should use"
- `main.cjs` → "必须优先使用……不得改走 Work Node"（加了"强约束"修饰）
- `dev-agent.cjs` → 同上（逐字复制）

`electron/main.cjs` 和 `agent/dev-agent.cjs` 的对应段落是近乎逐字复制的，改动一处需手动同步另三处——无自动检查。

---

## 三、opencode 运行实体的额外视角

作为实际被注入 Prompt 后执行工具的 LLM，还存在以下报告中未提及的问题：

### 1. Prompt "三面镜"效应

当同一规则在三处 Prompt 中以不同措辞出现（如 `main.cjs` 的"强约束" vs `adapter` 的 "should use"），LLM 会收到语义相似但不完全一致的指令。强度修饰词的差异会导致模型在不同入口（dev-agent test vs 主界面 AI 面板）表现不一致。

### 2. 工具发现与实际行为脱节

Agent Prompt 告诉 LLM 去 `GET /api/def-tools` 拿工具列表。但 REST `buildDefToolDefinitions()` 返回的 `verification` 字段已被 scope-based 抹平（如所有 `current-checkout` 工具统一返回 `['command_result', 'snapshot_delta']`），丢失了 Kernel 层面的细粒度策略信息。

实际工具行为（自动 checkout、buff 自动解析、preflight 跳过）在运行时才暴露，Prompt 中的自然语言描述和 REST 生成的 metadata 之间有 gap。

### 3. `def.verify.*` 工具的语义漂移

Prompt 说"Tool queued status is not completion. Verify with def.verify.*"。但实际场景中：
- `def.verify.command_result` 只验证命令是否终止——不验证语义正确性
- `def.verify.snapshot_delta` 只验证 buttonCount 是否匹配——不验证按钮位置/内容是否正确
- Kernel verifier 的 `getExpectedCommandOps`（正则意图匹配）完全不参与

LLM 需要自己判断用哪个 verify 工具、判断通过标准——没有结构化的验证策略指导。

---

## 四、根因分析

根本问题：**没有单一权威的工具契约源（Single Source of Truth）**。

理想架构：
```
Tool Contract (.json / .ts) ← 唯一定义
    ├── 生成 → Kernel Registry (risk/approval/verification/rollback)
    ├── 生成 → REST Definitions (inputSchema/outputSchema/status/idempotency)
    ├── 生成 → Agent Prompt (注入结构化工具列表)
    └── 驱动 → Verification 策略
```

现状：
```
Kernel Registry (手写)    REST Definitions (手写, 覆盖 Kernel)
        ↓                       ↓
  独立维护             独立维护
        ↓                       ↓
  Agent Prompt (手写, 4处)  ← 两边都不引用, 纯自然语言
        ↓
  与 main.cjs / dev-agent.cjs 互相复制
```

---

## 五、建议收敛路线

以下路线按可实现性排序，与 Phase 4 下部方向一致。

### 5.1 立即可做

**A. 合并三份 Agent Prompt**

将 `main.cjs:1875-1901`、`dev-agent.cjs:498-523`、`def-opencode-adapter/index.cjs:222-235` 中的 DEF tools 行为描述统一为一个 prompt 片段函数，三处调用同一个函数。

**B. 消除 main.cjs / dev-agent.cjs 之间的逐字复制**

提取 `buildDefToolPromptSection(evidence, selectedSummary, buttonSummary, userText)` 公共函数，main.cjs 和 dev-agent.cjs 共同引用。

### 5.2 本阶段核心

**C. 以 REST Definitions 为单一事实源，生成 Kernel Registry**

REST `buildDefToolDefinitions()` 信息最全（41 工具、完整 schema、status、idempotency、outputSchema）。让 `toolRegistry.ts` 从 REST definitions 派生，而非独立维护。

或反向：选一组工具元数据文件（`.json` / `.ts`），由构建脚本同时生成 Kernel registry 和 REST definitions 片段。关键是不保留两套手写。

**D. 消除 scope 一刀切，恢复 per-tool 策略**

`ai-cli-rest-server.mjs:3294-3295` 的 scope 覆盖应改为默认值 + 工具级 override：

```javascript
verification: tool.verification ?? (
  tool.scope === 'current-checkout' ? ['command_result', 'snapshot_delta']
  : tool.scope === 'appdata-work-node' ? ['schema', 'diff']
  : ['schema']
),
```

类似地处理 `rollback`。然后在工具条目上逐个补充 override 值。

**E. 抽取 `_and_verify` 公共模板**

定义类型化流程：

```typescript
type AndVerifyPipeline = {
  before: () => Snapshot;
  enqueue: (input) => Command;
  waitForCommand: (command) => CommandVerification;
  waitForState: (commandVerification) => Snapshot;
  verify: (before, after, commandVerification) => AndVerifyResult;
};
```

5 个 composite tool 各自注入 `verify` 策略函数，共享 before/enqueue/waitForCommand 骨架。

**F. `patch_and_validate` 自动 checkout 配置化**

保持默认行为不变，但让 `checkout` 字段更细粒度：
- `checkout: true`（默认）→ 自动 checkout
- `checkout: false` → 不 checkout
- `checkout: "ask"` → 返回 checkoutDecision 但不自动执行

同步更新 Prompt，删除"legacy long flow"的多步描述（`def-opencode-adapter/index.cjs:232`）。

### 5.3 后续迭代

**G. 统一 Verification 体系**

选项 A：废弃 Kernel verifier 的正则意图匹配，全部用 REST snapshot delta + command_result 验证。
选项 B：把 Kernel verifier 的意图匹配作为 REST `def.verify.command_result` 的增强可选项。
选项 B 保留了两套体系的优点，但需要设计一个统一的 verify 接口。

**H. 从工具定义驱动 Agent Prompt 片段**

将从 REST definitions 中提取的结构化工具列表（含 name、description、riskLevel、approval scope）作为 JSON 片段注入到 Agent Prompt 中。Prompt 中的自然语言描述只保留工作流规则和优先级建议，具体工具列表由代码生成。

---

## 六、与 Phase 4 下部规划的对齐

Phase 4 Spec（`def-opencode-worknode-phase4/spec.md`）第 187 行规划：

> 下部：清理事实源和大文件边界。收敛 `/api/def-tools`、legacy registry、prompt 文案、adapter 文案之间的重复事实源，拆分过大的 UI / server 文件。

本文档的 5.1 C+D+E+F 即对应此段落。

---

## 参考资料

### 代码位置索引

| 文件 | 行 | 内容 |
|---|---|---|
| `scripts/ai-cli-rest-server.mjs` | `3078-3300` | `buildDefToolDefinitions()` 完整函数 |
| `scripts/ai-cli-rest-server.mjs` | `3294-3295` | scope-based verification/rollback 覆盖 |
| `scripts/ai-cli-rest-server.mjs` | `3493-3558` | `executeDefWorkNodeApplyAndVerify` |
| `scripts/ai-cli-rest-server.mjs` | `3566-3621` | `executeDefDamageCalculateAndVerify` |
| `scripts/ai-cli-rest-server.mjs` | `3623-3692` | `executeDefAddSkillButtonAndVerify` |
| `scripts/ai-cli-rest-server.mjs` | `3694-3780` | `executeDefAddBuffToButtonAndVerify` |
| `scripts/ai-cli-rest-server.mjs` | `4152-4170` | `patch_and_validate` auto-checkout |
| `src/agentKernel/mainWorkbench/toolRegistry.ts` | `1-17` | Tool 类型定义 |
| `src/agentKernel/mainWorkbench/toolRegistry.ts` | `19-` | `MAIN_WORKBENCH_TOOL_REGISTRY` (13 工具) |
| `src/agentKernel/mainWorkbench/verifier.ts` | `26-58` | `getExpectedCommandOps` 正则匹配 |
| `src/agentKernel/mainWorkbench/verifier.ts` | `102-159` | `verifyMainWorkbenchTurn` |
| `agent/runtime/def-opencode-adapter/index.cjs` | `210-267` | 主 System Prompt |
| `electron/main.cjs` | `1875-1901` | `buildWorkbenchTestPrompt` |
| `agent/dev-agent.cjs` | `498-523` | `buildWorkbenchTestPrompt` (重复) |
| `src/components/CanvasBoard/MainWorkbenchAiPanel.tsx` | `250` | EXECUTION CONTRACT |

### 已有 Spec

| 阶段 | 路径 | 主题 |
|---|---|---|
| Phase 1 | `docs/specs/def-opencode-main-workbench/` | 主界面 AI 排轴助手 |
| Phase 2 | `docs/specs/def-opencode-tools-worknode-phase2/` | tools-first 架构 |
| Phase 3 | `docs/specs/def-opencode-tools-phase3/research.md` | typed tools 规划 |
| Phase 4 | `docs/specs/def-opencode-worknode-phase4/` | work node 前端闭环（含本阶段下部规划） |
