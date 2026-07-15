# 架构事实源

这里记录跨 Spec、需要长期维护的系统事实。Spec 说明“为什么做某一轮需求”，本目录说明“系统现在如何工作、边界在哪里、为什么这样设计”。实现变化若使本文失真，代码改动必须同步更新相应文档或 ADR。

## 当前系统

- [系统全景](./current-system.md)：组件、职责、依赖方向与关键入口。
- [运行拓扑](./runtime-topology.md)：桌面进程、端口、启动与降级关系。
- [数据生命周期](./data-lifecycle.md)：只读查询、预览、审批、提交与持久化。
- [Harness 教学系统](./harness-training.md)：可迭代对象、session pinning、回归与 promotion。
- [安全边界](./security-boundaries.md)：loopback、授权、typed tool、审批与已知风险。
- [验证矩阵](./verification-matrix.md)：哪些检查在 CI、Release 或人工桌面验收中执行。
- [CI/CD](./ci-cd.md)：质量门、版本标签、跨平台打包和 Draft Release。
- [演进路线](./evolution.md)：已经完成、当前债务和下一阶段顺序。

## 架构决策

[ADR 索引](./decisions/README.md) 保存已经落地且会约束后续实现的决策。改变这些决策时，不应直接改写旧 ADR，而应新增一份 superseding ADR。

## 审计归档

- [项目架构总览](./overview.md)
- [复用边界与上下游缺口分析](./audits/reuse-boundary-gap-analysis-20260627.md)
- [Spec / Task 与代码复用审计](./audits/spec-task-code-audit-20260627.md)
- [OpenCode 打包范围与体积审计](./audits/opencode-package-scope-size-audit-20260713.md)

只影响单一 Spec 的研究、验收或修复仍放在对应 `docs/specs/<spec-id>/`；本目录不替代需求事实源。
