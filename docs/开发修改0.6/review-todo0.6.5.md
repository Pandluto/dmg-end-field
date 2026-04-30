[Review 结论]

- 不可接受。当前“伤害弹窗 hit 主导版”虽然能打开，但**计算和展示同时有错**，不是单点样式问题。
- 主阻塞点有三组：
  1. `SkillButton.tsx` 的 UI 结构和显示格式不完整
  2. `skillButtonDamageCalculator.ts` 的乘区计算有明确逻辑错误
  3. `SkillButton.css` 没有跟上新 JSX 结构，导致 hit 卡片和详情区样式残缺

[问题列表]

1. P0：倍率显示单位错，`4.0` 被直接渲染成 `4%`，应为 `400%`
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 函数：
     - `SkillButtonComponent`
   - 调用链：
     - `loadRuntimeSkillData()` 读取 `RuntimeOperatorTemplateHit.multiplier`
     - `damageResult = calculateSkillButtonDamage(...)`
     - JSX 渲染 `hitResult.hit.multiplier`
   - 原因：
     - 运行时模板里的倍率是真实倍数值，例如：
       - `4.0` 表示 `400%`
       - `8.0` 表示 `800%`
     - 当前 JSX 直接写：
       - `hitResult.hit.multiplier}%`
       - `activeHit.hit.multiplier}%`
     - 少了 `×100`
   - 影响：
     - UI 直接误导用户，以为 Q 三段是 `4% / 4% / 8%`
     - 用户对伤害结果的信任直接崩掉
   - 修正要求：
     - `SkillButton.tsx` 所有“倍率显示”都统一改成：
       - `(multiplier * 100).toFixed(...) + '%'`
     - 不要改计算器里的倍率真值，只改显示层
   - 修正位置：
     - hit 卡片头部 `.hit-multiplier`
     - hit 详情区 `倍率:`
     - 展开计算过程里如果后续显示倍率，也同样改
   - 验证方式：
     - `别礼 Q` 显示应为：
       - 第1击 `400%`
       - 第2击 `400%`
       - 第3击 `800%`

2. P0：脆弱区 / 易伤区调用写反，当前计算结果语义错误
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts)
   - 函数：
     - `calculateSingleHit()`
     - `calculateFragileRate()`
     - `calculateVulnerabilityRate()`
   - 调用链：
     - `calculateSkillButtonDamage()`
     - `calculateSingleHit(hit, ...)`
     - `fragileRate = calculateVulnerabilityRate(...)`
     - `vulnerabilityRate = calculateFragileRate(...)`
   - 原因：
     - 现在代码明确写反了：
       - `fragileRate` 调的是 `calculateVulnerabilityRate`
       - `vulnerabilityRate` 调的是 `calculateFragileRate`
   - 影响：
     - 所有 hit 的“脆弱区 / 易伤区”显示和结果都错位
     - 展开计算过程里的区间标签也是假的
   - 修正要求：
     - 这两行直接对调回正确语义：
       - `fragileRate = calculateFragileRate(...)`
       - `vulnerabilityRate = calculateVulnerabilityRate(...)`
     - 不要改函数名，不要扩散重构
   - 验证方式：
     - 加一个寒冷脆弱 Buff，只应进入脆弱区
     - 加一个寒冷易伤 Buff，只应进入易伤区

