# Buff 计算链路重构 Tasks

## Status

已实现，待手工验收。

## Implementation Summary

- 已固定契约：`multiplier?: { coefficient: number }`。
- 技能倍率 canonical type 使用 `multiplierBonus`；旧 `multiplierMultiplier` 只作为兼容输入迁移为 multiplier。
- 已新增统一 Buff type registry、multiplier 归一化/校验、Stage 1 单 Buff 解析和 Stage 2 hit 级五区聚合。
- Operator Studio、AI CLI、runtime template、配置快照、CandidateBuff、all-buff-list、时间轴、分享/本地导入链路已透传 multiplier。
- 普通 hit、异常初始伤害、燃烧/Dot、额外 hit 已接入统一五区结果。
- 伤害详情、Damage Sheet、Damage Report、Excel 已消费结构化结果并展示/导出 `n/k/kn` 与 multiplier coefficient。
- passive 面板边界保持不重构；带 multiplier 的 passive 不进入面板普通 totals。

## Verification Summary

- `npm run build` 通过。
- `npm run test:operator-panel` 通过。
- `node scripts/run-ts-test.mjs /src/core/calculators/buffZoneCalculator.test.ts` 通过。
- 核心用例已覆盖 `1.32`、`1.452`、`1.694` 三个 spec 场景。
- 旧 `multiplierMultiplier` → `multiplierBonus + multiplier.coefficient` 迁移用例已覆盖。

仍需人工验收：

- Operator Studio 保存、重开、导出、导入的实际 UI 流程。
- 刷新后 all-buff-list、skill-button 层数和 multiplier 保留。
- 时间轴恢复与分享导入。
- 同一 hit 在详情、Damage Sheet、Report、Excel 的展示一致性。

本任务严格以同目录 `spec.md` 为规格来源。实现保持现有边界：

```text
passive
→ 面板计算

condition / countable
→ CandidateBuff
→ all-buff-list
→ skill-button
→ hit 计算
```

本轮不重构 passive 面板链路。

## Delivery Strategy

本轮适合按“共享契约串行、消费端并行、最终统一合流”开发。

### 串行主链

以下工作必须依次完成，不能并行维护两套临时契约：

```text
Phase 0 契约定稿
→ Phase 1 共享类型与注册表
→ Phase 4 Stage 1 单 Buff 解析
→ Phase 5 Stage 2 五区聚合
→ Phase 6 普通 hit 接管
```

共享高冲突文件主要包括：

- `src/core/domain/buff.ts`
- `src/types/storage.ts`
- `src/core/calculators/buffCalculator.ts`
- `src/core/calculators/skillDamage.types.ts`
- `src/core/calculators/skillButtonDamageCalculatorV2.ts`

### 第一批可并行工作

Phase 1 合入后可以并行：

- 工作包 A：Operator Studio、AI CLI 产出和校验。
- 工作包 B：运行时模板、配置快照、CandidateBuff、all-buff-list 和存储兼容。

两支都只能透传已确定的共享字段，不得各自定义 multiplier 结构。

### 第二批可并行工作

Phase 5 的 `HitCalculationResult` 与五区结果契约稳定后可以并行：

- 工作包 C：异常伤害、燃烧/Dot、额外 hit 接入。
- 工作包 D：伤害详情、Damage Sheet、Damage Report 展示接入。
- 工作包 E：Excel 模型与公式接入。

这三支必须消费核心结构化结果，不得各自重新实现 Buff 匹配或五区公式。

### 最终合流

所有分支合流后统一完成：

- sessionStorage、时间轴和分享兼容回归。
- 旧 `multiplierMultiplier` 兼容路径清理。
- 无 multiplier 历史结果回归。
- 项目构建。

## Phase 0: Contract Decisions

