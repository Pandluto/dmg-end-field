# Spec 5：排轴文档、恢复快照与 AI 工作树生命周期重构

## 目标

建立以本机 AppData 内 SQLite 为唯一事实来源的排轴数据模型，彻底分离：

- 当前排轴工作副本；
- 用户保存、恢复和分享用的快照；
- AI 修改用的 Work Node 分支；
- 已应用目标与审计事件。

本阶段完成后，“保存快照”不会生成 Work Node 根节点；AI 的自然语言排轴修改可以先安全落到 Work Node，明确应用后才改变当前排轴；分享由本地原子数据组装为可移植文件，而不是复制本机存储。

## 背景与必须解决的问题

当前实现混用了 `saveId`、快照 id、Work Node tree 和全局 head：

- 用户快照存于浏览器存储并同步至 `now-storage.json`；
- Work Node 存于 `ai-timeline-worknodes.sqlite3`；
- 保存快照曾被转换成 Work Node，导致使用新的快照 id 建立独立树根；
- 同一 UI 同时渲染多个 `saveId` 的树，却只处理一个 `headNodeId`；
- 删除规则在服务端按每个 save 的 head 保护，前端却按全局路径判断，导致 500；
- 当前排轴、快照恢复、AI checkout 的语义在 UI 上混淆。

这些问题不能通过调整树布局、补 parent 或修改前端禁用条件解决，必须重建数据边界。

## 核心原则

1. SQLite 是正式事实来源；`localStorage`、`sessionStorage` 和 `now-storage.json` 只在迁移期承担兼容/缓存职责。
2. JSON 是导出和分享格式，不是运行时版本管理格式。
3. 用户快照不是 AI Work Node，不能作为 Work Node 根节点渲染。
4. AI 所有改变排轴的操作默认采用 Worktree-first：先写 `workingPayload`，明确应用后才写当前排轴。
5. “关闭窗口”永远不改变排轴；应用必须是明确的“应用”或“应用并关闭”操作。
6. 服务端是关系、当前应用目标和删除权限的唯一权威；前端不猜测 parent、head 或可删除性。
7. 本地化与可分享不矛盾：本地数据库保存原子对象，分享时按范围组装可移植包。

## 目标数据模型

```text
TimelineDocument
├─ TimelineSnapshot[]       用户恢复点
├─ WorkNode[]               AI 分支树
├─ CheckoutRef              当前已应用目标
└─ AuditEvent[]             变更、应用、恢复、删除证据
```

### 1. TimelineDocument

一份可独立编辑、恢复、分享的排轴文档。`timelineId` 是稳定 id，不能使用快照 id 或 Work Node id 代替。

### 2. TimelineSnapshot

用户点击保存生成的不可变恢复点。

- 归属一个 `timelineId`；
- 存储完整 payload 的内容哈希引用；
- 按 payload 内容哈希去重；
- 可直接恢复；
- 不出现在 AI Work Node 树中。

### 3. WorkNode

AI 修改草稿节点。

- 归属一个 `timelineId`；
- `parentNodeId` 只能指向同一 `timelineId` 的 Work Node；
- 有 `baseSnapshotRef`、`workingSnapshotRef`、Patch、Diff、验证和风险信息；
- 创建时为 draft，不自动成为当前应用目标；
- 只有明确 checkout 成功后才成为 `CheckoutRef` 指向的对象。

### 4. CheckoutRef

每个 `timelineId` 恰有一个当前应用目标：

```ts
type CheckoutRef =
  | { timelineId: string; targetType: 'snapshot'; targetId: string }
  | { timelineId: string; targetType: 'work-node'; targetId: string };
```

它取代当前按多个 `work_node_heads` 推断全局 active path 的做法。

### 5. AuditEvent

checkout、restore、验证、审批和删除是事件，不是树节点。树只表示 AI 草稿的父子分支关系。

## SQLite 设计

新增统一 Timeline Repository，建议表：

- `timeline_documents`
- `timeline_payload_blobs`：内容哈希去重的不可变完整 payload
- `timeline_snapshots`
- `work_nodes`
- `work_node_patches`
- `checkout_refs`
- `timeline_audit_events`
- `timeline_schema_meta`

完整 payload 作为不可变 blob 是可接受的；原子化指独立 id、哈希、关系和事务，而不是把每个字段拆成文件。需要检索的按钮/Buff 可另设投影索引表，不能把索引当事实来源。

## 生命周期

