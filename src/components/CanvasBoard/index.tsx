import React, { useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SkillSandbox } from './SkillSandbox';
import { useCanvasWidth } from './hooks/useCanvasWidth';
import { useSelectStart } from './hooks/useSelectStart';
import { useCanvasDrag } from './hooks/useCanvasDrag';
import { useTimelineData } from '../../hooks/useTimelineData';
import { CanvasArea } from './components/CanvasArea';
import { ToolPanel } from '../ToolPanel';
import { DraggingOverlay } from './components/DraggingOverlay';
import { OperatorConfigPanel } from './components/OperatorConfigPanel';
import { Toolbar } from './components/Toolbar';
import { SkillButton } from '../../types';
import { migrateOldBuffStorage } from '../../utils/migrateStorage';
import { onSkillButtonBuffAdded, onSkillButtonBuffRemoved } from '../../core/events/buffEvents';
import './CanvasBoard.css';

interface CanvasBoardProps {
  workbenchMode?: 'selection' | 'timeline' | 'toolPanel';
  isToolPanelVisible?: boolean;
  isWorkbenchTopZoneOpen?: boolean;
  operatorConfigVisible?: boolean;
  operatorConfigCharacterId?: string | null;
  onSkillButtonModalOpen?: () => void;
  onSkillButtonModalClose?: () => void;
  onCloseOperatorConfig?: () => void;
  onOpenOperatorConfig?: (characterId: string) => void;
  workbenchControl?: React.ReactNode;
  bottomRightControl?: React.ReactNode;
}

