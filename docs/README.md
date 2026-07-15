# 项目文档入口

本项目采用 Spec 驱动开发。`docs/specs/` 是需求、研究、任务、实现记录与验收证据的主目录；查找文档时，应先从对应 Spec 进入。

## 从这里开始

- [项目架构总览](./architecture/overview.md)：桌面界面、本地数据、AI 协作与 Harness 如何分层。
- [开发与启动](./guides/development.md)：安装依赖、启动桌面开发环境、构建与验证入口。
- [技术栈与技术选择](./technology-stack.md)：核心技术边界及其取舍。
- [Spec 总索引](./specs/README.md)：按产品演进线查找规格与实施记录。
- [测试方法](./testing/README.md)：跨 Spec 复用的测试口径，不存放某次 Spec 的验收结果。
- [架构事实源](./architecture/README.md)：当前系统、运行拓扑、数据与安全边界、CI/CD、ADR 和跨 Spec 审计。
- [历史记录](./history/README.md)：无单一 Spec 归属的历史迭代记录。
- [用户指南](./guides/quick-start.md)：面向使用者的产品说明。

## 文档归属规则

一个开发主题应拥有独立的 `docs/specs/<spec-id>/` 目录。该目录可以按需包含：

```text
spec.md                    # 目标、范围、约束、验收标准
tasks.md                   # 实施任务与完成状态
research*.md               # 形成规格前后的研究
verification*.md           # 构建、测试、黑盒与手工验收证据
feedback*.md               # 评审意见
fix-report*.md             # 该 Spec 完成后的维护修复
health-review*.md          # 完成后的架构或行为健康审查
```

规则：

1. 新的需求、任务、研究、验收和修复记录默认进入对应 Spec 目录。
2. 某次 Spec 的测试记录属于该 Spec；`docs/testing/` 只保存可跨 Spec 复用的方法和口径。
3. 明确归属的审查直接写入对应 Spec；只有跨多个 Spec 的审计才进入 `docs/architecture/audits/`。
4. 顶层 `docs/` 只保留导航、用户文档和确实跨 Spec 的稳定参考资料。
5. 开启新一轮 Spec / Tasks 时，仍须先等待用户给出标题、目标或具体内容；目录和空壳不能替代需求输入。

## 生命周期

```text
research → spec → tasks → coding → verification → maintenance review/fix
```

`spec.md` 是需求事实源，`tasks.md` 是执行清单，`verification*.md` 是完成证据。研究和审查可以影响后续 Spec，但不应悄悄改写已经冻结的规格。

## Legacy 文档

第一轮迁移已经清空顶层开发文档、`docs/agent-check/` 与 `docs/agent-cli/`。历史材料按“所属 Spec / 跨 Spec 架构审计 / 无法归属的历史记录”三类安置；后续新增文档不得恢复这些散落目录。
