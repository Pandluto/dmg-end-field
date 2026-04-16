# review-todo0.4.2

## 结论

这次复核后，当前代码不是单纯的 `k-v value` 结构过大问题，而是已经进入了一个“v2 旧结构仍在主读写、v3 新结构开始落地但还没有真正接管”的中间态。

按你现在的要求：

1. 临时存储
2. 不做迁移
3. tsx 改了直接升级版本结构

那么当前最该做的不是继续补迁移逻辑，而是：

1. 删掉 v2 -> v3 迁移思路
2. 收死写入规则
3. 切断 UI 对旧大对象的直接依赖
4. 让 v3 真正成为唯一结构

---

## 当前代码状态复核

### 1. v3 已经开始落地，但没有成为主路径

当前代码里已经出现：

- `ddd.operator-config.character-input-map.v3`
- `ddd.operator-runtime.character-computed-map.v3`
- `ddd.operator-ui.character-display-cache.v3`

位置：

- [storage-keys.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/constants/storage-keys.ts)
- [types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts)
- [utils/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/utils/storage.ts)

但主业务组件实际仍然主要在读写：

- `ddd.operator-config.character-config-map.v1`
- `ddd.operator-config.character-config-map.v2`

也就是：

- 结构设计已经想拆
- 主读写逻辑还没真正拆开

这是当前最大问题。

---

## 当前冲突

### 问题 1：`OperatorConfigPanel` 仍然存在双写/旁路写入

当前有两条写入路径：

1. 统一 debounce effect 写入  
位置：
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:928)

2. 按钮事件里直接写 storage，再 `setState`  
位置：
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1403)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1404)

风险：

- 状态来源不唯一
- 一个 key 既由 React state 统一持久化，又允许局部事件绕过 state 直接写
- 后续拆 `character-input-map.v3` 时很容易出现“state 是新的，storage 是旧的”的短时不一致

结论：

`character input` 必须只保留一条写入链：

`setState -> effect -> storage`

不允许事件处理里直接 `write...ToSession`

---

### 问题 2：`useSkillButtonBuffs` 同时支持两种写法

当前同一个 key `ddd.skill-button-buffs.v1` 有两种模式：

1. Hook 内状态驱动写入  
位置：
- [useSkillButtonBuffs.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useSkillButtonBuffs.ts:34)

2. 工具函数直接写 storage  
位置：
- [useSkillButtonBuffs.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useSkillButtonBuffs.ts:157)
- [useSkillButtonBuffs.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useSkillButtonBuffs.ts:168)

并且业务侧已经在直接调用工具函数：

- [DamageTab.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/SidePanel/components/DamageTab.tsx:296)
- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:148)

风险：

- 同一个 key 既是“状态存储”，又是“命令式缓存存储”
- hook 内的 `buttonBuffs` 和 storage 中的最新值可能短时间分叉
- 后续如果给 Buff 做局部缓存或批量操作，会更乱

结论：

这里必须二选一：

1. 要么 Buff 全部 state 驱动
2. 要么 Buff 就彻底当缓存，全部工具函数直写

按你现在项目的实际使用方式，我更建议：

`skill-button-buffs` 直接归类为缓存，统一命令式直写，不再维护一套 hook state 镜像

---

## 结构层面的风险

### 问题 3：v3 已经定义了类型和 key，但 UI 依然深度依赖 v2 大对象

当前以下字段仍然是主读路径：

- `panelSnapshot`
- `infoSnap`
- `infoSnapshot`
- `weaponBuffSnapshot`

主要位置：

- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:118)
- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:136)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:507)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:730)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1208)

这意味着：

- v3 只是“旁路缓存”
- v2 大对象还是事实上的单一真相来源

如果继续这样推进，最终会变成：

- v2 保留所有字段
- v3 再复制一份拆分结构

等于没有真正减负，反而会多一套冗余。

---

### 问题 4：`infoSnapshot` / `weaponBuffSnapshot` 仍在持久化主链路里

位置：

- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1099)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1209)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1211)

这是当前 value 膨胀的直接来源。

问题不在“它能不能存”，而在“它不该和输入配置一起存”。

如果你确认这是临时存储而且不要求迁移，那么最应该直接砍掉的是：

- `infoSnapshot`
- `weaponBuffSnapshot`

至少先从主配置 key 里移除。

---

### 问题 5：`characterId` / `characterName` 在 map value 中仍然冗余

当前 map 已经是：

```ts
{
  [characterId]: { ...value }
}
```

那 value 里再放：

- `characterId`
- `characterName`

就属于重复表达。

保留它们只会带来两个问题：

1. 数据冗余
2. key 和 value 不一致时需要额外防错

建议：

