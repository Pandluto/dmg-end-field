# Buff 交互系统模板

这份文档是给“新页面直接照搬”用的最小模板。

配套详解：

- [buff-interaction-system.md](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/docs/reference/buff-interaction-system.md)

## 一、必须保留的原则

1. 业务 key 必须稳定，不依赖渲染顺序。
2. 删除不弹 `confirm`，统一走“先快照，后删除”。
3. 保存后必须恢复选中行。
4. 保存后如果有输入框焦点，必须恢复焦点和光标。
5. 视图状态和业务状态分离，不把折叠/菜单/UI 态塞进业务数据。

## 二、页面最小状态清单

编辑器页至少要有：

```ts
const [draft, setDraft] = useState<BuffDraft>(...)
const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
const [selectedEffectKey, setSelectedEffectKey] = useState<string | null>(null)
const [undoSnapshots, setUndoSnapshots] = useState<BuffUndoSnapshot[]>([])
const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false)
```

表格页至少要有：

```ts
const [draft, setDraft] = useState<BuffDraft>(...)
const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<BuffWorkbookSelection | null>(null)
const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null)
const [undoSnapshots, setUndoSnapshots] = useState<BuffUndoSnapshot[]>([])
const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false)
```

如果有资源树，还要有：

```ts
const [collapsedDraftIds, setCollapsedDraftIds] = useState<Record<string, boolean>>({})
const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({})
```

## 三、key 规则模板

```ts
const groupRowKey = `group-${draft.id}`
const itemRowKey = `item-${itemKey}`
const effectRowKey = `effect-${itemKey}-${effectKey}`
```

不要改成随机 key，不要改成数组 index。

## 四、撤回快照模板

```ts
interface BuffUndoSnapshot {
  id: string
  createdAt: number
  label: string
  selectedDraftId?: string
  draftState?: BuffDraft
  selectedItemKey?: string | null
  selectedEffectKey?: string | null
  localEntries: Array<[string, string | null]>
}
```

## 五、撤回工具函数模板

```ts
function formatBuffUndoLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`
}

function readBuffUndoSnapshots(): BuffUndoSnapshot[] {
  // 从 localStorage 读取
}

function writeBuffUndoSnapshots(snapshots: BuffUndoSnapshot[]): void {
  // 写入 localStorage
}

function captureBuffUndoSnapshot(label: string, options?: {
  selectedDraftId?: string
  draftState?: BuffDraft
  selectedItemKey?: string | null
  selectedEffectKey?: string | null
}): void {
  // 先保存快照，再允许修改
}

function restoreBuffUndoSnapshot(snapshotId: string): BuffUndoSnapshot | null {
  // 恢复快照并从撤回列表中移除
}
```

## 六、withUndo 模板

所有 destructive 操作统一包这一层：

```ts
const withUndo = useCallback((label: string, fn: () => void) => {
  captureBuffUndoSnapshot(label, {
    selectedDraftId: selectedLocalDraftId || draft.id || undefined,
    draftState: draft,
    selectedItemKey,
    selectedEffectKey,
  })
  fn()
  setUndoSnapshots(readBuffUndoSnapshots())
}, [draft, selectedEffectKey, selectedItemKey, selectedLocalDraftId])
```

表格页如果不需要保留未保存草稿，可以只存：

```ts
captureBuffUndoSnapshot(label, {
  selectedDraftId: selectedLocalDraftId || draft.id || undefined,
})
```

## 七、删除操作模板

### 删除项

```ts
const handleDeleteItem = () => {
  if (!selectedItemKey) {
    return
  }

  withUndo(`删除自定义项 · ${selectedItemKey}`, () => {
    const nextDraft = cloneValue(draft)
    delete nextDraft.items[selectedItemKey]
    const nextItemKey = Object.keys(nextDraft.items)[0] ?? null
    const nextEffectKey = nextItemKey
      ? Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null
      : null

    setDraft(nextDraft)
    setSelectedItemKey(nextItemKey)
    setSelectedEffectKey(nextEffectKey)
  })
}
```

### 删除效果

```ts
const handleDeleteEffect = () => {
  if (!selectedItemKey || !selectedEffectKey) {
    return
  }

  withUndo(`删除 Buff 效果 · ${selectedEffectKey}`, () => {
    const nextDraft = cloneValue(draft)
    delete nextDraft.items[selectedItemKey].effects[selectedEffectKey]
    const nextEffectKey = Object.keys(nextDraft.items[selectedItemKey].effects)[0] ?? null

    setDraft(nextDraft)
    setSelectedEffectKey(nextEffectKey)
  })
}
```

### 删除组

```ts
const handleDeleteDraft = (draftId: string) => {
  withUndo(`删除本地组 · ${draftId}`, () => {
    const nextLibrary = cloneValue(localLibrary)
    delete nextLibrary[draftId]
    // 然后重置当前 draft / 当前选中项 / 当前焦点
  })
}
```

## 八、保存后恢复焦点模板

### 1. 表格选中恢复

```ts
const handleSaveDraft = useCallback(() => {
  persistDraftToLibrary(
    !isOverwriteProtectionEnabled,
    selectedWorkbookCell?.sourceRowKey ?? null,
  )
}, [isOverwriteProtectionEnabled, persistDraftToLibrary, selectedWorkbookCell])
```

### 2. 持久化时不要覆盖焦点

```ts
const persistDraftToLibrary = useCallback((allowOverwrite: boolean, focusRowKey?: string | null) => {
  // ...
  setPendingFocusRowKey(focusRowKey ?? `group-${nextDraftId}`)
}, [...])
```

### 3. 重建表格后恢复

```ts
useEffect(() => {
  if (pendingFocusRowKey) {
    // 按 rowKey 找回单元格
    // 找到后 setSelectedWorkbookCell(...)
    // 再 setPendingFocusRowKey(null)
  }
}, [pendingFocusRowKey, workbookRows])
```

## 九、公式栏焦点恢复模板

### 1. 给输入控件打标记

```tsx
<input data-formula-focus-id="effect-value" ... />
<select data-formula-focus-id="effect-kind" ... />
```

### 2. 保存前记录焦点

```ts
const activeElement = document.activeElement
const formulaField = activeElement instanceof HTMLElement
  ? activeElement.closest<HTMLElement>('[data-formula-focus-id]')
  : null
