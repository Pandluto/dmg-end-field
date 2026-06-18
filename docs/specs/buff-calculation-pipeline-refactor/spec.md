# Buff 计算链路重构 Spec

## Status

草案中。

## Background

当前 Buff 链路以 `type + value` 表达效果：

```text
type  = 作用字段
value = 数值 n
```

计算时，同一字段的 Buff 被直接汇总为标量：

```text
zone = 1 + a + b + c
```

这种结构无法表达作用于整个字段或乘区的额外系数。例如“已有法术脆弱视为 1.1 倍”不能被正确表达为普通法术脆弱加算。

本轮需要支持：

```text
zone = A × B × C × (1 + a + b + c)
```

同时，Buff 数值链路需要从单一数值 `n` 扩展为可计算的 `kn`。

当前 `countable` 已经证明 Buff 除了 `type + value` 外，还可以携带额外计算标识和按钮级状态。本轮新增的 `multiplier` 与 `countable` 类似：它是 Buff 上的附加计算标识，不是新的 Buff 字段，也不是新的 `effectKind`。

## Goal

本轮目标：

- 保留 all-buff-list 快照层。
- 从 Operator Studio 开始调整 Buff 定义和产出链路。
- 保留现有 Buff `type` 字段体系。
- 新增 `multiplier` 附加标识。
- `multiplier` 继续引用现有伤害加成、易伤、脆弱、增幅和技能倍率字段。
- 支持五类乘区的独立乘算项。
- 将普通 Buff 数值链路统一为 `kn`。
- 保留并兼容 `countable`。
- 修改相关 sessionStorage 结构。
- 让普通 hit、异常 hit、额外 hit、伤害详情、报表和 Excel 使用同一套结果。
- 没有 multiplier 时保持历史计算结果不变。

## Non-Goals

本轮不处理：

- 不删除 all-buff-list 快照层。
- 不删除技能按钮通过 buffId 引用 Buff 的方式。
- 不移除 `refCount` 和现有 Buff 实体管理机制。
- 不把 `multiplier` 建模为新的 `effectKind`。
- 不新增 `magicVulnerabilityMultiplier` 等平行字段。
- 不让所有 Buff 字段都支持乘算。
- 不改攻击力、属性、暴击、抗性、腐蚀和无视抗性的计算模型。
- 不为连击和失衡增加独立乘算项。
- 不重做 Buff 管理界面。
- 不在本规格中拆分开发 tasks。

## Confirmed Model

### Effect Kind

`effectKind` 继续只负责区分普通效果和额外伤害：

```ts
type BuffEffectKind = 'modifier' | 'extraHit';
```

`multiplier` SHALL NOT 成为第三种 `effectKind`。

### Buff Type

`type` 继续表示 Buff 所引用的原有字段，例如：

```text
magicVulnerability
physicalFragile
fireAmplify
allDmgBonus
multiplierBonus
```

同一套字段同时供普通 Buff 和 multiplier Buff 引用。

### Multiplier Marker

`multiplier` 是 Buff 的附加计算标识。

概念结构：

```ts
interface BuffCalculationMeta {
  multiplier?: {
    coefficient: number;
  };
}
```

字段名可在实现阶段调整，但语义必须保持：

- 未标记 multiplier：该 Buff 是原有字段的普通加算贡献。
- 标记 multiplier：该 Buff 引用原有字段以继承该字段的命中范围；命中后，为当前 hit 对应的整个乘区提供独立乘算系数。

示例：

```ts
{
  effectKind: 'modifier',
  type: 'magicVulnerability',
  multiplier: {
    coefficient: 1.1
  }
}
```

表示：

```text
当法术脆弱字段能够命中当前 hit 时，当前 hit 的整个脆弱乘区独立乘以 1.1
```

不表示：

```text
增加 1.1 法术脆弱
```

### Countable Marker

`countable` 继续通过现有 `category=countable` 表达。

`countable` 与 `multiplier` 都属于附加计算语义，不改变 Buff 的原有 `type`。

本轮必须继续支持普通 countable Buff：

```text
每层数值 n
当前层数 k
实际贡献 kn
```

本轮不得因为引入 multiplier 而破坏：

- `maxStacks`
- 按钮当前层数
- 加一层
- 减一层
- 保存和恢复层数
- 按层计算有效值

### n, k And kn

对普通加算 Buff：

```text
n = Buff 定义数值
k = 当前作用系数
实际贡献 = kn
```

默认：

```text
k = 1
```

对 countable：

```text
k = 当前层数
```

`kn` 不在 Operator Studio、候选 Buff 或 all-buff-list 中提前计算。

