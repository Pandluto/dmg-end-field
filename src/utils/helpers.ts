/**
 * 通用辅助工具函数
 * 包含唯一 ID 生成、技能按钮工厂函数
 */

import { SkillButton, SkillType } from '../types';

/**
 * 生成随机唯一 ID
 * 用于 SkillButton 等实例的 id 字段
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * 工厂函数：根据参数创建 SkillButton 初始实例
 * position 默认为 {x:0, y:0}，后续由 snapToNearestNode 更新实际位置
 *
 * @param characterId - 干员 ID
 * @param characterName - 干员名称
 * @param skillType - 技能类型 A/B/E/Q
 * @param staffIndex - staff 组索引
 * @param lineIndex - 谱线索引
 */
export function createSkillButton(
  characterId: string,
  characterName: string,
  skillType: SkillType,
  staffIndex: number,
  lineIndex: number
): SkillButton {
  return {
    id: generateId(),
    characterId,
    characterName,
    skillType,
    position: { x: 0, y: 0 },
    staffIndex,
    lineIndex,
    isDragging: false,
    isSelected: false,
    isFromSandbox: false,
  };
}
