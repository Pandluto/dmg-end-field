# review-todo0.5.13

## 任务主题

右键菜单 `编辑 > A / B / E / Q` 已触发点击，但**没有完成系统链路闭环**：

- 运行时按钮类型没有真正改掉
- 持久化主表 `def.timeline.data.v1` 没有同步更新
- `def.skill-button.v1` 虽然被手改了 `skillType`，但这条写法不走正式 repository/service 入口
- 当前按钮图标、详情弹窗、刷新恢复链都存在不一致风险

这不是一个菜单交互问题，而是一个**按钮类型主真相 + 运行时渲染 + 持久化同步**的系统修改。

---

## 当前结论

### 1. 当前修改链是错的，不可接受

当前 [`src/components/CanvasBoard/index.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/index.tsx) 中的 `handleChangeSkillType()` 代码事实如下：

```ts
const handleChangeSkillType = (buttonId: string, nextSkillType: 'A' | 'B' | 'E' | 'Q') => {
  const button = skillButtons.find(item => item.id === buttonId);
  if (!button) return;

  dispatch({
    type: 'SET_SKILL_BUTTON_POSITION',
    buttonId,
    position: button.position,
    lineIndex: button.lineIndex,
    staffIndex: button.staffIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
  });

  const buttonStorage = getSkillButtonById(buttonId);
  if (buttonStorage) {
    const updatedButton = {
      ...buttonStorage,
      skillType: nextSkillType,
      updatedAt: Date.now(),
    };
    const table = getSkillButtonTable();
    table[buttonId] = updatedButton;
    setSkillButtonTable(table);
  }
};
```

这段代码的问题不是一个点，而是整条链路都错位：

- `dispatch({ type: 'SET_SKILL_BUTTON_POSITION' ... })` 根本**没有传新的 `skillType`**
- 这个 action 名字本身就是“改位置”，不是“改技能类型”
- 运行时 `state.skillButtons` 不会因为这段 dispatch 自动拿到新的 `skillType`
- `skillIconUrl` 也没有重新 `resolveSkillIconUrl(characterName, nextSkillType)`
- `def.timeline.data.v1` 没有任何更新入口被调用
- `def.skill-button.v1` 是直接 `get table -> 改对象 -> set table` 手写覆盖，不是正式 service/repository 更新链

### 2. `def.timeline.data.v1` 是按钮技能类型的明确主表之一，当前完全没改

代码事实：

- [`src/hooks/useTimelineData.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useTimelineData.ts) 当前只暴露了：
  - `addSkillButton`
  - `removeSkillButton`
  - `updateSkillButtonPosition`
  - `moveSkillButtonToStaff`
- 没有 `updateSkillButtonType`

代码事实：

- [`src/core/services/timelineService.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/timelineService.ts) 里当前也只有：
  - 新增按钮
  - 删除按钮
  - 改位置
  - 跨 staff 移动
- 没有“改按钮类型”的 service

这意味着：

- 当前菜单点击后，即使 `def.skill-button.v1` 被手改了
- `def.timeline.data.v1` 里按钮 `skillType` 仍然是旧值
- 刷新恢复时，`CanvasBoard` 仍然会从旧 timeline 数据恢复旧类型：

```ts
skillType: btn.skillType,
skillIconUrl: resolveSkillIconUrl(btn.characterName, btn.skillType),
```

代码位置：[`src/components/CanvasBoard/index.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/index.tsx:137)

### 3. `def.skill-button.v1` 确实也存 `skillType`

代码事实：

- [`src/types/storage.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts) 中 `PersistedSkillButton` 明确包含：

```ts
skillType: string;
```

所以按钮类型修改不是只改 timeline 就够了，`def.skill-button.v1` 也要同步。

---

## 根因总结

当前“编辑按钮类型”功能失败，不是因为菜单没点到，也不是因为 hover 没展开，而是因为：

1. **运行时状态更新错 action**
2. **没有 timeline 层正式更新入口**
3. **skill-button 总表用了临时写法，不走正式更新链**
4. **图标等衍生渲染字段没有同步更新**

这导致：

- 点击有日志
- 运行时未闭环
- 持久化未闭环
- 刷新必回退

---

## 必须改

### 1. 先新增“改按钮类型”的正式 service

- 文件：[`src/core/services/timelineService.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/timelineService.ts)
- 新增函数建议：

