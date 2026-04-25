# review-todo0.5.12：武器正式字段收口 + `critRate` 进不了面板与伤害计算链路

## [任务理解]

- 本轮要先收口武器正式字段，再修 `critRate` 进不了主链路的问题。
- 武器 `skill2.statType` 和 `skill3.levels.*.passive` 的正式字段只保留 12 个：
  - `atkPercent`
  - `fireDmgBonus`
  - `natureDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `electricDmgBonus`
  - `critRate`
  - `magicDmgBonus`
  - `physicalDmgBonus`
  - `iceDmgBonus`
  - `memoryStrength`
  - `healingBonus`
- 其他字段不能再作为武器正式字段继续扩散进 `max.json.passive` 或 `skill2.statType`。
- 当前已明确受影响武器是 `狼之绯`，它的 `skill2.statType = critRate`，数值本该进入武器面板、持久化缓存和技能伤害计算。

## [当前结论]

- 当前问题分两层：
  - 第一层：武器正式字段口径失控，`OperatorConfigPanel.tsx` 仍在消费一批不应该继续保留的历史字段
  - 第二层：即便 `critRate` 已经出现在武器数据里，也没有进入主链路
- 完整调用链：
  - `public/data/weapons/{武器名}/{武器名}max.json`
  - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
  - `recordWeaponUnconditional()`
  - `panelSnapshot`
  - `src/utils/storage.ts`
  - `src/components/CanvasBoard/SkillButton.tsx`
  - `src/core/calculators/skillButtonDamageCalculator.ts`
- 具体失败点：
  - `OperatorConfigPanel.tsx` 近 `510-532` 的 `percentLikeKeySet` 和近 `547-615` 的 `recordWeaponUnconditional()` 仍在容纳大量历史字段
  - 当前实际仍在代码里可命中的武器字段超过 12 个，已经超出口径
  - `critRate` 虽然被写进 `percentLikeKeySet`，但 `recordWeaponUnconditional()` 没有 `case 'critRate'`
  - `electricDmgBonus` 也没有 `case`
  - `ultimateChargeEfficiency`、`hpPercent`、`healingBonus` 目前没有任何武器面板接入分支
  - `src/types/storage.ts` 的 `CharacterComputedCache.panel` / `PanelSummary` 没有 `critRate`、`critDmg`
  - `src/components/CanvasBoard/SkillButton.tsx` 近 `121-136` 的 `loadPanelData()` 直接写死：
    - `critRate: 0.05 + equipment.critRateBoost`
    - `critDmg: 0.5 + equipment.critDmgBonusBoost`
- 当前需要保留的武器正式字段只有这 12 个：
  - `atkPercent`
  - `fireDmgBonus`
  - `natureDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `electricDmgBonus`
  - `critRate`
  - `magicDmgBonus`
  - `physicalDmgBonus`
  - `iceDmgBonus`
  - `memoryStrength`
  - `healingBonus`
- 当前应去除出正式口径的字段包括：
  - `strength`
  - `agility`
  - `intelligence`
  - `will`
  - `mainStat`
  - `mainStatBoost`
  - `subStatFlat`
  - `mainStatBoostRate`
  - `subStat`
  - `subStatBoost`
  - `allStatBoost`
  - `atk`
  - `allSkillDmgBonus`
  - `skillDmgBonus`
  - `chainSkillDmgBonus`
  - `ultimateDmgBonus`
  - `normalAttackDmgBonus`
  - `critDmgBonus`
  - `magicDmgBoost`
  - `burnDmgBonus`
- 结果：
  - 武器正式字段边界不清
  - `狼之绯.skill2 = critRate` 不进配置面板最终值
  - 刷新页面后不会恢复
  - 技能按钮弹窗的暴击期望始终忽略武器 `critRate`

## [必须改]

### 1. 先把武器正式字段收口成固定 12 个

文件：

- `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`

函数：

- `recordWeaponUnconditional()`

问题：

- 当前 `recordWeaponUnconditional()` 仍在消费大量历史字段，已经超出武器正式字段范围。

原因：

- 现有逻辑同时支持：
  - 四维属性字段
  - 主副能力字段
  - 全技能伤害字段
  - `atk`
  - `critDmgBonus`
  - 历史别名字段
- 这和当前武器字段口径冲突。

修正要求：

