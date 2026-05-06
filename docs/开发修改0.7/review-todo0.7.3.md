[任务理解]

- 本轮要修的是**伤害链路中的四舍五入误差源**，不是主伤害公式本身。
- 根因已经定位：`OperatorConfigPanel` 在写 `panelSnapshot / computed.panel` 时，先把面板值做了 `toFixedNumber()`，后续主伤害、异常伤害、extraHit 都直接吃这份被截精度的缓存。
- 本轮主目标是把**计算缓存和展示精度分层**：
  - 缓存存原始计算值
  - 展示时再格式化
- 本轮不要改：
  - `calculateSkillButtonDamageV2`
  - `buffCalculator`
  - `skillDamageModalViewModel`
  - 异常段公式结构

[当前结论]

- 当前实现存在固定误差源，但误差源只有一处：  
  **`OperatorConfigPanel.tsx -> panelSnapshot -> ddd.operator-runtime.character-computed-map.v3`**
- 现在的主链路是：
  - `OperatorConfigPanel.tsx` 先算角色面板
  - 再把 `atk / baseAtk / critRate / critDmg / sourceSkill` 等字段先 `toFixedNumber()`
  - 写入 `panelSnapshot`
  - `storage.ts` 再把这份 round 过的 `panelSnapshot` 写入 `ddd.operator-runtime.character-computed-map.v3`
  - `SkillButton.tsx` / `buffService.ts` 再直接从这份缓存继续算伤害
- 所以现在的问题不是“公式链中段乱 round”，而是**输入给公式的缓存已经被 round 了**。
- 主修复点只在：
  - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
  - `src/types/storage.ts`
  - `src/utils/storage.ts`

[必须改]

1. 文件 / 函数 / 字段
   - 文件：
     - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
   - 函数：
     - 面板计算段（`panelSnapshot: PanelSummary = { ... }`）
   - 问题：
     - 当前 `panelSnapshot` 里的关键计算字段，在写缓存前就被 `toFixedNumber()` 截断：
       - `atk`
       - `baseAtk`
       - `abilityBonus`
       - `mainStatFinal`
       - `subStatFinal`
       - `characterAtk`
       - `weaponAtk`
       - `weaponAtkPercent`
       - `critRate`
       - `critDmg`
       - `sourceSkill`
       - `healingBonus`
       - `ultimateChargeEfficiency`
       - `weaponAllSkillDmgBonus`
   - 原因：
     - `panelSnapshot` 现在混用了“计算缓存”和“展示数值”两种职责。
     - 一旦 `panelSnapshot` 先 round，后面的：
       - `SkillButton.loadPanelData()`
       - `buffService.buildSkillButtonPanelSnapshot()`
       - `anomalyDamageSegments`
       都是在“被截精度的面板”上继续算。
   - 修正要求：
     - `panelSnapshot` 存缓存时，不要再调用 `toFixedNumber()`。
     - 直接写原始 number：
       - `atk`
       - `baseAtk`
       - `abilityBonus * 100`
       - `mainStatFinal`
       - `subStatFinal`
       - `characterBaseAtk`
       - `weaponBaseAtk`
       - `weaponAtkPercent * 100`
       - `critRate`
       - `critDmg`
       - `sourceSkill`
       - `weaponHealingBonus`
       - `weaponUltimateChargeEfficiency`
       - `weaponAllSkillDmgBonus`
     - **只保留** `infoSnapshot` 文案中的 `toFixedNumber()`，因为那是展示层。
   - 验证方式：
     - 运行后检查 `ddd.operator-runtime.character-computed-map.v3`
     - `panel.atk / panel.baseAtk / panel.sourceSkill` 不再只保留 2 位或 4 位小数

2. 文件 / 函数 / 字段
   - 文件：
     - `src/types/storage.ts`
   - 类型：
     - `PanelSummary`
     - `CharacterComputedCache.panel`
   - 问题：
     - 当前类型已经有：
       - `sourceSkill`
     - 但字段语义仍然被默认当作“展示值”，没有明确它是**原始计算缓存值**。
   - 修正要求：
     - 不用改字段名
     - 只需要确保 Trae 在实现时，把这些字段都按“原始 number 缓存值”处理
     - 不要再围绕这些字段做额外格式化包装
   - 验证方式：
     - TS 类型不需要新增字段
     - 只需确认写入值来源不再是 `toFixedNumber()`