### 用户保存

```text
点击保存
→ 读取当前排轴
→ 内容哈希去重
→ 新建或复用 TimelineSnapshot
→ 更新恢复列表
→ 不创建 Work Node
```

### 用户恢复

```text
选择恢复快照
→ 确认
→ 原子更新 CheckoutRef(snapshot)
→ 应用 snapshot payload 到当前工作副本
→ 写入 restore 审计事件
```

### AI 修改

```text
用户自然话术
→ 解析目标
→ 创建/复用 Work Node
→ 受控 Patch 写入 workingPayload
→ validate + diff + risk
→ 当前排轴不变
→ 用户明确应用
→ CheckoutRef(work-node) + 当前排轴更新 + 审计事件
```

### 删除

- 删除快照：从恢复列表删除；被 Work Node 引用时转为归档或要求明确级联策略。
- 删除 Work Node：服务端计算子树；若目标包含当前 `CheckoutRef(work-node)`，返回结构化 `409`，不返回 500。
- 删除不影响其他 `timelineId`。

## 分享与导入

分享不复制本机 SQLite、AppData 或浏览器存储，而是生成版本化可移植包。

```ts
type TimelineBundleV2 = {
  type: 'dmg.timeline-bundle.v2';
  schemaVersion: 2;
  manifest: { exportedAt: string; scope: 'snapshot' | 'worktree' | 'document' };
  document: unknown;
  payloads: unknown[];
  snapshots?: unknown[];
  workNodes?: unknown[];
  patches?: unknown[];
  audit?: unknown[];
};
```

支持：

- 分享当前排轴：一个基线快照和引用数据；
- 分享 AI 分支：基线、选中 Work Node 子树、Patch、必要检查点；
- 完整备份：整份 TimelineDocument。

导入默认创建新的 TimelineDocument；先校验 schema、哈希和引用，再以单一事务落库。默认不覆盖现有文档。

## 基线 + Diff 策略

采用“不可变基线 + 受控 Patch + 定期检查点”，而不是纯长 Diff 链。

- 用户快照始终可独立恢复；
- AI 节点保存受 schema 约束的 Patch、base/working 哈希和 diff 摘要；
- 高风险操作、深层分支或达到阈值时落完整检查点；
- 重放前校验前置内容哈希，失败时不得静默应用。

## UI 规则

- “恢复排轴”面板只显示用户快照；
- “AI 工作树”只显示当前 TimelineDocument 的 Work Node；
- 两处均显示当前应用目标，但不混合列表；
- Work Node 详情提供 Diff、验证、风险、应用、恢复基线、删除；
- 关闭 Work Node 面板只关闭；快捷应用使用显式“应用并关闭”；
- 所有错误显示业务错误码、可读原因和建议动作。

## 迁移与回滚

1. 先备份现有 `now-storage.json`、现有 local/session archive 和 Work Node SQLite。
2. 导入当前恢复快照为 `TimelineSnapshot`。
3. 导入 `current-main-workbench` Work Node 为默认 TimelineDocument 的 AI 树。
4. 对 `saveId` 形如 `timeline-snapshot-*` 的错误 `[snapshot]` 节点生成迁移预览，默认不删除、不应用；由用户确认清理或归档。
5. 迁移在单一事务中执行，保留可回退的原始备份。
6. 迁移完成后，禁止新代码再写 `now-storage.json` 作为版本事实来源。

## 非目标

- 不做云同步、多用户协作、CRDT 或远程数据库；
- 不允许 AI 直接读写 SQLite 或浏览器存储；
- 不把 UI 视图状态、hover、拖拽位置写入版本数据库；
- 不将 JSON 导出文件作为应用运行时数据库；
- 不在本阶段通过 UI 样式补丁掩盖数据模型问题。

## 验收标准

1. 点击保存只生成/复用恢复快照，不生成 Work Node。
2. 进入 AI 模式零写入。
3. 一句自然话术触发 AI 排轴修改时，变化先只出现在 Work Node 的 `workingPayload`。
4. 明确应用后，当前排轴与目标 Work Node 一致；未应用前当前排轴哈希不变。
5. 快照恢复可独立工作，不经过 Work Node。
6. 多份 TimelineDocument 的树、当前应用目标与删除权限互不干扰。
7. 不可删除的节点返回 `409` 及业务原因，不再出现 500。
8. 分享包可在另一份本地库中导入为新文档，并通过哈希校验。
