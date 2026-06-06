# Operator Studio Spec 3 Tasks - 来源值派生 Buff

## Status

本任务用于实现 `docs/specs/operator-studio/spec3.md` 中定义的“来源值派生 Buff”。

已确认边界：

- 这不是任意公式系统。
- effect 的 `value` 支持两种模式：固定数值 / 来源值派生。
- 来源值派生固定为 `sourceValue * perPointValue`，即“来源值 × 每点提升多少”。
- 单个 effect 只允许一个来源值，不做求和。
- 智识 + 意志这类效果拆成两个 passive/positive effect。
- 来源值固定为 `hp / atk / strength / agility / intelligence / will / sourceSkill`。
- 不支持 `mainStat / subStat` 作为来源。
- 百分比是否转小数仍取决于 `type` 规则，不由 derived 模式单独决定。
- derived positive Buff 应在普通 Buff 后段处理。
- derived Buff 不做递归、不做迭代。

待继续确认并设计：

- `operator-config` display 环节里 derived Buff 的完整计算链。
- 主界面伤害计算中，勾选 condition derived Buff 时的专门处理。

## Tasks

- [x] Task 1: 补充类型定义
  - [x] 在 `src/core/templates/operatorTemplate.ts` 定义 `OperatorBuffValueMode = 'fixed' | 'derived'`。
  - [x] 定义 `OperatorBuffDerivedSource`，仅包含 `hp / atk / strength / agility / intelligence / will / sourceSkill`。
  - [x] 定义 `OperatorBuffDerivedValue`，包含 `source` 和 `perPointValue`。
  - [x] 扩展 `OperatorDraftBuffEffect`，增加 `valueMode?: OperatorBuffValueMode`。
  - [x] 扩展 `OperatorDraftBuffEffect`，增加 `derivedValue?: OperatorBuffDerivedValue`。
  - [x] 同步更新 `src/types/index.ts` 中的运行时 Character/operator buff 类型。
  - [x] 同步更新 `src/core/calculators/operatorPanelCalculator.ts` 中的 `OperatorBuffEffectInput` 类型。

- [x] Task 2: 归一化与旧数据兼容
  - [x] 更新 `operatorTemplateAdapter` 的 Buff effect normalize 逻辑。
  - [x] 更新 `OperatorDraftPage.tsx` 本地 normalize 逻辑。
  - [x] 缺少 `valueMode` 的旧 effect 按 `fixed` 处理。
  - [x] `valueMode = derived` 但缺少 `derivedValue.source` 时，不崩溃，视为无效 effect。
  - [x] `perPointValue` 非 number 或 NaN 时，不参与结算。
  - [x] 兼容旧输入 `derivedValue.scale`，归一化后保存为 `perPointValue`。
  - [x] 导入、导出、分享、本地库保存保留 `valueMode` 和 `derivedValue`。

- [x] Task 3: Operator Studio UI - 数值模式
  - [x] 在干员 Buff effect 表单中增加数值模式切换。
  - [x] 支持 `固定数值` 模式。
  - [x] 支持 `来源值派生` 模式。
  - [x] 固定数值模式显示现有 value 输入。
  - [x] 来源值派生模式隐藏固定 value 输入。
  - [x] 来源值派生模式显示来源值选择器。
  - [x] 来源值派生模式显示“每点提升”输入。
  - [x] 切换模式时不要误删用户已填的 value 或 derivedValue，除非用户明确覆盖。

- [x] Task 4: Operator Studio UI - 来源值选择
  - [x] 来源值选择器只提供 7 个选项：生命值、攻击力、力量、敏捷、智识、意志、源石技艺强度。
  - [x] 不提供主能力、副能力。
  - [x] 不提供多选。
  - [x] effect 列表中能区分固定值和来源值派生值。
  - [x] 列表展示 derived effect 时显示类似 `智识 每点提升 0.001`。
  - [x] 表单使用“每点提升”，并以 number 保存，不是字符串公式。

