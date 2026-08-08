# 架构事实源

这里记录跨 Spec、需要长期维护的当前系统事实。仍有迁移追溯价值的历史方案移入 `archive/`，其余已经退出 LTS 范围的实验架构只由 Git 历史保存。

## 当前系统

- [系统全景](./current-system.md)：组件、职责、依赖方向与关键入口。
- [运行拓扑](./runtime-topology.md)：静态站点、浏览器能力与本地开发入口。
- [数据生命周期](./data-lifecycle.md)：资料包、用户数据库、工作区与备份。
- [安全边界](./security-boundaries.md)：客户端门禁、同源存储、导入与包完整性。
- [验证矩阵](./verification-matrix.md)：哪些检查在 CI、构建或真实浏览器验收中执行。
- [CI/CD](./ci-cd.md)：质量门、自包含 Web 包和 Draft Release。
- [潮汐玻璃材质系统](./liquid-tide-material-system.md)：真实液态玻璃、单层阅读承载与全路由覆盖边界。

## 架构决策

[ADR 索引](./decisions/README.md) 只保留继续约束 1.8 LTS 的决策。

## 维护记录

- [项目架构总览](./overview.md)
- [1.8 LTS 首轮文档清理记录](../maintenance/1.8-lts-initial-document-cleanup.md)
- [1.8 LTS 第二轮运行时清理记录](../maintenance/1.8-lts-runtime-cleanup.md)
- [1.8 LTS Web 收口记录](../maintenance/1.8-lts-web-finalization.md)
- [1.8 Slim 独立 Electron Shell 职责审计与迁移方案](./audits/v1.8-slim-electron-shell-migration-20260806.md)
- [DEF 轻量 Agent Runtime 源码映射与移植方案](./audits/def-lightweight-agent-runtime-source-mapping-20260808.md)
- [DEF Agent 解耦迁移回归审计](./audits/def-agent-decoupling-regression-audit-20260808.md)

历史方案放在 [架构归档](./archive/README.md)，只用于追溯，不再作为当前实施入口。

只影响单一 Spec 的研究、验收或修复仍放在对应 `docs/specs/<spec-id>/`；本目录不替代需求事实源。
