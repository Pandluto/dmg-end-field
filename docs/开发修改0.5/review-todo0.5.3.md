# review-todo0.5.3

## [任务理解]

本轮进入 0.5 第三步：Buff 交互层分离。

目标是把 `DamageTab.tsx` 中的候选 Buff 加载、搜索、单击添加、双击详情、长按拖拽、释放判定、添加入口组装等逻辑拆到独立 hook / domain 边界中，让 `DamageTab.tsx` 只保留渲染和少量入口组装。

本轮必须同步处理 `问题遗留0.5.1.md` 中的 candidate 类型边界问题：候选 Buff 不得再强转为 `SkillButtonBuff[]`。

## [当前结论]

- 0.5.1 数据层与事件层主链路已可用。
- 0.5.2 计算层抽离已完成，手测无公式回归。
- 0.5.3 会触碰 `DamageTab.tsx`、candidate Buff、交互状态，因此必须同时收口 candidate 类型边界。

## [必须改]

### 1. 新增候选 Buff 专用类型

Trae 执行：

- 新建或复用类型文件：
  - 推荐：`src/core/domain/buff.ts`
  - 可选：`src/types/buff.ts`
- 定义候选 Buff 类型，例如：

```ts
export interface CandidateBuff {
  displayName: string;
  name: string;
  level: string;
  value?: number;
  type?: string;
  source: string;
  sourceName: string;
  description: string;
  condition?: string;
}
```

约束：

- `CandidateBuff` 不要求稳定 `id`。
- `CandidateBuff` 不等同于 `SkillButtonBuff`。
- `SkillButtonBuff` 只代表已选 Buff 实体，属于 `def.all-buff-list.v1`。
- 候选 Buff 只属于 `def.candidate-buff-list.v1`。

### 2. 修正 candidateBuffRepository 类型边界

Trae 执行：

- 修改 `src/core/repositories/candidateBuffRepository.ts`。
- 将 `getCandidateBuffList()` 返回类型改为 `CandidateBuff[]`。
- 将 `setCandidateBuffList(list)` 入参类型改为 `CandidateBuff[]`。
- 移除对 `SkillButtonBuff` 的依赖。

约束：

- 不改 storage key。
- 仍只读写 `STORAGE_KEYS.CANDIDATE_BUFF_LIST`。
- 不允许触碰 `STORAGE_KEYS.ALL_BUFF_LIST`。
- 不允许在 repository 内把 candidate 转成 selected entity。

### 3. 新建 useCandidateBuffs.ts

Trae 执行：

- 新建 `src/hooks/useCandidateBuffs.ts`。
- 从 `DamageTab.tsx` 迁移以下逻辑：
  - `loadBuffFile`
  - `loadAllBuffs`
  - `handleRefresh`
  - `buffList` state
  - `searchKeyword` state
  - `buffSearchIndex`
  - `matchedSources`
  - `matchedBuffs`

Hook 对外至少返回：

```ts
{
  buffList,
  searchKeyword,
  setSearchKeyword,
  matchedSources,
  matchedBuffs,
  isLoading,
  handleRefresh
}
```

约束：

- `useCandidateBuffs.ts` 只处理候选 Buff。
- `useCandidateBuffs.ts` 不处理已选 Buff 添加。
- `useCandidateBuffs.ts` 不访问 `def.all-buff-list.v1`。
- 刷新候选 Buff 后只能调用 `setCandidateBuffList(buffs)`。
- 不允许出现 `as unknown as SkillButtonBuff[]`。

### 4. 新建 useBuffInteraction.ts

Trae 执行：

- 新建 `src/hooks/useBuffInteraction.ts`。
- 从 `DamageTab.tsx` 迁移以下交互逻辑：
  - 单击/双击判定。
  - 长按准备状态。
  - `isDragging`。
  - `draggedBuff`。
  - `dragPosition`。
  - `handleBuffClick`。
  - `handleBuffMouseDown`。
  - `handleMouseMove`。
  - `handleMouseUp`。
  - `clearDragState`。

Hook 参数建议：

```ts
useBuffInteraction({
  onAddBuff,
  onOpenBuffDetail,
  isPointInDropZone
})
```

约束：

- `useBuffInteraction.ts` 不写 storage。
- `useBuffInteraction.ts` 不调用 `addSkillButtonBuff`。
- `useBuffInteraction.ts` 不派发 Buff added event。
- 单击添加、搜索结果点击添加、拖拽释放添加，最终必须走同一个 `onAddBuff(buff)`。
- 双击只打开详情，不得误触发添加。

### 5. 收口 DamageTab.tsx 添加入口

Trae 执行：

- 修改 `src/components/SidePanel/components/DamageTab.tsx`。
- 保留唯一添加入口，例如：

```ts
const handleAddCandidateBuff = useCallback((buff: CandidateBuff) => {
  // getSelectedSkillButton
  // CandidateBuff -> SkillButtonBuff
  // addSkillButtonBuff
  // emitSkillButtonBuffAdded
}, []);
```

该入口负责：

- 获取当前 selected skill button id。
- 将 `CandidateBuff` 转成 `SkillButtonBuff`。
- 调用 `addSkillButtonBuff()` 或 `buffService.addBuffToButton()`。
- 成功后调用 `emitSkillButtonBuffAdded()`。

约束：

- `DamageTab.tsx` 不再直接维护完整候选加载逻辑。
- `DamageTab.tsx` 不再直接维护完整拖拽状态机。
- `DamageTab.tsx` 不再出现 `as unknown as SkillButtonBuff[]`。
- 不允许出现第二套添加逻辑。

