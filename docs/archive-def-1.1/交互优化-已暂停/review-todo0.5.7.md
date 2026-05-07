# review-todo0.5.7

## [任务理解]

本轮执行 `修改大纲—交互优化.md` 的第四步：交互反馈统一。

目标是在页面化、工作台壳层、面板工作台化之后，建立统一的用户反馈入口，让保存、拖拽、Buff 添加、错误、空态、禁用原因等操作反馈不再分散在 `alert`、`console.log` 和局部静默失败中。

本轮只统一交互反馈，不改业务规则，不改缓存主链路，不改伤害公式。

## [当前状态]

当前反馈分散在：

- `alert('排轴数据已保存')`
- `console.log`
- `console.warn`
- 局部按钮 disabled
- 局部空态文案
- 拖拽视觉层

当前问题：

- 用户不知道操作是否真正生效。
- Buff 添加失败、未选中技能按钮、重复 Buff、拖拽释放失败等场景缺少统一 UI 反馈。
- 保存状态没有统一入口。
- 后续工作台壳已经有 `WorkbenchFeedbackLayer`，但还没有形成统一调用方式。

## [必须改]

### 1. 建立 feedback domain 类型

Trae 执行：

- 新建 `src/core/domain/feedback.ts`。
- 定义反馈类型。

建议类型：

```ts
export type FeedbackLevel = 'info' | 'success' | 'warning' | 'error';

export interface WorkbenchFeedback {
  id: string;
  level: FeedbackLevel;
  message: string;
  createdAt: number;
}
```

约束：

- 类型不依赖 React。
- 不包含 UI className。
- 不包含业务对象大 payload。

### 2. 新建 useWorkbenchFeedback hook

Trae 执行：

- 新建 `src/hooks/useWorkbenchFeedback.ts`。
- 提供统一反馈状态和操作。

建议 API：

```ts
export function useWorkbenchFeedback() {
  return {
    feedback,
    showFeedback,
    clearFeedback,
  };
}
```

其中：

```ts
showFeedback(level: FeedbackLevel, message: string): void
clearFeedback(): void
```

行为：

- 每次 `showFeedback` 覆盖当前反馈即可。
- 本轮不做队列。
- 本轮不做复杂 toast 动画。
- 可以设置自动清除，例如 2500ms。

约束：

- 不写 storage。
- 不依赖业务 service。
- 不修改 Buff、timeline、damage 逻辑。

### 3. 升级 WorkbenchFeedbackLayer

Trae 执行：

- 修改 `src/components/Workspace/WorkbenchFeedbackLayer.tsx`。
- 让它接收 `WorkbenchFeedback | null`。

建议 props：

```ts
interface WorkbenchFeedbackLayerProps {
  feedback: WorkbenchFeedback | null;
  onClose?: () => void;
}
```

展示要求：

- `info`、`success`、`warning`、`error` 至少有可区分 className。
- 无 feedback 时不渲染。
- 有 feedback 时显示 message。
- 可选关闭按钮。

约束：

- 不做复杂动画。
- 不引入 UI 库。
- 不依赖全局状态库。

### 4. 在 TimelineWorkbenchPage 接入 feedback

Trae 执行：

- 修改 `src/pages/TimelineWorkbenchPage.tsx`。
- 调用 `useWorkbenchFeedback()`。
- 将 `feedback` 和 `clearFeedback` 传给 `WorkbenchFeedbackLayer`。
- 将 `showFeedback` 通过 props 传给需要反馈的工作台内容。

约束：

- 如果 `CanvasBoard` 暂时没有 feedback prop，本轮允许新增最小 prop。
- 不要把 feedback 写进 AppContext。
- 不要引入 Redux/Zustand。

### 5. 给 CanvasBoard 增加最小反馈入口

Trae 执行：

- 修改 `src/components/CanvasBoard/index.tsx`。
- 增加可选 prop：

```ts
interface CanvasBoardProps {
  showFeedback?: (level: FeedbackLevel, message: string) => void;
}
```

使用场景：

- 保存排轴成功。
- 锁定按钮右键删除被阻止。
- 删除按钮成功。
- 无效操作提示。

约束：

- prop 可选，避免破坏旧调用。
- 不要把 feedback 逻辑写入 service。
- 不要改变业务执行顺序。

