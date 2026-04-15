---
description: 将角色数据整理为 data/characters 下的标准 json 和 md 文件
---

# 角色导入 SOP

本文档是角色导入任务的标准 SOP。

## 任务目标

将用户提供的角色资料整理为统一结构，并落盘到：
- `data/characters/{角色名}.json`
- `data/characters/{角色名}.md`

其中：
- `json` 是主源
- `md` 必须由 `json` 派生

## 输入要求

可接受输入包括：
- 抓包文本
- 接口返回
- 表格化整理结果
- 用户手动贴出的结构化或半结构化文本

理想情况下应尽量覆盖：
- 基础信息：名称、英文名、稀有度、职业、武器类型、元素、主副属性、标签、定位
- 属性成长：至少关键等级，最好覆盖完整规则需要的等级节点
- 天赋
- 潜能
- 技能倍率

## 输出路径

统一输出到：
- `data/characters/{角色名}.json`
- `data/characters/{角色名}.md`

不要再写到旧路径：
- `characters/`
- 绝对路径目录说明

## 执行步骤

1. 读取用户提供的角色资料
2. 判断是否足以构成单个角色的标准数据
3. 先按字段语义整理原始资料，再映射到标准结构
4. 优先生成 `data/characters/{角色名}.json`
5. 再根据 `json` 生成 `data/characters/{角色名}.md`
6. 校对字段名、数值格式、路径口径

## 基本规则

- 百分比一律转小数
- 等级 key、阶段 key、技能等级 key 保持统一格式
- 不把原始抓包字段直接当最终字段名
- 不臆造未提供的倍率或天赋效果
- 缺失可留空的信息允许留空
- 术语和数值口径优先服从 `Rules/基础知识.md`

## JSON 结构规范

```json
{
  "name": "角色中文名",
  "nameEn": "EnglishName",
  "rarity": 6,
  "profession": "近卫",
  "weapon": "单手剑",
  "element": "physical",
  "mainStat": "敏捷",
  "subStat": "力量",
  "tags": ["标签1", "标签2"],
  "position": ["定位1", "定位2"],
  "attributes": {
    "level1": { "strength": 0, "agility": 0, "intelligence": 0, "will": 0, "atk": 0, "hp": 0 },
    "level20": { ... },
    "level40": { ... },
    "level60": { ... },
    "level80": { ... },
    "level90": { ... }
  },
  "talents": [
    {
      "name": "天赋名",
      "description": "描述",
      "levels": {
        "breakthrough1": { ... },
        "breakthrough2": { ... },
        "breakthrough3": { ... }
      }
    }
  ],
  "potentials": [
    { "id": 1, "name": "潜能名", "description": "条件效果描述" },
    { "id": 2, "name": "潜能名", "description": "敏捷+15，物理伤害+8%", "stats": { "agility": 15, "physicalDmgBonus": 0.08 } }
  ],
  "skills": {
    "normalAttack": {
      "name": "技能名",
      "type": "普通攻击",
      "description": "描述",
      "multipliers": {
        "1": { "hit1": 0.23 },
        "9": { ... },
        "M3": { ... }
      },
      "imbalanceValue": 0
    },
    "skill": {
      "name": "技能名",
      "type": "战技",
      "description": "描述",
      "multipliers": { ... },
      "imbalanceValue": 0,
      "abnormalType": null
    },
    "chainSkill": {
      "name": "技能名",
      "type": "连携技",
      "description": "描述",
      "multipliers": { ... }
    },
    "ultimate": {
      "name": "技能名",
      "type": "终结技",
      "description": "描述",
      "multipliers": { ... },
      "imbalanceValue": 0
    }
  }
}
```

## 标准字段映射

### 元素类型

| 中文 | 英文 |
|------|------|
| 物理 | physical |
| 电磁 | electric |
| 灼热 | fire |
| 寒冷 | ice |
| 自然 | ether |
| 虚无 | void |

### 技能字段

| 类型 | 字段名 |
|------|--------|
| 普通攻击 | `normalAttack` |
| 战技 | `skill` |
| 连携技 | `chainSkill` |
| 终结技 | `ultimate` |

### 异常类型

| 中文 | 英文 |
|------|------|
| 猛击 | slam |
| 击飞 | launch |
| 倒地 | knockdown |
| 碎甲 | shatterArmor |
| 导电 | conductivity |
| 腐蚀 | corrosion |
| 燃烧 | burning |
| 冻结 | freeze |
| 碎冰 | shatterIce |

## 数值格式

- `23%` -> `0.23`
- `400%` -> `4.0`
- 技能等级常见 key：`1` 到 `9`、`M1`、`M2`、`M3`
- 若存在多段命中，保留明确的分段字段，如 `hit1`、`hit2`

