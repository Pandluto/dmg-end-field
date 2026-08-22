# RDPS 归因 Phase 2：旧数据来源恢复与真实数据闭环 Tasks

## Status

核心修复已完成并于 2026-08-14 使用本机真实工作区“莱狼羊卡-热启动爆发轴”验收：旧 Buff 与旧连击均通过只读 runtime sidecar 恢复来源，不新增、不回填持久化字段；Owen 来源建模与 evaluator 现在消费同一份解析结果。

真实报表结果：总伤害 1,874,655，来源合计 1.27M，Residual 602.9K；莱万汀 597.0K、狼卫 133.4K、艾尔黛拉 336.2K、卡缪 192.1K，四人均有来源贡献；队伍外 `chr_0019_karin` 正确显示为“秋栗”并仅进入图 3；装备资产显示为“动火用 / 长息 / 拓荒”；Owen 效率误差、层级误差、总账误差均为 0。桌面端“状态区 → 连击”已显示四人来源选择器，验收时只展开候选，未写回用户工作区。

验证已通过：`npm run typecheck`、`npm test`、RDPS 定向测试、`npx vite build`、`git diff --check`，真实页面控制台无 error。RDPS2-4 的分阶段性能计时尚未单独记录，因此 Phase 2 暂不标记为全量完成。

2026-08-14 视觉收口：图 3 已按反馈改为“左侧总伤 RD 构成饼图 + 右侧各干员总 RD 柱状图”，移除逐来源/域/资产表格；图 4 继续承担四名干员三域明细。已用同一真实轴验证明亮白、apple-midnight、lieflat-mono、liquid-tide，原用户主题已恢复。

2026-08-14 v3 公式修正：基础/直接伤害不再进入 Residual，而是按出伤按钮的
`characterId` 归入对应干员 `operator` 域；Owen 继续只分配 Buff 边际贡献。
“五色队-热启动循环”实算为总伤 1,364,022.54、直接伤害 612,758.54、Buff
边际贡献 751,264.00、Residual 0；四人贡献合计与总伤一致。

标有 `[Sub-agent 可独立]` 的任务可以交给 sub-agent 独立完成。每个 sub-agent 只能修改任务声明的文件范围，并提交单一职责 commit；共享合同和最终接线由主 agent 串行处理。

## Dependency Map

```text
RDPS2-0 真实轴证据与失败基线（串行）
    ↓
RDPS2-1 临时来源合同与解析优先级（串行）
    ├── RDPS2-2A 旧 Buff provenance resolver       [Sub-agent 可独立]
    ├── RDPS2-2B 连击与异常来源 resolver            [Sub-agent 可独立]
    ├── RDPS2-2C 角色 ID / 展示名目录               [Sub-agent 可独立]
    ├── RDPS2-2D Owen 与独立对账修正                [Sub-agent 可独立]
    ├── RDPS2-2E 图 3 / 图 4 与诊断修正             [Sub-agent 可独立]
    └── RDPS2-2F 旧/新数据 parity 与金样夹具        [Sub-agent 可独立]
                         ↓
RDPS2-3 Resolve / Evaluate / RDPS 串行集成
                         ↓
RDPS2-4 真实 SQLite、浏览器、性能验收
                         ↓
RDPS2-5 文档收口与提交
```

## RDPS2-6：基础伤害归入出伤干员本体（主 Agent 串行）

该修复同时改变共享合同、桌面评估器、移动评估器与 Owen 对账，不适合拆成互不依赖的
sub-agent 修改；定向测试与真实 SQLite 回归可以独立复核。

