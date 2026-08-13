# 任务：RDPS 归因分析与实施可行性评估（自包含需求说明）

你是一个独立分析 Agent，不知道本项目上下文。请通读本文件后，分析以下需求**是否能实施、如何实施、有什么风险**，输出可行性结论、实施方案与工作量评估。本文件的所有陈述都来自对代码库的实际核查，可以直接采信；涉及具体行号/文件时，请打开对应文件复核。

## 一、项目背景（1 段）

这是"终末地伤害工作台"（DMG End Field）Web LTS 1.8 项目，浏览器端 React 18 + TypeScript 的离线优先应用：用户配置干员（角色）、武器、装备、Buff，排技能轴（时间轴），计算伤害并生成 PPT 式伤害报表。代码库根目录在仓库根，核心在 `src/`。当前分支 `codex/v1.8-lts-slimming`。

## 二、需求（产品侧，用户原话整理）

伤害计算报表目前输出**总损伤**（以及总损伤 ÷ 实测时间 = DPS）。用户群反馈：想知道**某些辅助/队友干员的增益 Buff、以及他们携带的武器 Buff，对总损伤分别贡献了多少**——即 RDPS（相对 DPS）归因分析：把总损伤按"增益来源"拆解，得到每个来源的贡献伤害（绝对值）与贡献占比（百分比）。

交付形态要求：

1. **现有伤害报表页保持不变**（已有的伤害表、图 1 干员伤害占比扇瓣图、图 2 伤害过程时序折线图都不动）。
2. 桌面端报表目前是 2×2 的四图布局，**图 3 与图 4 现在是空占位**。要求：
   - **图 3（左下）**：一张 **RD 总表**——各增益来源对总损伤的贡献（来源名 + 贡献伤害 + 占比），并给出总损伤与"来源贡献合计"的对照。
   - **图 4（右下）**：**一分为四**（队伍 4 个干员，各占一块），每块是该干员**装备 / 干员（本体与技能）/ 武器 三者来源的 RD 占比图**（环形/饼状占比可视化）。

## 三、归因口径（用户明确指定，必须遵守）

1. **干员携带的武器 Buff → 算该干员的增益**（计入该干员名下的贡献）。
2. **干员施加的异常状态 Buff（导电、腐蚀、碎甲）→ 算该干员的增益**（计入施加干员名下的贡献）。
3. **干员的装备 Buff → 算该干员的增益**。
4. **失衡（imbalance）→ 不算任何干员/武器的贡献**，归为"自身/其他"（或从来源贡献中排除，但总额要与总损伤对得上，需在设计中明确口径）。
5. **连击（combo）→ 与导电同类，属于施加干员的增益**。注意：**当前项目还没有实现连击**——计算器乘区已预留 `comboDamageBonus`，但没有正式的连击 Buff/状态数据来源。本需求要**顺带把"连击"作为新的异常状态实现**（由干员施加，提供连击乘区加成），并纳入归因。

## 四、代码现状（已核查，供你直接使用）

### 4.1 报表页
- `src/components/DamageReportPptPage.tsx`（约 851 行）：PPT 报表页。`ChartSlide` 组件渲染 2×2 grid（CSS class `report-ppt-chart-grid`），现为：
  - 图 1：`PetalRoseChart`（干员伤害占比扇瓣图，`buildCharacterDamageRows(snapshot.buttons)`）
  - 图 2：`LineChart`（伤害过程时序折线图）
  - 图 3、图 4：占位 card（`<article className="report-ppt-chart-card is-placeholder"><h2>图 3</h2></article>` 等）
- 图表均为内联 SVG，无第三方图表库。
- `src/components/DamageReportPptPrimitives.tsx`：报表基础组件（85 行）。

### 4.2 报表数据服务
- `src/core/services/damageReportService.ts`：`buildDamageReportSnapshot()` 生成快照：
  - `DamageReportSnapshot.buttons: DamageReportButtonRow[]`，每行含 `characterId`、`characterName`、`damage`、`expected`、`share`、`hits: DamageReportHitRow[]`。
  - `DamageReportHitRow`：`sourceKind: 'normal' | 'anomaly' | 'extraHit'`、`damage`、`expected`、`buffs: DamageReportBuffRow[]`、`zones?`。
  - `DamageReportBuffRow`：`id`、`traceId`、`name`、`effect`、`type?`、`zone?`（乘区）、`rawValue?`、`runtimeCoefficient?`、`effectiveValue?`、`multiplierCoefficient?`、`multiplier?`。**注意：当前没有 `sourceName` / `ownerBuffDomain` 字段——这是 RD 归因必须补充的字段**（从 `appliedBuffs`（SkillButtonBuff）投影时带上）。
