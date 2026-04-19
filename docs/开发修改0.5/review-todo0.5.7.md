# review-todo0.5.7：左区表格背景化

## [任务理解]

本轮只处理排轴工作台左区视觉层。

左区当前仍保留旧谱线视觉：黑框、干员头像、干员文字、谱线、伤害节点。下一步要把这些旧视觉元素从主界面移除，改成 Excel 表格样式背景装饰层。

本轮不是重写拖拽吸附，不是重写伤害节点交互，不是改技能按钮数据链路。

## [当前结构基线]

- 整体工作台已经是上区 / 中区 / 下区。
- 选人界面独占中区。
- 排轴界面中区拆为：
  - 左区：`canvas-left-zone`
  - 右区：`canvas-right-zone`
- 右区由 `ToolPanel` 和 `SkillSandbox` 同槽位互斥显示。
- 下区为 `canvas-bottom-zone`。

## [必须改]

### 1. 备份旧左区视觉渲染

Trae 必须先把当前 `CanvasArea.tsx` 中旧谱线视觉相关逻辑备份到组件备份目录，再从主渲染中移除。

涉及文件：
- `src/components/CanvasBoard/components/CanvasArea.tsx`
- `src/components/CanvasBoard/CanvasBoard.css`

建议新增备份目录：
- `src/components/CanvasBoard/components-backup/`

建议备份文件：
- `src/components/CanvasBoard/components-backup/CanvasStaffVisualBackup.tsx`
- `src/components/CanvasBoard/components-backup/CanvasStaffVisualBackup.css`

备份内容必须包含：
- 干员头像渲染逻辑
- 干员名称 / 文字渲染逻辑
- `staff-line` 谱线渲染逻辑
- `damage-node` 节点渲染逻辑
- `renderStaffGroup()`
- `renderLines()`
- 旧 CSS 中与上述 class 直接相关的样式

备份文件只作为归档，不允许被主代码 import。

### 2. 移除主界面旧视觉元素

从 `CanvasArea.tsx` 主渲染中移除：
- `renderStaffGroup()`
- `renderLines()`
- `staff-label-container`
- `sandbox-avatar` 在左区中的头像用途
- `sandbox-character-name` 在左区中的文字用途
- `staff-line`
- `damage-node`

保留：
- `SkillButtonComponent` 渲染
- `renderSkillButtons()`
- `canvasRef`
- `canvasWidth`
- `canvasHeight`
- `onCanvasClick`
- 技能按钮拖拽、右键、双击弹窗链路

### 3. 左区黑框去掉

去掉 `.canvas` 的黑色边框。

目标：
- 左区不再显示原来的黑框容器感。
- 技能按钮仍在 `.canvas` 坐标系内绝对定位。
- 不改变 `.canvas` 的 `position: relative`、`width`、`height`、`min-width`。

### 4. 新增 Excel 表格背景装饰层

参考文件：
- `docs/archive-def-1.1/表格.html`

新增一个只负责视觉的背景层。

建议组件：
- `src/components/CanvasBoard/components/CanvasGridBackground.tsx`

建议样式：
- 写入 `src/components/CanvasBoard/CanvasBoard.css`
- 或新增 `src/components/CanvasBoard/components/CanvasGridBackground.css`

背景层要求：
- 位于左区背景层，不参与交互。
- `pointer-events: none`。
- 不影响 SkillButton 的拖拽、点击、右键、双击。
- 表格线使用 CSS `linear-gradient`。
- 背景颜色参考 Excel 白色工作区。
- 网格线颜色可参考 `#e0e0e0`。

最小网格密度：
- y 轴至少 42 格。
- x 轴至少 21 格。

实现建议：
- 可用 CSS 变量控制单元格尺寸。
- 示例：`--grid-cell-width`、`--grid-cell-height`。
- 如果用固定 cell size，需要保证当前左区视口至少可见 21 列、42 行。
- 如果用百分比分割，建议 `repeat` 或多重 `linear-gradient` 生成视觉网格，不要创建大量 DOM 节点。

### 5. 表格背景与吸附逻辑只做视觉对应

节点吸附逻辑目前仍由现有拖拽系统控制。

本轮只让表格背景在视觉上类似吸附坐标，不要求每个格线完全等于当前吸附点。

必须避免：
- 修改 `useCanvasDrag.ts`
- 修改 `snapToNearestNode`
- 修改 `nodeSpacing`
- 修改 `nodeCount`
- 修改 `calculateLineY`
- 修改 `getGroupOffset`
- 修改 `CanvasConfig`

## [可选优化]

- 可以给 `CanvasGridBackground` 添加注释说明：这是视觉网格，不是交互网格。
- 可以把网格尺寸先写成 CSS 变量，方便后续与真实吸附点对齐。
- 可以保留旧 class 样式在备份 CSS 中，但主 CSS 中不应继续影响当前页面。

## [不要动]

- 不改技能按钮位置数据。
- 不改技能按钮缓存。
- 不改 Buff 链路。
- 不改 ToolPanel。
- 不改 SkillSandbox。
- 不改右区 16% 布局。
- 不改上下区布局。
- 不改选人页。
- 不改伤害计算。
- 不改拖拽吸附算法。
- 不改旧数据迁移。

## [验收标准 AC]

- AC1：左区不再显示 `.canvas` 黑色边框。
- AC2：左区不再显示旧干员头像、干员文字、谱线、伤害节点。
- AC3：旧头像 / 文字 / 谱线 / 节点渲染逻辑已备份到 `components-backup`，且主代码不 import 备份文件。
- AC4：左区显示 Excel 表格样式背景。
- AC5：表格背景至少具备 21 列、42 行的视觉密度。
- AC6：技能按钮仍显示在左区，并可拖动、右键删除、双击打开弹窗。
- AC7：拖拽技能按钮从右区 SkillSandbox 到左区仍可放置。
- AC8：打开 ToolPanel 后，已选 Buff 添加、删除、清空不回退。
- AC9：`npm run build` 通过。

## [回归检查项]

- 从选人进入排轴。
- 排轴模式右区显示 SkillSandbox。
- 从 SkillSandbox 拖技能按钮到左区。
- 已放置技能按钮的位置不因删除旧谱线视觉而丢失。
- 双击技能按钮打开弹窗，并强制显示 ToolPanel。
- ToolPanel 中单击 Buff 添加到技能按钮。
- 右键删除未锁定技能按钮。
- 锁定技能按钮后右键不删除。
- 保存 / 刷新恢复不回退。
- 上区打开后，中区下移仍正常。
- 下区按钮仍可点击。

## [给 Trae 的执行指令]

1. 先备份 `CanvasArea.tsx` 中头像、文字、谱线、节点相关渲染逻辑到 `components-backup`。
2. 再从主 `CanvasArea.tsx` 删除旧视觉渲染，只保留技能按钮渲染。
3. 去掉 `.canvas` 黑框，但保留 `.canvas` 坐标容器能力。
4. 新增 `CanvasGridBackground`，用 CSS 背景实现 Excel 表格视觉。
5. 将 `CanvasGridBackground` 放到左区背景层，确保不拦截鼠标事件。
6. 不修改任何拖拽吸附、缓存、Buff、伤害计算逻辑。
7. 跑 `npm run build`。
8. 按 AC 和回归检查项手测。