- [x] 提升 policyVersion，新增直接伤害与 Buff 边际贡献的独立总计。
- [x] 增加“关闭全部 Buff + 关闭失衡”的直接伤害过滤口径。
- [x] 桌面端按按钮 `characterId` 聚合直接伤害。
- [x] 移动端按 action `operatorId` 聚合直接伤害。
- [x] 将直接伤害合并到该干员 operator 来源行；无 operator Buff 时仍生成本体行。
- [x] Owen 效率只核对 Buff 边际贡献，层级与总账核对完整 RD。
- [x] 未解析 Buff 不进入直接伤害，继续留在 Residual。
- [x] synthetic 回归覆盖直接伤害、operator/weapon 边际贡献与 unresolved Residual。
- [x] `[Sub-agent 可独立复核]` 使用“五色队-热启动循环”验证四人合计等于总伤。

RDPS2-2A/2B/2C 可以在共享合同完成后并行。RDPS2-2D 只修改算法与纯数学测试，不接触来源解析。RDPS2-2E 使用 mock summary 开发。RDPS2-2F 只提供 fixture、断言和测试辅助，不修改生产逻辑。

## Guardrails

- [ ] 不为本轮新增必需的 SQLite 字段或迁移。
- [ ] 不把解析结果写回 `allBuffList`、`skillButtonTable`、Timeline payload 或候选列表。
- [ ] 不要求用户重新保存旧工作区。
- [ ] 不使用 `sourceName` 单字段做 owner 匹配。
- [ ] 不做模糊文本匹配、拼音匹配或“最像的来源”推断。
- [ ] 不改变图 1、图 2 及普通伤害值。
- [ ] 不复制第二套伤害公式。
- [ ] 连击固定数值不等于无来源。
- [ ] 失衡继续严格排除，并同时覆盖 Buff 与面板失衡加成。
- [ ] 不以 `actual = attributed + residual` 的构造恒等式冒充 Owen 正确性。
- [ ] 未完成真实 SQLite 验收前，不把 Phase 2 标记为完成。

## RDPS2-0：真实轴证据与失败基线（串行）

目标：冻结真实问题，防止后续用 synthetic fixture 通过替代用户存档通过。

- [ ] 在只读模式下定位 SQLite 中“莱狼羊卡-热启动爆发轴”的 workspace/document/checkout 身份。
- [ ] 若存在同名、带后缀或多个版本，记录 payload hash、按钮数、队伍与更新时间，选定唯一金样。
- [ ] 导出仅测试所需的去敏结构 fixture，禁止把用户完整 SQLite 作为测试资源提交。
- [ ] 冻结当前失败截图中的结构事实：大量 Residual、三名队员为 0、原始 ID 泄漏、错误来源警告。
- [ ] 建立来源矩阵：每个旧 Buff 定义对应的内部 name、期望干员 ID、期望域、期望资产名与解析证据。
- [ ] 建立异常矩阵：snapshot ID、key、sourceButtonId、sourceCharacterId、sourceCharacterName。
- [ ] 建立按钮目录：button ID、staffIndex、persisted characterId、timeline staff name、selected character ID。
- [ ] 明确金样中哪些条目确实 unresolved；不得默认所有缺 owner 字段的条目 unresolved。
- [ ] 将金样数据提取脚本或说明放入测试目录，不修改生产 SQLite。

验收：

- 金样能够重复加载。
- 输入来源矩阵经人工核对。
- 后续测试能区分“字段缺失”与“来源不可恢复”。

## RDPS2-1：临时来源合同与解析优先级（串行）

目标：稳定所有并行任务共同依赖的只读合同。

建议文件边界：

- `src/core/services/rdpsSourceResolution.types.ts`
- `src/core/services/rdpsSourceResolutionContext.ts`
- `src/core/services/rdpsAttribution.types.ts`

任务：

