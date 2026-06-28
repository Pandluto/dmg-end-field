# 黄金案例 — 数据填写参考

> 外部 agent 填写 Weapon / Operator fill 时的标准模板。每个案例包含源数据 → 正确填法 → 常见错误。

---

## 1. 武器叠层 — 赤缨 (chiying)

**源数据描述：** "装备者造成猛击时，根据消耗的最大破防层数，每层使自身物理伤害+6.0%。同名效果最多叠加4层。"

**正确填法（skill3.effects）：**

```json
"effect3": {
  "name": "物理伤害强化·1层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.06, "2": 0.07, "3": 0.08, "4": 0.09, "5": 0.10, "6": 0.11, "7": 0.12, "8": 0.13, "9": 0.15}
},
"effect4": {
  "name": "物理伤害强化·2层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.12, "2": 0.14, "3": 0.16, "4": 0.18, "5": 0.20, "6": 0.22, "7": 0.24, "8": 0.26, "9": 0.30}
},
"effect5": {
  "name": "物理伤害强化·3层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.18, "2": 0.21, "3": 0.24, "4": 0.27, "5": 0.30, "6": 0.33, "7": 0.36, "8": 0.39, "9": 0.45}
},
"effect6": {
  "name": "物理伤害强化·4层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.24, "2": 0.28, "3": 0.32, "4": 0.36, "5": 0.40, "6": 0.44, "7": 0.48, "8": 0.52, "9": 0.60}
}
```

**规则：** N 层值 = N × 单层值。effect3 单层 6%，effect6 四层 24% = 4 × 6%。

**❌ 常见错误：** 只写一个 effect `"物理伤害强化"`，不拆层。

---

## 2. 武器叠层 — 热熔切割器 (rerongqiegeqi)

**源数据描述：** "全队攻击力+X%，同名效果最多叠加2层。"

**正确填法（skill3.effects）：**

```json
"effect1": {
  "name": "攻击力提升",
  "type": "atkPercentBoost",
  "category": "passive",
  "levels": {"1": 0.10, "2": 0.12, "3": 0.14, "4": 0.16, "5": 0.18, "6": 0.20, "7": 0.22, "8": 0.24, "9": 0.28}
},
"effect2": {
  "name": "全队攻击力提升·1层",
  "type": "atkPercentBoost",
  "category": "condition",
  "levels": {"1": 0.05, "2": 0.06, "3": 0.07, "4": 0.08, "5": 0.09, "6": 0.10, "7": 0.11, "8": 0.12, "9": 0.14}
},
"effect3": {
  "name": "全队攻击力提升·2层",
  "type": "atkPercentBoost",
  "category": "condition",
  "levels": {"1": 0.10, "2": 0.12, "3": 0.14, "4": 0.16, "5": 0.18, "6": 0.20, "7": 0.22, "8": 0.24, "9": 0.28}
}
```

**注意：** effect1 是被动自加成（passive），effect2/3 是条件触发叠层（condition），各自的 category 要区分。

**❌ 常见错误：** effect2 写成 `"全队攻击力提升"` 不标层数，value 取单层值。

---

## 3. 干员 Buff 叠层（≤4层）— 手动拆 effect

**源数据：** 天赋"活着的旗帜"每层 ATK+8%、源石技艺+8，最多 3 层。潜能 3 "战旗飘扬时"最大层数+2（共 5 层）。

**正确填法（buffs）：** 3 层基础拆 6 个 effect，2 层潜能拆 4 个 effect。

```json
"buffs": {
  "talent": {
    "effects": {
      "effect1": {"name": " 活着的旗帜1层，攻击力+8%",     "type": "atkPercentBoost",   "category": "condition", "value": 0.08, "unit": "percent"},
      "effect2": {"name": " 活着的旗帜2层，攻击力+16%",    "type": "atkPercentBoost",   "category": "condition", "value": 0.16, "unit": "percent"},
      "effect3": {"name": " 活着的旗帜3层，攻击力+24%",    "type": "atkPercentBoost",   "category": "condition", "value": 0.24, "unit": "percent"},
      "effect4": {"name": " 活着的旗帜1层，源石技艺+8",    "type": "sourceSkillBoost",  "category": "condition", "value": 8,    "unit": "flat"},
      "effect5": {"name": " 活着的旗帜2层，源石技艺+16",   "type": "sourceSkillBoost",  "category": "condition", "value": 16,   "unit": "flat"},
      "effect6": {"name": " 活着的旗帜3层，源石技艺+24",   "type": "sourceSkillBoost",  "category": "condition", "value": 24,   "unit": "flat"}
    }
  },
  "potential": {
    "effects": {
      "effect1": {"name": " 行军(潜能2)-意志+20",         "type": "willBoost",         "category": "condition", "value": 20,   "unit": "flat"},
      "effect2": {"name": " 行军(潜能2)-物理伤害+10%",     "type": "physicalDmgBonus",  "category": "condition", "value": 0.1,  "unit": "percent"},
      "effect3": {"name": " 战旗飘扬时(潜能3)-旗帜4层，攻击力+32%",  "type": "atkPercentBoost",  "category": "condition", "value": 0.32, "unit": "percent"},
      "effect4": {"name": " 战旗飘扬时(潜能3)-旗帜5层，攻击力+40%",  "type": "atkPercentBoost",  "category": "condition", "value": 0.40, "unit": "percent"},
      "effect5": {"name": " 战旗飘扬时(潜能3)-旗帜4层，源石技艺+32", "type": "sourceSkillBoost", "category": "condition", "value": 32,   "unit": "flat"},
      "effect6": {"name": " 战旗飘扬时(潜能3)-旗帜5层，源石技艺+40", "type": "sourceSkillBoost", "category": "condition", "value": 40,   "unit": "flat"}
    }
  }
}
```

