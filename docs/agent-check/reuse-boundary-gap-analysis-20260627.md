# 复用不一致与上下游缺口分析

日期：2026-06-27

## 结论

当前主要问题不是单个文件是否能删，而是业务契约、存储真相、枚举定义和计算口径仍分散在多个模块中维护。短期可运行，但后续继续扩展 Buff、装备、AI CLI 和报表时，容易出现“某入口能写、某入口不读、某报表不算”的漂移。

## 1. Dot 类型契约冲突

现状：

- `docs/specs/operator-studio/spec4.md` 写明 `Dot` 不作为技能按钮类型，只属于 hit 技能乘区。
- `src/types/index.ts` 当前把 `SkillButtonType` 定义为 `A | B | E | Q | Dot`。
- `src/components/OperatorDraftPage.tsx` 的技能按钮类型、筛选和编辑控件包含 `Dot`。
- `src/core/templates/operatorTemplate.ts` 注释也把按钮类型写成 `A/B/E/Q/Dot`。
- `src/aiCli/operatorFillAdapter.ts` 中 hit 类型允许 `Dot`，这点符合 spec；但按钮类型仍需要复核。

影响：

- 画布按钮、运行时模板、伤害解析和 operator-studio 的模型边界不清。
- 若将来按 spec 收敛，历史数据里可能已经存在 `buttonType=Dot` 的技能，迁移策略需要明确。

建议：

1. 先确认最终模型：`Dot` 是否允许成为按钮类型。
2. 若不允许，拆分全局类型为 `SkillButtonType = A/B/E/Q` 与 `HitSkillType = A/B/E/Q/Dot`。
3. 给旧数据保留读取兼容，但新建/编辑入口不再生产 `buttonType=Dot`。

## 2. Equipment draft / library 边界不统一

现状：

- AI CLI 已定义 `def.equipment-sheet.draft.v1` 和 `def.equipment-sheet.library.v1`。
- `equipment.fill.apply` 的设计是审批写 draft，保存写 library。
- `src/components/EquipmentSheetPage.tsx` 普通 UI 仍只写 `def.equipment-sheet.draft.v1`。
- `src/components/OperatorConfigPage.tsx` 常量名是 `EQUIPMENT_LIBRARY_STORAGE_KEY`，值却是 `def.equipment-sheet.draft.v1`。
- `src/core/services/operatorConfigCandidateBuffService.ts` 读取 `def.equipment-sheet.draft.v1`。
- `electron/main.cjs` 本地数据归档同步装备库时也读取 `def.equipment-sheet.draft.v1`。

影响：

- Agent CLI saved truth 与 UI saved truth 不一致。
- 配置页可能读不到 AI CLI 已保存到 `library.v1` 的装备真相。
- 桌面归档和恢复可能继续围绕 draft 工作，导致 library 形同孤岛。

建议：

1. 明确 `def.equipment-sheet.library.v1` 是否正式作为装备主库。
2. 若采用 library，装备页保存动作写 library，同时编辑中状态可继续写 draft。
3. `OperatorConfigPage`、候选 Buff 服务、Electron 归档统一读取主库，必要时 fallback 到旧 draft。
4. 常量名和值对齐，避免 `EQUIPMENT_LIBRARY_STORAGE_KEY = draft` 这种误导。

## 3. Buff 类型、标签和白名单重复

重复维护位置：

- `src/ai/buffFillCatalog.ts`
- `src/components/operatorDraftBuffModel.ts`
- `src/components/BuffDraftPage.tsx`
- `src/components/EquipmentSheetPage.tsx`
- `src/components/WeaponDraftPage.tsx`
- `src/core/calculators/operatorPanelCalculator.ts`
- `src/aiCli/operatorFillAdapter.ts`
- `src/aiCli/weaponFillAdapter.ts`
- `src/aiCli/equipmentFillAdapter.ts`

影响：

- 新增字段时必须多点同步，例如 `dotDmgBonus`、`multiplier`。
- 可能出现 UI 可选、AI 可写、计算不吃、报表不展示的状态。
- 类型 label、搜索关键词、AI schema、计算白名单和导出字段之间没有单一来源。

建议：

1. 将 Buff modifier catalog 作为上游真相。
2. UI 选项、AI CLI schema、adapter 支持类型、计算 label 尽量从 catalog 派生。
3. 不同领域确实需要子集时，只维护“领域允许列表”，不要复制完整 label 表。

## 4. 计算口径仍有重复拼装

现状：

- `src/core/calculators/buffZoneCalculator.ts` 已承担 hit 级五区聚合。
- `src/core/calculators/skillButtonDamageCalculatorV2.ts` 已接入统一五区聚合。
- `src/core/services/damageReportService.ts`、`src/components/CanvasBoard/skillButtonAnomalyDamage.ts`、`src/exporters/damageExcel/buildDamageExcelWorkbook.ts`、`src/components/DamageSheetPage.tsx` 仍有局部公式和展示拼装。
- `calculateElementDmgBonus` / `calculateSkillDmgBonus` 仍从旧 `buffCalculator.ts` 被复用。

影响：

- 普通伤害、异常伤害、报表、Excel 之间容易出现公式细节漂移。
- `multiplierMultiplier` 兼容和 `1 + rate` 拼装清理不彻底。

建议：

1. 以 `buffZoneCalculator` 输出作为五区唯一计算结果。
2. Report、DamageSheet、Excel、异常伤害只消费结构化结果，不自行重组乘区。
3. 旧 helper 先保留，等消费端收敛后再删除或移动到兼容层。

## 5. 存储 key 常量覆盖不足

现状：

- `src/constants/storage-keys.ts` 已存在。
- AI Agent、Buff 编辑器、武器编辑器、装备编辑器仍有散落硬编码 key。
- Electron 归档侧也维护了一份本地数据 key / prefix 清单。

影响：

- 新 storage key 增加后，归档、REST、UI、配置页可能漏接。
- draft/library 边界变化时需要多处人工替换。

建议：

1. 把 Buff / Weapon / Equipment / AI Agent 的 key 逐步迁入 `storage-keys.ts`。
2. Electron 归档和前端存储读写共用同名常量或生成清单。
3. 新增 storage key 时要求同步声明归档策略：是否主库、是否草稿、是否 session-only。

## 优先处理顺序

1. 确认 `Dot` 类型最终契约。
2. 确认 Equipment 主库是否正式切到 `def.equipment-sheet.library.v1`。
3. 统一 storage key 常量，先解决装备 draft/library 命名和值错位。
4. 抽出 Buff 类型 catalog 的领域子集，减少 UI / AI / 计算重复列表。
5. 继续推进 buff pipeline，收敛 report、异常伤害和 Excel 的重复计算口径。
