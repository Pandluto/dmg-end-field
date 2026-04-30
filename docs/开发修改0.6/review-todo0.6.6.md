[任务理解]

- 当前 `SkillButton` 伤害弹窗已经不适合继续局部修补，主链同时出现了三类问题：`hit` 解析不稳、伤害计算错误、UI 展示与交互状态错乱。
- 本轮不是继续修某个 bug，而是为 **伤害计算链重写** 先整理“重写前接口”和“重写后目标接口”。
- 本文档只负责给 Trae 下达 **重写前的工程执行单**，不直接落代码。
- 重写范围只收在：
  - 官方 / 本地技能模板到 `ResolvedSkillDamageTemplate`
  - `skillButtonDamageCalculator.ts`
  - `SkillButton.tsx` 伤害弹窗数据消费链
  - 相关 `view model`

[当前结论]

- 当前真正的公共根因不是 `buffService` 写入坏了，而是 **伤害计算接口设计没有收敛**。
- 现在的 `SkillButton.tsx` 同时负责：
  - 读取运行时模板
  - 读取 Buff
  - 读取面板快照
  - 调计算器
  - 管理选中 hit
  - 管理展开状态
  - 渲染总览 / hit 列表 / hit 详情 / 公式区
- 现在的 `skillButtonDamageCalculator.ts` 同时存在：
  - per-hit 计算
  - 旧技能级思维残留
  - 区间职责混乱
  - 展示接口和计算接口直接耦合
- 当前主修复点不是 `SelectionPanel`、不是拖拽、不是时间轴恢复、不是 `OperatorConfigPanel`。本轮只收 **伤害模板 -> 计算器 -> 弹窗 view model** 这条链。
- 进一步收敛后的实现原则已经明确：
  - **不推翻旧单段数学公式**
  - **只替换旧 skill 主导的调用壳**
  - **把每个 hit 包装成“只有一段的 skill”去调用旧单段计算链**

[重写前接口现状]

1. 运行时模板层
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts)
   - 当前字段：
     - `RuntimeOperatorTemplate`
     - `RuntimeOperatorTemplateSkill`
     - `RuntimeOperatorTemplateHit`
   - 当前 hit 字段：
     - `key`
     - `displayName`
     - `multiplier`
     - `element`
     - `skillType`
   - 当前问题：
     - 官方技能 hit 仍依赖 `extractHitsFromMultiplier()` 猜字段名
     - 本地技能 hit 直接来自 draft，结构更稳定
     - 官方 / 本地虽然最终同型，但官方解析规则不够稳

2. Buff 主表层
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\buffService.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\buffService.ts)
   - 当前字段：
     - `SkillButtonBuff`
     - `target?: SkillButtonBuffTarget`
   - 当前 target 模式：
     - `{ mode: 'all' }`
     - `{ mode: 'damageKey'; key: string }`
     - `{ mode: 'skillType'; skillType: SkillType }`
     - `{ mode: 'element'; element: ElementType }`
   - 主存储：
     - `ddd.all-buff-list.v1`
   - 当前按钮引用：
     - `PersistedSkillButton.selectedBuff: string[]`
   - 结论：
     - Buff 写入主链现在不应重写，只应作为新计算器输入来源

3. 按钮持久化层
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts)
   - 当前字段：
     - `PersistedSkillButton.runtimeSkillId`
     - `skillDisplayName`
     - `skillIconUrl`
     - `customHits`
     - `selectedBuff`
     - `panelSnapshot`
   - 主存储：
     - `ddd.skill-button.v1`
   - 结论：
     - 当前按钮身份链已可支撑重写，不要这轮改按钮存储结构

4. 计算器层
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
   - 当前输入：
     - `SkillButtonDamageInput`
       - `buffList`
       - `hits`
       - `panelData`
       - `infoSnap`
   - 当前输出：
     - `SkillButtonDamageResult`
       - `hits: HitDamageResult[]`
       - `summary`
   - 当前问题：
     - 输入字段 `infoSnap` 语义过于含糊
     - `calculateSingleHit()` 同时承担：
       - Buff 过滤
       - 区间汇总
       - 倍率修正
       - 暴击/不暴/期望伤害
     - 输出结构虽然是 hit 主导，但没有给 UI 一个稳定的 view model
     - 区间职责目前已经混乱：
       - `fragileRate / vulnerabilityRate` 曾写反
       - `allDmgBonus` 与 `elementDmgBonus` 容易双算

