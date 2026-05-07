# review0.4.9

## 结论

这轮实现**不能算完成**，而且问题确实偏严重，不只是“武器 Buff 没显示”这么简单。  
Trae 把缓存结构往 `timelineData + buffRegistry + selectedBuffList` 的方向推了一半，但没有把“主数据源、恢复链路、旧逻辑清理”一起做完，所以现在处于一种**结构变了、但读取和运行时状态还没统一**的中间态。

你现在看到的“武器 Buff 没出现在陈列区”，只是这个中间态最直接暴露出来的一个 bug。

---

## 当前结构讲解

### 1. Trae 这轮想做成什么

它想把原来分散的两套缓存：

- 按钮布局：`timelineData`
- 按钮已选 Buff：`def.skill-button-buffs.*`

收成一套新的 `timelineData` 结构。

目标结构大概是：

```ts
TimelineData {
  version,
  createdAt,
  updatedAt,
  staffLines: [
    {
      staffIndex,
      characterName,
      occupiedNodes,
      buttons: [
        {
          id,
          characterName,
          skillType,
          staffIndex,
          nodeIndex,
          nodeNumber,
          position,
          selectedBuffList: string[]
        }
      ]
    }
  ],
  buffRegistry: {
    [buffId]: {
      id,
      name,
      displayName,
      type,
      value,
      sourceName,
      description,
      level
    }
  }
}
```

这个设计本身方向是对的：

- `buttons` 只保存按钮与 Buff 的关联关系
- `buffRegistry` 保存 Buff 完整快照
- `selectedBuffList` 只存 Buff ID，不重复塞整份 Buff 对象

### 2. 现在为什么你会觉得“结构没看懂”

因为它**并没有真正收成唯一数据源**，而是变成了三层混用：

1. `AppContext.skillButtons`
   - 画布当前实际渲染的按钮

2. `timelineData`
   - Trae 新扩展出来的“按钮 + Buff 缓存结构”

3. 旧的 `def.skill-button-buffs.*`
   - 某些删除/读取路径还在继续引用

所以现在不是“一个新结构已经接管系统”，而是：

- 一部分逻辑在读新结构
- 一部分逻辑还在读旧结构
- 运行时画布状态和缓存状态也没有完全同步

这就是你觉得它乱的根本原因。

---

## 主要问题

### P0-1 页面刷新后，按钮恢复链路其实没有打通

**文件**
- `src/hooks/useTimelineData.ts`
- `src/components/CanvasBoard/index.tsx`

**问题**

`useTimelineData` 虽然会从 `sessionStorage` 初始化自己的 `timelineData`，但**画布真正渲染用的是 `AppContext.skillButtons`**。  
而当前代码里没有看到任何地方把 `timelineData.staffLines[].buttons` 重新灌回 `AppContext.skillButtons`。

也就是说：

- 缓存写进去了
- 但页面刷新后，画布按钮并不会因为 `timelineData` 存在就自动恢复到 `AppContext.skillButtons`

**直接证据**

- `useTimelineData.ts` 里有 `loadTimelineData`
- 但项目里没有任何地方调用它
- `CanvasBoard` 仍然把 `state.skillButtons` 作为画布唯一渲染来源

**结论**

这直接卡死了 `review-todo0.4.8` 最关键的 AC：

- 刷新页面后按钮恢复
- 刷新页面后按钮 Buff 恢复

目前不能判定为完成。

---

### P0-2 武器 Buff 不显示的问题还没修掉

**文件**
- [src/utils/storage.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\utils\storage.ts:317)
- [src/components/SidePanel/components/DamageTab.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\SidePanel\components\DamageTab.tsx:58)

**问题**

`DamageTab` 的武器 Buff 加载依赖这条链路：

1. `getCharacterConfigMap()`
2. 读出每个角色的 `characterName + weaponName`
3. 生成 `weaponMap`
4. 再去加载 `/data/weapons/<weaponName>/<weaponName>buff.json`

但现在 `storage.ts` 里的兼容层：

```ts
characterName: characterName || ''
```

只在 `getCharacterConfig(characterId, characterName?)` 这条单角色路径能补名字；  
`DamageTab` 用的是 `getCharacterConfigMap()`，它并没有传 `characterName`，所以返回的还是空字符串。

于是 `DamageTab.tsx` 这里：

```ts
if (config.characterName &&
    characterNames.includes(config.characterName) &&
    config.weaponName)
```

条件直接失败，`weaponMap` 为空，武器 Buff 根本不会进入陈列区。

**结论**

这条 bug 目前**仍然存在**，Trae 的“已修复”结论不成立。

---

### P1-1 移动已有按钮时，按钮的已选 Buff 会丢

**文件**
- [src/components/CanvasBoard/hooks/useCanvasDrag.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\hooks\useCanvasDrag.ts:131)
- [src/hooks/useTimelineData.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\hooks\useTimelineData.ts)

