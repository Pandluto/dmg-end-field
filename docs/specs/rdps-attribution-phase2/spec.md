# RDPS 归因 Phase 2：旧数据来源恢复与真实数据闭环 Spec

## Status

提案，待实施。

本规格是 [RDPS 归因分析与报表图 3/图 4](../rdps-attribution/spec.md) 的第二轮修正规格。第一轮已完成图表、反事实评估器与 Owen 引擎骨架，但真实旧存档验收不通过。本规格在冲突处覆盖第一轮，未明确覆盖的计算与 UI 约束继续有效。

## Problem Statement

第一轮把“页面可渲染、总数能用 Residual 对上”误当成归因正确。真实存档“莱狼羊卡-热启动爆发轴”的报表暴露了以下问题：

- 总损伤约 2.00M，但来源合计只有约 55.7K，约 97.2% 被放入“自身/其他”。
- 图 4 中莱万汀、狼卫、卡缪均显示 0，只有艾尔黛拉有少量贡献。
- `chr_0019_karin` 直接显示为内部 ID，没有解析为“秋栗”。
- 报表声称若干 Buff 缺少来源，但旧存档的按钮选择、候选 Buff、配置快照和内部来源路径仍然保留了可确定解析的来源关系。
- 连击虽然数值固定，仍然有施加者；第一轮把旧连击视为无来源，只让新卡通过新增字段归因，口径错误。
- 当前 `reconciliationError` 由 `residualTotal = actualTotal - attributedTotal` 反推，因此即使来源几乎全部漏掉也恒为 0，不能证明 Owen 分配完整。

这不是 SQLite 缺数据，而是报表 Resolve 阶段没有使用前端现有的数据层级恢复 provenance。

## Decision

旧数据适配是 Phase 2 的必做范围。

RDPS 来源身份仍然是稳定的“干员 ID + 来源域”，但不要求这个结果预先持久化在每条 Buff 上。报表计算时 SHALL 构建只读的来源上下文，沿现有选择关系和配置层级恢复来源，并把结果保存在本次计算的临时 sidecar 中。

只有在所有确定性解析路径都失败或出现歧义后，该 Buff 才能进入“自身/其他”。不得因为旧记录缺少第一轮新增字段就直接判定无来源。

## Formula Correction：全伤害归属（v3）

2026-08-14 的“五色队-热启动循环”真实数据复核进一步确认：Phase 1/2 只把
`V(full) - V(empty)` 的 Buff 增量计入 RD，错误地把 `V(empty)` 中每个干员
自己造成的基础/直接伤害全部放进“其他”。本节覆盖第一轮的 Residual 基础伤害
口径以及本文档原有的“基础面板不归因”表述。

- 每个按钮在所有 Buff 关闭、失衡关闭时产生的直接伤害，按按钮的稳定
  `characterId` 归入该干员的 `operator` 域。
- `operator RD = 该干员直接伤害 + operator 来源 Buff 的 Owen 边际贡献`。
- `weapon` 与 `equipment` 仍只接收各自 Buff 的 Owen 边际贡献；本轮不把武器
  基础攻击、装备静态属性从面板中拆出来，它们随完整基础面板统一归入出伤干员本体。
- Owen 世界的空联盟继续保留未解析 Buff，以保证已解析来源的边际计算稳定；另做
  一次关闭所有 Buff 的直接伤害评估，避免把未解析 Buff 误归给出伤者。
- Residual 只保留未解析/歧义来源、严格排除的失衡及浮点尾差；没有这些情况时，
  当前四名干员贡献之和必须等于 `actualTotal`，“其他”为 0。
- 本语义使用 `rdps-v3-direct-damage-operator-owen-runtime-provenance-strict-imbalance`。

结果合同新增：

```text
directDamageTotal = Σ 每名出伤干员的无 Buff 直接伤害
sourceContributionTotal = Σ 已解析来源的 Owen Buff 边际贡献
attributedTotal = directDamageTotal + sourceContributionTotal
residualTotal = actualTotal - attributedTotal
```

## Goals

