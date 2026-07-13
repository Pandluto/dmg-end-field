# DEF Agent 提示词、YZ 蒸馏与 Agent 指南提升方案研究（2026-07-13）

## 研究问题

结合 DEF OpenCode Spec 7、完成后的健康度审查，以及刚加入的月咒（YZ）攻略蒸馏，本研究回答三个问题：

1. 提示词还应承担什么，继续加长是否能提升项目效果；
2. 博主攻略蒸馏应如何进入 Agent，而不与实时数据和节点编辑事实冲突；
3. `AGENTS.md` / skill 类 Agent 指南如何分层，才能提升任务完成率、业务回答质量和长期可维护性。

本轮只形成实现方案与验证方法，不编写下一阶段 spec/tasks，也不把未经黑盒验证的推断写成已实现效果。

运行时正文可达性、OpenCode skill 加载机制与知识 typed resource 方案的进一步审计，见 [`research-yz-runtime-deep-dive-20260713.md`](./research-yz-runtime-deep-dive-20260713.md)。该审计发现当前攻略正文尚未形成可证明的产品 Agent 消费链路，因此应优先于批量扩充资料或 prompt 调优处理。

## 结论摘要

三种手段都值得使用，但它们解决的是不同问题，不能互相替代：

| 手段 | 最适合解决 | 不应承担 | 当前判断 |
| --- | --- | --- | --- |
| Agent system prompt | 身份、host 职责、全局不变量、工具族路由、回复风格 | 完整操作教程、动态 checkout 事实、工具 schema、安全兜底 | 当前过长且与 skill 重复，应收敛 |
| YZ 博主蒸馏 | 玩家语言理解、阵容套路、循环经验、装备取舍、场景判断 | 实时数值、官方 id、当前画布事实、写入协议 | 能补足“会操作但不会判断”，价值高 |
| Agent 指南 / skill | 特定任务的可复用流程、歧义处理、领域资料路由 | 权限、CAS、审批、只读路径等硬安全 | 已有正确雏形，但需去重并增加组合指南 |
| typed tools + runtime state | 事实读取、执行、校验、权限、revision、checkout gate | 玩家经验和自然语言表达 | 继续作为确定性底座 |

最推荐的方向不是“写一份更强的大提示词”，而是形成四层闭环：

```text
短 system prompt（身份与不变量）
  → 按需加载 task skill（怎么完成）
  → 按需检索 YZ references（为什么这样排/配）
  → typed tools + runtime state（现在是什么、实际怎么改、能否应用）
```

预期提升主要来自两处：

- YZ 蒸馏让 Agent 从“能移动按钮”提升为“能提出有玩家经验依据的排轴/配队建议”；
- 指南分层让 Agent 在短句、长会话和状态切换下更稳定地选择正确工具链，同时减少 prompt 漂移。

## 一、Spec 7 及后续研究给出的边界

### 1. 已经成立的底座

Spec 7 已完成三类工具、节点代码工作区、codec、validation/diff、CAS、permission、host/session 隔离和原生 OpenCode 循环。已有验收证明 Agent 能回答“你可以排轴吗”，并能通过 `read/edit` 修改规范化节点文件后验证 diff。

因此下一步不应新增第四类“攻略工具”，也不应把攻略动作拆成按钮级 typed tools。YZ 知识是 `def-data-resource` 之外的建议性知识源；实际修改仍由 `def-node-code` 与 `def-node-crud` 完成。

### 2. 尚未被证明的部分

`health-review-20260713.md` 已指出，现有黑盒入口曾给 provider-visible user text 附加工具工作流提示。已有成功记录不能证明普通短句在弱提示条件下同样稳定。

因此“增加 YZ 或 Agent 指南后效果提升”必须通过对照实验成立，不能用文件已被加载、模型能复述攻略或单次成功代替。

### 3. 硬边界不能回到文字约束

以下能力继续由代码保证，而不是交给 prompt、YZ 文档或 `AGENTS.md`：

