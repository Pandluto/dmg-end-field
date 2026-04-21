# review-todo0.5.9：表格坐标系吸附节点重构

## [任务理解]

旧版 `review-todo0.5.9.md` 废弃。

本轮不再以“伤害节点计数与 sessionStorage 同步”为第一目标。当前 P0 是拖拽吸附仍使用旧谱线模型，已经和 0.5.8 的表格视觉模型分叉。

0.5.9 的目标改为：把技能按钮拖拽吸附切换到当前表格坐标系。

必须先保证：
- 拖拽释放后，技能按钮圆心吸附到当前表格 A-O 列中心。
- 拖拽释放后，技能按钮圆心吸附到当前谱线视觉行中心。
- 多组表格下，按钮能吸附到对应组的对应谱线。
- 保存恢复继续使用吸附后的合法 position / nodeIndex。

本轮允许改吸附坐标和必要的持久化字段写入，但禁止顺手重构 UI、Buff、伤害公式。

## [当前问题]

### P0：吸附中心与伤害节点视觉中心不同步

当前实测问题：
- 技能按钮吸附后，圆心没有落在伤害节点小斜线的视觉中心。
- 这说明“伤害节点渲染位置”和“吸附计算位置”不是同一套坐标源。

必须拆开检查：
- 视觉节点中心：`.canvas-damage-node` 实际显示中心。
- 吸附数学中心：`gridSnapLayout.ts` 算出的 `snappedX / snappedY`。

要求：
- 视觉节点的中心必须等于吸附节点中心。
- 不允许通过随手加 magic offset 让按钮“看起来差不多”。
- 必须让伤害节点 UI 和吸附函数共用同一套常量和同一套公式。

当前视觉节点如果使用小斜线：

```css
.canvas-damage-node {
  width: 2px;
  height: 6px;
  transform: rotate(135deg);
}
```

则它的定位必须围绕节点中心扣除自身尺寸：

```ts
style={{
  left: nodeCenterX - 1,
  top: nodeCenterY - 3,
}}
```

如果节点被放在单条谱线容器内部，且该容器自身 top 已经是谱线中心，则：

```ts
style={{
  left: nodeCenterX - 1,
  top: -3,
}}
```

禁止把 `nodeCenterX` 直接写到 `left`，因为 `left` 是元素左上角，不是元素中心。

### P0：X 轴吸附计算存在偏移

当前日志示例：

```text
gridX: 614 -> nodeIndex: 7, snappedX: 640
gridX: 654 -> nodeIndex: 8, snappedX: 720
```

如果节点中心为：

```text
A = 80
B = 160
...
H = 640
I = 720
```

则：

```ts
(654 - 80) / 80 = 7.175
Math.round(7.175) = 7
```

所以 `gridX: 654` 应吸附到 `nodeIndex: 7 / snappedX: 640`，不应吸附到 `nodeIndex: 8 / snappedX: 720`。

这说明当前 X 轴公式至少存在一种问题：
- 使用了错误的起点。
- 使用了错误的列宽。
- 对 `gridX` 额外加减了 offset。
- `gridX` 实际不是 `.canvas-grid-stack` 坐标，而是别的坐标。
- 用了 floor/ceil 或错误 round 输入。

必须修正为：

```ts
const firstNodeCenterX = GRID_FIRST_COLUMN_WIDTH + GRID_COLUMN_WIDTH / 2; // 80
const rawIndex = (gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH;
const nodeIndex = clampGridNodeIndex(Math.round(rawIndex));
const snappedX = firstNodeCenterX + nodeIndex * GRID_COLUMN_WIDTH;
```

边界必须成立：

```text
gridX = 614 -> rawIndex 6.675 -> nodeIndex 7 -> snappedX 640
gridX = 654 -> rawIndex 7.175 -> nodeIndex 7 -> snappedX 640
gridX = 681 -> rawIndex 7.5125 -> nodeIndex 8 -> snappedX 720
```

禁止用 `GRID_FIRST_COLUMN_WIDTH` 作为第一个节点中心。第一个节点中心不是 `40`，是 `80`。