`kn` 在 Buff 定义与技能按钮运行时状态合流后生成。

### Multiplier Coefficient

标记为 multiplier 的 Buff SHALL 额外保存直接乘算系数：

```ts
multiplier: {
  coefficient: 1.1
}
```

表示乘以 `1.1`，不得转换为 `1 + 1.1`。

`value` 继续保持原有普通数值 `n` 语义，不得因为 multiplier 标识而改成另一种数值含义。纯 multiplier Buff 可以不填写普通 `value`。

本轮不支持同一个 Buff 同时使用 multiplier 和 countable。两种标识同时出现时，Operator Studio 和数据校验 SHALL 拒绝该定义。

## Supported Zones

本轮 multiplier 只允许引用以下五类乘区的原有字段。

multiplier 引用字段的职责是决定它能否命中当前 hit。命中后，它作用于当前 hit 已经合并完成的整个对应乘区，不只放大同名字段的普通加算值。

### Damage Bonus

包括：

- 元素伤害加成字段。
- 法术通用伤害加成字段。
- 技能类型伤害加成字段。
- 全伤害加成字段。

公式：

```text
damageBonusZone =
  product(matching multiplier buffs)
  × (1 + sum(matching normal buff kn))
```

### Fragile

公式：

```text
fragileZone =
  product(matching multiplier buffs)
  × (1 + sum(matching normal buff kn))
```

### Vulnerability

公式：

```text
vulnerabilityZone =
  product(matching multiplier buffs)
  × (1 + sum(matching normal buff kn))
```

示例：

```text
法术脆弱普通加算总和 = 0.20
法术脆弱 multiplier = 1.10

vulnerabilityZone = 1.10 × (1 + 0.20) = 1.32
```

跨字段合并示例：

```text
当前 hit = 寒冷
法术脆弱普通加算 = 0.20
寒冷脆弱普通加算 = 0
寒冷脆弱 multiplier = 1.10
```

原有命中逻辑先确定：

```text
寒冷 hit 命中法术脆弱 0.20
寒冷 hit 命中寒冷脆弱 multiplier 1.10
```

随后在 hit 级脆弱乘区统一结算：

```text
vulnerabilityZone = 1.10 × (1 + 0.20) = 1.32
```

寒冷脆弱 multiplier 虽然引用 `cold/ice vulnerability` 字段，但它命中后放大的是寒冷 hit 的整个脆弱乘区，因此会同时放大该 hit 命中的法术脆弱。

多个 multiplier 与 countable 普通 Buff 示例：

```text
当前 hit = 寒冷
法术脆弱普通加算 = 每层 0.20，当前 2 层
法术脆弱 multiplier = 1.10
寒冷脆弱 multiplier = 1.10
```

Stage 1 先解析普通 Buff：

```text
法术脆弱有效值 = 2 × 0.20 = 0.40
```

Stage 2 再沿用原有命中逻辑并聚合当前 hit 的脆弱区：

```text
vulnerabilityZone
= 1.10 × 1.10 × (1 + 0.40)
= 1.694
```

### Amplify

公式：

```text
amplifyZone =
  product(matching multiplier buffs)
  × (1 + sum(matching normal buff kn))
```

### Skill Multiplier

公式：

```text
skillMultiplier =
  product(matching multiplier buffs)
  × (baseMultiplier + sum(matching normal buff kn))
```

现有：

```text
multiplierBonus
multiplierMultiplier
```

SHALL 收敛到统一模型：

- 普通技能倍率加算继续引用技能倍率字段。
- 技能倍率乘算改为同一字段上的 multiplier 标识。

具体保留哪个 type 名称由实现阶段确定，但不得继续让技能倍率区维护一套与其他四区完全独立的数据模型。

## Operator Studio

Operator Studio SHALL 是本轮新模型的第一个完整生产入口。

### Buff Editing

Operator Studio 的 Buff 编辑区 SHALL 支持：

- 选择原有 Buff `type`。
- 设置 `value`。
- 设置 `category`。
- 设置 `maxStacks`。
- 设置 multiplier 标识和 coefficient。
- 保留 `effectKind=modifier/extraHit`。

### Modifier Example

```ts
{
  effectKind: 'modifier',
  type: 'magicVulnerability',
  value: 0.2,
  category: 'condition',
  multiplier: undefined
}
```

表示法术脆弱普通加算 `0.2`。

### Multiplier Example

```ts
{
  effectKind: 'modifier',
  type: 'magicVulnerability',
  category: 'condition',
  multiplier: {
    coefficient: 1.1
  }
}
```

