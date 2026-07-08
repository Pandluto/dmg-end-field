# DEF OpenCode Tools 第三阶段研究

## 本轮目标

第三阶段的目标不是继续给 prompt 加规则，而是研究并补足 DEF workbench agent 的 tools 结构。

这轮研究基于：

- 本项目内置的 OpenCode 源码：`agent/vendor/opencode`
- 当前 DEF adapter / workbench agent 代码
- Claude Code 官方文档中关于 skills、tools、MCP、hooks、permissions 的公开资料

## 研究结论

### 1. skill 不是执行层

OpenCode 和 Claude Code 的 skill 都更接近“按需加载的说明书/流程包”。

OpenCode 的 skill 机制：

- skill 通过 `SKILL.md` 声明 `name` 和 `description`
- 模型先看到可用 skill 列表
- 真正需要时调用 `skill({ name })`
- skill tool 返回 `SKILL.md` 内容给模型
- skill 的权限是 `skill:<name>` 级别，不直接等于业务写操作权限

Claude Code 也类似：

- skill 是 `SKILL.md` + frontmatter + supporting files
- body 只在使用时加载
- 可以声明 `allowed-tools` / `disallowed-tools`
- 可以通过 plugin 分发
- 复杂执行仍然依赖已有工具、MCP、hooks 或脚本

结论：skill 适合放领域工作流、规则、检查清单、示例和脚本使用说明，不适合作为 DEF workbench 的稳定执行边界。

### 2. tool 才是稳定动作边界

OpenCode 的 tool 有几个核心特征：

- 有明确 tool name
- 有 description
- 有输入 schema
- 执行前解码参数
- 执行时拿到 session / message / toolCall / agent context
- 工具内部可以 ask permission
- 输出会被统一截断、记录和返回
- 插件和自定义工具也进入同一个 registry

Claude Code 的公开文档也体现同一思路：

- 内置工具有独立名称，如 `Read`、`Edit`、`Bash`、`AskUserQuestion`、`Skill`
- 自定义外部能力主要通过 MCP 接入
- prompt-based workflow 写成 skill；新可执行能力写成 MCP tool
- permission、hooks、subagent tools 都围绕 tool name 生效

结论：第三阶段要补的是 DEF 领域 typed tools，而不是把自然语言意图写死进业务代码。

### 3. 权限/审批也是 tool 结构的一部分

OpenCode 的 permission 是 `allow / ask / deny`，支持按 tool 和 pattern 匹配。

重要点：

- 权限不是模型 prompt 里的建议，而是运行时检查
- tool 可以提供 `always` pattern，让用户批准一次后本 session 复用
- `question` 是正式 permission 类型
- OpenCode 里 `plan_enter / plan_exit`、`question` 都是硬编码 tool，不是 prompt 假装出来的流程

Claude Code 同样把权限放在 tool 层：

- settings 里用 tool rule 控制 allow / deny
- permission prompt 可由 hooks 检查或修改
- `AskUserQuestion` 是正式工具，不是普通聊天文本
- hook 生命周期覆盖 `PreToolUse`、`PermissionRequest`、`PostToolUse`

结论：DEF 的审批不应该只有“强制拦截/不拦截”两档，而应该成为每个 tool 的 metadata 和运行时策略。

## 当前项目差距

### 1. workbench agent 现在主要还是 REST 命令层

当前 `agent/runtime/def-opencode-adapter/index.cjs` 对 workbench 的说明仍然是：

- 业务数据通过 local REST API
- 写操作通过 `/api/main-workbench/commands/enqueue`
- 使用 `webfetch` 调接口

这能工作，但它不是 ideal typed tool runtime。模型面对的是一个通用 HTTP 工具，而不是 `findButtons`、`resolveBuff`、`addBuffToButtons` 这种领域工具。

### 2. adapter 仍然禁用了 question

当前 adapter policy 里 `question` 是 deny。

