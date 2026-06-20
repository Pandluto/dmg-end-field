/**
 * 表格坐标系吸附工具
 *
 * 纯坐标计算，不涉及DOM、React、sessionStorage
 *
 * 坐标系统：
 * - 表格组宽度 1240px = 40px(第0列) + 15 * 80px(普通列)
 * - 表格组高度 270px = 9 * 30px(行高)
 * - 第0行是字母标注行(A-O)
 * - 第0列是数字标注列(1-8)
 * - 谱线对齐行索引 [3, 5, 7, 9]（对应用户看到的第2/4/6/8行）
 */

export const GRID_FIRST_COLUMN_WIDTH = 40;
export const GRID_COLUMN_WIDTH = 80;
export const GRID_ROW_HEIGHT = 30;
export const GRID_NODE_COUNT = 15;
export const GRID_GROUP_WIDTH = 1240;
export const GRID_GROUP_HEIGHT = 270;
export const GRID_STACK_PADDING_TOP = 60;
export const GRID_STACK_PADDING_BOTTOM = 90;
export const GRID_GROUP_GAP = 30;
export const GRID_GROUP_STRIDE = GRID_GROUP_HEIGHT + GRID_GROUP_GAP;
export const LINE_ROW_INDICES = [3, 5, 7, 9] as const;

export function clampGridNodeIndex(index: number): number {
  return Math.max(0, Math.min(GRID_NODE_COUNT - 1, index));
}

export function getGridNodeCenterX(nodeIndex: number): number {
  return GRID_FIRST_COLUMN_WIDTH + nodeIndex * GRID_COLUMN_WIDTH + GRID_COLUMN_WIDTH / 2;
}

export function getGridLineCenterY(lineIndex: number): number {
  const rowIndex = LINE_ROW_INDICES[lineIndex];
  return (rowIndex - 1) * GRID_ROW_HEIGHT + GRID_ROW_HEIGHT / 2;
}

export function getGridGroupTop(staffIndex: number): number {
  return GRID_STACK_PADDING_TOP + staffIndex * GRID_GROUP_STRIDE;
}

export function getGridGroupBottom(staffIndex: number): number {
  return getGridGroupTop(staffIndex) + GRID_GROUP_HEIGHT;
}

export function isInsideGridGroup(gridY: number, staffIndex: number): boolean {
  const top = getGridGroupTop(staffIndex);
  const bottom = getGridGroupBottom(staffIndex);
  return gridY >= top && gridY <= bottom;
}

/**
 * 根据 gridY 找到最近的 staff 组索引
 * 优先返回 gridY 所在的 staff，否则返回最近的 staff
 */
export function findNearestStaffIndex(
  gridY: number,
  staffCount: number
): number {
  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    if (isInsideGridGroup(gridY, staffIndex)) {
      return staffIndex;
    }
  }

  let nearestStaff = 0;
  let nearestDistance = Infinity;
  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    const groupTop = getGridGroupTop(staffIndex);
    const groupCenter = groupTop + GRID_GROUP_HEIGHT / 2;
    const distance = Math.abs(gridY - groupCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestStaff = staffIndex;
    }
  }
  return nearestStaff;
}

export function findNearestGridLine(
  gridY: number,
  staffCount: number,
  characterId: string,
  selectedCharacters: { id: string }[]
): { staffIndex: number; lineIndex: number; lineY: number } | null {
  let nearestLine: { staffIndex: number; lineIndex: number; distance: number; lineY: number } | null = null;

  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    const groupTop = getGridGroupTop(staffIndex);
    const groupBottom = groupTop + GRID_GROUP_HEIGHT;

    for (let lineIndex = 0; lineIndex < LINE_ROW_INDICES.length; lineIndex++) {
      const lineCharacter = selectedCharacters[lineIndex];
      if (!lineCharacter || lineCharacter.id !== characterId) continue;

      const lineYInGroup = getGridLineCenterY(lineIndex);
      const lineY = groupTop + lineYInGroup;

      if (gridY >= groupTop && gridY <= groupBottom) {
        const distance = Math.abs(gridY - lineY);
        if (!nearestLine || distance < nearestLine.distance) {
          nearestLine = { staffIndex, lineIndex, distance, lineY };
        }
      }
    }
  }

  if (!nearestLine) {
    for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
      const groupTop = getGridGroupTop(staffIndex);
      const lineYInGroup = getGridLineCenterY(0);
      const lineY = groupTop + lineYInGroup;
      const distance = Math.abs(gridY - lineY);
      if (!nearestLine || distance < nearestLine.distance) {
        nearestLine = { staffIndex, lineIndex: 0, distance, lineY };
      }
    }
  }

  return nearestLine ? { staffIndex: nearestLine.staffIndex, lineIndex: nearestLine.lineIndex, lineY: nearestLine.lineY } : null;
}

