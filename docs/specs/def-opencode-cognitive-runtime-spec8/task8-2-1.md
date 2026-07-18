# Task 8-2-1：闭合当前正式 SQLite 与工作树边界

## 状态

已由提交 `5ad5a72` 完成首轮实施并通过现有自动检查。独立审计确认 canonical gate 与 fork 主路径有效，但 Task D、G、J、K、L 尚未完整闭合：部分 current data/mutation 未接 gate，全队配装没有单一候选 C，定向合同、真实 UI 和 Harness regression 证据不足。剩余工作转入 [Task 8-2-2](./task8-2-2.md)。

## 目标

用一个 canonical current gate 确定当前正式 SQLite、current projection 与 session binding 是同一个对象；随后让当前排轴读取、Work Node、单角色配装、全队配装和 permission continuation 始终留在同一棵工作树中，重新配装一律从当前 checkout 新建横向分支节点。

## 实施原则

- 保留 Workbench 当前排轴统一投影；给它补 identity 和统一校验；
- 目标 timeline 与 payload source 必须同时通过同一个 gate；
- 正常 UI 准入与服务端执行时复验缺一不可；
- Workbench-scoped、session-private、public/shared 三类资源分开治理；
- 新配置写入新分支，不覆盖 parent；
- permission 批准的是精确候选分支，不是“当前随便哪个状态”；
- 先修 runtime，再更新 Harness；candidate 不自动 promotion；
- 不修改 vendor OpenCode，不触碰无关 sharedata。

## Task A：冻结返修基线与审计复现

- [ ] 记录 `5c90caa`、当前 Harness candidate `candidate/spec8-2-binding`、版本 `8.2.0-candidate.2` 和未 promotion 状态。
- [ ] 保留现有自动检查结果，明确它们没有覆盖 active projection 与 binding 交叉失配。
- [ ] 固化 A/B 两个正式 SQLite、一个临时 SQLite、一个 Workbench session 和一个 unbound AI CLI session fixture。
- [ ] 把已复现的“session A + current projection B”读取与 fork 串线写成定向合同用例。
- [ ] 冻结配装回归：axis context 收紧后旧无参调用返回空、合法流程误报 checkout change。
- [ ] 记录用户手动配装不在故障范围，避免误修 UI 数据流程。

## Task B：定义并实现 canonical current gate

- [ ] 盘点 session create/bootstrap/recover、context attach、turn、typed tool、question/permission continuation 的现有校验入口。
- [ ] 提供单一 resolver/gate，统一返回 session、binding timeline、active timeline、projection timeline、document lifecycle、checkout node/revision 和 axis binding。
- [ ] 校验 active/projection/binding timeline id 完全相等。
- [ ] 校验 document 存在、未归档、非临时，checkout 属于同一 timeline。
- [ ] 统一映射 missing、temporary、mismatch、stale 和 checkout revision 错误。
- [ ] 任一失败禁止 fallback、`ensureDocument()`、猜测当前对象、改绑或消费旧快照。
- [ ] 避免每个工具复制一套不一致的 ad-hoc 校验。

## Task C：给当前投影补充可验证 identity

- [ ] 盘点 current timeline payload、team snapshot、axis context 和其他 Workbench current reader 的生产与缓存位置。
- [ ] 每份 Workbench current projection 明确携带来源 `timelineId`，必要时带 checkout node/revision。
- [ ] `readDefCurrentTimelinePayloadSource()` 返回来源 identity，不再返回无法证明归属的裸 payload。
- [ ] `readDefWorkbenchAxisContext()` 使用 canonical context；所有调用方统一新合同。
- [ ] active timeline 切换时使旧 projection 失效，不能继续被迟到请求消费。
- [ ] 不把服务端 fallback id 包装成 projection identity。

## Task D：分类并收口 Workbench-scoped 工具