这解释了一个现象：模型可以用普通文本反问用户，但没有正式的“向用户反问/等待回答/记录回答”的 tool 能力。

如果第三阶段要做“低阻塞、AI 自行判断、非强制拦截、灵活审批”，`question` 或等价的 DEF ask tool 应该成为一等能力。

### 3. 现在的 registry 只是 metadata，不是真 tool runtime

`src/agentKernel/mainWorkbench/toolRegistry.ts` 已经记录了：

- riskLevel
- approval
- verification
- rollback
- scope

但它目前主要是描述性 registry，不是模型直接可调用的 OpenCode tool / MCP tool。

第二阶段做到的是“改节点副本命令”和“批量 buff 命令”，不是完整 typed tool runtime。

### 4. 旧问题不是模型笨，而是工具颗粒度不够

“给所有技能加长息 buff”卡住的根因：

- 查快照、找目标、解析 buff、逐个 addBuff、确认结果都靠模型用 REST 拼流程
- 缺少批量领域动作
- 缺少 resolver 类工具
- 缺少 bounded output，让模型一次拿到刚好够用的信息

这不是要写 `addLongxiToAllSkills` 这种硬编码，而是要补通用能力：

- `findButtons`
- `resolveBuff`
- `addBuffToButtons`
- `verifyButtonsBuff`

## 第三阶段 tools 候选结构

## Tool 层次关系研究

OpenCode / Claude Code / Codex 这类 agent 系统里，工具通常不是严格父子关系，也不是靠目录名形成硬分组。

更准确的模型是：

- 所有 model-facing tools 在 registry / tool list 里基本是平级的
- 不同工具拥有不同 authority、permission action、context、output policy
- 工具调用时通过 schema、permission、hook、verification、rollback 形成运行时层次

也就是说，分层主要发生在“执行链”和“责任边界”里，而不是发生在“工具继承关系”里。

### 1. OpenCode 的运行时层次

OpenCode 的一条工具调用链大致是：

```text
model tool call
  -> tool registry 查找有效工具
  -> input schema 解码
  -> tool execute
  -> tool 内部 permission.assert / ctx.ask
  -> 业务 side effect
  -> output schema 编码
  -> toModelOutput / output bounding
  -> session processor 持久化 tool result
```

这里的关键点：

- registry 负责“这个 tool 是否存在、如何 materialize、如何 settle”
- schema 负责“参数是否有效”
- leaf tool 负责“怎么查权限、怎么执行业务 side effect”
- permission 负责“allow / ask / deny”
- processor 负责“记录工具运行状态和结果”
- output bounding 负责“不要把无限输出塞回模型”

OpenCode v2 里甚至明确写了：registry 不做执行授权，可信工具自己捕获 `PermissionV2.Service`，由工具内部决定何时请求权限。

这意味着：工具不是从属于某个父工具，而是被同一条运行时链包住。

### 2. 分层不是目录分组，而是 authority 分层

OpenCode 的工具可以都注册在一个 registry 里，但 authority 不一样：

- `read / grep / glob`：读权限
- `edit / write / apply_patch`：共享 edit 权限
- `bash`：命令执行权限
- `question`：向用户提问权限
- `skill`：加载技能说明权限
- `webfetch / websearch`：外部网络权限
- MCP tools：外部服务能力

这些工具在列表上是平级的，但在风险和授权上不是平级的。

对 DEF 来说，同理：

- `findButtons` 和 `addBuffToButtons` 不应该只是目录不同
- 它们应该有不同 risk、approval、verification、rollback、output policy
- 高风险工具应该捕获 work node / diff / approval 能力
- 低风险工具可以直接 current checkout，但仍要有 verifier

### 3. 业务交互工具和工程保障工具的关系

业务交互工具：

- 读状态
- 查对象
- 解析 buff / skill / button
- 添加按钮
- 删除按钮
- 添加 buff
- 修改目标抗性

工程保障工具：

