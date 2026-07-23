# Spec 9-2 Research：代码证据与实施边界

## 状态

证据复核完成。

本文件只做代码证据附录，不代替 [`spec.md`](./spec.md) 的三段叙事。它只记录：

1. 为什么旧系统必须解耦；
2. 新 Harness 系统可以复用哪些现有能力；
3. 五业务 V1 为什么能从当前产品状态和 Tool 面落地；
4. 实施时仍然缺少什么。

## 一、解耦的代码证据

### 1. 固定 Agent Prompt 已经是一套总 Harness

`agent/runtime/def-opencode-adapter/index.cjs` 的 `buildAgentPrompt("workbench")` 同时规定：

- 当前节点和 checkout 怎样读取；
- 选人怎样解析与应用；
- 排轴怎样建立 Work Node、编辑、验证和使用；
- 配装怎样读攻略、查 catalog、生成 proposal 和应用；
- `3+1` 怎样处理；
- Tool 失败后怎样停止；
- 最终回复应该说什么。

因此，只修改 `agent/harness/**` 不会完成 Harness 重构。真正的大量业务教学仍在固定 Agent Prompt 中。

### 2. Host Prompt 同时提供事实和业务命令

`agent/server/def-agent-server.cjs` 的：

- `buildWorkbenchCheckoutSystemPrompt()`
- `buildWorkbenchContextSystemPrompt()`

既注入当前 checkout、当前节点和切换状态，也写入：

- 必须先调用哪个 Tool；
- 什么问题只能调用某个 Tool；
- 失败后怎样停止；
- 怎样回复当前节点；
- 何时进行 bind。

当前 checkout 和硬 gate 必须保留；业务 Tool 顺序应迁入对应 Harness。

### 3. 旧八槽只有文件边界

`agent/harness/def-harness.cjs`：

- 固定声明八个 slot；
- 校验 manifest、路径和 hash；
- `composeHarnessSystem()` 按顺序全文拼接八槽内容；
- `createSessionBinding()` 把整包和 slot hash 绑定到 Session。

它没有识别：

- 这条规则属于哪个游戏业务；
- 它会改变什么状态；
- 它在哪个业务阶段生效；
- 它引用哪个 Tool；
- 它与其他 slot 是否重复或冲突。

所以八槽 package 能证明“这些文件没有被改”，不能证明“这些职责互相独立”。

### 4. 旧热插拔只对新 Session 生效

`docs/architecture/harness-training.md` 明确写明：

- 新 Session 选择一个不可变 Harness package；
- 后续回合继续使用相同 hash；
- promotion 和 rollback 只影响之后创建的 Session。

`getNativeHarnessSystem()` 的实现也按 Session binding 和 selector 缓存整包。

这适合旧训练实验，但不适合本轮要求：

- 同一 Session 会连续处理五种业务；
- 修改配装规则不应重新发布选人、排轴、BUFF 和计算；
- 用户不应为了使用新版配装 Harness 重建 Session。

### 5. runtime Skill 是第二套总 Harness

`agent/runtime/def/skills/timeline-workbench/SKILL.md` 并不只处理一项排轴技能。它同时包含：

- Workbench 总上下文；
- 多类业务路由；
- Tool 顺序；
- mutation；
- 知识读取；
- 失败处理；
- 回复要求。

它需要按业务迁移。最终不能继续作为五业务共同的第二套控制层。

### 6. 当前 router 只覆盖少量特例

`agent/runtime/def-opencode-adapter/harness-turn-router.cjs` 当前主要处理：

- 精确技能事实；
- timeline 意图对 operator-config candidate 的覆盖。

它没有输出：

- 五业务中的哪一项；
- 业务内动作；
- 目标；
- 是否继续旧事务；
- 是否是跨业务请求；
- 是否需要追问。

它可以提供少量确定性规则参考，但不能继续承担正式总路由。

### 7. Tool description 泄漏了跨 Tool 工作流

`agent/runtime/def-tools/opencode/def.js` 中部分 Tool description 不只说明本 Tool，还规定：

- 它必须是某类请求的第一步；
- 前后不能调用哪些 Tool；
- 下一步调用什么；
- 失败后停止整个回合；
- 怎样向用户呈现结果。

Tool 应继续声明真实 capability/token 来源，但完整业务流程必须迁入业务 Harness。

### 8. 真正的硬合同已经在代码中

以下能力已经由代码强制，不能在解耦中降级为 Prompt：

| 能力 | 当前主要位置 |
| --- | --- |
| host/workspace exposure | `agent/runtime/def-tools/registry.mjs` |
| Tool invocation policy | `scripts/ai-cli-rest-server.mjs` |
| Workbench Session-axis binding | `agent/server/def-agent-server.cjs`、timeline repository |
| checkout/projection 收敛 | `def-agent-server.cjs`、`ai-cli-rest-server.mjs` |
| native permission/approval | OpenCode permission + DEF Tool handler |
| proposal/capability/token | `agent/runtime/def-tools/opencode/def.js` 与 REST handler |
| revision/CAS | Work Node、operator config、team plan handler |
| 产品命令 schema | `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs` |
| semantic diff/postcondition | `ai-cli-rest-server.mjs`、Work Node runtime |
| 伤害公式 | 产品计算链路 |

