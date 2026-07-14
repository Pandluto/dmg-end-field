# Developer Skill Routing

本文件集中维护“开发本项目的 Codex”所用 Skill 路由。仓库根目录 `AGENTS.md` 只放入口和强约束，不继续堆叠每个 Skill 的详细流程。

## 严格分区

| 区域 | 使用者 | 用途 | 禁止事项 |
| --- | --- | --- | --- |
| `.agents/skills/` | 开发 Codex | 审计、研发、交接等开发工作流 | 不得注入 def-opencode prompt 或产品运行时 |
| `agent/runtime/def/skills/` | def-opencode | 面向最终用户的游戏知识与工作台能力 | 不得承载开发审计、git、Codex 交接流程 |

两侧 Skill 不得混放、复制或互相引用。开发 Skill 可以审计运行时 Skill 的行为，但不能成为运行时依赖。

## 路由表

| 唤醒关键词 / 任务信号 | 必须读取 | 适用工作流 |
| --- | --- | --- |
| `harness 审计辅助`、`$harness-audit-assistant`、用户给出 DEF 会话 ID 并要求导出/审计/生成返修提示词 | `.agents/skills/harness-audit-assistant/SKILL.md` | 本地导出会话 → 证据审计 → 生成另一位 Codex 的开工提示词 |

新增开发 Skill 时，把详细说明放入自己的 `SKILL.md`，并只在本路由表增加一行。不要把完整 Skill 内容追加到 `AGENTS.md`。
