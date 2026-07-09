# def-opencode tools 第三阶段 tasks

## Status

第三阶段目标：把 DEF workbench agent 从“webfetch 调 REST 命令队列”升级为“领域 typed tools + resolver + ask/approval + verification + work node Patch DSL”的结构。

本阶段必须继承第二阶段的类代码工具方向：`def.worknode.patch` 是高风险/批量/重排轴场景的核心工具，不得退回到直接改当前迁出态，也不得把自然语言意图硬编码成专用快捷流。

当前任务状态：

- Task 1: 已完成最小实现，新增 `/api/def-tools` typed tool runtime 入口，仍复用 command queue 执行层。
- Task 2: 已完成最小实现，新增 `def.tool.list` / `def.tool.describe`。
- Task 3: 已完成最小实现，将已有 current checkout command op 包装为 typed tools。
- Task 4: 已完成最小实现，补 read tools。
- Task 5: 已完成最小实现，补 resolver tools 的当前快照搜索版，`find_buttons` 支持 buttonId/位置/ordinal，后续需接完整库/别名/模板。
- Task 6: 已完成最小实现，将 `patchAiTimelineWorkNode` 包装为 `def.worknode.patch`，并补 `def.worknode.read` / `def.worknode.validate`。
- Task 7: 已完成最小实现，ask / approval tools 可写入本地 governance 记录，尚未接 UI 弹窗。
- Task 8: 已完成最小实现，补 command/snapshot/buff/damage/worknode diff verification。
- Task 8 补充：已新增 `def.worknode.checkout_and_verify`、`def.worknode.restore_base_and_verify`、`def.damage.calculate_and_verify`，并把 damage verifier 收紧为校验 command damage report 的 `buttonCount`。
- Task 8/黑盒补充：自然语言 REST 后门 15 条场景测试暴露三个问题：
  - “给佩丽卡加个普攻”曾因 agent 自行加/查/重试导致同一技能重复添加两次，并撞到最大步数。
  - “把洁尔佩塔换成佩丽卡”实际 UI 已换人，但 REST snapshot mirror 仍读到旧队伍，原因是选人页不写 `def.main-workbench.snapshot.v1`，只有 CanvasBoard 写镜像。
  - “长息”解释/歧义链路会跑到 90s 超时，说明装备/Buff 查询还缺短摘要路径。
- Task 8/修复补充：已新增 `def.workbench.add_skill_button_and_verify`，用于一次完成加技能、等待命令执行、检查 snapshot 新增一个按钮；已补 AppContext 在非 canvas 视图写 main workbench snapshot mirror，避免选人页 UI 与 REST 读数不一致。
- Task 9: 首批实现，已补 operator config read、weapon/gear resolver、config patch、gear entry edit；后续需加强配置 patch 的验证、UI 审批和更细 schema。
- Task 10: 已在工具清单中约束，仍需持续清理旧 prompt/regex 路径。
- Agent 能力测试通路：已在 dev-agent / Electron bridge 增加 `POST /def-agent/workbench-test/prompt`，用于模拟主界面 AI 输入框投喂一句话；bridge 会同步广播 `/def-agent/workbench-test/ui-events`，主界面 `MainWorkbenchAiPanel` 必须展示 live 用户消息和 agent 回复。以后测试 agent 能力不能只看 transcript/SSE，必须确认 `prompt -> ui-events -> MainWorkbenchAiPanel` 前端可见链路。UI 面板必须忽略历史 `replay` 测试事件，避免旧测试会话回放污染当前对话。它不是产品业务 tool，不能替代 typed tools。

第三阶段下半轮定位：

- 上半轮已经把 DEF 工具目录和一批原子 typed tools 做出来。
- 下半轮不推翻工具平级注册模型，而是在同一个 registry 里补“组合型平级工具”。
- 组合工具的目的不是增加 AI 智能，而是把固定安全流程放进代码，让 agent 少临场串步骤。
- 判断标准从“工具是否登记”升级为“自然语言 agent 能否少步数、可验证地完成一条常用业务链路”。
- 下半轮优先解决 worknode 安全改副本链路；Buff、技能按钮、配置页组合工具按同一模式后续扩展。

阶段边界补充：

