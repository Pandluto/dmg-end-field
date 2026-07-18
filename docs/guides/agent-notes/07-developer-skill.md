# 开发者自己的 Skill

审计一段 DEF Agent 会话时，我们会反复做同一组动作：定位会话、读取事件和工具调用、区分事实与猜测，再整理成返修提示。每次都从头解释一遍容易漏步骤，这类工作适合整理成 Skill。

这个项目有两类 Skill。开发 Codex 使用 `.agents/skills/**`，处理仓库开发、审计和维护；DEF 产品运行时使用 `agent/runtime/def/skills/**`，面对最终用户，只能依赖产品开放的 Typed Tools。两者名字相似，身份和权限不能混用。

Skill 不是一段更长的 Prompt。它是一份可按场景发现的工作方法，通常由入口说明和按需加载的资源组成：

```text
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
```

运行时先暴露 Skill 的索引信息，通常就是 `name` 和 `description`。描述没有说清触发场景，模型不会在正确的时候加载正文；写得过宽，又会让无关任务反复命中。

一个最小入口大致是：

```markdown
---
name: harness-audit-assistant
description: 导出并审计 DEF 会话，整理证据和返修提示。
---

# Harness 审计辅助

先读取会话事实，再区分已证实问题和待验证假设……
```

## 以审计 Skill 为例

正文主要固定几件最容易漏掉的事：

1. 什么信号出现时使用它；
2. 需要按什么顺序工作；
3. 哪些动作允许，哪些动作必须停下；
4. 怎样判断结果真的完成。

长篇背景资料放进 references，确定性的重复操作尽量交给 scripts，模板和静态文件放进 assets。元数据负责发现和初始路由；正文负责执行流程，并告诉 Agent 何时读取这些资源。

Skill 也不能绕过 Runtime 的权限。它可以提醒 Agent 在修改前检查差异，却不能把原本需要 Approval 的工具变成自动允许。方法说明和能力授权属于不同层。

开发 Skill 的路由集中记录在 `.agents/skill-routing.md`。开发者 Skill 可以指导 Codex 检查仓库；产品 Skill 不能借此获得任意项目读取、Shell 或开发工具。把两个目录混在一起，会让测试环境和产品能力边界都变得含糊。

## 最后要验证路由，而不只是验证文件

创建 `SKILL.md` 只能说明文件存在。还要用自然语言提出任务，观察模型能否发现正确 Skill，加载后是否按流程选择工具，遇到权限和失败时是否停在正确位置。

一句提醒通常不值得单独建 Skill；必须强制执行的逻辑应该进入代码或 Policy。Skill 留给那些需要判断、会重复出现，又不适合硬编码进 Runtime 的工作方法。

实际创建或修改 Skill 时，以根目录 `AGENTS.md`、`.agents/skill-routing.md` 和对应 Skill 的正式说明为准。
