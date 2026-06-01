# 抗性区与腐蚀落实 Tasks

## Status

本任务用于把当前代码修正到 `docs/specs/resistance-zone/spec.md` 定义的结构。

当前代码已经提前接入了部分抗性区公式和无视抗性 Buff，但存在字段命名、数据模型和腐蚀快照接入偏差。本任务要求先纠偏，再完整落实 spec。

## Guardrails

- [x] 不继续扩大范围到完整敌人抗性表录入。
- [x] 不实现敌人选择器完整 UI。
- [x] 不实现干员承伤计算。
- [x] 不实现超域或复合抗性结算。
- [x] 不把基础抗性做成普通 Buff。
- [x] 不把腐蚀实现为易伤、脆弱、增幅或伤害加成。
- [x] 不再新增与 spec 不一致的 `*ResistanceReduction` 作为正式腐蚀字段，除非先同步更新 spec。

## Phase 0: Reconcile Current Drift

- [x] 对照 spec 清点当前已改代码中所有抗性相关字段。
- [x] 移除或迁移 `physicalResistanceReduction / magicResistanceReduction / fireResistanceReduction / electricResistanceReduction / iceResistanceReduction / natureResistanceReduction` 正式消费路径。
- [x] 移除或迁移 `hyperResistanceReduction / compositeResistanceReduction / hyperResistanceIgnore / compositeResistanceIgnore` 正式消费路径。
- [x] 保留无视抗性字段为 spec 定义集合：`allResistanceIgnore / physicalResistanceIgnore / magicResistanceIgnore / fireResistanceIgnore / electricResistanceIgnore / iceResistanceIgnore / natureResistanceIgnore`。
- [x] 将 UI、AI catalog、武器草稿、装备表中的无视抗性选项统一到上述字段集合。
- [x] 确认 `magicResistanceIgnore` 只作为四元素通用 Buff 字段，不作为独立命中属性结算。
- [x] 确认本阶段不新增 `magicResistance` 目标基础抗性字段。

## Phase 1: Data Model

- [x] 在 `types/storage.ts` 定义 `HitResistanceInput`。
- [x] `HitResistanceInput` 只包含 `physicalResistance / fireResistance / electricResistance / iceResistance / natureResistance`。
- [x] 定义 `SkillButtonResistanceConfig`。
- [x] `SkillButtonResistanceConfig` 至少包含 `targetResistance: HitResistanceInput`。
- [x] 在 `PersistedSkillButton` 增加 `resistanceConfig?: SkillButtonResistanceConfig`。
- [x] 更新 skill-button repository 读取逻辑，缺失 `resistanceConfig` 时按全抗性 `0` 归一化。
- [x] 确认 `resistanceConfig.targetResistance` 只保存目标基础抗性，不保存腐蚀或无视抗性。
- [x] 普通 hit、异常 hit、额外 hit 默认读取同一个按钮级 `targetResistance`。
- [x] 不实现每 hit 独立目标抗性覆盖表。

## Phase 2: Buff Type Registry

- [x] 在 `BuffCalculationResult` 增加腐蚀 Buff 汇总字段：`allCorrosion / physicalCorrosion / magicCorrosion / fireCorrosion / electricCorrosion / iceCorrosion / natureCorrosion`。
- [x] 在 `BuffCalculationResult` 增加无视抗性汇总字段：`allResistanceIgnore / physicalResistanceIgnore / magicResistanceIgnore / fireResistanceIgnore / electricResistanceIgnore / iceResistanceIgnore / natureResistanceIgnore`。
- [x] 确认所有腐蚀和无视抗性汇总字段内部单位为“点”，不是小数比例。
- [x] 更新 `calculateBuffTotals` 的 switch，汇总上述腐蚀和无视抗性类型。
- [x] 在 Buff 草稿页类型下拉中加入腐蚀和无视抗性类型。
- [x] 在武器草稿页 Buff 类型下拉中加入腐蚀和无视抗性类型。
- [x] 在装备表 Buff 类型下拉中加入腐蚀和无视抗性类型。
- [x] 在 AI Buff 填充 catalog 中加入腐蚀和无视抗性类型。
- [x] AI catalog 中腐蚀字段的描述使用“抗性降低/降抗/腐蚀”，无视抗性字段使用“无视/忽略/穿透”。
- [x] AI catalog 避免把“伤害提高/易伤/脆弱”误推断成腐蚀或无视抗性。

