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
export const GRID_STACK_PADDING_TOP = 30;
export const GRID_STACK_PADDING_BOTTOM = 90;
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
  return GRID_STACK_PADDING_TOP + staffIndex * GRID_GROUP_HEIGHT;
}

export function getGridGroupBottom(staffIndex: number): number {
  return getGridGroupTop(staffIndex) + GRID_GROUP_HEIGHT;
}

export function isInsideGridGroup(gridY: number, staffIndex: number): boolean {
  const top = getGridGroupTop(staffIndex);
  const bottom = getGridGroupBottom(staffIndex) - GRID_STACK_PADDING_BOTTOM;
  return gridY >= top && gridY <= bottom;
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

export function snapGridNodeX(
  gridX: number,
  occupiedNodeIndices?: Set<number>
): { nodeIndex: number; x: number } {
  const firstNodeCenterX = getGridNodeCenterX(0);
  const rawIndex = (gridX - firstNodeCenterX) / GRID_COLUMN_WIDTH;
  let nearestNodeIndex = clampGridNodeIndex(Math.round(rawIndex));

  if (occupiedNodeIndices && occupiedNodeIndices.size > 0) {
    for (let offset = 0; offset <= GRID_NODE_COUNT; offset++) {
      const checkIndexPos = nearestNodeIndex + offset;
      const checkIndexNeg = nearestNodeIndex - offset;

      if (checkIndexPos < GRID_NODE_COUNT && !occupiedNodeIndices.has(checkIndexPos)) {
        nearestNodeIndex = checkIndexPos;
        break;
      }
      if (checkIndexNeg >= 0 && !occupiedNodeIndices.has(checkIndexNeg)) {
        nearestNodeIndex = checkIndexNeg;
        break;
      }
    }
  }

  return {
    nodeIndex: nearestNodeIndex,
    x: getGridNodeCenterX(nearestNodeIndex),
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