5. 弹窗消费层
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 当前状态字段：
     - `runtimeHits`
     - `selectedHitIndex`
     - `isExpanded`
     - `panelData`
     - `infoSnap`
     - `buffList`
   - 当前调用链：
     - `getRuntimeOperatorTemplateById(button.characterId)`
     - `loadRuntimeSkillData()`
     - `calculateSkillButtonDamage(...)`
     - JSX 直接消费 calculator 原始结果
   - 当前问题：
     - `SkillButton.tsx` 直接绑定 calculator 细节
     - JSX 内部还在做“展示逻辑 + 公式拼装 + 选中态判断”
     - 组件职责过重

[重写后目标接口]

1. 模板解析接口：`ResolvedSkillDamageTemplate`
   - 建议定义位置：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts)
     - 或新增 `src/core/calculators/skillDamage.types.ts`
   - 目标字段：
     - `characterId: string`
     - `characterName: string`
     - `runtimeSkillId: string`
     - `displayName: string`
     - `buttonType: SkillType`
     - `hits: ResolvedHitTemplate[]`
   - `ResolvedHitTemplate` 字段：
     - `key: string`
     - `displayName: string`
     - `multiplier: number`
     - `element: ElementType`
     - `skillType: SkillType`
   - 调用链：
     - `SkillButton -> resolveSkillTemplate(button) -> calculator`
   - 目标：
     - 官方 / 本地到这里全部统一
     - `SkillButton` 后面不再关心来源是官方还是 local

2. 计算输入接口：`SkillDamageCalcInputV2`
   - 建议定义位置：
     - `src/core/calculators/skillDamage.types.ts`
   - 目标字段：
     - `buttonId: string`
     - `characterId: string`
     - `runtimeSkillId: string`
     - `template: ResolvedSkillDamageTemplate`
     - `buffs: SkillButtonBuff[]`
     - `panel:`
       - `atk`
       - `critRate`
       - `critDmg`
     - `damageBonus: DamageBonusSnapshot`
   - 说明：
     - 这里明确把当前 `infoSnap` 改名为 `damageBonus`
     - 不允许 `calculator` 再去猜这个对象是什么语义

3. 计算输出接口：`SkillDamageCalcResultV2`
   - 建议定义位置：
     - `src/core/calculators/skillDamage.types.ts`
   - 顶层字段：
     - `summary`
       - `totalExpected`
       - `totalCrit`
       - `totalNonCrit`
     - `hits: HitCalcResult[]`
   - `HitCalcResult` 必须包含：
     - `hit: ResolvedHitTemplate`
     - `appliedBuffs: SkillButtonBuff[]`
     - `zones`
       - `elementBonus`
       - `skillBonus`
       - `allDamageBonus`
       - `amplifyRate`
       - `fragileRate`
       - `vulnerabilityRate`
       - `comboDamageBonus`
       - `defenseZone`
     - `multiplier`
       - `base`
       - `afterBonus`
       - `afterMultiply`
     - `nonCrit: DamageBreakdown`
     - `crit: DamageBreakdown`
     - `expected: DamageBreakdown`
   - 目的：
     - calculator 输出直接可供“详情区 + 展开区”消费
     - JSX 不再自己拼乘区和倍率逻辑

