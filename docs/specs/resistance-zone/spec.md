# 抗性区 Spec

## Goal

为伤害计算新增独立的抗性区，使目标基础抗性、腐蚀 Buff 和无视抗性 Buff 可以进入正确乘区。

抗性区必须与现有伤害加成、增幅、易伤、脆弱、连击、失衡区保持语义分离。

## Non-Goals

- 不在本规格中录入完整敌人抗性表。
- 不在本规格中设计敌人选择器完整 UI。
- 不在本规格中实现干员承伤计算。
- 不在本规格中完整实现超域伤害或复合伤害链路。
- 不在本规格中确认敌人侧抗性区下限、抗性负值上限。
- 不在本规格中强制实现腐蚀经过秒数交互。

## Current Findings

- `src/core/calculators/buffCalculator.ts` 已有伤害加成、增幅、易伤、脆弱、连击、失衡和倍率区，但没有抗性字段。
- 当前技能按钮异常伤害和伤害报表中，防御区固定为 `0.5`。
- 当前伤害公式没有抗性区。
- 腐蚀异常伤害已被识别为自然元素伤害，但腐蚀状态提供的是全属性抗性降低。
- 腐蚀异常状态快照已有 UI 预览和存储，但没有转成有效 Buff。
- 当前 Buff 类型没有腐蚀或无视抗性字段。
- 当前结算乘区没有抗性区字段。

## Terms

- 抗性：目标对某实际伤害属性的基础减免值，单位为“点”。本阶段结算只使用物理、灼热、电磁、寒冷、自然抗性。
- 腐蚀：攻击方或状态提供的 Buff 效果，运行时降低目标全属性抗性，单位为“点”。腐蚀是 Buff 字段，不是抗性区字段。
- 无视抗性：攻击方提供的 Buff 效果，抵消目标抗性的伤害减免，单位为“点”。无视抗性是 Buff 字段，不是目标基础抗性字段。
- 抗性区：命中级独立乘区，和防御区、脆弱区一样只在伤害结算中体现。
- 法术腐蚀：作用于灼热、电磁、寒冷、自然四种元素命中的通用腐蚀 Buff。
- 法术无视抗性：作用于灼热、电磁、寒冷、自然四种元素命中的通用无视抗性 Buff。
- 单元素抗性：灼热、电磁、寒冷、自然各自的目标基础抗性。
- 超域抗性：独立抗性类型，暂不自动混入普通命中。
- 复合抗性：多个抗性来源综合后的抗性，占位保留。

## Formula

基础公式：

```text
resistanceZone = 1 - resistance / 100 + corrosion / 100 + resistanceIgnore / 100
```

等价分步公式：

```text
effectiveResistance = baseResistance - corrosion
resistanceZone = 1 - effectiveResistance / 100 + resistanceIgnore / 100
```

也可展开为：

```text
resistanceZone = 1 - baseResistance / 100 + corrosion / 100 + resistanceIgnore / 100
```

规则：

- 每 1 点抗性提供对应属性 `1%` 伤害减免。
- 每 1 点腐蚀降低对应命中的目标抗性 `1` 点。
- 每 1 点无视抗性抵消对应命中的抗性减免 `1%`。
- 内部实现保存点数，进入乘区时按 `/ 100` 转为小数。
- 没有目标抗性、腐蚀、无视抗性输入时，`resistanceZone = 1`。

## Damage Formula

抗性区 SHALL 位于防御区之后、增幅区之前。

目标命中公式：

```text
damage =
  atk
  * finalMultiplier
  * damageBonusRate
  * defenseZone
  * resistanceZone
  * amplifyZone
  * fragileZone
  * vulnerabilityZone
  * comboZone
  * imbalanceZone
```

## UI Placement

抗性区 SHALL 按防御区、脆弱区同级乘区处理，不作为面板属性展示。

### Skill Button Damage Detail

技能按钮伤害详情 SHALL 在普通 hit 计算过程和异常/额外 hit 计算过程中新增抗性区展示。

展示位置 SHALL 位于防御区之后、增幅区之前：

```text
防御区
抗性区
增幅区
易伤区
脆弱区
连击区
失衡区
```