- [ ] 定义 `RdpsResolvedSource`、resolution method、evidence key 和 unresolved reason。
- [ ] 定义稳定来源 key 仍为 `characterId + domain`，但不要求原 Buff 持有这两个字段。
- [ ] 定义按 Buff 应用/状态应用索引的只读 sidecar。
- [ ] 定义 `RdpsCharacterDirectory`、`RdpsCandidateProvenanceIndex`、button-to-character map。
- [ ] 定义 legacy projection，明确排除 owner 字段并保留所有计算身份字段。
- [ ] 定义冲突策略：explicit、candidate、canonical path、结构关系结果冲突时如何诊断。
- [ ] 定义 diagnostics 新字段及 definition/application 两种计数单位。
- [ ] 新增 `owenEfficiencyError`、`hierarchyError`、`accountingError`。
- [ ] 提升 policyVersion。
- [ ] 类型合同不得导入 React 或直接读取 storage。

验收：

- RDPS2-2A/2B/2C/2D/2E/2F 可只依赖该合同并行开发。
- 类型本身不要求新增持久化字段。

## RDPS2-2A：旧 Buff Provenance Resolver `[Sub-agent 可独立]`

建议 owner：legacy provenance agent。

依赖：RDPS2-1。

建议文件边界：

- 新建 `src/core/services/rdpsLegacyBuffSourceResolver.ts`
- 新建同名测试文件
- 必要时只读复用 `operatorConfigCandidateBuffService.ts` 的纯构造函数；不要修改报表或 Owen 文件

任务：

- [ ] 从 `operatorConfigPageCache` 枚举 operator talent/potential/skill 候选来源。
- [ ] 从 weapon `skill3.effects` 枚举武器来源。
- [ ] 从 equipment `setBuffs` 与当前候选数据枚举装备来源。
- [ ] 纳入当前 candidate Buff 列表，但不得刷新或写回该列表。
- [ ] 实现排除 owner 字段的 legacy projection。
- [ ] 实现唯一精确匹配：0 个为 missing，1 个为 resolved，多个不同 owner 为 ambiguous。
- [ ] 实现规范内部路径白名单解析：
  - `operator-studio:<characterId>:<group>:...`
  - `operator-config-snapshot:<characterId>:weapon:<weaponId>:...`
  - `operator-config-snapshot:<characterId>:equipment:<setId>:...`
- [ ] 验证 canonical path 与 candidate exact 结果一致；冲突时返回诊断。
- [ ] 输出来源资产名，但不把资产名作为来源 key。
- [ ] 对本地自定义 Buff 保持保守，不按 sourceName 猜测。
- [ ] 对 extra-hit Buff 使用与普通 Buff 相同的来源解析。

必测：

- [ ] 新 Buff 显式 owner。
- [ ] 同一 Buff 删除 owner 后唯一匹配。
- [ ] 候选列表为空但 canonical path 可解析。
- [ ] 同名同值、不同 owner 的歧义。
- [ ] 恶意或用户自定义冒号字符串不能命中白名单。
- [ ] operator、weapon、equipment 三域。
- [ ] derived、multiplier、countable、extra-hit 投影不串项。

验收：

- 金样来源矩阵中的应用生成旧 Buff 全部得到预期 owner/domain。
- resolver 为纯函数或只读函数，无 storage 写入。

## RDPS2-2B：连击与异常来源 Resolver `[Sub-agent 可独立]`

建议 owner：anomaly provenance agent。

依赖：RDPS2-1。

建议文件边界：

- 新建 `src/core/services/rdpsAnomalySourceResolver.ts`
- `src/core/services/anomalyStateBuffs.test.ts`
- 新建 resolver 测试
- 不修改图表和 Owen 引擎

任务：

- [ ] 导电、腐蚀、碎甲优先使用 snapshot sourceCharacterId。
- [ ] snapshot 缺 ID 但有 sourceButtonId 时，通过 button-to-character map 恢复。
- [ ] snapshot sourceCharacterName 只作展示和一致性校验。
- [ ] 新连击显式来源存在时正常读取。
- [ ] 旧连击缺显式来源时，使用 containing button 的稳定干员 ID。
- [ ] 若连击模型存在 sourceButtonId，则优先使用来源按钮。
- [ ] 旧按钮缺 characterId 时，调用共享按钮/角色目录恢复，不使用中文名当稳定 ID。
- [ ] 连击输出 operator 域。
- [ ] B/Q 四档值保持不变，A 为 0。
- [ ] 失衡输出 excluded，不生成 owner。
- [ ] 不要求新增或回填 PersistedAnomalyCard 字段。

