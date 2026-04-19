import { forwardRef, useEffect, useRef, useState } from 'react';
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const updateGridSize = () => {
      const rect = host.getBoundingClientRect();
      const nextWidth = Math.max(5, Math.floor((rect.width - 20) / 5) * 5);
      const nextHeight = Math.max(5, Math.floor((rect.height - 10) / 5) * 5);

      setGridSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateGridSize();

    const resizeObserver = new ResizeObserver(updateGridSize);
    resizeObserver.observe(host);
    return () => resizeObserver.disconnect();
  }, []);

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
      <div key={`grid-group-${index}`} className="canvas-grid-group">
        <div className="canvas-grid-background" aria-hidden="true" />
      </div>
    ));
  };

  return (
    <div ref={hostRef} className="canvas-area">
      <div
        ref={canvasRef}
        className="canvas-container"
        onClick={onCanvasClick}
      >
        <div
          className="canvas-grid-shell"
          style={{
            width: gridSize.width || undefined,
            height: gridSize.height || undefined,
          } as React.CSSProperties}
        >
          <div className="canvas-grid-stack">
            {renderGridGroups()}
          </div>
        </div>
        {renderSkillButtons()}
      </div>
    </div>
  );
});
