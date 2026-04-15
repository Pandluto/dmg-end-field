/**
 * 画布碰撞检测工具
 *
 * 用于检测画布上两个或多个技能按钮是否在空间上重叠。
 * 注意：碰撞检测只在同一 staff 且同一谱线下进行（不同 staff/line 的按钮永远不碰撞）。
 */

import { SkillButton, CollisionResult } from '../types';

/**
 * 检测两个技能按钮是否碰撞
 * 碰撞条件：同 staff、同谱线、圆心距离小于按钮直径
 *
 * @param button1 - 按钮 1
 * @param button2 - 按钮 2
 * @param buttonSize - 按钮直径（碰撞阈值）
 */
export function checkButtonCollision(
  button1: SkillButton,
  button2: SkillButton,
  buttonSize: number
): boolean {
  // 不同 staff 或不同谱线：永远不碰撞
  if (button1.staffIndex !== button2.staffIndex) {
    return false;
  }
  if (button1.lineIndex !== button2.lineIndex) {
    return false;
  }
  // 同一按钮自身不与自己碰撞
  if (button1.id === button2.id) {
    return false;
  }

  // 计算两按钮圆心的欧氏距离
  const dx = button1.position.x - button2.position.x;
  const dy = button1.position.y - button2.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance < buttonSize;
}

/**
 * 检测移动中的按钮与画布上所有按钮的碰撞
 * 返回碰撞结果，包含所有与之碰撞的按钮 ID 列表
 *
 * @param movingButton - 正在移动的按钮
 * @param allButtons - 画布上所有按钮
 * @param buttonSize - 按钮直径
 */
export function checkLineCollisions(
  movingButton: SkillButton,
  allButtons: SkillButton[],
  buttonSize: number
): CollisionResult {
  const collidingButtonIds: string[] = [];

  for (const button of allButtons) {
    // 跳过不同 staff 或不同谱线
    if (button.staffIndex !== movingButton.staffIndex) {
      continue;
    }
    if (button.lineIndex !== movingButton.lineIndex) {
      continue;
    }
    // 跳过自身
    if (button.id === movingButton.id) {
      continue;
    }

    if (checkButtonCollision(movingButton, button, buttonSize)) {
      collidingButtonIds.push(button.id);
    }
  }

  return {
    hasCollision: collidingButtonIds.length > 0,
    collidingButtonIds,
  };
}
