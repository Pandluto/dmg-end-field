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

export const CanvasArea = forwardRef<HTMLDivElement, CanvasAreaProps>(({
  config,
  staffCount,
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
      </div>
    ));
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