- [x] 确定 multiplier 附加字段的最终 TypeScript 名称；语义保持为独立 `coefficient`。
- [x] 确定技能倍率统一引用的正式 type；不得继续维护独立于其他四区的特殊数据模型。
- [x] 明确旧 `multiplierMultiplier` 的读取兼容期和写出策略。
- [x] 明确 Buff 定义、贡献、五区结果和最终 hit 结果的模块归属，避免 UI、报表和 Excel 反向依赖页面组件。
- [x] 确认 `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` 是否仍有正式调用；当前无正式引用，暂不提前删除。

## Phase 1: Shared Buff Contract And Registry

### Buff Definition

- [x] 在共享 Buff 定义中增加 multiplier coefficient。
- [x] 将 multiplier 字段加入 `CandidateBuff`。
- [x] 将 multiplier 字段加入 `SkillButtonBuff`。
- [x] 将 multiplier 字段加入 Operator Studio Buff 定义。
- [x] 将 multiplier 字段加入 Runtime Operator Template Buff 定义。
- [x] 将 multiplier 字段加入 ConfigSnapshot 中承载的 Buff 定义。
- [x] 保持 `BuffEffectKind = 'modifier' | 'extraHit'`，不新增第三种 effect kind。
- [x] 保持普通 `value` 的 `n` 语义；纯 multiplier Buff 允许不填写普通 `value`。
- [x] 拒绝同一个 Buff 同时设置 multiplier 和 `category=countable`。
- [x] 拒绝 extraHit 设置 multiplier。
- [x] 校验 multiplier coefficient 为有效正数。

### Type Registry

- [x] 建立统一 Buff type 注册层。
- [ ] 为注册项定义所属乘区：伤害加成、易伤、脆弱、增幅或技能倍率。
- [ ] 为注册项复用现有元素、法术、物理和技能类型命中规则。
- [ ] 为注册项声明是否允许 multiplier。
- [ ] 为注册项声明数值展示格式。
- [ ] 将 multiplier 白名单限制为 spec 支持的五类乘区字段。
- [ ] 禁止计算端根据展示名称或描述文本判断乘区。
- [ ] 保留连击、失衡、攻击、属性、暴击、抗性、腐蚀和无视抗性的现有模型。

### Identity And Normalization

- [x] 修改 `getBuffIdentityKey`，将 multiplier 标识和 coefficient 纳入身份签名。
- [x] 确认相同 type 的普通 Buff 与 multiplier Buff 不会被去重合并。
- [x] 保持按钮实例层数不进入 Buff 身份签名。
- [x] 增加共享 multiplier 归一化和校验 helper，供 Studio、repository、迁移和计算入口复用。

## Phase 2A: Operator Studio Producer

本阶段可与 Phase 2B 并行，前提是 Phase 1 已合入。

- [x] 在 Operator Studio Buff 编辑区增加 multiplier 开关或等价编辑入口。
- [x] 增加 multiplier coefficient 输入。
- [ ] multiplier 模式继续选择原有 Buff type。
- [ ] multiplier 模式不把 coefficient 写入普通 `value`。
- [ ] multiplier 模式只允许选择注册表中支持的五类字段。
- [ ] multiplier 模式下禁止 `category=countable`。
- [ ] countable 模式下禁止 multiplier。
- [ ] extraHit 模式下隐藏并清除 multiplier。
- [ ] 更新 Operator Studio 默认值和草稿标准化。
- [x] 更新 Operator Studio 保存、读取、导入和导出。
- [x] 更新 `operatorFillAdapter` 的输入结构、提示契约和校验。
- [x] AI CLI 不再把倍率文本强制改写成旧 `multiplierMultiplier` type。
- [ ] Studio 保存后重新打开时保留 type、category 和 multiplier coefficient。
- [ ] Studio 产出的普通 modifier、countable 和 extraHit 行为保持不变。

## Phase 2B: Upstream Propagation And Storage

本阶段可与 Phase 2A 并行，前提是 Phase 1 已合入。

### Runtime Propagation