抗性区展示 SHALL 至少包含：

- 目标基础抗性。
- 腐蚀 Buff 汇总。
- 无视抗性 Buff 汇总。
- 有效抗性。
- 抗性区系数。

当所有值均为默认值时，仍 SHALL 展示 `抗性区 = 1.000`，以保证公式结构稳定。

普通 hit 的非暴击公式 SHALL 在 `defenseZone` 后追加 `resistanceZone`：

```text
ATK × finalMultiplier × damageBonusRate × defenseZone × resistanceZone × amplifyZone × fragileZone × vulnerabilityZone × comboZone × imbalanceZone
```

异常伤害和额外 hit 的公式 SHALL 使用同一乘区顺序。

### Damage Sheet

伤害表 SHALL 在 `防御区` 列之后新增 `抗性区` 列。

`抗性区` 列 SHALL：

- 显示 `resistanceZone`，格式与防御区一致，保留三位小数。
- 在公式栏中展示抗性区公式。
- 在右侧相关 Buff 区中关联当前命中实际生效的腐蚀 Buff 和无视抗性 Buff。
- 不把目标基础抗性显示为 Buff。

伤害表行数据 SHALL 保留抗性区明细，供公式栏、导出和后续报表复用。

### Damage Report

伤害报表 SHALL 在每个 hit 行保留抗性区输入和抗性区系数。

报表展示 SHALL 至少能追踪：

- 命中属性。
- 目标基础抗性。
- 腐蚀点数。
- 无视抗性点数。
- 抗性区系数。

### Excel Export

伤害 Excel 导出 SHALL 在防御区列之后新增抗性区列。

导出公式 SHALL 与应用内结算公式一致，最终伤害合计 SHALL 使用包含抗性区后的结果。

## Resistance Fields

系统 SHALL 支持以下目标基础抗性字段：

- `physicalResistance`
- `fireResistance`
- `electricResistance`
- `iceResistance`
- `natureResistance`

基础抗性字段不是 Buff。它们来自目标、敌人配置或后续环境输入，并作为命中结算输入进入抗性区。

系统 SHALL 支持以下腐蚀 Buff 字段候选：

- `allCorrosion`
- `physicalCorrosion`
- `magicCorrosion`
- `fireCorrosion`
- `electricCorrosion`
- `iceCorrosion`
- `natureCorrosion`

系统 SHALL 支持以下无视抗性 Buff 字段：

- `allResistanceIgnore`
- `physicalResistanceIgnore`
- `magicResistanceIgnore`
- `fireResistanceIgnore`
- `electricResistanceIgnore`
- `iceResistanceIgnore`
- `natureResistanceIgnore`

## Element Matching

抗性区按当前 hit 的实际伤害属性结算。结算基础抗性只读取当前实际伤害属性对应的目标抗性字段。

### Physical

物理命中 SHALL 只读取：

- `physicalResistance`
- `allCorrosion + physicalCorrosion`
- `allResistanceIgnore + physicalResistanceIgnore`

### Fire

灼热命中 SHALL 读取：

- `fireResistance`
- `allCorrosion + magicCorrosion + fireCorrosion`
- `allResistanceIgnore + magicResistanceIgnore + fireResistanceIgnore`

### Electric

电磁命中 SHALL 读取：

- `electricResistance`
- `allCorrosion + magicCorrosion + electricCorrosion`
- `allResistanceIgnore + magicResistanceIgnore + electricResistanceIgnore`

### Ice

寒冷命中 SHALL 读取：

- `iceResistance`
- `allCorrosion + magicCorrosion + iceCorrosion`
- `allResistanceIgnore + magicResistanceIgnore + iceResistanceIgnore`

### Nature

自然命中 SHALL 读取：

- `natureResistance`
- `allCorrosion + magicCorrosion + natureCorrosion`
- `allResistanceIgnore + magicResistanceIgnore + natureResistanceIgnore`

### Magic Source Fields

`magicCorrosion` 和 `magicResistanceIgnore` SHALL 作为四元素通用 Buff 字段参与灼热、电磁、寒冷、自然命中。