## Phase 3: Resistance Calculator

- [x] 新增或修正 `calculateResistanceZone(elementKey, targetResistance, buffTotals)` 纯函数。
- [x] 函数输入必须显式接收 `targetResistance`，不能只读 Buff。
- [x] 函数输出 `HitResistanceResult`。
- [x] `HitResistanceResult` 包含 `baseResistance / corrosion / resistanceIgnore / effectiveResistance / resistanceZone / formulaText`。
- [x] 公式实现为 `effectiveResistance = baseResistance - corrosion`。
- [x] 公式实现为 `resistanceZone = 1 - effectiveResistance / 100 + resistanceIgnore / 100`。
- [x] 没有目标抗性、腐蚀和无视抗性时，`resistanceZone = 1`。
- [x] 物理命中读取 `physicalResistance`。
- [x] 物理命中腐蚀读取 `allCorrosion + physicalCorrosion`。
- [x] 物理命中无视抗性读取 `allResistanceIgnore + physicalResistanceIgnore`。
- [x] 灼热命中读取 `fireResistance`。
- [x] 灼热命中腐蚀读取 `allCorrosion + magicCorrosion + fireCorrosion`。
- [x] 灼热命中无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + fireResistanceIgnore`。
- [x] 电磁命中读取 `electricResistance`。
- [x] 电磁命中腐蚀读取 `allCorrosion + magicCorrosion + electricCorrosion`。
- [x] 电磁命中无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + electricResistanceIgnore`。
- [x] 寒冷命中读取 `iceResistance`。
- [x] 寒冷命中腐蚀读取 `allCorrosion + magicCorrosion + iceCorrosion`。
- [x] 寒冷命中无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + iceResistanceIgnore`。
- [x] 自然命中读取 `natureResistance`。
- [x] 自然命中腐蚀读取 `allCorrosion + magicCorrosion + natureCorrosion`。
- [x] 自然命中无视抗性读取 `allResistanceIgnore + magicResistanceIgnore + natureResistanceIgnore`。
- [x] 不让 `magicCorrosion` 或 `magicResistanceIgnore` 作为独立 `magic` 命中属性结算。
- [x] 不让超域/复合抗性进入本阶段结算。

## Phase 4: Damage Formula Integration

- [x] 在 `DamageZones` 中新增 `resistanceZone: number`。
- [x] 在 `DamageZones` 中新增 `resistance: HitResistanceResult` 明细对象。
- [x] 普通 hit 计算调用 `calculateResistanceZone(hit.element, button.resistanceConfig.targetResistance, buffTotals)`。
- [x] 异常 hit 计算调用同一个 `calculateResistanceZone`。
- [x] 额外 hit 计算调用同一个 `calculateResistanceZone`。
- [x] 伤害报表计算调用同一个 `calculateResistanceZone`。
- [x] 抗性区乘区插入防御区之后、增幅区之前。
- [x] 普通 hit 的 `nonCrit / crit / expected` 全部包含抗性区。
- [x] 异常 hit 的 `nonCrit / crit / expected` 全部包含抗性区。
- [x] 额外 hit 的 `nonCrit / crit / expected` 全部包含抗性区。
- [x] 伤害报表总伤害和分段伤害全部包含抗性区。
- [x] 没有 `resistanceConfig` 时旧结果保持不变。

## Phase 5: Corrosion Snapshot

- [x] 扩展 `AnomalyStateSnapshot`，保存腐蚀计算需要的结构化字段。
- [x] 腐蚀快照保存 `initialCorrosion / tickCorrosionPerSecond / maxCorrosion / durationSeconds / currentCorrosion`。
- [x] 腐蚀快照保留来源角色、来源源石技艺强度快照、异常等级。
- [x] 源石技艺强度增强公式使用 spec 定义公式。
- [x] 明确当前默认口径：如果暂不做经过秒数输入，则使用上限值或初始值之一。
- [x] 默认口径必须写入 UI 文案和计算过程文本。
- [x] `buildAnomalyStateSnapshotBuffs` 将 `corrosion` 快照转换为 `allCorrosion` Buff。
- [x] 腐蚀快照生成的 Buff `value = currentCorrosion`。
- [x] 腐蚀快照生成的 Buff `type = allCorrosion`。
- [x] 腐蚀快照不生成 `natureResistanceReduction`。
- [x] 腐蚀快照不生成 `natureFragile / natureVulnerability / natureAmplify / natureDmgBonus`。
- [x] 已挂载腐蚀快照时，自然/灼热/电磁/寒冷/物理命中按 spec 的 `allCorrosion` 规则消费。

## Phase 6: UI And Report

- [x] 技能按钮计算过程展示抗性区。
- [x] 抗性区展示基础抗性、腐蚀、无视抗性、有效抗性、最终系数。
- [x] 抗性区公式文案使用 `1 - (抗性 - 腐蚀) / 100 + 无视抗性 / 100`。
- [x] 异常伤害详情展示同样的抗性区公式。
- [x] 伤害表在防御区之后展示抗性区列。
- [x] 伤害表单元格详情展示抗性区明细，不只展示最终系数。
- [x] Excel 导出在防御区之后新增抗性区列。
- [x] Excel 导出公式与应用内结算公式一致。
- [x] 报表和 Excel 中异常段不能把 `resistanceBase / corrosion / resistanceIgnore` 写死为 0。
- [x] 相关 Buff 高亮能将腐蚀和无视抗性定位到抗性区列。

## Phase 7: Spec Scenarios Tests

- [x] 增加纯函数测试：无抗性输入时 `resistanceZone = 1`。
- [x] 增加纯函数测试：自然抗性 20，无腐蚀、无无视时 `resistanceZone = 0.8`。
- [x] 增加纯函数测试：自然抗性 20，`allCorrosion = 12` 时 `resistanceZone = 0.92`。
- [x] 增加纯函数测试：自然抗性 20，`natureResistanceIgnore = 10` 时 `resistanceZone = 0.9`。
- [x] 增加纯函数测试：自然抗性 20，`allCorrosion = 12`，`natureResistanceIgnore = 10` 时 `resistanceZone = 1.02`。
- [x] 增加元素匹配测试：物理只消费 `allCorrosion + physicalCorrosion` 和 `allResistanceIgnore + physicalResistanceIgnore`。
- [x] 增加元素匹配测试：四元素消费 `allCorrosion + magicCorrosion + specificCorrosion`。
- [x] 增加元素匹配测试：四元素消费 `allResistanceIgnore + magicResistanceIgnore + specificResistanceIgnore`。
- [x] 增加回归测试：没有 `resistanceConfig` 的旧按钮伤害结果不变。
- [x] 增加回归测试：腐蚀快照能生成 `allCorrosion` 并影响抗性区。
- [x] 运行 `npm run build`。

## Acceptance Checklist

- [x] 字段命名与 spec 一致，不再混用 `*ResistanceReduction` 作为腐蚀正式字段。
- [x] `PersistedSkillButton.resistanceConfig.targetResistance` 已实现。
- [x] 基础抗性来自按钮级目标抗性配置，不来自 Buff。
- [x] 腐蚀来自 `*Corrosion` Buff。
- [x] 无视抗性来自 `*ResistanceIgnore` Buff。
- [x] 腐蚀快照生成 `allCorrosion`。
- [x] 抗性区位于防御区之后、增幅区之前。
- [x] UI、伤害表、报表、Excel 都展示抗性区。
- [x] Spec 中全部自然抗性示例能跑通。
- [x] `npm run build` 通过。

## Known Current Drift To Fix

- [x] 当前 `buffCalculator` 使用 `*ResistanceReduction`，需要改成 spec 的 `*Corrosion`。
- [x] 当前 `ResistanceInput` 包含 `magicResistance / hyperResistance / compositeResistance`，需要收敛到 spec 的五个基础抗性字段。
- [x] 当前 `DamageZones` 使用扁平抗性明细字段，需要改为 `resistance: HitResistanceResult`。
- [x] 当前普通 hit 没有传入按钮级目标抗性。
- [x] 当前异常 hit 没有传入按钮级目标抗性。
- [x] 当前额外 hit 没有传入按钮级目标抗性。
- [x] 当前报表没有传入按钮级目标抗性。
- [x] 当前腐蚀快照仍没有生成 Buff。
- [x] 当前异常段在伤害表重建时将抗性明细写死为 0。