必测：

- [ ] 新旧连击同按钮 parity。
- [ ] 旧连击随 containing button 干员变化而改变来源。
- [ ] 导电/腐蚀/碎甲 sourceButton fallback。
- [ ] 队伍外异常来源。
- [ ] 失衡不归因。
- [ ] 缺失按钮关系时产生 unresolved，而不是归给出伤者。

验收：

- 固定数值连击不再无条件进入 Residual。
- 所有来源推导只存在于 RDPS context。

## RDPS2-2C：角色 ID 与展示名目录 `[Sub-agent 可独立]`

建议 owner：identity resolution agent。

依赖：RDPS2-1。

建议文件边界：

- 新建 `src/core/services/rdpsCharacterDirectory.ts`
- 新建同名测试
- 不修改算法与 UI

任务：

- [ ] 汇总 selectedCharacters、timeline staff lines、skillButtonTable 和 operatorConfigPageCache。
- [ ] 汇总 anomaly snapshots 中的 source ID/name，覆盖队伍外来源。
- [ ] 建立 staffIndex → selected character ID 映射。
- [ ] 建立 button ID → stable character ID 映射。
- [ ] 定义同 ID 多名称、同名称多 ID 的冲突规则。
- [ ] operatorConfig snapshot name 优先于原始 ID。
- [ ] 只有全部来源都缺失时才回退显示 raw ID，并记录诊断。
- [ ] 保证队伍顺序来自当前报表队伍，不因队伍外来源改变图 4 顺序。

必测：

- [ ] `chr_0019_karin → 秋栗`。
- [ ] 旧按钮无 characterId、只有 staffIndex。
- [ ] 中文同名但不同 ID。
- [ ] 队伍外来源正常显示但不进入图 4。
- [ ] 冲突可观测且确定性。

验收：

- 金样所有可解析 ID 都显示正确名称。
- 图 4 顺序稳定为莱万汀、狼卫、艾尔黛拉、卡缪。

## RDPS2-2D：Owen 与独立对账修正 `[Sub-agent 可独立]`

建议 owner：attribution math agent。

依赖：RDPS2-1。可使用人工构造的 source groups，不依赖 2A/2B/2C 实现。

文件边界：

- `src/core/services/rdpsContributionService.ts`
- `src/core/services/rdpsContributionService.test.ts`
- 必要时新增纯数学 fixture
- 不修改 damage report、来源 resolver 或图表

任务：

- [ ] 支持每个角色组不同数量的叶子。
- [ ] 每个组用自身 inner permutation 数作为归一化分母。
- [ ] 修复队伍外多个来源只启用第一个叶的问题。
- [ ] 明确队伍外聚合策略，并保证 evaluator 开关全部底层来源。
- [ ] 不为不存在的域制造无意义来源行。
- [ ] 输出 `sum(source.damage)` 与 `attributionWorldTotal - baselineTotal` 的独立误差。
- [ ] 输出角色/域层级求和误差。
- [ ] 保留 accounting error，但不将其作为唯一正确性证明。
- [ ] cache key 接收真实 context fingerprint，不再用 `N-buttons`。
- [ ] 保留负贡献符号。
- [ ] 限制或记录 coalition evaluation count。

必测：

- [ ] 2 组 × 不同叶子数。
- [ ] 4 个队伍组 + 1 个队伍外聚合。
- [ ] 队伍外底层包含多个来源 key。
- [ ] 负贡献。
- [ ] 效率性质、对称性、确定性。
- [ ] 人为漏掉一个 leaf 时 owenEfficiencyError 必须失败，即使 accountingError 仍为 0。

验收：

- 三个误差独立计算并在正确 fixture 上通过。
- 错误 fixture 不再得到假“对账通过”。