系统 SHALL NOT 将 `magicCorrosion` 或 `magicResistanceIgnore` 作为独立命中属性结算。

系统 SHALL NOT 在本阶段新增 `magicResistance` 目标基础抗性字段。

### Hyper And Composite

超域抗性和复合抗性 SHALL 暂不进入本阶段结算。

后续若存在明确的超域或复合伤害类型，应由该伤害类型显式读取 `hyperResistance` 或 `compositeResistance`。

## Operator Resistance Reference

干员自身抗性来自敏捷和智识。

物理抗性：

```text
physicalResistance = 100 - 100 / (0.001 * floor(agility) + 1)
```

法术抗性：

```text
magicResistance = 100 - 100 / (0.001 * floor(intelligence) + 1)
```

干员承伤时抗性区可化简为：

```text
resistanceZone = 1 / (0.001 * floor(agilityOrIntelligence) + 1)
```

规则：

- 敏捷和智识显示值可带小数，但公式使用整数部分。
- 干员承伤的抗性区最小值为 `0.1`。
- 本阶段重点是玩家对敌造成伤害，干员承伤公式仅作为规则记录。
- 干员承伤下限不得默认套用到敌人承伤，除非后续资料确认。

## Enemy Resistance Reference

敌人抗性按属性分档，但同一档位可以存在特例。

已知规则：

- `D` 档通常为 `0` 点抗性。
- `C` 档通常为 `20` 点抗性。
- `C` 档特例：
  - 潜地虬兽自然抗性为 `30` 点。
  - 破潮之像、棱镜天使、浊流天使、潮行天使、晶锥天使、潮行天使δ、晶锥天使δ 的寒冷抗性为 `35` 点。
- `B` 档为 `50` 点抗性。
- 当前已知碾骨清道夫和碾骨焰术师的灼热抗性为 `50` 点。

系统 SHALL 不只保存档位字母，也要保存最终数值。

## Data Model

### EnemyResistanceProfile

```ts
interface EnemyResistanceProfile {
  enemyId: string;
  enemyName: string;
  values: {
    physical?: number;
    fire?: number;
    electric?: number;
    ice?: number;
    nature?: number;
  };
  grades?: {
    physical?: 'B' | 'C' | 'D' | string;
    fire?: 'B' | 'C' | 'D' | string;
    electric?: 'B' | 'C' | 'D' | string;
    ice?: 'B' | 'C' | 'D' | string;
    nature?: 'B' | 'C' | 'D' | string;
  };
  notes?: string[];
}
```

### SkillButtonResistanceConfig

按钮级目标抗性配置 SHALL 存在于 `PersistedSkillButton`。

本阶段不设计敌人选择器。UI 录入的目标基础抗性 SHALL 先保存为按钮级手动配置：

```ts
interface SkillButtonResistanceConfig {
  targetResistance: HitResistanceInput;
}

interface PersistedSkillButton {
  resistanceConfig?: SkillButtonResistanceConfig;
}
```

规则：

- `resistanceConfig` 存储在 `def.skill-button.v1`。
- `resistanceConfig` 缺失时 SHALL 视为全抗性 `0`。
- `resistanceConfig.targetResistance` 只保存目标基础抗性，不保存腐蚀或无视抗性。
- 普通 hit、异常 hit 和额外 hit SHALL 默认读取同一个按钮级 `targetResistance`。
- 后续若需要每个 hit 独立目标抗性，可在 `resistanceConfig` 内新增 hit 覆盖表；本阶段不实现。

### ResistanceBuffTotals

`BuffCalculationResult` SHALL 新增以下字段：

```ts
interface ResistanceBuffTotals {
  allCorrosion: number;
  physicalCorrosion: number;
  magicCorrosion: number;
  fireCorrosion: number;
  electricCorrosion: number;
  iceCorrosion: number;
  natureCorrosion: number;

  allResistanceIgnore: number;
  physicalResistanceIgnore: number;
  fireResistanceIgnore: number;
  electricResistanceIgnore: number;
  iceResistanceIgnore: number;
  natureResistanceIgnore: number;
  magicResistanceIgnore: number;
}
```

规则：