3. 文件 / 函数 / 字段
   - 文件：
     - `src/utils/storage.ts`
   - 函数：
     - `mergeV3ToV2()`
     - `setCharacterConfig()`
   - 问题：
     - 这层当前是把 `panelSnapshot` 原样拆到：
       - `ddd.operator-runtime.character-computed-map.v3`
       - `getCharacterConfig()` 的兼容结构
     - 所以这里不是误差源，但它决定了“rounded 缓存会一路向下传播”。
   - 修正要求：
     - 这里**不要新增 round**
     - 维持现在“原样搬运 panel 字段”的逻辑即可
     - 只确认新增/已有字段（尤其 `sourceSkill`）都继续全量透传：
       - `mergeV3ToV2()`: `computed.panel.sourceSkill -> panelSnapshot.sourceSkill`
       - `setCharacterConfig()`: `config.panelSnapshot.sourceSkill -> computed.panel.sourceSkill`
   - 验证方式：
     - `ddd.character-config-map.v1` 兼容读取出来的 `panelSnapshot.sourceSkill`
     - 和 `ddd.operator-runtime.character-computed-map.v3.panel.sourceSkill`
     - 数值一致，不再被额外截断

4. 文件 / 函数 / 调用链
   - 文件：
     - `src/components/CanvasBoard/SkillButton.tsx`
     - `src/core/services/buffService.ts`
   - 函数：
     - `loadPanelData()`
     - `buildSkillButtonPanelSnapshot()`
   - 问题：
     - 这两条链都直接消费 `panelSnapshot / computed.panel`
     - 所以这次不用在这里改公式，只要上游缓存不再 round，误差就会自然收掉
   - 修正要求：
     - **不要改这两个函数的数学公式**
     - 只在改完 `OperatorConfigPanel.tsx` 后做回归确认：
       - `loadPanelData()` 是否拿到了更高精度的 `panelSnapshot`
       - `buildSkillButtonPanelSnapshot()` 是否继续在更高精度的 `computed.panel` 上叠 Buff
   - 验证方式：
     - 不改公式的前提下，`SkillButton` 里的主伤害和异常伤害展示仍正常
     - 只是底层输入精度提高

[可选优化]

- 无。

[不要动]

- 不要改 `calculateSkillButtonDamageV2`
- 不要改 `buffCalculator`
- 不要改 `skillDamageModalViewModel` 的 `formatInteger / formatPercent / formatMultiplier`
- 不要改异常段 `anomalyDamageSegments` 的公式结构
- 不要改 `ddd.skill-button.v1`
- 不要把 `panelSnapshot` 拆成“rawPanel + displayPanel” 两套结构，本轮不需要这种重构

[验收标准 AC]

1. `OperatorConfigPanel.tsx`
   - `panelSnapshot` 写入缓存时不再调用 `toFixedNumber()` 截断数值
   - `infoSnapshot` 文案仍保持当前显示精度

2. `ddd.operator-runtime.character-computed-map.v3`
   - `panel.atk`
   - `panel.baseAtk`
   - `panel.sourceSkill`
   - `panel.critRate`
   - `panel.critDmg`
   不再是预先 round 后的小数

3. `SkillButton.tsx`
   - `loadPanelData()` 不用改公式
   - 但拿到的 `panelData` 来源精度提高

4. `buffService.ts`
   - `buildSkillButtonPanelSnapshot()` 不用改公式
   - 但其输入 `computed.panel` 精度提高

5. 构建
   - `npm run build` 通过

6. 本地验证（IDE 范围内）
   - 检查 sessionStorage：
     - `ddd.operator-runtime.character-computed-map.v3`
   - 确认 `panel.sourceSkill`、`panel.atk` 等字段不是被 `toFixedNumber()` 截成展示精度

[给 Trae 的执行指令]

1. 只改：
   - `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
   - 必要时核对：
     - `src/types/storage.ts`
     - `src/utils/storage.ts`
   - 不要扩散到主伤害计算器。

2. 在 `OperatorConfigPanel.tsx` 的 `panelSnapshot` 组装处，把以下字段从：
   - `toFixedNumber(...)`
   改成：
   - 原始计算值直接写入
   字段名单：
   - `atk`
   - `baseAtk`
   - `abilityBonus`
   - `mainStatFinal`
   - `subStatFinal`
   - `characterAtk`
   - `weaponAtk`
   - `weaponAtkPercent`
   - `critRate`
   - `critDmg`
   - `sourceSkill`
   - `healingBonus`
   - `ultimateChargeEfficiency`
   - `weaponAllSkillDmgBonus`

3. 保留 `infoSnapshot` 文案中的：
   - `toFixedNumber()`
   - `toPercentText()`
   因为那是展示层。

4. 在 `src/utils/storage.ts` 里只确认两条链继续透传，不新增任何 round：
   - `mergeV3ToV2()`
   - `setCharacterConfig()`

5. 完成后必须提交：
   - 修改文件
   - `panelSnapshot` 哪些字段不再提前 round
   - `ddd.operator-runtime.character-computed-map.v3` 一条角色的 `panel.atk / panel.sourceSkill` 前后示例
   - `npm run build` 结果