```ts
export function updateSkillButtonType(
  timelineData: TimelineData,
  buttonId: string,
  nextSkillType: SkillType
): {
  updatedTimelineButton: SkillButtonData | null;
  updatedPersistedButton: PersistedSkillButton | null;
  newTimelineData: TimelineData;
}
```

#### 修正要求

这条 service 必须一次性完成两张主表同步：

1. 更新 `def.timeline.data.v1`
   - 在 `timelineData.staffLines[*].buttons[*]` 中按 `buttonId` 找到目标按钮
   - 更新其 `skillType`
   - 保持 `position / nodeIndex / nodeNumber / characterName` 不变

2. 更新 `def.skill-button.v1`
   - 使用 [`src/core/repositories/skillButtonRepository.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/repositories/skillButtonRepository.ts) 的正式入口
   - 不要继续在 `CanvasBoard` 里手动 `getSkillButtonTable/setSkillButtonTable`
   - 推荐直接调用 `upsertSkillButton(...)`

3. 如果目标按钮不存在：
   - 返回 `updatedTimelineButton: null`
   - 返回 `updatedPersistedButton: null`
   - `newTimelineData` 原样返回

#### 不要这样做

- 不要把按钮类型更新写成位置更新的副作用
- 不要只改 `def.skill-button.v1`
- 不要只改 `def.timeline.data.v1`

#### 验证方式

- 调用 service 后，两张表里的同一个 `buttonId` 都变成新 `skillType`

---

### 2. 在 `useTimelineData` 暴露正式 hook 入口

- 文件：[`src/hooks/useTimelineData.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useTimelineData.ts)

#### 修正要求

新增 hook 方法：

```ts
const updateSkillButtonType = useCallback((
  buttonId: string,
  nextSkillType: SkillType
): SkillButtonData | null => {
  const { updatedTimelineButton, newTimelineData } = updateSkillButtonTypeService(
    timelineDataRef.current,
    buttonId,
    nextSkillType
  );
  setTimelineData(newTimelineData);
  return updatedTimelineButton;
}, []);
```

并在 hook return 中暴露：

```ts
return {
  ...,
  updateSkillButtonType,
}
```

#### 原因

`CanvasBoard` 不能直接越过 `useTimelineData` 自己去 patch timeline 主表。

#### 验证方式

- `CanvasBoard` 可以只通过 `useTimelineData` 提供的方法改按钮类型

---

### 3. 修正 `CanvasBoard.handleChangeSkillType()`，不要再错用 `SET_SKILL_BUTTON_POSITION`

- 文件：[`src/components/CanvasBoard/index.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/index.tsx)
- 函数：`handleChangeSkillType()`

#### 当前错误

当前用了：

```ts
dispatch({ type: 'SET_SKILL_BUTTON_POSITION', ... })
```

这不会改 `skillType`。

#### 修正要求

`handleChangeSkillType()` 必须重写成这条顺序：

1. 调用 `useTimelineData.updateSkillButtonType(buttonId, nextSkillType)`
2. 如果 service 返回失败，直接退出，不要改运行时 UI
3. 如果成功：
   - 以当前 `skillButtons` 中对应按钮为基础
   - 更新运行时按钮：
     - `skillType: nextSkillType`
     - `skillIconUrl: resolveSkillIconUrl(characterName, nextSkillType)`
   - 用明确的运行时更新 action 写回 `AppContext.state.skillButtons`

#### 关键要求

不能继续复用 `SET_SKILL_BUTTON_POSITION` 这种错语义 action。  
如果当前 `AppContext` 没有“改按钮类型”的 action，就要新增一个专门 action，例如：

```ts
{ type: 'UPDATE_SKILL_BUTTON_TYPE', buttonId, skillType, skillIconUrl }
```

#### 验证方式

- 点击菜单项后，当前按钮文字和图标立即变化

---

### 4. `AppContext` / reducer 要支持运行时按钮类型更新

- 文件：
  - [`src/context/AppContext.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)
  - 如果 reducer 在别处定义，则对应 reducer 文件

#### 修正要求

新增或补齐 reducer 分支：

```ts
case 'UPDATE_SKILL_BUTTON_TYPE':
  return {
    ...state,
    skillButtons: state.skillButtons.map(button =>
      button.id === action.buttonId
        ? {
            ...button,
            skillType: action.skillType,
            skillIconUrl: action.skillIconUrl,
          }
        : button
    ),
  };
```

#### 原因

运行时按钮本体渲染依赖：

- `skillType`
- `skillIconUrl`

不改 reducer，当前按钮不会即时刷新。

#### 验证方式

