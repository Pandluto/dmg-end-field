# 项目文档入口

1.8 LTS 文档只保留当前仍会约束产品、数据和发布行为的事实。Desktop Shell 与 Slimming 是两个长期专业分支；共通合同按补丁同步，不做整分支合并。

## 从这里开始

- [用户快速上手](./guides/quick-start.md)
- [开发与启动](./guides/development.md)
- [项目架构总览](./architecture/overview.md)
- [1.8 LTS 分支合同](./architecture/lts-branch-contract.md)
- [数据生命周期](./architecture/data-lifecycle.md)
- [统一资源发包与交接](./architecture/resource-delivery.md)
- [技术栈与技术选择](./technology-stack.md)
- [当前 Spec 索引](./specs/README.md)
- [测试方法](./testing/README.md)
- [1.8 LTS 首轮文档清理记录](./maintenance/1.8-lts-initial-document-cleanup.md)
- [1.8 LTS 第二轮运行时清理记录](./maintenance/1.8-lts-runtime-cleanup.md)
- [1.8 LTS Web 收口记录](./maintenance/1.8-lts-web-finalization.md)
- [Desktop Shell 国内资源兼容与 Slimming 下游叠加方案](./maintenance/desktop-cloud-resource-consumer-gap-20260822.md)

## 保留规则

1. `docs/architecture/` 记录当前系统事实，不保存已经退出产品范围的实验架构。
2. `docs/specs/` 优先保留仍约束实现的 `spec.md`；活跃开发期间可以存在 `tasks.md`，完成后再决定是否归档。
3. `docs/testing/` 只保存可以跨功能复用的测试方法。
4. 用户指南只描述当前产品，不保留重复的旧版文本。
5. 删除的过程材料必须在维护记录中说明基线、范围和恢复方式。

## 恢复历史材料

两轮删除均可从基线提交 `073132d55d9253cb45c366b3beb93425f5330557` 恢复。Agent Notes 和 Pages 内容还分别保留在远端 `codex/agent-development-notes` 与 `codex/github-pages-showcase` 分支。
