# Permission 与 Hook

读取配装和修改配装，
可以是两个 Typed Tool。

前者只读。

后者会产生副作用。

参数都合法，
也不该得到相同处理。

## 能力与 Permission

工具是否暴露给模型，
属于能力范围。

一次调用是否继续，
属于 **Permission**。

常见结果只有三种：

```text
allow  直接执行
deny   拒绝执行
ask    等待用户确认
```

批准必须来自模型之外。

模型可以解释修改理由。

它不能替用户说“已经同意”。

Runtime 要暂停工具，
等待真实的 Approval。

## Hook 放在哪里

Hook 是流程中的插入点。

它常用于：

- 运行前记录参数；
- 运行后记录结果；
- 请求前补充上下文。

不同 Runtime 的实现不同。

有的 Hook 会返回权限结果。

有的把 Permission 单独实现。

需要分清两件事：

- Hook 提供检查位置；
- Permission 表达授权语义。

一条常见链路是：

```text
模型请求工具
→ PreToolUse Hook
→ Permission
→ handler
→ PostToolUse Hook
```

## 先预览，再执行

高风险修改不能只问：

> 允许吗？

用户还要知道准备改什么。

通用流程是：

```text
生成预览
→ 检查差异
→ 用户批准
→ 正式应用
→ 验证结果
```

DEF 把执行前后两步叫作：

`Prepare → Apply`

Apply 返回后，
还要检查真实产品状态。

结果无法确认时，
不能报告成功。

安全检查失败时，
也不应该继续放行。

更多上下文问题见
[上下文、Skill 与 Memory](./03-context-skill-memory.md)。