- [x] Task 5: 派生值计算 helper
  - [x] 新增纯函数用于从 panel/config 上下文读取来源值。
  - [x] `hp` 读取当前生命值。
  - [x] `atk` 读取当前攻击力。
  - [x] `strength / agility / intelligence / will` 读取当前能力值。
  - [x] `sourceSkill` 读取当前源石技艺强度。
  - [x] 新增纯函数计算 `derivedRuntimeValue = sourceValue * perPointValue`。
  - [x] 无效 source 或无效 perPointValue 返回不可结算状态，而不是返回 0 伪装成功。

- [x] Task 6: Operator Config - positive derived 结算链
  - [x] 调整 `buildConfigSnapshot`，先结算基础属性、武器、装备、普通 positive Buff。
  - [x] 在普通 Buff 后段读取实时来源值，计算 derived positive Buff。
  - [x] 将 derived positive Buff 计算出的 runtime value 合入对应 `type` totals。
  - [x] 保持百分比归一化仍走现有 `normalizeValue(typeKey, value, unit)` 规则。
  - [x] derived Buff 不互相递归。
  - [x] derived Buff 不做多轮迭代。
  - [x] 明确并实现读取快照：derived source 应读取派生处理前的实时 display/calc 值。

- [ ] Task 7: Operator Config - display 详情
  - [ ] 在 `detailMarkdown` 的 `## 干员自带 Buff` 区块显示 derived Buff。
  - [ ] 展示来源值名称。
  - [ ] 展示每点提升。
  - [ ] 展示当前来源值。
  - [ ] 展示当前计算值。
  - [ ] 标记 positive derived Buff 为已结算。
  - [ ] 标记 condition derived Buff 为条件，不默认结算。
  - [ ] 该任务需要先确认 display 环节使用哪个阶段的 `hp / atk / sourceSkill`。

- [ ] Task 8: Candidate Buff - derived 元信息
  - [x] `operatorConfigCandidateBuffService` 生成候选 Buff 时保留 derived effect 信息。
  - [x] 对 positive derived Buff，可以输出当前 config 下已计算 value。
  - [x] 对 condition derived Buff，需要保留 `derivedValue` 元信息或可重算上下文。
  - [ ] 候选搜索应能按 Buff 名称、干员名、来源值描述搜到。
  - [ ] 删除或修改 derived Buff 后，候选列表刷新不残留旧候选。

- [ ] Task 9: Damage Calculation - condition derived 特例设计
  - [ ] 明确主界面勾选 condition derived Buff 时的计算入口。
  - [ ] 明确从哪个 panel/button/context 读取 `hp / atk / strength / agility / intelligence / will / sourceSkill`。
  - [ ] 勾选后不能只把草稿中的空 value 直接写入已选 Buff。
  - [ ] 需要在伤害计算前把 condition derived Buff 转为运行时 value。
  - [ ] 同一个已选 Buff 在不同干员/不同配置下应能得到不同 runtime value。
  - [ ] 该任务需要单独补 spec 细节后再实现。

- [ ] Task 10: Tests
  - [ ] 为 fixed 旧 effect 兼容补测试。
  - [x] 为 positive derived `intelligence * 0.001 -> atkPercentBoost` 补测试。
  - [x] 为普通 Buff 先提升智识、derived 再读取提升后智识补测试。
  - [x] 为 condition derived 不在 config 默认结算补测试。
  - [ ] 为无效 source / perPointValue 不崩溃补测试。
  - [ ] 为 detailMarkdown 展示 derived 计算过程补测试或快照断言。

- [ ] Task 11: Verification
  - [x] 运行 `npm run test:operator-panel`。
  - [x] 运行 `npm run build`。
  - [ ] 手测 `operator-studio` 创建 fixed Buff。
  - [ ] 手测 `operator-studio` 创建 derived Buff。
  - [ ] 手测 derived positive 在 `operator-config` 面板中结算。
  - [ ] 手测 derived condition 不默认结算。
  - [ ] 手测面板数据详情展示 derived 来源、每点提升和当前计算值。

