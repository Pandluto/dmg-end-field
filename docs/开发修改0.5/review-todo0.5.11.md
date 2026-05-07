# review-todo0.5.11：增幅区独立乘区接入

## [任务理解]

- 本轮不是继续讨论，而是给 Trae 一份可直接开工的增幅区开发执行单。
- `增幅区` 已确认是独立乘区，和 `脆弱区 / 易伤区` 同级，不属于 `伤害加成区`。
- 当前阶段 `脆弱区 / 易伤区 / 增幅区` 都只由 `Buff` 驱动，不接 `EquipmentConfig / equipmentParser / OperatorConfigPanel / infoSnap / panelSnapshot`。
- 本轮目标是把增幅区沿现有 `Buff -> 汇总 -> 计算 -> 弹窗展示` 主链路补齐，并保证不破坏现有 Buff 存储和伤害计算主链路。

## [当前结论]

- 当前代码里没有任何 `增幅区` 运行时字段，也没有 `calculateAmplifyRate()`。
- 现有“独立乘区”的正确接法已经由 `脆弱区 / 易伤区` 证明，主参考文件是：
  - `src/core/calculators/buffCalculator.ts`
  - `src/core/calculators/skillButtonDamageCalculator.ts`
  - `src/components/CanvasBoard/SkillButton.tsx`
- 本轮主修复点不是面板录入层，而是 `Buff type -> buffTotals -> amplifyRate -> 伤害公式 -> 弹窗显示` 这条公共链路。
- 不优先处理历史文档口径、不处理 UI 主题、不处理旧倍率型 Buff 的语义迁移，只先把 `增幅区` 的正式字段族立起来。

## [必须改]

### 1. 新增增幅区字段族

文件：

- `src/core/calculators/buffCalculator.ts`

函数 / 类型：

- `BuffCalculationResult`
- `calculateBuffTotals()`

问题：

- 当前 `BuffCalculationResult` 只有：
  - `physicalFragile / fireFragile / electricFragile / iceFragile / natureFragile / magicFragile`
  - `physicalVulnerability / fireVulnerability / electricVulnerability / iceVulnerability / natureVulnerability / magicTakenDmgBonus`
- 没有任何增幅区字段。

修正要求：

- 在 `BuffCalculationResult` 中新增以下字段，并统一默认值为 `0`：
  - `physicalAmplify`
  - `magicAmplify`
  - `fireAmplify`
  - `electricAmplify`
  - `iceAmplify`
  - `natureAmplify`
- 在 `calculateBuffTotals()` 的 `switch (buff.type)` 中新增对应 `case`：
  - `physicalAmplify`
  - `magicAmplify`
  - `fireAmplify`
  - `electricAmplify`
  - `iceAmplify`
  - `natureAmplify`
- 处理方式和 `Fragile / Vulnerability` 一致：
  - 多个同类 Buff 直接相加
  - 不做乘法链、不做最高值覆盖

验证方式：

- 运行时传入带上述 type 的 `SkillButtonBuff[]`，`calculateBuffTotals()` 返回值能正确累计到对应字段。

---

### 2. 新增按元素取最终增幅区的 helper

文件：

- `src/core/calculators/buffCalculator.ts`

函数：

- 新增 `calculateAmplifyRate()`

问题：

- 当前 `脆弱区 / 易伤区` 已有：
  - `calculateFragileRate(characterElement, buffTotals)`
  - `calculateVulnerabilityRate(characterElement, buffTotals)`
- 增幅区没有对应 helper。

修正要求：

- 新增：

```ts
calculateAmplifyRate(
  characterElement: string | undefined,
  buffTotals: BuffCalculationResult
): number
```

- 取值规则已经确认，必须按以下口径写死：
  - `physical` 伤害：
    - 只吃 `physicalAmplify`
  - 元素伤害：
    - 吃对应元素增幅：
      - `fireAmplify`
      - `electricAmplify`
      - `iceAmplify`
      - `natureAmplify`
    - 再叠加 `magicAmplify`
- 逻辑要求与现有“法术脆弱”口径一致：
  - 元素伤害 = 对应元素字段 + `magicAmplify`

调用链：

- `SkillButton.tsx`
- `calculateSkillButtonDamage()`
- `calculateAmplifyRate()`

验证方式：

- `characterElement = 'physical'` 时，结果只来自 `physicalAmplify`
- `characterElement = 'ice'` 时，结果来自 `iceAmplify + magicAmplify`
- `characterElement = 'fire' / 'electric' / 'nature'` 同理

