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
          <div className="canvas-grid-background" aria-hidden="true" />
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
