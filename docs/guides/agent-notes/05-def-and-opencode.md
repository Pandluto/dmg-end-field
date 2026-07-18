# 这些概念在 DEF 里怎样落地

DEF 没有从空白页面重新实现一套 Agent。OpenCode 继续负责 Session、Agent Loop、工具协议和原生审批界面；项目补上终末地工作台所需的上下文、领域工具和产品状态边界。

先认识后面会反复出现的几个项目名词：

| 名称 | 在 DEF 里是什么 |
| --- | --- |
| Work Node | 一次修改使用的隔离草稿，先承载变化，不直接覆盖当前方案。 |
| Checkout | 当前应用目标的引用，用来说明用户此刻站在哪个节点。 |
| Sidecar | 把 OpenCode Runtime 接到 DEF 上下文和领域工具的适配层。 |
| Postcondition | 操作完成后必须重新核对的产品结果。 |

## 读取：先回到产品事实

模型不能把 Prompt 里的描述当成当前状态。需要查看时间线、角色或配装时，它调用 DEF Typed Tool；工具从本地领域接口读取真实数据，再把结构化结果送回 Session。

```text
模型 → DEF Typed Tool → 产品事实源 → Tool Result → 模型
```

这条链路没有向产品 Agent 开放任意 Shell 和文件访问。模型看到的是工作台允许它读取的事实，不是整个电脑或项目目录。

## 修改：先在草稿里试

写操作不会把模型参数直接塞进当前界面。Prepare 先在 Work Node 中形成可检查的变化，用户看到 Diff、风险和校验结果后，再通过 OpenCode 原生 Permission 决定是否批准。

```text
Prepare → Work Node → Preview → Approval → Apply → Postcondition
```

Apply 时还要核对 Session、节点版本和准备好的内容，避免用户批准 A，系统却因为状态变化执行了 B。接口返回以后，系统继续检查 Commit、Checkout 和真实界面；只有这些事实对得上，Agent 才能说“已经应用”。

Work Node、Checkout 这些名称属于 DEF，别的 Agent 产品未必照搬。真正值得带走的是两条原则：批准对象必须明确，接口成功不等于产品已经处在预期状态。

## 对话还要知道自己站在哪里

普通聊天主要维护消息历史。DEF 还维护 Timeline、Work Node 和 Checkout；用户一旦切换节点，旧对话里关于“当前方案”的描述就可能过期。

因此 Session 会绑定明确的产品坐标。下一轮开始前，Adapter 刷新 Checkout 和选中节点；坐标改变时先重新绑定，再让模型继续。这解决的不是模型记忆，而是对话状态与产品状态是否仍指向同一份事实。

Sidecar 负责创建和管理真正运行 Agent Loop 的 OpenCode Worker，把 DEF 上下文和工具接进去，却不复制另一套产品数据库。项目还保留外部观察协议，用真实用户语言发起 Turn，再从事件、工具记录和界面终态判断任务是否完成。

顺着这条链继续往下，就会遇到最容易被忽略的部分：工具正在等审批时窗口关了，或 Apply 发出后响应丢了，系统究竟还能相信什么？下一页单独讲[运行中的状态、持久化与恢复](./06-state-persistence-recovery.md)。更精确的组件边界仍以[架构事实源](../../architecture/README.md)为准。