---

### 3. 把增幅区接入最终伤害公式

文件：

- `src/core/calculators/skillButtonDamageCalculator.ts`

函数 / 类型：

- `DamageBreakdown`
- `SkillButtonDamageResult`
- `calculateHitDamage()`
- `calculateSkillButtonDamage()`

问题：

- 当前总公式只有：
  - `伤害加成区`
  - `防御区`
  - `脆弱区`
  - `易伤区`
  - `连击区`
- 没有增幅区中间态和结果字段。

修正要求：

- 在 `DamageBreakdown` 中新增：
  - `afterAmplify: number`
- 在 `SkillButtonDamageResult` 中新增：
  - `amplifyRate: number`
- 在 `calculateSkillButtonDamage()` 中：
  - 从 `buffTotals` 通过 `calculateAmplifyRate()` 取出 `amplifyRate`
- 在 `calculateHitDamage()` 中新增入参：
  - `amplifyRate`
- 公式顺序按当前项目已有结算结构落地为：

```text
base
-> afterCrit
-> afterBonus
-> afterDefense
-> afterAmplify
-> afterFragile
-> afterVulnerability
-> final
```

- 最终增幅区计算方式固定为：

```text
afterAmplify = afterDefense * (1 + amplifyRate)
```

原因：

- 当前 `脆弱区 / 易伤区` 已经是独立乘区
- 增幅区需要和这两者同级，但不能并入 `damageBonusRate`
- 也不能塞进 `comboDamageBonus`

验证方式：

- 带增幅 Buff 时：
  - `hitResults[].expected.final`
  - `hitResults[].crit.final`
  - `hitResults[].nonCrit.final`
  - `totalExpected / totalCrit / totalNonCrit`
  都会同步变化
- 不带增幅 Buff 时：
  - `amplifyRate = 0`
  - `afterAmplify = afterDefense`

---

### 4. 在技能按钮弹窗中展示增幅区

文件：

- `src/components/CanvasBoard/SkillButton.tsx`

函数 / 渲染块：

- `calculateSkillButtonDamage()` 返回值解构区
- 展开计算过程渲染区
- 逐 hit 明细渲染区

问题：

- 当前弹窗只展示：
  - 伤害加成区
  - 脆弱区
  - 易伤区
  - 连击区
  - 防御区
- 没有“增幅区”。

修正要求：

- 从 `damageResult` 中解构 `amplifyRate`
- 在展开计算过程里新增独立区块：

```text
【增幅区】
增幅区: +xx.x%
物理增幅 / 法术增幅 / 寒冷增幅 / 电磁增幅 / 灼热增幅 / 自然增幅（按有值显示）
```

- 在逐 hit 公式明细里新增一行：

```text
× {(1 + amplifyRate).toFixed(3)} (增幅区)
```

- 展示风格沿用当前 `脆弱区 / 易伤区` 结构，不重做弹窗布局。

验证方式：

- 有增幅 Buff 时，展开计算过程能看到独立“增幅区”
- 无增幅 Buff 时，不出现异常空块或 `undefined`

---

### 5. 给增幅区 type 留出候选 Buff 直通能力

文件：

- `src/components/ToolPanel/components/DamageTab.tsx`
- `src/hooks/useSkillButtonBuffs.ts`

调用链：

- `DamageTab.toSkillButtonBuff()`
- `addSkillButtonBuff()`
- `SkillButton.tsx -> getButtonBuffs()`

问题：

- 当前候选 Buff 到已选 Buff 的转换链对新 type 本身没有阻塞，但增幅区一旦新增 type，Trae 容易误判为需要改存储结构。

修正要求：

- 这轮明确保持现有链路不改：
  - `CandidateBuff.type -> SkillButtonBuff.type`
  - 原样透传
- 不新增额外 mapping，不改 storage key，不改已选 Buff 结构。
- 只要 `type` 是新增的 `*Amplify` 字段，就应通过现有链路进入计算器。

验证方式：

- 新增一个候选 Buff，`type = iceAmplify`，添加到按钮后：
  - `addSkillButtonBuff()` 成功
  - `getButtonBuffs(button.id)` 可读到
  - `calculateBuffTotals()` 能识别

---

### 6. 收口未使用重复计算器，避免改错文件

文件：

- `src/components/CanvasBoard/SkillButtonBuffCalculator.ts`
- `src/core/calculators/buffCalculator.ts`

问题：

