# Spec 5 Task 2：关键版本后的闭环收口

基线版本：`spec5-mid-delivery-stable-20260711`（`dc6f932`）及其后续双标签恢复、名称保留和 SQLite 文档级联删除实现。

本任务只处理 Spec 5 尚未闭合的部分。已经稳定的快照/SQLite 双标签、文档独立工作树、软盘首节点/子节点保存、旧存档迁移、文档名称保留和级联删除不得回退。

## S2-T1：统一活动排轴会话

- [ ] 新建单一 `TimelineSession` 应用层，统一提供 `activeTimelineId`、活动文档名称、CheckoutRef 和当前工作副本。
- [ ] CanvasBoard、AI 面板、WorkNode 树、快照面板、分享导入不再分别维护或推导活动文档。
- [ ] 活动文档切换必须一次性完成文档身份、画布 payload、CheckoutRef 和工作树切换。
- [ ] 刷新后从持久化活动文档恢复；活动文档不存在时明确回退到可用文档或空白默认文档。
- [ ] 删除当前文档后不得留下悬空活动 ID、旧画布或旧工作树。

验收：连续切换至少三份 SQLite 文档并刷新，每次画布、文档名、CheckoutRef 和工作树均属于同一 `timelineId`。

## S2-T2：完成 `saveId` 退役

- [ ] 新业务接口、领域类型、Repository 和 renderer 命令统一使用 `timelineId`。
- [ ] `saveId` 只允许存在于旧 WorkNode SQLite、历史 JSON 和迁移适配器边界。
- [ ] 删除通过 label、创建时间、全局 head 或 snapshot id 推导文档归属的运行时逻辑。
- [ ] 为兼容字段增加明确的 deprecated 注释、读取边界和移除条件。
- [ ] 搜索并审核所有 `saveId` 调用，形成剩余兼容点清单。

验收：新建文档、软盘保存、AI 分支、checkout、分享和导入产生的新数据只使用稳定 `timelineId`。

## S2-T3：收口 WorkNode 状态与错误协议

- [x] 完成 WorkNode 全部合法状态转换表，并由 Repository 作为唯一权威执行。
- [x] create、patch、validate、commit、checkout、restore-base、delete 和 document-delete 统一返回结构化业务错误。
- [x] REST、Electron bridge 和 renderer 不再把业务冲突泄漏为原始 SQLite 错误或 500。
- [x] 文档删除、节点删除、当前 checkout 保护、跨文档 parent、重复 ID 和非法状态分别提供稳定错误码。
- [x] UI 显示错误原因和建议动作，不根据错误文本猜测能力。

验收：所有预期冲突返回 4xx 和稳定错误码；smoke 中不得出现原始约束错误。

## S2-T4：固定保存与恢复交互语义

- [x] 右侧软盘 SVG 只保存 WorkNode：无节点时创建首节点，有当前节点时创建其子节点。
- [x] 底部“保存”只创建/复用 TimelineSnapshot，不创建 WorkNode。
- [x] 下区“恢复”的“快照”标签只处理恢复点；“SQLite”标签只负责打开或删除完整文档。
- [x] 旧格式存档首次转换时传递原始名称，并建立可识别的基线节点。
- [x] WorkNode 树显示当前文档名称，任何兼容镜像不得用“主排轴”覆盖已有名称。
- [x] 树内点击只暂存待切换节点；按当前认可交互，在关闭树面板时执行该次切换，未选择新节点时只关闭。
- [x] 明确显示软盘保存成功、文档打开成功、恢复成功和删除结果，避免阻塞式成功弹窗。

验收：四个入口各司其职；操作一种对象不会意外创建、覆盖或删除另一种对象。

## S2-T5：完成 AI 意图执行策略

- [ ] 明确低风险单步操作沿用 Phase 4 实时受控工具的判定条件。
- [ ] 复杂重排、多步骤、分支、预览和高风险操作必须创建或复用当前文档的 WorkNode。
- [ ] patch 阶段只更新 `workingPayload`，不得提前修改当前画布或 CheckoutRef。
- [ ] validate、diff 和 risk 证据必须在应用前可读取。
- [ ] 应用后同时对齐画布工作副本、WorkNode 状态、commit 和 CheckoutRef。
- [ ] AI 创建的节点、人工软盘节点和旧存档基线节点使用可区分的来源/标签语义。

验收：低风险即时操作与复杂 WorkNode 操作各完成一组后门自然语言黑盒验证，结果符合各自策略。

## S2-T6：退休双写兼容链路

- [ ] 明确统一 Timeline Repository 与旧 `ai-timeline-worknodes.sqlite3` 的迁移完成判定。
- [ ] 迁移完成后，新节点、commit、head/checkout 和删除不再依赖旧 WorkNode Store 双写。
- [ ] `localStorage`、`sessionStorage` 和旧 archive 只保留工作缓存或一次性迁移职责，不再作为版本事实来源。
- [ ] 提供迁移前备份、迁移计数核对、失败回滚和重复执行幂等验证。
- [ ] 删除文档时确认统一 Repository 与兼容库均无残留，防止节点树复活。

验收：关闭旧兼容读取后，保存、恢复、AI WorkNode、分享导入和删除仍可完整运行。

## S2-T7：分享与导入终验

- [ ] 分别验证当前排轴、指定分支、完整文档三种 Bundle V2 导出。
- [ ] 导入默认创建新 TimelineDocument，不覆盖同名或同内容现有文档。
- [ ] 导入后能从 SQLite 标签页直接打开，并显示正确名称、CheckoutRef、快照和工作树。
- [ ] 校验 payload hash、父子引用、schemaVersion 和跨文档节点 ID。
- [ ] 分享文件不包含 AppData 路径、本机设置、活动 UI 状态或无关全局数据。

验收：在一份独立临时本地库中导入导出文件，画布内容和树关系与源文档一致。

## S2-T8：完整发布验收

- [ ] 运行 `npm run build`。
- [ ] 运行 Timeline Repository、WorkNode SQLite/REST、迁移和备份恢复 smoke。
- [ ] 按 `docs/testing/def-agent-blackbox.md` 完成后门自然语言验证。
- [ ] 完成 UI 手测矩阵：快照保存/恢复/删除、SQLite 打开/删除、软盘首节点/子节点、树切换、AI patch/apply、分享和导入。
- [ ] 完成 Chrome UI 验证：输入、工具活动和最终结果在 MainWorkbenchAiPanel 可见。
- [ ] 验证刷新、异常中断和服务不可用恢复，不回退 Phase 4 已确认可靠性。
- [ ] 更新原 `tasks.md` 勾选和 Spec 5 最终完成审计。

验收：Spec 5 全部显式要求均有对应代码、测试或实测证据；不存在跨树混显、部分按钮恢复、空树误绑定、名称丢失、删除 500、保存入口混用或关闭行为歧义。

## 推荐顺序

`S2-T1 → S2-T2 → S2-T3 → S2-T4 → S2-T5 → S2-T6 → S2-T7 → S2-T8`

其中 S2-T1 至 S2-T4 是数据与交互收口，完成前不继续增加新的树 UI 功能；S2-T5 至 S2-T8 负责 AI 策略、兼容链退休和最终发布证明。
