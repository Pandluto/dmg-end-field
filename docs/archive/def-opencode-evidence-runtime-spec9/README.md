# DEF OpenCode Spec 9：无效归档

状态：`INVALIDATED`

归档日期：2026-07-23

本目录已经从 `docs/specs` 的有效规格区撤下。全部内容只保留历史审计价值，不具备需求、架构、任务、验收或返修指导效力。

无效原因：

- 预研究把配装 Harness 的局部术语和业务上下文错误提升为项目主线；
- 后续开发没有实现 Harness 单元职责独立、一个 candidate 一个训练假设以及确定性组合与冲突检查；
- 实现把 Harness 版本身份扩张成跨 Adapter、Host、Tool 的运行时能力开关，并引入与项目目标不相称的复杂度；
- 会话清理实现选错宿主：处理了独立 `ai-cli`，没有完成主界面 AI 模式 `workbench` 的 def-opencode 旧会话清理。

处理边界：

- 当前基线仅归档基线中已有的 `research.md`；
- 回退前 `de8f78b..71483816` 产生的 Spec、Task、Verification 和 Completion Audit 不重新引入当前分支；
- 这些后续材料即使仍存在于 Git 历史或安全分支中，也同样属于无效材料；
- 如果未来重新开展相关工作，必须等待用户提供新的标题、目标或具体内容，从新的 Spec 开始，不能续写本 Spec 9。