- 项目里同时存在：
  - `src/core/calculators/buffCalculator.ts`
  - `src/components/CanvasBoard/SkillButtonBuffCalculator.ts`
- 当前主链路实际使用的是 `src/core/calculators/buffCalculator.ts`。
- 如果 Trae 两边一起改，很容易产生“页面没生效但文件已改”的假完成。

修正要求：

- 本轮以 `src/core/calculators/buffCalculator.ts` 为唯一主真相。
- `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` 本轮不要实现增幅区逻辑，不要顺手重构。
- 如果 Trae 确认该文件完全未被引用，可在结果说明中标记为后续清理项，但本轮不作为主任务。

验证方式：

- 最终页面生效逻辑只依赖 `src/core/calculators/*`
- 不出现“双文件逻辑分叉”

## [可选优化]

- 在 `src/core/calculators/buffCalculator.ts` 对未知 `buff.type` 增加开发态警告，避免后续继续 silent no-op。
- 在 `SkillButton.tsx` 增幅区展示中，仅显示非 0 字段，减少噪音。

## [不要动]

- 不改 `EquipmentConfig`
- 不改 `src/utils/equipmentParser.ts`
- 不改 `src/components/CanvasBoard/components/OperatorConfigPanel.tsx`
- 不改 `infoSnap / panelSnapshot` 结构
- 不改任何 storage key：
  - `def.skill-button.v1`
  - `def.all-buff-list.v1`
  - `def.candidate-buff-list.v1`
  - `def.timeline.data.v1`
- 不把 `增幅区` 合并进 `伤害加成区`
- 不把 `增幅区` 借道 `multiplierBonus / multiplierMultiplier / skillMultiplierBonus`
- 不重做弹窗 UI，不改样式主题

## [验收标准 AC]

- AC1：项目中新增 `physicalAmplify / magicAmplify / fireAmplify / electricAmplify / iceAmplify / natureAmplify` 后，候选 Buff 可以通过现有按钮 Buff 链路进入计算器。
- AC2：`calculateBuffTotals()` 能正确累计上述字段。
- AC3：`calculateAmplifyRate()` 的取值规则满足：
  - 物理伤害只吃 `physicalAmplify`
  - 元素伤害吃 `对应元素 + magicAmplify`
- AC4：`calculateHitDamage()` 中存在独立 `afterAmplify`
- AC5：最终伤害结果真正乘入 `× (1 + amplifyRate)`，不是并到 `damageBonusRate`
- AC6：`SkillButton.tsx` 展开计算过程时能看到独立“增幅区”区块和逐 hit 公式行
- AC7：不带增幅 Buff 的旧角色旧按钮，伤害结果不回退
- AC8：不改存储 key，不影响现有 Buff 添加、删除、恢复

## [回归检查项]

1. 打开任意技能按钮弹窗，确认旧的：
   - 伤害加成区
   - 脆弱区
   - 易伤区
   - 连击区
   - 防御区
   仍正常显示

2. 添加一个 `iceAmplify` Buff：
   - 弹窗“已选 Buff”可见
   - 展开计算过程可见“增幅区”
   - 总伤变化

3. 添加一个 `magicAmplify` Buff 给元素伤害角色：
   - 总伤变化
   - 增幅区值正确叠加

4. 添加一个 `physicalAmplify` Buff 给物理角色：
   - 只影响物理伤害
   - 不误伤元素角色

5. 刷新页面后重新打开技能按钮：
   - 已选 Buff 仍在
   - 增幅区仍能重算

## [给 Trae 的执行指令]

1. 先改 `src/core/calculators/buffCalculator.ts`
   - 新增 6 个 `*Amplify` 字段
   - 新增 `calculateAmplifyRate()`
   - 不动别的区

2. 再改 `src/core/calculators/skillButtonDamageCalculator.ts`
   - 接入 `amplifyRate`
   - 新增 `afterAmplify`
   - 把增幅区插入总公式

3. 再改 `src/components/CanvasBoard/SkillButton.tsx`
   - 补“增幅区”展示
   - 补逐 hit 公式行
   - 不改布局和主题

4. 不要先碰：
   - `OperatorConfigPanel.tsx`
   - `equipmentParser.ts`
   - `storage.ts` 中面板配置结构

5. 完成后必须提交：
   - 修改文件清单
   - 一张增幅 Buff 生效截图
   - 一张技能弹窗里“增幅区”显示截图
   - 一份确认未改 storage key 的说明

