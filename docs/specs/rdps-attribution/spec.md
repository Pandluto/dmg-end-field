# RDPS 归因分析与报表图 3/图 4 Spec

## Status

规划中，尚未实现。

本文档定义 1.8 LTS 伤害报表中的 RDPS（相对伤害贡献）归因能力。当前实现以代码为准；本文档是后续开发、验收和回归的约束，不要求恢复已退役的 Damage Sheet、Excel 或真实 PPTX 导出能力。

## Goal

在桌面端伤害报表的既有 2×2 图表页中填充图 3 和图 4：

- 图 3 展示各个可归因增益来源对实际期望总伤害的贡献伤害、贡献占比、来源贡献合计和“自身/其他”对账项。
- 图 4 为当前报表队伍中的最多四名干员分别展示“干员本体 / 武器 / 装备”三个来源域的贡献拆分。

归因结果必须来自与实际报表相同的伤害计算链。不能只根据最终报表行的 Buff 文本或五类乘区的局部数值进行近似分配。

## Current Findings

- `SkillButtonBuff` 已有 `ownerCharacterId` 和 `ownerBuffDomain`，配置候选 Buff 也会写入稳定 owner 字段。
- `DamageReportBuffRow` 当前只保留展示与乘区字段，尚未透传 owner 字段。
- 普通 Hit 已经使用相对纯的伤害计算器；异常 Hit 和额外 Hit 仍由 `damageReportService` 内的独立路径手算。
- 当前 `DamageReportHitRow.buffs` 没有包含生成额外 Hit 的 extra-hit Buff 本身，因此不能把报表输出行直接作为反事实重算输入。
- 当前 `DamageBreakdown` 不暴露 `afterCombo`，`final` 同时包含连击和失衡；`BuffContribution` 只覆盖五个直接乘区，不能独立完成完整归因。
- 当前连击已经有四档数值、B/Q 乘区计算和定向测试，但正式状态卡仍没有稳定的施加者 ID。
- 报表图 3、图 4目前是占位卡，报表主题中存在依赖 `:first-child`、`:nth-child(2)` 和 `.is-placeholder` 的选择器。

## Terms

### Actual total

实际报表使用完整当前配置计算出的 `totalExpected`。RDPS v1 使用期望伤害作为归因基准；`totalNonCrit` 不参与图 3、图 4的默认展示。

### Attributable source

一个可归因来源由稳定的 `ownerCharacterId` 和来源域组成：

- `operator`：干员本体、技能、天赋、潜能，以及由该干员施加的异常状态和连击。
- `weapon`：该干员携带的武器提供的 Buff。
- `equipment`：该干员携带的装备提供的 Buff。

`sourceName` 只用于展示，不参与分组、去重或计算。

### Residual / 自身/其他

Residual 是实际总伤害中没有被可归因来源覆盖的部分。它至少包括：

- 角色基础面板、基础攻击、暴击面板、武器基础攻击和装备静态属性。
- 缺少稳定 owner 的历史 Buff、局部自定义 Buff 或队伍外未纳入图 4的来源。
- 严格排除的失衡效果及其与其他来源的交互。
- 归因策略无法安全归属的异常状态或额外 Hit。

Residual 不是“计算失败”；它是图 3 中必须显示的正式对账项。

### Attribution world

归因世界是为计算来源贡献而建立的反事实世界：保留所有不可归因的基线输入，只按来源集合启用可归因 Buff。失衡在 v1 的归因世界中始终关闭，实际报表中的失衡影响由 Residual 承担。

## Scope

本阶段处理：

- RDPS 数据合同、来源键、三来源域和 `policyVersion`。
- 报表计算上下文抽取和可过滤的纯重算入口。
- 普通 Hit、异常 Hit、Burn/Dot、额外 Hit 的统一来源过滤。
- extra-hit 生成 Buff 的来源归属和反事实开关。
- `DamageReportBuffRow` 的 owner 元数据透传。
- 异常状态快照到 operator 来源域的归属。
- 连击状态的正式来源 ID、桌面端与移动端兼容写入，以及 B/Q 数值保持不变、A 不生效的现有规则。
- Owen value 分层归因引擎和 coalition 缓存。
- 报表图 3、图 4及三套报表主题的样式适配。
- 归因数值、历史数据、负贡献、禁用项、层数和布局回归测试。