### 6. 明确 drop zone 判定

Trae 执行：

- 保留当前 `.skill-button-modal` 作为拖拽释放命中区域。
- 将落点判断封装为函数，例如：

```ts
function isPointInSkillButtonModal(x: number, y: number): boolean
```

约束：

- 本轮不重做 drop zone。
- 不引入 HTML5 Drag and Drop API。
- 不改为 Pointer Events。
- 不改 UI 样式。

### 7. 复查 events 层使用

Trae 执行：

- 确认 `DamageTab.tsx` 使用 `emitSkillButtonBuffAdded()`。
- 确认 `SkillButton.tsx` 使用 `emitSkillButtonBuffRemoved()` 和 `onSkillButtonBuffAdded()`。
- 确认 `CanvasBoard/index.tsx` 使用 `onSkillButtonBuffAdded()` / `onSkillButtonBuffRemoved()`。

约束：

- 组件中不得手写 `'skillbutton-buff-added'`。
- 组件中不得手写 `'skillbutton-buff-removed'`。
- 如果 0.5.1 已完成此项，本轮只复查，不重复大改。

## [可选优化]

以下内容可做，但不得影响主线交付：

- 将 `CandidateBuff -> SkillButtonBuff` 转换抽成纯函数，例如 `toSkillButtonBuff(candidateBuff)`。
- 给 `useBuffInteraction()` 拆出少量纯函数，例如 `isDoubleClick()`、`isDragThresholdExceeded()`。
- 给 `useCandidateBuffs()` 返回 `refreshError`，但不要改 UI。

## [不要动]

本轮禁止：

- 不要改 `def.skill-button.v1` 结构。
- 不要改 `def.all-buff-list.v1` 结构。
- 不要改 `def.candidate-buff-list.v1` 结构。
- 不要把候选 Buff 写入 `def.all-buff-list.v1`。
- 不要恢复 `timelineData.buffIds -> selectedBuff` 写回链路。
- 不要改 Buff 去重规则。
- 不要改 Buff id 生成规则。
- 不要改 `clearBuffs()`、`removeSkillButton()` 的清理顺序。
- 不要改 0.5.2 calculator。
- 不要改伤害公式。
- 不要拆 `OperatorConfigPanel.tsx`。
- 不要改 CSS。
- 不要引入 Redux、Zustand、React Query 或其他状态库。

## [验收标准 AC]

1. `src/core/domain/buff.ts` 或等效类型文件存在，并定义 `CandidateBuff`。
2. `candidateBuffRepository` 使用 `CandidateBuff[]`，不再依赖 `SkillButtonBuff[]`。
3. `DamageTab.tsx` 中不存在 `as unknown as SkillButtonBuff[]`。
4. `src/hooks/useCandidateBuffs.ts` 存在，并承接候选 Buff 加载、刷新、搜索匹配逻辑。
5. `src/hooks/useBuffInteraction.ts` 存在，并承接单击、双击、长按拖拽、释放判定逻辑。
6. `DamageTab.tsx` 不再直接维护完整候选 Buff 加载逻辑。
7. `DamageTab.tsx` 不再直接维护完整拖拽状态机。
8. 单击候选 Buff、搜索抽屉点击 Buff、拖拽释放 Buff 三条路径最终都调用同一个添加入口。
9. 候选 Buff 刷新只写 `def.candidate-buff-list.v1`。
10. `def.all-buff-list.v1` 仍只保存已选 Buff 实体。
11. `npm run build` 必须通过。

## [回归检查项]

Trae 必须手测以下路径：

1. 点击刷新后，候选 Buff 列表正常加载。
2. 搜索关键字后，搜索抽屉匹配结果正常。
3. 单击候选 Buff，可以添加到当前打开的技能按钮。
4. 单击搜索抽屉中的 Buff，可以添加到当前打开的技能按钮。
5. 双击候选 Buff，只打开详情弹窗，不误添加。
6. 长按拖拽候选 Buff 到 `.skill-button-modal` 内释放，可以添加到当前技能按钮。
7. 长按拖拽候选 Buff 到 `.skill-button-modal` 外释放，不添加。
8. 已选 Buff 已有 1 条时，再添加第 2 条，关闭技能按钮后重新打开，两条都存在。
9. 删除已选 Buff 后，SkillButton 弹窗列表刷新。
10. 刷新候选 Buff 后，`def.all-buff-list.v1` 中已选 Buff 实体不丢失。
11. 检查 `def.candidate-buff-list.v1`：只包含候选 Buff 数据。
12. 检查 `def.all-buff-list.v1`：只包含已选 Buff 实体，且 id 与 `skill-button.selectedBuff` 对应。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 先定义 `CandidateBuff` 类型。
2. 修改 `candidateBuffRepository`，移除 `SkillButtonBuff[]` 和强转依赖。
3. 从 `DamageTab.tsx` 提取候选 Buff 数据逻辑到 `useCandidateBuffs.ts`。
4. 从 `DamageTab.tsx` 提取点击、双击、拖拽逻辑到 `useBuffInteraction.ts`。
5. 在 `DamageTab.tsx` 保留唯一 `handleAddCandidateBuff()`，所有添加路径都调用它。
6. 复查 events 层调用，禁止手写 Buff event 字符串。
7. 跑 `npm run build`。
8. 按回归检查项手测。

本轮交付标准：Buff 候选区交互从 `DamageTab.tsx` 中分离出来，candidate 与 selected entity 类型边界收口，单击、搜索点击、拖拽释放三条添加路径保持一致，已选 Buff 缓存链路不回退。