**问题**

Trae 虽然在 `useTimelineData.ts` 里新增了 `updateSkillButtonPosition`，但**根本没接到拖拽移动路径**。

当前移动已有按钮的真实逻辑还是：

1. 拖出时先 `removeTimelineButton`
2. 释放后再 `addTimelineButton`

而 `addTimelineButton` 会给新按钮直接写：

```ts
selectedBuffList: []
```

这意味着：

- 原按钮的 Buff 关联被删掉
- 新按钮重新创建时，Buff 列表变空

也就是说，“移动按钮”这条操作不仅没有稳定保留按钮 Buff，反而会把按钮与 Buff 的关联打断。

**结论**

`review-todo0.4.8` 里“移动按钮后自动保存且 Buff 仍正确关联”的目标没有达成。

---

### P1-2 SkillButton 删除 Buff 的逻辑仍然卡在旧 storage map 上

**文件**
- [src/components/CanvasBoard/SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx:166)

**问题**

Trae 说已经把主读取迁到新 `timelineData` 结构，但这里删除 Buff 时仍然先检查：

```ts
const buttonBuffs = getSkillButtonBuffMap();
if (buttonBuffs[button.id]) {
  removeSkillButtonBuff(button.id, buffId);
}
```

问题在于：

- `getSkillButtonBuffMap()` 是旧 key
- 新结构写入的是 `timelineData.buffRegistry + selectedBuffList`
- 如果旧 key 没同步维护，`buttonBuffs[button.id]` 就是空
- 结果右键删 Buff 根本不会触发

**结论**

这说明它并没有真正切掉旧 Buff map，仍然存在“删的时候看旧结构，读的时候看新结构”的割裂。

---

## 为什么你会觉得“问题严重”

你的直觉是对的。  
现在的问题不是单点 bug，而是**缓存重构做到一半**：

- 结构层已经想改成新模型
- 运行时画布仍然靠旧的 `AppContext.skillButtons`
- 某些 Buff 读写还靠旧的 `def.skill-button-buffs.*`
- 角色配置兼容层又没把 `characterName` 补全

所以会出现这种典型现象：

1. 构建能过
2. 局部功能像是能跑
3. 但关键链路一串起来就露馅

这正是“半重构状态”的典型危险期。

---

## Review 结论

状态：**退回修改**

当前实现**未达到可合并标准**。

---

## 必须修改

### 1. 先修恢复链路，不然自动保存没有意义

必须明确：

- 页面刷新后，`timelineData` 如何恢复成 `AppContext.skillButtons`

如果这条不补，自动保存只是在 `sessionStorage` 里堆数据，画布根本不会恢复。

### 2. 修掉 `characterName` 兼容层

`getCharacterConfigMap()` 返回的 `characterName` 不能继续为空。  
至少在当前项目里，应该直接用 `characterId` 作为兼容值，因为这里本来就是 `id === name`。

### 3. 移动按钮必须走“更新位置”，不能走“删旧建新”

已有按钮移动时：

- 不能再 `remove + add`
- 必须走 `updateSkillButtonPosition`
- 原 `selectedBuffList` 必须原样保留

### 4. 删 Buff 逻辑必须彻底切到新结构

`SkillButton.tsx` 里不能再先查旧 `getSkillButtonBuffMap()` 再决定要不要删。  
否则只会继续卡在双源结构里。

---

## 建议优化

### 1. 把“唯一真相”写死

这轮最重要的不是补更多兼容层，而是明确一句：

> 技能按钮与已选 Buff 的唯一持久化真相就是 `timelineData`

一旦这个结论定下来，就要把旧 `skill-button-buffs` 降成真正 fallback，或者直接删掉。

### 2. 运行时按钮状态和缓存按钮状态要分清

建议明确两层：

- `AppContext.skillButtons`
  - 只管当前画布渲染、拖拽、选中、锁定等运行时状态

- `timelineData.staffLines[].buttons`
  - 只管持久化必要字段

但前提是两层之间要有**明确同步入口**，不能各自活着。

---

## 下一轮最小修改集

1. 修 `storage.ts` 的 `mergeV3ToV2()`，保证 `getCharacterConfigMap()` 返回的 `characterName` 可用。
2. 修 `DamageTab.tsx` 的武器 Buff 加载链路，确认 `weaponMap` 不再为空。
3. 在 `CanvasBoard` 启动/进入画布时，把 `timelineData` 恢复到 `AppContext.skillButtons`。
4. 把已有按钮移动改成真正的“更新位置”，不要删旧建新。
5. 把 `SkillButton.tsx` 删除 Buff 的判断从旧 `getSkillButtonBuffMap()` 上拿掉。

---

## 是否达到可合并标准

**否**


