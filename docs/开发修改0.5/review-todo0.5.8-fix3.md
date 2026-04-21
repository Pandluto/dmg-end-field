# review-todo0.5.8-fix3：多组谱线渲染最小修正

## [Review 结论]

上一版 fix3 的推荐结构会诱导执行者重排 `.canvas-grid-row / .canvas-grid-group / .canvas-staff-visual-group`，已经超出最小修复范围，容易造成排版完全错乱。该推荐结构废弃。

当前必须基于现有代码做被动 review 和最小修正。

当前 `CanvasArea.tsx` 的核心循环方向是对的：

```tsx
Array.from({ length: staffCount }, (_, index) => (
  <div key={`grid-row-${index}`} className="canvas-grid-row">
    <div className="canvas-grid-group">...</div>
    {renderStaffVisualGroup(index)}
  </div>
));
```

所以本轮不要重写 TSX 结构。P0 的检查重点改为：为什么实际 UI 只显示第一组谱线。优先排查 CSS 生效顺序、定位上下文、容器裁剪、组数来源，而不是重搭布局。

## [当前代码判断]

### 已经正确的部分

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

- `renderGridGroups()` 已按 `staffCount` 循环。
- 每个 `.canvas-grid-row` 内已经调用 `renderStaffVisualGroup(index)`。
- `renderStaffVisualGroup(staffIndex)` 已经带 `staffIndex` key。
- 谱线层不是全局只渲染一次。

这些不要改。

### 需要重点排查的部分

文件：`src/components/CanvasBoard/CanvasBoard.css`

当前 CSS 文件存在大量同名 class 多次定义，最终生效规则取决于后面的 override。

必须重点检查最终生效的这些 class：

- `.canvas-grid-stack`
- `.canvas-grid-row`
- `.canvas-grid-group`
- `.canvas-staff-visual-group`
- `.canvas-staff-visual-line`

P0 风险点：
- 后面的 CSS override 是否覆盖了 `.canvas-grid-row { position: relative; }`。
- 后面的 CSS override 是否覆盖了 `.canvas-grid-row { height: 270px; flex: 0 0 270px; }`。
- 后面的 CSS override 是否覆盖了 `.canvas-staff-visual-group { position: absolute; top: 0; left: 0; }`，导致定位参考错误。
- `.canvas-grid-stack` 是否实际只撑开第一组高度，后续组被挤压或裁剪。
- `.canvas-grid-shell / .canvas-container / .canvas-left-zone` 是否有某层 `overflow: hidden` 裁掉后续谱线 label 或谱线层。

## [必须改]

### 1. 不要重写 `CanvasArea.tsx` 结构

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

禁止改动：
- `renderGridGroups()` 的现有循环结构。
- `.canvas-grid-row` 内部“表格层 + 谱线层”的相邻关系。
- `renderStaffVisualGroup(index)` 的调用位置。
- 头像、名字、节点、行号算法。

只允许检查：
- `staffCount` 是否真实等于当前表格组数量。
- 添加组数后 `staffCount` 是否更新。
- React DevTools / DOM 中是否实际存在多个 `.canvas-staff-visual-group`。

如果 DOM 中已经存在多个 `.canvas-staff-visual-group`，不要再改 TSX，问题就是 CSS 显示或定位。

### 2. 保持当前排版，只修最终生效 CSS

文件：`src/components/CanvasBoard/CanvasBoard.css`

要求最终生效的 CSS 必须满足：

```css
.canvas-grid-row {
  position: relative;
  width: 1240px;
  height: 270px;
  flex: 0 0 270px;
  overflow: visible;
}

.canvas-staff-visual-group {
  position: absolute;
  top: 0;
  left: 0;
  width: 1240px;
  height: 270px;
  pointer-events: none;
  overflow: visible;
}
```

说明：
- 这里不是要求重排结构。
- 这里只是确保每个谱线组相对自己的 `.canvas-grid-row` 定位。
- `.canvas-grid-row` 必须是定位上下文。
- `.canvas-staff-visual-group` 不能相对 `.canvas-grid-stack` 或 `.canvas-container` 定位。

