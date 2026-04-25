# 开发修改 0.2.11 - 干员 Buff 数据生成

## 概述

为每个干员生成独立的 `xxxbuff.json` 文件，扫描 `xxx.json` 中的所有 Buff 效果字段，形成结构化的 Buff 数据供排轴模拟和伤害计算使用。

---

## 数据源

```
public/data/characters/
└── {角色名}/
    ├── {角色名}.json          # 原始完整数据
    └── {角色名}max.json      # 满配精简数据（9级 / M3两级）
```

---

## 输出文件结构

### 文件位置

```
public/data/characters/{角色名}/
├── {角色名}.json          # 原始数据
├── {角色名}max.json        # 满配数据
└── {角色名}buff.json       # Buff 数据（新增）
```

### JSON 结构

```json
{
  "name": "角色名",
  "buffList": [
    "buff类型-角色名",
    "可叠加buff类型-角色名-1层",
    "可叠加buff类型-角色名-专3-1层"
  ],
  "buffs": [
    {
      "displayName": "buff类型-角色名",
      "name": "Buff名称",
      "source": "talent/potential/skill",
      "sourceName": "技能类型-技能名 / 天赋-天赋名 / 潜能等级-潜能名",
      "type": "buff类型",
      "value": 数值,
      "level": "9" | "M3" | "breakthrough1/2/3" | "potentials-x",
      "description": "触发条件描述",
      "condition": "触发条件（如有）"
    }
  ]
}
```

### Buff 类型枚举

| type | 说明 |
|------|------|
| `physicalDmgBonus` | 物理伤害加成 |
| `magicDmgBonus` | 法术伤害加成 |
| `fireDmgBonus` | 灼热伤害加成 |
| `electricDmgBonus` | 电磁伤害加成 |
| `iceDmgBonus` | 寒冷伤害加成 |
| `natureDmgBonus` | 自然伤害加成 |
| `allElementDmgBonus` | 全元素伤害加成（Buff 侧） |
| `skillDmgBonus` | 战技伤害加成 |
| `chainSkillDmgBonus` | 连携技伤害加成 |
| `ultimateDmgBonus` | 终结技伤害加成 |
| `normalAttackDmgBonus` | 普攻伤害加成 |
| `physicalRes` | 物理抗性 |
| `fireRes` | 灼热抗性 |
| `electricRes` | 电磁抗性 |
| `iceRes` | 寒冷抗性 |
| `natureRes` | 自然抗性 |
| `voidRes` | 超域抗性 |
| `healingBonus` | 治疗效率加成 |
| `incomingHealingBonus` | 受治疗效率加成 |
| `chainSkillCdr` | 连携技冷却缩减 |
| `energyGain` | 终结技能量获得 |
| `ultimateChargeEfficiency` | 终结技充能效率 |
| `imbalanceEfficiency` | 失衡效率加成 |
| `critRateBoost` | 暴击率提升 |
| `critDmgBonusBoost` | 暴击伤害提升 |
| `physicalVulnerability` | 物理脆弱 |
| `fireVulnerability` | 灼热脆弱 |
| `electricVulnerability` | 电磁脆弱 |
| `iceVulnerability` | 寒冷脆弱 |
| `natureVulnerability` | 自然易伤 |
| `magicVulnerability` | 法术脆弱（历史/待兼容字段，当前运行时不作为推荐输出） |
| `physicalAmplify` | 物理增幅 |
| `fireAmplify` | 灼热增幅 |
| `electricAmplify` | 电磁增幅 |
| `iceAmplify` | 寒冷增幅 |
| `natureAmplify` | 自然增幅 |
| `magicAmplify` | 法术增幅 |
| `comboDamageBonus` | 连击增伤 |
| `atkPercentBoost` | 攻击力百分比提升 |
| `strengthBoost` | 力量属性提升 |
| `agilityBoost` | 敏捷属性提升 |
| `intelligenceBoost` | 智识属性提升 |
| `willBoost` | 意志属性提升 |
| `multiplierBonus` | 伤害倍率提升（字段） |
| `multiplierMultiplier` | 伤害倍率乘倍 |
| `magicTakenDmgBonus` | 法术易伤 |

| `mainStatBoost` | 主能力提升 |
| `subStatBoost` | 副能力提升 |
| `allStatBoost` | 全能力提升 |
| `sourceSkillBoost` | 源石技艺强度提升 |

说明：

- `增幅区` 为独立乘区，和 `脆弱区 / 易伤区` 同级，不并入 `伤害加成区`。
- 当前代码口径：
  - `physical` 伤害只命中 `physicalAmplify`
  - 元素伤害命中 `对应元素Amplify + magicAmplify`
- 多个增幅 Buff 直接相加，最终按 `× (1 + amplifyRate)` 参与计算。
- 当前字段口径补充：
  - `allElementDmgBonus` 是 Buff 侧“全元素伤害加成”正式字段
  - `allDmgBonus` 属于面板 / `infoSnap` 侧字段，不作为当前 Buff type 推荐输出
  - `magicTakenDmgBonus` 为“法术易伤”正式字段
  - `magicVulnerability` 仅保留历史语义说明，当前运行时不建议继续生成该 type

---

## 生成规则

### 1. 核心原则（以手工校正为准）

1. `buffList` 是当前角色的**目标输出清单**，属于人工校正后的权威结构。  
2. `buffs` 必须与 `buffList` **一一对应**（每个 displayName 都有且仅有一条对应记录）。  
3. 若自动扫描结果与 `buffList` 冲突，以 `buffList` 的命名与粒度为准重写。  
4. 允许只保留业务需要的条目，不强制“全量字段全保留”。  
5. 六星角色（`rarity = 6`）的潜能 Buff 默认不纳入 `buffs`。  
6. 天赋 Buff 仅保留该角色当前可用的最高级（最高突破）版本。  

