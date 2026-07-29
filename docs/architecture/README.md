# 架构事实源

这里记录跨 Spec、需要长期维护的当前系统事实。历史审计和已经退出 LTS 范围的实验架构由 Git 历史保存，不继续留在本目录。

## 当前系统

- [系统全景](./current-system.md)：组件、职责、依赖方向与关键入口。
- [运行拓扑](./runtime-topology.md)：桌面进程、端口、启动与降级关系。
- [数据生命周期](./data-lifecycle.md)：只读查询、预览、审批、提交与持久化。
- [安全边界](./security-boundaries.md)：loopback、桌面能力令牌、文件边界与已知风险。
- [验证矩阵](./verification-matrix.md)：哪些检查在 CI、Release 或人工桌面验收中执行。
- [CI/CD](./ci-cd.md)：质量门、版本标签、跨平台打包和 Draft Release。

## 架构决策

[ADR 索引](./decisions/README.md) 只保留继续约束 1.8 LTS 的决策。

## 维护记录

- [项目架构总览](./overview.md)
- [1.8 LTS 首轮文档清理记录](../maintenance/1.8-lts-initial-document-cleanup.md)
- [1.8 LTS 第二轮运行时清理记录](../maintenance/1.8-lts-runtime-cleanup.md)
