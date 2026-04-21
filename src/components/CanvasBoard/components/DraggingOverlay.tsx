/**
 * 拖拽遮罩层（DraggingOverlay）
 *
 * 只负责拖动中的视觉预览，不参与吸附、落点和存储计算。
 */

import type { CSSProperties } from 'react';
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

  const radius = buttonSize / 2;
  const baseWidth = 80;
  const baseHeight = 30;
  const visualOffsetX = 40;
  const visualOffsetY = 15;

  return (
    <div
      className="dragging-skill-button-preview"
      style={{
        left: mousePosition.x - radius - visualOffsetX,
        top: mousePosition.y - radius - visualOffsetY,
        width: radius + baseWidth,
        height: Math.max(buttonSize, radius + baseHeight),
        '--drag-preview-size': `${buttonSize}px`,
        '--drag-preview-radius': `${radius}px`,
      } as CSSProperties}
    >
      <div className="dragging-skill-button-anchor">
        <div className="dragging-skill-button-base">
          <span>{draggingState.skillType}</span>
        </div>
        <div className="dragging-skill-button-orb">
          <span>{draggingState.skillType}</span>
        </div>
      </div>
    </div>
  );
}
