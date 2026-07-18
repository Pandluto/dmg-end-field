# Agent 跑到一半怎么办

顺利的时候，Agent Loop 看起来就是：模型调用工具，工具返回结果，模型继续回答。

麻烦都发生在“跑到一半”。还是用前面的配装任务举例：

```text
读取当前配装
→ 生成换武器的预览
→ 等用户批准
→ 应用修改
→ 检查界面是否真的变了
```

如果用户在审批时关掉窗口，或者 Apply 已经发出却迟迟没有响应，系统至少要回答三件事：刚才进行到哪里、哪些结果已经落盘、下一次还能不能继续。

## 状态不是记在同一个地方

当前项目没有拿一个大枚举包办所有状态。每一层只记自己负责的事情：

| 谁在记 | 它关心什么 |
|---|---|
| Session | 现在空闲、正在生成，还是等待 Provider 重试。 |
| Tool Call | 参数是否收完、工具是否开始、最后完成还是报错。 |
| Permission | 哪个请求还在等用户回答。 |
| 产品数据 | 预览属于哪个 Work Node，当前 Checkout 在哪里，修改是否真正应用。 |
| Interop | 外部测试看到的这一轮是完成、停止、超时还是失败。 |

这样拆开以后，一个常见现象就不奇怪了：工具卡片显示 `running`，同时界面弹出审批请求。工具没有多出一个“等待审批”的状态，只是它的执行停在 Permission 那一层。

## Tool Call 是一条不断更新的记录

模型发出 Tool Call 时，OpenCode 会在当前 Message 下面创建一条 Tool Part。它带着工具名、输入和一个 `callID`，状态从 `pending` 进入 `running`。结果回来以后，同一条记录再变成 `completed` 或 `error`。

`callID` 很重要。同一轮里可以出现多个工具调用，结果返回的先后顺序也未必和发出时一样。程序靠它把每份结果送回正确的调用。

这些 Message 和 Part 会通过事件投影写进 SQLite。所以界面重开以后，仍然能画出“哪个工具成功、哪个工具失败”。但这只能证明发生过什么，并不能让一个执行到一半的 JavaScript 函数从原地继续。

## 等待审批时，真正停住的是什么

Permission 请求会记录 Session、权限名、目标范围和相关工具，然后把工具执行暂停。用户可以只允许这一次、以后都允许，或者拒绝。

当前 OpenCode 把尚未回答的请求放在 Worker 内存里。换句话说，审批卡片虽然能被 UI 看到，背后等待答案的 Promise 却不是一个可以跨进程恢复的事务。Worker 如果在这时退出，重启后要重新检查 Session 和产品状态，不能假装原来的等待还在。

DEF 的修改操作还多做了一层：审批卡片展示本次 Work Node、Checkout 版本和具体差异。用户批准以后，Apply 会再次核对这些值。这样可以避免用户看的是 A，真正执行时目标已经变成 B。

## 点了停止，也要把现场收好

用户停止任务时，DEF Adapter 会中断当前请求，并通知 OpenCode abort 这个 Session。Processor 随后把尚未结束的 Tool Part 标成错误，写下 `Tool execution aborted` 和 interrupted 标记。

这一步主要是收拾 Runtime 的现场：UI 不会永远挂着一个运行中的工具，后面的 Loop 也不会误以为它还在正常执行。

它不能倒转已经发生的副作用。工具在收到取消前如果已经改动产品，最终仍要读取 Work Node、Commit、Checkout 和界面状态确认结果。

## 超时不能一律重试

Provider 限流或部分服务错误，通常可以退避后重试。Session 会记下第几次尝试，以及下一次什么时候开始。上下文太长则走 Compaction，不会伪装成一次普通网络重试。

Apply 超时更麻烦。它可能根本没有执行，也可能已经执行成功，只是响应丢了。后一种情况如果直接再发一次，就可能重复修改。

DEF 为此给准备好的修改发放一次性凭证，并绑定 Session、父子 Work Node、revision 和内容 hash。Apply 一开始，凭证就会被标记为已使用。响应不确定时，系统先去看 Commit、Checkout 和 live 状态是否已经收敛，再决定怎样处理，而不是让模型重新调用一遍。

批量修改也是同样的态度：逐个执行，第一处失败就停。前面已经完成的部分明确返回 `PARTIAL`，不会被一句“任务失败”抹掉，也不会被说成全部成功。

对话提交还有另一把保险。Interop 为每轮使用稳定的 `clientTurnId`。Sidecar 有没有接到 Prompt 不确定时，它先去 Transcript 里找这条 User Message 和对应的 Assistant，而不是立即重发。旧回答不能拿来冒充这一轮的结果。

## 重启能恢复记录，不能恢复执行栈

项目里真正持久保存的是几本“账”：

- OpenCode SQLite 记着 Session、Message 和 Tool Part；
- Timeline Repository 记着 Work Node、Commit 和 Session Binding；
- 浏览器侧保留已经应用的 live 状态。

如果本地 Binding 还在，而对应的 OpenCode Session 找不到了，Adapter 可以重新创建 Session，并把原来的 Harness 和产品坐标绑回来。恢复的是身份和边界，不是崩溃前的调用栈。

Compaction 也是这个道理。旧对话可以被摘要，旧 Tool Result 可以被裁剪，但“用户批准了什么”和“产品到底改成什么”不能只活在模型摘要里。恢复或压缩以后，Agent 仍要回到产品事实源重新读取。

如果只记一句，可以记这个：

> 消息库告诉我们说过什么，产品库告诉我们改了什么，运行时内存告诉我们现在正等什么。进程一旦消失，最后一项也会跟着消失。

对应实现主要在：

- `agent/vendor/opencode/packages/opencode/src/session/processor.ts`
- `agent/vendor/opencode/packages/opencode/src/permission/index.ts`
- `agent/runtime/def-opencode-adapter/index.cjs`
- `agent/runtime/def-codex-interop.cjs`
- `scripts/ai-cli-rest-server.mjs`

这类状态排查会反复读取相同证据、区分已确认事实与猜测，适合整理成[开发者自己的 Skill](./07-developer-skill.md)。
