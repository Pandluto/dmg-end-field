# Task 8-2：收紧 DEF OpenCode 的 SQLite 与会话边界

## 状态

待实施。按 [Spec 8-2](./spec8-2.md) 执行；本任务只实现并验证权限收口，不扩展知识训练或数据管理产品能力。

## 目标

移除 DEF OpenCode 隐式创建 TimelineDocument/SQLite/排轴存档的能力，让 Workbench native session 只服务于创建时绑定的既有正式 SQLite，并让 AI 模式对临时 SQLite fail-closed。

## 实施原则

- 先收紧 runtime/repository，再更新 Harness 教学；
- 前端禁用不是权限事实源，服务端必须独立拒绝；
- 不修改用户现有临时 SQLite 保存/转正流程；
- 不删除“新建 DEF 会话”，只禁止它创建或切换数据对象；
- 不用默认 timeline、最新 timeline 或名称匹配补全缺失绑定；
- 不修改 vendor OpenCode；
- 任何失败都不得留下半写 binding、context、document、archive 或 permission continuation。

## Task A：冻结审计基线与术语

- [ ] 记录本轮基线 commit、数据架构相关 commit 和当前 stable Harness ref。
- [ ] 固化术语：OpenCode session、session-axis binding、TimelineDocument/SQLite 工作区、临时 SQLite、Work Node、独立排轴存档。
- [ ] 明确“新建 DEF 会话”与“新建存档/SQLite”是两种不同能力。
- [ ] 记录修改前的风险入口：前端 create payload、host-only session storage、服务端 timeline fallback、binding `ensureDocument()`、context attach 与 recover。
- [ ] 冻结至少一个合法正式 SQLite、一个临时 SQLite 和两个不同正式 SQLite 的隔离 fixture。

## Task B：建立 canonical binding contract

- [ ] 定义版本化 Workbench native session binding，明确 `sessionID/host/agent/directory/timelineId/axisBindingId/harnessBinding`。
- [ ] `host=workbench` 时把 `timelineId` 改为创建必填项；`host=ai-cli` 不携带或继承 timeline。
- [ ] binding 创建前读取既有 document，拒绝不存在、归档或 `isTemporary=true` 的目标。
- [ ] timeline 校验必须发生在创建 OpenCode session directory/session 之前，避免失败残留。
- [ ] binding 写入后禁止由 context attach、turn、tool、recover 或普通 UI 状态修改 `timelineId`。
- [ ] 为 missing、temporary、mismatch、stale 和 denied capability 建立稳定错误 code/state。

## Task C：收紧 Workbench 前端入口与 session 复用

- [ ] AI 模式入口读取 authoritative timeline session readiness、timeline id 和 `isTemporary`。
- [ ] 临时 SQLite 上禁用或拒绝 AI 模式，并显示“先完成首次保存/命名”的用户提示。
- [ ] 临时 SQLite 的拒绝路径不得触发 runtime ensure、session create/recover、context attach 或 DEF tool。
- [ ] Workbench native session create payload 显式提交当前 timeline id。
- [ ] Workbench session 持久索引加入 timeline identity，不再只按 host 复用。
- [ ] 恢复候选必须同时匹配 host、session、directory 与 timeline binding。
- [ ] 当前 timeline 切换时卸载旧 iframe；不得把旧 transcript、question、permission 或 node workspace 改绑到新 timeline。
- [ ] “新建 DEF 会话”只为当前正式 SQLite 创建新 conversation，不产生任何数据对象。

## Task D：移除服务端 fallback 与补建能力

- [ ] native Workbench session create 缺少 timeline id 时立即拒绝。
- [ ] `syncNativeWorkbenchAxisBinding` 移除 `current-main-workbench` fallback。
- [ ] Workbench context attachment 要求 `context.timeline.id = binding.timelineId`。
- [ ] context mismatch 时不落盘 `.def-workbench-context.json`，不更新 checkout transition。
- [ ] recover/bootstrap 重新校验 document 存在、非临时及 host/timeline/directory 一致。
- [ ] 绑定失效时阻止 turn、tool continuation 与 permission continuation，不自动寻找替代 SQLite。
- [ ] 确认所有兼容 native/interop create 路径使用同一准入函数，避免只修主 UI 路由。

## Task E：收紧 repository 与 typed tool 权限

- [ ] 从 `def.workbench.bind_session_axis` 移除 `ensureDocument()` 及其他创建语义调用。
- [ ] 绑定只接受精确存在且未归档的正式 document。
- [ ] repository 的 session-axis upsert 拒绝 `isTemporary=true`。
- [ ] optional bound node 必须属于 binding timeline；不允许跨 timeline node id。
- [ ] `def_workbench_context`、`def_node_fork/bind/read/sync/diff/use/restore/delete` 全部从 session binding 解析 timeline，拒绝调用输入覆盖。
- [ ] Workbench registry/adapter 不暴露 workspace/document create、archive export/convert/import/transfer/delete 或 temporary promote。
- [ ] 检查 legacy REST fallback，确保 Agent tool route 无法间接调用上述数据生命周期 API。
- [ ] 合法 `def_node_fork` 保持可用，并在代码/文案中明确它是同一 SQLite 内的 child draft。

## Task F：处理生命周期与并发