4. UI 视图接口：`SkillDamageModalViewModel`
   - 建议定义位置：
     - `src/components/CanvasBoard/skillDamageModalViewModel.ts`
     - 或 `src/core/calculators/buildSkillDamageModalViewModel.ts`
   - 目标字段：
     - `header`
       - `displayName`
       - `buttonType`
       - `hitCount`
     - `summary`
     - `hitCards[]`
       - `key`
       - `displayName`
       - `multiplierText`
       - `expectedText`
       - `buffCountText`
       - `isSelected`
     - `activeHitDetail`
       - `title`
       - `elementText`
       - `multiplierText`
       - `expectedText`
       - `critText`
       - `nonCritText`
       - `appliedBuffTags[]`
     - `activeHitFormula`
       - `atkText`
       - `zones[]`
       - `multiplierLines[]`
       - `breakdownLines[]`
   - 目标：
     - `SkillButton.tsx` 只做 view model 渲染
     - 不在 JSX 里再写任何业务计算规则

[核心实现策略（已确认）]

1. 不是整份计算器推倒重写
   - 当前确认的方向不是“重写所有伤害公式”，而是：
     - 保留旧的单段伤害数学链
     - 废弃旧的 skill 主导输入壳
     - 新增 hit 遍历层与汇总层

2. 把每个 hit 当成“只有一段的 skill”去调用旧公式
   - 旧模式：
     - 一个 `skill`
     - `damage = { hit1, hit2, hit3 }`
     - 先整技能算公共上下文
     - 再给每段 hit 出结果
   - 新模式：
     - `hit1` 单独包装成一个“单段 skill 输入”
     - `hit2` 单独包装成一个“单段 skill 输入”
     - `hit3` 单独包装成一个“单段 skill 输入”
     - 每段单独调用旧单段公式
     - 最后再聚合成 `summary`

3. 旧公式里可以保留的部分
   - 可复用函数：
     - `calculateHitDamage(...)`
     - `applyMultiplierBuffToHit(...)`
     - `doesBuffApplyToHit(...)`
     - `filterBuffsForHit(...)`
     - `calculateBuffTotals(...)`
     - `calculateElementDmgBonus(...)`
     - `calculateSkillDmgBonus(...)`
     - `calculateAmplifyRate(...)`
     - `calculateFragileRate(...)`
     - `calculateVulnerabilityRate(...)`
   - 说明：
     - 这些函数的本质是“给定一段命中的输入，产出该段的数学结果”
     - 它们不依赖 React，不依赖弹窗，不依赖时间轴

4. 旧壳里不能直接继承的部分
   - 不能直接复用：
     - `calculateSkillButtonDamage(...)` 整体入口
     - `calculateSingleHit(...)` 当前实现
     - 旧版 `processDamageMultiplier(...)`
   - 原因：
     - 这些部分带着旧 skill 主导假设：
       - 一个 skill 一个 `skillType`
       - 一个 skill 一个 `element`
       - 一次 `calculateBuffTotals(buffList)` 供全技能复用
       - 默认整技能结果结构
       - 默认只改最后一段倍率

5. 这次真正要替换的，不是公式主体，而是“入口壳”和“出口壳”
   - 新入口壳：
     - 对每个 hit 单独构造输入
   - 新出口壳：
     - 每个 hit 返回完整结果
     - 最后聚合成 `summary`
   - 这就是本轮的最小改动方向

[必须改]

1. 抽模板解析入口，停止让 `SkillButton.tsx` 自己理解官方 / 本地技能来源
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 问题：
     - 现在 `SkillButton` 还在直接：
       - 取模板
       - 用 `runtimeSkillId` / `buttonType` 查技能
       - 取 `skill.hits`
   - 原因：
     - 模板解析职责没有收敛到统一入口
   - 修正要求：
     - 新增 `resolveSkillDamageTemplate(button)` 公共函数
     - 输入：
       - `button`
     - 输出：
       - `ResolvedSkillDamageTemplate | null`
     - `SkillButton.tsx` 不再自己写查找逻辑
   - 验证方式：
     - 官方角色与本地角色都只走这一入口

2. 抽官方技能命中解析入口，停止只靠 `extractHitsFromMultiplier()` 猜字段
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts)
   - 问题：
     - 当前 `extractHitsFromMultiplier()` 仍属于补丁式兼容
   - 原因：
     - 官方数据命名不统一：
       - `hit1`
       - `hit1Damage`
       - `phantomDamage`
       - `slashBaseDamage`
   - 修正要求：
     - 新增 `resolveOfficialSkillHits(characterName, skillType, damage, multipliers, hitCount)`
     - 优先顺序：
       1. `damage[level]`
       2. `hitXDamage`
       3. `hitX`
       4. 单段白名单
     - 最终统一返回 `ResolvedHitTemplate[]`
   - 验证方式：
     - `别礼 A/B/E/Q` 全部按官方真相产出正确段数和倍率

