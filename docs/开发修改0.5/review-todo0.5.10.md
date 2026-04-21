# review-todo0.5.10：技能按钮堆叠形态重构

## [任务理解]

本轮修改画布上的 A / B / E / Q 技能按钮视觉形态。

目标是把当前纯圆形技能按钮，改成“圆形技能图标 + 横向长方形底座”的堆叠形态。

这是视觉层重构，不改吸附算法，不改坐标语义，不改 Buff / 伤害 / timeline 数据主链路。

## [最终设计确认]

### 1. 新形态

技能按钮由两部分组成：

```text
圆形技能图标层
+ 80px * 30px 长方形技能类型底座
```

### 2. 锚点与位置规则

必须保持当前吸附语义不变。

当前 `button.position.x / button.position.y` 是吸附点，也是节点中心 / 单元格中心。

新按钮视觉必须满足：

```text
圆形技能图标圆心 = button.position
长方形底座左上角 = button.position
表格节点中心 = button.position
```

也就是说：圆形中心、长方形左上角、表格节点中心三者完全重合。

上一版错误地把“长方形中心”写成 `button.position`，导致圆形位置错误。本轮必须纠正：长方形卡片的位置是正确的，圆形应围绕长方形左上角摆放。

这是纯 CSS / JSX 结构修改，不允许改 `gridSnapLayout.ts`。

### 3. 尺寸

长方形底座：

```text
width: 80px
height: 30px
```

圆形技能图标：

```text
直径沿用当前 size，即 props.size / canvasConfig.skillButtonSize
默认当前约 44px
半径不变
```

### 4. 内容

圆形层：
- 优先显示技能图标。
- 图标加载失败时显示技能类型 `A / B / E / Q` 兜底。

长方形层：
- 显示技能类型 `A / B / E / Q`。
- 文字右侧居中。

### 5. 色彩

长方形底座：
- 使用角色元素色。
- 来源沿用当前 `getElementBackgroundColor(element ?? '')`。

圆形层：
- 继续使用技能图标。
- 底色可沿用角色元素色，保证半透明图标正常显示。

### 6. 层级

```text
圆形技能图标在上层
长方形底座在下层
```

圆形应覆盖长方形中心区域。
圆形的圆心必须落在长方形左上角，不是长方形中心。

### 7. 状态

常态：
- 长方形有 `1px` 半透明深色边框。
- 圆形不作为主高亮对象。

悬停态：
- 长方形底色轻微提亮。
- 圆形不明显变化，避免影响吸附感知。

选中态：
- 高亮长方形外框。
- 推荐使用 `2px` 黄绿色 / Excel 绿高亮。
- 不以圆形边框作为主要选中提示。

拖拽态：
- 整体透明度约 `0.75`。
- 不改变锚点，不改变实际定位。
- 再次拖动已有按钮必须仍然可用，不能因为外层容器变成 `width: 0; height: 0` 导致命中区域失效。

锁定态：
- 如需要显示，放在长方形右上角小锁标识。
- 不遮挡技能类型文字。
- 不影响圆形图标。

## [当前代码现状]

### 文件

- `src/components/CanvasBoard/SkillButton.tsx`
- `src/components/CanvasBoard/SkillButton.css`

### 当前结构

`SkillButton.tsx` 当前把 `.canvas-skill-button` 本身作为圆形按钮：

```tsx
<div
  className={`canvas-skill-button ...`}
  style={{
    left: position.x - size / 2,
    top: position.y - size / 2,
    width: size,
    height: size,
    backgroundColor: getElementBackgroundColor(element ?? ''),
  }}
>
  <img className="skill-icon" />
  <span className="skill-label">{skillType}</span>
  <span className="skill-character-name">{characterName}</span>
</div>
```

当前 CSS：

```css
.canvas-skill-button {
  position: absolute;
  overflow: hidden;
  border-radius: 50%;
  ...
}
```

这不再适合新形态，因为外层需要变成“吸附点锚点容器”，长方形从该点向右下展开，圆形围绕该点居中。

## [必须改]

### 1. 改造 JSX 结构

文件：`src/components/CanvasBoard/SkillButton.tsx`

把当前单层圆形结构改为：

```tsx
<div
  className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''}`}
  style={{
    left: position.x,
    top: position.y,
    ['--skill-button-size' as string]: `${size}px`,
    ['--skill-button-radius' as string]: `${size / 2}px`,
    ['--skill-button-element-color' as string]: getElementBackgroundColor(element ?? ''),
  }}
  onMouseDown={handleMouseDown}
  onClick={handleClick}
  onContextMenu={onContextMenu}