**分界线：≤4 层手动拆 effect。≥5 层用 `countable`（见下一节）。**

**分组规则：**
- talent：天赋突破自带的基础层数（1-3 层）
- potential：靠潜能解锁的额外层数（4-5 层，来自潜能 3）

**❌ 常见错误：**
1. 不拆层，只写一条"攻击力+8%"
2. 4-5 层也塞 talent 里——潜能解锁的必须归 potential
3. 给没有 type 的效果硬编 type（如 CD 缩减映射成 `chainSkillDmgBonus`）

---

## 3b. 干员 Buff 叠层（≥5层）— 用 countable

**规则：5 层及以上直接用一个 `countable` effect，不需要手动拆 N 个！**

**源数据：** 陈千语天赋"斩锋"——技能每次击中敌人后，攻击力+8%，最多叠加 5 层。

**正确填法（使用 countable）：**

```json
"buffs": {
  "talent": {
    "effects": {
      "zhanfeng": {
        "effectId": "zhanfeng",
        "name": "斩锋",
        "type": "atkPercentBoost",
        "category": "countable",
        "value": 0.08,
        "maxStacks": 5,
        "unit": "percent",
        "valueMode": "fixed",
        "description": "技能每次击中敌人后，攻击力+8%，持续10秒，该效果最多增加5层。"
      }
    }
  }
}
```

**countable 关键规则：**

| 字段 | 说明 |
|------|------|
| `category` | `"countable"` |
| `value` | **每层**的值（非累计），如 0.08 表示每层 +8% |
| `maxStacks` | 最大叠加层数 |
| `valueMode` | 只能是 `"fixed"`，不支持 `derivedValue` |

**vs 旧做法对比：**
- 旧：斩锋 5 层需手动拆 5 个 effect
- 新：斩锋 1 个 countable 搞定

**❌ 常见错误：** 5 层及以上仍手动拆——代码冗余，且更容易出错。

---

## 4. 不确定的 type 不入库

**规则：** 先用 `weapon.fill.task` 或 `operator.fill.task` 查 `supportedEffectTypes`。列表中不存在的 type 不填。

**骏卫被跳过入的潜能：**

| 潜能 | 效果 | 跳过原因 |
|------|------|----------|
| 1. 阵线扫荡 | 返还 15 技力 | 回能效果，无对应 type |
| 3. 战旗飘扬时 | 层数+2、技力降至 60 | 层数变化已体现在叠层；技力变化无 type |
| 4. 塔卫二之盾 | 终结技能量-15% | 能量消耗降低 ≠ `ultimateChargeEfficiency` |
| 5. 新铸剑锋 | CD-2s、回能×1.2 | CD/回能倍率无对应 type |

**陈千语被跳过入的天赋：**

| 天赋 | 效果 | 跳过原因 |
|------|------|----------|
| 破势 | 造成 10 点失衡 | 固定值失衡施加，无对应 type |

**❌ 错误映射：** 
- CD 缩减 → `chainSkillDmgBonus`，能量降低 → `ultimateChargeEfficiency`。这些 type 意思是"伤害/充能效率加成"，跟"消耗减少"不同。
- **造成X点失衡 → `imbalanceDmgBonus`**。`imbalanceDmgBonus` 是"失衡伤害加成%"，不是"施加固定值失衡"。两者完全不同。

---

## 5. 武器叠层 — 典范 (dianfan)

**源数据描述：** "物理伤害+10.0%。装备者的战技和终结技命中敌人时，物理伤害额外+10.0%，持续30秒。同名效果最多叠加3层，每层单独计算持续时间，每0.1秒最多触发一次。"

**正确填法（skill3.effects）：**

```json
"effect1": {
  "name": "物理伤害提升",
  "type": "physicalDmgBonus",
  "category": "passive",
  "levels": {"1": 0.10, "2": 0.12, "3": 0.14, "4": 0.16, "5": 0.18, "6": 0.20, "7": 0.22, "8": 0.24, "9": 0.28}
},
"effect2": {
  "name": "物理伤害强化·1层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.10, "2": 0.12, "3": 0.14, "4": 0.16, "5": 0.18, "6": 0.20, "7": 0.22, "8": 0.24, "9": 0.28}
},
"effect3": {
  "name": "物理伤害强化·2层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.20, "2": 0.24, "3": 0.28, "4": 0.32, "5": 0.36, "6": 0.40, "7": 0.44, "8": 0.48, "9": 0.56}
},
"effect4": {
  "name": "物理伤害强化·3层",
  "type": "physicalDmgBonus",
  "category": "condition",
  "levels": {"1": 0.30, "2": 0.36, "3": 0.42, "4": 0.48, "5": 0.54, "6": 0.60, "7": 0.66, "8": 0.72, "9": 0.84}
}
```

