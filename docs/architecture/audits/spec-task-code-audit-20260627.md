# Spec / Task 与代码复用审计报告

日期：2026-06-27  
范围：文档归档候选、过期文档候选、无害代码删减计划、相似业务复用冲突、上下游缺口。  
本轮不删除代码，不移动现有 spec/task，只输出可执行的整理计划。

## 执行摘要

- `npm run build` 通过；TypeScript 严格模式当前无编译级未使用符号。
- 构建警告：主 bundle 约 2.3 MB；`src/utils/assetResolver.ts` 同时被静态和动态导入，动态分包不会生效。
- 文档侧存在三类问题：已完成 spec 未归档、任务勾选状态长期未维护、部分 spec 与当前代码事实冲突。
- 代码侧存在两类重点：历史无引用模块可删减，核心业务枚举/存储 key/计算口径在多处重复维护。

## Spec / Task 归档建议

### 可直接归档的完成项

这些目录的 `tasks.md` 已全部勾选完成，建议移入 `docs/specs/archive/2026-06/` 或在原目录增加 `status: archived` 索引后冻结：

| 路径 | 任务完成度 | 建议 |
|---|---:|---|
| `docs/specs/resistance-zone/` | 121/121 | 归档，保留 spec 作为抗性区历史契约 |
| `docs/specs/sheet-equipment/` | 9/9 | 与 phase2/phase4 合并为装备 Sheet 历史链路 |
| `docs/specs/sheet-equipment-editing-phase2/` | 10/10 | 并入装备 Sheet 归档组 |
| `docs/specs/sheet-equipment-save-import-export-phase4/` | 24/24 | 并入装备 Sheet 归档组 |
| `docs/specs/weapon-equipment-buff-editor-unification/` | 9/9 | 归档；当前实现已进入共享 Buff 编辑模型 |

### 暂不归档的活跃或冲突项

| 路径 | 原因 |
|---|---|
| `docs/specs/buff-calculation-pipeline-refactor/` | 239 项中 155 项未完成；仍指向当前计算链路重构债务 |
| `docs/specs/main-workbench*` | tasks 全未勾选，但代码已有 `WorkbenchFrame`、路由和详情页；需要先重新核对状态 |
| `docs/specs/operator-config-page-replacement*` | phase 文档与当前 `OperatorConfigPage` 实现交错，不能直接归档 |
| `docs/specs/operator-studio/spec4*` | 与当前 `Dot` 类型实现存在冲突，需先决策 |
| `docs/specs/ai-cli-agent/` | Equipment storage boundary 已部分实现，但普通 UI 下游未接齐 |

## 过期文档候选

原始建议是先归档、不立即物理删除。2026-07-13 文档整理已完成下列迁移，保留这张表作为当时的审计证据：

| 文件 | 判断 | 处理建议 |
|---|---|---|
| `debug-image-bridge-url.md` | 临时调试记录 | 已迁入 `docs/specs/shell-image-update/history/` |
| `debug-image-bridge-miss.md` | 临时调试记录 | 已迁入 `docs/specs/shell-image-update/history/` |
| `docs/使用指南.txt` | 与 Markdown 指南重叠 | 已迁入 `docs/guides/quick-start-legacy.txt`，Markdown 为主入口 |
| `def-1.6迭代文档.md` | 根目录历史迭代文档 | 已迁入 `docs/history/` |
| `docs/ai-buff-fill-demo.md` | 被 AI CLI / Fill spec 取代 | 已迁入 `docs/specs/ai-cli-agent/` 作为研究材料 |
| `docs/agent-check/check20260601-2217.md` | 原始检查输出，标题不清晰 | 已迁入 AI CLI Spec，作为 verification 记录 |

保留但标记为参考：装备原始资料已迁入 `docs/specs/sheet-equipment/reference/`；综合 AI 阶段设计已迁入 `docs/specs/ai-cli-agent/`。

## 代码删减计划

### 低风险候选

| 文件 | 证据 | 删减方式 |
|---|---|---|
| `src/components/CanvasBoard/SkillButtonBuffCalculator.ts` | `rg` 未发现正式 import；现有 spec 也标注“当前无正式引用” | 删除文件，移除文档中“暂不提前删除”的遗留说明，跑 `npm run build` |
| `src/utils/loadCharacters.ts` | `AppContext` 内已有独立加载逻辑，未发现 import | 删除或并入 `AppContext` 附近说明 |
| `src/utils/weaponData.ts` | 未发现 import，且 glob 指向 `../../data/weapons/*.json`，当前数据目录不是该结构 | 删除前确认是否曾用于旧候选 Buff 入口 |
| `src/utils/layout.ts` | 未发现 import，Canvas 拖拽已在 hooks/service 中实现 | 删除前确认无外部脚本引用 |
| `src/utils/collision.ts` | 未发现 import | 删除前确认无旧 canvas 调试依赖 |
| `src/utils/assetHostApi.ts` | 当前页面使用 `imageBridge`，未发现 import | 与 `imageBridge.ts` 对照后删除旧 API |

### 中风险候选

