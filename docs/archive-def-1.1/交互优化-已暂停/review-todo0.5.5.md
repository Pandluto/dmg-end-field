# review-todo0.5.5

## [任务理解]

本轮执行 `修改大纲—交互优化.md` 的第二步：工作台壳层。

目标是在 0.5.4 页面路由化之后，为 `/timeline` 建立真正的工作台结构：

- 顶部工作台栏。
- 主内容区域。
- 操作反馈层。
- 后续侧栏、检查器、工具面板的插槽边界。

本轮不重写 `CanvasBoard` 内部业务，只把现有排轴内容放进工作台壳中，为后续 0.5.6 面板工作台化做结构准备。

## [当前状态]

0.5.4 完成后，预期已有：

- `/select` 页面。
- `/timeline` 页面。
- `SelectionPage`。
- `TimelineWorkbenchPage`。
- React Router 页面分发。

当前问题：

- `/timeline` 仍只是直接渲染 `CanvasBoard`。
- `CanvasBoard` 同时承担页面容器和排轴业务。
- 返回选人、保存、队伍状态、操作反馈仍分散在内部组件中。
- 后续如果直接继续加工具面板，会继续堆大 `CanvasBoard`。

## [必须改]

### 1. 新建 Workspace 目录

Trae 执行：

- 新建 `src/components/Workspace/`。
- 新建以下文件：
  - `WorkspaceShell.tsx`
  - `WorkbenchTopBar.tsx`
  - `WorkbenchFeedbackLayer.tsx`
  - `Workspace.css`
  - `index.ts`

约束：

- 本轮只建立壳层。
- 不在 Workspace 组件中写 storage。
- 不在 Workspace 组件中写 Buff 主链路。
- 不在 Workspace 组件中写伤害计算。

### 2. 实现 WorkspaceShell

Trae 执行：

- `WorkspaceShell` 负责工作台整体布局。
- 它至少接收：

```ts
interface WorkspaceShellProps {
  topBar: React.ReactNode;
  children: React.ReactNode;
  feedback?: React.ReactNode;
}
```

建议结构：

```tsx
export function WorkspaceShell({ topBar, children, feedback }: WorkspaceShellProps) {
  return (
    <div className="workspace-shell">
      <div className="workspace-topbar">{topBar}</div>
      <main className="workspace-main">{children}</main>
      {feedback && <div className="workspace-feedback">{feedback}</div>}
    </div>
  );
}
```

约束：

- 不要把 `CanvasBoard` 逻辑搬进 `WorkspaceShell`。
- `WorkspaceShell` 只负责布局插槽。
- 不要引入复杂状态。

### 3. 实现 WorkbenchTopBar

Trae 执行：

- `WorkbenchTopBar` 负责顶部工作台栏。
- 它至少支持：
  - 返回选人。
  - 显示当前队伍人数。
  - 显示当前页面标题。
  - 预留保存状态位置。

建议 props：

```ts
interface WorkbenchTopBarProps {
  selectedCount: number;
  onBackToSelect: () => void;
  saveStatus?: string;
}
```

建议文案：

- 标题：`排轴工作台`
- 返回按钮：`返回选人`
- 队伍状态：`已选 X / 4`
- 保存状态默认：`自动保存中` 或 `已连接本地缓存`

约束：

- 不要在 topbar 内直接调用 `useNavigate()`，由页面传入 `onBackToSelect`。
- 不要在 topbar 内直接调用保存逻辑。
- 本轮不要替换 `CanvasArea` 内已有保存按钮，避免行为扩散。

### 4. 实现 WorkbenchFeedbackLayer

Trae 执行：

- `WorkbenchFeedbackLayer` 先做最小占位。
- 支持显示一条状态文本。

建议 props：

```ts
interface WorkbenchFeedbackLayerProps {
  message?: string;
}
```

行为：

- 无 message 时不渲染或渲染空层。
- 有 message 时显示在工作台固定区域。

约束：

- 本轮不替换所有 alert。
- 本轮不实现 toast 队列。
- 本轮只建立后续反馈统一的挂载点。

### 5. 修改 TimelineWorkbenchPage 组装工作台壳

Trae 执行：

- 修改 `src/pages/TimelineWorkbenchPage.tsx`。
- 用 `WorkspaceShell` 包裹 `CanvasBoard`。
- 顶部栏使用 `WorkbenchTopBar`。
- 反馈层使用 `WorkbenchFeedbackLayer`。