表示法术脆弱乘区独立乘以 `1.1`。

### Validation

Operator Studio SHALL 校验：

- multiplier 只能引用本轮支持的五类乘区字段。
- multiplier.coefficient 按直接倍率处理。
- multiplier.coefficient 必须是有效正数。
- extraHit 不使用 multiplier 标识。
- 普通 countable 继续要求有效 `maxStacks`。
- multiplier 与 countable 不允许同时设置在同一个 Buff 定义上。
- 不根据描述文本自动创建新的 type 字段。

## Upstream And Runtime Pipeline

目标链路：

```text
Operator Studio 定义
        ↓
运行时干员模板
        ↓
配置页快照
        ↓
CandidateBuff
        ↓
all-buff-list 快照
        +
skill-button 运行时状态
        ↓
按 hit 匹配 Buff
        ↓
计算普通 Buff 的 kn
        ↓
普通贡献与 multiplier 贡献分组
        ↓
五类乘区聚合
        ↓
HitCalculationResult
        ↓
伤害详情 / 伤害表 / 报表 / Excel
```

### Definition Preservation

以下层级 SHALL 保留完整 Buff 定义，不得提前压平：

- Operator Studio 草稿和库。
- 运行时干员模板。
- Operator Config Page Cache。
- Candidate Buff List。
- All Buff List。

至少保留：

```text
effectKind
type
value
category
maxStacks
multiplier
target
```

### Where kn Is Produced

`kn` SHALL 在计算入口生成。

输入：

```text
all-buff-list 中的 n
skill-button 中的 k
当前 hit 上下文
```

输出：

```text
当前 hit 的有效普通贡献 kn
```

Operator Studio 和各级快照只传定义，不保存当前 hit 的 `kn`。

## Two-Stage Calculation

本轮计算必须明确拆成两个阶段。这两个阶段 SHALL NOT 合并成一次标量汇总。

### Stage 1: Resolve Buff Instance Value

第一阶段只处理 Buff 定义和技能按钮实例状态：

```text
Buff 定义 value = n
技能按钮 countable 层数 = k
普通 Buff 默认 k = 1
```

产出：

```text
普通 Buff 有效值 = kn
```

例如法术脆弱 `20%` 叠两层：

```text
n = 0.20
k = 2
kn = 0.40
```

该阶段不进行元素、法术、物理或技能类型的乘区合并，也不计算 multiplier 乘积。

### Stage 2: Match Hit And Aggregate Zone

第二阶段沿用现有 hit 命中规则：

- 元素字段匹配。
- 法术通用字段匹配。
- 物理字段匹配。
- 技能类型字段匹配。
- Buff target 匹配。
- hit 级手动禁用。

命中后分组：

```text
普通 Buff 的 kn
→ 当前 hit 对应乘区的括号内加算和

multiplier.coefficient
→ 当前 hit 对应乘区的括号外乘积
```

最终：

```text
zone = A × B × (1 + k1C + k2D)
```

技能倍率区：

```text
skillMultiplier = A × B × (baseMultiplier + k1C + k2D)
```

Stage 1 负责“单个 Buff 当前是多少”；Stage 2 负责“哪些 Buff 命中当前 hit，以及如何组成乘区”。

## SessionStorage Model

本轮 SHALL 升级承载 Buff 定义或运行时状态的 sessionStorage 结构。

至少涉及：

| 当前存储 | 修改原因 |
| --- | --- |
| `def.operator-runtime.template-map.v1` | 运行时模板需要保留 multiplier 标识 |
| `def.operator-config.page-cache.v1` | 配置快照不能把 multiplier 压平成普通总数 |
| `def.candidate-buff-list.v1` | 候选 Buff 需要携带 multiplier 标识 |
| `def.all-buff-list.v1` | 已选 Buff 快照需要携带 multiplier 标识 |
| `def.skill-button.v1` | 按钮需要保存生成 `k` 所需的运行时状态 |

结构变化 SHALL 提升存储版本，或增加明确的 schema version。

### All Buff List

all-buff-list 继续保存 Buff 定义快照：

```ts
interface SkillButtonBuff {
  id: string;
  effectKind?: 'modifier' | 'extraHit';
  type?: string;
  value?: number;
  category?: 'condition' | 'countable' | 'passive';
  maxStacks?: number;
  multiplier?: {
    coefficient: number;
  };
  target?: SkillButtonBuffTarget;
}
```

all-buff-list 不保存：

- 当前按钮层数结算出的 `kn`。
- 当前 hit 的匹配结果。
- 乘区加算和。
- 乘区乘算积。
- 最终伤害。