| 文件 | 风险 |
|---|---|
| `src/components/CanvasBoard/components/OperatorConfigPanel.tsx` | 代码无正式 import，但多个旧 spec 把它作为公式参考；删除前应把仍有价值的公式差异沉淀到 `operatorPanelCalculator` 文档或测试 |
| `src/core/calculators/buffCalculator.ts` 的部分 helper | `calculateElementDmgBonus` / `calculateSkillDmgBonus` 仍被 V2 计算和 report 使用；不能整文件删除，只能随 buff pipeline 收敛 |

### 不建议删除

- `src/core/repositories/index.ts`、`src/core/services/index.ts`、`src/core/events/index.ts` 等 barrel 文件。静态脚本可能误判无入站，但目录导入和维护习惯仍可能依赖。
- `all-buff-list` / `candidate-buff-list` 快照层。当前 spec 明确要求保留。

## 复用冲突与上下游缺口

### 1. Dot 类型契约冲突

`docs/specs/operator-studio/spec4.md` 写明 `Dot` 不应成为技能按钮类型，只属于 hit 技能乘区；但当前代码中：

- `src/types/index.ts` 将 `SkillButtonType` 定义为 `A | B | E | Q | Dot`。
- `src/components/OperatorDraftPage.tsx` 的 `SKILL_BUTTON_TYPES`、筛选项和技能 `buttonType` 编辑均包含 `Dot`。
- `src/core/templates/operatorTemplate.ts` 注释也把按钮类型写为 `A/B/E/Q/Dot`。
- `src/aiCli/operatorFillAdapter.ts` 已把 hit 类型拆成 `A/B/E/Q/Dot`，但按钮类型需要再核对。

决策点：若 `Dot` 只应是 hit 类型，需要收敛全局类型；若当前允许 Dot 按钮是新事实，则应归档或改写 spec4。

### 2. Equipment draft / library 边界未统一

AI CLI 已引入：

- `def.equipment-sheet.draft.v1`
- `def.equipment-sheet.library.v1`

但普通 UI 和下游仍主要使用 draft：

- `src/components/EquipmentSheetPage.tsx` 只写 `def.equipment-sheet.draft.v1`。
- `src/components/OperatorConfigPage.tsx` 常量名是 `EQUIPMENT_LIBRARY_STORAGE_KEY`，值却是 `def.equipment-sheet.draft.v1`。
- `src/core/services/operatorConfigCandidateBuffService.ts` 读取 `def.equipment-sheet.draft.v1`。
- `electron/main.cjs` 本地数据归档同步装备库时也读取 `def.equipment-sheet.draft.v1`。

结论：Agent CLI 的“approve 写 draft / save 写 library”已经部分成立，但配置页、候选 Buff、桌面归档还没有接入 saved truth。

### 3. Buff 类型与标签重复

同一类业务枚举在多处维护：

- `src/ai/buffFillCatalog.ts`
- `src/components/operatorDraftBuffModel.ts`
- `src/components/BuffDraftPage.tsx`
- `src/components/EquipmentSheetPage.tsx`
- `src/components/WeaponDraftPage.tsx`
- `src/core/calculators/operatorPanelCalculator.ts`
- `src/aiCli/operatorFillAdapter.ts` / `weaponFillAdapter.ts` / `equipmentFillAdapter.ts`

风险：新增类型如 `dotDmgBonus`、`multiplier` 时必须多点同步，容易出现 UI 可选、AI 可写、计算不吃或报表不展示的不一致。

### 4. 计算链路仍有重复口径

当前 V2 伤害计算已使用 `buffZoneCalculator`，但 report / anomaly / Excel 仍存在局部重组：

- `src/core/calculators/skillButtonDamageCalculatorV2.ts`
- `src/core/services/damageReportService.ts`
- `src/components/CanvasBoard/skillButtonAnomalyDamage.ts`
- `src/exporters/damageExcel/buildDamageExcelWorkbook.ts`
- `src/components/DamageSheetPage.tsx`

建议按 `buff-calculation-pipeline-refactor` 继续推进，先统一五区聚合输出，再清理消费端的 `1 + rate` 拼装和旧 `multiplierMultiplier` 兼容路径。

### 5. 存储 key 常量没有覆盖新域

`src/constants/storage-keys.ts` 已存在，但 AI CLI、装备、武器、Buff 编辑器仍大量自定义 key。建议把装备/武器/Buff/AI Agent 的 key 逐步迁入统一常量，再替换散落字符串。

## 推荐下一步

1. 先确认 `Dot` 的最终模型：按钮类型还是仅 hit 类型。
2. 确认 Equipment saved truth 是否正式采用 `def.equipment-sheet.library.v1`。
3. 批准后执行第一轮低风险删减：删除无引用工具与旧 `SkillButtonBuffCalculator.ts`，每删一组跑 `npm run build`。
4. 文档侧先新增 archive 目录和索引，再移动完成项；不直接删除历史文档。
5. 对 `OperatorConfigPanel.tsx` 先抽取有价值公式差异，再删除旧组件。
