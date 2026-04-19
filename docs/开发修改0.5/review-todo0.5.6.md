# review-todo0.5.6：Canvas 工作区布局组件化

## [任务理解]

本轮目标是整理 Canvas 工作区的布局骨架，为后续 UI 重构打基础。

0.5.5 已完成工作台多模式，但暴露出布局问题：

- 关闭 `SidePanel` 后，画布会左移。
- `canvas-container` 仍有水平 padding，画布主体没有贴左对齐。
- `CanvasArea` 顶部工具栏占用画布顶部空间。
- 工作台触发按钮、Canvas 工具按钮分散在不同层级。
- 背景平行四边形装饰物需要固定到背景层，不参与布局计算。

0.5.6 只做布局组件化和按钮区整理，不改业务逻辑。

## [最终布局目标]

### 主体分层

页面主体分为左右两组：

```text
左侧主工作区 84%：CanvasArea + SkillSandbox
右侧侧边栏 16%：SidePanel
```

规则：

- `SidePanel` 从旧左侧位置改为右侧固定槽位。
- `排轴` 模式：右侧 `SidePanel` 不显示，但右侧 16% 槽位仍存在。
- `侧边栏` 模式：右侧 16% 槽位显示 `SidePanel`。
- `角色配置` 模式：强制打开 `OperatorConfigPanel`，不依赖 `SidePanel` 显示。
- 删除 `全部显示` 标签，不再保留“全部同时显示”入口。
- 左侧主工作区固定 84%，不因 `SidePanel` 显示/隐藏而变宽。
- 右侧槽位固定 16%，用于承载 `SidePanel`。

### 底部按钮区

所有拆出的控制按钮统一放到底部按钮区。

必须包含：

- 工作台触发按钮，也就是当前 `.workbench-top-trigger` 对应能力。
- 返回按钮。
- 保存按钮。
- 增加 staff 组按钮。
- 减少 staff 组按钮。
- 计算伤害按钮，如果当前只是占位，也保留占位。

底部按钮区规则：

- 高度固定 `30px`。
- 位于界面底部。
- 按钮压缩排列。
- 整体向左对齐。
- 内部分为 `左区 / 中区 / 右区`。
- 三个区同一层级，不要嵌套成业务组件内部私有按钮区。
- 工作台触发按钮不能继续孤立悬浮在角落。
- 点击工作台触发按钮仍要打开顶部下滑抽屉。

### 背景层

现有平行四边形装饰物属于背景层。

涉及：

- `skew-panel`
- `skew-panel-bottom`

规则：

- 不修改视觉表现。
- 不修改尺寸、颜色、位置关系。
- 可抽为 `CanvasBackgroundLayer`，但只能固定为背景层。
- 不参与左 84% / 右 16% 布局计算。
- 不影响画布拖拽、SidePanel、SkillSandbox、配置面板浮层。

## [组件化目标]

### CanvasBoard 层

建议结构：

```text
CanvasWorkspaceLayout
├─ CanvasBackgroundLayer
├─ CanvasMainGroup
│  ├─ CanvasMainSlot
│  └─ CanvasToolSlot
├─ CanvasRightSideSlot
├─ CanvasBottomControlBar
└─ CanvasOverlayLayer
```

职责：

- `CanvasWorkspaceLayout`：只负责工作区结构。
- `CanvasBackgroundLayer`：承载背景装饰物。
- `CanvasMainGroup`：左侧 84% 主工作区。
- `CanvasMainSlot`：承载 `CanvasArea`。
- `CanvasToolSlot`：承载 `SkillSandbox`。
- `CanvasRightSideSlot`：右侧 16% 槽位，承载 `SidePanel`。
- `CanvasBottomControlBar`：底部 30px 统一按钮区。
- `CanvasOverlayLayer`：承载 `OperatorConfigPanel`、`DraggingOverlay` 等浮层。

可以先在 `CanvasBoard/index.tsx` 内联小组件实现；如果直接拆文件，建议放在：

- `src/components/CanvasBoard/components/CanvasWorkspaceLayout.tsx`
- `src/components/CanvasBoard/components/CanvasWorkspaceLayout.css`

### CanvasArea 层

建议结构：

```text
CanvasArea
└─ CanvasViewport
```

说明：

- `CanvasArea` 不再承载顶部 `Toolbar`。
- 原 `Toolbar` 的按钮能力上交给 `CanvasBottomControlBar`。
- `CanvasViewport` 保留原 `canvas-container > canvas` 结构。
- `canvasRef` 仍挂在 `.canvas` 上。
- `onCanvasClick` 仍绑定在 `.canvas` 上。
- staff 线、节点、技能按钮仍在 `.canvas` 内渲染。

## [必须改]

### 1. WorkbenchFrame 标签调整

修改文件：

- `src/components/WorkbenchFrame/WorkbenchFrame.tsx`
- `src/components/WorkbenchFrame/WorkbenchFrame.css`