- `toBuffRows(appliedBuffs)` 从 `SkillButtonBuff[]` 投影出 buff 行。

### 4.3 伤害计算（乘区）
- `src/core/calculators/skillDamage.types.ts`：
  - `HitCalcResult`：`appliedBuffs: SkillButtonBuff[]`、`zones: DamageZones`、`buffContributions?`、`nonCrit/crit/expected: DamageBreakdown`。
  - `DamageBreakdown`：`base → afterCrit → afterBonus → afterDefense → afterResistance → afterAmplify → afterFragile → afterVulnerability → final`（逐级链路，可用于比例折算）。
  - `DamageZones`：`damageBonus / amplify / fragile / vulnerability / skillMultiplier`（ZoneCalculationResult，含各 buff 的 `additiveContributions`、`multiplierContributions`、`additiveTotal`、`multiplierProduct`、`finalValue`）、`resistanceZone`、`resistance: ResistanceZoneResult`、`comboDamageBonus: number`、`imbalanceDamageBonus: number`、`defenseZone`。
- `src/core/calculators/buffZoneCalculator.ts`：乘区计算。`BuffContribution`：`zone`（'damageBonus' | 'skillMultiplier' | 'amplify' | 'fragile' | 'vulnerability'）+ `effectiveValue` + `multiplierCoefficient` 等；每个 Buff 在乘区中的贡献已有逐条记录（`contributions: BuffContribution[]`）。

### 4.4 Buff 来源字段
- `src/core/domain/buff.ts` 与 `src/types/storage.ts`：
  - `SkillButtonBuff` / `CandidateBuff` 有 `source`（来源键）、`sourceName`（来源名，干员名或武器名）、`ownerBuffDomain?: 'operator' | 'weapon' | 'equipment'`（原始配置域：干员/武器/装备）、`ownerCharacterId?`、`ownerBuffGroup?`。
- `src/core/services/operatorConfigCandidateBuffService.ts`：候选 Buff 生成时标注 `ownerBuffDomain`（operator / weapon / equipment）。
- `src/core/services/anomalyStateBuffs.ts`：异常状态快照 → `buildAnomalyStateSnapshotBuffs()` 生成 `导电`（magicFragile 法术易伤）、`碎甲`（physicalFragile 物伤易伤）、`腐蚀`（allCorrosion 全属性降抗）三种 Buff，`sourceName = snapshot.sourceCharacterName`（**施加干员名**），`source = 'anomaly_state_snapshot'`，**未标注 ownerBuffDomain**（归因时应按 sourceName 归属，或补 domain 字段）。

### 4.5 连击现状
- 计算器乘区 `comboDamageBonus` 已实现（`DamageZones.comboDamageBonus`，公式链含 `×(1 + comboDamageBonus)`）。
- `src/core/calculators/skillDamageFullMultiplierData.fixture.ts`：测试夹具里有 `comboDamageBonus` 类型 Buff（`combo-direct` 0.08、`combo-countable` 0.06×3 层、`combo-derived` 派生值），以及 `matrix-combo-state`（'连击' 状态卡）。
- **正式产品数据/异常状态中没有连击**：`anomalyStateBuffs.ts` 只有 conductive / armor-break / corrosion 三种；没有连击（combo）异常状态的生成、快照、Buff 定义。需要新增。

### 4.6 失衡现状
- `DamageZones.imbalanceDamageBonus` 乘区已实现；公式含 `×(1 + imbalanceDamageBonus)`。口径上不计入干员/武器来源贡献。

## 五、设计考虑（供你评估，可提出更好方案）