- [ ] 列出当前排轴、当前队伍、角色/全队配装、checkout、Work Node 和 mutation tools，标记为 Workbench-scoped。
- [ ] 列出 transcript/draft/question/permission 等 session-private 状态，确认按 session 隔离。
- [ ] 列出公开 catalog、静态游戏资料等 public/shared 资源，避免不必要地绑定 SQLite。
- [ ] Workbench-scoped read 与 mutation 在取数据前统一通过 current gate。
- [ ] `host=ai-cli` 或无 Workbench binding 的 session 调用 Workbench-scoped current 工具时稳定拒绝。
- [ ] shared knowledge 在无 Workbench binding 场景继续可用，防止权限收口扩大为全面禁用。

## Task E：修复 Work Node 的 source/target 串线

- [ ] fork target 继续从 session binding 解析，不接受调用参数覆盖。
- [ ] fork payload source 必须来自同一 gate 认证的 current projection。
- [ ] 明确断言 `source.timelineId = target.timelineId = binding.timelineId`。
- [ ] parent node 必须是同一 timeline 的当前 checkout，parent revision 参与 CAS。
- [ ] mismatch 时不创建 child、不写 payload、不移动 checkout、不留下 pending command。
- [ ] read/bind/validate/diff/use/restore/delete 同样确认节点属于 gate 认证的同一棵树。

## Task F：恢复单角色配装的新分支流程

- [ ] 修复单角色 operator config prepare/discard/apply 对 session/binding context 的传递。
- [ ] 合法调用不再因 axis context 为空误报 checkout changed。
- [ ] 从当前 checkout P 新建候选横向分支 C，不直接修改 P。
- [ ] C 只替换目标角色配置，其余队伍状态从 P 一致继承。
- [ ] validate/diff 展示 P -> C 的真实变化。
- [ ] permission 绑定 session、timeline、P id/revision、C id/revision/hash 和预期后置条件。
- [ ] apply 前重新跑 current gate 与 revision/CAS；批准后只 checkout 到已审阅 C。
- [ ] discard/reject/stale/mismatch 不改变 P 或 checkout。

## Task G：恢复全队配装的同树分支流程

- [ ] 修复 team loadout/plan 对 canonical axis context 的使用。
- [ ] 全队候选从当前 checkout P 新建一个明确的横向分支结果 C。
- [ ] 全队角色变化在同一候选结果中保持一致，不分散应用到 parent 或另一棵树。
- [ ] 若计算分多步，所有步骤固定使用同一 timeline、P revision 与 C identity。
- [ ] diff 和 permission 覆盖完整全队变化，不能只审阅局部后应用额外变化。
- [ ] apply、reject、stale 和 mismatch 使用与单角色相同的后置条件。

## Task H：闭合页面切换与 permission continuation

- [ ] 从正式 SQLite A 切到 B 时，确认前端卸载 A iframe 并恢复/创建 B 自己的 session。
- [ ] 后端对 A 的迟到 turn/tool/permission 重新跑 current gate，并因 active B != binding A 拒绝。
- [ ] prepare/discard/apply 私有 continuation 都携带原 session context，不从当前页面重新猜测。
- [ ] checkout、candidate 或 parent revision 变化时旧 permission 作废。
- [ ] 拒绝响应不泄漏 B 或其他 timeline 的 identity/content。

## Task I：处理 session create 的半成功状态

- [ ] 核对正式 SQLite 准入是否在 OpenCode session directory 创建前完成。
- [ ] 若创建顺序不能前移，在 binding/context 失败时只清理本次请求新建的未绑定 session 残留。
- [ ] 不删除或覆盖任何已有合法 session。
- [ ] 增加创建前后数量/目录断言，证明拒绝路径没有可恢复孤儿 session。

## Task J：定向自动验证