- 第三阶段验收重点是 tools / command / REST 能力真实可调用，尤其是 work node 的 create、patch、validate、diff、checkout、restore_base。
- `def.worknode.restore_base` / `restoreAiTimelineWorkNodeBase` 在第三阶段只要求命令层能把指定 work node 的 `basePayload` 恢复到当前迁出态，并记录 rollback applied。
- 本轮确认：worknode 当前态来源必须优先取主界面 snapshot mirror。浏览器用户手动换角色/换轴后，typed tools 应以 mirror 为当前事实源；不得在 mirror 可用时退回最近旧 worknode，否则会把旧排轴误当 base。
- 本轮确认：snapshot mirror 必须由“当前业务状态”维护，不能只由 CanvasBoard 维护；选人页换角色后也必须立即同步给 REST 后门，否则 agent 会拿旧证据回答。
- work node 列表、节点详情、diff 面板、checkout/restore 按钮、回退前后状态展示属于第四阶段 UI 联调和产品闭环。
- 因此“回退节点 UI 没落实”是第三阶段 feedback 风险，不等于第三阶段 tool 能力缺失；但第三阶段必须避免只注册名字、实际命令不可执行。

## 当前缺口 TODO

第三阶段不是缺少大方向，而是缺少可执行细项。以下 TODO 用于把“最小实现”推进到“可验收实现”。

### P0：第三阶段下半轮组合工具

- [x] 新增 `def.worknode.patch_and_validate` 首批实现
  - 已支持已有 `nodeId` 的 Patch DSL 安全链路。
  - 已覆盖 `addButton/removeButton/moveButton/attachBuff/removeBuff/setTargetResistance/clearTimeline`。
  - 已返回 validate / diffSummary / changedButtons / riskFlags / currentCheckoutTouched。
  - 已增强服务端 validate：检查 timeline buttons、skillButtonTable、selectedBuff 引用一致性。
  - 已在 `/api/def-tools` 和 `/api/def-tools/describe` 中注册具体 schema。
  - [x] 输入允许 `nodeId?`，没有传入时可从可用当前 payload 镜像创建新 work node。
  - 输入包含 `patch`、`dryRun?`、`checkout?: false`、`approvalPolicy?`、`label?`。
  - 默认不得 checkout，不得修改当前迁出态。
  - 内部完成：create/select node -> patch -> validate -> diff -> worknode_diff_clean -> current checkout pollution check。
  - 输出必须包含 `ok`、`nodeId`、`patchApplied`、`validation`、`diffSummary`、`changedButtons`、`checkout:false`、`currentCheckoutTouched:false`、`riskFlags`、`nextActions`。
  - 失败时也要返回已完成到哪一步、是否触碰当前迁出态、可重试建议。
- [x] 强化 `def.worknode.patch` 输出
  - 返回结构化 `changedButtons`，至少覆盖 add/remove/move/attachBuff/removeBuff。
  - 返回 `diffSummary` 和 `riskFlags`，减少 agent 额外调用 diff 的必要性。
  - 返回 `currentCheckoutTouched:false`，明确只改 work node `workingPayload`。
- [x] 强化 `def.worknode.create_from_current` 输出
  - 返回 `nodeId`、`baseSummary`、`workingSummary`、`buttonTargets`。
  - `buttonTargets` 至少包含 buttonId、label、staffIndex、nodeIndex，方便下一步 patch 直接引用。
  - 本轮修正：server-side create 当前态来源改为 `main-workbench-snapshot-mirror` 优先，避免浏览器测试/用户手动换角色后误读最近旧 worknode。
- [x] 给 `/api/def-tools/describe` 补更具体 schema
  - `def.worknode.patch` / `patch_and_validate` 不再只写 `{ type: 'object' }`。
  - Patch DSL 的 op、target 字段、必填字段、风险说明必须能由 describe 读到。
  - 目标是让 agent 少查源码、少猜字段。
- [x] 固定下半轮自然语言验收用例
  - “从当前排轴创建工作节点副本，只在副本里把第一个技能按钮向后移动一格，然后 validate 和 diff，不要 checkout，不要改当前排轴。”
  - 验收必须同时记录：工具 runtime、agent transcript、前端可见、当前迁出态污染检查。
  - 通过标准：agent 不需要手动串完整 5 步，最终能返回 nodeId、diff 摘要、validate 结果和未污染证明。
  - 本轮验收记录：workbench-test session `ses_0bacce9e6ffeGPSKJ5ic2EB4B4` 只调用 `def.worknode.patch_and_validate`，返回 node `ai-timeline-node-1783572419612-qlrkirvi`；diff 为 `fv7tradpm` 从 `莱万汀-燃烬@1-1` 到 `莱万汀-燃烬@1-2`；当前 checkout 仍为 `莱万汀-燃烬@1-1`。

### P1：提示词事实源收敛

- [ ] 抽出共享 workbench prompt builder 或共享 prompt 片段
  - 覆盖 runtime adapter、Electron bridge、dev-agent workbench-test、MainWorkbenchAiPanel。
  - 避免同一条工具链规则分散维护。
  - prompt 只负责告诉 agent 优先入口和安全边界，不再承载工具 schema 的唯一真相。
