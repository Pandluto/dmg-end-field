# 从聊天到 Agent

一次普通模型调用只有两步：

```text
发出消息 → 拿回结果
```

回答结束，请求也结束。

模型本身只负责生成。

打开文件、修改数据、点击界面，
都由外层程序完成。

这里说的 **Agent**，包含两部分：

- 负责生成的模型；
- 负责状态和动作的 Runtime。

## 为什么需要 Session

假设用户说：

> 读取当前配装，把武器 A 换成 B。

模型还不知道当前配装。

它要先读取，再准备修改。

单次生成完成不了这个往返。

**Session** 用来保存连续过程。

主要关系可以简化为：

```text
Session
  ├─ 用户消息
  ├─ 助手消息
  │    └─ 工具调用
  ├─ 工具结果
  └─ 助手继续回答
```

一次用户提问，通常叫 Turn。

一个 Turn 可以包含多次模型生成。

## Agent Loop

外层程序用循环接起这些步骤：

```python
while True:
    response = call_model(messages, tools)

    if response.has_tool_calls:
        results = execute_tools(response.tool_calls)
        messages.extend(results)
        continue

    return response.text
```

循环负责：

- 保存消息；
- 执行工具；
- 回填结果；
- 判断何时停止。

停止原因不只有“回答完成”。

错误、取消和步骤上限，
也会结束循环。

读取配装和准备修改，
可以对应两个不同工具。

工具怎样描述和调用，
记在 [Tool Use](./01-tool-use.md)。
