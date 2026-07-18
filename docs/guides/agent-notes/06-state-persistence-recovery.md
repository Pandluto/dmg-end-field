# Agent 跑到一半怎么办

麻烦常发生在中间。

例如：

- 工具正在等审批；
- 用户关掉了窗口；
- Apply 发出后没有响应。

此时要回答三件事：

1. 进行到哪里？
2. 什么已经落盘？
3. 下一次能否继续？

## 几层状态，各记各的

项目没有一个万能状态机。

| 谁在记 | 关心什么 |
|---|---|
| Session / Interop | 生成、重试和终态 |
| Tool Part | 调用开始、完成或报错 |
| Permission | 哪个请求还在等人 |
| 产品数据 | 产品是否真的改变 |

几层状态可以同时成立。

工具卡片可能还是 `running`。

Permission 同时等待批准。

这不是新的 Tool 状态。

只是两层状态叠在一起。

## 记住调用，不等于继续执行

OpenCode 会保存 Tool Part。

其中包括：

- 工具名；
- 输入；
- 状态；
- `callID`。

`callID` 用来匹配调用和结果。

记录会投影到 SQLite。

重开界面后，
仍能看到工具结果。

但一条 `running` 记录，
不是函数执行检查点。

Permission 等待也在 Worker 内存里。

Worker 退出后，
等待答案的 Promise 也会消失。

恢复时只能重新检查事实。

## 停止不会回滚

停止任务时，
Runtime 会中断请求。

未结束的 Tool Part 会记为：

`Tool execution aborted`

这样 UI 不会一直显示运行中。

下一轮也不会误用半截结果。

但 abort 只收拾 Runtime。

已经发生的产品修改，
仍要重新核对。

## 结果不确定，先别重试

Provider 限流通常可以重试。

Apply 超时不能直接重试。

它可能没有执行。

也可能执行成功，
只是响应丢了。

DEF 给每次修改一个单次凭证。

凭证绑定当前 Session 和版本。

Apply 开始后，
凭证即视为已使用。

响应不确定时，
先检查三处事实：

- Commit；
- Checkout；
- live 状态。

对话投递也有稳定的
`clientTurnId`。

Prompt 是否送达不确定时，
先查 Transcript。

## 重启只能找回记录

项目持久保存三本“账”：

- 消息库：说过什么；
- 产品库：改过什么；
- 浏览器状态：眼前应用了什么。

Session 丢失时，
Adapter 可以重新创建它。

原来的 Harness 和产品坐标，
也可以重新绑定。

恢复的是身份和边界。

恢复不了崩溃前的调用栈。

审批内容和产品结果，
仍要从事实源重读。

> 运行时内存记着正在等什么。
> 进程消失，这部分也会消失。

实现入口：

- `session/processor.ts`
- `permission/index.ts`
- `def-opencode-adapter/index.cjs`
- `def-codex-interop.cjs`
- `ai-cli-rest-server.mjs`
