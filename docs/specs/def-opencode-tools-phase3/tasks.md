# def-opencode tools 第三阶段 tasks

## Status

第三阶段目标：把 DEF workbench agent 从“webfetch 调 REST 命令队列”升级为“领域 typed tools + resolver + ask/approval + verification + work node Patch DSL”的结构。

本阶段必须继承第二阶段的类代码工具方向：`def.worknode.patch` 是高风险/批量/重排轴场景的核心工具，不得退回到直接改当前迁出态，也不得把自然语言意图硬编码成专用快捷流。

当前任务状态：

- Task 1: 待完成，建立 DEF typed tool runtime / adapter。
- Task 2: 待完成，补 tool discovery 与 tool metadata 输出。
- Task 3: 待完成，将已有 current checkout command op 包装成 typed tools。
- Task 4: 待完成，补 read tools。
- Task 5: 待完成，补 resolver tools。
- Task 6: 待完成，升级 work node Patch DSL / 类代码 CRUD 工具。
- Task 7: 待完成，补 ask / approval tools。
- Task 8: 待完成，补 verification tools。
- Task 9: 待完成，补选人/配置页 tools 范围。
- Task 10: 待完成，清理多余/错误 tool 形态，防止硬编码意图回潮。

## Task 1: 建立 DEF typed tool runtime / adapter

- 让模型看到 DEF 领域工具，而不是只看到通用 `webfetch` + REST URL。
- tool runtime 负责 schema decode、policy、approval、verification、bounded output、audit context。
- 先复用现有 command queue / renderer 执行层，避免大改 UI 执行路径。

验收：

- 有统一入口能注册/描述/调用 DEF workbench typed tools。
- 每次 tool call 都包含 `sessionId`、`messageId`、`toolCallId`、`agent`、`saveId`、`workNodeId`、`currentCheckoutId` 中可取得的上下文。
- 模型不需要记忆 `/api/main-workbench/commands/enqueue` 的 body 细节即可调用业务工具。

## Task 2: 补 tool discovery 与 metadata 输出

- 新增或等价实现 `def.tool.list`。
- 新增或等价实现 `def.tool.describe`。
- 输出每个 tool 的 name、description、inputSchema、outputSchema、scope、riskLevel、approval、verification、rollback、idempotency、modelOutputPolicy、auditLog。

验收：

- agent 可查询当前可用 DEF tools。
- agent 可查询单个 tool 的 schema 与风险策略。
- tool 列表不是 prompt 手写常量的唯一事实源。

## Task 3: 包装 current checkout edit tools

- 将已有当前迁出态命令包装为 typed tools：
  - `def.workbench.add_skill_button`
  - `def.workbench.remove_skill_button`
  - `def.buff.add_to_button`
  - `def.buff.add_to_buttons`
  - `def.buff.remove_from_button`
  - `def.target.set_resistance`
  - `def.damage.calculate`
- 这些工具适合低风险、小范围、用户已明确的直接操作。
- 输入必须是稳定 id 或 resolver 确认后的对象。

验收：

- 每个工具返回 `applied` / `skipped` / `duplicate` / `failed` 等结构化结果。
- `enqueue` 成功不得被描述为业务完成，必须有 command result 或 snapshot verification。
- 批量 buff 场景优先使用 `def.buff.add_to_buttons`，不得生成 `addLongxiToAllSkills` 这类专用硬编码工具。

## Task 4: 补 read tools

- 实现或包装：
  - `def.workbench.snapshot`
  - `def.workbench.evidence`
  - `def.workbench.list_buttons`
  - `def.workbench.list_characters`
  - `def.workbench.damage_report`
- 输出必须支持 filter / projection / limit。
- 返回稳定 ids 和人类可读 label。

验收：

- “当前第一个干员”“第二个 a”“当前有哪些技能按钮”可由 read tools 给出足够证据。
- `snapshot` 不把完整大对象无脑塞给模型。
- `evidence` 成为模型主读入口之一。

## Task 5: 补 resolver tools