export function CanvasBoard({
  workbenchMode: _workbenchMode = 'timeline',
  isToolPanelVisible = true,
  isWorkbenchTopZoneOpen = false,
  operatorConfigVisible = false,
  operatorConfigCharacterId = null,
  onSkillButtonModalOpen,
  onSkillButtonModalClose,
  onCloseOperatorConfig,
  onOpenOperatorConfig,
  workbenchControl,
  bottomRightControl,
}: CanvasBoardProps) {
  const { state, dispatch } = useAppContext();
  const { selectedCharacters, canvasConfig, skillButtons } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [staffCount, setStaffCount] = React.useState(canvasConfig.staffCount);

  const canvasWidth = useCanvasWidth(canvasConfig.canvasWidthPercent);
  useSelectStart();

  const {
    timelineData,
    addSkillButton: addTimelineButton,
    removeSkillButton: removeTimelineButton,
    updateSkillButtonPosition,
    moveSkillButtonToStaff,
    saveTimelineData,
    loadTimelineData,
    normalizeTimelineData,
  } = useTimelineData(selectedCharacters);

  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (hasRestoredRef.current) {
      return;
    }
    hasRestoredRef.current = true;

    migrateOldBuffStorage();

    const loadedData = loadTimelineData();
    if (!loadedData) {
      return;
    }

    let dataToRestore = loadedData;
    if (loadedData.staffLines.length < selectedCharacters.length) {
      dataToRestore = normalizeTimelineData(loadedData, selectedCharacters);
    }

    const restoredButtons: SkillButton[] = [];
    dataToRestore.staffLines.forEach((staffLine) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((btn) => {
        const lineIndex = selectedCharacters.findIndex(
          character => character.name === btn.characterName
        );
        restoredButtons.push({
          id: btn.id,
          characterId: btn.characterName,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position: btn.position,
          staffIndex: btn.staffIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          nodeIndex: btn.nodeIndex,
          nodeNumber: btn.nodeNumber,
          isDragging: false,
          isSelected: false,
          isFromSandbox: false,
        });
      });
    });

    dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
    restoredButtons.forEach((button) => {
      dispatch({ type: 'ADD_SKILL_BUTTON', button });
    });
  }, [dispatch, loadTimelineData, normalizeTimelineData, selectedCharacters]);

  useEffect(() => {
    return onSkillButtonBuffAdded(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      console.log('[Buff event] added:', buttonId, buffId);
    });
  }, []);

  useEffect(() => {
    return onSkillButtonBuffRemoved(({ buttonId, buffId }) => {
      if (!buttonId || !buffId) return;
      console.log('[Buff event] removed:', buttonId, buffId);
    });
  }, []);



  const { draggingState, mousePosition, handleSandboxDragStart, handleButtonMouseDown } = useCanvasDrag({
    config: canvasConfig,
    canvasWidth,
    staffCount,
    selectedCharacters,
    skillButtons,
    canvasRef,
    dispatch,
    addTimelineButton,
    updateSkillButtonPosition,
    moveTimelineButtonToStaff: moveSkillButtonToStaff,
  });

  const handleBack = () => {
    dispatch({ type: 'SET_VIEW', view: 'selection' });
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
  };

  const handleAddStaffGroup = () => {
    if (staffCount < 5) {
      setStaffCount(prev => prev + 1);
    }
  };

  const handleRemoveStaffGroup = () => {
    if (staffCount > 2) {
      setStaffCount(prev => prev - 1);
    }
  };

  const handleButtonContextMenu = (event: React.MouseEvent, buttonId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const button = skillButtons.find(item => item.id === buttonId);
    if (button?.isLocked) {
      return;
    }

    if (button && button.lineIndex !== undefined) {
      removeTimelineButton(button.lineIndex, buttonId);
    }

    dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId });
  };

  const handleCanvasClick = () => {
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
  };

  const handleAvatarDoubleClick = (characterId: string) => {
    onOpenOperatorConfig?.(characterId);
  };

  const closeConfigPanel = () => {
    onCloseOperatorConfig?.();
  };

  const handleConfigCharacterSelect = (characterId: string) => {
    onOpenOperatorConfig?.(characterId);
  };

  const handleSaveTimeline = () => {
    saveTimelineData();
    alert('排轴数据已保存');
  };

  const handleSkillButtonModalOpen = () => {
    onSkillButtonModalOpen?.();
  };

  const handleSkillButtonModalClose = () => {
    onSkillButtonModalClose?.();
  };

  return (
    <div className={`canvas-board ${isWorkbenchTopZoneOpen ? 'has-top-zone' : ''}`}>
      <div className="canvas-layout">
        <div className="canvas-background-layer">
          <div className="skew-panel" />
          <div className="skew-panel-bottom" />
        </div>

        <div className="canvas-left-zone">
          <CanvasArea
            ref={canvasRef}
            config={canvasConfig}
            staffCount={staffCount}
            selectedCharacters={selectedCharacters}
            skillButtons={skillButtons}
            onButtonMouseDown={handleButtonMouseDown}
            onButtonContextMenu={handleButtonContextMenu}
            onCanvasClick={handleCanvasClick}
            timelineData={timelineData}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
          />
        </div>

        <aside className={`canvas-right-zone ${isToolPanelVisible ? 'is-tool-panel' : 'is-skill-sandbox'}`}>
          {isToolPanelVisible ? (
            <ToolPanel widthPercent={100} />
          ) : (
            <SkillSandbox
              selectedCharacters={selectedCharacters}
              onDragStart={handleSandboxDragStart}
              onAvatarDoubleClick={handleAvatarDoubleClick}
            />
          )}
        </aside>

        <div className="canvas-bottom-zone">
          <div className="canvas-bottom-zone-left">
            {workbenchControl}
            <Toolbar
              staffCount={staffCount}
              onBack={handleBack}
              onAddGroup={handleAddStaffGroup}
              onRemoveGroup={handleRemoveStaffGroup}
              onSave={handleSaveTimeline}
            />
          </div>
          <div className="canvas-bottom-zone-center" />
          <div className="canvas-bottom-zone-right">{bottomRightControl}</div>
        </div>
      </div>

      <OperatorConfigPanel
        isOpen={operatorConfigVisible}
        activeCharacterId={operatorConfigCharacterId}
        selectedCharacters={selectedCharacters}
        onSelectCharacter={handleConfigCharacterSelect}
        onClose={closeConfigPanel}
      />

      <DraggingOverlay
        draggingState={draggingState ? { id: draggingState.id, skillType: draggingState.skillType } : null}
        mousePosition={mousePosition}
        buttonSize={canvasConfig.skillButtonSize}
      />
    </div>
  );
}
