# 开发者自己的 Skill

审计一段 DEF Agent 会话时，我们总会重复一组动作：找到会话，读取事件和工具调用，区分事实与猜测，再把证据整理成返修提示。每次都从头回忆，很容易漏掉步骤；这类会反复出现、又需要判断的工作，适合整理成 Skill。

Skill 不是一段更长的 Prompt。它是一份可以按场景发现的工作方法，通常由入口说明和按需加载的资源组成：

```text
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
```

Runtime 先看到 Skill 的 `name` 和 `description`。任务符合描述时，Agent 才读取完整正文；正文再说明工作顺序、边界、完成条件，以及何时使用 references、scripts 或 assets。

一个最小入口大致如此：

```markdown
---
name: harness-audit-assistant
description: 导出并审计 DEF 会话，整理证据和返修提示。
---

# Harness 审计辅助

先读取会话事实，再区分已证实问题和待验证假设……
```

## 入口负责找到，正文负责做完

Description 如果没有说清触发场景，Agent 很可能在需要时找不到它；写得过宽，又会让无关任务反复命中。元数据负责发现和初始路由，正文则固定最容易遗漏的流程。

长篇背景资料放进 references，确定性的重复操作交给 scripts，模板和静态文件放进 assets。这样 Agent 不必每次加载全部知识，只在流程走到对应位置时读取需要的部分。

Skill 仍然不能绕过 Runtime 权限。它可以提醒 Agent 在修改前检查 Diff，却不能把原本需要 Approval 的工具变成自动允许。必须强制执行的规则应该进入代码或 Policy；Skill 留给需要理解上下文、会重复发生，又不适合硬编码的工作方法。

## 开发 Skill 与产品 Skill 不是一回事

这个项目有两类 Skill：

- `.agents/skills/**` 供开发 Codex 使用，处理仓库开发、审计和维护；
- `agent/runtime/def/skills/**` 供 DEF 产品运行时使用，只能依赖产品开放的 Typed Tools。

两者名字相似，身份和权限不能混用。开发 Skill 可以指导 Codex 检查仓库，产品 Skill 不能借此获得任意项目读取、Shell 或开发工具。把目录混在一起，会同时模糊测试边界和产品边界。

文件写完也不代表 Skill 已经可用。还要用自然语言提出真实任务，观察 Agent 能否发现正确入口，加载后是否按顺序使用工具，并在权限不足或证据不够时停在正确位置。验证的是整条路由，不只是 `SKILL.md` 是否存在。

实际创建或修改 Skill 时，以根目录 `AGENTS.md`、`.agents/skill-routing.md` 和对应 Skill 的正式说明为准。
