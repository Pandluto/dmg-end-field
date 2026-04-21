# review-todo0.5.9：伤害节点计数与 sessionStorage 同步

## [任务理解]

本轮承接 `review-todo0.5.8.md`。

0.5.8 只完成 UI 层：谱线、表格、伤害节点视觉对齐。

0.5.9 处理计数规则变化后的数据同步问题，包括节点编号、节点归属、以及需要同步到 `sessionStorage` 的字段。

## [前置条件]

必须先完成并验收 `review-todo0.5.8.md`：

- 每组表格对应一组谱线。
- 每组谱线 4 条。
- 每条谱线 15 个伤害节点。
- 节点 UI 坐标已对齐到 `A ... O` 列中心、表格第 `2 / 4 / 6 / 8` 行中心。

未完成 0.5.8 前，不允许开始 0.5.9。

## [计数规则]

### 1. 单组节点数量

```text
每组干员 = 4 条谱线
每条谱线 = 15 个伤害节点
每组总节点 = 4 * 15 = 60
```

### 2. 组内节点编号映射

节点编号从 `1` 开始。

```ts
const nodesPerLine = 15;
const linesPerGroup = 4;

const zeroBasedNodeIndex = nodeNumber - 1;
const lineIndex = Math.floor(zeroBasedNodeIndex / nodesPerLine);
const columnIndex = zeroBasedNodeIndex % nodesPerLine;
```

映射结果：
- `lineIndex` 范围：`0 ... 3`
- `columnIndex` 范围：`0 ... 14`

### 3. 谱线行映射

```ts
const lineRows = [2, 4, 6, 8];
const rowIndex = lineRows[lineIndex];
```

说明：
- 第 1 条谱线对应第 2 行。
- 第 2 条谱线对应第 4 行。
- 第 3 条谱线对应第 6 行。
- 第 4 条谱线对应第 8 行。

### 4. 列标映射

```ts
const columnLabel = String.fromCharCode(65 + columnIndex);
```

范围：

```text
0 -> A
1 -> B
...
14 -> O
```

### 5. 示例必须成立

```text
第 2 名干员的第 17 个伤害节点
= 第二组谱线
= 第二条谱线
= 第二个伤害节点
= 第二组表格，第 4 行，第 2 列中心
```

计算：

```ts
nodeNumber = 17;
zeroBasedNodeIndex = 16;
lineIndex = Math.floor(16 / 15) = 1; // 第二条谱线
columnIndex = 16 % 15 = 1;           // 第二个伤害节点，B 列
rowIndex = lineRows[1] = 4;          // 第 4 行
```

## [必须改]

### 1. 找出当前节点编号来源

Trae 必须先定位当前伤害节点编号逻辑。

重点搜索：
- `nodeNumber`
- `damage-node`
- `nodeIndex`
- `lineIndex`
- `staffIndex`
- `snapToNearestNode`
- `sessionStorage`

重点文件：
- `src/components/CanvasBoard/hooks/useCanvasDrag.ts`
- `src/utils/layout.ts`
- `src/hooks/useTimelineData.ts`
- `src/core/services/timelineService.ts`
- `src/types/`

### 2. 新增或收口节点坐标映射函数

建议新增纯函数文件：

- `src/core/calculators/timelineNodeMapper.ts`

建议导出：

```ts
export const NODES_PER_LINE = 15;
export const LINES_PER_GROUP = 4;
export const LINE_ROWS = [2, 4, 6, 8] as const;

export function mapNodeNumberToGrid(nodeNumber: number) {
  const zeroBasedNodeIndex = nodeNumber - 1;
  const lineIndex = Math.floor(zeroBasedNodeIndex / NODES_PER_LINE);
  const columnIndex = zeroBasedNodeIndex % NODES_PER_LINE;
  const rowIndex = LINE_ROWS[lineIndex];
  const columnLabel = String.fromCharCode(65 + columnIndex);

  return {
    lineIndex,
    columnIndex,
    rowIndex,
    columnLabel,
  };
}
```

约束：
- 输入 `nodeNumber` 必须从 `1` 开始。
- `nodeNumber < 1` 必须拒绝或兜底。
- `lineIndex > 3` 必须拒绝或兜底，不能静默生成第 5 条谱线。

### 3. 更新节点数量上限

所有仍按旧节点数量生成 / 计算的地方，必须改为：

```text
每条谱线 15 个节点
每组 60 个节点
```

必须避免：
- UI 显示 15 个节点，但数据仍按旧数量编号。
- 拖拽吸附按旧节点数量落点。
- sessionStorage 中保存旧 nodeNumber，恢复后映射到错误列。

### 4. 同步 sessionStorage 内容

本轮需要确认并更新保存到 `sessionStorage` 的节点字段。

至少要检查：
- 技能按钮保存的 `nodeNumber`
- 技能按钮保存的 `lineIndex`
- 技能按钮保存的 `staffIndex`
- 技能按钮保存的 `position.x`
- 技能按钮保存的 `position.y`

要求：
- 若存储中已有 `nodeNumber`，恢复时必须按新规则映射到表格位置。
- 若存储中只有 `position`，恢复时不得覆盖正确的 `nodeNumber`。
- 如果同时存在 `nodeNumber` 和 `position`，必须明确主从关系。

推荐主从：

```text
nodeNumber / staffIndex 为语义主数据
position.x / position.y 为 UI 派生数据
```

### 5. 旧数据兼容

如果旧缓存中的 `nodeNumber` 超出新上限，必须有明确策略。

推荐策略：
- 不删除旧按钮。
- 恢复时 clamp 到当前组最大节点 `60`。
- 输出 `console.warn`，标记旧节点超出新上限。
- 保存时写回新规则下的合法值。

禁止：
- 静默丢弃按钮。
- 静默生成第 5 条谱线。
- 静默生成第 16 列之后的节点。

## [不要动]

- 不改表格视觉样式。
- 不改第 `0` 行 / 第 `0` 列标注。
- 不改表格颜色 token。
- 不改 Buff 链路。
- 不改伤害公式。
- 不改 `selectedBuff`。
- 不改右区 / 下区布局。

## [验收标准 AC]

- 每条谱线数据层最多 15 个节点。
- 每组干员数据层最多 60 个节点。
- 第 17 个节点映射到第 2 条谱线、第 2 个节点。
- 第 17 个节点 UI 坐标为第 4 行、B 列中心。
- 新增技能按钮后，保存到 `sessionStorage` 的计数符合新规则。
- 刷新页面后，技能按钮恢复到同一表格单元中心。
- 旧缓存超出新节点上限时有兼容处理，不丢按钮。
- `npm run build` 通过。

## [回归检查项]

- 添加技能按钮到 A 列、O 列，刷新后位置不变。
- 添加技能按钮到第 1 / 2 / 3 / 4 条谱线，刷新后谱线归属不变。
- 第 2 名干员第 17 个节点刷新后仍在第二组表格第 4 行第 2 列中心。
- 拖拽技能按钮后，`sessionStorage` 中 `nodeNumber` 与 UI 单元一致。
- 删除技能按钮不影响 Buff 清理链路。
- Buff 添加 / 删除 / 清空不回退。

## [给 Trae 的执行指令]

先完成映射函数，再替换所有旧节点数量和旧编号计算点，最后处理 sessionStorage 恢复兼容。

不要把 0.5.9 的存储改动混入 0.5.8。
