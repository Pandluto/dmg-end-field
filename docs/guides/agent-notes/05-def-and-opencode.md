# 这些概念在 DEF 里怎样落地

DEF 没有从空白页面重新实现一套 Agent。会话、Agent Loop、工具协议和原生审批界面沿用 OpenCode；项目补的是产品上下文、领域工具和状态边界。

先把后面反复出现的四个名字放在一起，省得读到一半再找：

```text
Work Node  一次修改使用的隔离草稿
Checkout   指向当前应用目标的引用，不是节点本身
Sidecar    连接 OpenCode Runtime 与 DEF 上下文/工具的适配层
Postcondition  执行后必须重新核对的结果条件
```

## 读操作先找到产品事实

模型不能把 Prompt 里的描述当成当前产品状态。需要读取时间线、角色、配置或知识时，它调用 DEF Typed Tool；工具通过本地领域接口读取当前事实，再把结构化结果交还给模型。

```text
模型 → DEF Typed Tool → 产品事实源 → Tool Result → 模型
```

这条链路没有向产品 Agent 开放任意 Shell 和任意文件访问。模型拿到的是产品允许它看到的事实，不是整个工作目录。

## 写操作先进入草稿

修改比读取多一层。工具不会直接把模型参数写进当前界面，而是先准备预览，在 Work Node 里形成差异和风险信息，再通过 OpenCode 原生 Permission 请求用户批准。

批准后，Apply 仍要核对草稿版本和目标节点。执行完成也不能只看某个接口返回成功；Work Node、提交记录和真实界面状态需要重新对上，才能向模型报告已应用。最后这次核对就是 Postcondition。

```text
Prepare → Work Node → Preview → Approval → Apply → Postcondition
```

这些名字属于项目实现，不要求其他 Agent 照搬。真正需要保留的是两条判断：用户批准的内容必须明确；接口返回成功不等于产品已经处在预期状态。

## Session 还要知道自己站在哪条时间线上

普通聊天主要维护消息历史。DEF 还存在 Timeline、Work Node 和 Checkout。用户一旦切换节点，旧对话中关于“当前状态”的描述就可能过期。

因此 Session 会绑定到明确的产品坐标轴。处理下一条消息前，系统刷新 Checkout 和选中节点；发现坐标变化时先重新绑定，再允许模型继续。它解决的不是模型记忆问题，而是对话状态和产品状态的一致性问题。

## 原生 UI 外面还有一层适配

界面继续使用 OpenCode 原生会话和审批体验。Sidecar 创建并管理 OpenCode Worker——真正运行 Session 和 Agent Loop 的本地进程——把当前 DEF 上下文注入会话，也把领域工具接进 Runtime。产品事实仍由 DEF 自己的存储和接口维护，Sidecar 不复制另一套事实源。

项目还保留了外部观察入口，用来读取事件、对话记录、问题和终态。黑盒测试只发送正常用户语言，再从工具记录和真实 UI 判断 Agent 是否完成任务，避免把预期答案提前泄露给执行者。

这类测试和审计流程会反复读取相同证据、检查相同边界。它们不适合全部硬编码进 Runtime，却值得交给 Codex 稳定复用，于是项目里有了[开发者自己的 Skill](./06-developer-skill.md)。更精确的组件与数据边界仍在[架构事实源](../../architecture/README.md)。