## Explicit Non-Goals

- 不把武器或装备的整件移除后差值称为“武器/装备 Buff 贡献”；完整静态面板价值另立规格。
- 不修改图 1 干员伤害占比和图 2 伤害时序的数据口径或 JSX 结构。
- 不在画布实时伤害计算中默认执行 RDPS 重算。
- 不新增真实 PNG、PDF 或 PPTX 文件导出；桌面“PPT 报表”仍是 DOM 页面。
- 不把 `sourceName` 当作稳定主键，也不对缺少 `ownerCharacterId` 的旧数据进行名称猜测。
- 不把五类 `BuffContribution` 局部比例直接当成全链路归因结果。
- 不把 `DamageBreakdown` 的 `final` 拆成连击贡献和失衡贡献；v1 以来源过滤重算为唯一归因权威。
- 不追踪异常施加者的源石技艺强度是由谁提高的二阶来源；异常快照的最终效果整体归给施加者。
- 不引入真实时间窗口的新的 DPS 统计模型。若后续要求“每秒贡献”而不是伤害贡献，应另立规格；同一时间窗口下图 3 的比例可以复用本阶段结果。

## Policy Version

本阶段固定使用 `rdps-v1-owen-buff-only-strict-imbalance` 作为 `policyVersion`。任何改变来源归属、失衡处理、静态面板口径或负值展示规则的修改，都必须提升 policy version，不能静默改变历史结果语义。

## Data Contract

### Buff row metadata

`DamageReportBuffRow` SHALL 透传以下可选字段：

```ts
sourceName?: string;
ownerCharacterId?: string;
ownerBuffDomain?: 'operator' | 'weapon' | 'equipment';
ownerBuffGroup?: 'talent' | 'potential' | 'skill' | 'weaponSkill' | 'threePiece';
```

字段语义：

- `ownerCharacterId` 是归因主键的一部分，缺失时不得按名称推断。
- `ownerBuffDomain` 是原始配置域；异常快照和连击派生 Buff 需要显式映射为 `operator`。
- `sourceName` 只作为报表文字和诊断信息。
- `ownerBuffGroup` 可用于诊断和后续细分，不作为图 3、图 4的当前分组层级。

### Snapshot option

`DamageReportSnapshotOptions` SHALL 增加：

```ts
includeRdps?: boolean;
```

默认值为 `false`。只有桌面报表页开启 `includeRdps: true`；画布和其它已有调用保持原性能和结果口径。

### RDPS result

`DamageReportSnapshot` SHALL 增加可选 `rdps?: RdpsAttributionSummary`。具体字段名可以在实现时落到独立类型文件，但必须表达以下信息：

```ts
interface RdpsAttributionSummary {
  policyVersion: string;
  actualTotal: number;
  attributionWorldTotal: number;
  baselineTotal: number;
  attributedTotal: number;
  residualTotal: number;
  reconciliationError: number;
  sources: RdpsSourceContribution[];
  characters: RdpsCharacterContribution[];
  diagnostics: RdpsDiagnostics;
}

interface RdpsSourceContribution {
  key: string;
  characterId?: string;
  characterName: string;
  domain?: 'operator' | 'weapon' | 'equipment';
  label: string;
  damage: number;
  shareOfActual: number;
  includedBuffCount: number;
  negative: boolean;
}

interface RdpsCharacterContribution {
  characterId: string;
  characterName: string;
  damage: number;
  shareOfActual: number;
  domains: RdpsDomainContribution[];
}

interface RdpsDomainContribution {
  domain: 'operator' | 'weapon' | 'equipment';
  damage: number;
  shareOfCharacter: number;
}
```

`diagnostics` 至少包含未知 owner 数量、队伍外来源数量、排除失衡数量、负贡献数量、无效/跳过 Hit 数量和 coalition 评估次数。图表不得依赖诊断字段进行计算，但必须能显示必要警告。

## Attribution Policy

### Included sources

- 有效 `ownerCharacterId + ownerBuffDomain` 的普通 Buff。
- 武器和装备提供的 modifier、multiplier、countable 和 derived Buff，只归因其运行时实际生效值。
- extra-hit Buff 本身及其生成的全部额外 Hit；关闭该来源时，生成的 Hit 必须一并消失。
- `AnomalyStateSnapshot` 的导电、腐蚀、碎甲：使用快照中的 `sourceCharacterId`，归入该角色的 `operator` 域。
- 有来源 ID 的连击状态：归入施加者的 `operator` 域。