- work node
- diff
- checkout
- rollback
- verify
- audit log
- approval

二者不是父子关系，而是“业务动作被工程保障包住”的关系。

推荐调用链：

```text
用户意图
  -> read / evidence 获取当前事实
  -> resolver 把自然语言变成候选对象
  -> question 在歧义时反问
  -> risk policy 判断直接改还是走 work node
  -> edit tool 执行业务动作
  -> verify tool 验收结果
  -> audit log 记录过程
  -> rollback 在失败或用户否决时恢复
```

这条链允许 AI 自己判断该走哪一步，但每一步都由工具 runtime 提供安全边界。

### 4. DEF 不该做的分组

不建议做这种硬分组：

```text
BuffTools
  -> addLongxiToAllSkills
  -> removeLongxi

LaevatainTools
  -> addFirstNormalAttack
```

这会把用户意图写死进工具，重新走回录制回放式 agent。

也不建议做这种大一统工具：

```text
executeWorkbenchIntent({ userText })
```

这会把所有推理和风险判断都藏进一个黑盒，模型、审批、验证都失去清晰边界。

### 5. DEF 应该做的分层

推荐的第三阶段层次：

```text
Skill / prompt layer
  告诉模型领域规则、工作流、何时用哪些 tool

Read layer
  提供当前事实，输出受控

Resolver layer
  把自然语言对象解析成稳定 id / candidates

Interaction edit layer
  执行业务增删改查

Work node layer
  给高风险/批量/试错操作提供副本编辑

Verification layer
  给每次改动提供结构化验收

Governance layer
  approval / ask / audit / policy
```

这些层不是要求模型必须线性调用，而是给模型提供可靠路线。

低风险明确操作可以短链：

```text
resolver -> edit -> verify
```

高风险批量操作走长链：

```text
read -> resolver -> create work node -> patch -> diff -> approval -> checkout -> verify -> audit
```

歧义操作走反问链：

```text
read -> resolver -> question -> edit/worknode -> verify
```

### 6. 对当前项目的直接影响

目前项目已经有一些层的雏形：

- `MAIN_WORKBENCH_TOOL_REGISTRY` 有 risk / approval / verification / rollback metadata
- `patchAiTimelineWorkNode` 已经是 work node 层雏形
- `addBuffToButtons` 是 interaction edit 层补强
- `/api/main-workbench/evidence` 是 read/evidence 层雏形

但还缺：

- 真正 model-facing typed tool runtime
- resolver tools
- formal question / ask tool
- verification tools 独立化
- audit log 和 approval decision 的本地记录
- tool 层根据 risk 自动选择 current checkout 或 work node 的策略

第三阶段的重点不应该只是“多加几个 op”，而应该是把这些层之间的责任边界打通。

### 第三阶段必须继承的类代码工具要求

第三阶段不应把第二阶段的 `patchAiTimelineWorkNode` 视为临时命令。它应被升级为正式的高风险 work node typed tool。

这里的“类代码形式”指：

```text
AI 生成受控领域 patch / CRUD 操作
  -> tool runtime 应用到 appdata work node 的 workingPayload
  -> validate / diff / risk / approval
  -> checkout 后才写当前迁出态
```

它不是让 AI 任意写源码、任意执行 JS、任意覆盖完整 JSON，也不是替代所有普通交互工具。它的定位是：

- 高风险批量修改
- 重排轴
- 多步试错
- 需要先在副本里开发、验收后再 checkout 的操作

因此第三阶段 SHALL 保留并扩展 `def.worknode.patch`，把它作为“类代码增删改查 Patch DSL”的核心工具之一。

## 第三阶段 tools 批注清单

### 1. Read tools