建议结构：

```tsx
export function TimelineWorkbenchPage() {
  const { state } = useAppContext();
  const navigate = useNavigate();

  if (state.selectedCharacters.length === 0) {
    return <Navigate to="/select" replace />;
  }

  return (
    <WorkspaceShell
      topBar={
        <WorkbenchTopBar
          selectedCount={state.selectedCharacters.length}
          onBackToSelect={() => navigate('/select')}
          saveStatus="本地缓存"
        />
      }
      feedback={<WorkbenchFeedbackLayer />}
    >
      <CanvasBoard />
    </WorkspaceShell>
  );
}
```

约束：

- 不改 `CanvasBoard` 内部业务。
- 不改 `CanvasBoard` 的 props。
- 不改 `CanvasArea`。
- 不改 `SidePanel`。
- 不改 `SkillSandbox`。

### 6. 最小 CSS

Trae 执行：

- 新建 `Workspace.css`。
- 提供最小布局样式：
  - `.workspace-shell`
  - `.workspace-topbar`
  - `.workspace-main`
  - `.workspace-feedback`

要求：

- 不做视觉大重构。
- 不改 `CanvasBoard.css` 的核心布局。
- 不破坏现有画布尺寸。
- 不遮挡拖拽层和弹窗。

## [可选优化]

以下内容可做，但不得影响主线交付：

- `src/components/Workspace/index.ts` 统一导出 Workspace 组件。
- `WorkbenchTopBar` 显示已选干员名称列表。
- `WorkspaceShell` 预留 `leftPanel`、`rightPanel` 插槽，但本轮不强制使用。

## [不要动]

本轮禁止：

- 不要重写 `CanvasBoard`。
- 不要移动 `CanvasArea` 业务逻辑。
- 不要移动 `SidePanel` 业务逻辑。
- 不要移动 `SkillSandbox` 业务逻辑。
- 不要改 `OperatorConfigPanel`。
- 不要改 Buff 添加、删除、清空逻辑。
- 不要改 candidate Buff 逻辑。
- 不要改 `ddd.skill-button.v1`。
- 不要改 `ddd.all-buff-list.v1`。
- 不要改 `ddd.candidate-buff-list.v1`。
- 不要改 timeline 保存恢复逻辑。
- 不要改 0.5.2 calculator。
- 不要改伤害公式。
- 不要处理“增幅区”。

## [验收标准 AC]

1. `src/components/Workspace/WorkspaceShell.tsx` 存在。
2. `src/components/Workspace/WorkbenchTopBar.tsx` 存在。
3. `src/components/Workspace/WorkbenchFeedbackLayer.tsx` 存在。
4. `src/components/Workspace/Workspace.css` 存在。
5. `TimelineWorkbenchPage` 使用 `WorkspaceShell` 包裹 `CanvasBoard`。
6. `/timeline` 顶部能看到工作台栏。
7. 返回选人按钮能跳转 `/select`。
8. `CanvasBoard` 原有排轴功能不回退。
9. `npm run build` 通过。

## [回归检查项]

Trae 必须手测：

1. 访问 `/timeline` 能看到工作台顶部栏和排轴内容。
2. 点击顶部栏“返回选人”能回到 `/select`。
3. 从 `/select` 进入 `/timeline` 后，顶部栏显示已选人数。
4. 技能按钮拖拽仍正常。
5. 技能按钮移动仍正常。
6. 技能按钮删除和锁定仍正常。
7. Buff 单击添加仍正常。
8. Buff 拖拽添加仍正常。
9. 技能伤害展示仍正常。
10. 刷新 `/timeline` 后缓存恢复仍正常。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 新建 `src/components/Workspace/` 及 4 个基础文件。
2. 实现 `WorkspaceShell`。
3. 实现 `WorkbenchTopBar`。
4. 实现 `WorkbenchFeedbackLayer`。
5. 修改 `TimelineWorkbenchPage`，用工作台壳包裹 `CanvasBoard`。
6. 添加最小 CSS，确保不破坏现有画布布局。
7. 跑 `npm run build`。
8. 按回归检查项手测。

本轮交付标准：`/timeline` 从“直接渲染 CanvasBoard”升级为“工作台壳承载 CanvasBoard”，但所有排轴、Buff、伤害功能保持不回退。