3. P0：非物理 hit 的伤害加成区被重复计入，当前总伤偏高
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\buffCalculator.ts)
   - 函数：
     - `calculateSingleHit()`
     - `calculateElementDmgBonus()`
   - 调用链：
     - `calculateSingleHit()`
     - `elementDmgBonus = calculateElementDmgBonus(hit.element, infoSnap, buffTotals)`
     - `allDmgBonus = infoSnap.allDmgBonus + buffTotals.allElementDmgBonus`
     - `damageBonusRate = 1 + elementDmgBonus + skillDmgBonus + allDmgBonus`
   - 原因：
     - `calculateElementDmgBonus()` 对非物理元素已经把这些加进去了一次：
       - `buffTotals.allElementDmgBonus`
       - `parsedDamageBonus.allElementDmgBonus`
       - `parsedDamageBonus.allDmgBonus`
     - 但 `calculateSingleHit()` 又额外加了：
       - `infoSnap.allDmgBonus`
       - `buffTotals.allElementDmgBonus`
     - 结果：
       - `allDmgBonus` 和 `allElementDmgBonus` 被重复计入
   - 影响：
     - 所有冰/火/电/自然/法术 hit 的最终伤害偏高
     - `别礼 Q` 这种寒冷技能当前总伤不可信
   - 修正要求：
     - 先确定职责边界：
       - `calculateElementDmgBonus()` 只负责元素区
       - `allDmgBonus` 只负责全伤区
     - 最小改法：
       - 从 `calculateElementDmgBonus()` 去掉 `parsedDamageBonus.allDmgBonus` 与 `buffTotals.allElementDmgBonus` 之外不该混入的全伤区逻辑
       - 或者在 `calculateSingleHit()` 不再重复叠加已经算进 `elementDmgBonus` 的项
     - 关键原则：
       - 每个乘区只能算一次
   - 验证方式：
     - 用同一套 panel / buff，手算 `damageBonusRate`
     - 控制台输出和公式区应一致，不再双算

4. P1：`SkillButton.css` 没有为新 JSX 结构补齐样式，导致 hit 列表和详情区显示残缺
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css)
   - 函数：
     - `SkillButtonComponent`
   - 调用链：
     - JSX 使用新 class：
       - `skill-damage-hit-card`
       - `hit-card-header`
       - `hit-name`
       - `hit-multiplier`
       - `hit-card-damage`
       - `damage-expected`
       - `hit-card-buffs`
       - `buff-count`
       - `hit-detail-stats`
       - `hit-detail-buffs`
       - `buff-tag`
       - `no-buff`
     - CSS 里仍主要是旧结构：
       - `skill-damage-hit-row`
       - `hit-value.*`
   - 原因：
     - JSX 已经改成“hit 卡片式”
     - CSS 还停留在旧“row 结构”
   - 影响：
     - 你现在看到的“显示不完整”“点击展开后内容错乱”，一部分就是样式断层造成的
     - 例如：
       - hit 卡片没有明确布局
       - 详情区内的 Buff tag 没样式
       - 选中态不明显
       - 展开区和详情区层级混乱
   - 修正要求：
     - `SkillButton.css` 必须补齐新 class 的完整样式
     - 最小必补：
       - `.skill-damage-hit-card`
       - `.skill-damage-hit-card.selected`
       - `.hit-card-header`
       - `.hit-name`
       - `.hit-multiplier`
       - `.hit-card-damage`
       - `.damage-expected`
       - `.hit-card-buffs`
       - `.buff-count`
       - `.hit-detail-stats`
       - `.hit-detail-buffs`
       - `.buff-tag`
       - `.no-buff`
     - 不要继续复用 `.skill-damage-hit-row` 的旧语义
   - 验证方式：
     - hit 列表卡片对齐完整
     - 选中 hit 有清晰状态
     - 详情区文案不再挤压/缺块

5. P1：展开区内容不完整，当前没有真正展示“计算过程”，只是几个结果字段
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 函数：
     - `SkillButtonComponent`
   - 调用链：
     - 点击 `展开计算过程`
     - 渲染 `.skill-damage-expanded`
   - 原因：
     - 当前展开区只显示：
       - ATK
       - 元素伤害加成
       - 伤害加成区
       - 增幅区
       - 脆弱区
       - 易伤区
       - 防御区
     - 但没有把本次 hit 的关键过程完整串起来：
       - 命中的 Buff 列表
       - 最终倍率（应用 `multiplierBonus` / `multiplierMultiplier` 后）
       - 暴击倍率
       - base → afterBonus → afterDefense → afterAmplify → afterFragile → afterVulnerability → final 的拆解
   - 影响：
     - 用户点击“展开”后看不到真正想要的技能伤害过程
     - 当前 UI 只有标题变多了，不构成可核对的计算链
   - 修正要求：
     - 直接消费 `activeHit.nonCrit / crit / expected` 里的 `DamageBreakdown`
     - 展开区最少补这几行：
       - 最终倍率
       - 基础伤害 `base`
       - 加成后 `afterBonus`
       - 防御后 `afterDefense`
       - 增幅后 `afterAmplify`
       - 脆弱后 `afterFragile`
       - 易伤后 `afterVulnerability`
       - 最终 `final`
     - 同时把 `activeHit.appliedBuffs` 名单显示在展开区顶部，别只在详情区显示“无”
   - 验证方式：
     - 点击展开后，能看到一个完整可追踪的数值链，而不是几个散列字段

