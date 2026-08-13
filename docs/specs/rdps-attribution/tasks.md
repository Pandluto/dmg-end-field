# RDPS 归因分析与报表图 3/图 4 Tasks

## Status

已实现（2026-08-15 依据 spec 完成 RDPS-0 至 RDPS-4 的主体实现；RDPS-5 的 E2E 与真实数据浏览器验收待环境就绪后执行）。

本文件按“共享契约串行、消费端分包并行、最后统一集成”的方式拆分。标有 `[Sub-agent 可独立]` 的任务应当能够交给一个 sub agent 独立完成；任务完成后只提交该任务声明的文件范围，避免多个 agent 同时修改同一核心文件。

## Dependency Map

```text
RDPS-0 口径冻结
   ↓
RDPS-1 共享类型与计算接口（串行前置）
   ├── RDPS-2A 计算上下文与可过滤评估器       [Sub-agent 可独立]
   ├── RDPS-2B 来源元数据与连击来源化         [Sub-agent 可独立]
   ├── RDPS-2C 图表组件与主题样式             [Sub-agent 可独立]
   └── RDPS-2D 测试夹具与合同测试             [Sub-agent 可独立]
             ↓
RDPS-3 RDPS Owen 归因引擎（依赖 2A、2B）       [Sub-agent 可独立]
             ↓
RDPS-4 报表接线、性能与端到端验收（串行集成）
             ↓
RDPS-5 回归、文档状态和提交
```

RDPS-2C 可以在 RDPS-1 完成后使用 mock `rdps` 数据并行开发，但必须等 RDPS-3 的真实输出合同稳定后再接入页面。RDPS-2D 可以先写纯函数和 fixture，真实引擎断言在 RDPS-3 完成后启用。

## Guardrails

- [ ] 不改变图 1、图 2的 JSX、数据口径和既有伤害排序。
- [ ] 不在画布实时调用默认执行 RDPS；`includeRdps` 默认必须为 `false`。
- [ ] 不使用 `sourceName` 作为归因主键，不猜测旧数据的 owner。
- [ ] 不把整件武器/装备移除后的完整差值称为 Buff 贡献。
- [ ] 额外 Hit 必须在计算输入阶段按来源过滤，不能只删除报表输出行。
- [ ] 失衡按 `rdps-v1-owen-buff-only-strict-imbalance` 严格排除，影响归入 Residual。
- [ ] 负贡献保留符号；不得为了让环图看起来为正而截断并声称严格对账。
- [ ] 不新增真实 PNG/PDF/PPTX 导出；桌面“PPT 报表”仍按 DOM 页面验收。
- [ ] 不把异常施加者的源石技艺强度继续递归拆分为二阶来源。

## RDPS-0: 口径冻结（串行）

- [x] 确认 RDPS v1 的基准为 `totalExpected`，图 3 的占比分母为实际期望总伤害。
- [x] 确认武器/装备只归因其运行时实际生效的 Buff，不归因基础攻击和静态面板。
- [x] 确认来源键为 `ownerCharacterId + ownerBuffDomain`，展示名不参与分组。
- [x] 确认导电、腐蚀、碎甲快照归入施加者 `operator` 域。
- [x] 确认有来源 ID 的连击归入施加者 `operator` 域；无来源旧连击进入 Residual。
- [x] 确认失衡及其交互全部进入 Residual。
- [x] 确认队伍外有效 owner 在图 3显示为“队伍外来源”，图 4只显示当前四人。
- [x] 确认负贡献显示策略：保留数值和符号，必要时从环图切换为 signed table/bar 表达。
- [x] 确认 `policyVersion = rdps-v1-owen-buff-only-strict-imbalance` 并写入结果合同。
- [x] 确认若后续要求真正按秒的 DPS 归因，另开 spec，不在本阶段扩展时间模型。

## RDPS-1: 共享类型与计算接口（串行前置）

目标：先稳定所有 sub agent 共同依赖的输入/输出合同，不在此阶段改变最终伤害数值。