3. 重新定义计算器输入输出，不允许再直接在旧接口上打补丁
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
   - 问题：
     - 当前接口已经混入旧思维和新字段，继续修会越补越乱
   - 原因：
     - 没有明确的 V2 接口边界
   - 修正要求：
     - 定义 `SkillDamageCalcInputV2`
     - 定义 `SkillDamageCalcResultV2`
     - `calculateSkillButtonDamage()` 重写为只吃 `V2`
   - 验证方式：
     - `SkillButton.tsx` 后续只拿 `V2 result`

3.1 计算器重写必须采用“单 hit 调旧链”的方式，不要整份公式推翻
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculatorV2.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculatorV2.ts)
   - 问题：
     - 当前主文件只是“旧 skill 计算器的 hit 外壳版”
   - 原因：
     - 旧主入口假设：
       - 一个 skill 整体输入
       - 一个 skill 整体输出
   - 修正要求：
     - V2 不要继续照搬整个旧主入口
     - 正确方式是：
       1. 遍历 `template.hits`
       2. 对每个 hit 过滤 Buff
       3. 对每个 hit 计算自己的 `buffTotals`
       4. 对每个 hit 单独调用旧单段数学链
       5. 记录每个 hit 的结果
       6. 最后聚合 `summary`
   - 验证方式：
     - 任一 hit 都能脱离其它 hit 单独求值
     - `summary` 仅为聚合，不再先天携带技能级公共上下文

4. `buffCalculator.ts` 只保留区间汇总职责，不再让 `SkillButton.tsx` 补区间语义
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts)
   - 问题：
     - 当前区间计算和 UI 语义脱节
   - 原因：
     - `SkillButton.tsx` 还在自己解释结果
   - 修正要求：
     - `buffCalculator` 只负责：
       - 汇总 Buff
       - 给 calculator 提供各区间纯函数
     - calculator 再把这些组装为 `HitCalcResult`
     - JSX 不再自己解释区间
   - 验证方式：
     - JSX 中不再出现区间推导判断

5. `SkillButton.tsx` 降级为“view model + UI 交互”
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 问题：
     - 当前组件承担了过多职责
   - 原因：
     - 没有中间 view model
   - 修正要求：
     - 新增 `buildSkillDamageModalViewModel(...)`
     - `SkillButton.tsx` 改为：
       - 读取 `ResolvedSkillDamageTemplate`
       - 读取 `buffList`
       - 读取 `panel + damageBonus`
       - 调 `calculateSkillButtonDamageV2`
       - 调 `buildSkillDamageModalViewModel`
       - 渲染
   - 验证方式：
     - `SkillButton.tsx` 内业务计算明显减少，只保留事件和渲染

[分阶段执行顺序]

1. 第一阶段：接口冻结
   - 只新增类型和函数签名
   - 不切 UI
   - 产出：
     - `ResolvedSkillDamageTemplate`
     - `SkillDamageCalcInputV2`
     - `SkillDamageCalcResultV2`
     - `SkillDamageModalViewModel`

2. 第二阶段：模板解析重写
   - 只重写：
     - `resolveOfficialSkillHits`
     - `resolveSkillDamageTemplate`
   - 不动弹窗 JSX

3. 第三阶段：计算器重写
   - `skillButtonDamageCalculator.ts` 切到 `V2`
   - 重写方式不是整套公式推翻，而是：
     - 先保留旧单段数学链
     - 再把“每个 hit 包装成单段 skill 输入”喂给它
   - 先保证：
     - 每个 hit 独立 Buff 过滤
     - 每个 hit 独立区间结果
     - 每个 hit 独立倍率修正
     - summary 正确聚合