### P0：吸附 Y 轴仍使用旧 CanvasConfig 谱线算法

当前文件：`src/utils/layout.ts`

现有逻辑：

```ts
calculateLineY(config, lineIdx) + config.staffHeight / 2 + groupOffset
```

这套算法来自旧谱线布局，依赖：
- `staffMarginTop`
- `staffMarginBottom`
- `staffHeight`
- `staffGroupHeight`
- `groupSpacing`

但当前视觉谱线已经改为表格坐标：

```ts
const LINE_ROW_INDICES = [3, 5, 7, 9];
const lineCenterY = (rowIndex - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
```

所以旧 Y 算法必须停止用于当前吸附。

### P0：吸附 X 轴仍使用旧节点算法

当前文件：`src/utils/layout.ts`

现有逻辑：

```ts
const nodeSpacing = config.nodeSpacing || getNodeSpacing(config, canvasWidth);
const relativeX = position.x - config.marginLeft;
const nearestNodeIndex = Math.round(relativeX / nodeSpacing);
const snappedX = config.marginLeft + targetNodeIndex * nodeSpacing;
```

旧配置默认是：

```ts
nodeCount: 40;
marginLeft: 80;
nodeSpacing: 22;
```

当前表格节点是：

```ts
第 0 列宽 40px
普通列宽 80px
A-O 共 15 列
第 1 个节点中心 = 40 + 0 * 80 + 40 = 80
第 15 个节点中心 = 40 + 14 * 80 + 40 = 1200
```

所以旧 X 算法必须停止用于当前吸附。

### P0：鼠标坐标原点仍是 canvas-container，不是表格坐标系

当前文件：`src/components/CanvasBoard/hooks/useCanvasDrag.ts`

现有逻辑：

```ts
const canvasRect = canvasRef.current.getBoundingClientRect();
const mouseX = e.clientX - canvasRect.left;
```

但当前表格不从 `canvas-container` 左上角开始：
- `.canvas-grid-shell` 有 `left: 10px; top: 10px`。
- `.canvas-grid-stack` 有 `width: 1240px; margin: 0 auto; padding-top: 30px; padding-bottom: 90px`。
- 表格组在 `.canvas-grid-stack` 内。

因此拖拽吸附必须先把鼠标点换算到 `.canvas-grid-stack` 坐标系，不能直接使用 `canvas-container` 坐标。

### P1：staffIndex / lineIndex 语义存在混用风险

当前文件：`src/components/CanvasBoard/hooks/useCanvasDrag.ts`

现有风险代码：

```ts
moveTimelineButtonToStaff(oldStaffIndex, lineIndex, buttonId, snappedPosition, nodeIndex);
updateSkillButtonPosition(lineIndex, buttonId, snappedPosition, nodeIndex);
addTimelineButton({ staffIndex: lineIndex, nodeIndex, position: snappedPosition });
```

这里把 `lineIndex` 当作 `staffIndex` 写入的风险很高。

当前语义必须明确：
- `staffIndex` = 第几组表格 / 第几组谱线组。
- `lineIndex` = 该组内第几条谱线，范围 `0..3`。
- `nodeIndex` = 该条谱线上的第几个节点，范围 `0..14`。

不允许继续把 `lineIndex` 当 `staffIndex` 用。

## [坐标规则]

### 1. 表格坐标常量

建议新增统一坐标文件：

`src/core/calculators/gridSnapLayout.ts`

必须导出：

```ts
export const GRID_FIRST_COLUMN_WIDTH = 40;
export const GRID_COLUMN_WIDTH = 80;
export const GRID_ROW_HEIGHT = 30;
export const GRID_NODE_COUNT = 15;
export const GRID_GROUP_WIDTH = 1240;
export const GRID_GROUP_HEIGHT = 270;
export const GRID_STACK_PADDING_TOP = 30;
export const GRID_STACK_PADDING_BOTTOM = 90;
export const LINE_ROW_INDICES = [3, 5, 7, 9] as const;
```

说明：
- `LINE_ROW_INDICES` 沿用当前手测正确值。
- 当前代码已经由用户手动确认：