- [ ] 在 `src/core/services/rdpsAttribution.types.ts`（或等价独立类型文件）定义 `RdpsDomain`、`RdpsSourceKey`、`RdpsSourceContribution`、`RdpsCharacterContribution`、`RdpsAttributionSummary`、`RdpsDiagnostics`。
- [ ] 定义 `DamageReportCalculationContext`，至少覆盖按钮、解析后的技能模板、面板、Buff、异常快照、目标抗性、禁用项、层数和实际计算所需的 immutable 输入。
- [ ] 定义 `DamageReportSourceFilter`，能够按来源 key 开关普通 Buff、异常状态 Buff、连击 Buff 和 extra-hit 生成器。
- [ ] 定义 `DamageReportEvaluation`，包含按钮、Hit、总 expected/nonCrit 和诊断所需的评估计数。
- [ ] 给 `DamageReportSnapshotOptions` 增加 `includeRdps?: boolean`，默认 `false`。
- [ ] 给 `DamageReportSnapshot` 增加可选 `rdps?: RdpsAttributionSummary`。
- [ ] 给 `DamageReportBuffRow` 增加 `sourceName?`、`ownerCharacterId?`、`ownerBuffDomain?`、`ownerBuffGroup?`。
- [ ] 为 coalition cache 定义稳定 key 组成：`policyVersion + contextFingerprint + coalitionMask`。
- [ ] 明确 `actualTotal`、`attributionWorldTotal`、`baselineTotal`、`attributedTotal`、`residualTotal` 和 `reconciliationError` 的字段语义。
- [ ] 为接口添加最小类型测试或编译断言，确保旧调用在 `includeRdps` 缺失时仍可编译。

验收：计算、来源、图表和测试分包可以只依赖这一阶段公开的类型；默认构建结果与现状无行为差异。

## RDPS-2A: 计算上下文与可过滤评估器 `[Sub-agent 可独立]`

依赖：RDPS-1。建议 owner：damage calculation agent。文件边界：`damageReportService.ts`、新建纯计算模块、相关 calculator 类型和本任务测试；不要修改图表主题或移动端来源 UI。

- [ ] 从 `buildDamageReportSnapshot` 抽出一次性 resolve 阶段，读取并固化时间轴、按钮、模板、面板、Buff、异常快照、禁用项、层数和抗性。
- [ ] 从 resolve 结果抽出纯 `evaluateDamageReportContext(context, filter?)` 入口。
- [ ] 让普通 Hit、异常 Hit、Burn/Dot 和额外 Hit 均消费同一个过滤器。
- [ ] 普通 Hit 的 `selectedBuffIds`、Hit 级禁用、segment 级禁用和全局禁用保持现有语义。
- [ ] extra-hit 生成 Buff 被过滤时，不生成对应额外 Hit；countable extra-hit 的层数和 Hit 数量保持一致。
- [ ] 不启用过滤器时，新评估器逐 Hit 对齐现有路径，包含 expected、nonCrit、resistance 和总计。
- [ ] 将展示用 `traceId` 和来源基础元数据在 resolve 阶段预计算，反事实循环中不得再次读 localStorage。
- [ ] 保留 `buildDamageReportSnapshot({ buttonIds })` 的现有行为，并让它默认走不启用 RDPS 的兼容路径。
- [ ] 增加 baseline equivalence 测试：普通、异常、Burn/Dot、额外 Hit、抗性、面板 Buff、层数和禁用项。
- [ ] 增加性能计时钩子或可测试的 evaluation counter，供 RDPS-3/RDPS-4 验收 coalition 缓存。

验收：不启用来源过滤时每个 Hit 和总伤害在 `1e-6 × max(1,total)` 容差内一致；过滤 extra-hit generator 会影响 Hit 数量而不只是输出行。

## RDPS-2B: 来源元数据与连击来源化 `[Sub-agent 可独立]`

依赖：RDPS-1。建议 owner：data provenance agent。文件边界：`src/types/storage.ts`、`src/core/services/anomalyStateBuffs.ts`、桌面 anomaly hook/shared 文件、移动端 anomaly workbench/runtime 相关文件和各自测试；不要修改 `damageReportService.ts` 的评估器主体。

- [ ] 给 `PersistedAnomalyCard` 增加可选 `sourceCharacterId?: string`，保持旧存档可读取。
- [ ] 只对需要归属的连击入口增加来源选择和持久化；失衡不因本任务变成可归因来源。
- [ ] 桌面连击来源选择沿用当前队伍角色 ID，写入 `sourceCharacterId`；旧卡缺失来源时保留原效果但不猜测 owner。
- [ ] 移动端连击创建、编辑、存档和恢复同步支持可选来源 ID；B/Q 四档值不变，A 仍不生效。
- [ ] `buildAnomalyStateSnapshotBuffs` 将 `AnomalyStateSnapshot.sourceCharacterId` 映射到 `ownerCharacterId`，并使用 `ownerBuffDomain='operator'`。
- [ ] 连击派生 Buff 在运行时生成时携带 `ownerCharacterId` 和 `ownerBuffDomain='operator'`；失衡派生 Buff不进入可归因来源。
- [ ] 不给 `AnomalyStateSnapshot` 新增重复的来源字段；继续使用现有 `sourceCharacterId`。
- [ ] 所有新建的来源字段都保持旧数据迁移兼容，不因刷新或分享导入丢失。
- [ ] 扩展 anomaly state 测试：连击四档、B/Q、A、来源 ID、旧卡无来源、快照三类异常 owner 映射。