- `*Corrosion` 和 `*ResistanceIgnore` 是 Buff 汇总字段。
- `*Corrosion` 和 `*ResistanceIgnore` 保存点数，不保存小数比例。
- `magicCorrosion` 和 `magicResistanceIgnore` 是四元素通用 Buff 字段，不是目标基础抗性。

### HitResistanceInput

命中计算 SHALL 接收目标抗性输入：

```ts
interface HitResistanceInput {
  physicalResistance?: number;
  fireResistance?: number;
  electricResistance?: number;
  iceResistance?: number;
  natureResistance?: number;
}
```

### HitResistanceResult

命中计算 SHALL 输出抗性区结果：

```ts
interface HitResistanceResult {
  baseResistance: number;
  corrosion: number;
  resistanceIgnore: number;
  effectiveResistance: number;
  resistanceZone: number;
  formulaText: string;
}
```

### DamageZones

`DamageZones` SHALL 新增抗性区乘区字段：

```ts
interface DamageZones {
  resistanceZone: number;
  resistance: HitResistanceResult;
}
```

`resistanceZone` 是和 `defenseZone`、`fragileRate`、`vulnerabilityRate` 同级的伤害结算乘区字段。

`resistance` 是用于 UI 和报表展示的明细，不应替代乘区字段。

### SkillButtonBuff Type Registry

`SkillButtonBuff.type` SHALL 同步支持腐蚀和无视抗性类型。

腐蚀异常状态 SHALL 使用 `allCorrosion`，因为游戏文本描述为“全属性抗性降低”。

腐蚀 Buff 类型：

```ts
type CorrosionBuffType =
  | 'allCorrosion'
  | 'physicalCorrosion'
  | 'magicCorrosion'
  | 'fireCorrosion'
  | 'electricCorrosion'
  | 'iceCorrosion'
  | 'natureCorrosion';
```

无视抗性 Buff 类型：

```ts
type ResistanceIgnoreBuffType =
  | 'allResistanceIgnore'
  | 'physicalResistanceIgnore'
  | 'magicResistanceIgnore'
  | 'fireResistanceIgnore'
  | 'electricResistanceIgnore'
  | 'iceResistanceIgnore'
  | 'natureResistanceIgnore';
```

这些类型 SHALL 通过现有 `SkillButtonBuff.type` 字段进入 Buff 汇总层。

系统 SHALL NOT 为腐蚀或无视抗性新增独立 Buff 存储结构。

系统 SHALL NOT 将这些 Buff 类型同步到 `DamageBonusSnapshot`、`PanelSummary` 或角色面板缓存。

系统 SHALL NOT 在本阶段设计额外的跨表同步、外溢同步或迁移机制；旧数据缺失这些类型时按 `0` 处理。

腐蚀异常状态快照 SHALL 参考导电快照的接入方式：在 `buildAnomalyStateSnapshotBuffs` 中派生一个普通 `SkillButtonBuff`，再由现有 Buff 汇总和命中筛选链路进入计算。

导电当前派生为 `magicFragile`。腐蚀 SHALL 派生为 `allCorrosion`。

腐蚀 SHALL NOT 派生为易伤、脆弱、增幅或伤害加成。

### Buff Type Examples

腐蚀状态全属性抗性降低 `12` 点：

```ts
{
  type: 'allCorrosion',
  value: 12
}
```

法术通用腐蚀 `15` 点：

```ts
{
  type: 'magicCorrosion',
  value: 15
}
```

无视法术抗性 `15` 点：

```ts
{
  type: 'magicResistanceIgnore',
  value: 15
}
```

基础敌人抗性不应作为普通 Buff 保存。它应来自目标或环境配置，并作为命中输入进入抗性区。

## Storage Model

### Storage Boundaries

抗性区相关数据 SHALL 按来源分别存储：