4. 第四阶段：view model
   - 新增 `buildSkillDamageModalViewModel`
   - 先把 calculator 原始输出映射成 UI 所需字段

5. 第五阶段：`SkillButton.tsx` 切 UI
   - 最后才让弹窗消费新 view model
   - 这时再清理旧 state 与旧 JSX 结构

[可选优化]

- 无。

[不要动]

- 不要改 `buffService.ts` 的写入主链
- 不要改 `useSkillButtonBuffs.ts` 的对外 API
- 不要改 `timelineService.ts`
- 不要改 `SelectionPanel`
- 不要改按钮吸附 / 复制 / 恢复位置
- 不要把 `ddd.operator-runtime.template-map.v1` 再改回全量角色仓库
- 不要这轮顺手重构 `OperatorConfigPanel`

[验收标准 AC]

- AC1：Trae 必须先提交“旧接口 -> 新接口”对照，不得直接继续 patch 现有 JSX
- AC2：第一阶段完成后，代码库中能明确看到：
  - `ResolvedSkillDamageTemplate`
  - `SkillDamageCalcInputV2`
  - `SkillDamageCalcResultV2`
  - `SkillDamageModalViewModel`
- AC3：第二阶段完成后，`别礼 Q` 的目标 `hits[]` 必须能稳定得到：
  - `hit1: 4.0`
  - `hit2: 4.0`
  - `hit3: 8.0`
- AC4：重写第一阶段不改 Buff 写入链，只把 `getButtonBuffs(button.id)` 作为 calculator 输入来源
- AC5：最终 `SkillButton.tsx` 只允许消费：
  - `ResolvedSkillDamageTemplate`
  - `SkillDamageCalcResultV2`
  - `SkillDamageModalViewModel`
  三层，不得再在 JSX 里推导乘区
- AC6：整个重写计划必须能在 IDE 内分阶段验证，不依赖抽象描述

[回归检查项]

- 模板层
  - 官方角色 `别礼 A/B/E/Q` 的 `hits[]` 是否正确
  - 本地双 `Q` 是否仍按 `runtimeSkillId` 精准命中
- Buff 主链
  - `addSkillButtonBuff()` 写入后，`getButtonBuffs(button.id)` 还能稳定读取
  - `target=hit2` 与 `target=hit3` 不合并
- 计算层
  - 每个 hit 的 `appliedBuffs` 独立
  - summary 仅做聚合，不再回头推导
- 弹窗层
  - 总览 / hit 列表 / hit 详情 / 公式区都只消费 view model

[给 Trae 的执行指令]

1. 先不要继续改现有 `SkillButton.tsx` 的 JSX 细节。
2. 第一提交只做接口定义：
   - `ResolvedSkillDamageTemplate`
   - `SkillDamageCalcInputV2`
   - `SkillDamageCalcResultV2`
   - `SkillDamageModalViewModel`
3. 第二提交只做模板解析：
   - `resolveOfficialSkillHits(...)`
   - `resolveSkillDamageTemplate(button)`
4. 第三提交再重写 calculator：
   - 切到 `V2`
   - 不动 Buff 写入链
5. 第四提交最后切 `SkillButton.tsx` 到新 view model。
6. 每一阶段完成后都必须提交：
   - 改动文件
   - 接口定义
   - 示例数据
   - 手测路径
   - `npm run build` 结果

[代码实施说明]

1. 第一阶段：接口冻结，先落类型，不动现有 UI
   - 目标文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts)
     - 或新增 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillDamage.types.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillDamage.types.ts)
   - 要新增的类型：
     - `ResolvedHitTemplate`
     - `ResolvedSkillDamageTemplate`
     - `SkillDamageCalcInputV2`
     - `SkillDamageCalcResultV2`
     - `HitCalcResult`
     - `SkillDamageModalViewModel`
   - 实施要求：
     - 不要直接删除旧的 `SkillButtonDamageInput` / `SkillButtonDamageResult`
     - 第一阶段只新增 `V2` 类型，旧类型先保留，避免一次性炸全项目
     - `SkillDamageCalcInputV2.damageBonus` 直接复用 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts) 里的 `DamageBonusSnapshot`
   - 代码落点：
     - `ResolvedHitTemplate` 字段必须与当前 `RuntimeOperatorTemplateHit` 一致，避免后续转换时再多一次适配
     - `HitCalcResult` 必须显式区分：
       - `zones`
       - `multiplier`
       - `nonCrit`
       - `crit`
       - `expected`