```ts
const lineCenterY = (rowIndex - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
```

- 不允许再把 `LINE_ROW_INDICES` 改回 `[2,4,6,8]`。

### 2. 节点 X 坐标

```ts
export function getGridNodeCenterX(nodeIndex: number): number {
  return GRID_FIRST_COLUMN_WIDTH + nodeIndex * GRID_COLUMN_WIDTH + GRID_COLUMN_WIDTH / 2;
}
```

规则：
- `nodeIndex` 范围 `0..14`。
- `0 -> A 列中心 = 80px`。
- `14 -> O 列中心 = 1200px`。

吸附 nodeIndex 计算必须以第一个节点中心 `80px` 为起点：

```ts
export function snapGridNodeX(gridX: number): { nodeIndex: number; x: number } {
  const firstNodeCenterX = getGridNodeCenterX(0);
  const rawIndex = (gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH;
  const nodeIndex = clampGridNodeIndex(Math.round(rawIndex));

  return {
    nodeIndex,
    x: getGridNodeCenterX(nodeIndex),
  };
}
```

禁止：
- `Math.round(gridX / GRID_COLUMN_WIDTH)`。
- `Math.round((gridX - GRID_FIRST_COLUMN_WIDTH) / GRID_COLUMN_WIDTH)`。
- `Math.floor(...)`。
- `Math.ceil(...)`。
- 在 `gridX` 上额外加减手调 offset。

### 3. 谱线 Y 坐标

```ts
export function getGridLineCenterY(lineIndex: number): number {
  const rowIndex = LINE_ROW_INDICES[lineIndex];
  return (rowIndex - 1) * GRID_ROW_HEIGHT + GRID_ROW_HEIGHT / 2;
}
```

规则：
- `lineIndex` 范围 `0..3`。
- 第 1 条谱线使用 `LINE_ROW_INDICES[0] = 3`。
- 公式是当前手测确认值，不允许再改。

### 4. 组 Y 坐标

每组 `.canvas-grid-row` 当前高度是 `270px`。

```ts
export function getGridGroupTop(staffIndex: number): number {
  return GRID_STACK_PADDING_TOP + staffIndex * GRID_GROUP_HEIGHT;
}
```

注意：
- 如果 `.canvas-grid-row` 后续又增加真实 gap，必须同步更新这里。
- 当前 `gap: 0`，不要加 gap。
- `padding-bottom: 90px` 只用于底部留白，不参与组内吸附。

### 5. 画布内绝对坐标

技能按钮 position 仍然应保存为相对 `canvas-container` 的坐标。

如果计算基于 `.canvas-grid-stack`，最终需要换回 `canvas-container` 坐标：

```ts
canvasX = gridStackOffsetX + getGridNodeCenterX(nodeIndex);
canvasY = gridStackOffsetY + getGridGroupTop(staffIndex) + getGridLineCenterY(lineIndex);
```

其中：
- `gridStackOffsetX = gridStackRect.left - canvasRect.left`
- `gridStackOffsetY = gridStackRect.top - canvasRect.top`

## [必须改]

### 1. 新增表格吸附坐标工具

新增文件：

`src/core/calculators/gridSnapLayout.ts`

必须包含：

```ts
export function clampGridNodeIndex(index: number): number;
export function getGridNodeCenterX(nodeIndex: number): number;
export function getGridLineCenterY(lineIndex: number): number;
export function getGridGroupTop(staffIndex: number): number;
export function findNearestGridLine(gridY: number, staffCount: number, characterId: string, selectedCharacters: { id: string }[]): { staffIndex: number; lineIndex: number; lineY: number } | null;
export function snapGridNodeX(gridX: number, occupiedNodeIndices?: Set<number>): { nodeIndex: number; x: number };
```

要求：
- 文件不能 import React。
- 文件不能读写 DOM。
- 文件不能读写 sessionStorage。
- 文件只做纯坐标计算。
- `snapGridNodeX(614)` 必须返回 `{ nodeIndex: 7, x: 640 }`。
- `snapGridNodeX(654)` 必须返回 `{ nodeIndex: 7, x: 640 }`。
- `snapGridNodeX(681)` 必须返回 `{ nodeIndex: 8, x: 720 }`。

