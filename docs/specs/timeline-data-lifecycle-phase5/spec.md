# Timeline 数据生命周期

状态：已实现。本文只保留 1.8 Web LTS 仍需遵守的业务合同。

## 目标

浏览器 SQLite 是排轴数据的唯一事实来源。每份排轴以稳定的
`timelineId` 归属文档、恢复快照、工作节点、当前应用目标和审计记录。
浏览器缓存、官方资料包与界面状态都不是排轴版本事实。

## 数据模型

```text
TimelineDocument
├─ TimelineSnapshot[]   用户保存的不可变恢复点
├─ WorkNode[]           人工或自动操作形成的分支节点
├─ CheckoutRef          当前已应用目标
└─ AuditEvent[]         保存、应用、恢复与删除证据
```

- `TimelineDocument` 是可独立编辑、恢复和导出的工作区；
- `TimelineSnapshot` 保存完整 payload 的内容哈希引用，可去重和独立恢复；
- `WorkNode` 保存基线、工作 payload、Patch、Diff、验证与风险信息；
- `CheckoutRef` 每份文档唯一，只能指向该文档的快照或工作节点；
- `AuditEvent` 记录状态变化，不伪装成树节点。

`timelineId` 是唯一文档身份。新代码和新数据不得重新引入 `saveId`。

## 写入与恢复

所有关系写入都在 SQLite WASM Worker 的单一事务中完成：

- 保存快照只创建或复用 `TimelineSnapshot`，不创建工作节点；
- 保存工作节点在当前文档树中创建首节点或子节点；
- checkout 原子更新目标、应用 payload 并写审计；
- 恢复快照不经过工作节点；
- 删除必须检查引用与当前路径，冲突以结构化业务错误返回；
- 多份文档的树、当前目标和删除权限互不影响。

同一 origin 只允许一个标签页持有写连接。其他标签页显示占用状态，用户显式
接管后才可写入，避免同时操作 OPFS 数据库。

## 导出与导入

`dmg.timeline-bundle.v2` 是排轴分享格式，支持快照、工作树和完整文档范围。
导出包包含版本、范围、payload 哈希和必要关系；不包含站点密码、浏览器设置、
缓存、机器路径或无关界面状态。

导入必须先验证 schema、哈希与引用，再以单一事务创建新文档；默认不覆盖
现有文档。完整浏览器备份使用设置页导出的 SQLite 文件，不与分享包混用。

## 非目标

- 不读取或迁移旧桌面 SQLite、AppData、REST 或 Electron bridge；
- 不把 `localStorage`、Cache Storage 或 JSON 导出当作版本数据库；
- 不做账号、云同步、多用户协作或 CRDT；
- 不保存 hover、拖拽位置等临时界面状态；
- 不允许业务组件绕过 repository 直接写数据库。

## 验收标准

1. 首次保存可命名文档，并在开始页回显；
2. 快照保存/恢复与工作节点树互不混淆；
3. 工作节点写入、checkout、删除与审计保持同一 `timelineId`；
4. 页面刷新后可从浏览器 SQLite 恢复文档、当前目标和节点树；
5. Bundle V2 可校验并导入为新文档；
6. 第二标签页不能并发写入，显式接管后原标签页失去写权。