只读，不改状态。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.workbench.snapshot` | 高 | 高 | 必须有，但输出必须裁剪。不能把完整快照无脑塞给模型。 |
| `def.workbench.evidence` | 高 | 已有雏形 | 应作为模型主读工具，比 snapshot 更适合自然语言回答和后续 resolver。 |
| `def.workbench.list_buttons` | 高 | 高 | 必须补。用于“第二个 a”“当前第一个干员的按钮”等位置/顺序指代。 |
| `def.workbench.list_characters` | 高 | 高 | 必须补。返回当前队伍、站位、角色 id、别名基础信息。 |
| `def.workbench.damage_report` | 中高 | 高 | 需要。主要用于验收伤害是否已重算。 |

要求：

- 输出不要把整个快照无脑塞给模型
- 支持 filter / projection / limit
- 返回稳定 ids 和人类可读 label

批注：`snapshot` 和 `evidence` 有重叠，但不是多余。`snapshot` 偏原始状态，`evidence` 偏模型可用证据。

### 2. Resolver tools

负责把自然语言候选解析成稳定对象，但不直接写状态。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.workbench.find_buttons` | 最高 | 高 | 必须优先做。很多失败不是执行失败，而是按钮定位失败。 |
| `def.buff.resolve` | 最高 | 中高 | 必须做。用于把“长息”解析成候选来源、完整 buff 对象、置信度和歧义。 |
| `def.skill.resolve` | 高 | 中 | 需要。用于“A/E/Q/技能名/普攻/终结技”等技能指代。 |
| `def.character.resolve` | 高 | 高 | 需要。处理别名、当前第几个干员、角色 id 映射。 |
| `def.equipment.resolve` | 中 | 中 | 需要，但优先级低于 button/buff/skill/character。 |

要求：

- 返回 candidates、confidence、ambiguity
- 模糊时建议反问问题
- 不把“长息”写死，只做数据驱动搜索

批注：resolver tools 没有多余项，是第三阶段最该补的基础层。

### 3. Current checkout edit tools

直接改当前迁出态，适合低风险、小范围、用户已明确的操作。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.workbench.add_skill_button` | 高 | 已有命令 | 必须包装成 typed tool。 |
| `def.workbench.remove_skill_button` | 高 | 已有命令 | 必须要求明确 buttonId 或 resolver 确认结果。 |
| `def.buff.add_to_button` | 高 | 已有命令 | 必须保留，适合单点低风险编辑。 |
| `def.buff.add_to_buttons` | 最高 | 已有雏形 | 必须保留。它是“给所有技能加某 buff”这类请求的正确通用工具。 |
| `def.buff.remove_from_button` | 高 | 已有命令 | 必须有。删除类操作应更严格验证目标。 |
| `def.target.set_resistance` | 中高 | 已有命令 | 需要。排轴工具常用，验收应包含 damage recalculation。 |
| `def.damage.calculate` | 高 | 已有命令 | 必须有。作为 edit 后验收链的一部分。 |

要求：

- 输入必须是明确 id 或经过 resolver 确认的对象
- 每个工具自带 risk / approval / verifier
- 输出必须包含 applied / skipped / duplicate / failed

批注：`add_to_button` 和 `add_to_buttons` 可以共享底层实现，但 model-facing tools 保留两个入口是合理的。

### 4. Work node tools

用于高风险、批量、重排轴、试错式编辑。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.worknode.create_from_current` | 高 | 已有 | 必须。创建 appdata/localdata 节点副本。 |
| `def.worknode.read` | 高 | 中高 | 必须补。模型需要能看到节点状态、risk、decision、summary。 |
| `def.worknode.patch` | 最高 | 已有最小版 | 必须明确为“类代码 Patch DSL / CRUD 模型”的核心工具。 |
| `def.worknode.validate` | 高 | 中高 | 缺少，必须补。patch 后可单独验证节点副本合法性。 |
| `def.worknode.diff` | 高 | 已有 | 必须。checkout 前给模型和用户看差异。 |
| `def.worknode.checkout` | 高 | 已有 | 必须受 checkoutDecision / approval policy 控制。 |
| `def.worknode.restore_base` | 高 | 已有 | 必须。回滚保障。 |