- host/agent 锁定和 provider-visible tool allowlist；
- session/node 目录权限与只读投影；
- checkout 变化 gate、revision CAS、validation、approval/use；
- 当前画布、按钮、Buff、伤害和官方资源 id 的实时事实。

## 二、提示词的推荐实现

### 1. 当前问题

`buildAgentPrompt('workbench')` 同时包含身份、节点树概念、动态状态恢复、坐标规则、Buff 排名特例、fork 参数、文件权限、三类工具、交互规则、最终回复风格和游戏知识注入。`timeline-workbench/SKILL.md` 又重复 context、mutation、occupied slot、preview/use 等流程。

重复能在短期提高显著性，但有三个副作用：

1. 修改规则时多处漂移；
2. 长 system prompt 稀释工具 description 与本轮动态状态；
3. 无法判断成功究竟来自基础 prompt、skill、测试包装还是模型偶然选择。

### 2. 收敛后的职责

Workbench system prompt 建议只保留：

- 你是 DEF Workbench 排轴助手，默认中文、结果导向；
- 三类工具各自职责，节点修改必须走隔离子节点；
- 当前事实以 runtime state / context tools 为准，不依据旧 transcript 猜测；
- 不编造资源事实，不泄露内部协议；
- 安全与审批服从工具返回和 runtime gate；
- 遇到排轴、配队、养成判断时按需加载对应 skill。

以下内容下沉：

- fork → edit → validate → preview/use 的教程进入 `timeline-workbench`；
- 坐标和占位冲突规则进入 timeline skill 与相关 tool description/error；
- checkout phase、revision、next action 进入版本化 `WorkbenchTurnState`；
- 游戏俗语、阵容和攻略路由进入 `game-knowledge`；
- 实时数据与写入前置条件留在 tool schema/result。

### 3. 动态辅助 prompt 的形态

需要动态注入，但只注入机器生成的控制面，不拼接到用户消息：

```json
{
  "schemaVersion": 1,
  "host": "workbench",
  "axisBindingId": "...",
  "checkout": { "nodeId": "...", "revision": 12 },
  "workspace": { "phase": "ready", "anchorNodeId": "..." },
  "gate": null,
  "contextUpdatedAt": "..."
}
```

若 checkout 改变，`gate.nextAction` 可以指向唯一允许动作；不要重复整套排轴教程。用户消息必须原样送达 provider，便于可信黑盒对照。

## 三、YZ 博主蒸馏的价值与实现方式

### 1. 它补足的不是数据，而是策略

typed tools 能回答“当前有哪些按钮、某 Buff 的官方 id、伤害报告是多少”，却不会自然拥有以下玩家经验：

- “42”“小羊”“轮椅”“三动火”等俗语和 ASR 纠错；
- 冷启动/爆发轴、连携触发顺序、后摇取消等打法经验；
- 安塔尔偏对单、秋栗偏对群一类阵容取舍；
- 哪些角色是套路核心，哪些位置可以替换；
- 装备优先级、资源不足时的降级方案。

这些正是当前 `game-knowledge` 的五层结构——怎么说话、怎么打、怎么配、怎么判断、什么不换——可以提升的部分。

### 2. 推荐知识分层

现有 10 篇逐篇攻略适合作为证据原文，但不应每次全部进入上下文。建议保持三层：

1. `glossary.md`：小且高频，负责别名、口误和检索归一化；
2. 结构化攻略卡：每个阵容一张，记录适用版本、队伍、前提、冷/热启动步骤、替换边界、装备建议和风险；
3. 原始蒸馏稿：保留细节与出处，用于需要解释或交叉核对时读取。

攻略卡建议增加最小元数据：

```yaml
source: YZ
gameVersion: "1.2"
distilledAt: "2026-07-13"
team: [莱万汀, 狼卫, 艾尔黛拉, 秋栗]
scenario: [对群, 冷启动, 进阶轴]
confidence: community-guide
supersedes: null
```