## RDPS2-2E：图 3 / 图 4 与诊断修正 `[Sub-agent 可独立]`

建议 owner：report UI agent。

依赖：RDPS2-1。使用 mock v2 summary。

文件边界：

- `src/components/DamageReportRdpsCharts.tsx`
- `src/components/DamageReportPptPage.css`
- 三套主题中 RDPS 专属规则
- 组件 fixture/test
- 不修改来源解析、计算服务或 persistence

任务：

- [ ] 图 3 左侧仅显示“来源 RD / 自身与其他”的总伤构成饼图。
- [ ] 图 3 右侧仅显示按干员聚合后的总 RD 柱状图，不重复域、武器、装备和单 Buff 明细。
- [ ] 图 3 队伍外来源使用正确名称追加为独立柱，不得静默丢失。
- [ ] 图 3 正常聚合值与 `actualTotal / attributedTotal / residualTotal` 对账；负聚合值不伪造饼图。
- [ ] summary 中继续保留 Owen 效率误差、层级误差、总账误差及解析诊断，但不占用图 3 可视区域。
- [ ] 图 4 domain 显示中文，不直接显示 operator/weapon/equipment。
- [ ] 四名干员卡使用真实三域数据。
- [ ] 零值、负值、正负混合和长资产名可读。
- [ ] 修复 1280×720 下图 4 内容高度超过卡片的问题。
- [ ] 验证 lieflat-mono、liquid-tide、apple-midnight。

验收：

- 图 3 只有一张饼图和一张柱状图，无来源明细表。
- 图 3 与图 4 不重复展示域明细；mock v2 summary 下无原始英文域。
- 2×2 图格无溢出。

## RDPS2-2F：旧/新数据 Parity 与金样夹具 `[Sub-agent 可独立]`

建议 owner：regression fixture agent。

依赖：RDPS2-0、RDPS2-1。

文件边界：

- 新建 `src/core/services/rdpsLegacyCompatibility.fixture.ts`
- 新建对应测试
- 必要的 `tests/e2e` fixture/helper
- 不修改生产代码

任务：

- [ ] 构造包含四人三域的新数据 fixture。
- [ ] 克隆并删除 owner 字段，形成旧数据 fixture。
- [ ] 保留 candidate/config/timeline/button 引用层级。
- [ ] 断言新旧来源 resolution 完全一致。
- [ ] 断言新旧 Owen 输出在容差内一致。
- [ ] 构造旧 combo card，无新增来源字段但有 containing button。
- [ ] 构造异常 sourceButton fallback。
- [ ] 构造歧义、真正 missing、自定义 Buff 和队伍外来源。
- [ ] 从金样提取去敏来源矩阵 fixture。
- [ ] 添加三个独立误差 helper。
- [ ] 添加名称断言，禁止可解析 raw ID 泄漏。

验收：

- fixture 不读取用户绝对路径。
- fixture 不包含完整用户存档。
- 测试失败信息能指出具体 Buff、解析方法和 evidence key。

## RDPS2-3：Resolve / Evaluate / RDPS 串行集成

依赖：RDPS2-2A 至 RDPS2-2F。

建议由主 agent 执行，避免多 agent 同时修改核心计算文件。

主要文件：

- `src/core/services/damageReportService.ts`
- `src/core/services/rdpsContributionService.ts` 的接口接线
- `src/core/services/rdpsAttribution.types.ts`

任务：

- [ ] Resolve 阶段一次性构建 character directory、candidate index 和 button map。
- [ ] 为普通 Buff、extra-hit、异常、连击生成只读 source sidecar。
- [ ] evaluator 来源过滤改为消费 sidecar，不再只读 Buff owner 字段。
- [ ] 保证不启用 RDPS 时原路径无行为变化。
- [ ] strict imbalance 同时关闭 Buff 与面板 imbalance bonus。
- [ ] 将真实 context fingerprint 传入 cache。
- [ ] 将 v2 diagnostics 和三种误差接入 summary。
- [ ] 接入 v2 图表数据。
- [ ] 不写回任何 storage。
- [ ] 用 instrumentation 分开记录 resolve、provenance、evaluate、render 耗时。