>
  <div className="skill-button-base" aria-hidden="true">
    <span className="skill-button-type">{skillType}</span>
    {isLocked ? <span className="skill-button-lock">锁</span> : null}
  </div>

  <div className="skill-button-orb">
    {skillIconUrl ? (
      <img className="skill-icon" ... />
    ) : null}
    <span className="skill-label">{skillType}</span>
  </div>
</div>
```

要求：
- 外层 `.canvas-skill-button` 只作为锚点容器。
- 外层 `left/top` 必须直接等于 `position.x / position.y`。
- 不再使用 `left: position.x - size / 2`。
- 不再使用 `top: position.y - size / 2`。
- 外层不再设置 `width: size; height: size` 表示圆形按钮。
- 圆形和长方形由子元素负责布局。
- 长方形底座左上角必须与外层锚点重合。
- 圆形图标圆心必须与外层锚点重合。
- 外层锚点不能丢失鼠标事件命中区域，必须保证再次拖动已有按钮仍可触发 `onMouseDown`。

### 2. 删除旧的干员名展示

文件：`src/components/CanvasBoard/SkillButton.tsx`

旧结构里有：

```tsx
<span className="skill-character-name">{characterName}</span>
```

新设计不显示干员名。

要求：
- 画布按钮本体只显示技能类型。
- 不显示角色名。
- 弹窗内角色名不受影响。

### 3. 调整图标加载逻辑

当前 `handleIconLoad` 会隐藏 `.skill-label, .skill-character-name`。

新结构中：
- `.skill-label` 是圆形图标兜底文字。
- `.skill-button-type` 是长方形底座文字，必须始终显示。
- 不再存在 `.skill-character-name`。

必须改为：

```ts
parent?.querySelectorAll('.skill-label').forEach(...)
```

要求：
- 图标加载成功，只隐藏圆形内兜底 `.skill-label`。
- 不隐藏长方形内 `.skill-button-type`。
- 图标加载失败，圆形内 `.skill-label` 显示。
- 长方形内 `.skill-button-type` 始终显示。

### 4. 重写技能按钮 CSS

文件：`src/components/CanvasBoard/SkillButton.css`

新 CSS 语义：

```css
.canvas-skill-button {
  position: absolute;
  left: var(...); /* 由 inline style 控制 */
  top: var(...);
  width: 0;
  height: 0;
  overflow: visible;
  z-index: 10;
  cursor: grab;
  user-select: none;
}
```

长方形底座：

```css
.skill-button-base {
  position: absolute;
  left: 0;
  top: 0;
  width: 80px;
  height: 30px;
  box-sizing: border-box;
  background: var(--skill-button-element-color);
  border: 1px solid rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 10px 0 calc(var(--skill-button-radius) + 8px);
  z-index: 1;
  pointer-events: none;
}
```

圆形层：

```css
.skill-button-orb {
  position: absolute;
  left: calc(-1 * var(--skill-button-radius));
  top: calc(-1 * var(--skill-button-radius));
  width: var(--skill-button-size);
  height: var(--skill-button-size);
  border-radius: 50%;
  overflow: hidden;
  background: var(--skill-button-element-color);
  border: 1px solid rgba(255, 255, 255, 0.9);
  z-index: 2;
  pointer-events: none;
}
```

技能类型文字：

```css
.skill-button-type {
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  color: #111;
  pointer-events: none;
}
```

选中态：

```css
.canvas-skill-button.selected .skill-button-base {
  border: 2px solid #fff59d;
  box-shadow: 0 0 0 1px rgba(33, 115, 70, 0.35);
}
```

拖拽态：

```css
.canvas-skill-button.dragging {
  opacity: 0.75;
  cursor: grabbing;
  z-index: 40;
}
```

悬停态：

```css
.canvas-skill-button:hover .skill-button-base {
  filter: brightness(1.08);
}
```

要求：
- 不要让 hover 改变布局尺寸。
- 不要用 `transform: scale(...)`，会破坏视觉定位判断。
- 外层容器不做圆角、不做 overflow hidden。
- `pointer-events` 保持外层可接收事件，子层不抢事件。
- 长方形必须从锚点向右下展开，不能以锚点为中心。
- 圆形必须以锚点为圆心。
- 如果外层 `width: 0; height: 0` 导致再次拖动命中失败，必须改为外层覆盖完整视觉区域，但不能改变视觉定位。例如：

```css
.canvas-skill-button {
  position: absolute;
  left: position.x;
  top: position.y;
  width: 80px;
  height: 30px;
  overflow: visible;
}
```

说明：外层可有命中宽高，但其左上角仍是锚点，不能回到 `position - size / 2`。

### 4.1. 必须完成交互状态

上一版未完整落实高亮、悬停、拖动状态，本轮必须补齐。

要求：
- `.canvas-skill-button:hover .skill-button-base` 必须有可见悬停反馈。
- `.canvas-skill-button.selected .skill-button-base` 必须有明显高亮外框。
- `.canvas-skill-button.dragging` 必须有可见拖动态，例如透明度降低、层级提高、cursor 变为 grabbing。
- 这些状态不能改变按钮锚点。
- 这些状态不能让圆形、长方形发生位置偏移。
- 再次拖动已有按钮必须仍然能触发。

### 5. 保持吸附代码完全不动

禁止修改：
- `src/core/calculators/gridSnapLayout.ts`
- `src/components/CanvasBoard/hooks/useCanvasDrag.ts`
- `src/components/CanvasBoard/components/CanvasArea.tsx` 的节点坐标
- `src/utils/layout.ts`

本轮只改：
- `SkillButton.tsx`
- `SkillButton.css`

如果发现必须改吸附代码，停止并重新 review，不要顺手改。

## [不要动]

- 不改按钮 `position` 数据语义。
- 不改 `position.x / position.y` 的写入。
- 不改 `gridToCanvasCoords`。
- 不改 `snapGridNodeX`。
- 不改 `findNearestGridLine`。
- 不改表格尺寸。
- 不改节点小斜线。
- 不改谱线。
- 不改 Buff。
- 不改伤害弹窗逻辑。
- 不改技能按钮弹窗业务逻辑。
- 不改右键删除和锁定逻辑，只允许增加锁定视觉标识。
- 不破坏已验证正确的再次拖动代码。

## [验收标准 AC]

### 视觉

- 技能按钮显示为“圆形图标 + 80px * 30px 长方形底座”的堆叠形态。
- 圆形图标圆心与长方形底座左上角重合。
- 圆形图标圆心与表格节点中心重合。
- 长方形底座显示技能类型 `A / B / E / Q`。
- 技能类型文字在长方形右侧居中。
- 长方形底座使用角色元素色。
- 圆形层在长方形层上方。
- 图标加载成功时，圆形内只显示图标，长方形文字仍显示。
- 图标加载失败时，圆形内显示技能类型兜底，长方形文字仍显示。

### 状态

- 选中时只高亮长方形外框。
- 拖拽时整体透明度降低，但锚点不偏移。
- 悬停时有可见反馈，但不改变按钮占位和吸附点。
- 锁定时可以显示小锁，不遮挡技能类型。

### 交互

- 长按拖拽仍可触发。
- 已存在按钮的再次拖动仍可触发。
- 双击仍打开技能弹窗。
- 右键删除 / 锁定逻辑不回退。
- 拖拽释放后，按钮中心仍落在表格节点中心。
- 移动已有按钮后，视觉中心不漂移。

### 构建

- `npm run build` 通过。

## [回归检查项]

- 新增 A/B/E/Q 四类技能按钮，检查文字显示。
- 使用有技能图标的按钮，检查圆形图标和长方形文字同时正确。
- 使用图标加载失败场景，检查圆形兜底文字。
- 选中按钮，检查长方形外框高亮。
- 拖拽按钮，检查按钮锚点不偏移。
- 再次拖动已有按钮，检查能够正常移动并重新吸附。
- 双击按钮，检查弹窗仍打开。
- 锁定按钮，检查右键删除保护仍生效。
- 刷新页面，检查按钮位置和形态不回退。

## [给 Codex 自己的执行指令]

这不是给 Trae 的泛化 TODO，是后续自己执行代码用的精确约束。

执行时只改 `SkillButton.tsx` 和 `SkillButton.css`。

第一步先改 JSX 结构，使外层 `.canvas-skill-button` 成为 `position.x / y` 锚点容器。

第二步改 CSS，长方形 `80 * 30` 的左上角与锚点重合，圆形以同一锚点为圆心。

第三步检查图标加载逻辑，确保只隐藏圆形兜底文字，不隐藏长方形技能类型。

第四步必须完整实现 hover / selected / dragging 状态。

第五步构建并回归新增拖拽、再次拖动、双击、右键、锁定。
