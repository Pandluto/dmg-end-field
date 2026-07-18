# Spec 8-1：DEF 可训练基建总览

## 状态

已按“协议接入 → 迭代框架 → Codex 实战验证”拆为三个连续子阶段；本文件只保留总目标、依赖和共同边界，不创建 `tasks.md`。

## 一句话定调

**先打通高级 Codex 与 `def-opencode` 的联调协议，再铺设 Harness 迭代框架，最后通过一次真实 Codex 联调返修证明系统已经具备开始训练的基础。**

## 子阶段

1. [Spec 8-1-1：OpenCode 后门与 Codex 联调协议](./spec8-1-1.md)——打通 `def-opencode` 后门，明确 Codex 如何发起、继续、观察和结束一次真实 Workbench Agent 调测。
2. [Spec 8-1-2：Harness 迭代框架基础建设](./spec8-1-2.md)——建立 Harness 版本、trace、scenario、replay、verifier、失败归因和返修候选的基础设施。
3. [Spec 8-1-3：Codex 协议联调与初版验证](./spec8-1-3.md)——由高级 Codex 结合 Computer Use 和联调协议完成一次真实诊断、返修与独立回归。

## 依赖关系

```text
8-1-1：通信与观测协议可用
  → 8-1-2：迭代证据与裁判框架可用
    → 8-1-3：Codex 真实联调闭环通过
```

三个阶段分别回答：

```text
Codex 怎么接入 DEF？
→ 接入后如何形成可迭代、可回归的证据？
→ 这套协议和框架在真实返修中是否有效？
```

## 共同架构原则

```text
def-opencode
  = 工作 Agent / 被训练对象

Codex + Computer Use + OpenCode Backdoor
  = 教师 Agent / 诊断与返修执行者

validation + replay + hidden regression
  = 独立裁判
```

- Worker、Teacher、Verifier 必须分离；
- Pure Blackbox 不得给用户消息夹带测试答案；
- Diagnostic 必须显式标记，不能伪装成普通用户验收；
- 在线 DEF 只执行任务并产生证据，离线 Harness 流程负责归因和返修；
- Codex 可以改代码和 Harness，不能改安全定义与隐藏裁判；
- 所有教师入口只在本地开发环境启用；
- Spec 8-1 只证明“系统可以开始训练”，不实施规模化知识/风格训练。

## Spec 8-1 总完成定义

三个子阶段全部完成后，高级 Codex 应能通过稳定协议控制和观察一次真实 DEF turn，Harness 框架能完整记录、重放和裁决结果，并且至少一个真实失败已经经过“观察 → 归因 → 返修 → 独立回归 → 提交”闭环。

## 移交给 Spec 8-2

Spec 8-2 的首轮目标按最新用户口径调整为新数据架构下的 session/SQLite 权限收口：先移除 DEF OpenCode 隐式新建数据对象的能力，建立正式 SQLite 的不可漂移会话绑定，并拒绝临时 SQLite 进入 AI 模式。YZ/游戏知识、Knowledge Runtime、skills/工具路由与玩家表达的持续蒸馏延后到后续 8-2 批次；Spec 8-1 继续只为这些受控训练提供协议、证据和验证基础。

## 不进入 8-1 的内容

- 大规模迁移 YZ/游戏资料；
- 自动修改或自动发布生产 prompt/skills；
- 在线模型权重训练；
- 主播人格模仿与完整 Voice Profile；
- 面向玩家的 Harness Evolution 管理页面；
- 跨用户经验汇总和自动个人偏好学习；
- 多 Agent swarm 或新的 DEF 工具家族。
