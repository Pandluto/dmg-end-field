# 这些概念在 DEF 里怎样落地

DEF 没有重写一套 Agent。

它沿用了 OpenCode 的：

- Session；
- Agent Loop；
- 工具协议；
- 原生审批界面。

项目补充的是：

- 产品上下文；
- 领域工具；
- 状态边界。

几个项目词先放在这里：

| 名称 | 含义 |
|---|---|
| Work Node | 一次修改使用的隔离草稿 |
| Checkout | 指向当前应用目标的引用 |
| Sidecar | OpenCode 与 DEF 的适配层 |
| Postcondition | 执行后必须重新核对的条件 |

## 读取产品事实

Prompt 里的描述，
不能代替当前产品状态。

需要读取时间线或配置时，
模型调用 DEF Typed Tool。

```text
模型
→ DEF Typed Tool
→ 产品事实源
→ Tool Result
→ 模型
```

产品 Agent 没有任意 Shell。

它也不能任意读取项目文件。

模型只拿到产品允许的事实。

## 修改先进入草稿

修改不会直接写进界面。

工具先生成预览，
再写入 Work Node。

```text
Prepare
→ Work Node
→ Preview
→ Approval
→ Apply
→ Postcondition
```

批准后，
Apply 还会核对版本和目标。

接口返回成功，
不代表产品已经正确应用。

需要同时检查：

- Work Node；
- Commit；
- 真实界面状态。

## Session 站在哪条时间线上

普通聊天主要维护消息历史。

DEF 还有 Timeline 和 Checkout。

用户切换节点后，
旧对话里的“当前状态”会过期。

处理下一条消息前，
系统刷新当前坐标。

坐标变化时，
Session 要先重新绑定。

这是产品状态一致性问题。

它不是模型记忆问题。

## OpenCode 外面的适配层

OpenCode Worker 负责运行：

- Session；
- Agent Loop。

Sidecar 负责：

- 管理 Worker；
- 注入 DEF 上下文；
- 接入领域工具。

产品事实仍由 DEF 维护。

Sidecar 不复制另一套事实源。

外部观察入口会读取：

- 事件；
- 对话记录；
- 问题；
- 最终状态。

黑盒测试只发送正常用户语言。

工具记录和真实 UI，
共同证明任务是否完成。

运行中断后的处理见
[状态、持久化与恢复](./06-state-persistence-recovery.md)。

完整边界见
[架构事实源](../../architecture/README.md)。