### Skill Button State

技能按钮 SHALL 保存 countable Buff 的按钮级层数状态。

现有：

```ts
buffStackCounts?: Record<string, number>;
```

可以继续作为 countable 的 `k` 来源。

本轮继续使用 `buffStackCounts`，不新增通用 `buffCoefficients`。

multiplier 不需要按钮级系数状态。其直接倍率来自 all-buff-list 定义中的 `multiplier.coefficient`。

sessionStorage 的职责固定为：

```text
all-buff-list
→ 保存 n、multiplier.coefficient、type 和定义信息

skill-button
→ 保存 selectedBuff、buffStackCounts 和 hit 禁用状态
```

sessionStorage 不保存：

```text
kn
additiveTotal
multiplierProduct
finalValue
最终伤害
```

### Storage Migration

迁移规则：

```text
旧普通 Buff
→ multiplier=false

旧 countable Buff
→ multiplier=false
→ 原 buffStackCounts 继续作为 k

旧 multiplierBonus
→ 技能倍率字段上的普通加算 Buff

旧 multiplierMultiplier
→ 技能倍率字段上的 multiplier Buff
→ 原 value 迁移到 multiplier.coefficient

旧 extraHit
→ 保持 effectKind=extraHit
```

迁移 SHALL 保留：

- buffId。
- `selectedBuff` 引用。
- `refCount`。
- hit 级禁用关系。
- anomaly card 的 `selectedBuffIds`。
- 时间轴和分享中的引用。

## Hit-Level Contributions

系统 SHALL 在按 hit 完成 target 匹配和禁用过滤后生成贡献。

概念模型：

```ts
interface BuffContribution {
  buffId: string;
  type: string;
  zone: SupportedZone;
  multiplier: boolean;
  rawValue: number;
  runtimeCoefficient: number;
  multiplierCoefficient?: number;
  effectiveValue: number;
}
```

规则：

- 普通 Buff：`effectiveValue = k × n`。
- multiplier Buff：`effectiveValue = multiplier.coefficient`，作为直接倍率。
- target 不匹配的 Buff 不生成贡献。
- 当前 hit 手动禁用的 Buff 不生成贡献。
- extraHit 定义本身不生成普通乘区贡献。

## Zone Result

五类乘区 SHALL 使用统一结构输出：

```ts
interface ZoneCalculationResult {
  additiveContributions: BuffContribution[];
  multiplierContributions: BuffContribution[];
  additiveTotal: number;
  multiplierProduct: number;
  finalValue: number;
}
```

普通四区：

```text
finalValue = multiplierProduct × (1 + additiveTotal)
```

技能倍率区：

```text
finalValue = multiplierProduct × (baseMultiplier + additiveTotal)
```

没有 multiplier 时：

```text
multiplierProduct = 1
```

## Target Matching

multiplier Buff SHALL 使用其引用 type 原有的匹配规则。

本轮 SHALL 保留现有已经生效的命中语义，不重新设计以下规则：

- 寒冷、灼热、电磁、自然等具体元素加成只匹配对应元素 hit。
- 法术通用加成匹配现有定义下的法术元素 hit。
- 物理加成只匹配物理 hit。
- 普攻、战技、连携技、终结技、持续伤害等技能加成继续按现有 skillType 匹配。
- 具体元素字段和法术通用字段可按现有规则同时命中同一个元素 hit。

例如：

- `type=magicVulnerability`：匹配法术通用脆弱范围。
- `type=fireVulnerability`：只匹配灼热脆弱范围。
- `type=skillDmgBonus`：匹配对应技能类型范围。
- Buff 自身 target 仍可进一步限制到 `damageKey/skillType/element`。

匹配完成后 SHALL 先在 hit 级合并所有普通加算贡献，再将所有命中的 multiplier 系数乘到整个对应乘区：

```text
matched additive contributions
→ additiveTotal

matched multiplier contributions
→ multiplierProduct

zone = multiplierProduct × (base + additiveTotal)
```

系统 SHALL NOT 将 multiplier 限制为只放大与其引用 type 同名的普通 Buff。

系统 SHALL 在统一 type 注册层定义：

- type 属于哪个乘区。
- type 的元素或技能匹配规则。
- type 是否允许 multiplier。
- type 的数值格式。

计算端不得根据展示名称判断。

## Damage Calculation

最终伤害使用五类乘区的 `finalValue`：

