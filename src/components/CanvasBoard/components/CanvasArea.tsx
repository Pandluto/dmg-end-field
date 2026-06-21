import { forwardRef } from 'react';
import type { MouseEvent } from 'react';
import { Character, SkillButton, CanvasConfig, SkillButtonSkillChangePayload, SkillButtonSkillOption } from '../../../types';
import { SkillButtonComponent } from '../SkillButton';
import type { TimelineData } from '../../../types';
import {
  getGridNodeCenterX,
  getGridLineCenterY,
  LINE_ROW_INDICES,
  GRID_ROW_HEIGHT,
  GRID_NODE_COUNT,
} from '../../../core/calculators/gridSnapLayout';
import { normalizeAssetUrl } from '../../../utils/assetResolver';

interface CanvasAreaProps {
  activeSkillButtonId?: string | null;
  config: CanvasConfig;
  staffCount: number;
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  onButtonMouseDown: (event: MouseEvent, buttonId: string) => void;
  onButtonContextMenu: (event: MouseEvent, buttonId: string) => void;
  onCanvasClick: () => void;
  onCanvasPlaceCopy: (e: MouseEvent) => void;
  timelineData?: TimelineData;
  onSkillButtonModalOpen?: () => void;
  onSkillButtonModalClose?: () => void;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onConfirmRemove?: () => void;
  onCloseContextMenu?: () => void;
  onCopy?: () => void;
  onChangeSkillType?: (payload: SkillButtonSkillChangePayload) => void;
  getSkillChangeOptions?: (button: SkillButton) => SkillButtonSkillOption[];
  isDraggingActive?: boolean;
  isBrowseMode?: boolean;
  isInspectMode?: boolean;
}

// 表格行列标注：0行显示字母(A-O)，0列显示数字(1-8)
const columnLabels = Array.from({ length: 15 }, (_, index) => String.fromCharCode(65 + index));
const rowLabels = Array.from({ length: 8 }, (_, index) => String(index + 1));

export const CanvasArea = forwardRef<HTMLDivElement, CanvasAreaProps>(({
  activeSkillButtonId = null,
  config,
  staffCount,
  selectedCharacters,
  skillButtons,
  onButtonMouseDown,
  onButtonContextMenu,
  onCanvasPlaceCopy,
  timelineData,
  onSkillButtonModalOpen,
  onSkillButtonModalClose,
  contextMenuState,
  onConfirmRemove,
  onCloseContextMenu,
  onCopy,
  onChangeSkillType,
  getSkillChangeOptions,
  isDraggingActive = false,
  isBrowseMode = false,
  isInspectMode = false,
}, canvasRef) => {
  const renderSkillButtons = () => {
    return skillButtons
      .map((button) => (
        <SkillButtonComponent
          key={button.id}
          isDetailRouteActive={activeSkillButtonId === button.id}
          button={button}
          size={config.skillButtonSize}
          onMouseDown={(event) => onButtonMouseDown(event, button.id)}
          onContextMenu={(event) => onButtonContextMenu(event, button.id)}
          isBrowseMode={isBrowseMode}
          isInspectMode={isInspectMode}
          timelineData={timelineData}
          onModalOpen={onSkillButtonModalOpen}
          onModalClose={onSkillButtonModalClose}
          contextMenuState={contextMenuState}
          onConfirmRemove={onConfirmRemove}
          onCloseContextMenu={onCloseContextMenu}
          onCopy={onCopy}
          onChangeSkillType={onChangeSkillType}
          skillChangeOptions={getSkillChangeOptions?.(button) ?? []}
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
        {LINE_ROW_INDICES.map((_, lineIndex) => {
          const character = selectedCharacters[lineIndex];
          const lineCenterY = getGridLineCenterY(lineIndex);
          
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
                    src={normalizeAssetUrl(character.avatarUrl)}
                    alt={`${character?.name} avatar`}
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </div>
              
              <div className="canvas-damage-nodes">
                {Array.from({ length: GRID_NODE_COUNT }, (_, nodeIndex) => {
                  const nodeCenterX = getGridNodeCenterX(nodeIndex);
                  return (
                    <div
                      key={`node-${staffIndex}-${lineIndex}-${nodeIndex}`}
                      className="canvas-damage-node"
                      style={{ left: nodeCenterX - 1, top:  GRID_ROW_HEIGHT / 2 - 3 }}
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
        className={`canvas-container${isDraggingActive ? ' is-dragging-active' : ''}`}
        onClick={onCanvasPlaceCopy}
      >
        <div className="canvas-grid-shell">
          <div className="canvas-grid-stack">
            <div className="canvas-left-top-spacer" aria-hidden="true" />
            {renderGridGroups()}
          </div>
        </div>
        {renderSkillButtons()}
      </div>
    </div>
  );
});
