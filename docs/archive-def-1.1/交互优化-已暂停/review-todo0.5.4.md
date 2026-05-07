# review-todo0.5.4

## [任务理解]

本轮执行 `修改大纲—交互优化.md` 的第一步：页面路由化。

目标是把当前 `AppContext.currentView` 驱动的 `selection / canvas` 视图切换，升级为 React Router 驱动的页面结构：

- `/select`：选人页。
- `/timeline`：排轴工作台页。

本轮只建立页面边界和路由语义，不重写 UI，不改缓存主链路，不改 Buff 逻辑，不改伤害计算。

## [当前状态]

当前 `src/App.tsx` 直接根据 `state.currentView` 渲染：

- `SelectionPanel`
- `CanvasBoard`

这已经具备页面雏形，但不是正式路由页面：

- 浏览器地址不能表达当前页面。
- 不能直接访问 `/select` 或 `/timeline`。
- 后续工作台壳层无法建立稳定 page 边界。

## [必须改]

### 1. 新增 React Router 依赖

Trae 执行：

```bash
npm install react-router-dom
```

约束：

- 不引入其他路由库。
- 不引入 Redux、Zustand、React Query。
- 安装后确认 `package.json` 和 lock 文件同步更新。

### 2. 新建 pages 目录

Trae 执行：

- 新建 `src/pages/`。
- 新建 `src/pages/SelectionPage.tsx`。
- 新建 `src/pages/TimelineWorkbenchPage.tsx`。

约束：

- page 文件只做页面级组合。
- 不在 page 内新增 storage 写入。
- 不在 page 内重写业务逻辑。

### 3. 实现 SelectionPage

Trae 执行：

- `SelectionPage` 渲染现有 `SelectionPanel`。
- `SelectionPage` 是 `/select` 的页面入口。

建议实现：

```tsx
import { SelectionPanel } from '../components/SelectionPanel';

export function SelectionPage() {
  return <SelectionPanel />;
}
```

约束：

- 不改 `SelectionPanel` 的选人逻辑。
- 不改最多 4 人限制。
- 不改进入排轴按钮样式。

### 4. 实现 TimelineWorkbenchPage

Trae 执行：

- `TimelineWorkbenchPage` 渲染现有 `CanvasBoard`。
- `TimelineWorkbenchPage` 是 `/timeline` 的页面入口。
- 如果没有已选干员，进入 `/timeline` 时跳回 `/select`。

建议实现：

```tsx
import { Navigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { CanvasBoard } from '../components/CanvasBoard';

export function TimelineWorkbenchPage() {
  const { state } = useAppContext();

  if (state.selectedCharacters.length === 0) {
    return <Navigate to="/select" replace />;
  }

  return <CanvasBoard />;
}
```

约束：

- 不改 `CanvasBoard` 内部逻辑。
- 不改 timeline 恢复逻辑。
- 不改 skill-button 恢复逻辑。
- 不改 Buff 恢复逻辑。

### 5. 修改 App.tsx 为路由分发

Trae 执行：

- 修改 `src/App.tsx`。
- 使用 React Router 分发页面。

目标路由：

- `/` 重定向到 `/select`。
- `/select` 渲染 `SelectionPage`。
- `/timeline` 渲染 `TimelineWorkbenchPage`。
- `*` 重定向到 `/select`。

建议结构：

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { SelectionPage } from './pages/SelectionPage';
import { TimelineWorkbenchPage } from './pages/TimelineWorkbenchPage';
import './styles/global.css';

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Navigate to="/select" replace />} />
        <Route path="/select" element={<SelectionPage />} />
        <Route path="/timeline" element={<TimelineWorkbenchPage />} />
        <Route path="*" element={<Navigate to="/select" replace />} />
      </Routes>
    </div>
  );
}

export default App;
```

约束：

- `App.tsx` 不再直接判断 `state.currentView`。
- 页面分发以 router 为准。
- 暂时不要删除 `currentView`、`SET_VIEW`，保留兼容。

### 6. 修改 main.tsx 包裹 BrowserRouter

Trae 执行：

- 修改 `src/main.tsx`。
- 在 `App` 外层包裹 `BrowserRouter`。

建议结构：

```tsx
import { BrowserRouter } from 'react-router-dom';

root.render(
  <React.StrictMode>
    <AppProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProvider>
  </React.StrictMode>
);
```

约束：

- 保持 `AppProvider` 仍包裹整个应用。
- 不改变 provider 内部逻辑。

### 7. 替换页面跳转入口

Trae 执行：

- 找到现有进入排轴、返回选人的入口。
- 将页面跳转改为 `useNavigate()`。

重点位置：

- `SelectionPanel` 进入排轴按钮。
- `CanvasBoard` 返回选人入口。
- `useSelectStart` 如果仍通过 `SET_VIEW` 切换页面，也要调整为 router navigation 或暂时保持但不作为主入口。

约束：

- 不删除 `SET_VIEW`。
- 不破坏现有按钮行为。
- 不清空已选干员。
- 不清空 timeline。

## [可选优化]

以下内容可做，但不得影响主线交付：

- 新建 `src/pages/index.ts` 统一导出页面。
- 在 `TimelineWorkbenchPage` 中给无干员跳转前打印一条 warning。

## [不要动]

本轮禁止：

- 不要重写 `SelectionPanel` UI。
- 不要重写 `CanvasBoard` UI。
- 不要新增 `WorkspaceShell`。
- 不要改 `SidePanel`。
- 不要改 Buff 添加、删除、清空逻辑。
- 不要改 `def.skill-button.v1`。
- 不要改 `def.all-buff-list.v1`。
- 不要改 `def.candidate-buff-list.v1`。
- 不要改 `timeline.data` 保存恢复规则。
- 不要改 0.5.2 calculator。
- 不要改伤害公式。
- 不要处理“增幅区”。

## [验收标准 AC]

1. `react-router-dom` 已加入依赖。
2. `src/pages/SelectionPage.tsx` 存在。
3. `src/pages/TimelineWorkbenchPage.tsx` 存在。
4. `/` 自动跳转到 `/select`。
5. `/select` 显示选人页。
6. `/timeline` 在已选择干员时显示排轴工作台页。
7. `/timeline` 在未选择干员时跳回 `/select`。
8. `App.tsx` 不再直接使用 `state.currentView` 做页面分发。
9. 页面跳转主入口使用 React Router。
10. `npm run build` 通过。

## [回归检查项]

Trae 必须手测：

1. 直接访问 `/select`。
2. 直接访问 `/timeline`，未选干员时应回到 `/select`。
3. 在 `/select` 选择干员后进入 `/timeline`。
4. 从 `/timeline` 返回 `/select`。
5. 页面切换后已选干员不误清空。
6. `/timeline` 页面刷新后，timeline、skill-button、buff-list 按当前规则恢复。
7. 技能按钮拖拽、移动、删除仍正常。
8. Buff 单击添加、拖拽添加、删除仍正常。
9. 技能伤害展示仍正常。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 安装 `react-router-dom`。
2. 新建 `SelectionPage` 和 `TimelineWorkbenchPage`。
3. 修改 `main.tsx` 包裹 `BrowserRouter`。
4. 修改 `App.tsx` 使用 `Routes`。
5. 替换进入排轴和返回选人的跳转入口为 `useNavigate()`。
6. 保留 `currentView` 和 `SET_VIEW`，本轮不清理旧状态。
7. 跑 `npm run build`。
8. 按回归检查项手测。

本轮交付标准：应用具备 `/select` 和 `/timeline` 两个真实页面入口，现有功能不回退。