```text
damage =
  atk
  × skillMultiplier.finalValue
  × critZone
  × damageBonus.finalValue
  × defenseZone
  × resistanceZone
  × amplify.finalValue
  × fragile.finalValue
  × vulnerability.finalValue
  × comboZone
  × imbalanceZone
```

连击、失衡、防御和抗性继续使用现有模型。

## Result Snapshot

完成当前 hit 的匹配和聚合后，系统 SHALL 输出结构化计算结果。

结果至少包含：

- 实际生效 Buff。
- 普通 Buff 的 `n/k/kn`。
- multiplier Buff 的 coefficient。
- 五类乘区的加算贡献。
- 五类乘区的 multiplier 贡献。
- 加算和。
- multiplier 乘积。
- 最终乘区值。
- 最终伤害分步结果。

伤害详情、伤害表、报表和 Excel SHALL 消费该结果，不得分别实现另一套乘区算法。

## UI And Formula Display

普通 countable Buff SHALL 显示：

```text
原始值 n
当前系数/层数 k
实际值 kn
```

multiplier Buff SHALL 显示：

```text
引用字段
coefficient
作用范围
```

公式示例：

```text
脆弱区 = 1.100 × (1 + 20.0%) = 1.320
```

多个 multiplier：

```text
脆弱区 = 1.100 × 1.050 × (1 + 20.0% + 8.0%)
```

无 multiplier 时可以简化为：

```text
脆弱区 = 1 + 20.0%
```

## Damage Report And Excel

伤害报表和 Excel SHALL 能追踪：

```text
普通 Buff：n → k → kn
multiplier Buff：type → coefficient
两类贡献 → 乘区结果 → 最终伤害
```

Excel SHALL NOT 继续假设易伤、脆弱和增幅只能按：

```text
1 + sum(buff.value)
```

报表和 Excel 中的乘区结果必须与核心计算结果一致。

## Legacy Compatibility

### Ordinary Buff

历史普通 Buff：

```ts
{
  type: 'magicVulnerability',
  value: 0.2
}
```

兼容为：

```text
multiplier = undefined
n = 0.2
k = 1
kn = 0.2
```

### Countable Buff

历史计层 Buff：

```text
value = 0.05
stackCount = 3
```

兼容为：

```text
n = 0.05
k = 3
kn = 0.15
```

### Existing Skill Multiplier

历史 `multiplierMultiplier` SHALL 迁移为技能倍率原有字段上的 multiplier 标识。

旧数据缺少 multiplier 标识时默认按普通加算 Buff 处理。

## Requirements

### Requirement: Multiplier 是附加标识

- WHEN 系统定义 multiplier Buff
- THEN `effectKind` 仍为 `modifier`
- AND Buff 仍引用原有 `type`
- AND multiplier 通过独立 coefficient 改变对应乘区的计算方式
- AND 系统不创建平行 multiplier type

### Requirement: Operator Studio 产出

- WHEN 用户在 Operator Studio 编辑 Buff
- THEN 可以为普通 modifier 设置 multiplier 标识
- AND multiplier coefficient 与普通 value 分开保存
- AND 只有五类支持的字段允许设置 multiplier
- AND extraHit 不允许设置 multiplier

### Requirement: kn 生成

- WHEN 普通 Buff 进入当前 hit 计算
- THEN 系统读取原始值 `n`
- AND 读取当前按钮系数 `k`
- AND 生成有效值 `kn`
- AND 上游快照不提前保存 `kn`

### Requirement: Countable 保持可用

- WHEN Buff 为 countable
- THEN 当前层数继续作为 `k`
- AND 有效值继续为 `kn`
- AND 原有加层、减层、上限、保存和恢复行为保持可用

### Requirement: 两阶段分离

- WHEN 一个 countable 普通 Buff 参与伤害计算
- THEN 系统先根据按钮层数生成该 Buff 的 `kn`
- AND 再使用原有 hit 命中逻辑判断该 `kn` 是否进入当前乘区
- AND multiplier 匹配与乘区乘积在第二阶段完成
- AND 两个阶段不得通过提前修改 all-buff-list.value 合并

### Requirement: 五类乘区

- WHEN 某乘区存在普通 Buff 和 multiplier Buff
- THEN 普通 Buff 的 `kn` 进入括号内加算和
- AND multiplier Buff 的 coefficient 进入括号外乘积
- AND 两类贡献使用相同的 type 匹配规则
- AND multiplier 命中后作用于当前 hit 的整个对应乘区
- AND 不只作用于与 multiplier 引用 type 同名的普通 Buff

#### Scenario: 寒冷脆弱 Multiplier 放大法术脆弱

