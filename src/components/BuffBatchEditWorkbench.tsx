import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getSkillButtonTable } from '../core/repositories';
import {
  getGridLineCenterY,
  getGridNodeCenterX,
  getGridContentOffsetX,
  GRID_GROUP_HEIGHT,
  GRID_GROUP_GAP,
  GRID_NODE_COUNT,
  GRID_ROW_HEIGHT,
  GRID_STACK_PADDING_BOTTOM,
  GRID_STACK_PADDING_TOP,
  LINE_ROW_INDICES,
} from '../core/calculators/gridSnapLayout';
import { SKILL_BUTTON_BASELINE_OFFSET_Y } from '../constants/canvas-layout';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { getElementBackgroundColor, normalizeAssetUrl, resolveSkillIconUrl } from '../utils/assetResolver';
import { safeSessionStorage } from '../utils/storage';
import type { Character, SkillButtonData, SkillType, TimelineData } from '../types';
import type { PersistedSkillButton } from '../types/storage';
import './CanvasBoard/CanvasBoard.css';
import './BuffBatchEditWorkbench.css';

interface BuffBatchEditWorkbenchProps {
  selectedCharacters: Character[];
  workbenchControl: ReactNode;
  bottomRightControl: ReactNode;
  isWorkbenchTopZoneOpen: boolean;
}

interface BuffEditSkillButtonProps {
  button: PersistedSkillButton;
  element: string;
  isSelected: boolean;
  onToggle: (buttonId: string) => void;
}

const SKILL_BUTTON_SIZE = 44;
const SKILL_BUTTON_RADIUS = SKILL_BUTTON_SIZE / 2;
const SKILL_BUTTON_VISUAL_OFFSET_X = 40;
const SKILL_BUTTON_VISUAL_OFFSET_Y = 15;
const SKILL_BUTTON_BASE_WIDTH = 80;
const SKILL_BUTTON_BASE_HEIGHT = 30;
const SKILL_BUTTON_HIT_WIDTH = SKILL_BUTTON_RADIUS + SKILL_BUTTON_BASE_WIDTH;
const SKILL_BUTTON_HIT_HEIGHT = Math.max(SKILL_BUTTON_SIZE, SKILL_BUTTON_RADIUS + SKILL_BUTTON_BASE_HEIGHT);

const columnLabels = Array.from({ length: GRID_NODE_COUNT }, (_, index) => String.fromCharCode(65 + index));
const rowLabels = Array.from({ length: 8 }, (_, index) => String(index + 1));

function getButtonLineIndex(button: PersistedSkillButton): number {
  const legacyLineIndex = (button as PersistedSkillButton & { lineIndex?: number }).lineIndex;
  if (typeof legacyLineIndex === 'number') {
    return legacyLineIndex;
  }
  return Math.max(0, Math.min(LINE_ROW_INDICES.length - 1, button.staffIndex ?? 0));
}

function getButtonStaffGroupIndex(button: PersistedSkillButton): number {
  const legacyLineIndex = (button as PersistedSkillButton & { lineIndex?: number }).lineIndex;
  if (typeof legacyLineIndex === 'number') {
    return Math.max(0, button.staffIndex ?? 0);
  }
  return Math.max(0, Math.floor((button.nodeIndex ?? 0) / GRID_NODE_COUNT));
}

function getButtonSkillType(button: PersistedSkillButton): SkillType {
  return ['A', 'B', 'E', 'Q'].includes(button.skillType)
    ? button.skillType as SkillType
    : 'A';
}

function buildButtonPosition(button: PersistedSkillButton): { x: number; y: number } {
  if (
    button.position &&
    Number.isFinite(button.position.x) &&
    Number.isFinite(button.position.y)
  ) {
    return button.position;
  }

  const localNodeIndex = Math.max(0, Math.min(GRID_NODE_COUNT - 1, (button.nodeIndex ?? 0) % GRID_NODE_COUNT));
  const staffGroupIndex = getButtonStaffGroupIndex(button);
  const lineIndex = getButtonLineIndex(button);
  return {
    x: getGridNodeCenterX(localNodeIndex),
    y: GRID_STACK_PADDING_TOP + staffGroupIndex * (GRID_GROUP_HEIGHT + GRID_GROUP_GAP) + getGridLineCenterY(lineIndex),
  };
}

function readTimelineData(): TimelineData | null {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TimelineData;
  } catch {
    return null;
  }
}