2. 第二阶段：抽技能解析入口，停止让 `SkillButton.tsx` 自己查模板
   - 目标文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\operatorTemplateAdapter.ts)
     - 可新增 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\skillDamageTemplateResolver.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\skillDamageTemplateResolver.ts)
   - 目标函数：
     - `resolveOfficialSkillHits(...)`
     - `resolveSkillDamageTemplate(button)`
   - `resolveOfficialSkillHits(...)` 输入：
     - `characterName`
     - `buttonType`
     - `damage`
     - `multipliers`
     - `hitCount`
     - `element`
   - `resolveOfficialSkillHits(...)` 输出：
     - `ResolvedHitTemplate[]`
   - 实施要求：
     - 先走 `damage[level]`
       - 因为这是官方最接近“真实命中段”的表
     - 再走 `multipliers`
       - 只用于 `execute / plunge / phantomDamage / slashBaseDamage` 这类扩展命中补位
     - 不允许继续只靠 `extractHitsFromMultiplier()` 一个函数兜所有情况
   - `resolveSkillDamageTemplate(button)` 调用链：
     - `getRuntimeOperatorTemplateById(button.characterId)`
     - 先按 `button.runtimeSkillId`
     - 再 fallback `button.skillType`
     - 最终返回 `ResolvedSkillDamageTemplate`
   - 注意：
     - fallback 保留，但必须继续带 `console.warn`
     - 这个 warn 不能删，否则本地多技能串技能时会再次黑盒

3. 第三阶段：重写 calculator，但只切到 V2，不改 Buff 写入链
   - 目标文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts)
   - 重写顺序：
     1. 新增 `calculateSkillButtonDamageV2(input: SkillDamageCalcInputV2)`
     2. 旧 `calculateSkillButtonDamage()` 暂时保留
     3. 等 `SkillButton.tsx` 切完后，再决定是否删除旧函数
   - `calculateSkillButtonDamageV2()` 内部分层：
     - `filterBuffsForHit(hit, buffs)`
     - `calculateHitZones(hit, buffTotals, damageBonus)`
     - `applyMultiplierAdjustments(hit.multiplier, buffTotals)`
     - `calculateHitBreakdown(panel.atk, crit, zones, multiplier)`
     - `aggregateSkillSummary(hitResults)`
   - 本阶段的实现思想必须明确：
     - 不是再做一个“技能级总入口”
     - 而是：
       - 每个 `hit` 构造成一份单段输入
       - 单独调用旧单段公式链
       - 返回单独结果
       - 最后再汇总
   - 换句话说：
     - **新 V2 的主语是 hit**
     - **旧单段数学链只是被复用**
   - 明确禁止：
     - 不要在 `calculateSingleHit()` 里继续混写所有逻辑
     - 不要在 JSX 再算一次 `damageBonusRate`
   - 关键修正：
     - `fragileRate` 只调 `calculateFragileRate()`
     - `vulnerabilityRate` 只调 `calculateVulnerabilityRate()`
     - `allDamageBonus` 和 `allElementDmgBonus` 只能算一次
   - 实施方式：
     - 给 `zones` 明确拆字段：
       - `elementBonus`
       - `skillBonus`
       - `allDamageBonus`
       - `damageBonusRate`
     - 这样后面 UI 直接显示 `zones.damageBonusRate`
   - 迁移口径：
     - 旧入口里这些字段要按 hit 迁移：
       - `characterElement` -> `hit.element`
       - `skillType` -> `hit.skillType`
       - `damage` -> 单个 `hit.multiplier`
       - `buffList` -> `filterBuffsForHit(hit, buffs)` 后的 `appliedBuffs`
     - 旧入口里这些字段保持角色级共享：
       - `panelData`
       - `damageBonus`

