# Buff 交互系统复用说明

本文总结当前 `BuffDraftPage` 和 `sheet-buff` 页面已经跑通的一整套交互系统，目标不是解释业务，而是方便以后原样照搬。

主要实现文件：

- [src/components/BuffDraftPage.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/BuffDraftPage.tsx)
- [src/components/BuffDraftPage.css](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/BuffDraftPage.css)
- [src/components/OperatorDraftPage.css](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/OperatorDraftPage.css)
- [src/components/DamageSheetPage.css](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/DamageSheetPage.css)

## 目标

这套系统解决的是 4 个问题：

1. 用同一份数据同时支持“编辑器视图”和“表格视图”。
2. 删除不弹确认框，但仍然安全可撤回。
3. `Ctrl+S` 保存后，表格选中格和公式栏焦点不乱跳。
4. 新增、复制、删除、拖拽之后，界面焦点始终落在“用户下一步最可能继续操作”的位置。

## 页面分工

### 1. Buff 编辑器页

入口组件：

- `export function BuffDraftPage()`

页面结构：

- 左侧命令区：导出、分享、切换到 `Sheet-Buff`
- 中左基础信息区：组名称、组 ID、描述、保存/另存/整理
- 中间主列表区：自定义项列表
- 右侧详情区：当前项与当前效果的字段编辑
- 右下操作记录区：日志 + 撤回菜单

特点：

- 适合连续编辑字段
- 适合维护未保存草稿
- 删除撤回不仅依赖 `localStorage`，还会保留当前内存草稿态

### 2. Sheet-Buff 表格页

入口组件：

- `export function BuffDraftSheetPage()`

页面结构：

- 顶部工具条：返回、刷新本地库、撤回
- Ribbon：新建、保存、整理、保护开关、导入导出
- 左侧资源管理器：组 / 项 / 效果树
- 中间 Excel 风格工作表
- 顶部公式栏：当前格子的字段编辑器
- 右键菜单：围绕组/项/效果的上下文操作

特点：

- 适合结构整理
- 适合拖拽顺序调整
- 适合用 Excel 心智操作 Buff 数据

## 核心数据模型

基础层级固定为三层：

1. `BuffDraft`
2. `BuffItemDraft`
3. `BuffEffectDraft`

关键约束：

- 组 key：`group-${draft.id}`
- 项 key：`item-${itemKey}`
- 效果 key：`effect-${itemKey}-${effectKey}`

这个 key 规则非常重要，因为表格选中恢复、资源树焦点恢复、右键菜单上下文都依赖它。

## 状态设计

### 编辑器页状态

最关键的状态是：

- `draft`
- `selectedLocalDraftId`
- `selectedItemKey`
- `selectedEffectKey`
- `messages`
- `undoSnapshots`
- `isUndoMenuOpen`

设计原则：

- `draft` 代表当前正在编辑的工作副本
- `selectedItemKey` / `selectedEffectKey` 永远只指向当前 `draft` 内存在的节点
- 当节点被删除时，立刻重选相邻或首个可用节点

### 表格页状态

最关键的状态是：

- `draft`
- `localLibrary`
- `selectedLocalDraftId`
- `selectedWorkbookCell`
- `pendingFocusRowKey`
- `collapsedDraftIds`
- `collapsedItems`
- `undoSnapshots`
- `isUndoMenuOpen`

设计原则：

- `selectedWorkbookCell` 是“当前选中的格子”
- `pendingFocusRowKey` 是“下一次重建表格后应该落回哪一行”
- 折叠状态和选中状态分离，不要混在同一个对象里

## 保存与选中恢复

这是这套交互最关键的稳定性设计。

### 1. 不靠纯地址恢复

不要只保存 `A3`、`B7` 这种 Excel 地址。

正确做法：

- 首选 `sourceRowKey + columnKey`
- 地址只做兜底

原因：

- 保存后工作表可能重建
- 重建后单元格地址可能变化
- 但业务行 key 通常是稳定的

### 2. 保存前显式记录焦点目标

表格页保存时：

- `handleSaveDraft`
- `persistDraftToLibrary`

做法：

- 保存前先拿当前 `selectedWorkbookCell?.sourceRowKey`
- 把它传给 `persistDraftToLibrary(..., focusRowKey)`
- 保存完成后通过 `pendingFocusRowKey` 恢复

如果内部无条件改成 `group-${nextDraftId}`，就会退回 `A3`。之前踩过这个坑，后续不要再回退。

### 3. 公式栏焦点恢复

表格页除了恢复“高亮格”，还需要恢复“DOM 输入焦点”。

当前做法：

- 给公式栏里的每个输入控件加 `data-formula-focus-id`
- 保存前记录当前激活控件和光标位置
- 重渲染后在 `useLayoutEffect` 里重新 `focus()`
- 对 input 再恢复 `selectionStart` / `selectionEnd`

相关点：

- `FormulaFocusSnapshot`
- `formulaBarRef`
- `pendingFormulaFocusRef`
- `formulaFocusRestoreToken`

## 删除与撤回机制

### 1. 不再使用 confirm

当前原则：

- 删除立即生效
- 不弹浏览器 `confirm`
- 通过时间戳撤回补安全性

这样交互更顺，不会打断编辑节奏。

### 2. 撤回快照统一结构

当前共用：