function readVisualSkillButtons(
  selectedCharacters: Character[],
  gridContentOffsetX: number | null
): PersistedSkillButton[] {
  const table = getSkillButtonTable();
  const timelineData = readTimelineData();

  if (!timelineData?.staffLines?.length) {
    return Object.values(table).sort(sortButtons);
  }

  const buttons: PersistedSkillButton[] = [];
  timelineData.staffLines.forEach((staffLine) => {
    const timelineButtons = Array.isArray(staffLine.buttons) ? staffLine.buttons : [];
    timelineButtons.forEach((timelineButton: SkillButtonData) => {
      const persistedButton = table[timelineButton.id];
      const character = selectedCharacters.find((item) => item.name === timelineButton.characterName);
      const lineIndex = selectedCharacters.findIndex((item) => item.name === timelineButton.characterName);
      const groupIndex =
        typeof timelineButton.nodeIndex === 'number' && Number.isFinite(timelineButton.nodeIndex)
          ? Math.floor(timelineButton.nodeIndex / GRID_NODE_COUNT)
          : 0;
      const localNodeIndex =
        typeof timelineButton.nodeIndex === 'number' && Number.isFinite(timelineButton.nodeIndex)
          ? timelineButton.nodeIndex % GRID_NODE_COUNT
          : 0;
      const restoredLineIndex = lineIndex >= 0 ? lineIndex : 0;
      const normalizedPosition = {
        x: gridContentOffsetX !== null
          ? gridContentOffsetX + getGridNodeCenterX(localNodeIndex)
          : timelineButton.position.x,
        y: GRID_STACK_PADDING_TOP + groupIndex * (GRID_GROUP_HEIGHT + GRID_GROUP_GAP) + getGridLineCenterY(restoredLineIndex) + SKILL_BUTTON_BASELINE_OFFSET_Y,
      };

      buttons.push({
        ...persistedButton,
        ...({ lineIndex: restoredLineIndex } as { lineIndex: number }),
        id: timelineButton.id,
        characterId: character?.id ?? timelineButton.characterId ?? timelineButton.characterName,
        characterName: timelineButton.characterName,
        skillType: timelineButton.skillType,
        staffIndex: groupIndex,
        nodeIndex: localNodeIndex,
        nodeNumber: timelineButton.nodeNumber,
        position: normalizedPosition,
        runtimeSkillId: timelineButton.runtimeSkillId,
        skillDisplayName: timelineButton.skillDisplayName,
        skillIconUrl: timelineButton.skillIconUrl,
        customHits: timelineButton.customHits,
        selectedBuff: persistedButton?.selectedBuff ?? timelineButton.buffIds ?? [],
        panelConfig: persistedButton?.panelConfig,
        runtimeSnapshot: persistedButton?.runtimeSnapshot ?? null,
      });
    });
  });

  return buttons.sort(sortButtons);
}

function sortButtons(a: PersistedSkillButton, b: PersistedSkillButton): number {
  const staffDiff = getButtonStaffGroupIndex(a) - getButtonStaffGroupIndex(b);
  if (staffDiff !== 0) return staffDiff;
  const lineDiff = getButtonLineIndex(a) - getButtonLineIndex(b);
  if (lineDiff !== 0) return lineDiff;
  return (a.nodeIndex ?? 0) - (b.nodeIndex ?? 0);
}

function readPersistedSkillButtons(): PersistedSkillButton[] {
  return Object.values(getSkillButtonTable()).sort(sortButtons);
}

function getStaffGroupCount(skillButtons: PersistedSkillButton[]): number {
  return Math.max(
    1,
    ...skillButtons.map((button) => getButtonStaffGroupIndex(button) + 1)
  );
}

function getInitialSkillButtons(selectedCharacters: Character[]): PersistedSkillButton[] {
  return readVisualSkillButtons(selectedCharacters, null);
}

function getFallbackSkillButtons(): PersistedSkillButton[] {
  return readPersistedSkillButtons().sort((a, b) => {
    const staffDiff = getButtonStaffGroupIndex(a) - getButtonStaffGroupIndex(b);
    if (staffDiff !== 0) return staffDiff;
    const lineDiff = getButtonLineIndex(a) - getButtonLineIndex(b);
    if (lineDiff !== 0) return lineDiff;
    return (a.nodeIndex ?? 0) - (b.nodeIndex ?? 0);
  });
}

function BuffEditSkillButton({
  button,
  element,
  isSelected,
  onToggle,
}: BuffEditSkillButtonProps) {
  const [iconLoadFailed, setIconLoadFailed] = useState(false);
  const position = buildButtonPosition(button);
  const skillType = getButtonSkillType(button);
  const displayName = button.skillDisplayName || skillType;
  const skillIconUrl = button.skillIconUrl || resolveSkillIconUrl(button.characterName, skillType);

  const handleIconLoad = () => {
    setIconLoadFailed(false);
  };

  const handleIconError = () => {
    setIconLoadFailed(true);
  };

  return (
    <div
      className={`canvas-skill-button buff-edit-skill-button${isSelected ? ' selected' : ''}`}
      style={{
        left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
        top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
        width: SKILL_BUTTON_HIT_WIDTH,
        height: SKILL_BUTTON_HIT_HEIGHT,
        '--skill-button-size': `${SKILL_BUTTON_SIZE}px`,
        '--skill-button-radius': `${SKILL_BUTTON_RADIUS}px`,
        '--skill-button-element-color': getElementBackgroundColor(element),
      } as CSSProperties}
      onClick={() => onToggle(button.id)}
      title={`${button.characterName} / ${displayName} / Buff ${button.selectedBuff?.length ?? 0}`}
    >
      <div className="skill-button-anchor">
        <div className="skill-button-base">
          <span className="skill-button-name">{skillType} {displayName}</span>
        </div>
        <div className="skill-button-orb" title={`${button.characterName} - ${displayName}`}>
          {skillIconUrl && !iconLoadFailed ? (
            <img
              className="skill-icon"
              key={normalizeAssetUrl(skillIconUrl)}
              src={normalizeAssetUrl(skillIconUrl)}
              alt={displayName}
              onLoad={handleIconLoad}
              onError={handleIconError}
            />
          ) : null}
          <span className={`skill-label ${!iconLoadFailed && skillIconUrl ? 'hidden' : ''}`}>{skillType}</span>
        </div>
      </div>
    </div>
  );
}