### 1.1. 统一视觉节点和吸附节点的坐标来源

文件：
- `src/components/CanvasBoard/components/CanvasArea.tsx`
- `src/core/calculators/gridSnapLayout.ts`

要求：
- `CanvasArea.tsx` 渲染伤害节点时，不再手写节点 X/Y 公式。
- 视觉节点必须调用或复用 `getGridNodeCenterX()` 和 `getGridLineCenterY()` 的同源常量。
- 如果不直接 import 工具函数，也必须从同一个常量文件 import 常量，禁止复制另一套数字。

错误示例：

```ts
const nodeCenterX = FIRST_COLUMN_WIDTH + nodeIndex * COLUMN_WIDTH + COLUMN_WIDTH / 2;
```

正确方向：

```ts
const nodeCenterX = getGridNodeCenterX(nodeIndex);
```

节点小斜线定位必须扣除自身尺寸：

```tsx
<div
  className="canvas-damage-node"
  style={{ left: nodeCenterX - 1, top: -3 }}
/>
```

如果当前节点容器不是以谱线中心为 `top: 0`，必须先确认容器坐标，再扣除节点高度，不能盲写。

### 2. 修改 `useCanvasDrag.ts` 的坐标换算

文件：`src/components/CanvasBoard/hooks/useCanvasDrag.ts`

必须改：
- 不再直接用 `mouseX = e.clientX - canvasRect.left` 作为吸附 X。
- 获取 `.canvas-grid-stack` 的 DOMRect。
- 将鼠标坐标换算为 gridStack 坐标：

```ts
const canvasRect = canvasRef.current.getBoundingClientRect();
const gridStack = canvasRef.current.querySelector('.canvas-grid-stack');
const gridStackRect = gridStack.getBoundingClientRect();

const gridX = e.clientX - gridStackRect.left;
const gridY = e.clientY - gridStackRect.top;
const gridStackOffsetX = gridStackRect.left - canvasRect.left;
const gridStackOffsetY = gridStackRect.top - canvasRect.top;
```

然后：
- 用 `gridY` 找最近谱线。
- 用 `gridX` 找最近节点。
- 最终保存到按钮的 position 必须换回 canvas 坐标。

### 3. 停止当前拖拽吸附使用旧 `findNearestLine / snapToNearestNode`

文件：`src/components/CanvasBoard/hooks/useCanvasDrag.ts`

要求：
- 当前拖拽释放逻辑不再调用旧 `findNearestLine()`。
- 当前拖拽释放逻辑不再调用旧 `snapToNearestNode()`。
- 可以保留旧函数给历史代码，但当前 CanvasBoard 吸附链路必须走 `gridSnapLayout.ts`。

禁止：
- 在旧 `layout.ts` 里继续硬塞表格规则导致旧函数语义混乱。
- 同时混用新旧算法。

### 4. 修正 staffIndex / lineIndex 写入

文件：`src/components/CanvasBoard/hooks/useCanvasDrag.ts`

必须检查并修正：

```ts
moveTimelineButtonToStaff(oldStaffIndex, lineIndex, buttonId, snappedPosition, nodeIndex);
updateSkillButtonPosition(lineIndex, buttonId, snappedPosition, nodeIndex);
addTimelineButton({ staffIndex: lineIndex, nodeIndex, position: snappedPosition });
```

正确语义：

```ts
moveTimelineButtonToStaff(oldStaffIndex, staffIndex, buttonId, snappedPosition, nodeIndex);
updateSkillButtonPosition(staffIndex, buttonId, snappedPosition, nodeIndex);
addTimelineButton({ staffIndex, nodeIndex, position: snappedPosition });
```

说明：
- `staffIndex` 来自最近表格组。
- `lineIndex` 只是组内第几条谱线。
- 如果现有 `updateSkillButtonPosition` 参数名叫 `staffIndex`，必须传 `staffIndex`，不能传 `lineIndex`。

### 5. 保留 lineIndex 到 SkillButton 数据