- 新数据和旧数据使用同一个归因结果合同。
- 新数据可直接使用现有显式来源；旧数据通过前端数据层级恢复来源。
- 不迁移、不回写、不批量改造用户 SQLite。
- 不为 Phase 2 新增必需的持久化来源字段。
- 普通 Buff、extra-hit、异常快照和连击均经过同一个临时来源解析层。
- 内部 ID、中文名、武器名和装备套装名展示一致。
- Owen 效率、层级求和和实际报表对账均由独立等式验证，不能再以恒等式伪装通过。
- 使用“莱狼羊卡-热启动爆发轴”完成真实 SQLite 浏览器验收。

## Non-goals

- 不按模糊中文名称猜测来源。
- 不把自定义 Buff 强行归给当前出伤角色。
- 不修改普通伤害公式。
- 不把武器基础攻击、装备静态属性从基础面板中单独拆给 weapon/equipment 域；完整基础伤害统一归入出伤干员 operator 域。
- 不把失衡分配给任意干员。
- 不实现真实 PPTX、PNG 或 PDF 导出。
- 不要求把旧 SQLite 保存为新 schema 后才能查看报表。

## Terminology

### Explicit source

新数据中已经存在、可直接读取的稳定来源信息。Phase 2 可以读取它，但不得把它作为唯一来源。

### Runtime provenance

报表 Resolve 阶段根据当前工作区数据构建的来源关系，包括：

- 技能按钮到干员的关系。
- 技能按钮选中的 Buff ID 到 Buff 实体的关系。
- 候选 Buff 到干员配置、武器配置或装备套装的关系。
- 异常快照到来源按钮和来源干员的关系。
- 连击状态到其所属/施加按钮的关系。

Runtime provenance 只存在于本次计算内，不写回存储。

### Legacy projection

为了让旧 Buff 与当前候选 Buff 对齐，从内容签名中排除第一轮后来新增的 owner 字段，其余稳定计算字段仍参与比较。至少包含：

- 内部 `name`、`displayName`、`source`、`sourceName`、`level`。
- `type`、`value`、`category`、`maxStacks`、`target`。
- `valueMode`、`derivedValue`、`multiplier`。
- `effectKind` 与 `extraHitConfig`。

该投影用于“唯一精确匹配”，不是模糊匹配。

## Source Resolution Contract

### Transient result

实现 SHALL 定义等价于下列语义的临时结果，不要求沿用字段名：

```ts
type RdpsSourceResolutionMethod =
  | 'explicit'
  | 'candidate-exact'
  | 'canonical-path'
  | 'anomaly-snapshot'
  | 'source-button'
  | 'container-button'
  | 'unresolved';

interface RdpsResolvedSource {
  characterId?: string;
  characterName?: string;
  domain?: 'operator' | 'weapon' | 'equipment';
  sourceAssetName?: string;
  method: RdpsSourceResolutionMethod;
  evidenceKey: string;
  unresolvedReason?: 'missing' | 'ambiguous' | 'invalid';
}
```

该结果应以 Buff 应用或状态应用为键存入 context sidecar。不得通过修改原始 `SkillButtonBuff` 或持久化记录来完成归一化。

### Resolution priority

每个来源按以下优先级解析，命中后停止：

1. 新数据已有的显式稳定来源。
2. 使用 legacy projection 在当前候选来源索引中进行唯一精确匹配。
3. 解析应用自身生成的规范内部来源路径。
4. 使用异常快照、来源按钮、所属按钮等结构关系。
5. 标记 unresolved。

高优先级与低优先级结果冲突时，不得静默选择。应记录冲突诊断，并优先采用可证明更接近原始选择动作的关系。

### Candidate provenance index

Resolve 阶段 SHALL 从当前前端事实源构建只读索引：

- `operatorConfigPageCache` 中每个 `snapshot.operator.id/name`。
- 干员的 talent、potential、skill Buff。
- 武器 `skill3.effects`。
- 装备 `setBuffs` 或当前候选服务生成的三件套 Buff。
- 当前 `candidate-buff-list`，若存在。
- 时间轴按钮、`skillButtonTable` 与 `allBuffList` 的引用关系。

索引构建不得依赖网络请求，不得改变候选列表，不得触发配置刷新。