- WHEN 当前 hit 为寒冷
- AND 存在法术脆弱普通加算 `0.20`
- AND 存在寒冷脆弱 multiplier `1.10`
- AND 没有寒冷脆弱普通加算
- THEN 法术脆弱按原命中规则进入当前 hit 的脆弱加算和
- AND 寒冷脆弱 multiplier 按原命中规则进入当前 hit 的脆弱乘算积
- AND 最终脆弱区为 `1.10 × (1 + 0.20) = 1.32`

#### Scenario: 两个 Multiplier 同时命中

- WHEN 当前 hit 为寒冷
- AND 存在法术脆弱 multiplier `1.10`
- AND 存在寒冷脆弱 multiplier `1.10`
- AND 存在法术脆弱普通加算 `0.20`
- THEN 两个 multiplier 均进入当前 hit 的脆弱乘算积
- AND 最终脆弱区为 `1.10 × 1.10 × (1 + 0.20) = 1.452`

#### Scenario: 两层普通脆弱与两个 Multiplier

- WHEN 法术脆弱普通加算每层为 `0.20`
- AND 当前层数为 `2`
- AND 当前寒冷 hit 同时命中法术脆弱 multiplier `1.10`
- AND 当前寒冷 hit 同时命中寒冷脆弱 multiplier `1.10`
- THEN Stage 1 生成法术脆弱有效值 `0.40`
- AND Stage 2 生成脆弱区 `1.10 × 1.10 × (1 + 0.40) = 1.694`

### Requirement: SessionStorage

- WHEN 新 Buff 数据进入运行时模板、配置快照、候选列表和 all-buff-list
- THEN multiplier 标识必须完整保留
- AND 不得被压平成普通标量总数
- AND 旧数据可以自动兼容或迁移

### Requirement: 统一消费

- WHEN 普通 hit、异常 hit、额外 hit、伤害详情、报表和 Excel 消费相同输入
- THEN 五类乘区结果一致
- AND 实际贡献来源一致

## Acceptance Criteria

- multiplier 是 Buff 附加标识，不是新的 `effectKind`。
- multiplier 继续引用现有 Buff type。
- 不新增平行 multiplier type 字段。
- Operator Studio 能产出 multiplier 标识。
- 普通 Buff 默认 `k=1`。
- countable 层数继续作为 `k`。
- 普通 Buff 有效贡献为 `kn`。
- multiplier Buff 使用独立 coefficient，不复用普通 value。
- multiplier 与 countable 不允许同时设置在同一个 Buff 定义上。
- `kn` 解析与 hit 级乘区聚合在两个阶段完成。
- `kn` 不回写 all-buff-list 或 skill-button。
- multiplier 引用 type 只决定命中范围，命中后作用于当前 hit 的整个对应乘区。
- 寒冷脆弱 multiplier 可以放大同一寒冷 hit 命中的法术脆弱。
- 法术脆弱和寒冷脆弱 multiplier 同时命中寒冷 hit 时独立相乘。
- 两层 `20%` 法术脆弱与两个 `1.10` multiplier 的脆弱区结果为 `1.694`。
- 伤害加成、易伤、脆弱、增幅和技能倍率支持独立乘算。
- 现有元素、法术、物理和技能类型命中规则保持不变。
- 其他乘区不受本轮影响。
- all-buff-list 快照层继续保留。
- Buff 相关 sessionStorage 能保存 multiplier 标识。
- 旧 Buff、旧 countable、旧排轴和旧分享数据可兼容。
- 普通 hit、异常 hit、额外 hit、报表和 Excel 使用统一结果。
- 没有 multiplier 时历史伤害结果保持一致。
- 项目构建通过。

## Feasibility Assessment

### Conclusion

本方案可实施，且可以在保留现有命中匹配逻辑、all-buff-list 快照层和 countable 交互的前提下完成。

现有代码已经具备以下基础：

- Buff 使用稳定 `type` 标识作用字段。
- 普通 hit 已在计算前按 target 过滤 Buff。
- 元素、法术通用、物理和技能类型已有明确匹配函数。
- countable 已有 `value × stackCount` 的有效值计算。
- 技能倍率区已有加算与乘算并存的局部实现。
- all-buff-list 与 skill-button 已经分离定义和按钮实例状态。
- 时间轴快照和分享已经同时携带 allBuffList 与 skillButtonTable。

因此本轮不需要推翻现有数据模型，只需要：

1. 给 Buff 定义增加 multiplier coefficient。
2. 保留普通 Buff 的单条 `kn` 贡献。
3. 将五类乘区输出从标量升级为结构化结果。
4. 统一所有伤害消费端。

