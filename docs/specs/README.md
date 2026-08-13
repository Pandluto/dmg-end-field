# Spec 总索引

本页只索引仍会约束 1.8 LTS 产品行为的规格。DEF OpenCode、旧 AI CLI、Harness、MCP/Legacy Fill 及其阶段研究、任务和验收记录已经移出当前文档树。

## 数据、排轴与工作台

- [Web 数据生命周期](../architecture/data-lifecycle.md)
- [Timeline 数据生命周期](./timeline-data-lifecycle-phase5/spec.md)
- [Timeline Worktree · Web 合同](./ai-timeline-worktree/spec.md)
- [数据层持久化与分享边界](./data-persistence-share-boundary/spec.md)
- [主界面](./main-workbench/spec.md)
- [主界面下一阶段](./main-workbench-next-phase/spec.md)
- [主界面 Buff 计层](./main-workbench-buff-countable-phase/spec.md)

## 计算

- [Buff 计算链路重构](./buff-calculation-pipeline-refactor/spec.md)
- [抗性区](./resistance-zone/spec.md)
- [RDPS 归因分析与报表图 3/图 4](./rdps-attribution/spec.md)
- [RDPS 归因 Phase 2：旧数据来源恢复与真实数据闭环](./rdps-attribution-phase2/spec.md)

## 资源与运行时

- [服务器资源通道](./resource-delivery-channel/spec.md)
- [Web 页面更新策略与缓存恢复](./web-page-update-recovery/spec.md)

## 干员与配置

- [Operator Studio](./operator-studio/spec1.md)（页面职责概述）
- [Operator Studio Spec 2](./operator-studio/spec2.md)（干员自带 Buff 内联编辑）
- [Operator Studio Spec 3](./operator-studio/spec3.md)（来源值派生 Buff）
- [Operator Studio Spec 4](./operator-studio/spec4.md)（技能 ID 类型化命名与列表筛选）
- [OperatorConfigPage 替换 Phase 1](./operator-config-page-replacement/spec.md)
- [OperatorConfigPage 替换 Phase 2](./operator-config-page-replacement-phase2/spec.md)
- [OperatorConfigPage 替换 Phase 3](./operator-config-page-replacement-phase3/spec.md)

## 移动端

- [手机版竖屏工作台 Spec](./mobile-portrait-workbench/spec.md)（首版产品定位）
- [移动端工作台运行时合同](./mobile-portrait-workbench/mobile-workbench-runtime.md)（存档、报表、桌面适配）
- [移动端 QR 战术分享与分享服务](./mobile-qr-share/spec.md)

## 装备、武器与 Buff 编辑

1. [Sheet Equipment](./sheet-equipment/spec.md)
2. [编辑交互 Phase 2](./sheet-equipment-editing-phase2/spec.md)
3. [FX 与 imgUrl 迁移 Phase 3](./sheet-equipment-fx-migration-phase3/spec.md)
4. [保存与导入导出 Phase 4](./sheet-equipment-save-import-export-phase4/spec.md)
5. [武器与装备 Buff 编辑器统一](./weapon-equipment-buff-editor-unification/spec.md)

## 图片

- [浏览器图片管理架构](./image-manager/architecture.md)

## 已退役（历史存档）

- [伤害 Excel 导出](./damage-excel-export/spec.md)：Damage Sheet、XLSX 导出与 ExcelJS 已整体退役，仅作历史设计证据，不参与验收。

## 目录内文件约定

优先使用稳定名称 `spec.md`。活跃开发可以在对应目录维护 `tasks.md`；阶段完成后，研究、任务和验收记录是否继续保留，应以其是否仍约束当前实现为准。禁止重新创建顶层 `*-spec.md`。