- 实现或包装：
  - `def.workbench.find_buttons`
  - `def.buff.resolve`
  - `def.buff.search_candidates`
  - `def.skill.resolve`
  - `def.character.resolve`
  - `def.equipment.resolve`
  - `def.weapon.resolve`
  - `def.gear.resolve`
- resolver 只解析候选，不直接写状态。
- 返回 candidates、confidence、ambiguity、suggestedQuestion。

验收：

- “长息”必须通过数据驱动解析出候选来源和完整 buff 对象，不得硬编码为固定 buff。
- “第二个 a”必须解析为候选按钮列表和明确歧义/置信度。
- 模糊时给出适合 `def.user.ask` 的问题建议。

## Task 6: 升级 work node Patch DSL / 类代码 CRUD 工具

- 将 `patchAiTimelineWorkNode` 升级或包装为 `def.worknode.patch`。
- 补 `def.worknode.read` 和 `def.worknode.validate`。
- 保留并完善：
  - `def.worknode.create_from_current`
  - `def.worknode.patch`
  - `def.worknode.validate`
  - `def.worknode.diff`
  - `def.worknode.checkout`
  - `def.worknode.restore_base`
- Patch DSL 是受控领域 CRUD，不允许任意 JS、任意源码编辑、任意完整 JSON 覆盖。

验收：

- 高风险/批量/重排轴请求可走 `create -> patch -> validate -> diff -> approval -> checkout -> verify`。
- patch 只修改 appdata/localdata work node 的 `workingPayload`，不直接写 current checkout。
- checkout / rollback 阶段才允许写当前迁出态。
- patch 失败不得污染 current checkout。

## Task 7: 补 ask / approval tools

- 实现或包装：
  - `def.user.ask`
  - `def.approval.request`
  - `def.approval.record_decision`
- 支持 optional / non-blocking / blocking 三类问题或审批。
- 支持 AI 自行判断是否需要问，但 policy 和 verifier 必须兜底。

验收：

- 模型反问用户不再只能走普通聊天文本。
- 低风险场景不被强制弹窗阻塞。
- 审批理由和结果可写入 work node audit。

## Task 8: 补 verification tools

- 实现或包装：
  - `def.verify.command_result`
  - `def.verify.snapshot_delta`
  - `def.verify.buttons_have_buff`
  - `def.verify.damage_recalculated`
  - `def.verify.worknode_diff_clean`
- verification 可由 edit tool 自动调用，也可单独暴露给模型用于 repair loop。

验收：

- 每个验证工具返回 pass / fail / warn。
- 返回最小证据，不输出无关大对象。
- 批量 buff 后可以一次验证目标按钮是否都已有指定 buff。
- damage calculate 后可以验证伤害报告已刷新。

## Task 9: 补选人/配置页 tools 范围

- 纳入 GUI 能力范围：
  - `def.operator.config.read`
  - `def.operator.config.patch`
  - `def.weapon.resolve`
  - `def.gear.resolve`
  - `def.gear.set_entry_level`
- 覆盖角色等级、潜能、技能等级、武器、武器技能、装备、装备词条等级、面板 information。

验收：

- tools 范围不只覆盖排轴主界面，也覆盖选人配置 GUI 的核心可编辑内容。
- 配置页修改使用结构化字段或 Patch DSL，不写 DOM 点击脚本。

## Task 10: 清理多余/错误 tool 形态

- 禁止新增专用意图工具：
  - `addLongxiToAllSkills`
  - `deleteSecondAButton`
  - 角色专属工具如 `laevatain.add_skill`
  - `executeWorkbenchIntent({ text })`
- 删除或降级旧的录制回放式自然语言 regex 主路径。
- 保留安全边界硬编码：schema、resolver、policy、verifier、rollback、output bounding、audit log。

验收：

- 业务意图由模型理解，代码只提供稳定工具边界。
- 不把角色名、装备 ID、Buff 名称、固定步骤写成产品代码里的回放脚本。
- prompt 不再是工具协议的唯一事实源。