export function BuffBatchEditWorkbench({
  selectedCharacters,
  workbenchControl,
  bottomRightControl,
  isWorkbenchTopZoneOpen,
}: BuffBatchEditWorkbenchProps) {
  const [selectedButtonIds, setSelectedButtonIds] = useState<string[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [gridContentOffsetX, setGridContentOffsetX] = useState<number | null>(null);
  const [visualButtons, setVisualButtons] = useState<PersistedSkillButton[]>(() => getInitialSkillButtons(selectedCharacters));
  const characterById = useMemo(() => {
    return new Map(selectedCharacters.flatMap((character) => [
      [character.id, character],
      [character.name, character],
    ]));
  }, [selectedCharacters]);
  const skillButtons = useMemo(() => {
    return visualButtons.length > 0 ? visualButtons : getFallbackSkillButtons();
  }, [visualButtons]);
  const staffGroupCount = getStaffGroupCount(skillButtons);
  const canvasHeight = GRID_STACK_PADDING_TOP + staffGroupCount * GRID_GROUP_HEIGHT + Math.max(0, staffGroupCount - 1) * GRID_GROUP_GAP + GRID_STACK_PADDING_BOTTOM;

  useEffect(() => {
    const measure = () => {
      const canvasElement = canvasRef.current;
      const gridStackElement = canvasElement?.querySelector('.canvas-grid-stack');
      if (!canvasElement || !gridStackElement) {
        return;
      }
      setGridContentOffsetX(getGridContentOffsetX(canvasElement, gridStackElement));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
  }, [gridContentOffsetX, selectedCharacters]);

  const toggleButton = (buttonId: string) => {
    setSelectedButtonIds((current) => (
      current.includes(buttonId)
        ? current.filter((id) => id !== buttonId)
        : [...current, buttonId]
    ));
  };

  const renderStaffVisualGroup = (staffIndex: number) => (
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
                  src={character.avatarUrl}
                  alt={`${character.name} avatar`}
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

  const renderGridGroup = (staffIndex: number) => (
    <div key={`grid-row-${staffIndex}`} className="canvas-grid-row">
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
      {renderStaffVisualGroup(staffIndex)}
    </div>
  );

  const renderSkillButton = (button: PersistedSkillButton) => {
    const character = characterById.get(button.characterId || button.characterName) ?? characterById.get(button.characterName);
    const isSelected = selectedButtonIds.includes(button.id);
    const element = character?.element ?? '';

    return (
      <BuffEditSkillButton
        key={button.id}
        button={button}
        element={element}
        isSelected={isSelected}
        onToggle={toggleButton}
      />
    );
  };

  return (
    <div className={`canvas-board buff-batch-edit-workbench ${isWorkbenchTopZoneOpen ? 'has-top-zone' : ''}`}>
      <div className="canvas-layout buff-edit-layout">
        <section className="canvas-left-zone buff-edit-left-zone">
          <div className="canvas-area buff-edit-canvas-area">
            <div ref={canvasRef} className="canvas-container buff-edit-canvas" style={{ height: canvasHeight }}>
              <div className="canvas-grid-shell">
                <div className="canvas-grid-stack">
                  {Array.from({ length: staffGroupCount }, (_, staffIndex) => renderGridGroup(staffIndex))}
                </div>
              </div>
              <div className="buff-edit-mask" />
              <div className="buff-edit-button-layer" aria-label="Buff 批量编辑按钮选择层">
                {skillButtons.map(renderSkillButton)}
              </div>
              {skillButtons.length === 0 ? (
                <div className="buff-edit-empty">当前没有可选择的技能按钮</div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="canvas-right-zone buff-edit-right-zone">
          <div className="buff-edit-right-placeholder" />
        </aside>

        <div className="canvas-bottom-zone buff-edit-bottom-bar">
          <div className="canvas-bottom-zone-left">
            {workbenchControl}
          </div>
          <div className="canvas-bottom-zone-center">
            <div className="buff-edit-selection-counter">已选 {selectedButtonIds.length}/{skillButtons.length}</div>
          </div>
          <div className="canvas-bottom-zone-right">
            {bottomRightControl}
          </div>
        </div>
      </div>
    </div>
  );
}