| 数据 | 存储位置 | 是否持久化 | 说明 |
| --- | --- | --- | --- |
| 目标基础抗性 | `PersistedSkillButton.resistanceConfig.targetResistance` | 是 | 按按钮保存，属于结算输入 |
| 腐蚀 Buff | `SkillButtonBuff` in `def.all-buff-list.v1` | 是 | 通过 `selectedBuff` 或异常快照派生参与计算 |
| 无视抗性 Buff | `SkillButtonBuff` in `def.all-buff-list.v1` | 是 | 通过 `selectedBuff` 参与计算 |
| 抗性区系数 | `DamageZones.resistanceZone` | 否 | 计算派生结果 |
| 抗性区明细 | `DamageZones.resistance` | 否 | 计算派生结果，用于 UI/报表 |

### Skill Button Table

`def.skill-button.v1` SHALL 是目标基础抗性的当前存储来源。

示例：

```ts
{
  id: 'button-1',
  selectedBuff: ['buff-1', 'buff-2'],
  resistanceConfig: {
    targetResistance: {
      physicalResistance: 0,
      fireResistance: 20,
      electricResistance: 0,
      iceResistance: 35,
      natureResistance: 30
    }
  }
}
```

读取旧按钮数据时，缺失 `resistanceConfig` SHALL 不触发迁移失败，并按全抗性 `0` 处理。

### Buff List

`def.all-buff-list.v1` SHALL 继续保存 Buff 实体。

腐蚀和无视抗性 SHALL 作为普通 `SkillButtonBuff.type` 扩展，不新增独立存储表。

Buff type 的支持范围 SHALL 在所有依赖 `SkillButtonBuff.type` 的入口保持一致，包括：

- Buff 汇总计算。
- 本地 Buff 搜索和展示。
- 伤害表相关 Buff 过滤。
- Excel 导出 Buff 引用。
- AI/候选 Buff 字段目录。

上述同步只表示识别同一组 `type` 字符串，不表示新增独立持久化或跨表同步。

示例：

```ts
{
  id: 'buff-nature-corrosion',
  name: 'allCorrosion',
  displayName: '全属性腐蚀',
  sourceName: '异常状态',
  type: 'allCorrosion',
  value: 12,
  refCount: 1,
  target: { mode: 'all' }
}
```

```ts
{
  id: 'buff-magic-ignore',
  name: 'magicResistanceIgnore',
  displayName: '无视法术抗性',
  sourceName: '技能效果',
  type: 'magicResistanceIgnore',
  value: 15,
  refCount: 1,
  target: { mode: 'all' }
}
```

### Character Config And Panel Cache

角色配置、面板缓存和伤害加成快照 SHALL NOT 保存敌人目标抗性。

以下结构不应新增目标抗性字段：

- `CharacterConfigJson`
- `PanelSummary`
- `CharacterComputedCache`
- `DamageBonusSnapshot`

原因：

- 目标基础抗性属于结算目标，不属于干员面板。
- 腐蚀和无视抗性属于 Buff，不属于伤害加成快照。
- 抗性区结果属于派生计算结果，不应落入面板缓存。

### Timeline Snapshot And Share

时间轴快照和分享 SHALL 通过既有结构携带抗性区数据：

- `skillButtonTable` 携带按钮级 `resistanceConfig`。
- `allBuffList` 携带腐蚀和无视抗性 Buff。

系统 SHALL NOT 为抗性区新增单独快照表。

## Corrosion

腐蚀 SHALL 作为 Buff 作用于抗性区。

腐蚀快照 SHALL 参考导电快照的方式生成全属性腐蚀 Buff。

导电快照当前以 `SkillButtonBuff` 形式接入，并生成：

```ts
{
  type: 'magicFragile',
  value: snapshot.effectValue
}
```

腐蚀快照 SHALL 同样以 `SkillButtonBuff` 形式接入，并生成：

```ts
{
  type: 'allCorrosion',
  value: currentCorrosion
}
```

腐蚀快照 SHALL NOT 生成：

- `natureFragile`
- `natureVulnerability`
- `natureAmplify`
- `natureDmgBonus`

腐蚀当前预览参数：

```text
Lv1: 初始 3.60 / 每秒 0.84 / 上限 12
Lv2: 初始 4.80 / 每秒 1.12 / 上限 16
Lv3: 初始 6.00 / 每秒 1.40 / 上限 20
Lv4: 初始 7.20 / 每秒 1.68 / 上限 24
```