- [ ] 新增或调整 runtime skill：`workbench-tools` / `worknode-safety`
  - 只写工作流规则和判断口径，不写角色、Buff、装备固定业务脚本。
  - 明确：低风险明确编辑走 current checkout typed tools；高风险/批量/重排轴走 worknode 组合工具。
  - 明确：模糊对象先 resolver；queued 不等于完成；最终汇报要分测试层级。
- [ ] 重新定位外部 OpenCode plugin / skills
  - 不作为第三阶段主线。
  - Morph、Serena、LSP、Context7 只用于开发本项目本身的辅助能力，不接入嵌入式 DEF agent 主链路。
  - `oh-my-opencode` / slim 不作为解决 worknode 长链路的首选方案。

### P0：把 planned 工具变成可用工具

- [x] `def.operator.config.patch` 首批实现
  - 支持 `characterId` / `characterName` 定位干员。
  - 支持 `weapon` patch：武器名、等级、潜能、武器技能等级。
  - 支持 `equipment` patch：装备名/ID、套装名/ID、槽位、四件套自动填充、词条等级。
  - 支持批量 patch，并返回 batchId、commands、verificationRequired。
  - 短期实现可复用 `setOperatorWeapon` / `setOperatorEquipment` command queue，但 tool 层必须隐藏底层 op 细节。
- [x] `def.gear.set_entry_level` 首批实现
  - 支持按干员、槽位、装备名/ID、套装名/ID 设置词条等级。
  - 支持 `entryLevel` 一键设置所有词条，也支持 `entryLevels` 精确设置。
  - 不直接改 DOM，不直接写 storage，走受控配置命令或 work node patch。

### P0：补齐工具调用结果语义

- [x] current checkout edit tools 返回值必须区分：
  - `queued`：已进入执行队列。
  - `applied`：已通过 command result 或 snapshot verification 确认生效。
  - `skipped`：重复、无目标或无需修改。
  - `failed`：schema、resolver、执行或验证失败。
- [x] 在还复用 command queue 的阶段，tool 返回必须明确 `queued does not mean applied`。
- [x] 所有 edit tool 输出 `verificationRequired`，并指向可用 verify tool。

### P0：resolver 需要从“当前快照搜索”升级为“数据驱动候选”

- [x] `def.buff.resolve` 首批完整对象实现
  - 从当前按钮 buff、装备效果、套装三件套、武器技能、干员技能候选中解析。
  - 返回完整 buff object，能直接用于 `def.buff.add_to_button(s)`。
  - “长息”这类简称必须解析出来源，而不是硬编码。
- [x] `def.workbench.find_buttons` 首批自然语言解析
  - 支持“当前第一个干员”“第二个 a”“第一行第三个”等用户语言映射。
  - 返回 candidates、confidence、ambiguity、suggestedQuestion。
- [x] `def.skill.resolve` / `def.character.resolve`
  - 支持中文名、别名、拼音、当前选择顺序。

### P1：审批与反问从本地记录接到 UI

- [x] `def.user.ask` 写入 governance 记录后，主界面 AI 面板能展示问题。
- [x] `def.approval.request` 支持非强制审批提示。
- [x] 高风险 checkout / restore / 批量重排轴必须能把 approval record 写入 work node audit。
- [x] 低风险明确操作不得被强制弹窗阻塞。

### P1：验证工具变成 repair loop 的一部分

- [x] edit tool 可自动附带推荐 verification。
- [x] agent prompt 必须要求：最终回复前至少完成关键验证。
- [x] `def.verify.snapshot_delta` 支持输入 expected delta，而不是只返回当前事实。
- [x] `def.verify.command_result` 支持 batchId 和 commandId，并返回失败命令摘要。

### P1：类代码工具继续强化

- [x] `def.worknode.patch` 的 patch schema 文档化。
- [x] patch 支持 dryRun、validate、diff 三段证据。
- [x] 对批量 buff、移动轴、重排轴、批量删除等高风险操作，prompt 明确优先使用 work node patch。
- [x] checkout 前必须跑 `def.worknode.validate` + `def.verify.worknode_diff_clean`。
- [ ] 点测 `def.worknode.checkout` 命令层真实应用 workingPayload，并返回 commit / checkoutApplied / currentDiff。
- [ ] 点测 `def.worknode.restore_base` 命令层真实恢复 basePayload，并返回 rollbackApplied / currentDiff。
- [ ] 明确记录：checkout / restore 的 UI 按钮和节点面板不属于第三阶段完成项，转入第四阶段。

`def.worknode.patch` 当前 Patch DSL：

- `addButton`
  - `characterName`
  - `skillType?`
  - `runtimeSkillId?`
  - `skillDisplayName?`
  - `staffIndex?`
  - `nodeIndex?`
