# 项目文档入口

本项目采用 Spec 驱动开发。`docs/specs/` 是需求、研究、任务、实现记录与验收证据的主目录；查找文档时，应先从对应 Spec 进入。

## 从这里开始

- [Spec 总索引](./specs/README.md)：按产品演进线查找规格与实施记录。
- [测试方法](./testing/README.md)：跨 Spec 复用的测试口径，不存放某次 Spec 的验收结果。
- [历史审查收件箱](./agent-check/README.md)：尚未完成 Spec 归属迁移的旧审查文档。
- [用户指南](./使用指南.md)：面向使用者的产品说明。

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
3. `docs/agent-check/` 不再作为新审查文档的默认落点；明确归属的审查直接写入对应 Spec。
4. 顶层 `docs/` 只保留导航、用户文档和确实跨 Spec 的稳定参考资料。
5. 开启新一轮 Spec / Tasks 时，仍须先等待用户给出标题、目标或具体内容；目录和空壳不能替代需求输入。

## 生命周期

```text
research → spec → tasks → coding → verification → maintenance review/fix
```

`spec.md` 是需求事实源，`tasks.md` 是执行清单，`verification*.md` 是完成证据。研究和审查可以影响后续 Spec，但不应悄悄改写已经冻结的规格。

## Legacy 文档

目前仍有部分旧文档位于 `docs/`、`docs/agent-check/` 和 `docs/agent-cli/`。第一轮整理不对归属不明确的材料强行迁移；它们已在各目录 README 中登记，后续应在确认对应演进线后逐批归档。