- `OperatorConfigPanel.tsx` 中武器正式字段只允许保留这 12 个入口：
  - `atkPercent`
  - `fireDmgBonus`
  - `natureDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `electricDmgBonus`
  - `critRate`
  - `magicDmgBonus`
  - `physicalDmgBonus`
  - `iceDmgBonus`
  - `memoryStrength`
  - `healingBonus`
- 删除或停止消费超出口径的武器字段分支：
  - `strength/agility/intelligence/will`
  - `mainStat/mainStatBoost/subStatFlat/mainStatBoostRate/subStat/subStatBoost/allStatBoost`
  - `atk`
  - `allSkillDmgBonus/skillDmgBonus/chainSkillDmgBonus/ultimateDmgBonus/normalAttackDmgBonus`
  - `critDmgBonus`
  - `magicDmgBoost`
  - `burnDmgBonus`
- `percentLikeKeySet` 也必须同步收口，不要留历史脏字段继续冒充正式口径。

验证方式：

- 武器 `skill2.statType` / `skill3.passive` 只再命中上述 12 个字段
- 超出口径的旧字段不会再被当成正式武器字段参与面板累计
- 不允许再出现“代码能吃但文档不认”的状态

---

### 2. 在正式字段范围内补齐当前缺失字段入口

文件：

- `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`

函数：

- `recordWeaponUnconditional()`

问题：

- 当前 12 个正式字段里，至少以下字段没有完整入口：
  - `critRate`
  - `electricDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `healingBonus`

原因：

- `switch (statType)` 没有对应 `case`，或者没有对应面板累计变量。

修正要求：