6. P1：总标题仍在用 `SKILL_LABELS[skillType]`，和当前技能名脱节
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 函数：
     - `SkillButtonComponent`
   - 调用链：
     - 弹窗伤害总览区
     - `skill-damage-title`
   - 原因：
     - 当前标题显示：
       - `SKILL_LABELS[skillType] + runtimeHits.length + 段`
     - 这会变成：
       - `Q 3段`
     - 没有真正显示技能名 `临终别礼`
   - 影响：
     - 用户看到的总览主语仍然是旧四键，不是技能身份
     - 对本地多技能/同类技能尤其不友好
   - 修正要求：
     - 标题改成：
       - `${displayName} / ${skillType} / ${runtimeHits.length}段`
     - 不要只显示 `Q 3段`
   - 验证方式：
     - `别礼 Q` 应显示 `临终别礼 / Q / 3段`

[风险列表]

- `SkillButtonComponent` 现在底座文案写成了 `<span className="skill-button-name">{skillType} {displayName}</span>`，这会把 `skillType` 和技能名混在一处，和之前你要求的“只显示技能名、不重复 type”方向不一致。不是这轮弹窗阻塞，但后面会继续挤压显示。
- `calculateSingleHit()` 里 `allDmgBonus` 的语义已经和 `buffCalculator` 的字段设计脱节。后面如果继续加全伤类 Buff，这里会越来越乱。
- `OperatorConfigPanel` 虽然已经加了相等性判断，但它还是旧 `max.json` 面板链，不属于这轮伤害弹窗主修复范围，别让 Trae 顺手扩改。

[回归检查项]

- 官方角色 `别礼 Q`
  - 打开弹窗
  - 标题应显示技能名，不是单独 `Q`
  - 3 段倍率显示应为 `400% / 400% / 800%`
- 官方角色 `别礼 Q`
  - 点击 `展开计算过程`
  - 必须能看到完整数值链，不只是几个区间标题
- 非物理技能
  - 对比一组无 Buff 情况，确认 `allDmgBonus` 不再双算
- 脆弱 / 易伤
  - 分别添加对应 Buff
  - 确认进入正确区间，不再写反
- CSS
  - hit 卡片、选中态、详情区、Buff tag 完整显示
  - 不再出现“只剩一行标题”的残缺布局
- `npm run build` 通过后，仍必须手测弹窗展开路径

[给 Trae 的修正 TODO]

1. 先改 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\calculators\skillButtonDamageCalculator.ts)
   - 修正 `fragileRate / vulnerabilityRate` 调用写反
   - 修正非物理 hit 的 `damageBonusRate` 重复计入问题
   - 不要顺手重构整个计算器，只收这两个明确 bug

2. 再改 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx)
   - 所有倍率显示统一改成 `multiplier * 100`
   - 总标题改成 `displayName / skillType / 段数`
   - 展开区补完整 `DamageBreakdown` 数值链
   - 展开区同时显示 `activeHit.appliedBuffs`

3. 再改 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.css)
   - 给新 hit 卡片结构补齐缺失样式
   - 不要再依赖旧的 `.skill-damage-hit-row`

4. 完成后必须提交：
   - `damageBonusRate` 修正前后差异
   - `别礼 Q` 三段倍率显示结果
   - 展开计算过程的完整字段清单
   - 弹窗截图或逐项手测结果
   - `npm run build` 结果