- [x] 更新 `operatorTemplateAdapter`，完整复制 multiplier 定义。
- [x] 更新 runtime operator template 读写。
- [x] 更新 Operator Config Page Cache 快照。
- [x] 更新 `operatorConfigCandidateBuffService`。
- [x] 更新 Candidate Buff repository 读写和归一化。
- [x] 更新 all-buff-list repository 读写和归一化。
- [x] 确认 condition/countable multiplier 不进入 `operatorPanelCalculator` 的普通 totals。
- [x] 确认普通 passive 的现有面板计算保持不变。
- [x] 确认 multiplier 不被当作普通 passive 加算压入 `DamageBonusSnapshot`。
- [x] 确认从 Studio 到 CandidateBuff 再到 all-buff-list 的 type 和 coefficient 不丢失。

### Storage Version And Migration

- [ ] 为承载新 Buff 定义的 sessionStorage 增加明确 schema version 或提升 storage key 版本。
- [ ] 迁移 runtime template 存储。
- [ ] 迁移 operator config page cache 存储。
- [ ] 迁移 candidate-buff-list 存储。
- [ ] 迁移 all-buff-list 存储。
- [ ] 保持 skill-button 的 `buffStackCounts` 作为 countable 的 `k` 来源。
- [ ] 不新增通用 `buffCoefficients`。
- [x] 旧普通 Buff 缺少 multiplier 时按普通加算处理。
- [x] 旧 countable Buff 继续读取原 `buffStackCounts`。
- [x] 旧 `multiplierBonus` 迁移为技能倍率字段上的普通加算 Buff。
- [x] 旧 `multiplierMultiplier` 迁移为技能倍率字段上的 multiplier Buff，并将原 value 转为 coefficient。
- [x] 旧 extraHit 保持 `effectKind=extraHit`。
- [ ] 迁移时保留 buffId、`selectedBuff`、`refCount` 和 hit 级禁用关系。
- [ ] 迁移时保留 anomaly card 的 `selectedBuffIds`。
- [ ] 更新时间轴快照读写。
- [ ] 更新分享导入导出。
- [ ] 更新 local data bridge。
- [ ] 确认刷新、恢复时间轴和导入分享后 multiplier 不丢失。
- [ ] 确认 sessionStorage 不保存 `kn`、additiveTotal、multiplierProduct 或最终伤害。

## Phase 3: Result Contracts

- [x] 定义 `SupportedZone`，只包含五类支持乘算的乘区。
- [x] 定义单 Buff 解析结果，包含 buffId、type、rawValue、runtimeCoefficient 和 effectiveValue。
- [x] 定义 `BuffContribution`。
- [ ] 普通贡献保留 `n/k/kn`。
- [ ] multiplier 贡献保留 type 和 coefficient。
- [x] 定义 `ZoneCalculationResult`。
- [ ] `ZoneCalculationResult` 包含 additiveContributions 和 multiplierContributions。
- [ ] `ZoneCalculationResult` 包含 additiveTotal、multiplierProduct 和 finalValue。
- [ ] 在 hit 结果中加入五类结构化乘区结果。
- [ ] 保留现有防御、抗性、暴击、连击和失衡结果结构。
- [ ] 为旧 UI 暂时需要的扁平字段提供单向兼容读取，禁止形成第二计算权威。

## Phase 4: Stage 1 Buff Instance Resolution

- [x] 将单 Buff 当前值解析从乘区聚合中独立出来。
- [x] 普通 Buff 默认 `k=1`。
- [x] countable Buff 从当前按钮 `buffStackCounts[buffId]` 读取 `k`。
- [ ] countable 的 `k` 继续按 `0..maxStacks` 归一化。
- [x] 普通 Buff 输出 `effectiveValue = n × k`。
- [x] multiplier Buff 输出直接 coefficient，不进入普通 `kn` 加算。
- [ ] target 不匹配、hit 禁用和 type 命中判断不在 Stage 1 执行。
- [ ] Stage 1 不修改 all-buff-list 中的 `value`。
- [ ] Stage 1 不把 `kn` 写回 skill-button。
- [ ] countable 的加层、减层、满层、移除、复制、保存和恢复行为保持不变。
- [ ] Applied Buff 展示模型可读取原始值、当前层数和实际值。

