/**
 * 节点编号工具函数
 * 提供节点编号计算相关功能
 */

/**
 * 计算节点编号
 * 每个干员的谱线编号独立，每组 50 个节点
 * @param nodeIndex - 节点索引（从 0 开始）
 * @returns 节点编号（1 ~ 50, 51 ~ 100, ...）
 */
export function calculateNodeNumber(nodeIndex: number): number {
  const groupIndex = Math.floor(nodeIndex / 50);
  const nodeNumberInGroup = (nodeIndex % 50) + 1;
  return groupIndex * 50 + nodeNumberInGroup;
}

/**
 * 计算组索引
 * @param nodeIndex - 节点索引
 * @returns 组索引（从 0 开始）
 */
export function calculateGroupIndex(nodeIndex: number): number {
  return Math.floor(nodeIndex / 50);
}

/**
 * 计算组内节点编号
 * @param nodeIndex - 节点索引
 * @returns 组内编号（1 ~ 50）
 */
export function calculateNodeNumberInGroup(nodeIndex: number): number {
  return (nodeIndex % 50) + 1;
}
