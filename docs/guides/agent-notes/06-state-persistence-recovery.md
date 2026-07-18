# Agent 跑到一半怎么办

真正麻烦的不是顺利完成，而是卡在中间：工具正在等审批，用户关掉了窗口；或者 Apply 已经发出，却迟迟没有响应。

这时系统要回答三件事：进行到哪里、什么已经落盘、下一次还能不能继续。

## 几层状态，各记各的

当前项目没有用一个大枚举包办所有状态：

| 谁在记 | 它关心什么 |
|---|---|
| Session / Interop | 会话正在生成、等待重试，还是已经完成、停止或失败。 |
| Tool Part | 一次工具调用是 `pending`、`running`、`completed` 还是 `error`。 |
| Permission | 哪个请求还在等待用户回答。 |
| 产品数据 | Work Node、Checkout 和真实界面是否已经改变。 |

这些状态可以同时成立。比如工具卡片仍是 `running`，Permission 正在等用户批准；这不是第五种 Tool 状态，而是两层状态叠在一起。

## 记住调用，不等于接着执行

OpenCode 会把 Tool Call 存成 Message 下的一条 Part。工具名、输入、状态和 `callID` 随执行不断更新，并通过事件投影写入 SQLite。多个工具同时出现时，`callID` 负责把结果送回各自的调用。

所以重开界面以后，系统仍能知道哪个工具完成、哪个工具报错。但数据库里的一条 `running` 记录，不是 JavaScript 函数的执行检查点。

审批等待更直接：当前 OpenCode 把尚未回答的 Permission 请求放在 Worker 内存里。Worker 一旦退出，背后等待答案的 Promise 也没了。恢复时只能重新检查 Session 和产品状态，不能从原来的等待点续上。

## 停止不会撤销已经发生的事

用户停止任务时，Runtime 会中断请求，并把没结束的 Tool Part 记成 `Tool execution aborted`。这样 UI 不会永远挂着一个运行中的工具，下一轮也不会把它当成正常结果。

但 abort 收拾的是 Runtime 现场，不是产品回滚。工具在中断前如果已经产生副作用，最终结果仍要去 Work Node、Commit、Checkout 和 live 状态里确认。

## 不知道做没做，先别重试

Provider 限流或部分服务错误可以退避后重试，因为它们还没有跨进产品修改链路。Apply 超时则不同：可能根本没执行，也可能已经执行成功，只是响应丢了。直接再发一次，可能造成重复修改。

DEF 会给准备好的修改发放一次性凭证，并绑定当前 Session、Work Node 版本和内容。Apply 开始后凭证就被视为已使用；目标或版本发生变化，执行会被拒绝。响应不确定时，先核对 Commit、Checkout 和 live 状态，再决定继续还是人工处理。

对话投递也使用类似思路：`clientTurnId` 给一轮请求稳定身份。Sidecar 是否收到 Prompt 不确定时，先去 Transcript 找对应消息，而不是马上重发。

## 重启能找回记录，找不回调用栈

项目里持久保存了三本“账”：

- OpenCode SQLite 记着说过什么、调用过哪些工具；
- Timeline Repository 记着 Work Node、Commit 和 Session Binding；
- 浏览器侧状态说明用户眼前真正应用了什么。

Binding 仍在而 OpenCode Session 丢失时，Adapter 可以重新创建 Session，并绑回原来的 Harness 和产品坐标。恢复的是身份和边界，不是崩溃前的执行栈。

恢复以后，审批内容和产品结果仍要从事实源重读，不能只相信旧回答或摘要。

> 消息库告诉我们说过什么，产品库告诉我们改了什么，运行时内存告诉我们正在等什么。进程一旦消失，最后一项也会跟着消失。

对应实现主要在：

- `agent/vendor/opencode/packages/opencode/src/session/processor.ts`
- `agent/vendor/opencode/packages/opencode/src/permission/index.ts`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-codex-interop.cjs`
- `scripts/ai-cli-rest-server.mjs`