腐蚀 SHALL 与导电、碎甲使用相同的源石技艺强度增强公式。

源石技艺强度增强：

```text
effectEnhancement = sourceSkillStrength > 0
  ? 2 * sourceSkillStrength / (sourceSkillStrength + 300)
  : 0

enhancedValue = baseValue * (1 + effectEnhancement)
```

腐蚀的初始腐蚀、每秒腐蚀和腐蚀上限 SHALL 分别套用该增强公式：

```text
initialCorrosion = baseInitialCorrosion * (1 + effectEnhancement)
tickCorrosionPerSecond = baseTickCorrosionPerSecond * (1 + effectEnhancement)
maxCorrosion = baseMaxCorrosion * (1 + effectEnhancement)
```

`baseInitialCorrosion / baseTickCorrosionPerSecond / baseMaxCorrosion` SHALL 使用腐蚀等级对应的基础值。

快照保存的腐蚀参数 SHALL 是源石技艺强度增强后的值。

腐蚀快照 SHALL 至少保存：

- 来源角色。
- 来源源石技艺强度快照。
- 腐蚀等级。
- 初始腐蚀。
- 每秒腐蚀。
- 腐蚀上限。
- 持续时间。
- 当前用于计算的腐蚀值。

### Corrosion Calculation Mode

推荐实现顺序：

1. 快照创建时读取来源角色的源石技艺强度快照。
2. 使用导电、碎甲相同的 `effectEnhancement` 公式增强腐蚀基础值。
3. 快照保存增强后的 `initialCorrosion / tickCorrosionPerSecond / maxCorrosion / durationSeconds`。
4. UI 允许用户选择或输入当前腐蚀层级/经过秒数。
5. 计算 `currentCorrosion = min(maxCorrosion, initialCorrosion + tickCorrosionPerSecond * elapsedSeconds)`。
6. 将 `currentCorrosion` 转成 `allCorrosion` Buff。

如果暂不实现经过秒数输入，系统 SHALL 选择一个明确口径：

- 默认使用上限值作为计算值；或
- 默认使用初始值作为计算值。

实现时必须在 UI 和计算过程文本中展示该口径。

## Requirements

### Requirement: 抗性区独立存在

系统 SHALL 新增抗性区，并保持其与其他乘区独立。

#### Scenario: 默认抗性区

- WHEN 一次命中没有目标抗性、腐蚀或无视抗性输入
- THEN `resistanceZone = 1`
- AND 最终伤害与新增抗性区前保持一致

#### Scenario: 基础抗性

- WHEN 一次自然命中的目标自然抗性为 `20` 点
- AND 没有腐蚀
- AND 没有无视抗性
- THEN `resistanceZone = 0.8`

#### Scenario: 腐蚀

- WHEN 一次自然命中的目标自然抗性为 `20` 点
- AND 存在 `allCorrosion = 12`
- AND 没有无视抗性
- THEN `resistanceZone = 0.92`

#### Scenario: 无视抗性

- WHEN 一次自然命中的目标自然抗性为 `20` 点
- AND 存在 `natureResistanceIgnore = 10`
- AND 没有腐蚀
- THEN `resistanceZone = 0.9`

#### Scenario: 腐蚀与无视抗性叠加

- WHEN 一次自然命中的目标自然抗性为 `20` 点
- AND 存在 `allCorrosion = 12`
- AND 存在 `natureResistanceIgnore = 10`
- THEN `resistanceZone = 1.02`

### Requirement: 元素抗性匹配

系统 SHALL 根据命中元素匹配抗性字段。

#### Scenario: 物理命中

- WHEN 命中元素为 `physical`
- THEN 基础抗性读取 `physicalResistance`
- AND 腐蚀读取 `allCorrosion + physicalCorrosion`
- AND 无视抗性读取 `allResistanceIgnore + physicalResistanceIgnore`

#### Scenario: 自然命中

- WHEN 命中元素为 `nature`
- THEN 基础抗性读取 `natureResistance`
- AND 腐蚀读取 `allCorrosion + magicCorrosion + natureCorrosion`
- AND 无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + natureResistanceIgnore`

#### Scenario: 灼热命中

- WHEN 命中元素为 `fire`
- THEN 基础抗性读取 `fireResistance`
- AND 腐蚀读取 `allCorrosion + magicCorrosion + fireCorrosion`
- AND 无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + fireResistanceIgnore`

