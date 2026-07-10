# Spec 5：实施任务

## T0：冻结错误语义并建立迁移护栏

- [x] 移除“保存快照自动创建 Work Node”的逻辑。
- [x] 移除进入 AI 模式自动创建 manual checkpoint 的遗留代码，而非仅用标志位禁用。
- [x] 暂停任何把 snapshot id 写入 Work Node `saveId` 的调用。
- [x] 在改动前固定 Phase 4 兼容清单：实时 checkout、整组复制、staff line 重建、会话隔离和 AI 模式拖拽禁用不得回退。
- [x] 为现有 localdata 与 Work Node SQLite 建立只读备份和迁移预览命令。
- [x] 记录并分类现有异常 `[snapshot]` Work Node，默认不删除；提供只读迁移预览命令。
- [x] 将当前 checkout 路径删除失败统一为结构化 `409`，不再从 REST/bridge 泄漏为 `500`。

验收：保存、进入 AI、打开树都不会新增 Work Node。

## T1：定义统一领域类型与 Repository 边界

- [x] 新增 `TimelineDocument`、`TimelineSnapshot`、`WorkNode`、`CheckoutRef`、`AuditEvent` 领域类型。
- [ ] 将 `saveId` 的业务含义替换为稳定 `timelineId`；保留旧字段仅用于迁移兼容。
- [ ] 定义所有状态转换和结构化错误码。
- [x] 新建统一 Timeline Repository 基座；renderer 后续只通过 IPC/bridge/REST 客户端访问，迁移完成前不接管现有运行路径。

验收：前端不再根据 label、创建时间或全局 head 推导关系。

## T2：实现 SQLite Schema 与原子事务

- [ ] 创建 documents、payload blobs、snapshots、work nodes、patches、checkout refs、audit events、schema meta 表。
- [ ] 实现 payload SHA-256 去重、外键、索引、事务和垃圾回收策略。
- [x] 实现“创建 Work Node 不自动 checkout”。
- [ ] 实现每个 TimelineDocument 独立的 CheckoutRef。
- [ ] 将删除冲突映射为结构化 `409`。

验收：中断任意写操作后，不存在半写入的引用、节点或当前应用目标。

## T3：迁移当前本地数据

- [x] 从现有恢复快照 archive 导入用户快照。
- [x] 从现有 Work Node SQLite 导入合法 AI 树和审计事件。
- [x] 为历史 `current-main-workbench` 建立默认 TimelineDocument。
- [x] 生成异常 snapshot-node 的迁移预览与用户确认操作。
- [ ] 提供一次性回滚到备份的恢复工具。

验收：迁移前后正常快照数量、AI 节点数量、可读取 payload 数量可核对；异常数据不自动丢失。

## T4：重写快照保存与恢复链路

- [x] 工具栏保存改为创建/复用 TimelineSnapshot。
- [x] 以 payload hash 去重；重复保存返回已有快照信息。
- [x] 恢复动作更新 CheckoutRef(snapshot) 并写审计事件。
- [x] 删除快照实现引用检查、归档或明确级联确认。
- [ ] 移除以 `localStorage` 为快照事实来源的运行时写路径。

验收：保存、恢复、删除快照均不创建或修改 Work Node。

## T5：重写 Work Node 与 AI 链路

- [ ] 定义并实现 AI 意图执行策略：明确低风险单步操作保留 Phase 4 的实时 checkout；复杂/重排/分支/预览操作创建或复用 AI Work Node。
- [ ] Patch 只能改 node working state，随后返回 validate、diff、risk 证据。
- [ ] checkout 显式更新 CheckoutRef(work-node) 并应用 payload。
- [x] restore base 作为 Work Node 操作，写审计事件但不伪造树节点。
- [ ] 删除旧的“AI turn / manual checkpoint 必须自动建节点”策略。

验收：后门自然话术测试同时证明：复杂重排在 Patch 阶段不改变当前排轴，应用后才变化；明确低风险操作仍能沿用 Phase 4 的实时 checkout 并收到真实回执。

## T6：重建 UI 信息架构

- [ ] 恢复面板只渲染 TimelineSnapshot。
- [ ] Work Node 面板一次只渲染当前 TimelineDocument 的 AI 树。
- [ ] 节点详情显示 base、diff、验证、风险、应用状态和审计历史。
- [ ] 应用按钮与关闭按钮语义分离；增加可选“应用并关闭”。
- [ ] 删除按钮使用后端 capability/错误码，不在客户端猜测可删性。
- [ ] 删除 snapshot 卡片、伪 checkout/restore 节点与全局 head 高亮逻辑。

验收：UI 中不存在 `[snapshot]` Work Node 根；多文档不会混在同一树里。

## T7：重写分享与导入

- [x] 定义 `dmg.timeline-bundle.v2` manifest、schema 和哈希校验。
- [ ] 实现当前排轴、AI 分支、完整文档三种导出范围。
- [ ] 导入默认创建新 TimelineDocument，并在单一事务中写入。
- [ ] 提供导入预览、冲突说明和版本不兼容提示。
- [ ] 明确排除本机 AppData 路径、无关全局设置和临时 UI 状态。

验收：导出的文件可在另一份本地库导入，恢复同样的排轴或 AI 分支，不覆盖对方现有文档。

## T8：测试与发布验收

- [ ] SQLite repository smoke：事务、哈希去重、外键、删除 409、CheckoutRef。
- [ ] 迁移 smoke：正常树、快照、异常 snapshot-node、回滚备份。
- [ ] UI 手测：保存、恢复、打开 AI、树内 patch、明确应用、删除、分享、导入。
- [ ] 后门黑盒：自然话术 → Work Node Patch → diff → 当前排轴未变 → 显式应用。
- [ ] Chrome UI 验证：输入、工具活动、最终结果在 `MainWorkbenchAiPanel` 可见。
- [ ] 运行 `npm run build` 及本阶段针对性 smoke。

验收：满足 Spec 5 全部验收标准，且不再出现 snapshot 变根节点、跨树混显、删除 500 或关闭即应用。

## 推荐实施顺序

`T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8`

T0-T3 是数据安全边界，未完成前不得继续优化树 UI；T4-T6 是产品语义闭环；T7 与 T8 在核心数据模型稳定后执行。