要求：

- 删除 `全部显示` 标签。
- 工作台抽屉只保留：

```text
选人 / 排轴 / 侧边栏 / 角色配置
```

- `排轴`：显示左侧主工作区，不显示右侧 `SidePanel`。
- `侧边栏`：显示右侧 `SidePanel`。
- `角色配置`：强制打开配置面板。
- 工作台触发按钮不再直接独立渲染在 `WorkbenchFrame` 根部。
- 工作台触发按钮应进入底部统一按钮区。
- 移除或废弃独立 `.workbench-top-trigger` 的固定定位样式。
- 工作台触发按钮样式适配 30px 高底部按钮区。

### 2. CanvasBoard 左右槽位

修改文件：

- `src/components/CanvasBoard/index.tsx`
- `src/components/CanvasBoard/CanvasBoard.css`

要求：

- 左侧主工作区固定 `84%`。
- 右侧 `SidePanel` 槽位固定 `16%`。
- `SidePanel` 不再位于左侧。
- `SidePanel` 显示时放入右侧槽位。
- `SidePanel` 隐藏时右侧槽位保留为空白。
- 左侧主工作区不因 `SidePanel` 显示/隐藏而改变宽度。
- `SidePanel` 放入右侧槽位时使用 `widthPercent={100}`。

建议结构：

```tsx
<div className="canvas-workspace-layout">
  <CanvasBackgroundLayer />

  <div className="canvas-main-group">
    <div className="canvas-main-slot">
      <CanvasArea ... />
    </div>
    <div className="canvas-tool-slot">
      <SkillSandbox ... />
    </div>
  </div>

  <div className="canvas-right-side-slot">
    {isSidePanelVisible && <SidePanel widthPercent={100} />}
  </div>

  <CanvasBottomControlBar ... />
  <CanvasOverlayLayer ... />
</div>
```

### 3. 底部统一按钮区

新增或内联：

- `CanvasBottomControlBar`

要求：

- 固定在界面底部。
- 高度 `30px`。
- 承载所有拆出的控制按钮。
- 分 `左区 / 中区 / 右区`。
- 三个区同一层级。
- 按钮压缩排列。
- 整体左对齐。

建议结构：

```tsx
<div className="canvas-bottom-control-bar">
  <div className="canvas-bottom-control-section canvas-bottom-control-section-left">
    {/* 工作台触发按钮、返回按钮 */}
  </div>
  <div className="canvas-bottom-control-section canvas-bottom-control-section-center">
    {/* staff 增减 */}
  </div>
  <div className="canvas-bottom-control-section canvas-bottom-control-section-right">
    {/* 保存、计算伤害 */}
  </div>
</div>
```

### 4. CanvasArea 拆分与左对齐

修改文件：

- `src/components/CanvasBoard/components/CanvasArea.tsx`
- 必要时修改 `src/components/CanvasBoard/CanvasBoard.css`

要求：

- 移除 `CanvasArea` 顶部 `Toolbar`。
- 原 `Toolbar` 按钮能力交给 `CanvasBottomControlBar`。
- `.canvas-container` 取消水平 padding。
- `.canvas-container` 内容向左对齐。
- `CanvasArea` 外部 props 尽量保持不变。
- 不改 `renderStaffGroup`、`renderLines`、`renderSkillButtons` 的业务结果。
- 不改 `.canvas` 内部坐标系。

### 5. 背景装饰层

新增或内联：

- `CanvasBackgroundLayer`

要求：

- 承载 `skew-panel`、`skew-panel-bottom`。
- 固定到背景层。
- 不改变现有视觉表现。
- 不参与左右 84% / 16% 布局计算。
- 不影响任何交互。

### 6. Overlay 层

新增或内联：

- `CanvasOverlayLayer`

要求：

- 承载 `OperatorConfigPanel`。
- 承载 `DraggingOverlay`。
- 不改变浮层行为。
- 不改变配置面板打开/关闭逻辑。
- 不改变拖拽跟随层行为。

## [特别说明：伤害节点]

关闭侧边栏后右侧出现无效伤害节点，本轮只观察记录。

原因：

- 后续伤害节点交互会单独重写。
- 0.5.6 不修节点交互。
- 0.5.6 不改节点算法。

本轮禁止修改：

- `nodeCount`
- `nodeSpacing`
- `canvasWidthPercent`
- `useCanvasDrag`
- `snapToNearestNode`
- 节点吸附逻辑
- 伤害节点交互逻辑

如果隐藏 `SidePanel` 后仍能看到无效伤害节点，只记录现象，不在本轮修。

## [不要动]