## Phase 5: Stage 2 Hit Matching And Zone Aggregation

### Single-Pass Matching

- [x] 建立 hit 级统一聚合入口。
- [ ] 输入 all-buff-list 定义、按钮实例状态和当前 hit 上下文。
- [ ] 先应用 Buff target 匹配。
- [ ] 再应用 hit 级手动禁用过滤。
- [ ] 复用现有元素字段命中规则。
- [ ] 复用现有法术通用字段命中规则。
- [ ] 复用现有物理字段命中规则。
- [ ] 复用现有技能类型字段命中规则。
- [ ] extraHit 定义本身不生成普通五区贡献。
- [ ] 每个 hit 只扫描和匹配一次 Buff。

### Five Zone Aggregation

- [x] 普通 Buff 的 `kn` 进入对应乘区 additiveContributions。
- [x] multiplier coefficient 进入对应乘区 multiplierContributions。
- [x] 普通四区按 `multiplierProduct × (1 + additiveTotal)` 计算。
- [x] 技能倍率区按 `multiplierProduct × (baseMultiplier + additiveTotal)` 计算。
- [x] 没有 multiplier 时 `multiplierProduct=1`。
- [ ] multiplier 引用 type 只决定命中范围。
- [ ] multiplier 命中后作用于当前 hit 的整个对应乘区。
- [ ] 不将 multiplier 限制为只放大同名普通 Buff。
- [ ] 收敛现有 `calculateElementDmgBonus`、`calculateSkillDmgBonus` 和 fragile/vulnerability/amplify 标量逻辑。
- [ ] 收敛旧 `multiplierBonus/multiplierMultiplier` 技能倍率专用计算。

### Required Calculation Scenarios

- [x] 寒冷 hit：法术脆弱普通加算 `0.20` 与寒冷脆弱 multiplier `1.10` 得到脆弱区 `1.32`。
- [x] 寒冷 hit：法术脆弱普通加算 `0.20`、法术脆弱 multiplier `1.10`、寒冷脆弱 multiplier `1.10` 得到 `1.452`。
- [x] 寒冷 hit：两层 `0.20` 法术脆弱与两个 `1.10` multiplier 得到 `1.694`。
- [ ] target 不匹配的普通 Buff 和 multiplier Buff 均不生成贡献。
- [ ] hit 手动禁用的普通 Buff 和 multiplier Buff 均不生成贡献。
- [ ] 没有 multiplier 时五区结果与历史公式一致。

## Phase 6: Normal Hit Integration

- [x] 修改 `skillButtonDamageCalculatorV2`，使用统一五区聚合结果。
- [x] 最终伤害读取五类乘区的 `finalValue`。
- [ ] 保持防御区之后接抗性区、再接增幅区的现有顺序。
- [ ] 保持暴击、连击和失衡区现有模型。
- [ ] 普通 hit 的 nonCrit、crit 和 expected 使用同一份五区结果。
- [ ] 普通 hit 不再自行执行 `1 + sum(buff.value)`。
- [ ] 普通 hit 不再单独读取旧 `multiplierMultiplier` 乘积。
- [ ] HitCalculationResult 保留实际生效 Buff 及其贡献来源。

## Phase 7A: Anomaly, Dot And Extra-Hit Integration

本阶段可在 Phase 5 结果契约稳定后与 Phase 7B、7C 并行。