### Excluded sources

- 基础面板和静态装备/武器属性。
- 没有稳定 owner 的旧 Buff、旧连击卡和无法安全映射的异常效果。
- 失衡 Buff、面板失衡加成和失衡与其它来源的交互。

### Legacy and out-of-team data

- 历史 `PersistedAnomalyCard` 可以新增可选 `sourceCharacterId`；缺失时进入 Residual。
- `AnomalyStateSnapshot` 已有 `sourceCharacterId`，不重复创建第二个来源字段。
- 具有有效 owner 但不在当前四名报表干员中的来源，不得静默丢失：图 3聚合为“队伍外来源”，图 4只展示当前四人，并在图 4注明队伍外贡献已计入图 3。
- 完全无法归属的来源进入“自身/其他”，并在 diagnostics 中计数。

## Calculation Architecture

### Resolve once, evaluate many

系统 SHALL 将当前 `buildDamageReportSnapshot` 中的存储读取和计算分离为两层：

1. Resolve：一次性读取时间轴、按钮、技能模板、面板、Buff、异常快照、禁用项、层数和目标抗性，生成不可变 `DamageReportCalculationContext`。
2. Evaluate：接收 context 和来源过滤器，输出与当前报表相同结构的 Hit 结果与总伤害。

反事实计算期间不得重复读取 `localStorage`、时间轴存储或配置仓库。展示用 trace ID 可以在 resolve 阶段生成，不能在每次 coalition 评估中重新解析。

### Source filter

来源过滤必须在计算输入阶段执行，而不是先算出所有 Hit 后删除输出行。过滤器至少要影响：

- 普通 Hit 的 modifier/multiplier/derived/countable Buff。
- 异常 Hit 和 Burn/Dot 的选中 Buff、禁用 Buff 和层数。
- extra-hit 生成器是否存在，以及其生成的 Hit 数量。
- 异常状态快照和连击派生 Buff。
- 按钮级全局禁用、Hit 级禁用、segment 级禁用。

不启用过滤器时，新路径与当前路径的每个 Hit、每个按钮和总伤害必须在浮点容差内一致。

### Owen value

设可归因来源按角色分成上层组，每个角色内部有 `operator / weapon / equipment` 三个下层域。定义：

```text
V(S) = 在 attribution policy 下，只启用来源集合 S 时的期望总伤害
```

系统 SHALL 计算分层 Owen value：

- 外层按干员组的随机排列分配角色级交互。
- 内层在每个角色组内按三个来源域的随机排列分配域级交互。
- 所有 coalition 结果按 context fingerprint、policyVersion 和来源 mask 缓存。
- 四名干员、每人三个域时，使用层级 coalition 的评估状态应控制在约数百次量级；不得退化为对 12 个叶子来源直接进行 4096 个状态的普通 Shapley，除非性能测试证明可接受。

归因恒等关系：

```text
attributedTotal = Σ 所有可归因来源贡献
residualTotal = actualTotal - attributedTotal
actualTotal = attributedTotal + residualTotal
```

其中 `actualTotal` 是完整当前配置的实际总伤害，`attributionWorldTotal` 是严格归因口径下所有可归因来源开启时的结果，`baselineTotal` 是没有任何可归因来源时的结果。失衡被严格排除后，其影响和相关交互由 residual 吸收。

`reconciliationError` SHALL 满足：

```text
abs(actualTotal - attributedTotal - residualTotal)
  <= 1e-6 * max(1, abs(actualTotal))
```

单来源反事实差值可以作为诊断参考，但不能把“逐个移除后的差值”直接相加替代 Owen value。

## Report UI

### Chart 3: RD total table

图 3 SHALL 保持当前 2×2 布局中的左下位置，并展示：

- 来源名称。
- 来源域或干员归属。
- 贡献伤害绝对值，保留符号。
- 占实际总伤害比例。
- 来源贡献合计。
- 自身/其他。
- 对账误差或必要诊断警告。