- [ ] 删除或归档绑定 SQLite 后，旧 session 下一次 bootstrap/context/turn 明确返回 stale binding。
- [ ] 临时 SQLite 被替换回收后，不得恢复曾错误绑定它的 session。
- [ ] 同一正式 SQLite 可以有多个独立 OpenCode session，但各自 directory、transcript、question、permission 与 node workspace 隔离。
- [ ] 同一 session 不允许改绑到另一个正式 SQLite。
- [ ] timeline 切换与 pending permission 并发时，旧 permission 即使随后批准也不能作用于新 timeline。
- [ ] checkout change 继续按既有 rebind/CAS gate 处理，不与 timeline rebind 混为一谈。

## Task G：更新 Harness candidate

- [ ] 在 runtime 权限门完成后创建新的完整八 Slot Harness candidate。
- [ ] Agent contract 写明 session 只服务绑定的正式 SQLite，缺失/失效时停止。
- [ ] Routing/tool guidance 区分“新建 DEF 会话”“fork Work Node”“新建/导出存档”。
- [ ] Response policy 为 temporary、mismatch 和 stale binding 提供简短、可执行且不泄漏其他 timeline 的回复。
- [ ] Harness 不宣称它能实施 runtime 尚未提供的安全边界。
- [ ] candidate 保持 immutable，不直接覆盖 stable，不自动 promotion。

## Task H：定向合同验证

- [ ] 正式 SQLite：创建 Workbench session 成功，binding timeline 与当前 timeline 完全一致。
- [ ] 缺少 timeline id：session create 拒绝，documents/sessions/bindings 数量无变化。
- [ ] 不存在或归档 timeline：拒绝且不生成 fallback document。
- [ ] 临时 SQLite：前端拒绝，服务端直接调用同样拒绝，SQLite/hash/文件数量无变化。
- [ ] 绑定工具调用失败后无空 document、axis binding 或 context 文件。
- [ ] context 报另一个 timeline id：拒绝且原 context/checkout state 不变化。
- [ ] session A 调用 timeline B 的 node：拒绝且 A/B 均零变化。
- [ ] 用户新建 DEF 会话：只增加 OpenCode session，TimelineDocument/SQLite/archives 均零变化。
- [ ] 删除绑定 SQLite 后 recover/continue：返回 stale binding，不改绑到当前工作区。
- [ ] `/AI CLI` session 不获得 Workbench timeline context。

## Task I：DEF 黑盒与 UI 验证

- [ ] 按 `docs/testing/def-agent-blackbox.md` 使用 Mac Desktop Interop Route，不使用旧 prompt 兼容入口作为新测试协议。
- [ ] 在真实临时 SQLite 界面确认 AI 模式不可进入，且 interop status/session 列表没有新增 Workbench session。
- [ ] 在真实正式 SQLite 进入 AI 模式，记录 session id、binding timeline、首响和 UI 可见状态。
- [ ] 新建一个 DEF 对话后确认仍绑定同一 timeline，且没有新 SQLite/存档。
- [ ] 切到另一个正式 SQLite 后确认不会看到或继续前一个 session 的 transcript、question 或 pending permission。
- [ ] 对一个合法只读 turn 做 PASS_TO_PASS。
- [ ] 对一个 child draft + validate/diff 做 PASS_TO_PASS；是否执行 use 由独立 permission 场景决定。
- [ ] 对拒绝型 permission 做 safety 验证，确认两个 timeline 都零变化。
- [ ] 每个 blackbox turn 记录 prompt、session、timing、tool calls、SQLite/checkout/pending command 与最终判断。

## Task J：Harness regression 与人工决策

- [ ] 建立 temporary SQLite、missing binding、cross-timeline mismatch 的 FAIL_TO_PASS scenarios。
- [ ] 建立正式 SQLite read-only、child draft、session recovery 的 PASS_TO_PASS scenarios。
- [ ] 建立 archive/workspace zero-create、permission rejection、cross-timeline zero-change safety assertions。
- [ ] baseline 与 candidate 使用新的 native session，禁止复用 session id。
- [ ] transcript、tool events、binding、SQLite document counts、archive counts、permission 与 UI evidence 可关联。
- [ ] 形成可机器执行的 regression result 与独立 promotion decision artifact。
- [ ] 人工 reviewer 决定 promote/reject；失败时保留 candidate 并记录 rollback target。

## 完成检查

- [ ] Spec 8-2 全部验收标准已逐项关联证据。
- [ ] 代码与 Harness 修改按责任层拆分清楚，未修改隐藏裁判或安全定义。
- [ ] 相关定向检查、Harness regression 与真实 UI 验证通过。
- [ ] 审计记录说明哪些近期数据架构改动影响了 DEF OpenCode，哪些不在本轮范围。
- [ ] 实施提交不包含真实 transcript、用户数据、runtime session 或无关 sharedata 改动。
- [ ] 修复完成后自动提交；candidate promotion 保持独立人工决策。

## 完成定义

当临时 SQLite、缺失绑定、跨 timeline 上下文和隐式 document/archive 创建全部 fail-closed，合法正式 SQLite 内的 Workbench session 与 Work Node 能力保持可用，并通过合同、黑盒、UI、回归和人工审阅证据证明，本任务完成。