### 5.1 归因算法（二选一，请评估）
- **方案 A：反事实（边际贡献）重算**——对每个来源（干员 X 的全部 buff，含其武器/装备/异常状态/连击），从该干员所有被应用的 Buff 集合中剔除后重算总损伤，差值即该来源贡献。计算器是纯函数（`skillDamageFullMultiplier` / `damageReportService` 的可重入计算路径），可复制输入后重算。代价：每个来源一次全量重算（来源数 ≈ 干员数 × 3，规模小，本地毫秒级）。优点：乘区交互（加算/乘算、抗性边界）自动正确，贡献之和可加性需要验证（非线性乘区下边际贡献之和 ≠ 总差异，需明确展示口径，如"按序边际贡献"或"并列独立贡献"）。
- **方案 B：乘区占比分摊**——利用 `BuffContribution` / `DamageReportZoneRow` 的逐 Buff `effectiveValue`，按各乘区最终值把 `DamageBreakdown` 的逐级差量按贡献比例分摊到每个 Buff，再按来源聚合。优点：单次计算、纯增量、贡献之和恒等于总损伤。缺点：乘区之间的交互（如易伤放大前面乘区）用比例分摊近似，非线性乘区有口径误差。
- 用户场景是"辅助/队友增益贡献"的直观理解，请给出推荐并说明理由。

### 5.2 数据流改动（最小侵入）
1. `DamageReportBuffRow` 增加 `sourceName`（及可选 `ownerBuffDomain`、`ownerCharacterId`），`toBuffRows` 透传；`DamageReportHitRow` 已挂 `buffs`。
2. 新增 RD 归因纯函数模块（建议 `src/core/services/rdpsContributionService.ts` 或类似）：输入 `DamageReportSnapshot`（或按钮/hit/buff 明细），输出"来源 → 贡献伤害/占比"的结构（含图 3 总表行 + 图 4 每人三分（装备/干员/武器）占比所需的分组口径；异常状态/连击按施加干员并入该干员）。
3. `DamageReportPptPage.tsx` 的 `ChartSlide`：图 3 渲染 RD 总表（新组件 `RdpsTableChart` 或类似），图 4 渲染 4 格占比图（新组件，内联 SVG 环形图）。
4. 新增连击：在 `anomalyStateBuffs.ts` 增加 combo 状态（`type` 走 `comboDamageBonus` 乘区，快照字段参照 conductive 的模式，`sourceCharacterName` 记录施加干员），并在计算/快照/报表链路中让它像导电一样进入 `appliedBuffs` 与归因。注意检查 `skillButtonAnomalyDamage`（异常状态伤害结算）与 `skillDamageFullMultiplier`（全乘区）对 combo 的处理是否已就绪。
5. 主题样式：报表图表使用现有 `report-ppt-*` CSS 体系与内联 SVG 风格，需检查 `src/styles/` 中 PPT 报表的主题变量覆盖（本项目有多套视觉主题，新图表需保持主题一致性）。

### 5.3 边界与风险（请逐项核实）
- `DamageReportBuffRow` 无来源字段的现状（需要补）。
- 异常状态 Buff 无 `ownerBuffDomain`（归因归属按 sourceName 或补字段，需定口径）。
- 方案 A 的重算可重入性：`damageReportService` 的按钮级计算是否纯函数、能否对"排除某些 buff"复用；`appliedBuffs` 的过滤（`isModifierBuff` 等）是否影响。
- 失衡与"自身面板"（角色基础攻击/暴击/技能倍率）在归因中的口径：用户只关心"增益来源"，基础面板不算任何来源；总损伤 = 基础 + Σ来源贡献 + 失衡等未归属部分，图 3 需要让"合计对得上"。
- 连击新增对现有计算/测试夹具的影响（fixture 已有 combo 类型，产品化需要正式数据源与快照格式）。
- 报表是"导出图"（html-to-image / PPT 报表导出），新图表需在导出画布中正常渲染（注意字体、颜色、SVG 内联样式）。

## 六、你的输出要求

请输出：
1. **可行性结论**：能否实施、主要难度点在哪。
2. **方案选型**：5.1 中 A/B（或改进方案）的推荐与理由。
3. **实施计划**：分步改动清单（文件级），每步的验收点。
4. **风险清单**：数据口径风险、计算正确性风险、主题/导出风险，以及连击新增的具体风险。
5. **工作量评估**：粗略人天（按熟悉该代码库的开发者计）。
