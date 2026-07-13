# Spec 8-1：DEF 可训练基建总览

## 状态

已拆为三个连续子阶段；本文件只保留共同目标、边界和依赖关系，详细规格分别进入 8-1-1、8-1-2、8-1-3，不在此创建 `tasks.md`。

## 一句话定调

**用三个可独立验收的子阶段铺好 Runtime Harness、Teacher Harness、独立验证和最小知识闭环，使 `def-opencode` 具备开始训练、安全返修和证明改进有效的条件。**

## 子阶段

1. [Spec 8-1-1：Runtime Harness 与真实黑盒基线](./spec8-1-1.md)——先让 DEF 的身份、能力、实时状态和 provider-visible 输入成为准确、版本化、可审计的事实。
2. [Spec 8-1-2：Teacher Harness 与独立验证](./spec8-1-2.md)——再让高级 Codex 能通过 Computer Use、调试入口、完整 trace、场景回放和隐藏回归观察与诊断 DEF。
3. [Spec 8-1-3：最小知识入口与训练就绪闭环](./spec8-1-3.md)——最后接通少量知识样本和一次真实返修闭环，证明这套基础设施已经可以开始训练。

## 依赖关系

```text
8-1-1 Runtime Harness / Pure Blackbox
  → 8-1-2 Teacher Harness / Trace / Replay / Verifier
    → 8-1-3 Knowledge Runtime / Repair Loop / Training Ready
```

后一个子阶段依赖前一个子阶段已经通过验收；不得为了展示最终闭环而在同一轮同时改写输入基线、trace 协议、verifier 和知识策略，否则无法归因。

## 共同架构原则

```text
def-opencode
  = 工作 Agent / 被训练对象

Codex + Computer Use + Debug Backdoor
  = 教师 Agent / 诊断与返修执行者

validation + replay + hidden regression
  = 独立裁判
```

- Worker、Teacher、Verifier 必须分离；
- Runtime Harness 不等于巨型 prompt；
- 在线执行只产生证据，离线教师流程负责诊断和返修；
- typed validation、semantic diff 和真实状态优先于语言评价；
- 知识查询继续归入 `def-data-resource`，不新增第四类工具；
- 先用少量样本证明闭环，再在 Spec 8-2 扩大训练。

## Spec 8-1 总完成定义

三个子阶段全部完成后，任意一次 DEF 成功或失败都应能够被真实观察、准确归因、隔离重放、安全返修，并由独立证据证明返修没有破坏已有能力；此时系统才被视为具备“开始训练”的基础条件。

## 不进入 8-1 的内容

- 大规模迁移全部 YZ/游戏资料；
- 自动修改或自动发布生产 prompt/skills；
- 在线模型权重训练；
- 主播人格模仿与完整 Voice Profile 训练；
- 面向玩家的 Harness Evolution 管理页面；
- 跨用户经验汇总和自动个人偏好学习；
- 多 Agent swarm 或新的 DEF 工具家族。