- [ ] A/A/A 正常：active A、projection A、binding A 的 read/fork/配装通过。
- [ ] A/B mismatch：binding A、projection B 的所有 Workbench-scoped read/mutation 拒绝，A/B 零变化。
- [ ] 复现并锁死“B payload fork 到 A node”。
- [ ] unbound AI CLI 读取当前 team/loadout/checkout 拒绝；public/shared knowledge 通过。
- [ ] 临时 SQLite 的 UI 与服务端准入拒绝且无 session/context 副作用。
- [ ] 单角色配装创建新分支，parent 不变；批准精确 checkout，拒绝零变化。
- [ ] 全队配装创建同树新分支，所有变化与审批内容一致。
- [ ] axis context 合法调用不再误报 checkout change，真实 revision 变化仍拒绝。
- [ ] A -> B 切换后，A 的迟到 permission 不作用于 B。
- [ ] session create/binding 失败不留下半绑定目录或可恢复 session。
- [ ] 运行既有 binding、REST、全量单测、typecheck 与 Harness package check，记录命令和结果。

权限与跨树问题需要自动合同覆盖；这属于本轮确实需要测试的高风险改动，不适用“默认不新增测试”的一般情形。

## Task K：Mac Desktop Interop 与真实 UI 黑盒

- [ ] 按 `docs/testing/def-agent-blackbox.md` 使用 Mac Desktop Interop Route 和 `DefCodexInteropProtocol v1`。
- [ ] 3030 未监听时可按项目约定启动 `npm run electron:dev`；已运行则不主动重启。
- [ ] 正式 A 中执行当前队伍读取，核对 UI、interop session、tool event 与 binding 均为 A。
- [ ] 在 A 中执行一次单角色或全队重新配装，确认 UI 出现新分支，旧 checkout 节点内容保留。
- [ ] 分别验证 permission reject 与 approve；approve 后 checkout 指向被审阅分支。
- [ ] 创建 pending permission 后切换到 B，确认 A 的操作不能在 B 恢复。
- [ ] 临时 SQLite 点击 AI 模式时确认可见拒绝，且没有 create/recover/context 请求。
- [ ] 每个 turn 保存 prompt、session id、tool calls、question/permission、timeline/checkout 前后值与最终判断。

## Task L：Harness candidate 与 promotion 决策

- [ ] runtime 修复完成后，从当前 stable/candidate 规则创建新的完整八 Slot candidate，不原地修改 immutable candidate。
- [ ] Harness 只教学“确认当前正式 SQLite”“会话不漂移”“重新配装建新分支”，不声称替代 runtime gate。
- [ ] 增加 A/B mismatch、unbound current read、stale permission、single/team branch 的 FAIL_TO_PASS 与 PASS_TO_PASS scenarios。
- [ ] baseline/candidate 使用新 native session，不复用 session id。
- [ ] package check、native regression、真实 UI evidence 与 promotion decision artifact 完整关联。
- [ ] 不自动 promotion；由人工 reviewer 决定 promote/reject。

## 完成检查

- [ ] Spec 8-2-1 每项验收标准都有代码、自动合同或 UI/Interop evidence。
- [ ] 没有把统一 current projection 错误改造成“每个工具各读一套 SQLite”。
- [ ] 没有扩大 DEF 的 workspace/archive create、temporary promote 或 session rebind 权限。
- [ ] 没有把 public/shared knowledge 错误封锁到 Workbench binding 内。
- [ ] 没有修改用户手动配装流程、vendor OpenCode、真实 transcript/runtime session 或无关 sharedata。
- [ ] candidate 未经人工审阅不 promotion。
- [ ] 返修完成后按仓库规则自动提交。

## 完成定义

当 active Workbench、current projection 与 session binding 在所有 Workbench AI 执行点具有同一可验证 identity，跨 timeline 或无绑定访问全部零变化拒绝，单角色与全队重新配装都在当前 checkout 下新建同树分支并通过精确审批，且自动合同、Mac Desktop Interop/UI 与 Harness regression 均有证据，本任务完成。