### Existing Passive Boundary

当前 `operatorPanelCalculator` 只会把 `passive` Buff 提前合并到面板 `totals` 和 `DamageBonusSnapshot`。

按钮运行时计算关注的 `condition/countable` Buff 不进入该面板汇总，因此本轮不存在“同一运行时 Buff 既进入面板、又进入按钮 Buff 链路”的结构性阻塞。

现有边界 SHALL 保持：

```text
passive
→ 面板计算

condition / countable
→ CandidateBuff
→ all-buff-list
→ skill-button
→ hit 计算
```

本轮只需保证：

- multiplier 不被当作普通 passive 加算压入面板 totals。
- condition/countable 的 multiplier 定义完整进入运行时 Buff 链路。
- 普通 passive 的现有面板计算行为保持不变。
- 不扩大本轮范围去重构 passive 面板计算。

### Compatibility Feasibility

兼容旧数据可通过默认值完成：

```text
缺少 multiplier
→ 按普通 Buff 处理

缺少 buffStackCounts
→ 普通 Buff k=1
→ countable 沿用现有 maxStacks 兼容规则
```

现有 buffId、selectedBuff、refCount 和禁用列表不需要重建。

旧 `multiplierMultiplier` 需要一次明确迁移或兼容适配，但无需改写用户来源数据。

### Performance

当前每个按钮和 hit 的 Buff 数量较小。由标量汇总改为贡献数组和五区聚合，不会形成明显性能瓶颈。

实现时应保证：

- 每个 hit 只进行一次 Buff 匹配。
- 匹配结果同时生成普通贡献和 multiplier 贡献。
- UI、报表和 Excel 复用结果，不重复扫描和聚合。

## Development Breakdown

以下是建议的开发分项和依赖顺序。本节是架构拆分，不是独立 tasks 文件。

### Phase 1: Shared Buff Contract

目标：先建立所有链路共同使用的数据契约。

修改范围：

- `BuffCalculationMeta` 或等价类型。
- `CandidateBuff`。
- `SkillButtonBuff`。
- Operator Studio Buff 类型。
- Runtime Operator Template Buff 类型。
- ConfigSnapshot 中的 Buff 类型。

需要完成：

- 增加 multiplier coefficient。
- multiplier 与 countable 互斥校验。
- 定义五类允许 multiplier 的 type 注册。
- 保持 `effectKind=modifier/extraHit`。
- 将 multiplier 纳入 Buff 身份签名。

完成标准：

- 同一个 type 可以分别表示普通 Buff 和 multiplier Buff。
- 两者不会被去重逻辑错误归并。

### Phase 2: Operator Studio Producer

目标：让 Operator Studio 成为第一条完整可写链路。

修改范围：

- Operator Studio 类型、默认值和编辑 UI。
- 草稿标准化。
- 保存、读取、导入和导出。
- AI CLI Operator Adapter。
- Operator Studio 校验。

需要完成：

- multiplier 开关或类型标识。
- coefficient 输入。
- multiplier 可选 type 白名单。
- extraHit 禁止 multiplier。
- countable 禁止 multiplier。

完成标准：

- Studio 保存后重新打开，multiplier 定义不丢失。
- multiplier coefficient 不进入普通 value。

### Phase 3: Upstream Propagation

目标：确保 multiplier 语义不会在到达主界面前丢失。

修改范围：

- `operatorTemplateAdapter`。
- runtime template sessionStorage。
- `operatorPanelCalculator` 和 ConfigSnapshot。
- `operatorConfigCandidateBuffService`。
- Candidate Buff repository。

需要完成：

- 完整复制 multiplier 定义。
- condition/countable multiplier 不进入普通面板 totals。
- condition/countable 五类 Buff 保留可追踪定义。
- 保持现有 passive 面板汇总边界。

完成标准：

- Operator Studio 创建的 multiplier 能完整出现在 CandidateBuff。
- 配置页快照中仍能找到其 type 和 coefficient。

### Phase 4: SessionStorage And Snapshot Compatibility

目标：升级运行时持久化和分享链路。

修改范围：

- storage keys 或 schema version。
- Buff repository 读取标准化。
- Candidate repository 读取标准化。
- Skill button repository 兼容。
- Timeline snapshot。
- Local data bridge。
- 分享导入导出。

需要完成：

- 新结构读写 multiplier。
- 旧数据缺省 multiplier。
- 兼容旧 `multiplierMultiplier`。
- 保留 buffId、selectedBuff、refCount 和禁用关系。

完成标准：

