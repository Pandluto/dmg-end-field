# review-todo0.5.8-fix2：头像与名字位置关系恢复

## [Review 结论]

0.5.8-fix1 之后仍有 UI 还原偏差。

本轮只修头像和干员名字，不改谱线计数、不改节点计数、不改存储、不改表格结构。

当前错误方向：
- 篡改了归档里已调好的头像尺寸。
- 篡改了头像与干员名字的相对位置。
- 头像和名字被放进表格内部区域后遮挡表格。

正确方向：
- 头像、名字仍然属于“每条谱线行单元”。
- 头像、名字应脱离表格主体，放到第 `0` 列左侧。
- 表格层继续作为背景参照，谱线层独立覆盖。
- 第 `0` 列和 A-O 表格主体不能被头像/名字遮挡。

## [必须改]

### 1. 恢复归档头像尺寸和名字样式

文件：`src/components/CanvasBoard/CanvasBoard.css`

必须检查当前新增样式：
- `.canvas-staff-line-label`
- `.canvas-staff-avatar`
- `.canvas-staff-avatar-placeholder`
- `.canvas-staff-name`

当前错误示例：

```css
.canvas-staff-avatar {
  width: 24px;
  height: 24px;
}
```

这不允许。头像尺寸不能重新发明。

执行要求：
- 头像尺寸恢复到归档/沙盒体系使用的尺寸，不允许 24px。
- 优先复用归档里的 class 语义：`sandbox-avatar`、`sandbox-character-name`，或让新 class 与这些样式完全等价。
- 头像必须保留原来的圆形/当前已确认形态，不允许临时改尺寸、改比例、改位置关系。
- 名字字重、字号、颜色、与头像的相对位置必须恢复归档/沙盒体系，不允许用新造的 12px 普通字替代。

归档参考：

```tsx
<div className="staff-label-container" style={{ top: y + config.staffHeight / 2 - 18, left: 10 }}>
  <img className="sandbox-avatar" ... />
  <span className="sandbox-character-name" style={{ marginTop: 20 }}>
    {character?.name || `operator ${lineIndex + 1}`}
  </span>
</div>
```

归档 CSS：

```css
.staff-label-container {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  pointer-events: none;
}
```

沙盒头像参考：

```css
.sandbox-avatar {
  width: 44px;
  height: 44px;
  object-fit: cover;
}
```

注意：如果当前主题里 `.sandbox-avatar` 后续被覆盖为直角或其他形态，执行者不得在本轮再发明新的头像尺寸。只允许复用当前已确认的沙盒头像体系或与其等价。

### 2. 头像和名字移到第 0 列左侧

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`
文件：`src/components/CanvasBoard/CanvasBoard.css`

需求解释：
- 表格第 `0` 列是行号列。
- 头像和名字不应该占用第 `0` 列，也不应该盖住 A-O 表格主体。
- 头像和名字应位于第 `0` 列左边，仍然跟随对应谱线行。

执行要求：
- `.canvas-staff-line-label` / `.staff-label-container` 的 X 位置必须小于表格起点 `0`。
- 不允许把 label 放在 `left: 8px` 这种第 `0` 列内部位置。
- 推荐：

```css
.canvas-staff-line-label {
  position: absolute;
  left: -120px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}
```

- `left` 的具体值以不遮挡第 `0` 列和表格线为准。
- 如果 120px 不够，允许改成 `-132px` 或 `-140px`，但必须保持头像和名字整体在第 `0` 列左侧。
- 不允许通过缩小头像解决遮挡问题。

### 3. 为谱线 UI 层预留左侧 label 空间

文件：`src/components/CanvasBoard/CanvasBoard.css`

如果 label 放到第 `0` 列左侧后被 `.canvas-grid-row` / `.canvas-grid-shell` / `.canvas-container` 裁剪，必须调整对应容器的 overflow。

执行要求：
- 谱线 label 可以向表格左侧溢出显示。
- 表格主体尺寸不变。
- A-O 列和第 `0` 列位置不变。
- 不允许为了显示 label 改表格列宽。
- 不允许为了显示 label 改谱线行 Y 坐标。

可接受方案：

```css
.canvas-grid-row {
  overflow: visible;
}

.canvas-grid-group {
  overflow: visible;
}

.canvas-staff-visual-group {
  overflow: visible;
}
```

如果上层容器必须保留滚动，不能全局关闭滚动，只对谱线 label 所需层级放开可见溢出。

### 4. 保持头像名字仍属于每条谱线

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

要求：
- 不允许把头像/名字提到组级公共区域。
- 每条谱线行单元仍然包含自己的 label。
- 第 1 / 2 / 3 / 4 条谱线分别有自己的头像和名字。
- label 的 Y 坐标跟随该条谱线行中心。
- label 只是 X 方向移到第 `0` 列左侧。

### 5. 不要再修改节点和行号

本轮不要动：
- `LINE_ROW_LABELS = [2, 4, 6, 8]`
- `lineCenterY = ROW_HEIGHT + (rowLabel - 1) * ROW_HEIGHT + ROW_HEIGHT / 2`
- 15 个节点数量
- A-O 列中心算法
- 小斜线节点样式

除非当前代码仍未落实 fix1，否则本轮不要扩散。

## [不要动]

- 不改 `sessionStorage`。
- 不改 `timeline.data`。
- 不改 `skill-button` 表。
- 不改 `buff-list` 表。
- 不改 0.5.9 计数同步。
- 不改表格列宽：第 `0` 列 `40px`，普通列 `80px`。
- 不改表格第 `0` 行存在规则。
- 不改谱线对应行号规则。
- 不改节点样式为非小斜线。
- 不改右区、下区布局。
- 不改主题 token。

## [验收标准 AC]

- 头像尺寸恢复，不再是 24px 小头像。
- 头像和干员名字的相对位置恢复归档/沙盒体系。
- 每条谱线都有自己的头像和名字。
- 头像和名字位于第 `0` 列左侧，不遮挡第 `0` 列。
- 头像和名字不遮挡 A-O 表格主体。
- 表格第 `0` 列宽度仍为 `40px`。
- 谱线仍按左侧行标 `2 / 4 / 6 / 8` 对齐。
- 节点仍是归档小斜线。
- 技能按钮拖拽不被头像、名字、谱线、节点拦截。
- `npm run build` 通过。

## [回归检查项]

- 选 4 名干员进入排轴，四条谱线左侧均能看到对应头像和名字。
- 头像大小与沙盒/归档视觉一致，没有被压缩。
- 名字仍跟头像保持原来的偏移关系。
- 第 `0` 列行号完整可见，没有被头像或名字盖住。
- A-O 表格主体完整可见。
- 滚动左区时，头像名字跟随对应谱线组移动。
- 切换工作台标签后，头像名字不漂移。

## [给 Trae 的执行指令]

只修头像和名字。

不要继续重写谱线层，不要动节点，不要动行号，不要动存储。

把每条谱线的头像/名字恢复到归档的相对关系，并整体移动到第 `0` 列左侧，确保不遮挡表格。
