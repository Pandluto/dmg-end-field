# review-todo0.5.8-fix1：谱线组渲染错误修正

## [Review 结论]

0.5.8 当前实现不通过。

本轮问题不是需求变更，是对 `review-todo0.5.8.md` 和归档代码的执行偏差。必须最小修正，不允许继续重写表格层或改 0.5.9 的存储逻辑。

阻塞问题：
- 干员头像没有正确渲染。
- 旧伤害节点样式被篡改，原本是小斜线，不是新造型。
- 谱线行号对齐错误。第一条谱线必须对齐表格标记的第 `2` 行，不是 DOM/数组意义上的第二行。

## [问题列表]

### P0：谱线行号对齐错误

当前实现把 `LINE_ROWS = [2, 4, 6, 8]` 直接用于：

```ts
lineY = rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
```

如果表格第 `0` 行是真实存在的字母行，且左侧行标显示 `1,2,3,4...`，那么“表格标记第 2 行”的中心不是视觉 rowIndex `2`，而是左侧标记为 `2` 的那一行。

必须按表格标记理解：

```text
第 0 行：A-O 字母标注行
数据行 index 0：左侧标记 1
数据行 index 1：左侧标记 2
数据行 index 2：左侧标记 3
...
```

因此：

```ts
const ROW_LABEL_TO_DATA_ROW_INDEX = (rowLabel: number) => rowLabel - 1;
const lineRowLabels = [2, 4, 6, 8];
const lineCenterY = ROW_HEIGHT + ROW_LABEL_TO_DATA_ROW_INDEX(rowLabel) * ROW_HEIGHT + ROW_HEIGHT / 2;
```

执行者必须对照左侧表格标记验证：
- 第一条谱线穿过左侧标记 `2` 的那一行中心。
- 第二条谱线穿过左侧标记 `4` 的那一行中心。
- 第三条谱线穿过左侧标记 `6` 的那一行中心。
- 第四条谱线穿过左侧标记 `8` 的那一行中心。

禁止用“第几条数组行”“第几个 div”解释这个需求。

### P1：干员头像没有渲染

当前 `CanvasArea.tsx` 使用：

```ts
const startCharIndex = staffIndex * 4;
const character = selectedCharacters[startCharIndex + lineIndex];
```

这和归档代码不一致。归档代码中每一组 `staff-group` 的 4 条谱线复用同一组 `selectedCharacters[lineIndex]`：

```ts
const character = selectedCharacters[lineIndex];
```

本轮 UI 只是把归档谱线组挪到表格层上方，不是重新定义每组 4 个新干员。必须优先恢复归档从属关系。

修正要求：
- 先按归档代码改回 `selectedCharacters[lineIndex]`。
- 不要使用 `staffIndex * 4`。
- 头像 class、src、alt、onError 逻辑参考归档代码。
- 如果当前类型里的头像字段不是 `avatarUrl`，必须查现有选人/沙盒组件头像实际字段，不允许静默显示 placeholder 后声称完成。

必须检查的文件：
- `src/components/CanvasBoard/components-backup/CanvasStaffVisualBackup.tsx`
- `src/components/SkillSandbox/` 或当前渲染沙盒头像的组件
- `src/types/` 中 `Character` 类型

### P1：伤害节点样式被篡改

归档节点样式是小斜线：

```css
.damage-node {
  position: absolute;
  background: #b6b6b6;
  width: 2px;
  height: 6px;
  transform: rotate(135deg);
  border-radius: 0;
}
```

当前实现不能把节点改成圆点、菱形、大块 token 或其他形态。

修正要求：
- 新 class 可以叫 `.canvas-damage-node`，但视觉必须等价于归档 `.damage-node`。
- `width: 2px`。
- `height: 6px`。
- `transform: rotate(135deg)`。
- `border-radius: 0`。
- 颜色使用当前主题 token 可以接受，但形态不允许改。
- 节点定位必须以小斜线中心对齐格子中心，不能把 `left/top` 当左上角直接放到格子中心。

建议定位：

```ts
const nodeWidth = 2;
const nodeHeight = 6;
style={{
  left: nodeCenterX - nodeWidth / 2,
  top: -nodeHeight / 2,
}}
```

如果节点元素位于每条谱线容器内，谱线容器自身 top 已经是行中心，则节点 top 应围绕 `0` 居中。