验收：

- 新旧 parity 测试通过。
- 普通报告逐 Hit 数值无回归。
- 来源过滤能正确移除普通、derived、countable、extra-hit、异常和连击影响。

## RDPS2-4：真实 SQLite、浏览器与性能验收

依赖：RDPS2-3。

- [ ] 启动或复用 127.0.0.1:3030 开发服务，不关闭用户已有进程。
- [ ] 应用金样“莱狼羊卡-热启动爆发轴”。
- [ ] 截取来源解析审计摘要：method 分布、unresolved/ambiguous 明细。
- [ ] 对照 RDPS2-0 来源矩阵逐项检查 owner/domain。
- [ ] 检查莱万汀、狼卫、艾尔黛拉、卡缪图 4 卡片。
- [ ] 检查 `chr_0019_karin` 显示为秋栗。
- [ ] 检查队伍外来源仅图 3展示。
- [ ] 检查所有可解析旧 Buff 不再触发缺失来源警告。
- [ ] 检查三个误差均在阈值内。
- [ ] 检查图 1、图 2 总损伤、占比、时序与改动前一致。
- [ ] 在三套主题检查 1280×720 无溢出。
- [ ] 检查控制台错误。
- [ ] 分开记录 RDPS 各阶段耗时；整页约 3 秒不能代替算法耗时。
- [ ] 若标准 `npm run dev` 被远程资源阻塞，记录环境问题并使用仓库允许的本地等价路径，但不能跳过真实浏览器。

验收结论模板：

- 来源覆盖：通过/不通过。
- 名称解析：通过/不通过。
- 连击/异常：通过/不通过。
- Owen 效率：通过/不通过。
- 图表与主题：通过/不通过。
- 性能：通过/不通过/仅记录。

任一前五项不通过时，总体结论必须为不通过。

## RDPS2-5：最终验证、文档收口与提交

- [ ] 运行来源 resolver 单元测试。
- [ ] 运行 combo/anomaly 单元测试。
- [ ] 运行 Owen 数学测试。
- [ ] 运行新旧 parity 和金样 fixture 测试。
- [ ] 运行 `npm run typecheck`。
- [ ] 运行 `npm test`。
- [ ] 运行相关浏览器 E2E。
- [ ] 运行可用的生产构建；外部资源失败需保留原始证据。
- [ ] 运行 `git diff --check`。
- [ ] 将真实验收结果写入本文件 Status，不提前勾选。
- [ ] 记录 policyVersion、来源覆盖、Residual、三种误差、coalition count 和阶段耗时。
- [ ] 按仓库约定提交代码与文档。

## Suggested Sub-agent Handoffs

每个 handoff 应包含：

- 当前 commit SHA。
- 本 task 的允许文件范围。
- RDPS2-1 的合同链接。
- 必须运行的定向测试。
- 禁止写 storage 的要求。
- 返回的 evidence：修改文件、测试输出、已知未覆盖项。

推荐并行批次：

1. 第一批：RDPS2-2A、2B、2C、2D、2E、2F。
2. 第二批：主 agent 审核接口与冲突，完成 RDPS2-3。
3. 第三批：独立 QA sub-agent 执行 RDPS2-4，只报告证据，不修改生产逻辑。

## Explicit Non-tasks

- [ ] 不批量重写用户 SQLite。
- [ ] 不新增“RDPS owner migration”。
- [ ] 不用 sourceName 单独映射。
- [ ] 不把旧数据全部归给当前出伤干员。
- [ ] 不删除 Residual；真正不可归因数据仍保留。
- [ ] 不改变连击四档数值。
- [ ] 不归因失衡。
- [ ] 不把页面成功打开当成来源正确。
