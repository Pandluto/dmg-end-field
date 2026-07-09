# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 测 DEF agent / typed tools 能力时，优先使用项目内置 workbench 测试后门：`POST /def-agent/workbench-test/prompt`。测试要像真实用户一样“一条提示词测一个能力点”或“一条提示词测一个真实场景”，逐条检查 session、transcript、实际 tool 调用和最终状态；不要只发一句笼统的“确认工具是否存在”，也不要用自造 smoke 绕过 `prompt -> ui-events -> MainWorkbenchAiPanel` 链路。
- 做黑盒场景测试时，不能在 prompt 里暴露“这是测试”、用例编号、期望工具、验收点、安全要求或实现细节；prompt 只能是正常用户会说的话，例如“加个…/换个…/减个…/查个…/这个怎么样/那个是什么/为什么这样”。测试意图、预期结果和判定标准只能写在测试记录里，不能告诉被测 agent。
- 做可观察的前后端联调/场景测试时，默认不要触发会刷新主界面的操作。`checkoutAiTimelineWorkNode`、`restoreAiTimelineWorkNodeBase`、`restoreTimelineSnapshot` 等命令默认可能 `window.location.reload()`，会冲掉用户正在看的测试过程；需要测这类闭环时必须提前说明，并优先使用 `reload:false`、拆成单独用例，或明确标记它会破坏可视连续性。
