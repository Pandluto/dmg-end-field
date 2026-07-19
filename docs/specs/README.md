# Spec 总索引

本页是开发文档的主导航。目录按产品演进线组织，阶段顺序从早到晚排列；具体完成状态以各目录中的 `spec.md`、`tasks.md` 或 verification 为准。

## Legacy Fill / MCP

- [Legacy AI CLI 独立化、标准 MCP 与 Web 填表](./legacy-ai-cli-mcp-extraction/README.md)

这条链路由 Codex 或其他标准 MCP client 直接使用，与 DEF OpenCode 平行，不通过 DEF session、tools 或运行时。

## DEF OpenCode / Agent

1. [主界面初版](./def-opencode-main-workbench/spec.md)
2. [Tools + Work Node Phase 2](./def-opencode-tools-worknode-phase2/spec.md)
3. [Tools Phase 3](./def-opencode-tools-phase3/tasks.md)
4. [Work Node Phase 4](./def-opencode-worknode-phase4/spec.md)
5. [Spec 6：原生工具与原生前端回归](./def-opencode-arch-review-spec6/spec.md)
6. [Spec 7：本地产品化](./def-opencode-local-productization-spec7/spec.md)
7. [Spec 8 占位与索引](./def-opencode-cognitive-runtime-spec8/README.md)
   - [Spec 8-1：可训练基建总览](./def-opencode-cognitive-runtime-spec8/spec8-1.md)
     - [Spec 8-1-1：OpenCode 后门与 Codex 联调协议](./def-opencode-cognitive-runtime-spec8/spec8-1-1.md)
     - [Spec 8-1-2：Harness 迭代框架基础建设](./def-opencode-cognitive-runtime-spec8/spec8-1-2.md)
     - [Spec 8-1-3：Codex 协议联调与初版验证](./def-opencode-cognitive-runtime-spec8/spec8-1-3.md)
   - [Spec 8-2：数据架构与会话权限收口](./def-opencode-cognitive-runtime-spec8/spec8-2.md)
     - [Task 8-2：收紧 DEF OpenCode 的 SQLite 与会话边界](./def-opencode-cognitive-runtime-spec8/task8-2.md)
     - [Spec 8-2-1：当前工作区确定性与 Work Node 工作树统一返修](./def-opencode-cognitive-runtime-spec8/spec8-2-1.md)
       - [Task 8-2-1：闭合当前正式 SQLite 与工作树边界](./def-opencode-cognitive-runtime-spec8/task8-2-1.md)
     - [Spec 8-2-2：DEF current tool 全量准入与全队原子候选](./def-opencode-cognitive-runtime-spec8/spec8-2-2.md)
       - [Task 8-2-2：封闭 current tool 侧门并落地全队候选 C](./def-opencode-cognitive-runtime-spec8/task8-2-2.md)
   - [Spec 8-3：进化产品化](./def-opencode-cognitive-runtime-spec8/spec8-3.md)
   - [预研究：认知运行时与游戏知识 Agent](./def-opencode-cognitive-runtime-spec8/research.md)
   - [预研究：Harness 自进化](./def-opencode-cognitive-runtime-spec8/harness-self-evolution-research.md)

关联演进线：

- [AI CLI Agent](./ai-cli-agent/spec.md)
- [AI Timeline Worktree](./ai-timeline-worktree/spec.md)
- [主界面](./main-workbench/spec.md)
- [主界面下一阶段](./main-workbench-next-phase/spec.md)
- [主界面 Buff 计层](./main-workbench-buff-countable-phase/spec.md)

## Timeline 与计算

- [Spec 5：Timeline 数据生命周期](./timeline-data-lifecycle-phase5/spec.md)
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

优先使用稳定名称 `spec.md`、`tasks.md`、`research.md` 和 `verification.md`。存在多个任务或验收批次时使用语义后缀，例如：

- `task7-2.md`
- `verification-blackbox-task2-20260711.md`
- `health-review-20260713.md`
- `fix-report-20260615.md`

禁止重新创建顶层 `*-spec.md`。新阶段应创建新的 Spec 目录，旧阶段的维护记录则进入原 Spec 目录。