要求：

- work node 存在 appdata/localdata，不是 localStorage/sessionStorage
- 每个存档 id 对应独立节点，类似分支
- 当前迁出态只在 checkout / rollback 阶段被写入
- patch DSL 要比当前第二阶段更完整，但仍然受 schema 约束

批注：第三阶段不应只把 work node 当备份点。`def.worknode.patch` 应成为复杂编辑主路径，普通 edit tools 则用于低风险短链。

### 5. Approval / ask tools

用于低阻塞审批和反问。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.user.ask` | 最高 | 中 | 必须补。否则模型只能用普通文本反问，不是正式工具流程。 |
| `def.approval.request` | 中高 | 中 | 需要，但不能把所有 warning 都变成强制弹窗。 |
| `def.approval.record_decision` | 高 | 中 | 需要。审批理由和结果应写入 work node audit。 |

要求：

- 支持 AI 自行判断是否需要问
- 支持 optional / non-blocking / blocking 三类问题
- 支持审批记录进本地工作节点
- 不把所有事情变成强制弹窗

批注：approval tools 的目标是低阻塞，不是把 agent 变成每一步都等用户确认。

### 6. Verification tools

让模型不是“猜成功”，而是拿到结构化验收结果。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.verify.command_result` | 高 | 高 | 必须。避免把 enqueue 成功误判成执行成功。 |
| `def.verify.snapshot_delta` | 高 | 中高 | 必须。确认状态真的发生预期变化。 |
| `def.verify.buttons_have_buff` | 最高 | 高 | 必须。直接覆盖批量 buff 的核心验收场景。 |
| `def.verify.damage_recalculated` | 高 | 高 | 必须。确认伤害结果已刷新。 |
| `def.verify.worknode_diff_clean` | 高 | 中 | 必须。checkout 前判断 diff/risk 是否可接受。 |

要求：

- 返回 pass/fail/warn
- 返回最小证据
- 支持失败时给出下一步建议

批注：verification 可以被 edit tool 自动调用，也可以单独暴露给模型用于 repair loop。

### 7. Tool discovery / runtime tools

第三阶段还需要补工具发现与运行时层，否则上面的 tools 仍只是文档名或 REST 命令包装。