验收：同名干员不能串组；有来源的异常快照和连击能映射到 operator 域；旧卡仍可计算但进入 Residual。

## RDPS-2C: 图 3/图 4组件与主题样式 `[Sub-agent 可独立]`

依赖：RDPS-1。可以使用本任务内的 mock `RdpsAttributionSummary` 开发，待 RDPS-3 后由 RDPS-4 完成真实数据接线。建议 owner：report UI agent。文件边界：新建 `src/components/DamageReportRdpsCharts.tsx`、`DamageReportPptPage.tsx` 的图表区域、`DamageReportPptPage.css` 和三套报表主题覆盖。

- [ ] 新建 RDPS 图表组件，至少导出图 3总表和图 4四干员域拆分两个可组合组件。
- [ ] 图 3显示来源名、来源域/干员、贡献伤害、占比、来源贡献合计、Residual 和对账误差。
- [ ] 图 4最多四个干员卡片，每卡显示干员总贡献比例及 operator/weapon/equipment 三域数值与内部占比。
- [ ] 零贡献、负贡献、正负混合、少于四人、长名称和队伍外来源均有稳定空态/警告。
- [ ] 负值不得在环图中静默截断；必要时显示 signed 数值表或条形 fallback。
- [ ] 图 3、图 4使用语义 class（例如 `is-rdps-table`、`is-rdps-character-split`），不依赖 `:first-child` 表达图表含义。
- [ ] 保持 `report-ppt-chart-grid` 的 2×2 布局，不改图 1、图 2组件和数据。
- [ ] 适配 `lieflat-mono`、`liquid-tide`、`apple-midnight`，检查 CSS 继承、文字对比度和 SVG 颜色。
- [ ] 组件层测试或静态 fixture 覆盖空态、负值、四人和超长名称。

验收：使用 mock summary 可以在本地渲染四图布局；图 1/图 2无 DOM 或数据回归；三套主题下无溢出和不可读文字。

## RDPS-2D: 数值 fixture 与合同测试 `[Sub-agent 可独立]`

依赖：RDPS-1。建议 owner：calculation test agent。可以先只写 fixture、数据合同和旧路径基线；RDPS-3 完成后补齐归因断言。文件边界：`src/core/services/*.test.ts`、新增 fixture 文件、必要的 e2e 辅助数据；不要修改生产计算逻辑。

- [ ] 建立可重复的四人三域 synthetic context，来源 ID、域、Buff 类型和 target 明确。
- [ ] 建立同乘区和跨乘区交互 fixture。
- [ ] 建立面板 Buff、抗性/腐蚀/无视抗性、multiplier、derived、countable fixture。
- [ ] 建立禁用全局 Buff、Hit 级 Buff、segment Buff 和 `selectedBuffIds` fixture。
- [ ] 建立 extra-hit passive/countable generator fixture，断言过滤 generator 会删除对应 Hit。
- [ ] 建立异常状态快照、连击、失衡、旧卡无 owner、队伍外来源和未知 owner fixture。
- [ ] 建立负贡献、抗性拐点、取整/上限导致边际下降的 fixture。
- [ ] 建立 reconciliation helper，统一断言误差阈值和来源/域层级求和。
- [ ] 建立图表 summary fixture，覆盖零值、负值、空队伍、四人和长名称。

验收：fixture 不读取浏览器 localStorage；相同输入可重复生成；为 RDPS-3 和 RDPS-4 提供明确失败信息。

## RDPS-3: Owen 归因引擎 `[Sub-agent 可独立]`

依赖：RDPS-2A、RDPS-2B、RDPS-2D 的输入合同稳定。建议 owner：attribution algorithm agent。文件边界优先限定为新建 `src/core/services/rdpsContributionService.ts` 及其单元测试，不直接修改报表 JSX。