## 潜能结构规范

### 无条件生效 vs 条件生效（重要）

角色潜能效果需要区分无条件生效和条件生效：

**无条件生效（stats字段）**：
- 直接加到角色面板
- 有 `stats` 字段
- 参与面板计算
- 例如：敏捷+15、物理伤害+8%

**条件生效**：
- 需要特定条件触发
- 无 `stats` 字段，只有描述
- **只用文字记录在description中，不参与面板计算**
- 例如：对生命值少于50%的敌人伤害+20%

### 潜能 JSON 结构示例

```json
"potentials": [
  {
    "id": 1,
    "name": "绝影",
    "description": "对生命值少于50%的敌人造成的伤害+20%"
  },
  {
    "id": 2,
    "name": "家传武学",
    "description": "敏捷+15，造成的物理伤害+8%",
    "stats": {
      "agility": 15,
      "physicalDmgBonus": 0.08
    }
  },
  {
    "id": 3,
    "name": "双剑奇侠",
    "description": "战技、连携技、终结技的伤害倍率提升至1.1倍"
  },
  {
    "id": 4,
    "name": "自研赤霄剑",
    "description": "终结技所需的终结技能量-15%"
  },
  {
    "id": 5,
    "name": "心兼人间",
    "description": "连携技冷却时间-3秒"
  }
]
```

### stats 字段说明

`stats` 对象支持的属性：

| 字段 | 类型 | 说明 |
|------|------|------|
| `agility` | number | 敏捷加成 |
| `strength` | number | 力量加成 |
| `intelligence` | number | 智识加成 |
| `will` | number | 意志加成 |
| `physicalDmgBonus` | number | 物理伤害加成（小数） |
| `fireDmgBonus` | number | 灼热伤害加成（小数） |
| `electricDmgBonus` | number | 电磁伤害加成（小数） |
| `iceDmgBonus` | number | 寒冷伤害加成（小数） |
| `etherDmgBonus` | number | 自然伤害加成（小数） |
| `ultimateDmgBonus` | number | 终结技伤害加成（小数） |
| `critRate` | number | 暴击率加成（小数） |
| `critDmg` | number | 暴击伤害加成（小数） |
| `atkPercent` | number | 攻击力百分比加成（小数） |

## 缺失信息处理

- 缺少 `nameEn`：可留空字符串
- 缺少 `tags` 或 `position`：可留空数组或按已有信息精简填写
- 缺少部分天赋描述：保留已有结构，不补编额外效果
- 缺少部分潜能：只写已确认部分
- 缺少部分倍率：优先标记为未提供，不要猜测
- 缺少完整成长数据：优先保留已确认节点，并向用户说明缺口

## 输出 md 要求

`md` 用于人读，内容应从 `json` 派生，建议包含：
- 标题和一句简介
- 基础信息表
- 属性成长
- 天赋
- 潜能（区分无条件生效和条件生效）
- 技能分节
- 若 `json.skills.*.multipliers` 已提供完整等级（`1-9`、`M1-M3`），`md` 对应技能表必须完整列出全等级，不得只摘录 `1/9/M3`

### 潜能 MD 格式示例

```md
## 潜能

| 编号 | 名称 | 效果 |
|------|------|------|
| 1 | 绝影 | 对生命值少于50%的敌人伤害+20% |
| 2 | 家传武学 | 敏捷+15，物理伤害+8% |
| 3 | 双剑奇侠 | 战技/连携技/终结技倍率×1.1 |
| 4 | 自研赤霄剑 | 终结技能量需求-15% |
| 5 | 心兼人间 | 连携技冷却-3秒 |

**面板加成**（潜能2）：敏捷+15，物理伤害+8%
```

## 禁止事项

- 不要把条件生效的潜能效果写入 `stats` 字段
- 不要为条件生效创建复杂的JSON结构，用description文字记录即可
- 不要遗漏 `rarity` 字段（用于判断默认潜能等级）
- 不要混淆无条件生效和条件生效的潜能效果

## 完成标准

完成一次角色导入，至少满足：
- `data/characters/{角色名}.json` 已生成或更新
- `data/characters/{角色名}.md` 已生成或更新
- 路径写法正确
- `json` 与 `md` 内容一致
- 百分比、小数、技能等级格式统一
- 若有完整技能倍率数据，`md` 已完整覆盖 `1-9`、`M1-M3`
- **潜能区分无条件生效（有stats字段）和条件生效（无stats字段）**
- **条件生效的潜能只用description文字记录**
- **面板计算只考虑stats字段，不考虑条件生效**
