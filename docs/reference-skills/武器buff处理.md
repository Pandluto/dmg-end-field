# 武器 Buff 处理规范

## 1. 概述

武器 Buff 处理用于把 `{武器名}.json` 中 `skill3` 的条件增益映射为 `buff.json`，供：

- 配置面板 Buff 预览
- 面板加成计算
- 后续伤害模拟引擎消费

当前口径（以赫拉芬格、光荣记忆为基准）：

- 仅处理 `skills.skill3.levels`
- 仅输出条件触发增益
- 常驻增益（如 `allSkillDmgBonus`）不写入 `buffs`
- 存在“最多叠加N层”时，按层数展开为多条 buff

---

## 2. 数据源与输出

### 2.1 输入文件

```
public/data/weapons/{武器名}/{武器名}.json
public/data/weapons/{武器名}/{武器名}max.json
```

### 2.2 输出文件

```
public/data/weapons/{武器名}/{武器名}buff.json
```

---

## 3. 输出结构

```json
{
  "name": "赫拉芬格",
  "buffList": [
    "寒冷伤害加成-赫拉芬格-战技-4",
    "寒冷伤害加成-赫拉芬格-战技-9",
    "寒冷伤害加成-赫拉芬格-连携技-4",
    "寒冷伤害加成-赫拉芬格-连携技-9"  
  ],
  "buffs": [
    {
      "displayName": "寒冷伤害加成-赫拉芬格-战技-4",
      "name": "迸发·切骨之寒",
      "source": "skill",
      "sourceName": "skill3-迸发·切骨之寒",
      "type": "iceDmgBonus",
      "value": 0.16,
      "level": "4",
      "description": "装备者通过战技施加寒冷附着时，获得寒冷伤害+16.0%，持续15秒。",
      "condition": "通过战技施加寒冷附着后触发"
    },
    {
      "displayName": "寒冷伤害加成-赫拉芬格-连携技-9",
      "name": "迸发·切骨之寒",
      "source": "skill",
      "sourceName": "skill3-迸发·切骨之寒",
      "type": "iceDmgBonus",
      "value": 0.56,
      "level": "9",
      "description": "装备者对寒冷附着的敌人造成连携技伤害时，获得寒冷伤害+56.0%，持续15秒。",
      "condition": "对寒冷附着敌人造成连携技伤害后触发"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 武器名 |
| `buffList` | string[] | Buff 主键清单，必须与 `displayName` 完全对应 |
| `buffs` | object[] | Buff 明细列表 |
| `displayName` | string | 唯一键，建议带增益语义、武器名、触发类型、等级；叠层场景追加层数字段 |
| `source` | string | 来源，固定 `skill` |
| `sourceName` | string | 来源定位，建议 `{slot}-{技能名}` |
| `type` | string | 数值类型（示例：`iceDmgBonus`） |
| `value` | number | 实际增益数值（小数制） |
| `level` | string | 等级（如 `4`/`9`） |
| `description` | string | 该条 buff 的原始效果文本 |
| `condition` | string? | 触发条件文本（可选） |

---
### buff参考
### Buff 类型枚举

| type | 说明 |
|------|------|
| `physicalDmgBonus` | 物理伤害加成 |
| `magicDmgBonus` | 法术伤害加成 |
| `fireDmgBonus` | 灼热伤害加成 |
| `electricDmgBonus` | 电磁伤害加成 |
| `iceDmgBonus` | 寒冷伤害加成 |
| `etherDmgBonus` | 自然伤害加成 |
| `allDmgBonus` | 全元素伤害加成 |
| `skillDmgBonus` | 战技伤害加成 |
| `chainSkillDmgBonus` | 连携技伤害加成 |
| `ultimateDmgBonus` | 终结技伤害加成 |
| `normalAttackDmgBonus` | 普攻伤害加成 |
| `physicalRes` | 物理抗性 |
| `fireRes` | 灼热抗性 |
| `electricRes` | 电磁抗性 |
| `iceRes` | 寒冷抗性 |
| `etherRes` | 自然抗性 |
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
| `etherVulnerability` | 自然脆弱 |
| `magicTakenDmgBonus` | 法术易伤 |
| `magicVulnerability` | 法术脆弱（异常/触发语义） |
| `comboDamageBonus` | 连击增伤 |
| `atkPercentBoost` | 攻击力百分比提升 |

| `strengthBoost` | 力量属性提升 |
| `agilityBoost` | 敏捷属性提升 |
| `intelligenceBoost` | 智识属性提升 |
| `willBoost` | 意志属性提升 |

| `mainStatBoost` | 主能力提升 |
| `subStatBoost` | 副能力提升 |
| `allStatBoost` | 全能力提升 |
| `sourceSkillBoost` | 源石技艺强度提升 |

| `multiplierBonus` | 伤害倍率提升 |
| `multiplierMultiplier` | 伤害倍率乘倍 |
## 4. 映射规则

优先级规则：

1. 优先使用 `skills.skill3.levels[level].effects` 结构化字段映射。  
2. 若 `effects` 缺失或不完整，允许从 `description` 提取条件增益并生成 buff。  
3. `description` 与 `effects` 同时存在时，以 `effects` 为准，`description` 仅用于文案与条件还原。  

赫拉芬格示例（结构化映射）：

- 战技触发寒冷增伤：
  - `effects.skillApplyColdDmgBonus -> type: iceDmgBonus`
  - `displayName` 后缀使用 `战技-{level}`
- 连携技触发寒冷增伤：
  - `effects.chainVsColdDmgBonus -> type: iceDmgBonus`
  - `displayName` 后缀使用 `连携技-{level}`
- 常驻全技能增伤：
  - `effects.allSkillDmgBonus` 不进入 `buffs`

光荣记忆示例（description 兜底 + 叠层展开）：

- 条件增益文本：
  - “30秒内的下次终结技期间造成的伤害 +16.8%”
  - “同名效果最多叠加3层”
- 映射结果：
  - `type = ultimateDmgBonus`
  - `baseValue = 0.168`
  - `maxStack = 3`
  - 展开为 1/2/3 层三条 buff，`value` 分别为 `0.168/0.336/0.504`

落草示例（单段文本含两个条件增益）：

- 原文同时包含两条条件效果：
  - “施加寒冷附着时，获得寒冷伤害 +32.0%”
  - “施加法术脆弱时，使目标敌人受到的法术伤害 +9.6%”
- 映射结果：
  - 拆为两条 buff：`寒冷伤害加成(iceDmgBonus)` 与 `法术易伤(magicTakenDmgBonus)`
  - `value` 取条件段数值（`0.32` / `0.096`），不取同等级常驻 `passive` 数值
  - 触发类型后缀使用可读语义（如 `寒冷附着`、`法术脆弱`）

爆破单元示例（单条件 + 常驻干扰项）：

- 原文包含“副能力 +16.0%（常驻）”和“造成法术爆发时，目标受法术伤害 +14.4%（条件）”。
- 映射结果：
  - 常驻副能力不进入 `buffs`
  - 条件段映射为 `magicTakenDmgBonus: 0.144`
  - `displayName` 触发类型使用明确语义（如 `法术爆发`），不使用泛化占位词（如 `条件`）

---

## 5. 生成规则

### 5.1 仅处理 skill3

- 仅扫描 `skills.skill3.levels`
- skill1/skill2 不生成武器 buff
- skill3 等级口径固定按 `4/9` 处理

### 5.2 按触发类型拆分

- 每个等级可输出多条 buff（按触发来源拆分）
- 赫拉芬格当前拆分为：
  - 战技触发一条
  - 连携技触发一条
- 文本提取场景下（无 `effects`）同样按触发来源拆分，不将多个触发语义混在一条 buff
- 若同名效果可叠层，需在每个触发语义下继续按层数展开
- 同一等级内若有多个触发语义，建议按原文出现顺序输出，并保持 `buffList` 与 `buffs` 顺序一致

### 5.3 description 提取规则（effects 缺失时）

- 仅提取“条件触发后生效”的增益，不提取常驻描述。  
- 从描述中抽取三类信息：
  - 触发条件（如“施加破防时”）
  - 生效窗口（如“20秒内/30秒内的下次…”）
  - 增益数值与类型（如“终结技伤害 +33.6% -> ultimateDmgBonus: 0.336”）
- 若文本出现“最多叠加N层”，需额外抽取 `maxStack = N`。
- 若一段文本包含多个条件增益，按触发语义拆分为多条 buff。  
- 若只能确认条件但无法确定标准 `type`，该条不生成，避免错误映射。
- 若同段同时出现“常驻 + 条件”，仅提取条件增益；常驻属性不写入 `buffs`。
- “使目标敌人受到的法术伤害+Y%”语义为“法术易伤”，`type` 使用 `magicTakenDmgBonus`；“法术脆弱”仅在明确表达异常/触发机制时使用 `magicVulnerability`，两者不得混用。

### 5.4 叠层展开规则

- 适用条件：文本中存在“最多叠加N层/可叠加N层”等明确层数。  
- 输出条数：每个等级、每个触发语义，按 `1..N` 层生成 N 条 buff。  
- 数值计算：`layerValue = baseValue * layerIndex`。  
- 命名追加：`displayName` 末尾追加 `-{层数}层`。  
- 条件文案：`condition` 保留触发条件，并明确“最多叠加N层”。

### 5.5 命名规则

建议格式：

`{增益名}-{武器名}-{触发类型}-{level}`

叠层场景建议格式：

`{增益名}-{武器名}-{触发类型}-{level}-{层数}层`

示例：

- `寒冷伤害加成-赫拉芬格-战技-4`
- `寒冷伤害加成-赫拉芬格-连携技-9`
- `终结技伤害加成-光荣记忆-破防-4-2层`
- `寒冷伤害加成-落草-寒冷附着-4`
- `法术易伤-爆破单元-法术爆发-9`

补充约束：

- 触发类型字段必须是可读、可检索的明确语义（如 `寒冷附着`、`法术脆弱`、`法术爆发`）。
- 禁止使用信息不足的占位触发词（如 `条件`、`触发`）作为 `displayName` 触发类型片段。
- 增益名与触发词分离：`法术易伤`用于增益名片段；`法术脆弱`用于触发类型片段，二者不得混用。

---

## 6. 数值规范

- 百分比统一小数（`14.0% -> 0.14`）
- `value` 必须为可计算数值，不使用占位 `0`
- `level` 使用字符串 key（`"3"` / `"9"`）
- 当前武器 skill3 推荐等级键为 `4/9`，不补写不存在的等级
- 不补写数据源不存在的等级
- 叠层场景按层线性展开：如 `base=0.168`、`maxStack=3`，则为 `0.168/0.336/0.504`
- 百分比数值必须来自条件句的“+X%”，不得误用同句或同等级常驻 `passive` 数值
- `value` 必须是合法 JSON 数字并可直接参与计算，禁止异常格式（如前导零整数、拼写错误或量纲放大）

---

## 7. 验收清单

- [ ] 已读取 `{武器名}.json`
- [ ] 已输出 `{武器名}buff.json`
- [ ] `buffList` 与 `buffs.displayName` 一一对应
- [ ] 仅处理 `skill3`
- [ ] `type` 与 `value` 可直接用于计算
- [ ] 每条 `description/condition` 与该条触发类型一致
- [ ] 常驻效果（如 `allSkillDmgBonus`）未写入 buff
- [ ] 百分比全部为小数
- [ ] 叠层场景已按层拆分，且 `buffList` 与各层 `displayName` 完整对应

---

## 8. 防幻觉约束

| 约束项 | 说明 |
|---|---|
| 数据源限定 | 仅使用 `{武器名}.json` 已有字段 |
| 范围限定 | 仅处理 `skills.skill3.levels` |
| 映射限定 | 优先映射 effects；effects 缺失时允许按 description 提取，不臆造数值 |
| 触发拆分 | 战技触发与连携技触发分条输出 |
| 命名语义 | `displayName` 触发类型必须来自原文可复核语义，不使用“条件”等占位词 |
| 叠层约束 | 仅在文本明确给出可叠层数量时展开，层数不得超出原文上限 |
| 等级约束 | 仅输出数据中真实存在且被选用的等级 key |
| 类型口径 | `type` 必须与增益语义一致（如寒冷伤害使用 `iceDmgBonus`、法术易伤使用 `magicTakenDmgBonus`、法术脆弱语义使用 `magicVulnerability`、终结技伤害使用 `ultimateDmgBonus`） |
| 数值口径 | `value` 来自 effects 或 description 条件句明确百分比换算，不写占位值，不使用常驻值替代条件值 |

---

## 9. 变更日志

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.5 | 2026-04-11 | 明确区分法术易伤与法术脆弱 type：新增 `magicTakenDmgBonus`（法术易伤），保留 `magicVulnerability` 仅用于法术脆弱语义 |
| 1.4 | 2026-04-11 | 根据落草/爆破单元反向补充：新增“常驻与条件混合文本”的提取口径、脆弱类映射口径、触发命名禁用占位词与数值合法性约束 |
| 1.3 | 2026-04-10 | 根据光荣记忆buff补充叠层规则：新增“最多叠加N层”的解析、分层展开、命名后缀与数值换算规范 |
| 1.2 | 2026-04-10 | 放宽映射口径：从“仅 effects 映射”升级为“effects 优先，description 可兜底提取”，补充文本提取与约束规则 |
| 1.1 | 2026-04-10 | 按赫拉芬格最新 buff 回写规范：输入改为 `{武器名}.json`，`type/value` 改为可计算数值，按战技/连携技拆分条目，更新命名与验收规则 |
| 1.0 | 2026-04-10 | 初始版本：定义武器 buff 输出结构、条件拆分与验收清单 |