当 legacy projection 只命中一个候选项时，恢复其 `characterId`、domain、group 和来源资产名；命中多个不同 owner 时必须标记 ambiguous。

### Canonical path compatibility

以下应用生成的内部路径属于确定性 provenance，可以作为兼容解析证据：

- `operator-studio:<characterId>:<talent|potential|skill>:...` → operator。
- `operator-config-snapshot:<characterId>:weapon:<weaponId>:...` → weapon。
- `operator-config-snapshot:<characterId>:equipment:<setId>:...` → equipment。
- 其它由当前候选服务正式定义、同时包含命名空间和稳定干员 ID 的路径。

不得把任意用户自定义字符串按冒号拆分后当作来源。解析器必须使用白名单命名空间和结构校验。

### Display names

干员展示名 SHALL 通过全局只读目录解析，优先级为：

1. `operatorConfigPageCache[characterId].operator.name`。
2. 当前选择队伍与角色资料中的 ID/name 映射。
3. 时间轴 staff line 与技能按钮的稳定 ID/name 映射。
4. 异常快照中的 `sourceCharacterId/sourceCharacterName`。
5. 原始 ID，并产生 `unresolvedDisplayNameCount` 诊断。

队伍外来源同样必须查全局目录，不能因为它不在四人卡片中就显示内部 ID。示例：`chr_0019_karin` 必须显示为“秋栗”。

来源资产名称只用于明细展示，例如“艾尔黛拉 · 武器（沧溟星梦）”；它不参与来源主键。

## Legacy Buff Rules

### Old data without owner fields

旧存档中的 Buff 即使没有 `ownerCharacterId/ownerBuffDomain`，只要可以通过候选索引或规范路径唯一恢复，就 SHALL 参与归因。

“缺少字段”和“无法解析”是两个不同状态：

- 缺少字段但成功恢复：正常归因，不显示缺失来源警告。
- 所有解析路径失败：进入 Residual，记录 unresolved。
- 存在多个不同 owner 的精确候选：进入 Residual，记录 ambiguous，不任选其一。

### New/old parity

同一份新数据构造两份 context：

- A：保留显式来源字段。
- B：只删除来源字段，保留其余旧数据层级。

A 与 B 的来源 key、来源域、Owen 贡献和展示名 SHALL 在浮点容差内一致。该测试是旧数据适配的核心合同。

### Local custom Buff

本地自定义 Buff 若不存在稳定 owner 关系，可以继续进入 Residual。仅凭 `sourceName` 等于某个干员、武器或套装名，不足以归因。

## Combo and Anomaly Rules

### Anomaly snapshots

导电、腐蚀、碎甲继续优先使用快照已有的 `sourceCharacterId`。若只有 `sourceButtonId`，则通过按钮目录恢复来源干员。快照中的 `sourceCharacterName` 用于展示或交叉校验。

### Combo

连击的数值虽然固定，来源不是固定或为空。

- 新数据已有显式施加者时，读取该来源。
- 旧连击卡缺少显式来源时，来源由该状态所属的技能按钮恢复，即 containing button → stable character ID。
- 如果存在来源按钮引用，使用 source button → stable character ID。
- 按钮缺少 `characterId` 时，通过 `skillButtonTable`、timeline staff line、`selectedCharacters[staffIndex]` 和配置目录恢复。
- 连击统一归入施加者的 operator 域。
- B/Q 四档数值保持现状，A 仍不产生连击增伤。
- 不得因为它是固定倍率而计入 Residual。

### Imbalance

失衡保持严格排除。严格归因世界不仅要过滤 `imbalanceDmgBonus` Buff，还要关闭面板快照中的 `damageBonus.imbalanceDmgBonus`。其实际影响及交互进入 Residual。

## Calculation Context

Resolve 阶段 SHALL 一次性建立：

- 稳定团队成员 ID 和显示名。
- 完整角色目录，包括队伍外来源。
- 候选 provenance 索引。
- 按钮到干员的稳定映射。
- 每个普通 Buff、异常状态、连击和 extra-hit generator 的临时来源 sidecar。
- 完整 context fingerprint。

Evaluate 阶段只能消费 resolve 后的不可变输入，不得再次读取 storage、刷新候选列表或做名称猜测。

