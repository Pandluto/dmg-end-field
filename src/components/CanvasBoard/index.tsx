import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { SkillSandbox } from './SkillSandbox';
import { useCanvasWidth } from './hooks/useCanvasWidth';
import { useSelectStart } from './hooks/useSelectStart';
import { useCanvasDrag } from './hooks/useCanvasDrag';
import { useTimelineData } from '../../hooks/useTimelineData';
import { CanvasArea } from './components/CanvasArea';
import { ToolPanel } from '../ToolPanel';
import { ReportTab } from '../ToolPanel/components/ReportTab';
import { DraggingOverlay } from './components/DraggingOverlay';
import { OperatorConfigPanel } from './components/OperatorConfigPanel';
import { Toolbar } from './components/Toolbar';
import {
  Character,
  SandboxSkill,
  SkillButton,
  SkillButtonSkillChangePayload,
  SkillButtonSkillOption,
} from '../../types';
import { resolveSkillIconUrl } from '../../utils/assetResolver';
import { onSkillButtonBuffAdded, onSkillButtonBuffRemoved } from '../../core/events/buffEvents';
import { generateId } from '../../utils/helpers';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import { SKILL_BUTTON_BASELINE_OFFSET_Y } from '../../constants/canvas-layout';
import {
  clientToGridCoords,
  findNearestStaffIndex,
  getGridContentOffsetX,
  getGridGroupTop,
  getGridLineCenterY,
  getGridNodeCenterX,
  getOccupiedNodeIndicesForLine,
  gridToCanvasContentCoords,
  GRID_NODE_COUNT,
  resolveSnappedGridNode,
} from '../../core/calculators/gridSnapLayout';
import { getSkillButtonById } from '../../core/repositories';
import { attachExistingBuffsToButton } from '../../core/services/buffService';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { getRuntimeOperatorTemplateById, setSelectedCharacterIds } from '../../utils/storage';
import {
  applyTimelineSnapshotPayload,
  buildTimelineShareFile,
  buildTimelineShareFileName,
  deleteTimelineSnapshot,
  listTimelineSnapshots,
  parseTimelineShareFile,
  restoreTimelineSnapshot,
  saveTimelineSnapshot,
  TIMELINE_SNAPSHOT_LIMIT,
  type TimelineSnapshotEntry,
  type TimelineShareFile,
} from '../../utils/timelineSnapshotStorage';
import './CanvasBoard.css';

function formatPreciseTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  const milliseconds = `${date.getMilliseconds()}`.padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function buildSnapshotBuffPreview(snapshot: TimelineSnapshotEntry): string[] {
  const buffNames = snapshot.payload.allBuffList
    .map((buff) => buff.displayName?.trim() || buff.name?.trim() || buff.id)
    .filter((name, index, array) => Boolean(name) && array.indexOf(name) === index);

  if (buffNames.length === 0) {
    return ['无 Buff'];
  }

  const previewLimit = 8;
  const preview = buffNames.slice(0, previewLimit);
  if (buffNames.length > previewLimit) {
    preview.push(`... 其余 ${buffNames.length - previewLimit} 项`);
  }
  return preview;
}