- `characterId` 不再入 value
- `characterName` 运行时从角色表读

---

### 问题 6：`equipment` 仍然不是完全稀疏存储

虽然 `storage.ts` 里已经有：

- `pruneEquipmentDefaults`
- `inflateEquipmentDefaults`

但当前主逻辑仍大量围绕完整 `EquipmentConfig` 结构运转，而且 `characterConfigMap` 主体依旧是旧结构，不是真正的 `CharacterInputConfig`

结果就是：

- 设计上说稀疏
- 主结构上还是整包

也就是说“优化函数已经有了，但主结构还没切过去”。

---

## 对你当前前提下的拍板建议

你现在已经明确：

1. 不做迁移
2. 临时存储
3. 改 TSX 结构即可

那 0.4.2 最合理的路线应该是下面这版，不要再继续保留“迁移兼容层思维”。

---

## 建议的数据结构

### 1. 输入主存储

key：

`ddd.operator-config.character-input-map.v3`

```ts
type CharacterInputMap = {
  [characterId: string]: {
    potential?: '0潜' | '满潜'
    skillLevels?: Partial<Record<'A' | 'B' | 'E' | 'Q', 'L9' | 'M3'>>
    weapon?: {
      name?: string
      potentialMode?: 'P0' | 'PMAX'
    }
    equipment?: Partial<EquipmentConfig>
  }
}
```

要求：

- 只存输入
- 稀疏
- 不存 `characterId`
- 不存 `characterName`
- 不存 `panelSnapshot`
- 不存 `infoSnap`
- 不存 `infoSnapshot`
- 不存 `weaponBuffSnapshot`

---

### 2. 数值计算缓存

key：

`ddd.operator-runtime.character-computed-map.v3`

```ts
type CharacterComputedMap = {
  [characterId: string]: {
    inputHash: string
    panel?: PanelSummary
    damageBonus?: DamageBonusSnapshot
  }
}
```

要求：

- 只放可复用数值
- 不放展示文本
- 输入 hash 不同即失效

---

### 3. 展示缓存

建议：

默认不要持久化。

如果一定要保留，再单独一个：

`ddd.operator-ui.character-display-cache.v3`

```ts
type CharacterDisplayCache = {
  [characterId: string]: {
    infoLines?: string[]
    weaponBuffLines?: string[]
  }
}
```

但建议优先改成：

- `infoSnapshot` 现场生成
- `weaponBuffSnapshot` 现场生成

直接内存态即可。

---

## 前端缓存方案建议

### 建议 1：输入、缓存、展示三类严格分工

- 用户输入：`sessionStorage`
- 可重算数值：`sessionStorage`
- 展示文本：内存 `useMemo/useState`
- 弹窗、抽屉、选中态：内存

---

### 建议 2：同一类数据只能有一种写法

规则建议：

1. `character-input-map`
只能 React state 驱动写入

2. `character-computed-map`
允许工具函数直写

3. `character-display-cache`
如果保留，允许工具函数直写

4. `skill-button-buffs`
建议直接作为缓存类 key，统一工具函数直写

---

### 建议 3：不要继续保留 v2/v3 双主线

当前 `storage.ts` 中已经有大量：

- v2 兼容
- v3 wrapper
- v2 -> v3 migration

但你现在明确说不需要迁移，这部分应该删掉。

否则后续维护时会持续出现：

- 代码改了一半读 v2
- 另一半写 v3
- review 永远卡在“到底哪个是主结构”

---

## 0.4.2 建议执行项

### P0

1. 删除 `todo0.4.1.md` 里迁移相关描述
2. 删除 `storage.ts` 中 `migrateV2ToV3` 及其相关迁移函数
3. 删除 v2/v3 双轨并行写入
4. 让 `character-input-map.v3` 成为唯一输入主存储
5. 去掉 `OperatorConfigPanel` 中所有事件级直接写 storage 的旁路
6. 去掉主配置中的 `infoSnapshot`
7. 去掉主配置中的 `weaponBuffSnapshot`

### P1

1. `SkillButton` 改为从 `character-computed-map.v3` 读取数值缓存
2. `OperatorConfigPanel` UI 显示改为优先读 input + computed，而不是旧大对象
3. `useSkillButtonBuffs` 改成单一写入模式

### P2

1. `infoSnapshot` 改为纯内存生成
2. `weaponBuffSnapshot` 改为纯内存生成
3. 给 `equipment` 稀疏化写一个单测或最小验证函数

---

## 一句话结论

当前最大问题不是 value 字段多，而是“旧主结构没退场，新结构没接管”。  
0.4.2 应该直接把迁移思路砍掉，收死写入规则，让 v3 成为唯一结构。
