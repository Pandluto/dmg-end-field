import React, { useEffect, useRef, useState } from 'react';
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
import { resolveSkillIconUrl } from '../../utils/assetResolver';
import { migrateOldBuffStorage } from '../../utils/migrateStorage';
import { onSkillButtonBuffAdded, onSkillButtonBuffRemoved } from '../../core/events/buffEvents';
import { generateId } from '../../utils/helpers';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import {
  clientToGridCoords,
  findNearestStaffIndex,
  getGridContentOffsetX,
  getGridGroupTop,
  getGridLineCenterY,
  getOccupiedNodeIndicesForLine,
  gridToCanvasContentCoords,
  GRID_NODE_COUNT,
  resolveSnappedGridNode,
} from '../../core/calculators/gridSnapLayout';
import { getSkillButtonById } from '../../core/repositories';
import { attachExistingBuffsToButton } from '../../core/services/buffService';
import './CanvasBoard.css';

/**
 * position.y 语义：
 * - 旧缓存：position.y = 圆球中心，恢复时需要 +15 兼容到当前底座中线语义
 * - 新缓存：position.y = 底座中线，恢复时不做补偿
 */
const POSITION_Y_SEMANTIC_VERSION = '1.1.0';

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
  const { currentView, selectedCharacters, canvasConfig, skillButtons } = state;
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
    updateSkillButtonType: updateTimelineButtonType,
  } = useTimelineData(selectedCharacters);

  const restoredSignatureRef = useRef<string | null>(null);
  const previousViewRef = useRef(currentView);

  useEffect(() => {
    const selectedCharacterSignature = selectedCharacters.map((character) => character.id).join('|');
    const isEnteringCanvas = previousViewRef.current !== 'canvas' && currentView === 'canvas';
    previousViewRef.current = currentView;

    if (selectedCharacters.length === 0) {
      restoredSignatureRef.current = null;
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      return;
    }

    if (currentView !== 'canvas') {
      return;
    }

    if (restoredSignatureRef.current === selectedCharacterSignature && !isEnteringCanvas) {
      return;
    }
    restoredSignatureRef.current = selectedCharacterSignature;

    migrateOldBuffStorage();

    const loadedData = loadTimelineData();
    if (!loadedData) {
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      return;
    }

    let dataToRestore = loadedData;
    if (loadedData.staffLines.length < selectedCharacters.length) {
      dataToRestore = normalizeTimelineData(loadedData, selectedCharacters);
    }

    const restoredButtons: SkillButton[] = [];
    const needPositionYCompensation = !dataToRestore.version || dataToRestore.version < POSITION_Y_SEMANTIC_VERSION;
    dataToRestore.staffLines.forEach((staffLine) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((btn) => {
        const character = selectedCharacters.find((item) => item.name === btn.characterName);
        const lineIndex = selectedCharacters.findIndex(
          character => character.name === btn.characterName
        );
        const position = needPositionYCompensation
          ? { x: btn.position.x, y: btn.position.y + 15 }
          : btn.position;
        restoredButtons.push({
          id: btn.id,
          characterId: character?.id ?? btn.characterName,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: btn.staffIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          nodeIndex: btn.nodeIndex,
          nodeNumber: btn.nodeNumber,
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          skillIconUrl: resolveSkillIconUrl(btn.characterName, btn.skillType),
          element: character?.element,
        });
      });
    });

    dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
    restoredButtons.forEach((button) => {
      dispatch({ type: 'ADD_SKILL_BUTTON', button });
    });
  }, [currentView, dispatch, loadTimelineData, normalizeTimelineData, selectedCharacters]);

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

  const [contextMenuState, setContextMenuState] = useState<{
    buttonId: string;
    position: { x: number; y: number };
  } | null>(null);

  const [pendingCopy, setPendingCopy] = useState<{
    sourceButtonId: string;
    sourceButtonRuntime: SkillButton;
    sourceSelectedBuff: string[];
  } | null>(null);

  const [copyHintMousePosition, setCopyHintMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!pendingCopy) return;

    const handleMouseMove = (e: MouseEvent) => {
      setCopyHintMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pendingCopy]);

  const handleConfirmRemoveSkillButton = () => {
    if (!contextMenuState) return;
    const { buttonId } = contextMenuState;
    const button = skillButtons.find(item => item.id === buttonId);
    if (button?.isLocked) {
      return;
    }
    if (button && button.lineIndex !== undefined) {
      removeTimelineButton(button.lineIndex, buttonId);
    }
    dispatch({ type: 'REMOVE_SKILL_BUTTON', buttonId });
    setContextMenuState(null);
  };

  const handleCloseButtonContextMenu = () => {
    setContextMenuState(null);
  };

  const handleCopySkillButton = () => {
    if (!contextMenuState) return;
    const { buttonId } = contextMenuState;
    const buttonRuntime = skillButtons.find(item => item.id === buttonId);
    if (!buttonRuntime) return;

    const buttonStorage = getSkillButtonById(buttonId);
    const sourceSelectedBuff = buttonStorage?.selectedBuff ?? [];

    setPendingCopy({
      sourceButtonId: buttonId,
      sourceButtonRuntime: buttonRuntime,
      sourceSelectedBuff,
    });
    setContextMenuState(null);
  };

  const handleBack = () => {
    dispatch({ type: 'SET_VIEW', view: 'selection' });
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
    setPendingCopy(null);
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

    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId });
    setContextMenuState({
      buttonId,
      position: { x: button?.position.x ?? 0, y: button?.position.y ?? 0 },
    });
  };

  const handleChangeSkillType = (buttonId: string, nextSkillType: 'A' | 'B' | 'E' | 'Q') => {
    const button = skillButtons.find(item => item.id === buttonId);
    if (!button) return;

    const result = updateTimelineButtonType(buttonId, nextSkillType);
    if (!result) {
      console.warn(`[改类型] 失败: 按钮 ${buttonId} 不存在于 timelineData`);
      return;
    }

    const newSkillIconUrl = resolveSkillIconUrl(button.characterName, nextSkillType);

    dispatch({
      type: 'UPDATE_SKILL_BUTTON_TYPE',
      buttonId,
      skillType: nextSkillType,
      skillIconUrl: newSkillIconUrl,
    });

    console.log(`[改类型] buttonId=${buttonId}, ${button.skillType} -> ${nextSkillType}, 图标已更新`);
  };

  const handleCanvasClick = () => {
    dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
    setContextMenuState(null);
  };

  const handleCanvasPlaceCopy = (e: React.MouseEvent) => {
    if (!pendingCopy) {
      dispatch({ type: 'SELECT_SKILL_BUTTON', buttonId: null });
      setContextMenuState(null);
      return;
    }
    if (!canvasRef.current) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const gridStackEl = canvasRef.current.querySelector('.canvas-grid-stack');
    if (!gridStackEl) return;

    const gridStackRect = gridStackEl.getBoundingClientRect();
    const { gridX, gridY } = clientToGridCoords(e.clientX, e.clientY, canvasRect, gridStackRect);

    const sourceLineIndex = pendingCopy.sourceButtonRuntime.lineIndex;
    const staffIndex = findNearestStaffIndex(gridY, staffCount);
    const lineY = getGridGroupTop(staffIndex) + getGridLineCenterY(sourceLineIndex);

    const gridContentOffsetX = getGridContentOffsetX(canvasRef.current, gridStackEl);
    const occupiedNodeIndices = getOccupiedNodeIndicesForLine(
      skillButtons,
      staffIndex,
      sourceLineIndex,
      null,
      gridContentOffsetX
    );

    const snappedResult = resolveSnappedGridNode(gridX, occupiedNodeIndices);
    if (!snappedResult) {
      console.log('[复制吸附] 满行无可用节点，取消复制');
      setPendingCopy(null);
      return;
    }

    const { nodeIndex: snappedNodeIndex, nodeCenterX } = snappedResult;

    const snappedPosition = gridToCanvasContentCoords(
      nodeCenterX,
      lineY,
      canvasRef.current,
      gridStackEl
    );

    handlePlaceCopiedButton(staffIndex, sourceLineIndex, snappedNodeIndex, snappedPosition);
  };

  const handlePlaceCopiedButton = (
    targetStaffIndex: number,
    targetLineIndex: number,
    targetNodeIndex: number,
    targetPosition: { x: number; y: number }
  ) => {
    if (!pendingCopy) return;

    const { sourceButtonRuntime, sourceSelectedBuff } = pendingCopy;
    const newButtonId = generateId();

    const newButtonRuntime: SkillButton = {
      ...sourceButtonRuntime,
      id: newButtonId,
      staffIndex: targetStaffIndex,
      lineIndex: targetLineIndex,
      nodeIndex: targetNodeIndex,
      nodeNumber: calculateNodeNumber(targetNodeIndex),
      position: targetPosition,
      isDragging: false,
      isSelected: false,
    };

    dispatch({ type: 'ADD_SKILL_BUTTON', button: newButtonRuntime });

    const persistenceStaffIndex = targetLineIndex;
    const persistenceNodeIndex = targetStaffIndex * GRID_NODE_COUNT + targetNodeIndex;
    addTimelineButton({
      characterName: sourceButtonRuntime.characterName,
      skillType: sourceButtonRuntime.skillType,
      staffIndex: persistenceStaffIndex,
      nodeIndex: persistenceNodeIndex,
      position: targetPosition,
    }, newButtonId);

    if (sourceSelectedBuff.length > 0) {
      attachExistingBuffsToButton(newButtonId, sourceSelectedBuff);
    }

    setPendingCopy(null);
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
            onCanvasPlaceCopy={handleCanvasPlaceCopy}
            timelineData={timelineData}
            onSkillButtonModalOpen={handleSkillButtonModalOpen}
            onSkillButtonModalClose={handleSkillButtonModalClose}
            contextMenuState={contextMenuState}
            onConfirmRemove={handleConfirmRemoveSkillButton}
            onCloseContextMenu={handleCloseButtonContextMenu}
            onCopy={handleCopySkillButton}
            onChangeSkillType={handleChangeSkillType}
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

      {pendingCopy && (
        <div
          style={{
            position: 'fixed',
            left: copyHintMousePosition.x + 16,
            top: copyHintMousePosition.y + 16,
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 13,
            pointerEvents: 'none',
            zIndex: 9999,
            whiteSpace: 'nowrap',
          }}
        >
          已复制，点击目标位置放置
        </div>
      )}
    </div>
  );
}
