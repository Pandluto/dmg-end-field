# Spec 总索引

本页只索引仍会约束 1.8 LTS 产品行为的规格。旧 AI CLI、旧 Sidecar/REST 与 Node 业务 SQLite 已经退役；桌面 AI 模式复用锁定版本的原生 OpenCode UI，现行决策以 [ADR-0008](../architecture/decisions/0008-native-opencode-ui.md) 为准。新的桌面 Agent、Harness、OpenCode EngineAdapter 和独立 Legacy Fill MCP 继续遵守浏览器 SQLite 唯一业务事实源的边界。

## 数据、排轴与工作台

- [Web 数据生命周期](../architecture/data-lifecycle.md)
- [Timeline 数据生命周期](./timeline-data-lifecycle-phase5/spec.md)
- [Timeline Worktree · Web 合同](./ai-timeline-worktree/spec.md)
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

## 图片

- [浏览器图片管理架构](./image-manager/architecture.md)

## 桌面 Agent

- [DEF Agent Core Phase 1](./def-agent-core-phase1/spec.md)
- [DEF Agent Core Phase 1 Tasks](./def-agent-core-phase1/tasks.md)
- [DEF Agent Host 与 Browser ProductGateway Phase 2](./def-agent-host-phase2/spec.md)
- [DEF Agent Host 与 Browser ProductGateway Phase 2 Tasks](./def-agent-host-phase2/tasks.md)
- [DEF Harness 与五业务只读 Tool Phase 3](./def-agent-harness-phase3/spec.md)
- [DEF Harness 与五业务只读 Tool Phase 3 Tasks](./def-agent-harness-phase3/tasks.md)
- [DEF Harness 与五业务只读 Tool Phase 3 验证记录](./def-agent-harness-phase3/validation.md)
- [OpenCode EngineAdapter Phase 4](./def-opencode-engine-phase4/spec.md)
- [OpenCode EngineAdapter Phase 4 Tasks](./def-opencode-engine-phase4/tasks.md)
- [ADR-0008：AI 模式复用原生 OpenCode UI](../architecture/decisions/0008-native-opencode-ui.md)

## 目录内文件约定

优先使用稳定名称 `spec.md`。活跃开发可以在对应目录维护 `tasks.md`；阶段完成后，研究、任务和验收记录是否继续保留，应以其是否仍约束当前实现为准。禁止重新创建顶层 `*-spec.md`。
