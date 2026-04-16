# todo0.4.1

## 背景

当前 `ddd.operator-config.character-config-map.v2` 的 value 结构存在明显混杂问题：

1. 一个 key 下同时存了：
   - 用户输入配置
   - 计算结果快照
   - 展示用文本快照
   - 武器 Buff 展示文本

2. 同一份信息有重复表达：
   - `panelSnapshot` 和 `infoSnapshot`
   - `infoSnap` 和 `panelSnapshot` 中部分字段
   - `weaponBuffSnapshot` 和原始武器 buff 数据

3. 数据层级不清晰：
   - “配置输入” 和 “派生结果” 没有分层
   - “可重算数据” 和 “必须持久化数据” 没有分层
   - “业务数据” 和 “UI 文本” 混在一起

4. value 体积过大：
   - `infoSnapshot` 存了大量纯展示文本
   - `equipment` 固定存满一整套 0 值字段
   - 每个角色对象里字段很多，但真正核心输入很少

5. 扩展性差：
   - 后续再加新模块，容易继续往同一个对象里堆字段
   - 不利于版本迁移和局部失效

---

## 目标

0.4.1 版本要把角色配置存储拆成“输入层”和“派生层”，让 sessionStorage 里的 value 结构满足：

1. 用户真正需要记忆的输入，单独存
2. 可通过计算重新得到的数据，不和输入混存
3. UI 展示文本默认不进入长期持久化
4. 结构可迁移、可扩展、可局部失效
5. 单个角色对象可读、可维护

---

## 设计原则

1. 输入优先  
只持久化“用户改过、且下次打开必须恢复”的数据。

2. 派生分离  
凡是可以通过角色数据、武器数据、装备配置重新计算出来的内容，不和输入混存。

3. 文本不入主存储  
`infoSnapshot` 这类展示文本不作为主存储结构的一部分。

4. 稀疏存储  
像 `equipment` 这种大量默认 0 值字段，应只存非默认值。

5. 分层命名  
key 要体现：
   - 配置输入
   - 计算缓存
   - UI 临时缓存

---

## 当前结构问题拆解

### 问题 1：角色对象职责过多

当前单个角色对象同时承担：
- 配置输入
- 面板结果
- 伤害加成结果
- 信息面板展示文本
- 武器 Buff 展示文本

这导致对象语义混乱，不知道哪些字段是“源数据”，哪些字段是“缓存”。

### 问题 2：展示文本污染存储

`infoSnapshot` 本质是“渲染结果文本”，不是业务核心数据。  
它体积大、重复高、变更频繁，不适合放在主配置 key 中。

### 问题 3：大量默认值占空间

`equipment` 里大量 `0` 字段会让存储结构膨胀，且降低可读性。

### 问题 4：派生字段重复

以下字段都属于可重算数据：
- `panelSnapshot`
- `infoSnap`
- `weaponBuffSnapshot`
- `infoSnapshot`

不应和输入配置同级长期绑定。

---

## 目标结构方案

推荐把当前一个大对象拆成 3 类 key。

### 1. 角色输入配置主存储

key:  
`ddd.operator-config.character-input-map.v3`

结构：

```ts
{
  version: "3",
  timestamp: number,
  data: {
    [characterId: string]: {
      potential: "0潜" | "满潜",
      skillLevels: {
        A: "L9" | "M3",
        B: "L9" | "M3",
        E: "L9" | "M3",
        Q: "L9" | "M3"
      },
      weapon: {
        name: string,
        potentialMode: "P0" | "PMAX"
      },
      equipment: Partial<EquipmentConfig>
    }
  }
}
```

说明：
- 这里只存用户输入
- `equipment` 改成 `Partial`，只存非默认值
- 去掉 `characterName`，map key 已经能表达
- 去掉 `characterId`，map key 已经能表达

### 2. 角色计算缓存

key:  
`ddd.operator-runtime.character-computed-map.v3`

结构：

```ts
{
  version: "3",
  timestamp: number,
  data: {
    [characterId: string]: {
      fingerprint: string,
      panel: {
        atk: number,
        baseAtk: number,
        strength: number,
        agility: number,
        intelligence: number,
        will: number,
        abilityBonus: number,
        mainStatFinal: number,
        subStatFinal: number,
        characterAtk: number,
        weaponAtk: number,
        weaponAtkPercent: number,
        weaponAllSkillDmgBonus: number
      },
      damageBonus: {
        physicalDmgBonus: number,
        fireDmgBonus: number,
        electricDmgBonus: number,
        iceDmgBonus: number,
        natureDmgBonus: number,
        magicDmgBonus: number,
        normalAttackDmgBonus: number,
        skillDmgBonus: number,
        chainSkillDmgBonus: number,
        ultimateDmgBonus: number,
        allSkillDmgBonus: number,
        imbalanceDmgBonus: number,
        allDmgBonus: number
      }
    }
  }
}
```