当前按钮数据中应同时存在：
- `staffIndex`
- `lineIndex`
- `nodeIndex`
- `position`

如果当前类型或持久化只保存了部分字段，本轮先保证新增/移动按钮时 runtime 数据正确。

本轮不强制完整迁移旧缓存；旧缓存兼容可以放到后续小修，但不能继续写错新数据。

### 6. 节点冲突检测切换到新坐标

旧冲突检测：

```ts
btn.position.x === nodeX
```

风险：浮点/旧坐标可能导致误判。

本轮建议：
- 优先按 `staffIndex + lineIndex + nodeIndex + characterId` 判断占用。
- 如果旧按钮没有 `nodeIndex`，再 fallback 到 position.x。

要求：
- 同一角色、同一组、同一条谱线、同一 nodeIndex 不允许重复占用。
- 不同角色可以按现有规则处理，不要扩大需求。

## [不要动]

- 不改 0.5.8 的谱线视觉结构。
- 不改头像尺寸和头像名字位置。
- 不改小斜线节点样式。
- 不改表格颜色。
- 不改右区、下区布局。
- 不改 Buff 链路。
- 不改伤害公式。
- 不改 `selectedBuff`。
- 不重写 `CanvasBoard/index.tsx` 布局。
- 不把本轮做成大规模数据迁移。

## [验收标准 AC]

### 基础吸附

- 拖动技能到 A 列，按钮圆心落在 A 列中心。
- 拖动技能到 O 列，按钮圆心落在 O 列中心。
- 拖动技能到 A-O 之间，按钮吸附到最近列中心。
- 不会吸附到 P 列或第 16 个节点。
- `gridX = 614` 时吸附到 `nodeIndex = 7 / x = 640`。
- `gridX = 654` 时吸附到 `nodeIndex = 7 / x = 640`。
- `gridX = 681` 时吸附到 `nodeIndex = 8 / x = 720`。
- 技能按钮圆心必须与小斜线伤害节点视觉中心重合。

### 谱线吸附

- 拖动第 1 名干员技能，吸附到该干员对应谱线。
- 拖动第 2 名干员技能，吸附到该干员对应谱线。
- 第 1 / 2 / 3 / 4 条谱线的吸附 Y 与视觉谱线重合。

### 多组吸附

- 第 1 组表格可以吸附。
- 第 2 组表格可以吸附。
- 第 3 组表格可以吸附。
- 在第 2 组释放时，`staffIndex` 写入为 `1`，不是 `lineIndex`。
- 在第 3 组释放时，`staffIndex` 写入为 `2`，不是 `lineIndex`。

### 数据写入

- 新增按钮写入 `staffIndex` 正确。
- 新增按钮写入 `lineIndex` 正确。
- 新增按钮写入 `nodeIndex` 范围为 `0..14`。
- 新增按钮写入 `position.x / position.y` 与 UI 圆心一致。
- 移动已有按钮后，上述字段仍正确。

### 回归

- 技能按钮拖拽不偏移。
- 技能按钮移动后刷新不明显漂移。
- 多组表格下按钮不会跳回第一组。
- `npm run build` 通过。

## [回归检查项]

- 选 4 名干员进入排轴。
- 添加第 2、3 组表格。
- 分别向第 1、2、3 组拖入技能按钮。
- 检查每个按钮是否在对应组、对应谱线、对应列中心。
- 移动第 2 组按钮到第 3 组，确认不会写成 lineIndex。
- 将按钮拖到 O 列右侧，确认最多吸附 O 列。
- 将按钮拖到 A 列左侧，确认最少吸附 A 列。
- 刷新后检查位置不明显漂移。

## [给 Trae 的执行指令]

先不要碰 sessionStorage 迁移。

先把拖拽吸附坐标切到表格坐标系：新增 `gridSnapLayout.ts`，修改 `useCanvasDrag.ts`，停止当前链路调用旧 `findNearestLine / snapToNearestNode`。

本轮最关键验收是：按钮圆心必须吸附到视觉表格节点中心，且多组表格 staffIndex 写入正确。
