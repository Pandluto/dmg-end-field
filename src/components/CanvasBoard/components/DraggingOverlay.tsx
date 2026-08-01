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
  const outlinePadding = 4;
  const compositeOutlineViewBox = `${-radius - outlinePadding} ${-radius - outlinePadding} ${baseWidth + radius + outlinePadding * 2} ${baseHeight + radius + outlinePadding * 2}`;
  const compositeOutlinePath = [
    `M 0 ${-radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    `L ${baseWidth} 0`,
    `L ${baseWidth} ${baseHeight}`,
    `L 0 ${baseHeight}`,
    `L 0 ${radius}`,
    `A ${radius} ${radius} 0 1 1 0 ${-radius}`,
    'Z',
  ].join(' ');

  return (
    <div
      className="dragging-skill-button-preview"
      data-skill-type={draggingState.skillType}
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
        <svg
          className="skill-button-composite-outline"
          viewBox={compositeOutlineViewBox}
          style={{
            left: -radius - outlinePadding,
            top: -radius - outlinePadding,
            width: baseWidth + radius + outlinePadding * 2,
            height: baseHeight + radius + outlinePadding * 2,
          }}
          aria-hidden="true"
        >
          <path d={compositeOutlinePath} />
        </svg>
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