## 新一轮：Dot hit 类型与 dotDmgBonus

- [x] 类型拆分，避免 Dot 变成技能按钮
  - [x] `src/types/index.ts` 新增 `SkillButtonType = 'A' | 'B' | 'E' | 'Q'`，`HitSkillType = SkillButtonType | 'Dot'`。
  - [x] `SandboxSkillHit.skillType` 用 `HitSkillType`，按钮相关继续用 `SkillButtonType`。
  - [x] `src/core/calculators/skillDamage.types.ts` hit 用 `HitSkillType`，button 用 `SkillButtonType`。
  - [x] `src/core/templates/operatorTemplate.ts` 模板 hit/button 类型同步拆分。

- [x] operator-studio 编辑 UI
  - [x] `src/components/OperatorDraftPage.tsx` 本地 `HitSkillType` 加 `Dot`，但 `SkillDraft.buttonType` 改成只允许 A/B/E/Q。
  - [x] “技能乘区”下拉新增 `<option value="Dot">Dot</option>`。
  - [x] `src/components/operatorDraftReference.ts` 参考导入逻辑同样拆分 hit/button 类型。

- [x] 计算链路新增 `dotDmgBonus`
  - [x] `src/core/calculators/buffCalculator.ts` 的 `BuffCalculationResult` 加 `dotDmgBonus`，初始化 0，`calculateBuffTotals` switch 处理。
  - [x] `calculateSkillDmgBonus('Dot')` 返回 `parsedDamageBonus.dotDmgBonus + buffTotals.dotDmgBonus`，不叠 `allSkillDmgBonus`。
  - [x] `src/core/calculators/operatorPanelCalculator.ts` 面板 damageBonus 类型、默认值、展示 label、display 汇总都加 `dotDmgBonus`。
  - [x] `src/types/storage.ts` 存储快照里的 damageBonus 结构加字段。
  - [x] `src/utils/storage.ts` 默认 storage 值补 0。
  - [x] `src/components/DamageSheetPage.tsx` 伤害表里按类型筛选/展示补 `dotDmgBonus`。

- [x] 导入、白名单、报表、导出
  - [x] `src/ai/buffFillCatalog.ts` 的 `BuffModifierType` 加 `dotDmgBonus`，catalog 加“持续伤害加成 / Dot / DOT”。
  - [x] `src/aiCli/operatorFillAdapter.ts` 拆 `BUTTON_TYPES` 和 `HIT_SKILL_TYPES`，hit 校验允许 Dot，button 仍只允许 A/B/E/Q；effect 白名单加 `dotDmgBonus`。
  - [x] `src/aiCli/equipmentFillAdapter.ts`、`src/aiCli/weaponFillAdapter.ts` CLI 装备/武器 effect 白名单加 `dotDmgBonus`。
  - [x] `src/components/BuffDraftPage.tsx`、`src/components/EquipmentSheetPage.tsx`、`src/components/WeaponDraftPage.tsx` 三个编辑页的 buff 类型选项和 label 加 `dotDmgBonus`。
  - [x] `src/core/services/damageReportService.ts` 中 `Dot` 显示为“持续伤害”。
  - [x] `src/exporters/damageExcel/buildDamageExcelWorkbook.ts` Excel 导出 label、面板行、`getSkillDamageBonusTypes('Dot')` 加 `dotDmgBonus`。

- [x] 边缘项
  - [x] `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` 看起来没有被 import，可同步补字段，也可后续清理。
  - [x] `src/utils/equipmentParser.ts` 如装备文本解析要支持“持续伤害加成”，这里也要加。

- [x] Verification
  - [x] 运行 `npm run build`。