- `removeButton`
  - `target`
- `moveButton`
  - `target`
  - `staffIndex?`
  - `nodeIndex`
- `attachBuff`
  - `target`
  - `buffId`
- `removeBuff`
  - `target`
  - `buffId`
- `setTargetResistance`
  - `target`
  - `targetResistance`
- `clearTimeline`

`target` 结构：

- `buttonId?`
- `characterName?`
- `skillType?`
- `nodeIndex?`
- `latest?`

Patch DSL 约束：

- 只能修改 work node 的 `workingPayload`。
- 不允许任意 JS。
- 不允许任意源码编辑。
- 不允许完整 JSON 覆盖 current checkout。
- 多候选 target 必须提供 `buttonId` / `nodeIndex`，或显式 `latest:true`。

### P2：清理旧路径

- [x] 降级 `/api/main-workbench/commands/enqueue` 在 prompt 里的位置，只作为 typed tools 的底层实现说明。
- [x] 清理主界面 AI 面板里旧的固定 op 教程文本，避免模型绕过 typed tools。
- [x] 合并或明确区分 `src/agentKernel/mainWorkbench/toolRegistry.ts` 与 `/api/def-tools` runtime，避免双事实源。
- [x] 禁止恢复录制回放式 regex 意图流。

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
- `def.worknode.restore_base` 必须能通过命令层恢复指定节点的 `basePayload`，并写入 rollback applied 记录。
- 第三阶段不要求用户在主界面手动点击 restore；第四阶段再补 work node UI 和回退按钮。

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
- 本轮点测：
  - `def.worknode.patch_and_validate` 创建 node `ai-timeline-node-1783592617026-zf874o15`，source=`main-workbench-snapshot-mirror`，base `buttonCount=0`，working `buttonCount=1`。
  - `def.worknode.checkout_and_verify` 对该 node 返回 `ok:true`，snapshot `buttonCount` 从 0 到 1，`reload:false`。
  - `def.damage.calculate_and_verify` 返回 `ok:true`，command damage report `buttonCount=1`，按钮为 `佩丽卡 / 协议α·突破`，证明 checkout 后可进入伤害报告链路。
  - `def.worknode.restore_base_and_verify` 返回 `ok:true`，snapshot `buttonCount` 从 1 回到 0，测试态已恢复。
  - 说明：测试态未配置面板/装备快照，所以 totalExpected 为 0；本轮验收关注链路可见性和 report buttonCount，不把数值伤害作为通过条件。

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

## Task 11: 第三阶段下半轮组合工具

目标：在现有平级 typed tool registry 中补组合型平级工具，压缩 agent 常用安全链路。

首个组合工具：

- `def.worknode.patch_and_validate`（首批已实现已有 `nodeId` + Patch DSL 路径）

它不是 `def.worknode.patch` 的父工具，也不是 OpenCode registry 里的上级目录；它只是一个同样平级注册、但业务抽象更高的工具。

推荐调用语义：

```json
{
  "nodeId": "optional-existing-node-id",
  "label": "move first skill button demo",
  "checkout": false,
  "patch": [
    {
      "op": "moveButton",
      "target": { "buttonId": "..." },
      "nodeIndex": 1
    }
  ]
}
```

工具内部流程：

```text
create/select work node
  -> apply patch to workingPayload
  -> validate basePayload and workingPayload
  -> build diff
  -> verify diff risk
  -> verify current checkout untouched when checkout=false
  -> return bounded summary
```

输出至少包含：

- `ok`
- `nodeId`
- `patchApplied`
- `validation`
- `diffSummary`
- `changedButtons`
- `checkout`
- `currentCheckoutTouched`
- `riskFlags`
- `nextActions`

验收：

- agent 对安全改副本演示不再需要显式调用 create、patch、validate、diff、verify 五个工具。
- 工具返回足够证据支持最终回复。
- `checkout:false` 时必须证明当前迁出态未被修改。
- 失败时必须清楚说明失败阶段和污染状态。

## Task 12: 第三阶段下半轮 prompt/skill 收敛

目标：减少“提示词分散”和“schema 靠 prompt 口口相传”。

范围：

- runtime adapter 的 workbench prompt。
- Electron bridge 的 workbench-test prompt。
- dev-agent 的 workbench-test prompt。
- MainWorkbenchAiPanel 注入给 agent 的上下文。
- runtime skill 中面向 workbench 的规则。

验收：

- worknode 工具链规则只维护一份或有明确共享来源。
- `def.worknode.patch` / `patch_and_validate` 的 schema 以 `/api/def-tools/describe` 为准。
- prompt 中不再复制过长 Patch DSL，只保留最小入口和安全边界。
- 外部 skill/plugin 不是第三阶段下半轮依赖项。
