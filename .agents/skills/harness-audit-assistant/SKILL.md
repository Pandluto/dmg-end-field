---
name: harness-audit-assistant
description: 导出并审计 DEF OpenCode/Workbench 会话，识别 Harness、typed tool、知识读取、审批、持久化和工具路由问题，并生成可交给另一位 Codex 的证据化返修提示词。Use when the user says “harness 审计辅助”, provides a DEF Workbench UUID or native ses_ session ID, asks to pull/export a conversation locally, audit a hand-tested DEF session, compare passing and failing runs, or prepare a Codex repair handoff.
---

# Harness 审计辅助

把用户手点得到的 DEF 会话固化为本地证据，先审计事实，再生成给另一位 Codex 的可执行返修提示词。

## 边界

- 本 Skill 属于开发 Codex，位置固定为 `.agents/skills/`。
- 不得复制、加载或引用到 `agent/runtime/def/skills/`；后者只属于 def-opencode 产品运行时。
- 默认只读：不向被审计会话发消息，不点审批，不修改 Harness，不 promotion，不重启常驻 `electron:dev`。
- 用户只要求“审计并给提示词”时，不顺手修代码。

## 工作流

1. 先读仓库根目录 `AGENTS.md`、`.agents/skill-routing.md` 和 `docs/testing/def-agent-blackbox.md`，检查 `git status --short`，保护用户已有改动。
2. 接受两类标识：native `ses_...`，或 Workbench UUID。优先通过 `DefCodexInteropProtocol v1` 读取在线 transcript、events、questions、state；需要离线固化或 v1 不可用时，运行：

   ```bash
   node .agents/skills/harness-audit-assistant/scripts/export-session.mjs <session-id-or-workbench-uuid>
   ```

3. 将原始证据保存到被 git 忽略的 `data/localdata/def-session-audits/<输入标识>/`：
   - `conversation.md`：可读会话、工具输入输出、错误与时间；
   - `trace.json`：结构化消息、工具序列与计数；
   - 不导出模型 reasoning/思维链。
4. 完整阅读导出物和本次相关实现。按 [审计量表](references/audit-rubric.md) 判断：Harness 路由、typed tool 合同、知识读取、N+1/反复调用、审批与 mutation、CAS/持久化、bridge/UI、完成声明与真实 postcondition。
5. 区分“已证实根因”和“待验证假设”。输出调用总数、工具序列、关键输入输出、终态、状态是否变化；不能因最终回答看起来合理就判定通过。
6. 在同一目录撰写 `audit.md`，至少包含：人话结论、证据、根因/假设、严重度、建议架构、最小验收。除用户明确要求，不改原始 `conversation.md` 或 `trace.json`。
7. 按 [返修交接模板](references/handoff-template.md) 生成一段可直接复制给另一位 Codex 的开工提示词。提示词必须引用本地证据，限定范围和非目标，要求新会话黑盒回归、如实记录失败，并遵守仓库自动提交规则。

## 审计原则

- v1 协议是 turn、工具、问题和失败的事实源；Computer Use 只确认真实 UI，不替代协议证据。
- 数据/工具合同缺失时，不把问题伪装成“加一句提示词”；先修最小能力边界，再教学。
- 对阻塞会话不重复投递同一请求；回归使用全新 session。
- 只读错误、质量不足通常不是 P1；涉及越权 mutation、审批绕过、数据丢失、跨会话串线或错误持久化才上升到高优先级。
- 不因单次 PASS 自动 promotion candidate；promotion 需要独立决策和回归证据。

## 交付

最终回复同时给出：

1. `conversation.md`、`trace.json`、`audit.md` 的可点击绝对路径；
2. 一段简短人话诊断；
3. 一段完整、可复制的 Codex 开工提示词；
4. 仍未知或需要真人确认的事项。