4. 第四阶段：抽 view model，把 JSX 和计算结果解耦
   - 目标文件：
     - 新增 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\skillDamageModalViewModel.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\skillDamageModalViewModel.ts)
   - 目标函数：
     - `buildSkillDamageModalViewModel(params)`
   - 输入：
     - `template: ResolvedSkillDamageTemplate`
     - `result: SkillDamageCalcResultV2`
     - `selectedHitIndex: number | null`
   - 输出：
     - `SkillDamageModalViewModel`
   - 实施要求：
     - 把所有“显示文字格式化”都收进这里：
       - `400%`
       - `总伤(期望)`
       - `无 Buff`
       - `临终别礼 / Q / 3段`
     - `SkillButton.tsx` 不要自己再做：
       - `multiplier * 100`
       - `summary.totalExpected.toFixed(0)`
       - `activeHit.appliedBuffs.length > 0 ? ...`
   - 目的：
     - 把“算完后的展示逻辑”从 JSX 挪出去

5. 第五阶段：切 `SkillButton.tsx`，只消费 resolver + calculator V2 + view model
   - 目标文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 先删的内容：
     - 旧 `runtimeHits` state
     - 旧 `damageResult` 直接消费逻辑
     - JSX 内部的 `activeHit.hit.multiplier}%`
     - JSX 内部手写的区间说明
   - 新的调用顺序：
     1. `loadBuffList()`
     2. `loadPanelData()`
     3. `resolveSkillDamageTemplate(button)`
     4. `calculateSkillButtonDamageV2(...)`
     5. `buildSkillDamageModalViewModel(...)`
     6. JSX 渲染
   - 状态字段保留：
     - `isModalOpen`
     - `buffList`
     - `panelData`
     - `selectedHitIndex`
     - `isExpanded`
   - 状态字段删除方向：
     - `runtimeHits` 最终应变成派生值，而不是本地 state
   - 关键要求：
     - `selectedHitIndex` 只负责“当前选中哪一段”
     - `isExpanded` 只负责“当前选中段的公式区展开/收起”
     - 不要再让 `SkillButton.tsx` 同时承担模板解析职责

6. 第六阶段：补 CSS，不再复用旧 `.skill-damage-hit-row`
   - 目标文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css)
   - 必补类名：
     - `.skill-damage-hit-card`
     - `.skill-damage-hit-card.selected`
     - `.hit-card-header`
     - `.hit-name`
     - `.hit-multiplier`
     - `.hit-card-damage`
     - `.damage-expected`
     - `.hit-card-buffs`
     - `.buff-count`
     - `.skill-damage-hit-detail`
     - `.hit-detail-stats`
     - `.hit-detail-buffs`
     - `.buff-tag`
     - `.no-buff`
     - `.skill-damage-expanded`
   - 实施要求：
     - 不要继续让新 JSX 复用 `.skill-damage-hit-row`
     - 先把布局补完整，再调视觉细节

7. Buff 写入链本轮只做“接口对齐说明”，不改实现
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\hooks\useSkillButtonBuffs.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\hooks\useSkillButtonBuffs.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\buffService.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\services\buffService.ts)
   - 当前保留接口：
     - `addSkillButtonBuff`
     - `removeSkillButtonBuff`
     - `getButtonBuffs`
   - 原因：
     - 当前“添加 Buff 失效”更像是消费链坏，不是写入链坏
   - 实施要求：
     - 第一轮重写不要改这些函数签名
     - 只把 `getButtonBuffs(button.id)` 结果喂给 `SkillDamageCalcInputV2.buffs`

8. 验收时必须按阶段提交，不接受“一次性全改完”
   - 提交 1：
     - 新类型定义
   - 提交 2：
     - 模板解析重写
   - 提交 3：
     - calculator V2
   - 提交 4：
     - view model
   - 提交 5：
     - `SkillButton.tsx` 切换
   - 每次提交都必须带：
     - 改动文件
     - 示例输入
     - 示例输出
     - 手测路径
     - `npm run build` 结果