- [ ] 修改异常伤害入口，消费统一 hit 聚合结果。
- [ ] 修改燃烧和 Dot 分支，消费统一 hit 聚合结果。
- [ ] 修改 Buff 额外 hit，消费统一 hit 聚合结果。
- [ ] 保持异常和额外 hit 各自的基础倍率来源。
- [ ] 删除异常链路中独立的 `multiplierBonus/multiplierMultiplier` 组合公式。
- [ ] 删除额外 hit 链路中独立的 `multiplierBonus/multiplierMultiplier` 组合公式。
- [ ] 删除消费端对易伤、脆弱和增幅的 `1 + rate` 重复拼装。
- [ ] 相同 hit 上下文在普通、异常和额外 hit 中得到一致五区值。

## Phase 7B: UI, Damage Sheet And Report

本阶段可在 Phase 5 结果契约稳定后与 Phase 7A、7C 并行。

### Skill Damage Detail

- [ ] 更新 `skillDamageModalViewModel`。
- [ ] 普通 countable Buff 展示原始值 `n`。
- [ ] 普通 countable Buff 展示当前系数/层数 `k`。
- [ ] 普通 countable Buff 展示实际值 `kn`。
- [ ] multiplier Buff 展示引用字段、coefficient 和作用范围。
- [ ] 五类乘区展示 additiveTotal。
- [ ] 五类乘区展示 multiplierProduct。
- [ ] 五类乘区展示 finalValue。
- [ ] 无 multiplier 时允许简化公式文案。

### Damage Sheet And Report

- [ ] Damage Sheet 直接消费 HitCalculationResult 的五区结果。
- [ ] Damage Report Service 直接消费同一五区结果。
- [ ] 报表保留普通 Buff 的 `n → k → kn` 追踪。
- [ ] 报表保留 multiplier Buff 的 `type → coefficient` 追踪。
- [ ] 报表展示两类贡献到乘区结果再到最终伤害的链路。
- [ ] 删除 Damage Sheet 中按 type 重新筛选并重算乘区的逻辑。
- [ ] 删除 Damage Report 中重复维护的异常和普通公式。
- [ ] UI、Damage Sheet 和 Report 对同一 hit 展示一致结果。

## Phase 7C: Excel Export

本阶段可在 Phase 5 结果契约稳定后与 Phase 7A、7B 并行。

- [ ] 扩展 `damageExcelModel`，承载结构化五区结果和 Buff 贡献。
- [ ] Buff sheet 分开保存普通 value 和 multiplier coefficient。
- [ ] Excel 中普通 countable Buff 可追踪 `n/k/kn`。
- [ ] Excel 中 multiplier Buff 可追踪 type 和 coefficient。
- [ ] 五类乘区公式支持 additive refs 和 multiplier refs。
- [ ] 普通四区公式使用 `PRODUCT(multiplier) × (1 + SUM(additive))` 的等价表达。
- [ ] 技能倍率区公式使用 `PRODUCT(multiplier) × (base + SUM(additive))` 的等价表达。
- [ ] 移除仅识别旧 `multiplierMultiplier` type 的公式。
- [ ] Excel 不通过最终值反推基础加算或 multiplier。
- [ ] Excel 不再假设易伤、脆弱和增幅只能是 `1 + sum(buff.value)`。
- [ ] Excel 缓存结果与应用内 HitCalculationResult 一致。

## Phase 8: Compatibility And Cleanup

- [ ] 所有新写出的 Buff 数据使用统一 multiplier 模型。
- [ ] 旧 `multiplierMultiplier` 只保留在迁移或兼容入口。
- [ ] 新核心链路接管后移除 `buffCalculator` 中旧技能倍率双字段计算权威。
- [ ] 新核心链路接管后移除 AI validator 中旧倍率 type 自动改写。
- [ ] 确认未引用后再删除或收敛 `CanvasBoard/SkillButtonBuffCalculator`。
- [ ] 删除 UI、报表、异常伤害和 Excel 中已失效的重复聚合 helper。
- [ ] 保留普通 passive 的面板汇总逻辑。
- [ ] 不扩大范围重构 passive 面板链路。
- [ ] 不删除 all-buff-list 快照层。
- [ ] 不修改 buffId 引用、`refCount` 或现有 Buff 实体管理机制。