说明：
- 这是缓存，不是主输入
- `fingerprint` 用于判断输入变了没有
- 输入变化时，缓存失效并重算

### 3. UI 文本缓存

key:  
`ddd.operator-ui.character-display-cache.v3`

结构：

```ts
{
  version: "3",
  timestamp: number,
  data: {
    [characterId: string]: {
      infoLines?: string[],
      weaponBuffLines?: string[]
    }
  }
}
```

说明：
- 纯展示缓存
- 可以丢
- 可以设置更短 TTL
- 也可以直接不持久化，只做内存态

---

## 不再进入主配置的字段

以下字段不再放进 `character-input-map`：

1. `characterId`  
原因：外层 key 已表达

2. `characterName`  
原因：外层 key 已表达，运行时可从角色数据源获取

3. `panelSnapshot`  
原因：属于计算缓存

4. `infoSnap`  
原因：属于计算缓存

5. `infoSnapshot`  
原因：属于 UI 文本缓存

6. `weaponBuffSnapshot`  
原因：属于 UI 文本缓存或运行时临时数据

---

## equipment 优化方案

当前：

```ts
equipment: {
  strength: 0,
  agility: 0,
  intelligence: 0,
  ...
}
```

目标：

```ts
equipment: {}
```

有值时才写：

```ts
equipment: {
  agility: 60,
  iceDmgBonus: 0.256
}
```

落地规则：
1. 保存前去掉默认值 `0`
2. 读取后统一补全默认值
3. UI 层继续拿完整结构，不影响现有表单

---

## 迁移策略

### v2 -> v3 迁移

迁移逻辑：

1. 读取旧 key：  
`ddd.operator-config.character-config-map.v2`

2. 对每个角色提取输入字段，生成：  
`ddd.operator-config.character-input-map.v3`

3. 对每个角色提取派生字段，生成：  
`ddd.operator-runtime.character-computed-map.v3`

4. 对每个角色提取展示文本，生成：  
`ddd.operator-ui.character-display-cache.v3`

5. 写入新 key 后，保留旧 key 一个过渡版本周期
6. 确认新结构稳定后，再删除旧 key

---

## 代码改造任务

### P0

1. 新增 `CharacterInputConfig` 类型
2. 新增 `CharacterComputedCache` 类型
3. 新增 `CharacterDisplayCache` 类型
4. 新增 `pruneEquipmentDefaults()`，保存时裁剪 0 值
5. 新增 `inflateEquipmentDefaults()`，读取时补全默认值
6. 将 `OperatorConfigPanel` 改为只写输入配置 key
7. 将 `panelSnapshot / infoSnap` 改写到 computed key
8. 将 `infoSnapshot / weaponBuffSnapshot` 移出主配置 key

### P1

1. 增加 v2 -> v3 migration
2. 增加 fingerprint 机制
3. 输入变更时自动使 computed cache 失效
4. 为 UI cache 设置较短 TTL

### P2

1. 检查 `SkillButton` 对旧结构字段的读取依赖
2. 检查 `DamageTab` 是否误依赖主配置中的派生字段
3. 减少无意义同步写入

---

## 验收标准

1. 主配置 key 中只保留输入数据
2. 主配置对象中不再出现：
   - `panelSnapshot`
   - `infoSnap`
   - `infoSnapshot`
   - `weaponBuffSnapshot`

3. `equipment` 默认值不再整包保存
4. 角色主配置对象长度明显缩小
5. 页面刷新后：
   - 角色配置能恢复
   - 面板结果能正常显示
   - 信息模块能正常显示
   - 旧数据可自动迁移

---

## 建议最终 key 方案

1. `ddd.operator-config.character-input-map.v3`
2. `ddd.operator-runtime.character-computed-map.v3`
3. `ddd.operator-ui.character-display-cache.v3`
4. `ddd.skill-button-buffs.v2`
5. `ddd.timeline.data.v2`

---

## 一句话结论

0.4.1 的核心不是继续给旧 value 补字段，而是把“输入”“计算缓存”“展示文本”彻底拆开。
