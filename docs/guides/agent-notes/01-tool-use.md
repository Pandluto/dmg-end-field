# Tool Use：让模型碰到外部世界

为了读取当前配装，程序可以先注册一个 `read_current_loadout` 工具。模型拿到的是工具名称、用途和参数格式；真正读取产品数据的函数仍在程序里。

一个最小工具通常有四样东西：

```text
name         工具叫什么
description  什么情况下应该用
schema       参数长什么样
handler      程序实际执行什么
```

这个工具可以简化成：

```json
{
  "name": "read_current_loadout",
  "description": "读取当前时间线已经应用的配装",
  "parameters": {
    "type": "object",
    "properties": {
      "character": { "type": "string" }
    },
    "required": ["character"]
  }
}
```

模型看到的是前面三项，看不到 handler 的实现。它可能返回 `{"character":"A"}`。程序验证参数后调用读取函数，再把结果写回 Session。这个过程通常叫 Tool Use。

## 为什么强调 Typed Tool

如果工具只接受一段随意文本，执行方还要重新猜模型的意思。Typed Tool 把参数限制成明确结构，也给后面的权限判断和日志留下稳定对象。

Schema 解决的是“参数是否合法”，并不保证“这件事应该做”。路径格式正确，不代表模型就有权读取那个路径；修改参数完整，也不代表可以绕过用户审批。权限是下一层问题。

## 注册和调用是两件事

工具注册只是把能力放进 Registry。真正发给模型前，程序还会根据当前 Agent、Session、Skill 和权限做一次筛选。模型只能调用本轮实际暴露给它的工具。

工具执行后，结果会重新进入 Session。模型看到角色 A 当前使用的武器，才有条件准备下一次修改。少了这次回注，Agent Loop 无法根据外部结果继续工作。

读取通常可以直接完成；换武器会改变产品状态，不能沿用同一套放行规则。[Permission 与 Hook](./02-permission-and-hooks.md) 记录的是这层边界。