/**
 * 查找最近谱线（不限制角色），供复制等场景使用
 * 优先找同 staff 内最近的 line，若都不在范围内则找最近 staff 的第 0 行
 */
export function findNearestGridLineAnyCharacter(
  gridY: number,
  staffCount: number
): { staffIndex: number; lineIndex: number; lineY: number } | null {
  let nearestLine: { staffIndex: number; lineIndex: number; distance: number; lineY: number } | null = null;

  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    const groupTop = getGridGroupTop(staffIndex);
    const groupBottom = groupTop + GRID_GROUP_HEIGHT;

    for (let lineIndex = 0; lineIndex < LINE_ROW_INDICES.length; lineIndex++) {
      const lineYInGroup = getGridLineCenterY(lineIndex);
      const lineY = groupTop + lineYInGroup;

      if (gridY >= groupTop && gridY <= groupBottom) {
        const distance = Math.abs(gridY - lineY);
        if (!nearestLine || distance < nearestLine.distance) {
          nearestLine = { staffIndex, lineIndex, distance, lineY };
        }
      }
    }
  }

  if (!nearestLine) {
    for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
      const groupTop = getGridGroupTop(staffIndex);
      const lineYInGroup = getGridLineCenterY(0);
      const lineY = groupTop + lineYInGroup;
      const distance = Math.abs(gridY - lineY);
      if (!nearestLine || distance < nearestLine.distance) {
        nearestLine = { staffIndex, lineIndex: 0, distance, lineY };
      }
    }
  }

  return nearestLine ? { staffIndex: nearestLine.staffIndex, lineIndex: nearestLine.lineIndex, lineY: nearestLine.lineY } : null;
}

/**
 * 计算按钮在所在 staff 组内的局部 nodeIndex
 * gridContentOffsetX: grid 内容区相对于 canvas 左边的偏移量
 */