其中 `gameVersion` 和 `distilledAt` 用于提示时效风险；`confidence` 明确它是社区建议而非运行时真相。

### 3. 检索与组合流程

推荐的 Agent 行为是：

```text
用户短句
  → glossary 归一化角色/术语
  → 读取当前 Workbench context 与用户已有阵容
  → 只加载最匹配的 1~2 张攻略卡/原文
  → 用 typed tools 核对实时资源和当前画布
  → 给出建议，或在用户要求时创建子节点实现
  → validate/diff；明确批准后 use
```

只问攻略时不 fork；要求“按这个思路帮我排”时，攻略负责决策依据，节点工具负责执行。若攻略与实时数据冲突，以 typed tools 为准，并明确提示攻略版本可能过时。

### 4. 需要补强的蒸馏质量

当前 `game-knowledge/SKILL.md` 已有 trust order 和禁止硬编码旧数值的规则，这是健康设计。后续优先补强：

- 每篇资料的版本、来源、蒸馏时间和适用场景；
- 把“操作步骤”与“判断条件”分开，避免只会背固定轴；
- 明确可替换位、不可替换核心和替换后的轴变化；
- 对同一阵容的不同视频建立差异记录，而不是覆盖旧结论；
- 标记 ASR 未确认词和库中缺失资源，禁止把猜测升级为正式名。

## 四、Agent 指南如何提升项目效果

### 1. 区分三种“指南”

项目根 `AGENTS.md`、session 工作区 `AGENTS.md` 和 OpenCode skills 的受众不同：

| 指南 | 受众与生命周期 | 应放内容 |
| --- | --- | --- |
| 项目根 `AGENTS.md` | 开发本项目的编码 Agent | 仓库工作习惯、测试入口、常驻进程、提交规则 |
| session `AGENTS.md` | 单个 DEF OpenCode 会话 | 极短的工作区边界、可编辑目录、验证入口 |
| `SKILL.md` | DEF 产品内的业务 Agent | 特定业务任务流程、知识路由、歧义处理、结果表达 |

根 `AGENTS.md` 不会直接让产品内的 `def-workbench` 更懂排轴；真正直接影响产品效果的是 session 指南、agent prompt、skill 和 tools。若要评估“Agent 指南提升”，必须先说明测的是开发 Agent 生产效率还是产品 Agent 行为。

### 2. session `AGENTS.md` 保持最小

当前动态生成的 session `AGENTS.md` 只有隔离目录、先 fork/bind、仅 working 可编辑、sync_validate 后 use 等信息，方向正确。它适合作为即使 skill 未触发也能看到的本地安全提示，不应复制 YZ 攻略或完整排轴教程。

建议仅增加可机器核对的版本标识，例如 `DEF_WORKSPACE_GUIDE_VERSION=1`，以便测试记录能确认实际加载版本；不要继续扩写业务特例。

### 3. skill 负责可组合指南

建议保持两个正交 skill：

- `timeline-workbench`：回答“怎么安全地读取/修改当前轴”；
- `game-knowledge`：回答“基于玩家经验应该怎么排/配”。

无需创建第三个巨型 skill 同时复制两者。system prompt 只需告诉模型在“建议 + 实施”的复合请求中同时加载两者，并按 `知识建议 → 实时核对 → 节点实现` 组合。

这会提升以下行为：

- 对“42 火队怎么调”先识别俗语和队伍，再操作节点；
- 对“照 YZ 的秋栗轴排一下，先看看”能完成建议到 draft diff 的闭环；
- 对库中不存在或版本已变化的装备不会照抄旧攻略数值；
- 对纯咨询不产生无意义 Work Node。

## 五、推荐落地顺序

### P0：先建立可信基线

1. 确认黑盒 ingress 的 provider-visible user text 保持原文；
2. 每 turn 记录 prompt 版本、加载 skill、读取 references、runtime state 版本和 provider-visible tools；
3. 导出 Workbench 与 AI CLI 的实际 tool allowlist。