- 刷新、存档恢复和分享导入后 multiplier 不丢失。
- 旧存档无需用户手工迁移。

### Phase 5: Stage 1 Buff Instance Resolution

目标：独立完成单 Buff 的 `n/k/kn` 解析。

修改范围：

- 现有 `getBuffEffectiveValue` 或其替代模块。
- countable 层数读取。
- Applied Buff 展示模型。

需要完成：

- 普通 Buff 默认 `k=1`。
- countable 使用当前 stackCount。
- 输出 rawValue、coefficient 和 effectiveValue。
- multiplier 不进入普通 `kn` 加算。

完成标准：

- `20% × 2层 = 40%` 能独立验证。
- 该阶段不执行 hit 元素或技能类型聚合。

### Phase 6: Stage 2 Hit Zone Aggregation

目标：复用原命中逻辑，建立统一五区聚合器。

修改范围：

- Buff target 匹配。
- 元素/法术/物理/技能类型匹配。
- `calculateElementDmgBonus`。
- `calculateSkillDmgBonus`。
- fragile、vulnerability、amplify。
- skill multiplier。
- `DamageZones` 和 multiplier result 类型。

需要完成：

- 单次 hit 匹配生成贡献。
- 普通 Buff `kn` 进入 additiveTotal。
- multiplier coefficient 进入 multiplierProduct。
- multiplier 命中后作用于整个 hit 乘区。
- 五类乘区输出结构化结果。

完成标准：

```text
2层法术脆弱 20%
+ 法术脆弱 multiplier 1.1
+ 寒冷脆弱 multiplier 1.1
→ 寒冷 hit 脆弱区 1.694
```

### Phase 7: Normal, Anomaly And Extra-Hit Integration

目标：所有伤害入口使用同一聚合结果。

修改范围：

- 普通技能伤害计算。
- 异常伤害计算。
- Buff 额外 hit。
- 燃烧和 Dot 分支。

需要完成：

- 删除消费端的 `1 + rate` 自行拼装。
- 删除消费端专用的 multiplier 聚合。
- 统一乘区顺序。

完成标准：

- 相同 hit 上下文在三条伤害链路得到相同五区值。

### Phase 8: Presentation And Export

目标：展示和导出复用核心结果。

修改范围：

- Skill damage modal view model。
- 异常伤害详情。
- Damage Sheet。
- Damage Report。
- Excel Export。

需要完成：

- 展示普通 Buff 的 `n/k/kn`。
- 展示 multiplier coefficient。
- 展示 additiveTotal、multiplierProduct 和 finalValue。
- Excel 公式反映两阶段链路。
- 不再通过最终值反推 multiplier。

完成标准：

- UI、报表和 Excel 对同一个 hit 展示一致公式和结果。

### Phase 9: Legacy Cleanup

目标：消除双计算权威。

候选范围：

- 旧 `multiplierMultiplier` 专用分支。
- 未被引用的 `CanvasBoard/SkillButtonBuffCalculator`。
- AI validator 中把倍率文本改写为 `multiplierMultiplier` 的旧规则。
- 重复的报表和异常伤害公式。

清理必须在新链路完整接管后执行，不能提前删除兼容入口。

## Recommended Implementation Boundary

建议将一次可合并开发控制在以下边界：

```text
共享类型与注册表
→ Operator Studio 产出
→ 上游快照透传
→ sessionStorage 兼容
→ 核心两阶段计算
→ 三条伤害链路
→ 展示与导出
→ 旧逻辑清理
```

不建议把本轮拆成“只改公式”和“之后再改存储”两个可独立上线的版本。公式先上线但存储和上游未透传时，multiplier 会在页面切换或刷新后丢失；存储先上线但计算未接管时，则会出现可编辑但不生效的数据。

## Risks

- 现有多处分别维护 Buff type 白名单，可能出现某入口能写入但不能计算。
- 普通 hit、异常 hit、额外 hit、报表和 Excel 当前存在重复公式。
- multiplier coefficient 若在上游适配中被压回普通 `value`，会重新产生数值语义混乱。
- 如果配置页快照继续只保存标量 totals，multiplier 语义会在到达主界面前丢失。
- Buff 身份签名必须包含 multiplier 标识，否则普通 Buff 和 multiplier Buff 可能被错误归并。

## Open Questions

- multiplier 标识最终字段名采用 `multiplier`、`isMultiplier` 还是其他名称。
- 技能倍率统一引用字段最终使用现有 `multiplierBonus`，还是改为更中性的字段名。
- 是否在本轮移除未被引用的旧 `CanvasBoard/SkillButtonBuffCalculator`。
