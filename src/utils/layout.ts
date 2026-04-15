import { CanvasConfig, Position, SkillButton } from '../types';

/**
 * Canvas 画布布局计算工具集
 *
 * 坐标系统说明：
 * - 画布内所有坐标均为相对于画布左上角的偏移（不含 canvasRect.top/left）
 * - Y 轴由谱线决定，按钮圆心必须落在谱线 Y 上（由 findNearestLine 返回精确 Y 值）
 * - X 轴由节点间距计算，将按铵吸附到最近的有效节点
 *
 * 核心概念：
 * - staff（谱线组）：同一角色的多条谱线为一组
 * - line（谱线）：一条水平线，代表角色的一个技能施放位置
 * - node（节点）：谱线上的水平刻度点，技能按钮吸附的 X 坐标位置
 * - groupOffset：多 staff 堆叠时的 Y 轴偏移量（staffIndex * (staffGroupHeight + groupSpacing)）
 */

/**
 * 计算谱线在单个 staff 组内的基准 Y 坐标（不含 groupOffset）
 * 用于 findNearestLine 和 snapToNearestNode 的 Y 轴基准计算
 *
 * @param config - 画布配置
 * @param lineIndex - 谱线在 staff 组内的索引（从 0 开始）
 * @returns 谱线圆心在 staff 组内的 Y 绝对坐标（不含 groupOffset）
 */
export function calculateLineY(
  config: CanvasConfig,
  lineIndex: number
): number {
  const totalLines = config.lineCount;
  // 谱线之间的间距 =（可用高度 - 上下边距 - 所有谱线占高）/（谱线数量 - 1）
  const spacing =
    (config.staffGroupHeight -
      config.staffMarginTop -
      config.staffMarginBottom -
      totalLines * config.staffHeight) /
    (totalLines - 1);

  // 谱线 Y = 上边距 + 谱线索引 *（间距 + 谱线占高）
  return config.staffMarginTop + lineIndex * (spacing + config.staffHeight);
}

/**
 * 计算节点在水平方向上的 X 坐标
 *
 * @param config - 画布配置
 * @param nodeIndex - 节点索引（从 0 开始）
 * @param canvasWidth - 画布总宽度
 * @returns 节点的 X 绝对坐标
 */
export function calculateNodeX(
  config: CanvasConfig,
  nodeIndex: number,
  canvasWidth: number
): number {
  const availableWidth = canvasWidth - config.marginLeft - config.marginRight;
  const spacing = availableWidth / (config.nodeCount - 1);
  return config.marginLeft + nodeIndex * spacing;
}

/**
 * 根据谱线索引和节点索引计算技能按钮在画布中的绝对坐标
 * 用于初始渲染和静态布局，不用于吸附计算
 *
 * @param config - 画布配置
 * @param lineIndex - 谱线索引
 * @param nodeIndex - 节点索引
 * @param canvasWidth - 画布总宽度
 * @returns 技能按钮圆心坐标 {x, y}
 */
export function calculateNodePosition(
  config: CanvasConfig,
  lineIndex: number,
  nodeIndex: number,
  canvasWidth: number
): Position {
  return {
    x: calculateNodeX(config, nodeIndex, canvasWidth),
    // 谱线 Y = calculateLineY 基准 + staffHeight/2（圆心偏移）+ groupOffset（在 findNearestLine 中已处理）
    y: calculateLineY(config, lineIndex) + config.staffHeight / 2,
  };
}

/**
 * 计算谱线之间的间距
 * @param config - 画布配置
 * @returns 谱线间距（像素）
 */
export function getLineSpacing(config: CanvasConfig): number {
  const totalLines = config.lineCount;
  return (
    (config.staffGroupHeight -
      config.staffMarginTop -
      config.staffMarginBottom -
      totalLines * config.staffHeight) /
    (totalLines - 1)
  );
}

/**
 * 计算节点之间的水平间距
 * @param config - 画布配置
 * @param canvasWidth - 画布总宽度
 * @returns 节点间距（像素）
 */
export function getNodeSpacing(config: CanvasConfig, canvasWidth: number): number {
  const availableWidth = canvasWidth - config.marginLeft - config.marginRight;
  return availableWidth / (config.nodeCount - 1);
}

/**
 * 计算 staff 组的 Y 轴偏移量
 * 用于多 staff 堆叠时，将谱线 Y 加上对应偏移量得到画布绝对坐标
 *
 * @param config - 画布配置
 * @param staffIndex - staff 组索引（从 0 开始）
 * @returns 该 staff 组相对于画布顶部的 Y 偏移量
 */
export function getGroupOffset(
  config: CanvasConfig,
  staffIndex: number
): number {
  // 每个 staff 组高度 + 组间间距
  return staffIndex * (config.staffGroupHeight + config.groupSpacing);
}

/**
 * 根据鼠标 Y 坐标找到最近的匹配角色谱线
 * 遍历所有 staff 组和谱线，返回与鼠标 Y 最接近且角色 ID 匹配的谱线
 *
 * @param mouseY - 鼠标在页面上的 Y 坐标（绝对坐标，含 canvasRect.top）
 * @param canvasRect - 画布 DOM 矩形
 * @param config - 画布配置
 * @param staffCount - staff 组总数
 * @param characterId - 当前拖拽的干员 ID（只匹配该角色的谱线）
 * @param selectedCharacters - 已选干员列表（用于判断谱线是否属于目标角色）
 * @returns 最近谱线信息（含 staffIndex、lineIndex、精确 lineY）；无匹配返回 null
 *
 * @example
 * // 返回值中 lineY 已含 groupOffset，是画布内的绝对 Y 坐标
 * { staffIndex: 0, lineIndex: 0, lineY: 62 }
 */