禁止：
- 把 `.canvas-grid-row` 改成 grid/flex 新布局。
- 把 `.canvas-grid-group` 改成 absolute inset 重新覆盖。
- 改 `.canvas-grid-stack` 的整体宽度、margin、padding-top。
- 改表格尺寸、列宽、行高。
- 改头像位置、节点样式、行号。

### 3. 检查 CSS override 顺序

文件：`src/components/CanvasBoard/CanvasBoard.css`

必须检查同名 class 的多处定义。

执行要求：
- 用搜索确认 `.canvas-grid-row` 是否只在最终段落定义一次，或最终定义是否覆盖早期定义。
- 用搜索确认 `.canvas-staff-visual-group` 后面没有再次覆盖。
- 如果存在后续覆盖，必须把修正放在文件后部 final overrides 区域，确保生效。
- 不允许在文件中间新增一段最终会被后面覆盖的 CSS。

### 4. 验证 DOM 数量，不凭感觉改布局

执行者必须在浏览器检查：

- 2 组表格时，DOM 中有 2 个 `.canvas-grid-row`。
- 2 组表格时，DOM 中有 2 个 `.canvas-staff-visual-group`。
- 3 组表格时，DOM 中有 3 个 `.canvas-grid-row`。
- 3 组表格时，DOM 中有 3 个 `.canvas-staff-visual-group`。

判断规则：
- 如果 DOM 数量不对，检查 `staffCount` 来源。
- 如果 DOM 数量对但只显示第一组，检查 CSS 定位/裁剪/覆盖。
- 不允许未检查 DOM 就重写结构。

### 5. 添加组数必须同步

如果当前添加组数按钮只增加表格背景，没有增加谱线组，检查 `staffCount` 是否是唯一组数来源。

要求：
- 表格组数量和谱线组数量必须同时来自 `staffCount`。
- 不允许新增单独的 `staffVisualCount`。
- 不允许硬编码只渲染第一组。

## [不要动]

- 不改头像尺寸。
- 不改头像和名字的相对位置。
- 不改头像和名字在第 `0` 列左侧的规则。
- 不改小斜线节点样式。
- 不改行号算法。
- 不改 `LINE_ROW_INDICES`，除非当前代码又回退到错误行号。
- 不改 `sessionStorage`。
- 不改 `timeline.data`。
- 不改 skill-button / buff-list。
- 不改 0.5.9 计数同步。
- 不改右区、下区布局。
- 不重写表格背景层。
- 不套用上一版 fix3 的重排方案。

## [验收标准 AC]

- 1 组表格时，DOM 中有 1 个 `.canvas-grid-row` 和 1 个 `.canvas-staff-visual-group`。
- 2 组表格时，DOM 中有 2 个 `.canvas-grid-row` 和 2 个 `.canvas-staff-visual-group`。
- 3 组表格时，DOM 中有 3 个 `.canvas-grid-row` 和 3 个 `.canvas-staff-visual-group`。
- 每组表格上方都能看到自己的完整谱线组。
- 后续组谱线不叠在第一组。
- 后续组谱线不被裁剪。
- 现有表格排版不变。
- 头像大小和名字位置不变。
- 节点仍是小斜线。
- 行号对齐不回退。
- `npm run build` 通过。

## [回归检查项]

- 添加第 2 组后，第二组表格上显示 4 条谱线。
- 添加第 3 组后，第三组表格上显示 4 条谱线。
- 第二组第一条谱线仍对齐第二组表格对应行。
- 第三组第四条谱线仍对齐第三组表格对应行。
- 左区滚动后，谱线组和对应表格组保持绑定。
- 技能按钮拖拽、释放、吸附不偏移。

## [给 Trae 的执行指令]

不要按上一版 fix3 重排布局。

先检查 DOM 数量，再检查 CSS 最终生效规则。当前 TSX 循环大方向已经正确，本轮只修导致后续谱线组不可见的最小问题。

禁止改头像、名字、节点、行号、存储。