## [必须改]

### 1. 修正 `CanvasArea.tsx` 头像数据来源

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

要求：
- 删除 `startCharIndex = staffIndex * 4` 逻辑。
- 每组 4 条谱线的干员身份按归档方式取：

```ts
const character = selectedCharacters[lineIndex];
```

- 头像渲染必须参考归档：

```tsx
{character?.avatarUrl && (
  <img
    className="canvas-staff-avatar"
    src={character.avatarUrl}
    alt={`${character?.name} avatar`}
    onError={(event) => {
      (event.target as HTMLImageElement).style.display = 'none';
    }}
  />
)}
```

- 如果项目当前头像字段不是 `avatarUrl`，先查类型和现有头像渲染代码，再使用正确字段。
- 不允许用 placeholder 掩盖头像字段错误。

### 2. 修正谱线行号对齐

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

要求：
- 常量命名改清楚，避免再混淆：

```ts
const LINE_ROW_LABELS = [2, 4, 6, 8];
```

- 计算时明确这是“左侧行标号”：

```ts
const lineCenterY = ROW_HEIGHT + (rowLabel - 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
```

- 必须手动对照表格左侧标记验证第一条谱线在 `2` 行，不是在 `1` 行或 `3` 行。

### 3. 恢复小斜线伤害节点

文件：`src/components/CanvasBoard/CanvasBoard.css`

要求：
- `.canvas-damage-node` 必须恢复归档小斜线外观。
- 不允许圆点、菱形、大块、发光块。
- 视觉规则：

```css
.canvas-damage-node {
  position: absolute;
  width: 2px;
  height: 6px;
  transform: rotate(135deg);
  border-radius: 0;
  background: #b6b6b6;
  pointer-events: none;
}
```

- 如要使用主题色，只能替换 `background`，不能改形态。

### 4. 修正节点中心对齐

文件：`src/components/CanvasBoard/components/CanvasArea.tsx`

要求：
- 节点中心对齐 A-O 列中心。
- 如果节点元素使用绝对定位，必须扣除自身宽高：

```ts
const nodeCenterX = FIRST_COLUMN_WIDTH + nodeIndex * COLUMN_WIDTH + COLUMN_WIDTH / 2;
style={{ left: nodeCenterX - 1 }}
```

- 如果节点位于 line 容器内，Y 方向必须围绕谱线中心：

```ts
style={{ left: nodeCenterX - 1, top: -3 }}
```

## [不要动]

- 不改 `review-todo0.5.9` 的计数和存储。
- 不写 `sessionStorage`。
- 不改 `timeline.data`。
- 不改技能按钮拖拽吸附逻辑。
- 不改表格层结构。
- 不改右区、下区布局。
- 不改 Buff、伤害公式、缓存链路。
- 不新增大规模重构。

## [验收标准 AC]

- 第一条谱线穿过表格左侧标记 `2` 的行中心。
- 第二条谱线穿过表格左侧标记 `4` 的行中心。
- 第三条谱线穿过表格左侧标记 `6` 的行中心。
- 第四条谱线穿过表格左侧标记 `8` 的行中心。
- 每条谱线左侧能看到对应干员头像。
- 头像必须使用真实干员头像资源，不允许只有 placeholder。
- 每条谱线左侧能看到对应干员名字。
- 伤害节点是归档样式的小斜线。
- 每条谱线只有 15 个节点，对齐 A-O 列中心。
- 谱线层仍不拦截技能按钮拖拽。
- `npm run build` 通过。

## [回归检查项]

- 选 4 名干员进入排轴，4 条谱线分别显示这 4 名干员的头像和名字。
- 第 1 条谱线对齐左侧行标 `2`，其数据行 index 是 `1`，不是 `2`。
- 第 2 名干员第 17 个伤害节点仍在第二条谱线、B 列中心。
- 技能按钮拖拽、释放、吸附不偏移。
- 表格第 0 行 A-O 仍存在。
- 表格第 0 列行号仍存在。

## [给 Trae 的执行指令]

只修这三个实测错误：头像、节点样式、行号对齐。

先对照 `CanvasStaffVisualBackup.tsx/css` 恢复头像和节点原样，再对照表格左侧行标修正谱线 Y 坐标。

不要扩散修改，不要重写布局，不要碰 0.5.9 的存储逻辑。


