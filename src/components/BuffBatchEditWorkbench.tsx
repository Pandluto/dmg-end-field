import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getAllBuffList, getSkillButtonTable } from '../core/repositories';
import { getCharacterInputMap } from '../core/repositories/operatorConfigRepository';
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
import type { PersistedSkillButton, SkillButtonBuff } from '../types/storage';
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

interface BoxSelectRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

type EditToolMode = 'normal' | 'filter' | 'edit';
type SourceFilter =
  | { kind: 'character'; id: string; name: string }
  | { kind: 'weapon'; id: string; name: string }
  | { kind: 'equipment'; id: 'equipment'; name: string };

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

function normalizeRect(rect: BoxSelectRect) {
  const left = Math.min(rect.startX, rect.currentX);
  const top = Math.min(rect.startY, rect.currentY);
  const right = Math.max(rect.startX, rect.currentX);
  const bottom = Math.max(rect.startY, rect.currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function intersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function getBuffLabel(buff: SkillButtonBuff): string {
  return buff.displayName?.trim() || buff.name?.trim() || buff.id;
}

function getBuffSourceLabel(buff: SkillButtonBuff): string {
  return buff.sourceName?.trim() || buff.source?.trim() || '未知来源';
}

function getBuffValueLine(buff: SkillButtonBuff): string {
  const type = buff.type?.trim() || buff.name?.trim() || buff.id;
  return typeof buff.value === 'number' ? `${type} · ${buff.value}` : type;
}

function compareBuffBySource(a: SkillButtonBuff, b: SkillButtonBuff): number {
  const aSourceType = (a.source || a.sourceName || '').trim();
  const bSourceType = (b.source || b.sourceName || '').trim();
  const sourceTypeDiff = aSourceType.localeCompare(bSourceType, 'zh-Hans-CN', { numeric: true });
  if (sourceTypeDiff !== 0) return sourceTypeDiff;

  const aSourceId = (a.sourceName || a.source || '').trim();
  const bSourceId = (b.sourceName || b.source || '').trim();
  const sourceIdDiff = aSourceId.localeCompare(bSourceId, 'zh-Hans-CN', { numeric: true });
  if (sourceIdDiff !== 0) return sourceIdDiff;

  return getBuffLabel(a).localeCompare(getBuffLabel(b), 'zh-Hans-CN', { numeric: true });
}

function resolveWeaponImageUrl(weaponName: string): string {
  return `http://127.0.0.1:31457/user-images/img-weapon/${encodeURIComponent(weaponName)}.png`;
}

function getCharacterWeaponName(character: Character, inputMap: ReturnType<typeof getCharacterInputMap>): string {
  const input = inputMap[character.id] ?? inputMap[character.name];
  return input?.weapon?.name?.trim() || '';
}

function buffMatchesSourceFilter(buff: SkillButtonBuff, filter: SourceFilter | null): boolean {
  if (!filter) return true;

  const sourceText = [
    buff.id,
    buff.name,
    buff.displayName,
    buff.source,
    buff.sourceName,
    buff.description,
    buff.condition,
  ].filter(Boolean).join(' ');

  if (filter.kind === 'equipment') {
    return /equipment|gear|装备|三件套/i.test(sourceText);
  }

  return sourceText.includes(filter.id) || sourceText.includes(filter.name);
}

function dedupeBuffIds(buffIds: string[]): string[] {
  return Array.from(new Set(buffIds.filter(Boolean)));
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
  const [toolMode, setToolMode] = useState<EditToolMode>('normal');
  const [selectedFilterBuffIds, setSelectedFilterBuffIds] = useState<string[]>([]);
  const [pressedCharacterIds, setPressedCharacterIds] = useState<string[]>([]);
  const [activeSourceFilter, setActiveSourceFilter] = useState<SourceFilter | null>(null);
  const [isBoxSelectArmed, setIsBoxSelectArmed] = useState(false);
  const [boxSelectRect, setBoxSelectRect] = useState<BoxSelectRect | null>(null);
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
  const allBuffs = useMemo(() => getAllBuffList(), []);
  const sortedBuffs = useMemo(() => [...allBuffs].sort(compareBuffBySource), [allBuffs]);
  const visibleFilterBuffs = useMemo(
    () => sortedBuffs.filter((buff) => buffMatchesSourceFilter(buff, activeSourceFilter)),
    [activeSourceFilter, sortedBuffs]
  );
  const buffById = useMemo(() => new Map(allBuffs.map((buff) => [buff.id, buff])), [allBuffs]);
  const characterInputMap = useMemo(() => getCharacterInputMap(), []);
  const weaponButtonItems = useMemo(() => selectedCharacters
    .map((character) => ({
      character,
      weaponName: getCharacterWeaponName(character, characterInputMap),
    }))
    .filter((item) => item.weaponName.length > 0)
    .slice(0, 4), [characterInputMap, selectedCharacters]);
  const selectedButtons = useMemo(() => {
    const selectedSet = new Set(selectedButtonIds);
    return skillButtons.filter((button) => selectedSet.has(button.id));
  }, [selectedButtonIds, skillButtons]);
  const selectedButtonBuffIdLists = useMemo(
    () => selectedButtons.map((button) => dedupeBuffIds(button.selectedBuff ?? [])),
    [selectedButtons]
  );
  const commonBuffIds = useMemo(() => {
    if (selectedButtonBuffIdLists.length === 0) {
      return [];
    }
    const [firstList, ...restLists] = selectedButtonBuffIdLists;
    return firstList.filter((buffId) => restLists.every((list) => list.includes(buffId)));
  }, [selectedButtonBuffIdLists]);
  const involvedBuffIds = useMemo(
    () => dedupeBuffIds(selectedButtonBuffIdLists.flat()),
    [selectedButtonBuffIdLists]
  );
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
    if (toolMode !== 'normal') {
      return;
    }
    setSelectedButtonIds((current) => (
      current.includes(buttonId)
        ? current.filter((id) => id !== buttonId)
        : [...current, buttonId]
    ));
  };

  const applyFilterSelection = (buffIds: string[]) => {
    if (buffIds.length === 0) {
      setSelectedButtonIds([]);
      return;
    }
    const nextButtonIds = skillButtons
      .filter((button) => {
        const buttonBuffIds = button.selectedBuff ?? [];
        return buffIds.every((buffId) => buttonBuffIds.includes(buffId));
      })
      .map((button) => button.id);
    setSelectedButtonIds(nextButtonIds);
  };

  const toggleFilterBuff = (buffId: string) => {
    setSelectedFilterBuffIds((current) => {
      const next = current.includes(buffId)
        ? current.filter((id) => id !== buffId)
        : [...current, buffId];
      applyFilterSelection(next);
      return next;
    });
  };

  const toggleCharacterQuickSelect = (character: Character) => {
    const characterButtonIds = skillButtons
      .filter((button) => button.characterId === character.id || button.characterName === character.name)
      .map((button) => button.id);

    setPressedCharacterIds((current) => {
      const isPressed = current.includes(character.id);
      const nextPressed = isPressed
        ? current.filter((id) => id !== character.id)
        : [...current, character.id];

      setSelectedButtonIds((selectedIds) => {
        if (isPressed) {
          return selectedIds.filter((buttonId) => !characterButtonIds.includes(buttonId));
        }
        return Array.from(new Set([...selectedIds, ...characterButtonIds]));
      });

      return nextPressed;
    });
  };

  const toggleSourceFilter = (nextFilter: SourceFilter) => {
    setActiveSourceFilter((current) => (
      current?.kind === nextFilter.kind && current.id === nextFilter.id ? null : nextFilter
    ));
  };

  const handleToggleFilterMode = () => {
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setToolMode((current) => {
      const nextMode = current === 'filter' ? 'normal' : 'filter';
      if (nextMode === 'filter') {
        applyFilterSelection(selectedFilterBuffIds);
      }
      return nextMode;
    });
  };

  const handleToggleEditMode = () => {
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setToolMode((current) => current === 'edit' ? 'normal' : 'edit');
  };

  const getCanvasPoint = (event: React.MouseEvent | MouseEvent) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return null;
    }
    const rect = canvasElement.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + canvasElement.scrollLeft,
      y: event.clientY - rect.top + canvasElement.scrollTop,
    };
  };

  const selectButtonsInRect = (rect: BoxSelectRect) => {
    const normalizedRect = normalizeRect(rect);
    const nextSelectedIds = skillButtons
      .filter((button) => {
        const position = buildButtonPosition(button);
        const buttonRect = {
          left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
          top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
          right: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X + SKILL_BUTTON_HIT_WIDTH,
          bottom: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y + SKILL_BUTTON_HIT_HEIGHT,
        };
        return intersects(normalizedRect, buttonRect);
      })
      .map((button) => button.id);
    setSelectedButtonIds(nextSelectedIds);
  };

  const handleBoxSelectMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (toolMode !== 'normal' || !isBoxSelectArmed || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    setBoxSelectRect({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  };

  useEffect(() => {
    if (!boxSelectRect) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const point = getCanvasPoint(event);
      if (!point) {
        return;
      }
      setBoxSelectRect((current) => current ? {
        ...current,
        currentX: point.x,
        currentY: point.y,
      } : current);
    };

    const handleMouseUp = () => {
      selectButtonsInRect(boxSelectRect);
      setBoxSelectRect(null);
      setIsBoxSelectArmed(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [boxSelectRect, skillButtons]);

  const normalizedBoxSelectRect = boxSelectRect ? normalizeRect(boxSelectRect) : null;

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

  const renderBuffTag = (
    buffId: string,
    options: { selected?: boolean; white?: boolean; onClick?: () => void } = {}
  ) => {
    const buff = buffById.get(buffId);
    const label = buff ? getBuffLabel(buff) : buffId;
    return (
      <button
        key={buffId}
        type="button"
        className={`buff-edit-buff-card${options.selected ? ' is-selected' : ''}${options.white ? ' is-white' : ''}`}
        onClick={options.onClick}
        disabled={!options.onClick}
        title={buff ? `${label} / ${getBuffSourceLabel(buff)} / ${getBuffValueLine(buff)}` : buffId}
      >
        <span className="buff-edit-buff-card-title">{label}</span>
        <span>{buff ? getBuffSourceLabel(buff) : '未知来源'}</span>
        <span>{buff ? getBuffValueLine(buff) : buffId}</span>
      </button>
    );
  };

  const isSourceFilterActive = (filter: SourceFilter): boolean => (
    activeSourceFilter?.kind === filter.kind && activeSourceFilter.id === filter.id
  );

  const renderRightSideButtons = () => {
    if (toolMode === 'filter') {
      const characterButtons = selectedCharacters.slice(0, 4).map((character, index) => {
        const filter: SourceFilter = { kind: 'character', id: character.id, name: character.name };
        return (
          <button
            key={`source-character-${character.id}`}
            className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${isSourceFilterActive(filter) ? ' is-active' : ''}`}
            type="button"
            title={character.name}
            aria-label={`筛选干员来源 ${character.name}`}
            style={{ top: 48 + index * 40 }}
            onClick={() => toggleSourceFilter(filter)}
          >
            {character.avatarUrl ? <img src={character.avatarUrl} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
          </button>
        );
      });

      const weaponButtons = weaponButtonItems.map(({ character, weaponName }, index) => {
        const filter: SourceFilter = { kind: 'weapon', id: weaponName, name: weaponName };
        return (
          <button
            key={`source-weapon-${character.id}-${weaponName}`}
            className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${isSourceFilterActive(filter) ? ' is-active' : ''}`}
            type="button"
            title={weaponName}
            aria-label={`筛选武器来源 ${weaponName}`}
            style={{ top: 208 + index * 40 }}
            onClick={() => toggleSourceFilter(filter)}
          >
            <img
              src={resolveWeaponImageUrl(weaponName)}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <span>{weaponName.slice(0, 1)}</span>
          </button>
        );
      });

      const equipmentFilter: SourceFilter = { kind: 'equipment', id: 'equipment', name: '装备' };
      return (
        <>
          {characterButtons}
          {weaponButtons}
          <button
            className={`buff-edit-secondary-button${isSourceFilterActive(equipmentFilter) ? ' is-active' : ''}`}
            type="button"
            title="装备"
            aria-label="筛选装备来源"
            style={{ top: 208 + Math.max(weaponButtonItems.length, 4) * 40 }}
            onClick={() => toggleSourceFilter(equipmentFilter)}
          >
            装
          </button>
        </>
      );
    }

    return selectedCharacters.slice(0, 4).map((character, index) => (
      <button
        key={`quick-character-${character.id}`}
        className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${pressedCharacterIds.includes(character.id) ? ' is-active' : ''}`}
        type="button"
        title={character.name}
        aria-label={`选择干员按钮 ${character.name}`}
        style={{ top: 48 + index * 40 }}
        onClick={() => toggleCharacterQuickSelect(character)}
      >
        {character.avatarUrl ? <img src={character.avatarUrl} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
      </button>
    ));
  };

  const renderRightPanel = () => {
    if (toolMode === 'filter') {
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>筛选 Buff</h3>
            <span>{selectedFilterBuffIds.length} 已选</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: selectedFilterBuffIds.includes(buff.id),
                onClick: () => toggleFilterBuff(buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
        </div>
      );
    }

    if (toolMode === 'edit') {
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>编辑目录</h3>
            <span>{selectedButtons.length} 技能按钮</span>
          </div>
          <section className="buff-edit-right-section">
            <h4>共同 Buff</h4>
            <div className="buff-edit-tag-list">
              {commonBuffIds.length > 0
                ? commonBuffIds.map((buffId) => renderBuffTag(buffId))
                : <div className="buff-edit-right-empty">暂无共同 Buff</div>}
            </div>
          </section>
          <section className="buff-edit-right-section">
            <h4>全部 Buff</h4>
            <div className="buff-edit-tag-list">
              {involvedBuffIds.length > 0
                ? involvedBuffIds.map((buffId) => renderBuffTag(buffId, { white: true }))
                : <div className="buff-edit-right-empty">暂无 Buff</div>}
            </div>
          </section>
        </div>
      );
    }

    return <div className="buff-edit-right-placeholder" />;
  };

  return (
    <div className={`canvas-board buff-batch-edit-workbench ${isWorkbenchTopZoneOpen ? 'has-top-zone' : ''}`}>
      <div className="canvas-layout buff-edit-layout">
        <section className="canvas-left-zone buff-edit-left-zone">
          <div className="canvas-area buff-edit-canvas-area">
            <div ref={canvasRef} className="canvas-container buff-edit-canvas" style={{ height: canvasHeight }}>
              <div className="buff-edit-tool-layer">
                <button
                  className={`buff-edit-box-select-button${isBoxSelectArmed ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setIsBoxSelectArmed((value) => !value)}
                  disabled={toolMode !== 'normal'}
                  title="框选技能按钮"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4h5v2H7v3H5V4Zm9 0h5v5h-2V6h-3V4ZM5 15h2v3h3v2H5v-5Zm12 0h2v5h-5v-2h3v-3ZM9 9h6v6H9V9Z" />
                  </svg>
                </button>
                <button
                  className="buff-edit-clear-selection-button"
                  type="button"
                  onClick={() => {
                    setSelectedButtonIds([]);
                    setIsBoxSelectArmed(false);
                    setBoxSelectRect(null);
                  }}
                  disabled={toolMode !== 'normal'}
                  title="取消全部选中"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-filter-button${toolMode === 'filter' ? ' is-active' : ''}`}
                  type="button"
                  onClick={handleToggleFilterMode}
                  disabled={toolMode === 'edit'}
                  title="筛选 Buff"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5h16l-6.2 7.1V18l-3.6 1.8v-7.7L4 5Zm4.4 2 3.8 4.4v5.2l.6-.3v-4.9L16.6 7H8.4Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-mode-button${toolMode === 'edit' ? ' is-active' : ''}`}
                  type="button"
                  onClick={handleToggleEditMode}
                  disabled={toolMode === 'filter'}
                  title="编辑目录"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4h9v2H7v12h10v-7h2v9H5V4Zm11.8.6 2.6 2.6-7.8 7.8H9v-2.6l7.8-7.8Zm1.2 2.6-1.2-1.2L11 11.8V13h1.2L18 7.2Z" />
                  </svg>
                </button>
              </div>
              <div className="buff-edit-secondary-button-layer" aria-label="左区右侧按钮区">
                {renderRightSideButtons()}
              </div>
              <div className="canvas-grid-shell">
                <div className="canvas-grid-stack">
                  {Array.from({ length: staffGroupCount }, (_, staffIndex) => renderGridGroup(staffIndex))}
                </div>
              </div>
              <div className="buff-edit-mask" />
              <div className="buff-edit-button-layer" aria-label="Buff 批量编辑按钮选择层">
                {skillButtons.map(renderSkillButton)}
              </div>
              {isBoxSelectArmed ? (
                <div
                  className={`buff-edit-box-select-layer${boxSelectRect ? ' is-dragging' : ''}`}
                  onMouseDown={handleBoxSelectMouseDown}
                >
                  {normalizedBoxSelectRect ? (
                    <div
                      className="buff-edit-box-select-rect"
                      style={{
                        left: normalizedBoxSelectRect.left,
                        top: normalizedBoxSelectRect.top,
                        width: normalizedBoxSelectRect.width,
                        height: normalizedBoxSelectRect.height,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {skillButtons.length === 0 ? (
                <div className="buff-edit-empty">当前没有可选择的技能按钮</div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="canvas-right-zone buff-edit-right-zone">
          {renderRightPanel()}
        </aside>

        <div className="canvas-bottom-zone buff-edit-bottom-bar">
          <div className="canvas-bottom-zone-left">
            {workbenchControl}
            <div className="buff-edit-selection-counter">已选 {selectedButtonIds.length}/{skillButtons.length}</div>
          </div>
          <div className="canvas-bottom-zone-center" />
          <div className="canvas-bottom-zone-right">
            {bottomRightControl}
          </div>
        </div>
      </div>
    </div>
  );
}