export function findNearestLine(
  mouseY: number,
  canvasRect: DOMRect,
  config: CanvasConfig,
  staffCount: number,
  characterId: string,
  selectedCharacters: { id: string }[]
): { staffIndex: number; lineIndex: number; lineY: number } | null {
  // 鼠标相对于画布顶部的 Y 坐标（不含 canvasRect.top）
  const relativeY = mouseY - canvasRect.top;

  let nearestLine: { staffIndex: number; lineIndex: number; distance: number; lineY: number } | null = null;

  for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
    for (let lineIdx = 0; lineIdx < config.lineCount; lineIdx++) {
      // 只匹配角色 ID 相同的谱线
      const lineCharacter = selectedCharacters[lineIdx];
      if (!lineCharacter || lineCharacter.id !== characterId) continue;

      // 计算该谱线在画布内的绝对 Y 坐标
      // = 单 staff 内谱线 Y（基准 + staffHeight/2）+ staff 组偏移
      const groupOffset = getGroupOffset(config, staffIndex);
      const lineY = calculateLineY(config, lineIdx) + config.staffHeight / 2 + groupOffset;
      const distance = Math.abs(relativeY - lineY);

      if (!nearestLine || distance < nearestLine.distance) {
        nearestLine = { staffIndex, lineIndex: lineIdx, distance, lineY };
      }
    }
  }

  return nearestLine;
}

/**
 * 判断指定节点位置是否已被同一角色的其他按钮占用
 * 用于吸附时跳过已占节点
 */
function isNodeOccupied(
  staffIndex: number,
  lineIndex: number,
  nodeX: number,
  skillButtons: SkillButton[],
  characterId: string
): boolean {
  return skillButtons.some(
    btn =>
      btn.characterId === characterId &&
      btn.staffIndex === staffIndex &&
      btn.lineIndex === lineIndex &&
      btn.position.x === nodeX
  );
}

/**
 * 将拖拽中的技能按钮吸附到最近的可用节点
 *
 * X 轴：计算节点间距，找到最近的节点（若有冲突则顺延找下一个可用节点）
 * Y 轴：【重要】直接使用传入的 position.y，不做任何计算
 *        因为调用方传入的 y 值就是 findNearestLine 返回的 lineY（已含 groupOffset，是画布内的精确 Y 坐标）
 *        按钮的圆心 Y 必须严格等于谱线 Y，所以直接用即可
 *
 * @param position - 目标坐标（x 由鼠标位置决定，y 必须是 findNearestLine 返回的精确 lineY）
 * @param config - 画布配置
 * @param staffIndex - staff 组索引
 * @param lineIndex - 谱线索引
 * @param canvasWidth - 画布总宽度
 * @param skillButtons - 当前画布上所有技能按钮（用于检测冲突）
 * @param characterId - 干员 ID（用于冲突检测）
 * @returns 吸附后的精确坐标 {x, y} 和节点索引
 */
export function snapToNearestNode(
  position: Position,
  config: CanvasConfig,
  staffIndex: number,
  lineIndex: number,
  canvasWidth: number,
  skillButtons?: SkillButton[],
  characterId?: string
): { snappedPosition: Position; nodeIndex: number } {
  // X 轴吸附：计算节点间距，将鼠标 X 吸附到最近的节点
  const nodeSpacing = config.nodeSpacing || getNodeSpacing(config, canvasWidth);
  const relativeX = position.x - config.marginLeft;
  const nearestNodeIndex = Math.round(relativeX / nodeSpacing);
  let targetNodeIndex = Math.max(0, Math.min(config.nodeCount - 1, nearestNodeIndex));

  // 冲突检测：若最近节点已被同一角色占用，则顺延找下一个可用节点
  if (skillButtons && characterId) {
    for (let offset = 0; offset <= config.nodeCount; offset++) {
      const checkIndex = targetNodeIndex + offset;
      const checkIndexNeg = targetNodeIndex - offset;

      const checkX = config.marginLeft + checkIndex * nodeSpacing;
      const checkXNeg = config.marginLeft + checkIndexNeg * nodeSpacing;

      if (checkIndex < config.nodeCount && !isNodeOccupied(staffIndex, lineIndex, checkX, skillButtons, characterId)) {
        targetNodeIndex = checkIndex;
        break;
      }
      if (checkIndexNeg >= 0 && !isNodeOccupied(staffIndex, lineIndex, checkXNeg, skillButtons, characterId)) {
        targetNodeIndex = checkIndexNeg;
        break;
      }
    }
  }

  // 计算吸附后的 X 坐标
  const snappedX = config.marginLeft + targetNodeIndex * nodeSpacing;

  // Y 轴：【直接使用传入值】
  // 调用方传入的 position.y 就是 findNearestLine 返回的 lineY（已含 groupOffset），
  // 是谱线在画布内的精确 Y 坐标，按钮圆心必须严格对齐谱线 Y，
  // 所以直接用 position.y，不做任何计算
  return {
    snappedPosition: { x: snappedX, y: position.y },
    nodeIndex: targetNodeIndex,
  };
}

/**
 * 判断技能按钮是否在画布 X 轴范围内
 * 用于拖拽释放时判断是否在有效区域内
 */
export function isWithinCanvasBounds(
  position: Position,
  config: CanvasConfig,
  canvasWidth: number,
  buttonSize: number
): boolean {
  const halfSize = buttonSize / 2;
  return (
    position.x - halfSize >= config.marginLeft &&
    position.x + halfSize <= canvasWidth - config.marginRight
  );
}

/**
 * 计算画布总高度
 * 用于设置画布容器的滚动高度或校验
 */
export function getTotalCanvasHeight(config: CanvasConfig, staffCount: number): number {
  return staffCount * config.staffGroupHeight + (staffCount - 1) * config.groupSpacing;
}
