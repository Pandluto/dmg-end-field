# Sheet Equipment 保存链路与导入导出对齐 Phase 4 Tasks

## Status

本任务拆分用于收口 Phase 4 的保存链路、缓存职责和导入导出弹窗对齐行为。

## Tasks

- [ ] 对照 Sheet-Weapon 检查 Sheet Equipment 当前保存入口实现。
- [ ] 确认保存按钮行为与 Sheet-Weapon 对齐。
- [ ] 补齐 `Ctrl+S` 快捷键入口。
- [ ] 确认 `Ctrl+S` 触发后的防误触提示逻辑与 Sheet-Weapon 一致。
- [ ] 确认 Sheet Equipment 页面不存在自动保存触发点。
- [ ] 确认编辑过程只更新当前页面状态，不隐式执行保存。
- [ ] 对照 Sheet-Weapon 检查保护开关开启时的保存确认流程。
- [ ] 确认保护开关关闭时，手动保存可直接执行。
- [ ] 确认保护开关开启时，手动保存前弹出保护确认弹窗。
- [ ] 确认保护确认弹窗的样式、按钮布局和交互与 Sheet-Weapon 对齐。
- [ ] 清点当前 Equipment 页面中“本地保存”相关逻辑入口。
- [ ] 移除或停用与 `localStorage` 并行的“本地保存”路径。
- [ ] 确认 `localStorage` 仅作为缓存存在，不作为真实数据源。
- [ ] 确认手动保存成功后只同步更新 `localStorage`，不再写入另一套本地保存结果。
- [ ] 确认页面不会出现内存态、缓存态、保存态来源冲突。
- [ ] 对照 Sheet-Weapon 检查导入弹窗结构与样式实现。
- [ ] 对照 Sheet-Weapon 检查导出弹窗结构与样式实现。
- [ ] 复用或抽取 Sheet-Weapon 现有导入导出弹窗结构。
- [ ] 修复 Sheet Equipment 导入导出弹窗内容区的显示异常。
- [ ] 确认导入导出弹窗的内容区尺寸、间距、滚动和布局与 Sheet-Weapon 一致或等效一致。
- [ ] 清理导致 Equipment 弹窗样式偏差的局部覆盖样式。
- [ ] 回归验证保存成功/失败提示与 Sheet-Weapon 一致。
- [ ] 回归验证 `Ctrl+S`、保护确认、缓存同步、导入弹窗、导出弹窗行为。
- [ ] 运行 `npm run build`。