```

### 3. 渲染后恢复

```ts
useLayoutEffect(() => {
  const target = formulaBarRef.current?.querySelector<HTMLElement>(
    `[data-formula-focus-id="${snapshot.focusId}"]`,
  )
  target?.focus()
}, [formulaFocusRestoreToken])
```

## 十、撤回菜单模板

编辑器页和表格页都可以直接复用这个结构：

```tsx
<div className="damage-sheet-undo-wrap">
  <button
    type="button"
    className="damage-sheet-action-button"
    onClick={() => setIsUndoMenuOpen((open) => !open)}
    disabled={undoSnapshots.length === 0}
  >
    撤回
  </button>
  {isUndoMenuOpen && undoSnapshots.length > 0 ? (
    <div className="damage-sheet-undo-menu">
      {undoSnapshots.map((snapshot) => (
        <button
          key={snapshot.id}
          type="button"
          className="damage-sheet-undo-item"
          onClick={() => handleRestoreUndoSnapshot(snapshot.id)}
        >
          <strong>{formatBuffUndoLabel(snapshot.createdAt)}</strong>
          <span>{snapshot.label}</span>
        </button>
      ))}
    </div>
  ) : null}
</div>
```

## 十一、操作后落点规则

直接照搬：

- 新建组：`group-${nextDraftId}`
- 新建项：`item-${nextItemKey}`
- 新建效果：`effect-${itemKey}-${nextEffectKey}`
- 删除效果：优先下一个效果，否则回项
- 删除项：优先下一个项，否则回组
- 删除组：优先剩余组，否则新建空组

## 十二、开发检查清单

新页面做完后，至少手测这几项：

1. 在输入框中编辑时按 `Ctrl+S`，高亮不跳首格。
2. 在输入框中编辑时按 `Ctrl+S`，光标还在原位置。
3. 删除组、项、效果时没有 `confirm`。
4. 删除后“撤回”菜单能看到时间戳记录。
5. 撤回后数据和焦点都正确恢复。
6. 连续删除 2 到 3 次后，能按时间顺序恢复。
7. 新建、复制、删除后，当前选中节点总是合理。

## 十三、禁止事项

不要这样做：

- 用数组 index 当业务 key
- 删除后直接 `alert` / `confirm`
- 保存后只按 Excel 地址恢复选中格
- 把折叠状态写进业务数据
- 在 JSX 里散落多套删除逻辑，不走 `withUndo`

## 十四、最短迁移步骤

如果你以后只想最快复制，按这个顺序：

1. 复制撤回快照类型和工具函数
2. 复制 `withUndo`
3. 把删除入口全部改成 `withUndo`
4. 接入撤回菜单
5. 接入 `pendingFocusRowKey`
6. 接入公式栏 `data-formula-focus-id`
7. 测 `Ctrl+S`、删除、撤回

做到这 7 步，基本就能把这套交互原样带走。