#### Scenario: 电磁命中

- WHEN 命中元素为 `electric`
- THEN 基础抗性读取 `electricResistance`
- AND 腐蚀读取 `allCorrosion + magicCorrosion + electricCorrosion`
- AND 无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + electricResistanceIgnore`

#### Scenario: 寒冷命中

- WHEN 命中元素为 `ice`
- THEN 基础抗性读取 `iceResistance`
- AND 腐蚀读取 `allCorrosion + magicCorrosion + iceCorrosion`
- AND 无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + iceResistanceIgnore`

### Requirement: 腐蚀接入抗性区

系统 SHALL 将腐蚀异常状态快照转成全属性腐蚀 Buff。

#### Scenario: 腐蚀快照转 Buff

- WHEN 用户挂载腐蚀异常状态快照
- THEN 该快照生成 `allCorrosion`
- AND `value` 使用当前腐蚀计算口径得到的点数
- AND 不生成易伤、脆弱、增幅或伤害加成 Buff

#### Scenario: 腐蚀吃源石技艺强度

- WHEN 腐蚀等级为 Lv1
- AND 来源源石技艺强度快照为 `300`
- THEN `effectEnhancement = 1`
- AND 初始腐蚀为 `3.6 * (1 + 1) = 7.2`
- AND 每秒腐蚀为 `0.84 * (1 + 1) = 1.68`
- AND 腐蚀上限为 `12 * (1 + 1) = 24`

#### Scenario: 腐蚀影响自然伤害

- WHEN 一个腐蚀快照提供 `allCorrosion = 12`
- AND 当前命中元素为 `nature`
- THEN 抗性区包含这 `12` 点腐蚀

#### Scenario: 腐蚀影响灼热伤害

- WHEN 一个腐蚀快照提供 `allCorrosion = 12`
- AND 当前命中元素为 `fire`
- THEN 抗性区包含这 `12` 点腐蚀

### Requirement: 计算过程展示

系统 SHALL 在异常伤害详情和伤害报表中展示抗性区。

#### Scenario: 异常伤害详情

- WHEN 展开异常伤害计算过程
- THEN 展示基础抗性、腐蚀、无视抗性和最终抗性区
- AND 公式展示为 `1 - 抗性/100 + 腐蚀/100 + 无视抗性/100`
- AND 如果存在腐蚀，公式展示中明确显示 `抗性 - 腐蚀`

#### Scenario: 伤害报表

- WHEN 生成伤害报表
- THEN 每个 hit 行保留抗性区输入和抗性区系数
- AND 最终伤害合计使用包含抗性区后的结果

## Implementation Plan

1. 在 Buff 汇总层新增腐蚀和无视抗性字段。
2. 新增 `calculateResistanceZone(elementKey, targetResistance, buffTotals)` 纯函数。
3. 将抗性区接入技能按钮异常伤害计算。
4. 将抗性区接入普通 hit 伤害计算。
5. 将抗性区接入伤害报表。
6. 将腐蚀快照转成 `allCorrosion`。
7. 在 UI 中展示抗性区公式。
8. 后续补敌人抗性表和目标选择 UI。

## Acceptance Criteria

- 没有抗性输入时，旧伤害结果保持不变。
- 腐蚀不被实现为易伤、脆弱、增幅或伤害加成。
- 自然命中能消费腐蚀提供的全属性腐蚀。
- 物理、灼热、电磁、寒冷命中也能消费腐蚀提供的全属性腐蚀。
- 计算过程展示抗性区公式和最终系数。
- 伤害报表包含抗性区输入和系数。
- `npm run build` 通过。

## Open Questions

- 腐蚀默认计算口径应使用初始值、上限值，还是引入经过秒数输入。
- 敌人承伤是否存在抗性区下限或抗性负值上限。
- 超域抗性和复合抗性的具体命中匹配规则。
- 敌人抗性表的数据来源和维护格式。
