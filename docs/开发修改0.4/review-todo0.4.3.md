# review-todo0.4.3

## 结论

当前 bug 已定位：

`技能按钮弹窗 - 伤害和信息` 拿不到数据，不是 `SkillButton` 自身计算逻辑坏了，而是 `OperatorConfigPanel -> storage -> SkillButton` 这条链路在新结构改造后断掉了。

具体说：

1. `SkillButton` 仍然依赖兼容后的 `CharacterConfigJson`
2. 兼容层 `getCharacterConfig()` 会从：
   - `character-input-map.v3`
   - `character-computed-map.v3`
   - `character-display-cache.v3`
   合并出旧结构
3. 但 `OperatorConfigPanel` 当前主写入逻辑只稳定写了 input，不保证 computed / display 被写入
4. 所以弹窗里：
   - 伤害面板依赖的 `panelSnapshot / infoSnap`
   - 信息面板依赖的 `infoSnapshot`
   取不到

---

## 直接问题点

### P0-1 `OperatorConfigPanel` 的 debounce 主写入只写 input，没写 computed / display

位置：

- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx)
  中的 `writeCharacterConfigMapToSession`

当前逻辑：

- `writeCharacterConfigMapToSession(value)` 会把 `CharacterConfigJson` 转成 `CharacterInputConfig`
- 只调用 `setCharacterInputMap(inputMap)`
- 不写 `setCharacterComputedMap`
- 不写 `setCharacterDisplayCacheMap`

影响：

- `character-input-map.v3` 有数据
- `character-computed-map.v3` 没有或不完整
- `character-display-cache.v3` 没有或不完整
- `getCharacterConfig()` 合并结果缺字段

这正好会打到：

- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:118)
- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:136)

即：

- `characterConfig?.panelSnapshot`
- `characterConfig?.infoSnapshot`
- `characterConfig?.infoSnap`

---

### P0-2 `OperatorConfigPanel` 内部还保留了一套旧大对象 state，但持久化时被裁掉了

当前 `OperatorConfigPanel` 的本地状态仍然是：

```ts
const [characterConfigMap, setCharacterConfigMap] = React.useState<Record<string, CharacterConfigJson>>(...)
```

并且在计算 effect 里还在回写：

- `panelSnapshot`
- `infoSnapshot`
- `infoSnap`
- `weaponBuffSnapshot`

位置：

- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1195)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1208)
- [OperatorConfigPanel.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/components/OperatorConfigPanel.tsx:1211)

也就是说：

- 组件内存里其实有完整数据
- 但持久化函数把这部分信息裁掉了

这是一种“内存正确，storage 不完整”的断层。

---

### P0-3 `SkillButton` 没有直接读 v3，而是继续依赖兼容层

位置：

- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:84)
- [SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:112)

当前依赖：

```ts
const characterConfig = getCharacterConfig(button.characterId);
```

而 `getCharacterConfig()` 的前提是：

- input
- computed
- display

三个缓存都完整。

只要 `computed` 或 `display` 没写进去，弹窗就会表现为：

1. 伤害区一直显示“加载面板数据...”
2. 信息区显示“暂无信息快照”

---

## 根因归纳

这次 bug 的本质是：

**存储结构已经拆了，但写入策略没有完整跟上，导致兼容层拿不到完整旧结构。**

不是 UI 读错字段，而是 storage 层没有把 UI 仍在依赖的数据完整落盘。

---

## 修复建议

### 方案 A：最小修复，先把功能恢复

适合你现在要先救 bug。

做法：

1. 保留当前兼容层
2. 修改 `writeCharacterConfigMapToSession`
3. 在写 input 的同时，补写：
   - computed
   - display

也就是把当前 `CharacterConfigJson` 拆成：

- `CharacterInputConfig`
- `CharacterComputedCache`
- `CharacterDisplayCache`

一起落盘。

这样可以让：

- `SkillButton` 不改
- `DamageTab` 不改
- 弹窗数据立刻恢复

这是当前最稳的临时修法。

---

### 方案 B：彻底修复，切断兼容层

适合后续 0.4.4 再做，不建议现在直接上。

做法：

1. `SkillButton` 直接读：
   - `getCharacterInput`
   - `getCharacterComputed`
   - `getCharacterDisplayCache`

2. `OperatorConfigPanel` 不再维护旧的 `CharacterConfigJson`
3. 全链路彻底使用 v3

问题：

- 改动面大
- 容易在当前阶段引入更多 UI 回归

所以这轮不建议。

---

## 推荐修复顺序

### P0

1. 修改 `writeCharacterConfigMapToSession`
   - 写 input map
   - 写 computed map
   - 写 display cache map

2. 确保下列字段能从 `characterConfigMap` 正确拆出：
   - `panelSnapshot -> computed.panel`
   - `infoSnap -> computed.damageBonus`
   - `infoSnapshot -> display.infoLines`
   - `weaponBuffSnapshot -> display.weaponBuffLines`

3. 复测以下功能：
   - 双击技能按钮弹出“伤害”正常
   - 双击技能按钮弹出“信息”正常
   - 切换角色后重新打开弹窗仍正常
   - 刷新页面后重新打开弹窗仍正常

### P1

1. 删掉 `OperatorConfigPanel` 里事件级直接写 storage 的旁路逻辑
2. 收敛为单一写入链：
   - `setCharacterConfigMap`
   - debounce effect
   - storage

### P2

1. 再评估是否保留 `CharacterConfigJson` 兼容层
2. 如果不保留，再推进 `SkillButton` 直读 v3

---

## 建议验收点

### 验收 1：弹窗伤害区

对任一已完成配置的角色：

1. 打开配置面板
2. 确认面板攻击、武器、技能等级都已设置
3. 双击技能按钮

预期：

- 不再显示“加载面板数据...”
- 能显示命中伤害、总伤、展开计算过程

### 验收 2：弹窗信息区

同样操作后：

预期：

- 不再显示“暂无信息快照”
- 能显示 `infoSnapshot` 文本内容

### 验收 3：刷新后恢复

1. 完成角色配置
2. 刷新页面
3. 重新进入画布
4. 再开技能按钮弹窗

预期：

- 伤害正常
- 信息正常

---

## 一句话结论

这次 bug 的根因不是“新结构设计错了”，而是 **`OperatorConfigPanel` 只把 input 写进了 v3，没把 `SkillButton` 还在依赖的 computed / display 一起写进去**。  
当前最合理的修复不是回退结构，而是先把这三部分写完整。