- [ ] 将可归因 Buff 映射为稳定来源 key：`characterId + operator/weapon/equipment`。
- [ ] 将 anomaly snapshot、连击、extra-hit generator 纳入来源映射；失衡和未知 owner按 policy 排除/Residual处理。
- [ ] 实现 `V(S)`：固定基线输入，只启用来源集合 S 的可归因 Buff，失衡严格关闭。
- [ ] 实现外层干员组 Owen value。
- [ ] 实现角色内 operator/weapon/equipment 三域 Owen value。
- [ ] 复用 RDPS-2A 的 evaluator，不复制第二份伤害公式，不从 `DamageReportBuffRow` 反推计算。
- [ ] 实现 coalition cache，key 至少包含 policy version、context fingerprint 和 coalition mask。
- [ ] 统计并输出 coalition 评估次数，验证典型四人场景没有重复计算。
- [ ] 输出角色聚合、域聚合、来源明细、Residual 和 diagnostics。
- [ ] 保证 `actualTotal = attributedTotal + residualTotal` 在规格误差内。
- [ ] 对负贡献保留符号，`negative` 标记与 diagnostics 计数正确。
- [ ] 测试单来源、多来源交互、四人三域、未知 owner、队伍外来源、失衡排除、额外 Hit 和连击。

验收：Owen 结果稳定、可重复、域合计等于角色贡献；不使用全叶子普通 Shapley 的 4096 次计算作为默认路径；实际总伤害严格对账。

## RDPS-4: 报表接线、性能与端到端验收（串行集成）

依赖：RDPS-2A、RDPS-2B、RDPS-2C、RDPS-3。

- [ ] 在 `toBuffRows` 中透传 `sourceName`、`ownerCharacterId`、`ownerBuffDomain` 和 `ownerBuffGroup`，保持正常报表展示兼容。
- [ ] 在 `buildDamageReportSnapshot` 中只在 `includeRdps=true` 时解析 context 和执行 RDPS。
- [ ] 在 `DamageReportPptPage.tsx` 的 `useMemo` 中显式开启 `includeRdps`，其它调用不变。
- [ ] 将真实 `snapshot.rdps` 接入图 3、图 4；图 1、图 2仍使用原 snapshot 数据。
- [ ] 对“队伍外来源”和 Residual 做明确文字提示，不能静默丢失。
- [ ] 检查 report page 首次计算时间，目标为典型四人 300–500ms；超出时改为 loading/effect 或 worker，并保持结果合同不变。
- [ ] 验证相同 context 的 coalition cache 命中；报告重复渲染不重复读取 localStorage。
- [ ] 执行桌面报表 E2E：四图布局、图 3对账、图 4四卡、空队伍、负值/警告和主题切换。
- [ ] 执行旧报表回归：图 1、图 2、时间轴、技能详情和画布实时计算。

验收：报表页显示真实 RDPS；普通调用性能不回退；图 1/图 2和现有伤害数值无回归；E2E 在三主题和边界场景通过。

## RDPS-5: 最终验证与交付收口

- [ ] 运行相关纯函数测试、RDPS 单元测试和现有异常/乘区测试。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm run test`。
- [ ] 运行 `npm run test:e2e:lts-slimming`，或在环境限制下记录等价的定向 E2E 结果。
- [ ] 运行 `npm run build`，确认未引入 Sites/资源构建错误。
- [ ] 执行 `git diff --check`。
- [ ] 更新本 tasks 的 Status 和已完成项；若仍有未完成范围，明确记录，不把“文档完成”标记为代码完成。
- [ ] 将实现偏离、性能实测、Residual 统计和负贡献展示记录到对应维护文档或验收记录。
- [ ] 按仓库约定在 spec+tasks 完成且代码任务完成后创建提交；本轮仅创建文档时也需单独提交文档变更。

## Explicit Non-Tasks

- [ ] 不实现完整武器/装备静态面板归因。
- [ ] 不实现真实 PNG、PDF、PPTX 导出。
- [ ] 不将 RDPS 结果写回技能按钮持久化数据。
- [ ] 不修改现有 Buff 定义的 `refCount`、层数存储或全局去重规则。
- [ ] 不引入第二套与当前伤害计算器不一致的公式。
- [ ] 不把来源名称匹配作为历史数据迁移策略。
- [ ] 不把失衡强行分摊给任何角色或来源域。
- [ ] 不为了图形 100% 完整而丢弃负贡献、Residual 或队伍外来源。