- `BUFF_UNDO_STORAGE_KEY`
- `BUFF_UNDO_LIMIT`
- `BuffUndoSnapshot`
- `formatBuffUndoLabel`
- `readBuffUndoSnapshots`
- `writeBuffUndoSnapshots`
- `captureBuffUndoSnapshot`
- `restoreBuffUndoSnapshot`

时间戳策略：

- `id = ${Date.now()}-${random}`
- `createdAt = Date.now()`
- UI 中显示到毫秒

### 3. 编辑器页为什么要额外存内存态

编辑器页有未保存草稿场景，所以只存 `localStorage` 不够。

当前额外保存：

- `draftState`
- `selectedItemKey`
- `selectedEffectKey`

这保证了：

- 删掉尚未保存的项，也能撤回
- 撤回后还能回到原来的项/效果焦点

### 4. 表格页为什么只需要本地存储快照

表格页的删除路径都围绕本地库操作：

- 删组
- 删项
- 删效果

因此表格页撤回主要依赖：

- `BUFF_DRAFT_STORAGE_KEY`
- `BUFF_LIBRARY_STORAGE_KEY`

再配合 `selectedDraftId` 和 `pendingFocusRowKey` 恢复落点。

### 5. withUndo 模式

所有 destructive 操作都应包在：

```ts
withUndo(label, () => {
  // 真正修改数据
})
```

不要写成：

1. 先删
2. 再想办法补快照

顺序必须是“先快照，再修改”。

## 焦点与落点规则

这套系统在每种操作后，都有明确的“下一个焦点该落哪里”规则。

### 新建

- 新建组：落到 `group-${nextDraftId}`
- 新建项：落到 `item-${nextItemKey}`
- 新建效果：落到 `effect-${itemKey}-${nextEffectKey}`

### 复制

- 复制项：落到新项
- 复制效果：落到新效果

### 删除

- 删除效果：优先落到同项下一个效果，否则落回该项
- 删除项：优先落到下一个项，否则落回组
- 删除组：优先落到剩余组首项，否则新建空组

### 整理

- 整理后落到组首或当前组
- 不要整理完回到默认空状态

## 折叠与资源树规则

表格页资源管理器当前遵循：

- 组折叠状态：`collapsedDraftIds`
- 项折叠状态：`collapsedItems`
- 两者独立维护

不要把折叠状态绑进业务数据对象里，原因：

- 会污染存储结构
- 会让导入导出带上 UI 噪音
- 会让视图态和业务态混在一起

## 右键菜单规则

右键菜单统一走上下文状态：

- `BuffSheetContextMenuState`
- `BuffSheetContextMenuAction`

目标分类固定为：

- `blank`
- `draft`
- `item`
- `effect`

推荐做法：

- 先构建 `currentContextMenuActions`
- 再统一渲染菜单

不要在 JSX 里堆很多 `contextMenu.target === ... ? ... : null` 的分支按钮，这样很快会失控。

## UI 原则

这套界面当前用户已经认可，后续修改默认遵守这些边界。

### 保持不变

- 顶部工具条布局
- Excel 风格工作表表现
- 左侧资源树结构
- 右侧/顶部属性编辑模式
- 现有按钮层级和轻量按钮风格

### 可以继续扩展

- 增加更多撤回快照类型
- 扩展右键菜单动作
- 增加更多公式栏编辑控件
- 增加更多日志信息

### 尽量不要做

- 不要重做整页布局
- 不要把轻量按钮改成大块卡片按钮
- 不要把删除安全性重新改回 `confirm`
- 不要引入需要多次确认的重流程

## 复制到新页面时的最小清单

如果以后要在别的页面复用这套交互，至少照搬下面这些点。

### 必备状态

- 当前工作副本
- 当前选中节点 key
- 当前表格选中单元格
- `pendingFocusRowKey`
- `undoSnapshots`
- `isUndoMenuOpen`

### 必备工具函数

- 时间戳格式化
- 读取/写入撤回快照
- `withUndo`
- 表格选中恢复函数
- 焦点恢复函数

### 必备交互

- 删除立即执行
- 删除后可撤回
- 保存后恢复选中行
- 保存后恢复输入焦点
- 新增/复制/删除后落到合理节点

## 推荐实现顺序

以后新做类似页面，建议按这个顺序搭：

1. 先把三层数据模型和 key 规则固定
2. 再实现编辑器页的选中关系
3. 再实现表格页的行映射
4. 再接 `pendingFocusRowKey`
5. 再接公式栏焦点恢复
6. 最后把所有删除动作包进 `withUndo`

这个顺序最稳。反过来做，后面通常会返工。

## 当前已验证的行为

- `Ctrl+S` 不再把表格高亮强制跳回 `A3`
- 删除本地组/项/效果不再弹确认框
- 编辑器页和表格页都能按时间戳撤回
- 表格页右键删除后仍能回到合理焦点
- 编辑器页删除未保存内容后也能撤回

## 后续扩展建议

如果以后还要增强，可以继续沿这条线加：

1. 给撤回菜单加 hover 预览摘要
2. 给日志也升级成结构化记录，而不是纯字符串
3. 给撤回快照加操作类别，例如 `delete-item` / `delete-effect`
4. 给表格页加入“重做”能力，但前提仍是保持当前 UI 框架不变

## 一句话原则

这套系统的核心不是“Excel 风格”本身，而是：

- 业务 key 稳定
- 焦点恢复明确
- 删除立即执行
- 撤回代替确认
- 视图状态和业务状态分离

以后照搬时，只要这五条不丢，交互就不会塌。