### 6. 替换关键 alert

Trae 执行：

- 找到当前 `alert('排轴数据已保存')`。
- 替换为：

```ts
showFeedback?.('success', '排轴数据已保存');
```

约束：

- 不删除保存逻辑。
- 不改变 `saveTimelineData()` 调用。
- 只替换 UI 提示方式。

### 7. 增加关键操作反馈

Trae 执行：

至少覆盖以下场景：

1. 保存成功：
   - `success`
   - `排轴数据已保存`

2. 锁定按钮阻止右键删除：
   - `warning`
   - `技能按钮已锁定，无法右键删除`

3. 删除按钮成功：
   - `success`
   - `技能按钮已删除`

4. Buff 添加失败：  
   如果该反馈路径仍在 `DamageTab` 内，先不强行跨层传递；本轮可只保留 console，后续面板反馈专项处理。

约束：

- 本轮只接 CanvasBoard 主工作台反馈。
- 不强制把所有 console 全部替换。
- 不改 `DamageTab` 业务链路。

### 8. 最小 CSS

Trae 执行：

- 修改或补充 `Workspace.css`。
- 增加反馈层样式：
  - `.workbench-feedback`
  - `.workbench-feedback--info`
  - `.workbench-feedback--success`
  - `.workbench-feedback--warning`
  - `.workbench-feedback--error`

要求：

- 不遮挡技能按钮弹窗。
- 不遮挡拖拽 overlay。
- 不破坏现有布局。

## [可选优化]

以下内容可做，但不得影响主线交付：

- 反馈自动关闭时间设置为常量。
- `showSuccess` / `showWarning` / `showError` 作为便捷方法。
- 在顶部栏显示保存状态，但本轮不强制。

## [不要动]

本轮禁止：

- 不要改 Buff 添加、删除、清空逻辑。
- 不要改 candidate Buff 逻辑。
- 不要改 `useBuffInteraction`。
- 不要改 `buffService`。
- 不要改 `timelineService`。
- 不要改 `def.skill-button.v1`。
- 不要改 `def.all-buff-list.v1`。
- 不要改 `def.candidate-buff-list.v1`。
- 不要改 timeline 保存恢复规则。
- 不要改 0.5.2 calculator。
- 不要改伤害公式。
- 不要处理“增幅区”。
- 不要引入 UI 组件库。
- 不要引入全局状态库。

## [验收标准 AC]

1. `src/core/domain/feedback.ts` 存在。
2. `src/hooks/useWorkbenchFeedback.ts` 存在。
3. `WorkbenchFeedbackLayer` 能显示 `info/success/warning/error` 反馈。
4. `TimelineWorkbenchPage` 接入 `useWorkbenchFeedback`。
5. `CanvasBoard` 支持可选 `showFeedback` prop。
6. 保存排轴成功不再使用 `alert`。
7. 锁定按钮右键删除被阻止时有 UI 反馈。
8. 删除按钮成功时有 UI 反馈。
9. `npm run build` 通过。

## [回归检查项]

Trae 必须手测：

1. 点击保存排轴，出现成功反馈。
2. 反馈自动消失或可关闭。
3. 锁定技能按钮后右键删除，按钮不删除，并出现 warning 反馈。
4. 未锁定技能按钮右键删除，按钮删除，并出现 success 反馈。
5. 技能按钮拖拽不受反馈层影响。
6. Buff 单击添加不受影响。
7. Buff 拖拽添加不受影响。
8. 技能按钮弹窗不被反馈层遮挡。
9. 刷新 `/timeline` 后缓存恢复仍正常。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 新建 feedback domain 类型。
2. 新建 `useWorkbenchFeedback`。
3. 升级 `WorkbenchFeedbackLayer`。
4. 在 `TimelineWorkbenchPage` 接入 feedback hook。
5. 给 `CanvasBoard` 增加可选 `showFeedback` prop。
6. 替换保存成功 alert。
7. 增加锁定删除阻止、删除成功反馈。
8. 添加最小 CSS。
9. 跑 `npm run build`。
10. 按回归检查项手测。

本轮交付标准：工作台具备统一反馈入口，关键操作不再只依赖 alert/console，且现有排轴、Buff、伤害功能不回退。