这些是新 Harness 可以依赖的执行基础。

## 二、新 Harness 系统的可行性证据

### 1. Typed Tools 已经平级注册

`agent/runtime/def-tools/registry.mjs` 的 `DEF_NATIVE_TARGETS` 记录：

- canonical id；
- family；
- native binding；
- workspace scope；
- host exposure。

`agent/runtime/def-tools/opencode/plugin.js` 遍历这些 target，把可实现的 `def_*` binding 注册到同一个 OpenCode Tool map。

所以本轮不需要重构 Tool Registry 的形状。Harness 只需要按业务阶段引用这些 canonical id。

### 2. Tool 天然被多个业务共享

现有 Tool 已体现共享关系：

- Work Node fork/bind/validate/diff/use/restore 同时服务排轴与 BUFF；
- context、current checkout 和 buttons 可以被多个业务读取；
- operator、skill、BUFF、damage 等数据能力会服务不同业务；
- proposal、artifact、plan、approval capability 构成多步链路。

把 Tool 强行归到一个业务目录，会复制公共能力或制造反向依赖。平级注册、按阶段引用更符合当前实现。

### 3. OpenCode 已有 Tool 过滤基础

OpenCode 的 PromptInput 支持 Tool 开关和 permission。

`agent/vendor/opencode/packages/opencode/src/session/llm/request.ts` 的 `resolveTools()` 会在模型请求准备时，根据：

- 本次用户消息的 Tool 开关；
- Agent permission；
- Session/request permission

过滤最终提交给模型的 Tool。

这说明逐请求 Tool projection 可以落地。

### 4. 还缺少阶段变化后的再次投影

当前过滤只依据 Prompt/permission，并不知道 DEF 业务事务处于哪个阶段。

一个用户回合可能连续发生：

1. 调用 evidence Tool；
2. Tool 返回；
3. Harness 进入 plan 阶段；
4. 模型在同一回合继续运行。

若不增加阶段接缝，后一阶段要么看不到 Tool，要么必须在回合开始时暴露整个业务 Tool 集。

OpenCode plugin contract 已提供：

- `tool.execute.before`
- `tool.execute.after`

DEF plugin 目前只使用 before。本轮需要：

- before 校验当前事务和阶段；
- after 把 Tool result 交给事务运行时；
- 下一次模型请求根据新阶段重新过滤 Tool。

这是新系统明确需要补的代码，不是当前已经完成的能力。

### 5. Server 已经有两个清楚的正式入口

`agent/server/def-agent-server.cjs` 中：

1. OpenCode message proxy；
2. `sendNativeInteropPromptOnce()`。

两处都在发送前读取 binding、同步 axis、构建 checkout state、读取 Workbench context 和加载旧 Harness。

它们可以共同改成调用 `prepareWorkbenchTurn()`，形成唯一 Manager 接入口。

### 6. Session 工作目录可承载业务事务状态

当前每个受管 Workbench Session 已有：

- 独立 workspace directory；
- binding 文件；
- Work Node 关系；
- Session 清理流程。

业务事务可以以机器可读文件保存在该受管目录：

- 不需要新建全局 Session 管理器；
- Session 删除时自然清理；
- 恢复时可以检查 proposal、capability 和方案版本；
- 状态不会只存在 transcript。

写入需要原子替换，并且无法完整恢复时必须标记 stale/aborted。

### 7. 当前产品已经有事务积木

现有链路已经产生并校验：

- proposal token；
- planner profile capability；
- catalog artifact id；
- plan hash；
- node id/revision；
- checkout id/revision；
- native approval；
- visible postcondition。

新 Harness Runtime 应组织这些 typed result，不需要再用自然语言发明一套事务协议。

## 三、五业务边界的产品证据

### 1. 当前方案本身已经呈现五业务状态

`agent/runtime/def-node-workspace/codec.mjs` 把 Work Node payload 解码为：

- `selection.selectedCharacters`
- `timeline.staffLines`
- `buffs.allBuffList`
- `inputs.characterInputMap`
- `inputs.operatorConfigPageCache`

产品页面和 Tool 又分别提供：

- selection；
- operator loadout/config；
- timeline buttons；
- selected BUFF；
- damage report。

这与用户给出的五业务流程一致：

```text
选人 → 配装 → 排轴 → 上 BUFF → 计算与统计
```

### 2. 不能按物理文件切业务

`selectedBuff` 位于 timeline button 上。

同一个 button 同时包含：

- 技能身份；
- 角色；
- 位置；
- 排轴顺序；
- BUFF 绑定。