export function getButtonNodeIndexInStaff(
  buttonPositionX: number,
  gridContentOffsetX: number
): number {
  const gridX = buttonPositionX - gridContentOffsetX;
  const firstNodeCenterX = GRID_FIRST_COLUMN_WIDTH + GRID_COLUMN_WIDTH / 2;
  return clampGridNodeIndex(Math.round((gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH));
}

/**
 * 获取指定 staffIndex + lineIndex 下已被占用的节点索引集合
 * @param skillButtons 所有运行时按钮
 * @param staffIndex 目标 staff 组
 * @param lineIndex 目标谱线索引
 * @param movingButtonId 正在移动的按钮 ID（移动中应排除）
 * @param gridContentOffsetX grid 内容区相对 canvas 的 X 偏移
 */
export function getOccupiedNodeIndicesForLine(
  skillButtons: { id: string; staffIndex: number; lineIndex: number; position: { x: number } }[],
  staffIndex: number,
  lineIndex: number,
  movingButtonId: string | null,
  gridContentOffsetX: number
): Set<number> {
  const occupied = new Set<number>();

  skillButtons.forEach((button) => {
    if (button.id === movingButtonId) return;
    if (button.staffIndex !== staffIndex) return;
    if (button.lineIndex !== lineIndex) return;

    const nodeIndex = getButtonNodeIndexInStaff(button.position.x, gridContentOffsetX);
    if (Number.isFinite(nodeIndex)) {
      occupied.add(nodeIndex);
    }
  });

  return occupied;
}

export function snapGridNodeX(
  gridX: number,
  occupiedNodeIndices?: Set<number>
): { nodeIndex: number; x: number } | null {
  const firstNodeCenterX = getGridNodeCenterX(0);
  const rawIndex = (gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH;
  let nearestNodeIndex = clampGridNodeIndex(Math.round(rawIndex));

  if (occupiedNodeIndices && occupiedNodeIndices.size > 0) {
    let found = false;
    for (let offset = 0; offset <= GRID_NODE_COUNT; offset++) {
      const checkIndexPos = nearestNodeIndex + offset;
      const checkIndexNeg = nearestNodeIndex - offset;

      if (checkIndexPos < GRID_NODE_COUNT && !occupiedNodeIndices.has(checkIndexPos)) {
        nearestNodeIndex = checkIndexPos;
        found = true;
        break;
      }
      if (checkIndexNeg >= 0 && !occupiedNodeIndices.has(checkIndexNeg)) {
        nearestNodeIndex = checkIndexNeg;
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
  }

  return {
    nodeIndex: nearestNodeIndex,
    x: getGridNodeCenterX(nearestNodeIndex),
  };
}

/**
 * 判断最终吸附节点（公共函数）
 * 输入 gridX 和占用节点集合，输出最终应吸附的局部节点
 * 内部复用 snapGridNodeX
 * 满行无空位时返回 null
 */
export function resolveSnappedGridNode(
  gridX: number,
  occupiedNodeIndices?: Set<number>
): { nodeIndex: number; nodeCenterX: number } | null {
  const result = snapGridNodeX(gridX, occupiedNodeIndices);
  if (!result) {
    return null;
  }
  return {
    nodeIndex: result.nodeIndex,
    nodeCenterX: result.x,
  };
}

export function getGridStackOffsetFromCanvas(
  canvasRect: DOMRect,
  gridStackRect: DOMRect
): { offsetX: number; offsetY: number } {
  return {
    offsetX: gridStackRect.left - canvasRect.left,
    offsetY: gridStackRect.top - canvasRect.top,
  };
}

export function clientToGridCoords(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  gridStackRect: DOMRect
): { gridX: number; gridY: number } {
  const { offsetX, offsetY } = getGridStackOffsetFromCanvas(canvasRect, gridStackRect);
  return {
    gridX: clientX - canvasRect.left - offsetX,
    gridY: clientY - canvasRect.top - offsetY,
  };
}

export function gridToCanvasCoords(
  gridX: number,
  gridY: number,
  canvasRect: DOMRect,
  gridStackRect: DOMRect
): { x: number; y: number } {
  const { offsetX, offsetY } = getGridStackOffsetFromCanvas(canvasRect, gridStackRect);
  return {
    x: gridX + offsetX,
    y: gridY + offsetY,
  };
}

/**
 * 获取 grid 内容区相对 canvas 左边的 X 偏移量（考虑横向滚动）
 */
export function getGridContentOffsetX(canvasElement: HTMLElement, gridStackElement: Element): number {
  const canvasRect = canvasElement.getBoundingClientRect();
  const gridStackRect = gridStackElement.getBoundingClientRect();
  return gridStackRect.left - canvasRect.left + canvasElement.scrollLeft;
}

/**
 * 将 grid 内容坐标转换为 canvas 内容坐标（考虑滚动）
 * 用于生成按钮持久 position，而非视口坐标
 */
export function gridToCanvasContentCoords(
  gridX: number,
  gridY: number,
  canvasElement: HTMLElement,
  gridStackElement: Element
): { x: number; y: number } {
  const canvasRect = canvasElement.getBoundingClientRect();
  const gridStackRect = gridStackElement.getBoundingClientRect();

  return {
    x: gridX + (gridStackRect.left - canvasRect.left) + canvasElement.scrollLeft,
    y: gridY + (gridStackRect.top - canvasRect.top) + canvasElement.scrollTop,
  };
}