### 2. 来源识别

| 来源 | source 值 | 说明 |
|------|----------|------|
| 天赋 | `talent` | talents 数组中的效果 |
| 潜能 | `potential` | potentials 数组中的效果 |
| 技能 | `skill` | skills 中的 normalAttack/skill/chainSkill/ultimate |

### 3. 等级字段规范

- 天赋突破用：`breakthrough1 / breakthrough2 / breakthrough3`
- 技能专精用：`M3`
- 潜能定点用：`potentials-1 / potentials-2 / potentials-3 ...`
- 默认值可用：`9`

### 4. displayName 命名策略

按“业务语义优先”命名，可包含以下维度：

- 来源语义：如 `-本质瓦解`、`-权能映射`、`-潜能`
- 场景语义：如 `-图腾结束`、`-图腾提前结束`
- 叠层语义：如 `-1层`、`-2层`、`-3层`、`-4层`
- 专精语义：如 `-专3-1层`、`-M3`

### 5. 叠层与分化规则

1. 叠层条目用**多条独立 Buff**表达，不新增额外“叠层键”结构。  
2. 多触发场景（如图腾结束/提前结束）必须拆分为不同 displayName。  
3. 多等级场景（9级/M3）必须拆分为不同 displayName。  

### 6. 条件字段

存在触发条件时，必须在 `condition` 中明确写出（如“叠满5层”“图腾提前结束”“破防3层”）。

---

## 当前构思落地示例

### 示例 A：管理员（来源语义 + 场景语义 + 专3分化）

```json
{
  "name": "管理员",
  "buffList": [
    "攻击力百分比提升-管理员-本质瓦解",
    "攻击力百分比提升-管理员-权能映射",
    "额外倍率-管理员-战技",
    "额外倍率-管理员-终结技",
    "额外倍率-管理员-战技-专3",
    "额外倍率-管理员-终结技-专3"
  ]
}
```

### 示例 B：洁尔佩塔（按破防层数完整展开）

```json
{
  "name": "洁尔佩塔",
  "buffList": [
    "法术脆弱-洁尔佩塔-1层",
    "法术脆弱-洁尔佩塔-2层",
    "法术脆弱-洁尔佩塔-3层",
    "法术脆弱-洁尔佩塔-4层",
    "法术脆弱-洁尔佩塔-专3-1层",
    "法术脆弱-洁尔佩塔-专3-2层",
    "法术脆弱-洁尔佩塔-专3-3层",
    "法术脆弱-洁尔佩塔-专3-4层"
  ]
}
```

### 示例 C：陈千语（收敛到核心决策条目）

```json
{
  "name": "陈千语",
  "buffList": [
    "攻击力百分比提升-陈千语-5层",
    "伤害倍率乘倍-陈千语-潜能",
    "物理伤害加成-陈千语-潜能"
  ]
}
```

### 对应的数值映射说明

1. **陈千语 - 攻击力百分比提升-5层**  
   来源 `斩锋(breakthrough2)` 的 `atkBonusPerStack=0.08`，按 5 层聚合为 `0.40`。  

2. **管理员 - 权能映射**  
   “其他友方干员获得一半攻击力提升”按本质瓦解突破2的 0.30 取半，得到 `0.15`。  

3. **洁尔佩塔 - 法术脆弱分层**  
   - 9级：`baseMagicVulnerability=0.26`，`perBreakMagicVulnerability=0.026`  
   - M3：`baseMagicVulnerability=0.30`，`perBreakMagicVulnerability=0.03`  
   - 按破防1~4层展开为独立条目：`base + perBreak * 层数`

---

## 实现步骤

### 步骤 1：扫描所有干员 json

遍历 `public/data/characters/` 下所有 `{角色名}.json`，提取：

1. `talents` 中所有数值字段
2. `potentials` 中所有 stats 和数值字段
3. `skills` 中各技能的 Buff 效果字段

### 步骤 2：识别 Buff 类型

根据字段名判断 Buff 类型，映射到标准类型枚举。

### 步骤 3：生成独立文件

为每个干员生成 `{角色名}buff.json`，包含：

- 角色基本信息
- `buffs` 数组，包含所有扫描到的 Buff

### 步骤 4：更新文档

在 `docs/reference-skills/` 下新增 `Buff数据规范.md`，记录：

- 字段映射表
- 类型枚举
- 生成规则

---

## 验收标准

- [ ] 为每个干员生成独立的 `xxxbuff.json` 文件
- [ ] `buffList` 为人工校正后的目标清单，`buffs` 与其一一对应
- [ ] Buff 只保留业务需要的条目，不强制全量扫描结果都入库
- [ ] 区分 9 级和 M3 数值（如有差异）
- [ ] 可使用 `breakthroughX` 与 `potentials-X` 等 level 标识
- [ ] 条件 Buff 正确标注触发条件
- [ ] JSON 结构符合规范

---

## 防幻觉约束

| 约束项 | 说明 |
|---|---|
| 数据源 | 仅从 `xxx.json` 扫描，不臆造数据 |
| 清单优先 | 若扫描结果与 `buffList` 冲突，以 `buffList` 命名与粒度为准 |
| 六星潜能过滤 | `rarity=6` 角色默认忽略潜能 Buff |
| 天赋取最高级 | 仅保留天赋最高突破等级的 Buff |
| 字段映射 | 严格按字段参考表映射，不自行创造字段名 |
| 数值精度 | 保持原数据精度，不四舍五入 |
| 条件描述 | 从原数据 description 提取，不改写语义 |