function buildSandboxSkillsFromRuntimeTemplate(characterId: string): SandboxSkill[] {
  const template = getRuntimeOperatorTemplateById(characterId);
  if (!template) {
    return [];
  }

  return template.skills.map((skill) => ({
    id: skill.id,
    displayName: skill.displayName,
    buttonType: skill.buttonType,
    iconUrl: skill.iconUrl,
    hitCount: skill.hitCount,
    source: template.source,
    customHits: skill.hits.map((hit) => ({
      key: hit.key,
      displayName: hit.displayName,
      multiplier: hit.multiplier,
      element: hit.element,
      skillType: hit.skillType,
    })),
  }));
}

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
  const isCandidatePanelEnabled = false;
  const { state, dispatch } = useAppContext();
  const { currentView, selectedCharacters, canvasConfig, skillButtons } = state;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [staffCount, setStaffCount] = React.useState(canvasConfig.staffCount);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportAutoGenerateToken, setReportAutoGenerateToken] = useState(0);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isSaveSnapshotModalOpen, setIsSaveSnapshotModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [snapshotDraftName, setSnapshotDraftName] = useState('');
  const [shareDraftName, setShareDraftName] = useState('');
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<TimelineSnapshotEntry | null>(null);
  const [pendingImportShare, setPendingImportShare] = useState<TimelineShareFile | null>(null);
  const [timelineSnapshots, setTimelineSnapshots] = useState<TimelineSnapshotEntry[]>([]);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

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

    const loadedData = loadTimelineData();
    if (!loadedData) {
      dispatch({ type: 'CLEAR_SKILL_BUTTONS' });
      return;
    }

    let dataToRestore = loadedData;
    if (loadedData.staffLines.length < selectedCharacters.length) {
      dataToRestore = normalizeTimelineData(loadedData, selectedCharacters);
    }

    const gridStackElement = canvasRef.current?.querySelector('.canvas-grid-stack');
    const restoredGridContentOffsetX =
      canvasRef.current && gridStackElement
        ? getGridContentOffsetX(canvasRef.current, gridStackElement)
        : null;

    const restoredButtons: SkillButton[] = [];
    dataToRestore.staffLines.forEach((staffLine) => {
      const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
      buttons.forEach((btn) => {
        const character = selectedCharacters.find((item) => item.name === btn.characterName);
        const lineIndex = selectedCharacters.findIndex(
          character => character.name === btn.characterName
        );
        const restoredGroupIndex =
          typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex)
            ? Math.floor(btn.nodeIndex / GRID_NODE_COUNT)
            : 0;
        const restoredNodeIndex =
          typeof btn.nodeIndex === 'number' && Number.isFinite(btn.nodeIndex)
            ? btn.nodeIndex % GRID_NODE_COUNT
            : 0;
        const restoredLineIndex = lineIndex >= 0 ? lineIndex : 0;
        const normalizedPositionY =
          getGridGroupTop(restoredGroupIndex) +
          getGridLineCenterY(restoredLineIndex) +
          SKILL_BUTTON_BASELINE_OFFSET_Y;
        const normalizedPositionX =
          restoredGridContentOffsetX !== null
            ? restoredGridContentOffsetX + getGridNodeCenterX(restoredNodeIndex)
            : btn.position.x;
        const position = { x: normalizedPositionX, y: normalizedPositionY };
        restoredButtons.push({
          id: btn.id,
          characterId: character?.id ?? btn.characterName,
          characterName: btn.characterName,
          skillType: btn.skillType,
          position,
          staffIndex: restoredGroupIndex,
          lineIndex: lineIndex >= 0 ? lineIndex : 0,
          nodeIndex: restoredNodeIndex,
          nodeNumber: calculateNodeNumber(restoredNodeIndex),
          isDragging: false,
          isSelected: false,
          isFromSandbox: true,
          runtimeSkillId: btn.runtimeSkillId,
          skillDisplayName: btn.skillDisplayName,
          skillIconUrl: btn.skillIconUrl ?? resolveSkillIconUrl(btn.characterName, btn.skillType),
          customHits: btn.customHits,
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

  const findCharacterForButton = (button: SkillButton): Character | undefined => {
    return selectedCharacters.find((character) => character.id === button.characterId)
      ?? selectedCharacters.find((character) => character.name === button.characterName);
  };

  const getCharacterSkillList = (button: SkillButton): SandboxSkill[] => {
    const character = findCharacterForButton(button);
    if (Array.isArray(character?.sandboxSkills) && character.sandboxSkills.length > 0) {
      return character.sandboxSkills;
    }

    const runtimeSkills = buildSandboxSkillsFromRuntimeTemplate(character?.id ?? button.characterId);
    if (runtimeSkills.length > 0) {
      return runtimeSkills;
    }

    if (!character) {
      return [];
    }

    return (['A', 'B', 'E', 'Q'] as const).map((skillType) => ({
      id: `fallback-${character.id}-${skillType}`,
      displayName: skillType,
      buttonType: skillType,
      iconUrl: character.skillIconMap?.[skillType] ?? resolveSkillIconUrl(character.name, skillType),
      hitCount: 1,
      source: character.librarySource ?? 'official',
    }));
  };

  const isSameSkillOption = (button: SkillButton, option: SkillButtonSkillOption): boolean => {
    if (button.runtimeSkillId && option.nextRuntimeSkillId) {
      return button.runtimeSkillId === option.nextRuntimeSkillId;
    }

    if (button.skillDisplayName && option.nextSkillDisplayName) {
      return button.skillType === option.nextSkillType && button.skillDisplayName === option.nextSkillDisplayName;
    }

    return button.skillType === option.nextSkillType && !button.runtimeSkillId;
  };

  const getSkillChangeOptions = (button: SkillButton): SkillButtonSkillOption[] => {
    const character = findCharacterForButton(button);
    return getCharacterSkillList(button)
      .map((skill) => ({
        nextSkillType: skill.buttonType,
        nextRuntimeSkillId: skill.id,
        nextSkillDisplayName: skill.displayName,
        nextSkillIconUrl: skill.iconUrl
          ?? character?.skillIconMap?.[skill.buttonType]
          ?? resolveSkillIconUrl(button.characterName, skill.buttonType),
        nextCustomHits: skill.customHits,
      }))
      .filter((option) => !isSameSkillOption(button, option));
  };

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

  const handleChangeSkillType = (payload: SkillButtonSkillChangePayload) => {
    const button = skillButtons.find(item => item.id === payload.buttonId);
    if (!button) return;

    const resolvedTarget = getSkillChangeOptions(button).find((option) => {
      if (payload.nextRuntimeSkillId && option.nextRuntimeSkillId) {
        return option.nextRuntimeSkillId === payload.nextRuntimeSkillId;
      }
      if (payload.nextSkillDisplayName && option.nextSkillDisplayName) {
        return option.nextSkillType === payload.nextSkillType && option.nextSkillDisplayName === payload.nextSkillDisplayName;
      }
      return option.nextSkillType === payload.nextSkillType;
    });

    if (!resolvedTarget) {
      console.warn(`[改类型] 失败: 按钮 ${payload.buttonId} 未找到目标技能项`);
      return;
    }

    const result = updateTimelineButtonType({
      buttonId: payload.buttonId,
      ...resolvedTarget,
    });
    if (!result) {
      console.warn(`[改类型] 失败: 按钮 ${payload.buttonId} 不存在于 timelineData`);
      return;
    }

    dispatch({
      type: 'UPDATE_SKILL_BUTTON_TYPE',
      buttonId: payload.buttonId,
      skillType: result.skillType ?? resolvedTarget.nextSkillType,
      runtimeSkillId: result.runtimeSkillId,
      skillDisplayName: result.skillDisplayName,
      skillIconUrl: result.skillIconUrl,
      customHits: result.customHits,
    });

    console.log(
      `[改类型] buttonId=${payload.buttonId}, ${button.skillType} -> ${resolvedTarget.nextSkillType}, runtimeSkillId=${resolvedTarget.nextRuntimeSkillId ?? 'N/A'}`
    );
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
      characterId: sourceButtonRuntime.characterId,
      characterName: sourceButtonRuntime.characterName,
      skillType: sourceButtonRuntime.skillType,
      staffIndex: persistenceStaffIndex,
      nodeIndex: persistenceNodeIndex,
      position: targetPosition,
      runtimeSkillId: sourceButtonRuntime.runtimeSkillId,
      skillDisplayName: sourceButtonRuntime.skillDisplayName,
      skillIconUrl: sourceButtonRuntime.skillIconUrl,
      customHits: sourceButtonRuntime.customHits,
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

  const refreshTimelineSnapshotList = () => {
    setTimelineSnapshots(listTimelineSnapshots());
  };

  const handleOpenSaveSnapshotModal = () => {
    setSnapshotDraftName('');
    setIsSaveSnapshotModalOpen(true);
  };

  const handleCloseSaveSnapshotModal = () => {
    setIsSaveSnapshotModalOpen(false);
    setSnapshotDraftName('');
  };

  const handleSaveTimelineSnapshot = () => {
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));

    const snapshot = saveTimelineSnapshot(snapshotDraftName);
    if (!snapshot) {
      alert('当前没有可保存的排轴数据');
      return;
    }

    refreshTimelineSnapshotList();
    handleCloseSaveSnapshotModal();
    alert(`快照已保存：${snapshot.label}`);
  };

  const handleOpenSnapshotModal = () => {
    refreshTimelineSnapshotList();
    setIsSnapshotModalOpen(true);
  };

  const handleCloseSnapshotModal = () => {
    setIsSnapshotModalOpen(false);
    setPendingRestoreSnapshot(null);
  };

  const handleRequestRestoreSnapshot = (snapshot: TimelineSnapshotEntry) => {
    setPendingRestoreSnapshot(snapshot);
  };

  const handleCancelRestoreSnapshot = () => {
    setPendingRestoreSnapshot(null);
  };

  const handleConfirmRestoreSnapshot = () => {
    if (!pendingRestoreSnapshot) {
      return;
    }

    const restored = restoreTimelineSnapshot(pendingRestoreSnapshot.id);
    if (!restored) {
      alert('恢复失败：未找到对应快照');
      return;
    }

    setPendingRestoreSnapshot(null);
    window.location.reload();
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    deleteTimelineSnapshot(snapshotId);
    refreshTimelineSnapshotList();
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportTimelineJson = () => {
    saveTimelineData();
    setSelectedCharacterIds(selectedCharacters.map((character) => character.id));

    const shareFile = buildTimelineShareFile(shareDraftName);
    if (!shareFile) {
      alert('当前没有可导出的排轴数据');
      return;
    }

    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildTimelineShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenShareImportPicker = () => {
    shareImportInputRef.current?.click();
  };

  const handleShareFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsed = parseTimelineShareFile(rawText);
    if (!parsed) {
      alert('导入失败：文件不是有效的排轴分享 JSON');
      event.target.value = '';
      return;
    }

    setPendingImportShare(parsed);
    event.target.value = '';
  };

  const handleCancelImportShare = () => {
    setPendingImportShare(null);
  };

  const handleConfirmImportShare = () => {
    if (!pendingImportShare) {
      return;
    }

    applyTimelineSnapshotPayload(pendingImportShare.payload);
    setPendingImportShare(null);
    window.location.reload();
  };

  const handleOpenDamageReport = () => {
    setIsReportModalOpen(true);
    setReportAutoGenerateToken((prev) => prev + 1);
  };

  const handleCloseDamageReport = () => {
    setIsReportModalOpen(false);
  };

  const handleOpenReportSheet = () => {
    navigateToAppPath(APP_ROUTE_PATHS.damageSheet);
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
            getSkillChangeOptions={getSkillChangeOptions}
          />
        </div>

        <aside className={`canvas-right-zone ${isToolPanelVisible && isCandidatePanelEnabled ? 'is-tool-panel' : 'is-skill-sandbox'}`}>
          {isToolPanelVisible && isCandidatePanelEnabled ? (
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
              onSave={handleOpenSaveSnapshotModal}
              onRestore={handleOpenSnapshotModal}
              onShare={handleOpenShareModal}
              onTable={handleOpenReportSheet}
              onCalculate={handleOpenDamageReport}
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

      {isReportModalOpen && (
        <div className="damage-report-modal-overlay" onClick={handleCloseDamageReport}>
          <div className="damage-report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="damage-report-modal-head">
              <div>
                <h3>伤害结算报表</h3>
                <p>独立报表窗口，不占用右侧陈列区</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseDamageReport}>
                关闭
              </button>
            </div>
            <ReportTab autoGenerateToken={reportAutoGenerateToken} />
          </div>
        </div>
      )}


      {isSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSnapshotModal}>
          <div className="timeline-snapshot-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>恢复排轴快照</h3>
                <p>恢复会覆盖当前 4 项排轴缓存，并在写回后自动刷新界面。仅保留最近 {TIMELINE_SNAPSHOT_LIMIT} 条快照。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSnapshotModal}>
                关闭
              </button>
            </div>

            {timelineSnapshots.length === 0 ? (
              <div className="timeline-snapshot-empty">
                当前还没有可恢复的快照。先点一次“保存”即可创建时间点。
              </div>
            ) : (
              <div className="timeline-snapshot-list">
                {timelineSnapshots.map((snapshot) => (
                  <div key={snapshot.id} className="timeline-snapshot-item">
                    <div className="timeline-snapshot-item-main">
                      <strong>{snapshot.label}</strong>
                      <span>
                        {snapshot.summary.characterCount} 角色 / {snapshot.summary.buttonCount} 按钮 / {snapshot.summary.buffCount} Buff
                      </span>
                    </div>
                    <div className="timeline-snapshot-hover-card">
                      <div className="timeline-snapshot-hover-title">快照详情</div>
                      <div className="timeline-snapshot-hover-line">保存时间：{formatPreciseTimestamp(snapshot.createdAt)}</div>
                      <div className="timeline-snapshot-hover-line">快照 ID：{snapshot.id}</div>
                      <div className="timeline-snapshot-hover-line">
                        角色 {snapshot.summary.characterCount} / 按钮 {snapshot.summary.buttonCount} / Buff {snapshot.summary.buffCount}
                      </div>
                      <div className="timeline-snapshot-hover-section">Buff 内容</div>
                      <div className="timeline-snapshot-hover-buffs">
                        {buildSnapshotBuffPreview(snapshot).map((buffName) => (
                          <span key={`${snapshot.id}-${buffName}`}>{buffName}</span>
                        ))}
                      </div>
                    </div>
                    <div className="timeline-snapshot-item-actions">
                      <button type="button" className="btn-save" onClick={() => handleRequestRestoreSnapshot(snapshot)}>
                        恢复
                      </button>
                      <button
                        type="button"
                        className="btn-calculate timeline-snapshot-delete-btn"
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isSaveSnapshotModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseSaveSnapshotModal}>
          <div className="timeline-snapshot-modal timeline-snapshot-save-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>保存排轴快照</h3>
                <p>可自定义快照名称；留空时自动使用当前时间。仅保留最近 {TIMELINE_SNAPSHOT_LIMIT} 条快照。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseSaveSnapshotModal}>
                关闭
              </button>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-snapshot-name">
              快照名称
            </label>
            <input
              id="timeline-snapshot-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={snapshotDraftName}
              onChange={(event) => setSnapshotDraftName(event.target.value)}
              placeholder="留空则使用时间戳"
              maxLength={60}
            />

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCloseSaveSnapshotModal}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleSaveTimelineSnapshot}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRestoreSnapshot && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCancelRestoreSnapshot}>
          <div className="timeline-snapshot-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>确认恢复快照</h3>
                <p>将覆盖当前排轴缓存，并在恢复后自动刷新界面。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCancelRestoreSnapshot}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>{pendingRestoreSnapshot.label}</strong>
              <span>
                {pendingRestoreSnapshot.summary.characterCount} 角色 / {pendingRestoreSnapshot.summary.buttonCount} 按钮 / {pendingRestoreSnapshot.summary.buffCount} Buff
              </span>
            </div>

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCancelRestoreSnapshot}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleConfirmRestoreSnapshot}>
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCloseShareModal}>
          <div className="timeline-snapshot-modal timeline-snapshot-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>排轴分享</h3>
                <p>导出当前排轴 JSON，用于分享或外部留档。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCloseShareModal}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>当前排轴导出</strong>
              <span>{selectedCharacters.length} 角色 / {skillButtons.length} 运行时按钮 / 导出 4 项恢复数据</span>
            </div>

            <label className="timeline-snapshot-form-label" htmlFor="timeline-share-name">
              导出文件名
            </label>
            <input
              id="timeline-share-name"
              className="timeline-snapshot-name-input"
              type="text"
              value={shareDraftName}
              onChange={(event) => setShareDraftName(event.target.value)}
              placeholder="留空则使用未命名"
              maxLength={60}
            />

            <input
              ref={shareImportInputRef}
              className="timeline-share-file-input"
              type="file"
              accept="application/json,.json"
              onChange={handleShareFileSelected}
            />

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-save" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
              <button type="button" className="btn-calculate" onClick={handleCloseShareModal}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleExportTimelineJson}>
                一键导出 JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingImportShare && (
        <div className="timeline-snapshot-modal-overlay" onClick={handleCancelImportShare}>
          <div className="timeline-snapshot-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="timeline-snapshot-modal-head">
              <div>
                <h3>确认导入分享</h3>
                <p>将覆盖当前排轴缓存，并在导入后自动刷新界面。</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={handleCancelImportShare}>
                关闭
              </button>
            </div>

            <div className="timeline-snapshot-confirm-body">
              <strong>{pendingImportShare.label}</strong>
              <span>
                {pendingImportShare.payload.selectedCharacters.length} 角色 / {pendingImportShare.payload.allBuffList.length} Buff / 分享时间 {new Date(pendingImportShare.exportedAt).toLocaleString()}
              </span>
            </div>

            <div className="timeline-snapshot-form-actions">
              <button type="button" className="btn-calculate" onClick={handleCancelImportShare}>
                取消
              </button>
              <button type="button" className="btn-save" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

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
