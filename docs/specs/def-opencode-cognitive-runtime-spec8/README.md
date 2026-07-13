# Spec 8 总站位：DEF 可训练 Agent 基础设施

Spec 8 不追求一轮完成最终产品，而是分三个阶段逐步建立“可以训练、能够改进、最终产品化”的 DEF Agent 系统。

## 三阶段定性

- **Spec 8-1：可训练基建**——铺好 DEF Runtime Harness、Codex Teacher Harness、知识入口、轨迹观测、回放与独立验证基础，使系统第一次具备开始训练和安全返修的条件。
- **Spec 8-2：受控训练**——以 YZ/游戏知识、真实 Workbench 轨迹和用户修正为材料，启动知识、skills、工具路由与玩家表达的可验证蒸馏和迭代。
- **Spec 8-3：进化产品化**——将已经证明有效的训练闭环、个人打法适应、Harness 版本治理与持续改进能力转化为用户可理解、可控制、可回滚的正式产品体验。

## 当前站位

当前准备进入 **Spec 8-1**；本目录已有预研究用于说明认知运行时、领域知识与 Harness 自进化方向，但尚未据此编写 `spec.md`、验收标准或任务拆分。

## 预研究入口

- [认知运行时与游戏知识 Agent](./research.md)
- [Harness 自进化](./harness-self-evolution-research.md)