**设计要点：**
- effect1 是**基础被动**（passive）：武器始终提供的物理伤害加成
- effect2~4 是**条件触发叠层**（condition）：战技/终结技命中后逐层叠加，每层独立计时
- 同名效果（物理伤害额外+X%）最多 3 层 → 拆成 effect2/effect3/effect4
- N 层值 = N × 单层值（单层 10% → 3 层 = 30%）

**❌ 常见错误：** 叠层效果不拆，只写一个 "物理伤害强化"。

---

## 6. 技能倍率填写

**规则：** 从源数据表逐级填入 L1~M3（12 级），不全部填 M3 值。

**正确（骏卫 全面攻势 hit1）：**
```json
"L1": 0.23, "L2": 0.25, "L3": 0.28, "L4": 0.30, "L5": 0.32,
"L6": 0.35, "L7": 0.37, "L8": 0.39, "L9": 0.41,
"M1": 0.44, "M2": 0.48, "M3": 0.52
```

**❌ 错误：** 全填 M3 值（`"L1": 0.52, "L2": 0.52, ...`），各等级无差异。

---

## 7. 处决/下落独立成技能

**规则：** 处决（execute）和下落攻击（plunge）必须各自独立为一个 A 技能，不能作为普通攻击的额外 hit。

**正确（洁尔佩塔）：**
```
skill-1 (A): 秘杖·束能技艺 — 4 hits（仅普攻段数）
skill-5 (A): 处决 — 1 hit
skill-6 (A): 下落攻击 — 1 hit
```

**❌ 错误：** 处决和下落塞进 skill-1 当 hit5/hit6。

---

## 8. Operator Buff Category 判断

**规则：** 有触发条件 → `condition`，无条件常驻 → `passive`。

**正确（佩丽卡）：**
```json
// 歼灭协议：对失衡的敌人伤害+30% → condition（需要目标失衡）
{"name":"歼灭协议·突破2", "type":"imbalanceDmgBonus", "category":"condition", "value":0.30}

// 监督重任：施加导电后攻击力+20% → condition（需要触发导电）
{"name":"监督重任·1层", "type":"atkPercentBoost", "category":"condition", "value":0.20}

// 再入控制：终结技暴击率+30% → condition（限定终结技）
{"name":"再入控制", "type":"critRateBoost", "category":"condition", "value":0.30}
```

**判断标准：** 描述中有"对XX敌人/当XX时/XX技能"等限定词 → `condition`。仅"全队/自身+XXX"无前置条件 → `passive`。

**❌ 错误：** 佩丽卡首次提交全部标 `positive`。`positive` 只是历史兼容输入，新数据不要再使用。

---

## 9. 武器 skill 结构 — 属性技能 vs 特效技能

**规则：** 武器三个 skill 分工不同：
- **skill1**（主属性，如 力量提升·大 / 敏捷提升·大）：`effects` 为空，数值放 `levels`
- **skill2**（副属性，如 攻击提升·大 / 终结技充能效率提升·大）：`effects` 为空，数值放 `levels`
- **skill3**（武器特效，如 巧技·赤断 / 效益·灯火灼身）：`effects` 存特殊词条，`levels` 存各等级描述

**正确结构（对标赤缨）：**

```json
"skill1": {
  "name": "敏捷提升·大",
  "statType": "敏捷提升",
  "effects": {},
  "levels": {
    "1": {"value": 20, "description": "敏捷+20"},
    "2": {"value": 36, "description": "敏捷+36"},
    "9": {"value": 156, "description": "敏捷+156"}
  }
},
"skill2": {
  "name": "终结技充能效率提升·大",
  "statType": "终结技充能效率提升",
  "effects": {},
  "levels": {
    "1": {"value": 6.0, "description": "终结技充能效率+6.0%"},
    "9": {"value": 46.4, "description": "终结技充能效率+46.4%"}
  }
},
"skill3": {
  "name": "效益·灯火灼身",
  "statType": "special",
  "effects": {
    "effect1": {"name": "灯火灼身·灼热伤害", "type": "fireDmgBonus", "category": "passive", ...}
  },
  "levels": {
    "1": {"description": "灼热伤害+7.0%。装备者通过自身技能..."}
  }
}
```

**❌ 常见错误：** 把主属性和副属性的数值塞进 skill3.effects 的 effect1/effect2，导致：
- skill1.levels 和 skill2.levels 全空
- skill3.effects 里混入了不属于特效的 stat 词条
- 前端渲染时主副属性显示为空

> 灯火使命首次提交就犯了这个错，skill3 有 7 个 effect（含敏捷和充能效率），正确是 5 个。
