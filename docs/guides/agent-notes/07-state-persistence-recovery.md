# Agent 跑到一半怎么办

顺利完成的 Agent 很好理解。真正考验 Runtime 的，是它停在半路：工具正在等待审批，用户关掉窗口；或者 Apply 已经发出，客户端却没有收到响应。

这时系统要回答三件事：进行到哪里，哪些事实已经保存，下次启动还能从哪里继续。

## 状态不是一个大枚举

当前项目让不同层各记各的状态：

| 状态所在层 | 它关心什么 |
| --- | --- |
| Session / Interop | 会话正在生成、等待重试，还是已经完成、停止或失败。 |
| Tool Part | 一次工具调用是 `pending`、`running`、`completed` 还是 `error`。 |
| Permission | 哪个请求正在等待用户回答。 |
| 产品数据 | Work Node、Checkout 和真实界面是否已经改变。 |

这些状态可以同时成立。工具卡片显示 `running`，Permission 又在等待批准，并不冲突；它们只是从两个角度描述同一现场。把所有状态挤进一个枚举，反而很难说清是谁在等待、什么已经改变。

## 记住调用，不等于接着执行

OpenCode 会把 Tool Call 保存为 Message 下的一条 Part。工具名、输入、状态和 `callID` 随执行更新，并通过事件写入 SQLite；多个调用同时出现时，`callID` 负责把结果送回各自的位置。

所以重新打开界面后，系统仍能看到哪个工具完成、哪个工具报错。但数据库里的一条 `running` 记录，不是 JavaScript 函数的执行检查点。

等待审批更能说明这个区别。当前 Permission 请求保存在 Worker 内存中，背后有一个等待答案的 Promise；Worker 退出以后，这段执行现场也随之消失。重启可以读回请求记录，却不能从原来的调用栈继续跑。

## 停止 Agent，不会撤销产品副作用

用户停止任务时，Runtime 会中断请求，并把未结束的 Tool Part 标记为错误或 `Tool execution aborted`。这样界面不会永远挂着一个运行中的工具，下一轮也不会把它误当成正常结果。

Abort 清理的是 Runtime 现场，不是产品回滚。工具如果在中断前已经改动 Work Node、Checkout 或真实界面，这些变化不会因为对话停止自动消失。最终结果仍要回到产品事实源核对。

## 不确定有没有执行，先别重试

Provider 限流通常可以退避后重试，因为请求还没有跨进产品修改链路。Apply 超时则不同：它可能没有执行，也可能已经执行成功，只是响应丢了。直接再发一次，可能把同一修改做两遍。

DEF 为准备好的修改发放一次性凭证，并绑定 Session、Work Node 版本和内容。Apply 开始后凭证就被视为已使用；目标或版本变化，调用会被拒绝。响应不确定时，系统先核对 Commit、Checkout 和 live 状态，再决定继续、报告成功或交给用户处理。

对话投递也有类似保护。`clientTurnId` 给一次 Turn 稳定身份；Sidecar 是否收到 Prompt 不确定时，客户端先去 Transcript 查找这条消息，而不是立即重复发送。

## 重启找得回记录，找不回执行栈

项目里实际有三本账：OpenCode SQLite 记录说过什么、调用过什么；Timeline Repository 记录 Work Node、Commit 和 Session Binding；浏览器侧状态说明用户眼前真正应用了什么。

Binding 还在而 OpenCode Session 丢失时，Adapter 可以创建新 Session，并重新绑定原来的 Harness 和产品坐标。恢复的是身份、记录和边界，不是崩溃前那段正在运行的函数。

> 消息库告诉我们说过什么，产品库告诉我们改了什么，运行时内存告诉我们正在等什么。进程消失以后，最后一项也会跟着消失。

对应实现主要在：

- `agent/vendor/opencode/packages/opencode/src/session/processor.ts`
- `agent/vendor/opencode/packages/opencode/src/permission/index.ts`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-codex-interop.cjs`
- `scripts/ai-cli-rest-server.mjs`
