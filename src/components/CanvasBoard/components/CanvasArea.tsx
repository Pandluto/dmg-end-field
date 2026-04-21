import { forwardRef } from 'react';
import type { MouseEvent } from 'react';
import { Character, SkillButton, CanvasConfig } from '../../../types';
import { SkillButtonComponent } from '../SkillButton';
import type { TimelineData } from '../../../types';

interface CanvasAreaProps {
  config: CanvasConfig;
  staffCount: number;
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  onButtonMouseDown: (event: MouseEvent, buttonId: string) => void;
  onButtonContextMenu: (event: MouseEvent, buttonId: string) => void;
  onCanvasClick: () => void;
  timelineData?: TimelineData;
  onSkillButtonModalOpen?: () => void;
}

// 表格行列标注：0行显示字母(A-O)，0列显示数字(1-8)
const columnLabels = Array.from({ length: 15 }, (_, index) => String.fromCharCode(65 + index));
const rowLabels = Array.from({ length: 8 }, (_, index) => String(index + 1));

// 表格坐标常量
const FIRST_COLUMN_WIDTH = 40;
const COLUMN_WIDTH = 80;
const ROW_HEIGHT = 30;
// 谱线对齐表格行：用户看到的第1行=索引0，第2行=索引1，...
// 第1条谱线→索引3，第2条→索引5，第3条→索引7，第4条→索引9
const LINE_ROW_INDICES = [3, 5, 7, 9];
const NODE_COUNT = 15; // 每行15个伤害节点

export const CanvasArea = forwardRef<HTMLDivElement, CanvasAreaProps>(({
  config,
  staffCount,
  selectedCharacters,
  skillButtons,
  onButtonMouseDown,
  onButtonContextMenu,
  onCanvasClick,
  timelineData,
  onSkillButtonModalOpen,
}, canvasRef) => {
  const renderSkillButtons = () => {
    return skillButtons
      .filter((button) => button.isFromSandbox)
      .map((button) => (
        <SkillButtonComponent
          key={button.id}
          button={button}
          size={config.skillButtonSize}
          onMouseDown={(event) => onButtonMouseDown(event, button.id)}
          onContextMenu={(event) => onButtonContextMenu(event, button.id)}
          timelineData={timelineData}
          onModalOpen={onSkillButtonModalOpen}
        />
      ));
  };

  const renderGridGroups = () => {
    return Array.from({ length: staffCount }, (_, index) => (
      <div key={`grid-row-${index}`} className="canvas-grid-row">
        <div className="canvas-grid-group">
          <div className="canvas-grid-header-bg" aria-hidden="true" />
          <div className="canvas-grid-background" aria-hidden="true" />
          <div className="canvas-grid-labels" aria-hidden="true">
            <div className="canvas-grid-corner" />
            <div className="canvas-grid-column-labels">
              {columnLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="canvas-grid-row-labels">
              {rowLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        </div>
        {renderStaffVisualGroup(index)}
      </div>
    ));
  };

  // 渲染谱线视觉层 - 独立UI层覆盖在表格背景上方
  const renderStaffVisualGroup = (staffIndex: number) => {
    return (
      <div key={`staff-visual-${staffIndex}`} className="canvas-staff-visual-group" aria-hidden="true">
        {LINE_ROW_INDICES.map((rowIndex, lineIndex) => {
          const character = selectedCharacters[lineIndex];
          const lineCenterY = rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
          
          return (
            <div
              key={`staff-line-${staffIndex}-${lineIndex}`}
              className="canvas-staff-visual-line"
              data-line-index={lineIndex}
              style={{ top: lineCenterY }}
            >
              <div className="canvas-staff-line" />
              
              <div className="canvas-staff-line-label">
                {character?.avatarUrl && (
                  <img
                    className="canvas-staff-avatar"
                    src={character.avatarUrl}
                    alt={`${character?.name} avatar`}
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="canvas-staff-name">
                  {character?.name || `干员 ${lineIndex + 1}`}
                </span>
              </div>
              
              <div className="canvas-damage-nodes">
                {Array.from({ length: NODE_COUNT }, (_, nodeIndex) => {
                  const nodeCenterX = FIRST_COLUMN_WIDTH + nodeIndex * COLUMN_WIDTH + COLUMN_WIDTH / 2;
                  return (
                    <div
                      key={`node-${staffIndex}-${lineIndex}-${nodeIndex}`}
                      className="canvas-damage-node"
                      style={{ left: nodeCenterX - 1, top: -3 }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="canvas-area">
      <div
        ref={canvasRef}
        className="canvas-container"
        onClick={onCanvasClick}
      >
        <div className="canvas-grid-shell">
          <div className="canvas-grid-stack">
            {renderGridGroups()}
          </div>
        </div>
        {renderSkillButtons()}
      </div>
    </div>
  );
});
