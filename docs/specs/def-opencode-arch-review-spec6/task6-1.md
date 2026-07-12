# Task 6-1：现有 DEF Tools 盘点、三类统一注册与对照路由

## 状态

待实现。本文件定义 Task 6-1；本轮只完成任务设计，不修改运行时代码。

## 任务目标

在不删除现有自研 tool 能力、不改变当前用户行为的前提下，完成现有工具盘点，建立三大工具族的唯一注册模型，并提供旧工具名、旧 REST 路由与未来 OpenCode 原生工具之间的对照关系。

本任务是后续原生代码工具注册和前端替换的前置条件。它不负责真正恢复 `read/edit/apply_patch`，也不负责替换 AI mode 或 `/AI CLI` 前端。

## 已知基线

预研究记录的“41 个 REST tools”已经过期。实现前必须从当前代码运行时重新枚举，不得把研究文档中的数量作为事实源。

现有工具事实至少散落在：

- `scripts/ai-cli-rest-server.mjs` 的 `buildDefToolDefinitions()` 和执行分派。
- `src/agentKernel/mainWorkbench/toolRegistry.ts` 的 legacy Kernel registry。
- `agent/runtime/def-opencode-adapter/index.cjs` 的工具 prompt 与权限。
- `electron/main.cjs`、`agent/dev-agent.cjs` 的测试 prompt。
- `MainWorkbenchAiPanel.tsx` 的执行约定和 legacy summary。

Task 6-1 必须以代码扫描结果建立工具基线，并把研究文档只当作问题线索。

## 三类归档口径

### `def-node-code`

归入需要自由修改节点内容、未来由 OpenCode 原生代码工具承载的能力，例如：

- Work Node patch DSL
- 批量或组合节点修改
- 复制整组后继续修改
- 未来的节点工作区 read/edit/apply_patch

旧的组合工具可以映射到该类，但不能据此限制未来代码修改只能使用既有 DSL。

### `def-node-crud`

归入节点及当前节点投影的简单结构化操作，例如：

- fork/create/list/read/update/delete
- validate/diff
- checkout/use/restore
- approval/question/governance
- 结构化的单项增删改
- 与节点生命周期绑定的 verification

### `def-data-resource`

归入可信业务数据检索、解析与填表，例如：

- 干员
- 武器
- 装备/套装
- 技能
- Buff
- 配置读取与填充
- 伤害数据读取或计算

## 工作项

### 1. 自动盘点当前工具

- 从实际 tool definitions、执行分派和路由中提取当前工具名。
- 记录每个工具的 schema、scope、risk、approval、verification、handler、调用入口和已知调用方。
- 检查“已注册但无 handler”“有 handler 但未注册”“prompt 提及但不存在”“路由存在但文案称不存在”等漂移。
- 生成可审查的盘点结果，不手工只挑高频工具。

### 2. 定义唯一注册项

新增单一 DEF Tool Registry。注册项至少包含：

```ts
type DefToolRegistration = {
  id: string;
  family: 'def-node-code' | 'def-node-crud' | 'def-data-resource';
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  handler: string;
  source: 'def-native' | 'opencode-native' | 'legacy-adapter';
  workspaceScope: 'child-node' | 'node-store' | 'data-resource' | 'current-checkout';
  risk: 'read' | 'low' | 'medium' | 'high';
  approval: 'none' | 'auto' | 'ai-review' | 'user-confirm';
  verification: string[];
  legacyAliases: string[];
  exposure: Array<'workbench' | 'ai-cli'>;
  migrationStatus: 'canonical' | 'alias' | 'absorbed' | 'specialized' | 'deprecated-candidate';
};
```

字段名可根据现有模块约定调整，但表达的信息不能再次拆成多套事实源。

### 3. 建立旧新对照表

每个现有工具必须记录：

- 旧工具名。
- 旧调用路由。
- 所属三大工具族。
- canonical tool 或未来原生工具目标。
- 是否保留专用 handler。
- 是否被通用工具吸收。
- 当前调用方。
- 允许删除的前置条件。

同一个旧工具不能同时映射到多个互相冲突的 canonical handler；确需组合时，应明确 orchestration owner。

### 4. 提供只读对照路由

增加开发诊断用只读接口，例如：

```text
GET /api/def-tools/route-map
```

返回：

- registry version。
- 三大工具族。
- canonical tools。
- legacy aliases 和旧路由。
- handler 绑定。
- migration status。
- 无归属、重复 id、悬空 handler、悬空 alias 等诊断。

该路由不向模型宣传为业务工具，不进入正常 agent prompt，只供迁移审查、开发调试和验收使用。

### 5. 让现有 REST definitions 从注册表派生

- `buildDefToolDefinitions()` 不再维护独立的工具名称和 metadata 数组。
- 迁移期 REST schema、执行 handler 和返回结构从统一注册项适配生成。
- 原有 URL 在本任务中继续可用，行为不变。
- Kernel registry 和 prompt 本任务先标记 legacy consumer；删除安排在后续任务，避免 6-1 扩大为运行时重写。

### 6. 为 OpenCode 原生注册预留稳定边界

统一注册模块必须能被后续 OpenCode plugin/custom tool adapter 消费，但 Task 6-1 不得伪造尚未实现的原生工具为 `implemented`。

至少预留：

- `opencode-native` source。
- child-node workspace scope。
- Workbench / AI CLI exposure。
- 原生工具名与 legacy alias 的映射。

## 文件边界建议

具体命名可按实现调整，推荐边界：

```text
agent/runtime/def-tools/
  registry.*          唯一注册源
  families.*          三大工具族常量与类型
  route-map.*         对照和诊断输出
  legacy-adapter.*    旧 REST 名称/输入兼容
```

`scripts/ai-cli-rest-server.mjs` 只保留 transport、schema adapter 和 handler 接线，不继续内嵌完整注册清单。

## 非目标

- 不在 Task 6-1 删除任何已有业务 tool。
- 不在 Task 6-1 恢复 OpenCode filesystem tools。
- 不在 Task 6-1 建立子节点文件工作区。
- 不在 Task 6-1 重写验证流水线。
- 不在 Task 6-1 修改 AI mode 或 `/AI CLI` UI。
- 不在 Task 6-1 合并两个界面的会话。
- 不通过新增 prompt 文案解决注册问题。

## 验收标准

- 当前所有实际注册、可执行或被 prompt 引用的 DEF tools 均进入盘点结果。
- 每个旧工具恰好归入三大工具族之一，并有明确 canonical/alias/absorbed/specialized 状态。
- 唯一注册表成为 REST definitions 的工具名称与 metadata 来源。
- 对照路由能返回完整旧新映射和诊断结果。
- 重复 id、悬空 alias、无 handler 的 implemented 工具能被检测并导致开发检查失败。
- 现有旧 REST tool URL 和执行行为保持兼容。
- 不新增第二份手写工具清单。
- Task 6-1 完成后，可以在不重新盘点代码的情况下开始注册 `def-node-code` 原生工具。
- `npm run build` 通过；如注册模块是纯运行时 JS/MJS，额外执行一次模块导入和 route-map smoke 即可，不扩展无关测试。

## 后续衔接

Task 6-2 将基于该注册表建立子节点代码工作区，并把 OpenCode 原生 `read/edit/apply_patch` 以 `def-node-code` 能力注册；后续任务再分别收敛节点 CRUD、数据资源工具和共享 OpenCode 原生前端子界面。
