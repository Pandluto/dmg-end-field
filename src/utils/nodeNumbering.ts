/**
 * 节点编号工具函数
 * 提供节点编号计算相关功能
 */

import { GRID_NODE_COUNT } from '../core/calculators/gridSnapLayout';

/**
 * 计算节点编号
 * 全局节点索引直接 +1 作为展示编号
 * @param nodeIndex - 全局节点索引（从 0 开始）
 * @returns 节点编号（1, 2, 3, ...）
 */
export function calculateNodeNumber(nodeIndex: number): number {
  return nodeIndex + 1;
}

/**
 * 计算组索引（第几组表格）
 * @param nodeIndex - 全局节点索引
 * @returns 组索引（从 0 开始）
 */
export function calculateGroupIndex(nodeIndex: number): number {
  return Math.floor(nodeIndex / GRID_NODE_COUNT);
}

/**
 * 计算组内节点编号
 * @param nodeIndex - 全局节点索引
 * @returns 组内编号（1 ~ GRID_NODE_COUNT）
 */
export function calculateNodeNumberInGroup(nodeIndex: number): number {
  return (nodeIndex % GRID_NODE_COUNT) + 1;
}