- 不刷新页面，点击二级菜单后按钮本体立即变化

---

### 5. 明确 `def.skill-button.v1` 更新必须走 repository 正式入口

- 文件：
  - [`src/core/repositories/skillButtonRepository.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/repositories/skillButtonRepository.ts)
  - [`src/core/services/timelineService.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/timelineService.ts)

#### 当前错误

`CanvasBoard` 里直接：

```ts
const table = getSkillButtonTable();
table[buttonId] = updatedButton;
setSkillButtonTable(table);
```

这是跨层直写，后续非常容易继续散掉。

#### 修正要求

把这段移出 `CanvasBoard`，收口到 service 层，统一用：

```ts
upsertSkillButton(updatedButton)
```

#### 验证方式

- `CanvasBoard` 不再直接 import `getSkillButtonTable/setSkillButtonTable`

---

### 6. 详情弹窗和伤害计算必须跟随新类型

- 文件：[`src/components/CanvasBoard/SkillButton.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

#### 代码事实

当前详情弹窗和伤害计算广泛依赖 `button.skillType`：

- 标题区技能文本
- `skillKeyMap[skillType]`
- 各种 `skillType === 'A' | 'B' | 'E' | 'Q'` 分支

#### 修正要求

不需要额外重构这里，但必须保证运行时 `button.skillType` 真改掉。  
只要第 3、4 条修对，这里自然会跟着刷新。

#### 不要动

- 不要在这轮重写详情弹窗
- 不要额外改 Buff 逻辑

---

## 可选优化

- 无。

---

## 不要动

- 不要改复制链
- 不要改删除链
- 不要改 `refCount` 逻辑
- 不要改右键菜单 hover 结构
- 不要顺手重构 `SkillButton` 详情弹窗
- 不要把“改技能类型”做成只改 UI 的临时补丁

---

## 验收标准 AC

### AC1：运行时立即生效

- 右键按钮
- 悬停 `编辑`
- 选择 `B/E/Q` 中一个目标类型
- 当前按钮本体立即变化：
  - 底座文字变更
  - 圆球图标变更

### AC2：持久化真正生效

- 修改按钮类型后刷新页面
- 按钮保持新类型
- 不回退到旧类型

### AC3：两张表一致

检查同一个 `buttonId`：

- `def.timeline.data.v1` 中按钮 `skillType` 已更新
- `def.skill-button.v1` 中按钮 `skillType` 已更新

### AC4：详情弹窗一致

- 修改按钮类型后双击打开详情
- 标题区技能类型、技能伤害计算口径与新类型一致

### AC5：不回退其它链路

- 删除按钮仍正常
- 复制按钮仍正常
- 拖拽按钮仍正常
- 构建通过

---

## 回归检查项

1. 当前按钮类型从 `A -> B`
   - 运行时立即变化
   - 刷新后仍是 `B`

2. 当前按钮类型从 `B -> Q`
   - 图标和文字都变
   - 详情弹窗按 `Q` 计算

3. 修改后立即复制该按钮
   - 新复制按钮继承的是修改后的类型，不是旧类型

4. 修改后移动按钮
   - `def.timeline.data.v1` 不被旧值覆盖回去

---

## 给 Trae 的执行指令

1. 先改 [`src/core/services/timelineService.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/timelineService.ts)
   - 新增正式 service：`updateSkillButtonType(...)`
   - 在这里同步更新：
     - `def.timeline.data.v1`
     - `def.skill-button.v1`

2. 再改 [`src/hooks/useTimelineData.ts`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/hooks/useTimelineData.ts)
   - 暴露 `updateSkillButtonType(...)` hook 入口

3. 再改 `AppContext` reducer
   - 新增专用 action：
     - `UPDATE_SKILL_BUTTON_TYPE`
   - 不要继续错用 `SET_SKILL_BUTTON_POSITION`

4. 最后改 [`src/components/CanvasBoard/index.tsx`](C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/index.tsx)
   - 重写 `handleChangeSkillType()`
   - 删除直接 `getSkillButtonTable/setSkillButtonTable` 的写法
   - 调用 `updateSkillButtonType(...)`
   - 成功后 dispatch 运行时类型更新

5. 完成后必须提交：
   - `handleChangeSkillType()` 修改前后对比
   - `timelineService` 新增入口签名
   - `def.timeline.data.v1` 修改前后对比
   - `def.skill-button.v1` 修改前后对比
   - “当前渲染立即变化 / 刷新不回退 / 详情弹窗一致”三条手测结果
   - 构建结果