来源表默认按贡献绝对值降序；零值来源可以隐藏，但不得影响合计。负值不得截断为零。

### Chart 4: Character domain split

图 4 SHALL 保持当前 2×2 布局中的右下位置，最多展示四名当前报表干员，每名干员一块：

- 卡片标题显示干员贡献占实际总伤害的比例。
- 图形或表格显示该干员内部 `operator / weapon / equipment` 三域占比。
- 三域分母是该干员的归因贡献，不是实际总伤害。
- 干员贡献为零时显示空态，不执行除零。
- 域贡献为负或正负混合时，环图不能伪造 100% 正向占比；必须显示带符号数值和警告。
- 当前队伍少于四人时显示空态；队伍外来源只在图 3对账。

实现使用现有内联 SVG 和 `report-ppt-*` 样式体系。图 1、图 2的 JSX 和数据不改。

### Theme and layout

新组件 SHALL 使用语义 class，例如 `is-rdps-table`、`is-rdps-character-split`，不得依赖图卡的 child 顺序表达语义。至少验证 `lieflat-mono`、`liquid-tide` 和 `apple-midnight` 三套报表主题。

长名称、零值、负值、空队伍和四名干员完整队伍不得溢出 2×2 图格。

## Compatibility

- 未开启 `includeRdps` 时现有调用、画布实时计算和图 1/图 2性能保持不变。
- 旧 Buff 没有 owner 时仍按原伤害参与实际报表，但只进入 Residual。
- 旧连击或异常卡没有来源 ID 时不猜测来源。
- `ownerCharacterId` 与 `ownerBuffDomain` 的新增字段必须保持旧存档可读取。
- 不改变现有 B/Q 连击数值和 A 不生效规则。

## Non-functional Requirements

- 典型四人报表首次打开图 3/图 4的 RDPS 计算目标为 300–500ms 内；相同 context 不重复计算相同 coalition。
- 计算结果必须确定性：相同 context、policyVersion 和输入顺序得到相同数值。
- RDPS 计算不得在 render 期间产生无法取消的重复 IO；若实测同步计算阻塞报表首屏，应改为 report-page loading/effect 或 worker，但不改变数据合同。
- 浮点对账误差符合本规格阈值。

## Acceptance Scenarios

### Source identity

- 两个同名干员拥有不同 `ownerCharacterId` 时，贡献不能串组。
- 同一干员的本体、武器和装备 Buff 必须进入三个正确域。
- 缺少 owner 的历史数据进入 Residual，并产生诊断计数。

### Calculation equivalence

- 不启用来源过滤时，普通、异常、Burn/Dot 和额外 Hit 与旧路径逐 Hit 对账。
- 过滤一个来源时，普通 Hit 的面板、五类乘区、抗性和最终伤害全部按同一过滤器重算。
- 过滤 extra-hit 生成 Buff 时，额外 Hit 行消失；只过滤显示行不算通过。
- countable 层数、segment 禁用、Hit 禁用和 `selectedBuffIds` 均保持有效。

### Attribution

- 同乘区、跨乘区、抗性、面板 Buff、multiplier、derived、负贡献和上限/拐点都通过数值 fixture。
- 四人三域的角色贡献与域贡献满足层级求和。
- 实际总伤害、来源贡献合计和 Residual 严格对账。
- 失衡未进入任何角色或域，但其实际影响仍在 Residual 中体现。
- 连击 B/Q 按四档值工作，A 不产生连击贡献；有来源 ID 时归 operator，无来源时归 Residual。

### UI and themes

- 图 1、图 2保持原样，图 3、图 4替换占位卡。
- 四名干员、少于四名干员、长名称、零值、负值和队伍外来源均可读且不溢出。
- 三套报表主题均能正确显示文字、边框、SVG、正负值和警告。

## Risks and Follow-ups

- 如果产品把 RDPS 定义为严格的“每秒贡献”，还需要明确时间窗口和来源持续时间；本规格只定义同一报表总伤害上的相对贡献。
- Shapley/Owen 可能产生负贡献，不能为了环图美观简单截断；必要时用 signed bar/table 作为负值 fallback。
- `DamageReportPptPage` 当前是 DOM 页面，真实图片/PPTX 导出另立任务。
- 完整武器/装备静态面板价值会改变 base context 和 residual 语义，另立规格。
