# review-todo0.5.2

## [任务理解]

本轮只推进 0.5 阶段的“计算层分离”。

目标是把 `SkillButton.tsx` 中的技能伤害计算编排、Buff 汇总、倍率计算、分段命中计算抽离到独立计算层，让组件只负责读取 UI 输入、调用计算接口、渲染结果。

本轮不是功能改造，不允许改变现有伤害公式、Buff 生效规则、缓存结构、事件链路和 UI 展示行为。

## [当前问题]

1. `src/components/CanvasBoard/SkillButton.tsx` 同时承担 UI、缓存读取、Buff 读取、公式计算、结果渲染，职责过重。
2. `SkillButton.tsx` 内部存在大量局部计算逻辑，后续修改公式或排查伤害结果时必须阅读组件代码，维护成本高。
3. `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` 已有部分纯计算函数，但 `SkillButton.tsx` 仍在组件内完成计算编排，没有形成稳定的计算入口。
4. 计算逻辑当前缺少明确输入/输出边界，后续无法低成本补单元测试或做公式回归。

## [必须改]

### 1. 新建计算层目录

Trae 执行：

- 新建 `src/core/calculators/`。
- 新建 `src/core/calculators/skillButtonDamageCalculator.ts`。
- 如需要类型拆分，新建 `src/core/calculators/skillButtonDamageTypes.ts` 或 `src/core/domain/damage.ts`。

约束：

- calculator 文件不得引入 React。
- calculator 文件不得直接读写 `sessionStorage`。
- calculator 文件不得访问 DOM。
- calculator 文件不得派发或监听事件。
- calculator 文件不得依赖组件 state。

### 2. 抽离 SkillButton 伤害计算入口

Trae 执行：

- 在 `skillButtonDamageCalculator.ts` 中提供一个唯一主入口，例如：

```ts
calculateSkillButtonDamage(input: SkillButtonDamageInput): SkillButtonDamageResult
```

输入至少覆盖：

- 当前技能按钮信息。
- 当前技能等级或潜能等级选择。
- 当前技能倍率数据。
- 当前角色配置中计算所需字段。
- 已选 Buff 列表。
- 当前是否需要计算普攻/技能/元素/脆弱/易伤/暴击等现有逻辑。

输出至少覆盖：

- Buff 汇总结果。
- 元素伤害加成结果。
- 技能伤害加成结果。
- 脆弱倍率。
- 易伤倍率。
- 每段命中计算结果。
- 总伤害或期望伤害。
- UI 当前需要展示的公式拆解字段。

约束：

- 输出结构必须服务现有 `SkillButton.tsx` 渲染，不要求重新设计 UI。
- 不允许把 JSX、CSS className、DOM 文案拼接塞进 calculator。
- calculator 只返回数据，不返回 ReactNode。

### 3. 迁移现有 Buff 计算函数

Trae 执行：

- 将 `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` 中已有纯计算函数迁移或包装到 `src/core/calculators/`。
- 至少覆盖当前已使用函数：
  - `calculateBuffTotals`
  - `calculateElementDmgBonus`
  - `calculateSkillDmgBonus`
  - `calculateVulnerabilityRate`
  - `calculateFragileRate`

约束：

- 优先最小改动：可以先在新 calculator 内复用旧函数，再逐步移动文件。
- 如果移动文件，必须同步修正所有 import。
- 不允许改动这些函数的计算语义。

### 4. 精简 SkillButton.tsx 的计算职责

Trae 执行：

- 修改 `src/components/CanvasBoard/SkillButton.tsx`。
- 将组件内的伤害计算编排替换为调用 `calculateSkillButtonDamage()`。
- `SkillButton.tsx` 保留：
  - UI state。
  - 用户交互。
  - 数据读取结果的组装。
  - 调用 calculator。
  - 渲染计算结果。

必须移出或停止在组件内直接编排的逻辑：