- 不要改 `SidePanel` 内部逻辑。
- 不要改 `DamageTab`。
- 不要改 `OperatorConfigPanel` 内部逻辑。
- 不要改 `SkillButton` 弹窗内容。
- 不要改 Buff 添加、删除、拖拽逻辑。
- 不要改 sessionStorage key。
- 不要改伤害计算公式。
- 不要改节点算法。
- 不要改拖拽算法。
- 不要改 `skew-panel` / `skew-panel-bottom` 视觉表现。
- 不要保留独立孤立的 `.workbench-top-trigger` 悬浮按钮。

## [验收标准 AC]

### AC1：工作台标签正确

- 抽屉内不再显示 `全部显示`。
- 抽屉内显示 `选人 / 排轴 / 侧边栏 / 角色配置`。
- `排轴` 不显示右侧 `SidePanel`。
- `侧边栏` 显示右侧 `SidePanel`。
- `角色配置` 仍能强制打开配置面板。

### AC2：左右布局正确

- 左侧主工作区宽度固定 84%。
- 右侧 `SidePanel` 槽位宽度固定 16%。
- `SidePanel` 在右侧显示。
- `SidePanel` 隐藏时右侧槽位保留为空白。
- 左侧主工作区不因 `SidePanel` 显示/隐藏而改变宽度。
- 已放置技能按钮视觉位置不漂移。

### AC3：底部按钮区正确

- 工作台触发按钮进入底部按钮区。
- 返回、保存、增减 staff 组等按钮进入底部按钮区。
- 底部按钮区高度 30px。
- 底部按钮区分左 / 中 / 右三个同层区域。
- 按钮压缩排列。
- 按钮整体向左对齐。
- 点击工作台触发按钮仍能打开顶部下滑抽屉。
- 按钮功能保持原样。

### AC4：CanvasArea 正确

- `CanvasArea` 顶部不再显示 `Toolbar`。
- `.canvas-container` 取消水平 padding。
- 画布主体向左对齐。
- `canvas-container > canvas` 结构保留。
- staff 线、节点、技能按钮仍在 `.canvas` 内渲染。

### AC5：背景层不回退

- 平行四边形装饰物仍显示。
- 装饰物固定在背景层。
- 装饰物不参与左右 84% / 16% 布局计算。
- 装饰物不影响画布拖拽、SidePanel 显示、配置面板浮层。

### AC6：拖拽和业务不回退

- 从 `SkillSandbox` 拖技能到画布仍能吸附节点。
- 已放置技能按钮拖动仍能吸附节点。
- 关闭/显示 `SidePanel` 后拖拽坐标不漂移。
- 双击技能按钮弹窗后强制显示右侧 `SidePanel`。
- Buff 添加、删除、拖拽不回退。
- 角色配置面板不回退。

### AC7：伤害节点只观察

- 隐藏 `SidePanel` 后观察右侧是否仍有无效伤害节点。
- 如仍出现，只记录现象。
- 本轮不修伤害节点。
- 本轮不改节点算法。

### AC8：构建通过

- `npm run build` 必须通过。

## [回归检查项]

1. 打开工作台抽屉，确认没有 `全部显示` 标签。
2. 点击 `排轴`，确认右侧 `SidePanel` 不显示。
3. 点击 `侧边栏`，确认 `SidePanel` 显示在右侧 16% 区域。
4. 再次点击 `排轴`，确认右侧槽位留白，左侧主工作区仍为 84%。
5. 检查画布不左移，已放置技能按钮不漂移。
6. 检查 `.canvas-container` 水平 padding 已取消，画布主体左对齐。
7. 检查工作台触发按钮、返回、保存、增减 staff 组等按钮都在底部 30px 统一按钮区。
8. 检查底部按钮区分左 / 中 / 右三个同层区域，按钮压缩并左对齐。
9. 点击工作台触发按钮，确认顶部下滑抽屉仍打开。
10. 拖技能到画布，确认吸附节点正常。
11. 移动已有技能按钮，确认吸附节点正常。
12. 双击技能按钮打开弹窗，确认 `SidePanel` 强制显示在右侧。
13. 点击返回、保存、增减 staff 组，确认功能不回退。
14. 检查平行四边形背景装饰物仍保持原视觉效果。
15. 观察右侧无效伤害节点，如仍存在只记录，不修。
16. 执行 `npm run build`。

## [给 Trae 的执行指令]

按以下顺序执行：

1. 删除 `全部显示` 标签，保留 `选人 / 排轴 / 侧边栏 / 角色配置`。
2. 固定背景装饰层，不改视觉。
3. 建立左 84% 主工作区、右 16% SidePanel 槽位。
4. 建立底部 30px 统一按钮区，把工作台触发按钮和 Canvas 工具按钮都收进去。
5. 取消 `.canvas-container` 水平 padding，并让画布主体左对齐。
6. 移除 `CanvasArea` 顶部 `Toolbar`，按钮能力交给底部统一按钮区。
7. 保持 Overlay 层行为不变。
8. 跑构建和回归。

禁止碰节点算法、拖拽算法、Buff、缓存、伤害计算。