来源过滤 SHALL 使用 sidecar，而不是只读取 Buff 上的 owner 字段。关闭来源时，其普通修饰、derived 值、countable 层数、extra-hit 生成器、异常效果和连击效果必须一起关闭。

## Owen and Accounting Corrections

### Source groups

- 当前四名干员按角色分组，组内只包含实际存在的 operator/weapon/equipment 来源叶。
- 队伍外来源必须完整进入归因世界，不能只启用数组中的第一个叶。
- 若产品继续把队伍外来源聚合为一个虚拟来源，评估器必须同时开关该聚合下的全部真实来源 key。
- 不同组可以有不同叶子数量，内层排列的归一化分母必须按当前组自己的排列数计算。

### Independent invariants

至少验证以下三个独立等式：

```text
owenEfficiencyError =
  abs(sourceContributionTotal - (attributionWorldTotal - baselineTotal))

hierarchyError =
  abs(sum(character.domain.damage) - sum(source.damage for team characters))

accountingError =
  abs(actualTotal - attributedTotal - residualTotal)
```

`source.damage` 为 `directDamage + marginalDamage`；`attributedTotal` SHALL 来自全部来源行求和，`sourceContributionTotal` 单独承载 Owen 边际贡献求和。`residualTotal` 可以定义为 `actualTotal - attributedTotal`，但 UI 不能只展示 accountingError 并宣称归因正确。三种误差必须分别输出和验收。

### Cache identity

coalition cache key 必须使用 Resolve 阶段的完整 `contextFingerprint`，至少受以下变化影响：

- 按钮及顺序、Hit 与技能模板。
- 面板和目标抗性。
- Buff 内容、层数、禁用项和来源解析结果。
- 异常快照和连击。
- policyVersion。

仅使用“按钮数量”不满足要求。

来源解析语义变化后 policyVersion SHALL 提升，例如 `rdps-v2-owen-runtime-provenance-strict-imbalance`。

## Diagnostics

诊断统计不得再通过“Buff 应用数减来源组数”推算。

至少输出：

- `resolvedExplicitDefinitionCount`。
- `resolvedLegacyDefinitionCount`。
- `unresolvedDefinitionCount`。
- `ambiguousDefinitionCount`。
- `unresolvedApplicationCount`。
- `outOfTeamCharacterCount`。
- `unresolvedDisplayNameCount`。
- `excludedImbalanceEffectCount`。
- `negativeContributionCount`。
- `coalitionEvaluationCount`。
- `owenEfficiencyError`、`hierarchyError`、`accountingError`。

Definition count 按唯一 Buff 定义/稳定 ID 计数；application count 按按钮或状态实际应用次数计数。不得混用。

每个 unresolved 或 ambiguous 项应保留可调试 evidence key，但报表 UI 可以只显示摘要。

## Report UI

### Chart 3

- 图 3 保持左下位置，但不再展示逐来源表格、域或资产明细；本节覆盖第一轮的“RD total table”要求。
- 图 3 只包含两张图：左侧饼图展示“来源 RD / 自身与其他”的总伤构成，右侧柱状图展示按干员聚合后的 RD 总量。
- 柱状图使用统一角色目录中的名称，当前队伍按队伍顺序展示，队伍外来源追加展示且不得丢失。
- 图 3 的四名干员 RD 合计来自直接伤害与 Buff 边际贡献，必须与 `attributedTotal` 一致；饼图必须满足 `actualTotal = attributedTotal + residualTotal`。
- 图 3 不重复图 4 的 operator/weapon/equipment 域拆分，也不显示武器、装备或单 Buff 名称。
- 负贡献在柱状图中保留符号；若来源 RD 或 Residual 的聚合值为负，不得伪造饼图比例，应显示不适用空态。
- 解析诊断、Owen 效率误差和总账误差继续保留在 summary/测试合同中，但不占用图 3 的可视区域。

### Chart 4

- 四张卡固定对应当前队伍四名干员。
- 每张卡使用恢复后的 operator/weapon/equipment 贡献。
- 旧数据恢复成功后，不得因为缺少显式 owner 字段显示 0。
- 队伍外来源只进入图 3，但名称必须正常解析。
- 1280×720 报表视口中不得发生卡片内容越界。