| Tool / 模块 | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.tool.list` | 高 | 中 | 让模型读取当前可用 DEF tools，而不是靠 prompt 背列表。 |
| `def.tool.describe` | 高 | 中 | 返回某个 tool 的 schema、risk、approval、verification、示例。 |
| DEF typed tool runtime / adapter | 最高 | 中 | 第三阶段总入口。让模型看到领域 tools，而不是通用 `webfetch` + REST URL。 |

### 8. 选人/配置页 tools

第三阶段如果要覆盖“用户在 GUI 能做什么”，还应补选人配置页相关 tools。

| Tool | 必要性 | 可行性 | 批注 |
| --- | --- | --- | --- |
| `def.operator.config.read` | 高 | 中 | 读取当前干员等级、潜能、技能等级、武器、装备、面板信息。 |
| `def.operator.config.patch` | 高 | 中 | 结构化修改配置页字段，适合走类代码 Patch DSL 或细粒度 edit tools。 |
| `def.weapon.resolve` | 中高 | 中 | 武器选择、武器技能、武器潜能都需要。 |
| `def.gear.resolve` | 中高 | 中 | 装备选择和套装 buff 解析需要。 |
| `def.gear.set_entry_level` | 中 | 中 | 装备词条等级调节需要，但优先级低于 resolver 和主界面排轴 tools。 |

批注：这组 tools 不应抢第三阶段最小落地优先级，但应写进范围，避免 tools 只覆盖排轴主界面而漏掉选人配置 GUI。

### 不建议设计的多余 tools

这些 tools 不应进入第三阶段：

| Tool 形态 | 问题 |
| --- | --- |
| `addLongxiToAllSkills` | 把用户意图硬编码成专用工具，回到录制回放。 |
| `deleteSecondAButton` | 把一次自然语言指代写死。应由 `find_buttons` + `remove_skill_button` 完成。 |
| `executeWorkbenchIntent({ text })` | 黑盒化所有推理、审批和验证，等于绕开 typed tools。 |
| 角色专属工具，如 `laevatain.add_skill` | 会导致工具爆炸，并把数据内容写进能力边界。 |

## 推荐的 tool 定义字段

每个 DEF tool 至少包含：

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `scope`: `read` / `current-checkout` / `appdata-work-node`
- `riskLevel`: `read` / `low` / `medium` / `high`
- `approval`: `none` / `auto` / `ai-review` / `user-confirm`
- `verification`
- `rollback`
- `idempotency`
- `modelOutputPolicy`
- `auditLog`

运行时 context 至少包含：

- `sessionId`
- `messageId`
- `toolCallId`
- `agent`
- `saveId`
- `workNodeId`
- `currentCheckoutId`

## 硬编码边界

应该硬编码：

- tool schema
- data resolver
- permission / approval policy
- verifier
- rollback / work node 写入规则
- output bounding
- audit log

不应该硬编码：

- 用户说“长息”就固定加某个 buff
- 用户说“第二个 a”就固定删某个录制按钮
- 某个角色名/装备 ID 的回放脚本
- 预编排固定业务步骤替代模型推理

一句话：硬编码能力边界，不硬编码用户意图。

## 第三阶段 spec 候选方向

第三阶段可以围绕一个目标写 spec：

把 DEF workbench agent 从“webfetch 调 REST 命令队列”升级为“领域 typed tools + skill 说明 + work node 安全保障”的结构。

最小落地顺序建议：

1. 建立 DEF tool runtime/adapter 层，让模型看到领域工具，而不是只看到 webfetch。
2. 把现有 command op 包装成 typed tools，先不大改 renderer 执行逻辑。
3. 补 resolver tools：button / buff / skill / character。
4. 开放正式 ask/question 能力，支持 AI 自行判断是否反问。
5. 把 work node patch/diff/checkout 做成高风险 tool 组。
6. 给每个工具接 verification 和 audit log。

## 资料索引

本地 OpenCode：

- `agent/vendor/opencode/packages/opencode/src/tool/tool.ts`
- `agent/vendor/opencode/packages/opencode/src/tool/registry.ts`
- `agent/vendor/opencode/packages/opencode/src/tool/skill.ts`
- `agent/vendor/opencode/packages/opencode/src/tool/question.ts`
- `agent/vendor/opencode/packages/opencode/src/session/tools.ts`
- `agent/vendor/opencode/packages/opencode/src/permission/index.ts`
- `agent/vendor/opencode/packages/web/src/content/docs/custom-tools.mdx`
- `agent/vendor/opencode/packages/web/src/content/docs/skills.mdx`
- `agent/vendor/opencode/packages/web/src/content/docs/permissions.mdx`
- `agent/vendor/opencode/specs/v2/tools.md`

当前项目：

- `agent/runtime/def-opencode-adapter/index.cjs`
- `src/agentKernel/mainWorkbench/toolRegistry.ts`
- `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs`
- `src/components/CanvasBoard/MainWorkbenchAiPanel.tsx`
- `src/aiCli/aiCliRestAdapter.ts`

Claude Code 官方资料：

- Claude Code skills: `https://code.claude.com/docs/en/skills`
- Claude Code tools reference: `https://code.claude.com/docs/en/tools-reference`
- Claude Code MCP: `https://code.claude.com/docs/en/mcp`
- Claude Code hooks: `https://code.claude.com/docs/en/hooks`
- Claude Code plugins: `https://code.claude.com/docs/en/plugins`
- Claude Code settings: `https://code.claude.com/docs/en/settings`
