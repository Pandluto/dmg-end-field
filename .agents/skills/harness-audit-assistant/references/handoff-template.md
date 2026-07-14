# Codex 返修交接模板

将下面结构填成一段可直接复制的开工提示词。删除不适用项，不留下空占位符。

```markdown
你在 `/Users/sailstellar/Documents/coding/dmg-end-field` 工作。请修复这次 DEF OpenCode 手点会话暴露的问题。

## 开工前必读

- `AGENTS.md`
- `docs/testing/def-agent-blackbox.md`
- `<absolute-path>/conversation.md`
- `<absolute-path>/trace.json`
- `<absolute-path>/audit.md`
- 与根因直接相关的实现/Spec/verification 文件

## 已确认事实

- 会话标识、时间、Harness binding/hash（如可得）
- 用户原始要求
- 实际工具序列和调用次数
- 关键错误输出或错误数据源
- 最终回答与真实状态之间的差异

## 已确认根因

- 只写有代码或轨迹证据支持的根因。

## 待验证假设

- 明确写“假设”，先复现/查代码后再决定是否改。

## 本轮范围

- 最小必要实现；说明应改 Harness、typed tool、数据源、协议或持久化中的哪一层。
- 若工具能力缺失，不要只靠新增提示词掩盖。
- 保留现有已通过主链路和审批边界。

## 非目标

- 不 promotion Harness candidate，除非我另行明确批准。
- 不向原失败会话重复投递。
- 不顺手重构无关模块，不用模拟测试冒充真实 Agent replay。
- 不主动关闭已运行的 `npm run electron:dev`；只有遇到明确阻塞时按 AGENTS.md 处理一次重启。

## 验收

- 用全新 native session 按 Mac Desktop Interop Route 做 Pure Blackbox 回归。
- v1 记录原文、工具序列、question/permission、错误和终态；Computer Use 只确认真实 iframe/UI。
- 给出修复前失败证据与修复后证据；失败 run 不得标 PASS。
- 对只读路径验证准确 reference/section、调用次数、无 permission/mutation。
- 对 mutation 路径验证审批、拒绝零变化、批准后 commit/applied/live 和重进页面持久化。
- 跑与改动成比例的聚焦检查、`npm run interop:check`、`npm run harness:check`（适用时）及 `git diff --check`。
- 更新对应 task/verification，如实保留未完成项；完成后自动提交，不 push。

先给出证据化根因和最小改动计划，再实施、验证、更新文档并提交。最终用人话说明改了什么、真实跑通了什么、仍未解决什么，并列出 commit。
```

提示词不要预判具体代码修法；若 `audit.md` 只有行为证据，就要求 Codex 先定位根因。避免把“模型偶发选择”直接归咎于 Harness，必须比较失败/通过轨迹。