## Phase 9: Verification

按仓库约束不做大范围补测；本轮核心公式和兼容迁移风险高，仅补最小必要覆盖。

- [ ] 为 Stage 1 增加最小纯函数覆盖：普通 Buff `k=1`。
- [ ] 为 Stage 1 增加最小纯函数覆盖：countable `0.20 × 2 = 0.40`。
- [ ] 为 Stage 2 增加最小纯函数覆盖：跨字段寒冷脆弱 multiplier 场景结果 `1.32`。
- [ ] 为 Stage 2 增加最小纯函数覆盖：两个 multiplier 场景结果 `1.452`。
- [ ] 为 Stage 2 增加最小纯函数覆盖：两层普通 Buff 与两个 multiplier 场景结果 `1.694`。
- [ ] 增加旧普通 Buff 缺少 multiplier 的兼容覆盖。
- [ ] 增加旧 `multiplierMultiplier` 到新模型的迁移覆盖。
- [ ] 手工验证 Operator Studio 保存、重开、导出和导入。
- [ ] 手工验证刷新后 all-buff-list 和 skill-button 层数状态。
- [ ] 手工验证时间轴恢复和分享导入。
- [ ] 对无 multiplier 的代表性普通、异常和额外 hit 做历史结果对比。
- [ ] 对同一 hit 核对详情、Damage Sheet、Report 和 Excel 的五区结果。
- [x] 运行 `npm run build`。

## Acceptance Checklist

- [ ] multiplier 是 modifier Buff 的附加标识，不是新 effect kind。
- [ ] multiplier 继续引用现有 Buff type。
- [ ] 普通 value 与 multiplier coefficient 分开保存。
- [ ] multiplier 与 countable 互斥。
- [ ] extraHit 不允许 multiplier。
- [ ] 五类允许字段由统一注册表定义。
- [ ] Operator Studio 能完整产出 multiplier 定义。
- [ ] multiplier 从 runtime template 到 all-buff-list 全链路不丢失。
- [ ] 普通 Buff 默认 `k=1`。
- [ ] countable 当前层数继续作为 `k`。
- [ ] Stage 1 独立生成 `kn`，且不回写快照。
- [ ] Stage 2 统一完成 hit 匹配和五区聚合。
- [ ] multiplier 命中后作用于当前 hit 的整个对应乘区。
- [ ] spec 中 `1.32`、`1.452` 和 `1.694` 三个场景通过。
- [ ] 普通、异常、Dot 和额外 hit 使用同一五区结果。
- [ ] 详情、Damage Sheet、Report 和 Excel 使用同一结果来源。
- [ ] 旧存储、时间轴和分享数据可兼容。
- [ ] 普通 passive 面板计算行为不变。
- [ ] 没有 multiplier 时历史伤害结果不变。
- [ ] `npm run build` 通过。

## Explicit Non-Tasks

- [ ] 不删除 all-buff-list 快照层。
- [ ] 不删除技能按钮通过 buffId 引用 Buff 的方式。
- [ ] 不移除 `refCount`。
- [ ] 不新增第三种 `effectKind`。
- [ ] 不新增 `magicVulnerabilityMultiplier` 等平行字段。
- [ ] 不让所有 Buff 字段支持 multiplier。
- [ ] 不改攻击力、属性、暴击、抗性、腐蚀和无视抗性的计算模型。
- [ ] 不为连击和失衡增加独立 multiplier。
- [ ] 不重做 Buff 管理界面。
- [ ] 不重构 passive 面板计算链路。
- [ ] 不把 `kn`、乘区汇总或最终伤害写入 sessionStorage。
