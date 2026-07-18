# 开发者自己的 Skill

审计 DEF Agent 会话时，
总会重复几步：

- 定位会话；
- 读取事件和工具；
- 区分事实与猜测；
- 整理返修提示。

每次重新解释，
很容易漏步骤。

这种流程适合写成 Skill。

## 两类 Skill

项目里有两类 Skill：

| 使用者 | 位置 |
|---|---|
| 开发 Codex | `.agents/skills/**` |
| DEF 产品 Agent | `agent/runtime/def/skills/**` |

开发 Skill 用于：

- 仓库开发；
- 审计；
- 维护。

产品 Skill 面向最终用户。

它只能调用产品开放的工具。

两类 Skill 身份不同。

权限也不能混用。

## Skill 怎样被发现

Skill 不是更长的 Prompt。

运行时先看到索引信息：

- `name`；
- `description`。

描述决定初始路由。

写得太窄，
模型找不到它。

写得太宽，
无关任务也会命中。

最小入口如下：

```markdown
---
name: harness-audit-assistant
description: 导出并审计 DEF 会话。
---

# Harness 审计辅助

先读取会话事实……
```

## 正文放什么

以审计 Skill 为例，
正文要固定几件事：

1. 何时使用；
2. 按什么顺序工作；
3. 哪些动作不允许；
4. 怎样判断完成。

其他材料按需拆开：

```text
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
```

元数据负责发现。

正文负责执行流程。

references 保存背景资料。

scripts 处理确定性操作。

assets 保存模板和静态文件。

## Skill 不能扩权

Skill 可以提醒 Agent：

> 修改前先检查差异。

它不能把需要审批的工具，
变成自动允许。

方法说明和能力授权，
属于不同层。

项目里还有一道目录边界。

开发 Skill 的路由写在：

`.agents/skill-routing.md`

产品 Skill 不能借此获得：

- 任意项目读取；
- Shell；
- 开发工具。

## 验证的是路由

`SKILL.md` 存在，
只说明文件创建成功。

还要用自然语言触发它。

需要观察：

- 是否发现正确 Skill；
- 是否选择正确工具；
- 权限不足时是否停下；
- 失败后是否按规则处理。

一句提醒，
通常不值得单独建 Skill。

必须强制的逻辑，
应该进入代码或 Policy。

Skill 适合保存：

> 会重复、需要判断、
> 又不适合硬编码的工作方法。

正式约束仍以这些文件为准：

- 根目录 `AGENTS.md`；
- `.agents/skill-routing.md`；
- 对应 Skill 的说明。
