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

### 1. Read tools

只读，不改状态。

- `def.workbench.snapshot`
- `def.workbench.evidence`
- `def.workbench.list_buttons`
- `def.workbench.list_characters`
- `def.workbench.damage_report`

要求：

- 输出不要把整个快照无脑塞给模型
- 支持 filter / projection / limit
- 返回稳定 ids 和人类可读 label

### 2. Resolver tools

负责把自然语言候选解析成稳定对象，但不直接写状态。

- `def.workbench.find_buttons`
- `def.buff.resolve`
- `def.skill.resolve`
- `def.character.resolve`
- `def.equipment.resolve`

要求：

- 返回 candidates、confidence、ambiguity
- 模糊时建议反问问题
- 不把“长息”写死，只做数据驱动搜索

### 3. Current checkout edit tools

直接改当前迁出态，适合低风险、小范围、用户已明确的操作。

- `def.workbench.add_skill_button`
- `def.workbench.remove_skill_button`
- `def.buff.add_to_button`
- `def.buff.add_to_buttons`
- `def.buff.remove_from_button`
- `def.target.set_resistance`
- `def.damage.calculate`

要求：

- 输入必须是明确 id 或经过 resolver 确认的对象
- 每个工具自带 risk / approval / verifier
- 输出必须包含 applied / skipped / duplicate / failed

### 4. Work node tools

用于高风险、批量、重排轴、试错式编辑。

- `def.worknode.create_from_current`
- `def.worknode.read`
- `def.worknode.patch`
- `def.worknode.diff`
- `def.worknode.checkout`
- `def.worknode.restore_base`

要求：

- work node 存在 appdata/localdata，不是 localStorage/sessionStorage
- 每个存档 id 对应独立节点，类似分支
- 当前迁出态只在 checkout / rollback 阶段被写入
- patch DSL 要比当前第二阶段更完整，但仍然受 schema 约束

### 5. Approval / ask tools

用于低阻塞审批和反问。

- `def.user.ask`
- `def.approval.request`
- `def.approval.record_decision`

要求：

- 支持 AI 自行判断是否需要问
- 支持 optional / non-blocking / blocking 三类问题
- 支持审批记录进本地工作节点
- 不把所有事情变成强制弹窗

### 6. Verification tools

让模型不是“猜成功”，而是拿到结构化验收结果。

- `def.verify.command_result`
- `def.verify.snapshot_delta`
- `def.verify.buttons_have_buff`
- `def.verify.damage_recalculated`
- `def.verify.worknode_diff_clean`

要求：

- 返回 pass/fail/warn
- 返回最小证据
- 支持失败时给出下一步建议

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
