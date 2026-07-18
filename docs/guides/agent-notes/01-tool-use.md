# Tool Use：让模型碰到外部世界

为了读取配装，
程序先注册一个工具：

`read_current_loadout`

模型能看到：

| 字段 | 用途 |
|---|---|
| name | 工具叫什么 |
| description | 什么时候使用 |
| schema | 参数长什么样 |

模型看不到 handler 的实现。

一个简化定义如下：

```json
{
  "name": "read_current_loadout",
  "description": "读取当前配装",
  "parameters": {
    "type": "object",
    "properties": {
      "character": { "type": "string" }
    },
    "required": ["character"]
  }
}
```

模型可能返回：

```json
{ "character": "A" }
```

程序验证参数后，
再调用真正的读取函数。

这就是 Tool Use。

## 为什么需要 Typed Tool

随意文本还要重新猜含义。

Typed Tool 把参数固定成结构。

Schema 只回答：

> 参数是否合法？

它不回答：

> 这件事是否应该做？

参数正确，
不代表已经获得权限。

## 注册不等于暴露

注册只是把工具放进 Registry。

每轮真正发给模型前，
还会按场景和权限筛选。

模型只能调用本轮暴露的工具。

工具结果会写回 Session。

模型看到当前武器后，
才能准备下一次修改。

读取和修改的风险不同。

相关边界见
[Permission 与 Hook](./02-permission-and-hooks.md)。