- Buff totals 汇总。
- 元素伤害加成计算。
- 技能伤害加成计算。
- 脆弱倍率计算。
- 易伤倍率计算。
- 单段 hit 伤害计算。
- 多段 hit 聚合计算。
- 公式拆解所需的中间倍率组合。

约束：

- 不要求本轮移除 `SkillButton.tsx` 中所有数据读取。
- 不要求本轮拆分 SkillButton UI 子组件。
- 不允许改动技能按钮外观、交互、弹窗结构。

### 5. 保持现有公式行为不变

Trae 执行：

- 抽离前后不得改变现有计算公式。
- 如果发现原公式疑似有问题，本轮只记录到注释或后续 TODO，不在本轮修正。
- 所有字段命名必须能追溯到旧逻辑，避免抽离后无法 review。

## [可选优化]

以下内容可做，但不得影响主线交付：

- 为 `SkillButtonDamageInput` 和 `SkillButtonDamageResult` 增加更严格的类型。
- 为 calculator 增加少量纯函数拆分，例如 `calculateHitDamage()`、`calculateDamageRates()`。
- 在 calculator 内保留少量解释性注释，说明每个倍率来源。

## [不要动]

本轮禁止：

- 不要重构 `OperatorConfigPanel.tsx`。
- 不要改 `def.skill-button.v1`、`def.all-buff-list.v1`、`def.candidate-buff-list.v1` 的结构。
- 不要修改 0.4 已稳定的数据主从关系。
- 不要恢复 `timelineData.buffIds -> selectedBuff` 写回链路。
- 不要改 Buff 添加、删除、清空、按钮删除的缓存逻辑。
- 不要引入 Redux、Zustand、React Query 或新的状态库。
- 不要改 UI 样式。
- 不要顺手修公式。

## [验收标准 AC]

1. `src/core/calculators/skillButtonDamageCalculator.ts` 存在，并提供稳定主入口 `calculateSkillButtonDamage()` 或同等命名的单一主入口。
2. 新 calculator 文件不包含 React import、DOM API、storage API、事件 API。
3. `SkillButton.tsx` 不再直接编排完整伤害公式，只负责准备输入、调用 calculator、渲染输出。
4. 抽离前后，同一角色、同一技能、同一等级、同一 Buff 组合下，界面展示的伤害结果保持一致。
5. Buff 相关计算函数仍能覆盖当前所有 Buff 类型，不丢失元素加成、技能加成、易伤、脆弱等现有路径。
6. `npm run build` 必须通过。

## [回归检查项]

Trae 必须手测以下路径：

1. 打开已有技能按钮，未选择 Buff 时，伤害展示与抽离前一致。
2. 添加 1 个 Buff 后，伤害展示、公式展开内容与抽离前一致。
3. 添加多个 Buff 后，Buff 汇总和总伤害不丢项、不重复。
4. 删除 Buff 后，伤害结果立即回退。
5. 清空 Buff 后，伤害结果回到无 Buff 状态。
6. 切换技能等级或潜能等级后，计算结果正常刷新。
7. 关闭技能按钮再重新打开，缓存恢复后的计算结果一致。
8. 无技能倍率数据、无角色配置、无 Buff 数据时，原有空态/降级行为不变。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 先读取 `SkillButton.tsx` 当前计算逻辑，标出所有计算输入和输出字段。
2. 新建 `src/core/calculators/skillButtonDamageCalculator.ts`，把计算逻辑以纯函数形式承接出来。
3. 先保证 calculator 复刻旧结果，不做公式优化。
4. 修改 `SkillButton.tsx`，用 calculator 返回值替换组件内计算编排。
5. 跑 `npm run build`。
6. 按回归检查项手测。
7. 如果发现旧公式存在疑似错误，只记录，不在本轮修。

本轮交付标准：计算层完成第一步抽离，`SkillButton.tsx` 职责明显收窄，现有功能和显示结果不回退。

