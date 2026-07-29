# Spec 总索引

本页只索引仍会约束 1.8 LTS 产品行为的规格。DEF OpenCode、旧 AI CLI 及其阶段研究、任务和验收记录已经移出当前文档树。

## Legacy Fill / MCP

- [Legacy AI CLI 独立化、标准 MCP 与 Web 填表](./legacy-ai-cli-mcp-extraction/README.md)

MCP 在 1.8 LTS 中作为独立本地能力保留。过程性 T0–T9 验收记录不再进入 LTS 文档索引。

## 数据、排轴与工作台

- [SQLite 数据管理与 Release](./data-management-sqlite-release/spec.md)
- [Timeline 数据生命周期](./timeline-data-lifecycle-phase5/spec.md)
- [Timeline Worktree](./ai-timeline-worktree/spec.md)
- [主界面](./main-workbench/spec.md)
- [主界面下一阶段](./main-workbench-next-phase/spec.md)
- [主界面 Buff 计层](./main-workbench-buff-countable-phase/spec.md)

## 计算与导出

- [Buff 计算链路重构](./buff-calculation-pipeline-refactor/spec.md)
- [抗性区](./resistance-zone/spec.md)
- [伤害 Excel 导出](./damage-excel-export/spec.md)

## 干员与配置

- [Operator Studio](./operator-studio/spec1.md)
- [OperatorConfigPage 替换 Phase 1](./operator-config-page-replacement/spec.md)
- [OperatorConfigPage 替换 Phase 2](./operator-config-page-replacement-phase2/spec.md)
- [OperatorConfigPage 替换 Phase 3](./operator-config-page-replacement-phase3/spec.md)

## 装备、武器与 Buff 编辑

1. [Sheet Equipment](./sheet-equipment/spec.md)
2. [编辑交互 Phase 2](./sheet-equipment-editing-phase2/spec.md)
3. [FX 与 imgUrl 迁移 Phase 3](./sheet-equipment-fx-migration-phase3/spec.md)
4. [保存与导入导出 Phase 4](./sheet-equipment-save-import-export-phase4/spec.md)
5. [武器与装备 Buff 编辑器统一](./weapon-equipment-buff-editor-unification/spec.md)

## Shell

- [Shell 图片更新](./shell-image-update/spec.md)
- [图片管理架构](./image-manager/architecture.md)

## 目录内文件约定

优先使用稳定名称 `spec.md`。活跃开发可以在对应目录维护 `tasks.md`；阶段完成后，研究、任务和验收记录是否继续保留，应以其是否仍约束当前实现为准。禁止重新创建顶层 `*-spec.md`。