## Golden Acceptance Dataset

真实验收样本固定为本机 SQLite 工作区“莱狼羊卡-热启动爆发轴”；若本地副本带后缀，应确认 payload 与目标轴一致并记录 workspace ID。

该样本至少包含以下可验证事实：

- 当前队伍：莱万汀、狼卫、艾尔黛拉、卡缪。
- 旧 Buff 记录缺少 owner 字段，但内部来源路径覆盖干员本体、武器和装备。
- 配置快照能够解析武器或套装来源，包括沧溟星梦、熔铸火焰、灯火使命/镀红祝福、动火用、长息、拓荒等当前样本实际条目。
- 异常快照包含艾尔黛拉、莱万汀与 `chr_0019_karin` 等来源；后者显示名为秋栗。

验收不得冻结未经独立校验的贡献数值，但必须冻结输入来源矩阵、解析方法和以下结构结果：

- 所有应用生成且可唯一解析的旧 Buff 均不进入 unresolved。
- 当前队伍中实际提供有效 Buff 的干员不再无依据显示 0。
- `chr_0019_karin` 不出现在用户可见名称中。
- Owen 效率、层级求和和总账误差均在 `1e-6 × max(1, abs(total))` 内。
- 图 1、图 2 总伤害与按钮时序保持不变。

## Acceptance Scenarios

### Legacy provenance

- 删除一个新 Buff 的显式 owner 字段后，候选唯一匹配恢复相同来源。
- 候选列表不存在时，规范内部路径仍可恢复应用生成的旧 Buff。
- 两个不同 owner 拥有相同显示文本时，不能按名称串组。
- 两个不同 owner 对 legacy projection 均精确命中时，结果为 ambiguous。
- 自定义 Buff 只有 sourceName 时保持 unresolved。

### Character identity

- 队伍内旧按钮缺少 characterId 时，可通过 staffIndex 与 selectedCharacters 恢复。
- 队伍外异常来源通过配置快照显示中文名。
- ID/name 冲突产生诊断，不静默覆盖。

### Combo and anomaly

- 旧 combo card 没有显式来源字段时，归给 containing/source button 的干员本体。
- 新 combo card 与旧 combo card 在同一按钮上产生相同来源 key 和贡献。
- 导电、腐蚀、碎甲通过 snapshot/source button 正确归因。
- 失衡不进入任何来源，且归因世界关闭面板失衡加成。

### Owen correctness

- 不同组叶子数量不同时仍满足效率性质。
- 队伍外包含多个真实来源 key 时不会遗漏。
- 改变任一 Buff、层数、禁用项或来源解析结果会改变 context fingerprint。
- Residual 很大时，Owen 效率误差仍能独立发现漏分配。

### Browser

- 真实 SQLite 轴的图 3、图 4来源、名称和域符合来源矩阵。
- 三套主题可读。
- 1280×720 无溢出。
- 应用控制台无错误。
- 单独记录 Resolve、provenance、coalition evaluate 和 render 耗时，不能用整页路由耗时代替 RDPS 性能。

## Risks

- 当前候选列表可能为空或比存档更新，因此不能只依赖 candidate list；必须保留规范路径与配置快照索引。
- 同名、同值 Buff 可能产生歧义，必须保持保守策略。
- 历史自定义数据可能确实没有稳定来源，这部分 Residual 是合理的。
- 旧数据兼容层若直接修改存储，会污染用户工作区并使回归难以定位，因此明确禁止写回。
- 来源覆盖增加后，Owen 参与叶和计算状态会增加，必须以真实轴测量并优化缓存。

## Definition of Done

只有同时满足以下条件，Phase 2 才能标记完成：

- 旧数据 provenance resolver 已接入所有归因路径。
- 连击旧数据来源恢复通过。
- 真实 SQLite 金样结构验收通过。
- 三个独立误差均通过。
- 原始 ID 不泄漏到可解析名称。
- 图 4 不再因旧字段缺失错误显示全零。
- 类型检查、单元测试、相关回归、构建和浏览器验收均有记录。
- tasks 中所有必做项按真实结果勾选，不以 Residual 恒等式替代验收。