没有这一步，无法区分提示词、YZ 和指南各自贡献。

### P1：prompt / skill 去重

1. 缩短 `buildAgentPrompt('workbench')`；
2. 将详细节点流程统一归属 `timeline-workbench`；
3. 将动态 checkout 事实统一归属 `WorkbenchTurnState`；
4. 给 session `AGENTS.md` 增加版本，不增加攻略内容。

### P1：YZ 从“资料集合”变为可评估知识层

1. 为现有攻略补版本与场景元数据；
2. 生成结构化攻略卡，原文继续作为证据；
3. 增加跨攻略冲突/差异标记；
4. 让 `game-knowledge` 明确复合任务的 timeline skill 交接规则。

### P2：再扩充更多博主或资料

先用 YZ 建立稳定模板和评测集，再加入其他博主。多来源时记录来源、版本和冲突，不做无出处的“平均结论”。只有当 YZ 覆盖不足经评测明确出现后，扩源才有可衡量收益。

## 六、效果验证设计

遵循 `docs/testing/def-agent-blackbox.md`，测试输入只能是普通用户短句。建议做同模型、同参数、同初始 snapshot 的消融对照：

| 组别 | system prompt | timeline skill | YZ skill/references | 目的 |
| --- | --- | --- | --- | --- |
| A | 当前/收敛版 | 无 | 无 | 基础工具选择能力 |
| B | 收敛版 | 有 | 无 | 测流程指南贡献 |
| C | 收敛版 | 无 | 有 | 测领域知识贡献 |
| D | 收敛版 | 有 | 有 | 测完整组合效果 |

场景至少覆盖：

- 俗语理解：`42 和小羊这个轴怎么调`；
- 纯建议：`秋栗和安塔尔放火队里哪个好`；
- 建议并实施：`照秋栗那套帮我排一下，先看看`；
- 阵容不完整：`我没有狼卫，这套还能玩吗`；
- 版本冲突：攻略提到当前资源库不存在或数值不一致的装备；
- 当前画布冲突：目标格已占用；
- 状态变化：对话后手动切 checkout，再继续说 `就按刚才那个改`；
- 诱导错误路径：要求直接改当前 checkout 或照抄旧数值。

每组除黑盒规定字段外，再记录：

- 意图/别名识别是否正确；
- 是否读取了正确且最少的 references；
- 建议是否包含适用条件和替换边界；
- 实时事实与社区建议冲突时是否以 tools 为准；
- 只读请求是否误建节点；
- mutation 是否完成 draft、validate、diff，且未越权 use；
- 工具误选次数、无效调用次数、总 token 与完成时间；
- 最终答复是否只描述业务结果而非内部协议。

建议以任务成功率、事实错误率、越权写入率为主指标；token 和耗时是次指标。每个关键场景至少重复 3 次，模型存在随机性时单次结果不能证明提升。

## 七、可判定的成功标准

只有同时满足以下结果，才能认为三层方案对项目有效：

1. B 相对 A 显著降低错误工具链、遗漏 validate/diff 和无意义追问；
2. C 相对 A 提高俗语、阵容取舍、循环与替换判断正确率，且不增加旧数值幻觉；
3. D 能稳定完成“社区建议 → 当前状态核对 → 子节点实现 → 审查”的复合任务；
4. 收敛 prompt 后，安全、checkout 恢复和工具路由不退化；
5. 规则修改只需改一个职责来源，prompt、skill、tool schema 不再保留相互矛盾的副本。

## 最终建议

近期最值得做的不是继续收集更多长文本，而是把已有 YZ 蒸馏变成带版本、适用条件和替换边界的可检索攻略卡，同时完成 prompt/skill/runtime 的职责去重与可观测性建设。

这条路线的产品意义很明确：typed tools 让 Agent **改得对且改得安全**，YZ 蒸馏让 Agent **知道为什么这么改**，Agent 指南让它 **在普通用户短句下稳定走完正确流程**。