`skillButtonTable` 与 `timelineData.staffLines` 还必须保持镜像一致。

因此：

- timeline Harness 决定按钮和排轴；
- buff Harness 决定按钮上的 BUFF；
- 产品 codec 负责镜像同步；
- 不能把整个 button 文件交给其中一个 Harness。

### 3. 不能按角色、术语或实体切 Harness

“给别礼配置 3+1 潮涌套”包含：

- 别礼：目标角色；
- 3+1：装备组合术语；
- 潮涌套：装备实体；
- 配置：用户要求的业务结果。

只有“配置”拥有独立业务状态和完成条件，所以它属于 loadout。

角色仍会出现在选人、排轴、BUFF 和计算中；若一个角色一个 Harness，会把五套业务流程复制到每个角色。

### 4. 不能按单个动作切 Harness

新增、删除、换人和排序都会改变同一份 selection，并共享同一套队伍合法性和下游影响。

推荐、比较、预览和应用都会围绕同一份 loadout 候选。

所以这些是业务内 operation，不是新的 Harness。

### 5. 不能建立万能 Workbench Harness

一个万能 Harness 虽然能处理跨业务请求，但会恢复当前问题：

- 所有规则再次写在一起；
- 五业务不能独立更新；
- 一个局部术语容易污染全局；
- 无法判断一次 mutation 到底由谁负责。

跨业务请求应由 Manager 记录顺序，每一步仍由一个业务 Harness 完成。

## 四、五业务 V1 可复用的 Tool 面

下表只记录主要能力方向，实际 Revision 必须从 `DEF_NATIVE_TARGETS` 引用真实 canonical id。

| 业务 | 当前可复用能力 |
| --- | --- |
| 选人 | current selection、operator catalog、`def.team.selection.apply`、native approval、visible selection postcondition |
| 配装 | team loadouts、guide/profile、combat conventions、weapon/equipment catalog、native artifact、fit/3+1 planner、operator/team proposal、config apply/postcondition |
| 排轴 | checkout/context/buttons、skill facts、Work Node fork/bind、native read/edit/apply_patch、rebuild/validate/diff/use/restore |
| BUFF | context/buttons、BUFF catalog、buff ranking、Work Node edit/validate/diff/use/restore |
| 计算统计 | current scheme snapshot、damage/report、公式引擎和统计结果 |

Tool 面已经足够建立五个 V1 的主要流程。若某个 V1 operation 没有真实能力，Revision 必须返回 unsupported，而不是绕过 registry。

## 五、仍需实施的真实缺口

| 缺口 | 本轮要补什么 |
| --- | --- |
| 旧行为来源重复 | 按唯一归属迁移并删除旧 owner |
| 没有唯一回合入口 | `prepareWorkbenchTurn()` |
| 没有五业务 Registry | business definition + per-business Revision |
| 没有结构化总 Router | new/continue/pipeline/clarify |
| 首次模型请求尚不知道加载哪个业务 | Manager route phase + internal route 提交能力 |
| 没有机器可读业务事务 | Session 目录中的 transaction/plan state |
| 没有阶段 Tool projection | OpenCode request bridge + plugin before/after |
| 没有业务 semantic write-scope | selection/loadout/timeline/buff/calculation change ownership |
| 没有下游处理 | continue/stale/hard-invalid/recompute |
| 旧热重载依赖新 Session | 单业务 activate/rollback/revoke |
| 没有五个真实 Revision | 五个 definition + V1 manifest + instructions |
| 新旧链路可能并存 | 一次正式切换和旧运行入口删除 |
| 缺少整体证据 | 合同测试、Interop 黑盒和真实 UI |

## 六、实施边界

### 必须保留

- Workbench Session-axis 与 checkout；
- projection 收敛；
- Typed Tool canonical registry；
- host/workspace exposure；
- permission、native approval 和 capability；
- revision/CAS；
- Work Node validate/diff/use/restore；
- 产品命令与伤害公式；
- 真实页面 postcondition；
- AI CLI DEF OpenCode host 禁用状态。

### 不应扩大

- 不重构游戏数据；
- 不改伤害公式；
- 不重做 Tool Registry；
- 不增加角色/术语 Harness；
- 不增加万能 Harness；
- 不把新 Manager 做成多 Agent 系统；
- 不长期保留兼容双轨；
- 不改写或清理 `data/sharedata/**`。

## 七、结论

当前代码已经具备五业务所需的大部分 Typed Tools、产品状态、审批、版本和后置验证能力。

真正缺失的不是更多 Tool，而是三件连续的工程工作：

1. 把旧的多重业务 owner 解耦；
2. 建立一个能管理业务上下文、事务、阶段和版本的 Harness 系统；
3. 把现有有效业务规则迁成五个可以真实运行的 V1 Harness。

这三件事正是 [`spec.md`](./spec.md) 和 [`tasks.md`](./tasks.md) 的唯一施工主线。
