/**
 * 拖拽遮罩层（DraggingOverlay）
 *
 * 渲染一个跟随鼠标移动的半透明按钮，在拖拽过程中始终显示在最顶层（z-index: 1000）
 * 不影响底层元素的鼠标事件（pointer-events: none）
 */

import { SkillType } from '../../../types';

interface DraggingState {
  id: string;
  skillType: SkillType;
}

interface DraggingOverlayProps {
  /** 当前拖拽状态（null = 无拖拽，不渲染遮罩） */
  draggingState: DraggingState | null;
  /** 鼠标在页面上的坐标 */
  mousePosition: { x: number; y: number };
  /** 按钮直径 */
  buttonSize: number;
}

export function DraggingOverlay({ draggingState, mousePosition, buttonSize }: DraggingOverlayProps) {
  if (!draggingState) return null;

  return (
    <div
      className="skill-button dragging"
      style={{
        position: 'fixed',
        left: mousePosition.x - buttonSize / 2,
        top: mousePosition.y - buttonSize / 2,
        width: buttonSize,
        height: buttonSize,
        borderRadius: buttonSize / 2,
        backgroundColor: '#333',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 'bold',
        pointerEvents: 'none',
        zIndex: 1000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      {draggingState.skillType}
    </div>
  );
}