- 在 `recordWeaponUnconditional()` 中补齐以下正式字段入口：
  - `critRate`
  - `electricDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `healingBonus`
- 每个字段都必须有明确归属，不允许继续掉进 `weaponOtherUnconditionalMap`
- 如果当前 `panelSnapshot` 没有对应字段承接，必须在同轮补齐，不要只做文案展示

验证方式：

- 这 5 个字段出现在武器 `max.json` 时，不再只显示调试文案，必须进入可消费的最终面板 / 缓存结构

---

### 3. 让武器无条件 `critRate` 真正进入面板累计

文件：

- `src/types/storage.ts`
- `src/utils/storage.ts`

函数 / 类型：

- `CharacterComputedCache.panel`
- `PanelSummary`
- `mergeV3ToV2()`
- `setCharacterConfig()`

问题：

- 即使 `OperatorConfigPanel` 算出了武器暴击，当前缓存结构也没有字段承接。

原因：

- `panel` 和 `panelSnapshot` 只存：
  - `atk / baseAtk / strength / agility / intelligence / will / weaponAtkPercent / weaponAllSkillDmgBonus`
- 不存：
  - `critRate`
  - `critDmg`

修正要求：

- 在 [src/types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts) 新增：
  - `CharacterComputedCache.panel.critRate`
  - `CharacterComputedCache.panel.critDmg`
  - `PanelSummary.critRate`
  - `PanelSummary.critDmg`
- 在 [src/utils/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/utils/storage.ts) 的：
  - `mergeV3ToV2()`
  - `setCharacterConfig()`
  - `computed -> panelSnapshot` 映射
  补齐这两个字段的读写
- 老数据兼容要求：
  - 旧缓存没有 `critRate / critDmg` 时，不要炸
  - 缺字段时允许回落到默认基础值

验证方式：

- 选中 `狼之绯` 后刷新页面，再打开同一角色配置：
  - `panelSnapshot.critRate` 仍带武器值
  - `panelSnapshot.critDmg` 仍可正常读取

---

### 4. `SkillButton` 不再本地硬编码暴击

文件：

- `src/components/CanvasBoard/SkillButton.tsx`

函数：

- `loadPanelData()`

问题：

- 当前技能按钮弹窗绕过了 `panelSnapshot` 的真实暴击结果，直接本地硬编码基础值。

原因：

- 近 `121-136` 现在写死：
  - `critRate: 0.05 + (equipment.critRateBoost ?? 0)`
  - `critDmg: 0.5 + (equipment.critDmgBonusBoost ?? 0)`
- 这会把武器无条件暴击完全绕开。

修正要求：

- `loadPanelData()` 改为优先读取：
  - `snapshot.critRate`
  - `snapshot.critDmg`
- 只有旧缓存缺字段时，才允许回退到基础值：
  - `0.05 + equipment.critRateBoost`
  - `0.5 + equipment.critDmgBonusBoost`
- `panelData` 的其他字段保持原样，不做无关重构

验证方式：

- `狼之绯` 装备后双击技能按钮：
  - 弹窗中的 `暴击率`
  - `暴击期望`
  必须包含武器贡献

---

### 5. 保证技能伤害计算消费的是修正后的面板暴击

文件：

- `src/core/calculators/skillButtonDamageCalculator.ts`

函数：

- `calculateSkillButtonDamage()`

问题：

- 计算器本身不是根因，但要确认它继续吃的是修正后的 `panelData`，而不是旧硬编码结果。

原因：

- 当前 `calculateSkillButtonDamage()` 近 `236-239` 只做：
  - `const critRate = panelData.critRate + buffTotals.critRateBoost`
  - `const critDmg = panelData.critDmg + buffTotals.critDmgBonusBoost`

修正要求：

- 本文件原则上不需要重写公式
- 只确认入参 `panelData.critRate / critDmg` 已经来自修正后的 `panelSnapshot`
- 如果当前类型定义缺字段导致报错，只做最小类型补齐，不重构公式

验证方式：

- 同一个按钮，不加任何 Buff 时：
  - `critRate` 已经包含武器 `critRate`
- 再加候选 Buff `critRateBoost` 时：
  - 总暴击率 = 武器无条件暴击 + Buff 暴击

---

### 6. 补充面板日志和信息快照，避免“值生效但看不见”

文件：

- `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`

问题：

- 当前面板文本里有：
  - `暴击率: 0.05 + equipment.critRateBoost`
  - `暴击伤害: 0.5 + equipment.critDmgBonusBoost`
- 即使数值接通，日志和信息区仍会误导。

原因：

- 信息快照文案仍是旧口径。

修正要求：

- `infoSnapshotLines` / 调试文本里的暴击段，改成输出最终值
- 文案口径要与 `panelSnapshot.critRate / critDmg` 一致
- 不用新增复杂拆解，只要不再写死旧公式

验证方式：

- 装备 `狼之绯` 后，信息弹窗和技能伤害弹窗的暴击率显示一致

## [可选优化]

- 在 `recordWeaponUnconditional()` 的 `default` 分支对未知 `statType` 增加开发态警告，减少以后再出现 silent no-op。

## [不要动]

- 不改武器搜索：
  - `src/utils/weaponFuzzySearch.ts`
- 不改 `public/data/weapons` 文件结构
- 不改 `buff.json` 处理逻辑
- 不改 `DamageTab`、`useSkillButtonBuffs.ts`、候选 Buff 实体表
- 不改 `equipmentParser.ts`
- 不批量修历史武器
- 不重写 `calculateSkillButtonDamage()` 总公式
- 不把去除的历史字段换个别名继续保留在武器正式口径里

## [验收标准 AC]

- AC1：武器正式字段只剩这 12 个：
  - `atkPercent`
  - `fireDmgBonus`
  - `natureDmgBonus`
  - `ultimateChargeEfficiency`
  - `hpPercent`
  - `electricDmgBonus`
  - `critRate`
  - `magicDmgBonus`
  - `physicalDmgBonus`
  - `iceDmgBonus`
  - `memoryStrength`
  - `healingBonus`
- AC2：超出口径的历史字段不再作为正式武器字段被消费
- AC3：装备 `狼之绯` 后，配置面板最终暴击率包含 `skill2` 的 `critRate`
- AC4：刷新页面后，`panelSnapshot.critRate / critDmg` 不丢失
- AC5：双击技能按钮后，伤害弹窗 `暴击率 / 暴击伤害 / 暴击期望` 与配置面板一致
- AC6：`calculateSkillButtonDamage()` 继续支持候选 Buff 的：
  - `critRateBoost`
  - `critDmgBonusBoost`
  并在武器暴击基础上叠加
- AC7：不装备 `狼之绯` 的旧角色旧武器，暴击显示不回退、不报错

## [回归检查项]

1. 用现有武器数据扫一遍：
   - `skill2.statType`
   - `skill3.passive`
   不应再出现超出 12 个正式字段的新写法被主链路吞进去

2. 不带武器时打开任意技能按钮：
   - 暴击率仍是基础值 + 装备暴击

3. 装备 `狼之绯`：
   - 配置面板暴击率变化
   - 技能按钮弹窗暴击率同步变化

4. 装备 `狼之绯` 再给按钮添加一个 `critRateBoost` Buff：
   - 最终暴击率继续上涨
   - 伤害期望继续变化

5. 刷新页面：
   - 当前角色武器配置仍在
   - 面板暴击率和技能弹窗暴击率仍一致

## [给 Trae 的执行指令]

1. 先改 `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
   - 先把武器正式字段收口成 12 个
   - 删掉超出口径的消费分支
   - 再补 `critRate / electricDmgBonus / ultimateChargeEfficiency / hpPercent / healingBonus` 的正式入口
   - 其中 `critRate` 必须进入最终面板累计

2. 再改 `src/types/storage.ts` 和 `src/utils/storage.ts`
   - 给 `computed.panel / panelSnapshot` 加 `critRate / critDmg`
   - 做旧缓存兼容

3. 再改 `src/components/CanvasBoard/SkillButton.tsx`
   - `loadPanelData()` 改读 `panelSnapshot.critRate / critDmg`
   - 只在缺字段时回退旧默认值

4. 最后检查 `src/core/calculators/skillButtonDamageCalculator.ts`
   - 只补必要类型，不重写公式

5. 完成后必须提交：
   - 修改文件清单
   - 武器正式字段收口后的最终名单
   - `狼之绯` 装备前后暴击率对比
   - 刷新页面后的恢复结果
   - 技能按钮弹窗里暴击期望已吃到武器 `critRate` 的验证结果
