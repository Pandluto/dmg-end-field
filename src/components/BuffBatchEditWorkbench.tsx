import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getAllBuffList, getSkillButtonTable } from '../core/repositories';
import { getCharacterInputMap } from '../core/repositories/operatorConfigRepository';
import { addBuffToButton, decrementBuffStackOnButton, getBuffsByButtonId, loadBuffsToCache, removeBuffFromButton } from '../core/services/buffService';
import {
  dedupeLocalBuffSearchResults,
  type BuffSourceSearchMode,
  BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  filterBuffSearchEntriesBySourceMode,
  getBuffSourceSearchModeLabel,
  readCandidateBuffSearchEntries,
  readLocalBuffSearchEntries,
  type LocalBuffSearchResult,
} from './CanvasBoard/skillButton.shared';
import { useSkillButtonAnomaly } from './CanvasBoard/useSkillButtonAnomaly';
import { SkillButtonAnomalyStatePanel } from './CanvasBoard/SkillButtonAnomalyPanels';
import { buildBuffSearchIndex, searchBuffs } from '../utils/buffFuzzySearch';
import { buildAnomalyStateSnapshotBuffs } from '../core/services/anomalyStateBuffs';
import { refreshSnapshotCandidateBuffsForCharacterIds } from '../core/services/operatorConfigCandidateBuffService';
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
import type { AnomalyStateSnapshot, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import { WorkbenchSplitSurface } from './WorkbenchSplitSurface';
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
  isAddOwned: boolean;
  isAddTarget: boolean;
  isRemoveOwned: boolean;
  isRemoveTarget: boolean;
  isEditAddTarget: boolean;
  isEditRemoveTarget: boolean;
  pendingAddCount: number;
  pendingRemoveCount: number;
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
const BUFF_EDIT_RIGHT_ZONE_WIDTH = 300;
const BUFF_EDIT_SECONDARY_BUTTON_WIDTH = 32;
const BUFF_EDIT_SECONDARY_BUTTON_GAP = 3;
const BUFF_EDIT_SECONDARY_BUTTON_LEFT_FALLBACK = 1365;

const columnLabels = Array.from({ length: GRID_NODE_COUNT }, (_, index) => String.fromCharCode(65 + index));
const rowLabels = Array.from({ length: 8 }, (_, index) => String(index + 1));

interface BoxSelectRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

type EditToolMode = 'normal' | 'filter' | 'edit' | 'add' | 'remove';
type SourceFilter =
  | { kind: 'character'; id: string; name: string }
  | { kind: 'weapon'; id: string; name: string }
  | { kind: 'equipment'; id: 'equipment'; name: string };
type CandidateAdderMode = BuffSourceSearchMode | 'anomaly-state';

const CANDIDATE_ADDER_MODE_OPTIONS: Array<{ key: CandidateAdderMode; label: string }> = [
  ...BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  { key: 'anomaly-state', label: '异常状态区' },
];

const CANDIDATE_SOURCE_MODES = new Set<CandidateAdderMode>(BUFF_SOURCE_SEARCH_MODE_OPTIONS.map((option) => option.key));

function isCandidateSourceMode(mode: CandidateAdderMode): mode is BuffSourceSearchMode {
  return CANDIDATE_SOURCE_MODES.has(mode);
}

function getCandidateAdderModeLabel(mode: CandidateAdderMode): string {
  return isCandidateSourceMode(mode) ? getBuffSourceSearchModeLabel(mode) : '异常状态区';
}

function getNextCandidateAdderMode(mode: CandidateAdderMode): CandidateAdderMode {
  const index = CANDIDATE_ADDER_MODE_OPTIONS.findIndex((option) => option.key === mode);
  return CANDIDATE_ADDER_MODE_OPTIONS[(index + 1) % CANDIDATE_ADDER_MODE_OPTIONS.length].key;
}

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
  if (buff.effectKind === 'extraHit') {
    return `额外伤害 · ${((buff.extraHitConfig?.baseMultiplier ?? 0) * 100).toFixed(1)}% · ${buff.extraHitConfig?.damageType || 'physical'} · ${buff.extraHitConfig?.skillType || '空'} · ${buff.extraHitConfig?.cooldownSeconds ?? 0}s CD`;
  }
  const type = buff.type?.trim() || buff.name?.trim() || buff.id;
  return typeof buff.value === 'number' ? `${type} · ${buff.value}` : type;
}

function getMissingBuffShortId(buffId: string): string {
  return buffId.length > 18 ? `${buffId.slice(0, 18)}...` : buffId;
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
  return `http://127.0.0.1:31457/user-images/${encodeURIComponent(`${weaponName}.png`)}`;
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

function buffFromSearchResult(entry: LocalBuffSearchResult): SkillButtonBuff {
  return {
    id: `candidate-add-${entry.key}`,
    name: entry.name,
    displayName: entry.displayName,
    sourceName: entry.sourceName,
    level: entry.level || '',
    type: entry.type,
    value: entry.value,
    description: entry.description,
    source: entry.source,
    condition: entry.condition,
    category: entry.category,
    maxStacks: entry.maxStacks,
    effectKind: entry.effectKind,
    extraHitConfig: entry.extraHitConfig,
    refCount: 1,
  };
}

function addDraftBuffToButton(buttonId: string, buff: SkillButtonBuff) {
  const { id: _id, ...buffWithoutId } = buff;
  return addBuffToButton(buttonId, buffWithoutId);
}

function candidateBuffFromAnomalyStateSnapshot(snapshot: AnomalyStateSnapshot): SkillButtonBuff | null {
  const [snapshotBuff] = buildAnomalyStateSnapshotBuffs([snapshot]);
  if (!snapshotBuff) {
    return null;
  }

  return {
    ...snapshotBuff,
    id: `candidate-add-${snapshotBuff.id}`,
    sourceName: snapshot.sourceCharacterName,
    condition: snapshot.secondaryText || snapshotBuff.condition,
  };
}

function dedupeBuffIds(buffIds: string[]): string[] {
  return Array.from(new Set(buffIds.filter(Boolean)));
}

function BuffEditSkillButton({
  button,
  element,
  isSelected,
  isAddOwned,
  isAddTarget,
  isRemoveOwned,
  isRemoveTarget,
  isEditAddTarget,
  isEditRemoveTarget,
  pendingAddCount,
  pendingRemoveCount,
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
      className={`canvas-skill-button buff-edit-skill-button${isSelected ? ' selected' : ''}${isAddOwned || isRemoveOwned ? ' is-add-owned' : ''}${isAddTarget ? ' is-add-target' : ''}${isRemoveTarget ? ' is-remove-target' : ''}${isEditAddTarget ? ' is-edit-add-target' : ''}${isEditRemoveTarget ? ' is-edit-remove-target' : ''}${isEditAddTarget && isEditRemoveTarget ? ' is-edit-mixed-target' : ''}`}
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
      {pendingAddCount > 0 ? (
        <div className="buff-edit-pending-add-count">+{pendingAddCount}</div>
      ) : null}
      {pendingRemoveCount > 0 ? (
        <div className="buff-edit-pending-remove-count">-{pendingRemoveCount}</div>
      ) : null}
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
  const [activeAddBuffId, setActiveAddBuffId] = useState<string | null>(null);
  const [pendingAddByBuff, setPendingAddByBuff] = useState<Record<string, string[]>>({});
  const [candidateAddBuffs, setCandidateAddBuffs] = useState<SkillButtonBuff[]>([]);
  const [batchAnomalyStateSnapshots, setBatchAnomalyStateSnapshots] = useState<AnomalyStateSnapshot[]>([]);
  const nextBatchAnomalyStateSnapshotIdRef = useRef(1);
  const [isCandidateAdderOpen, setIsCandidateAdderOpen] = useState(false);
  const [candidateSearchKeyword, setCandidateSearchKeyword] = useState('');
  const [candidateBuffRefreshToken, setCandidateBuffRefreshToken] = useState(0);
  const [candidateAdderMode, setCandidateAdderMode] = useState<CandidateAdderMode>('buff-group');
  const [activeRemoveBuffId, setActiveRemoveBuffId] = useState<string | null>(null);
  const [pendingRemoveByBuff, setPendingRemoveByBuff] = useState<Record<string, string[]>>({});
  const [editAddByBuff, setEditAddByBuff] = useState<Record<string, string[]>>({});
  const [editRemoveByBuff, setEditRemoveByBuff] = useState<Record<string, string[]>>({});
  const [buffListVersion, setBuffListVersion] = useState(0);
  const [isBoxSelectArmed, setIsBoxSelectArmed] = useState(false);
  const [boxSelectRect, setBoxSelectRect] = useState<BoxSelectRect | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [gridContentOffsetX, setGridContentOffsetX] = useState<number | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const [visualButtons, setVisualButtons] = useState<PersistedSkillButton[]>(() => getInitialSkillButtons(selectedCharacters));
  const candidateSearchInputRef = useRef<HTMLInputElement | null>(null);
  const characterById = useMemo(() => {
    return new Map(selectedCharacters.flatMap((character) => [
      [character.id, character],
      [character.name, character],
    ]));
  }, [selectedCharacters]);
  const skillButtons = useMemo(() => {
    return visualButtons.length > 0 ? visualButtons : getFallbackSkillButtons();
  }, [visualButtons]);
  const allBuffs = useMemo(() => getAllBuffList(), [buffListVersion]);
  const addModeBuffs = useMemo(() => [...allBuffs, ...candidateAddBuffs], [allBuffs, candidateAddBuffs]);
  const sortedBuffs = useMemo(() => [...allBuffs].sort(compareBuffBySource), [allBuffs]);
  const visibleFilterBuffs = useMemo(
    () => sortedBuffs.filter((buff) => buffMatchesSourceFilter(buff, activeSourceFilter)),
    [activeSourceFilter, sortedBuffs]
  );
  const allCandidateSearchEntries = useMemo(() => [
    ...readLocalBuffSearchEntries(),
    ...readCandidateBuffSearchEntries(),
  ], [candidateBuffRefreshToken, isCandidateAdderOpen, candidateAddBuffs]);
  const candidateSearchEntries = useMemo(() => {
    if (!isCandidateSourceMode(candidateAdderMode)) {
      return [];
    }
    return filterBuffSearchEntriesBySourceMode(allCandidateSearchEntries, candidateAdderMode);
  }, [allCandidateSearchEntries, candidateAdderMode]);
  const candidateSearchIndex = useMemo(() => buildBuffSearchIndex(
    candidateSearchEntries,
    (entry) => [
      entry.displayName,
      entry.name,
      entry.groupName,
      entry.itemName,
      entry.type,
      entry.description,
      entry.condition,
      entry.sourceName,
    ]
  ), [candidateSearchEntries]);
  const candidateSearchResults = useMemo(() => {
    if (!candidateSearchKeyword.trim()) return [];
    return dedupeLocalBuffSearchResults(searchBuffs(candidateSearchKeyword, candidateSearchIndex)).slice(0, 50);
  }, [candidateSearchIndex, candidateSearchKeyword]);
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
  const selectedButtonBuffs = useMemo(() => (
    selectedButtons.flatMap((button) => getBuffsByButtonId(button.id))
  ), [selectedButtons, buffListVersion]);
  const buffById = useMemo(() => new Map(
    [...addModeBuffs, ...selectedButtonBuffs].map((buff) => [buff.id, buff])
  ), [addModeBuffs, selectedButtonBuffs]);
  const anomalyContextButton = selectedButtons[0] ?? skillButtons[0] ?? null;
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
  const usedNonCommonBuffIds = useMemo(
    () => involvedBuffIds.filter((buffId) => !commonBuffIds.includes(buffId)),
    [commonBuffIds, involvedBuffIds]
  );
  const unusedBuffIds = useMemo(
    () => sortedBuffs.map((buff) => buff.id).filter((buffId) => !involvedBuffIds.includes(buffId)),
    [involvedBuffIds, sortedBuffs]
  );
  const pendingAddCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(pendingAddByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => {
        counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1);
      });
    });
    return counts;
  }, [pendingAddByBuff]);
  const pendingRemoveCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(pendingRemoveByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => {
        counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1);
      });
    });
    return counts;
  }, [pendingRemoveByBuff]);
  const editAddCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(editAddByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1));
    });
    return counts;
  }, [editAddByBuff]);
  const editRemoveCountByButton = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(editRemoveByBuff).forEach((buttonIds) => {
      buttonIds.forEach((buttonId) => counts.set(buttonId, (counts.get(buttonId) ?? 0) + 1));
    });
    return counts;
  }, [editRemoveByBuff]);
  const staffGroupCount = getStaffGroupCount(skillButtons);
  const canvasHeight = GRID_STACK_PADDING_TOP + staffGroupCount * GRID_GROUP_HEIGHT + Math.max(0, staffGroupCount - 1) * GRID_GROUP_GAP + GRID_STACK_PADDING_BOTTOM;
  const secondaryButtonLeft = useMemo(() => {
    if (layoutWidth === null || !Number.isFinite(layoutWidth)) {
      return BUFF_EDIT_SECONDARY_BUTTON_LEFT_FALLBACK;
    }
    return Math.max(
      0,
      layoutWidth - BUFF_EDIT_RIGHT_ZONE_WIDTH - BUFF_EDIT_SECONDARY_BUTTON_WIDTH - BUFF_EDIT_SECONDARY_BUTTON_GAP
    );
  }, [layoutWidth]);
  const anomalyContextBuffList = useMemo(() => {
    if (!anomalyContextButton) return [];
    return (anomalyContextButton.selectedBuff ?? [])
      .map((buffId) => buffById.get(buffId))
      .filter((buff): buff is SkillButtonBuff => Boolean(buff));
  }, [anomalyContextButton, buffById]);
  const anomalyStateWorkbench = useSkillButtonAnomaly({
    buttonId: anomalyContextButton?.id ?? '__buff-batch-edit-placeholder__',
    buttonCharacterId: anomalyContextButton?.characterId || anomalyContextButton?.characterName || '',
    buttonSkillType: anomalyContextButton?.skillType ?? 'A',
    characterName: anomalyContextButton?.characterName ?? '',
    selectedCharacters: selectedCharacters.map((character) => ({ id: character.id, name: character.name })),
    modifierBuffList: anomalyContextBuffList,
  });

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
    const layoutElement = layoutRef.current;
    if (!layoutElement) {
      return undefined;
    }

    const measure = () => {
      setLayoutWidth(layoutElement.getBoundingClientRect().width);
    };

    measure();

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        measure();
      })
      : null;

    resizeObserver?.observe(layoutElement);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
  }, [gridContentOffsetX, selectedCharacters]);

  const toggleButton = (buttonId: string) => {
    if (toolMode === 'remove') {
      if (!activeRemoveBuffId) {
        return;
      }
      const button = skillButtons.find((item) => item.id === buttonId);
      if (!button || !button.selectedBuff?.includes(activeRemoveBuffId)) {
        return;
      }
      setPendingRemoveByBuff((current) => {
        const currentTargets = current[activeRemoveBuffId] ?? [];
        const nextTargets = currentTargets.includes(buttonId)
          ? currentTargets.filter((id) => id !== buttonId)
          : [...currentTargets, buttonId];
        return {
          ...current,
          [activeRemoveBuffId]: nextTargets,
        };
      });
      return;
    }

    if (toolMode === 'add') {
      if (!activeAddBuffId) {
        return;
      }
      const button = skillButtons.find((item) => item.id === buttonId);
      if (!button || button.selectedBuff?.includes(activeAddBuffId)) {
        return;
      }
      setPendingAddByBuff((current) => {
        const currentTargets = current[activeAddBuffId] ?? [];
        const nextTargets = currentTargets.includes(buttonId)
          ? currentTargets.filter((id) => id !== buttonId)
          : [...currentTargets, buttonId];
        return {
          ...current,
          [activeAddBuffId]: nextTargets,
        };
      });
      return;
    }

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

  const handleAddCandidateSearchResult = (entry: LocalBuffSearchResult) => {
    const nextBuff = buffFromSearchResult(entry);
    addCandidateBuff(nextBuff);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
  };

  const addCandidateBuff = (nextBuff: SkillButtonBuff) => {
    setCandidateAddBuffs((current) => {
      if (current.some((buff) => buff.id === nextBuff.id)) {
        return current;
      }
      return [...current, nextBuff];
    });
    setActiveAddBuffId(nextBuff.id);
  };

  const handleAddAnomalyStateSnapshotCandidate = (snapshot: AnomalyStateSnapshot) => {
    const nextBuff = candidateBuffFromAnomalyStateSnapshot(snapshot);
    if (!nextBuff) {
      return;
    }
    addCandidateBuff(nextBuff);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
  };

  const handleCreateAnomalyStateCandidate = () => {
    const activeOption = anomalyStateWorkbench.activeAnomalyStateOption;
    const sourceCharacter = anomalyStateWorkbench.activeAnomalyStateSourceCharacter;
    const preview = anomalyStateWorkbench.activeAnomalyStatePreview;
    if (!activeOption || !sourceCharacter || !preview) {
      return;
    }

    const corrosionPreview = preview as typeof preview & {
      initialCorrosion?: number;
      tickCorrosionPerSecond?: number;
      maxCorrosion?: number;
      currentCorrosion?: number;
    };
    const snapshot: AnomalyStateSnapshot = {
      id: nextBatchAnomalyStateSnapshotIdRef.current++,
      key: activeOption.key,
      label: activeOption.label,
      level: anomalyStateWorkbench.activeAnomalyStateLevel,
      sourceButtonId: anomalyContextButton?.id ?? '__buff-batch-edit__',
      sourceCharacterId: sourceCharacter.id,
      sourceCharacterName: sourceCharacter.name,
      sourceSkillStrengthSnapshot: anomalyStateWorkbench.activeAnomalyStateSourceSkillBoost,
      effectValue: preview.effectValue,
      initialCorrosion: corrosionPreview.initialCorrosion,
      tickCorrosionPerSecond: corrosionPreview.tickCorrosionPerSecond,
      maxCorrosion: corrosionPreview.maxCorrosion,
      currentCorrosion: corrosionPreview.currentCorrosion,
      durationSeconds: activeOption.supportsDuration ? anomalyStateWorkbench.activeAnomalyStateDurationSeconds : undefined,
      primaryText: `${activeOption.label} Lv${anomalyStateWorkbench.activeAnomalyStateLevel} · 来源 ${sourceCharacter.name}`,
      secondaryText: preview.lines[5] ?? preview.lines[4] ?? activeOption.label,
      tertiaryText: activeOption.key === 'corrosion'
        ? `当前 ${anomalyStateWorkbench.activeAnomalyStateDurationSeconds}s`
        : activeOption.supportsDuration
          ? `持续 ${anomalyStateWorkbench.activeAnomalyStateDurationSeconds}s`
        : '快照生效',
      createdAt: Date.now(),
    };

    setBatchAnomalyStateSnapshots((current) => [...current, snapshot]);
    handleAddAnomalyStateSnapshotCandidate(snapshot);
  };

  const handleDeleteBatchAnomalyStateSnapshot = (snapshotId: number) => {
    setBatchAnomalyStateSnapshots((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
    const candidateBuffId = `candidate-add-anomaly-state-snapshot-${snapshotId}`;
    setCandidateAddBuffs((current) => current.filter((buff) => buff.id !== candidateBuffId));
    setPendingAddByBuff((current) => {
      const { [candidateBuffId]: _removed, ...rest } = current;
      return rest;
    });
    setActiveAddBuffId((current) => current === candidateBuffId ? null : current);
  };

  const resetAddMode = () => {
    setActiveAddBuffId(null);
    setPendingAddByBuff({});
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
    setCandidateAdderMode('buff-group');
  };

  const resetRemoveMode = () => {
    setActiveRemoveBuffId(null);
    setPendingRemoveByBuff({});
  };

  const resetEditMode = () => {
    setEditAddByBuff({});
    setEditRemoveByBuff({});
  };

  const handleCancelAddMode = () => {
    resetAddMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleCancelRemoveMode = () => {
    resetRemoveMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleConfirmAddMode = () => {
    loadBuffsToCache();
    Object.entries(pendingAddByBuff).forEach(([buffId, buttonIds]) => {
      const buff = buffById.get(buffId);
      if (!buff) return;
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (!button) {
          return;
        }
        addDraftBuffToButton(buttonId, buff);
      });
    });

    resetAddMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const handleToggleAddMode = () => {
    if (toolMode === 'add') {
      handleConfirmAddMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setSelectedFilterBuffIds([]);
    setSelectedButtonIds([]);
    setCandidateAddBuffs([]);
    setIsCandidateAdderOpen(false);
    setCandidateSearchKeyword('');
    setCandidateAdderMode('buff-group');
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('add');
  };

  const handleConfirmRemoveMode = () => {
    loadBuffsToCache();
    Object.entries(pendingRemoveByBuff).forEach(([buffId, buttonIds]) => {
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (!button || !button.selectedBuff?.includes(buffId)) {
          return;
        }
        decrementBuffStackOnButton(buttonId, buffId);
      });
    });

    resetRemoveMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const handleCancelEditMode = () => {
    resetEditMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setToolMode('normal');
  };

  const handleConfirmEditMode = () => {
    loadBuffsToCache();
    Object.entries(editRemoveByBuff).forEach(([buffId, buttonIds]) => {
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (button?.selectedBuff?.includes(buffId)) {
          removeBuffFromButton(buttonId, buffId);
        }
      });
    });

    Object.entries(editAddByBuff).forEach(([buffId, buttonIds]) => {
      const buff = buffById.get(buffId);
      if (!buff) return;
      buttonIds.forEach((buttonId) => {
        const button = skillButtons.find((item) => item.id === buttonId);
        if (button) {
          addDraftBuffToButton(buttonId, buff);
        }
      });
    });

    resetEditMode();
    setIsBoxSelectArmed(false);
    setBoxSelectRect(null);
    setSelectedButtonIds([]);
    setVisualButtons(readVisualSkillButtons(selectedCharacters, gridContentOffsetX));
    setBuffListVersion((version) => version + 1);
    setToolMode('normal');
  };

  const toggleEditRemoveBuff = (buffId: string) => {
    const targetIds = selectedButtons
      .filter((button) => button.selectedBuff?.includes(buffId))
      .map((button) => button.id);
    setEditRemoveByBuff((current) => {
      const currentTargets = current[buffId] ?? [];
      const isActive = targetIds.length > 0 && targetIds.every((id) => currentTargets.includes(id));
      return {
        ...current,
        [buffId]: isActive ? [] : targetIds,
      };
    });
  };

  const toggleEditAddBuff = (buffId: string) => {
    const targetIds = selectedButtons
      .filter((button) => !button.selectedBuff?.includes(buffId))
      .map((button) => button.id);
    setEditAddByBuff((current) => {
      const currentTargets = current[buffId] ?? [];
      const isActive = targetIds.length > 0 && targetIds.every((id) => currentTargets.includes(id));
      return {
        ...current,
        [buffId]: isActive ? [] : targetIds,
      };
    });
  };

  const handleToggleRemoveMode = () => {
    if (toolMode === 'remove') {
      handleConfirmRemoveMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    setSelectedFilterBuffIds([]);
    setSelectedButtonIds([]);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('remove');
  };

  const handleToggleFilterMode = () => {
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode((current) => {
      const nextMode = current === 'filter' ? 'normal' : 'filter';
      if (nextMode === 'filter') {
        applyFilterSelection(selectedFilterBuffIds);
      }
      return nextMode;
    });
  };

  const handleToggleEditMode = () => {
    if (toolMode === 'edit') {
      handleConfirmEditMode();
      return;
    }
    setBoxSelectRect(null);
    setIsBoxSelectArmed(false);
    setActiveSourceFilter(null);
    resetAddMode();
    resetRemoveMode();
    resetEditMode();
    setToolMode('edit');
  };

  useEffect(() => {
    if (toolMode !== 'add') {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCandidateAdderOpen) {
        event.preventDefault();
        setIsCandidateAdderOpen(false);
        setCandidateSearchKeyword('');
        return;
      }

      if (event.key === 'Tab' && !event.shiftKey && isCandidateAdderOpen) {
        event.preventDefault();
        setCandidateAdderMode((current) => getNextCandidateAdderMode(current));
        setCandidateSearchKeyword('');
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.closest('[contenteditable="true"]');

      if (event.key === 'Tab' && !event.shiftKey && !isEditable) {
        event.preventDefault();
        setIsCandidateAdderOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCandidateAdderOpen, toolMode]);

  useEffect(() => {
    if (!isCandidateAdderOpen) {
      return undefined;
    }
    const selectedCharacterIds = selectedCharacters
      .map((character) => character.id)
      .filter((id): id is string => Boolean(id));
    refreshSnapshotCandidateBuffsForCharacterIds(selectedCharacterIds)
      .then(() => setCandidateBuffRefreshToken((token) => token + 1))
      .catch((error) => console.error('刷新批量 Buff 候选列表失败:', error));
    const timer = window.setTimeout(() => {
      candidateSearchInputRef.current?.focus();
      candidateSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isCandidateAdderOpen, candidateAdderMode, selectedCharacters]);

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

  const toggleAddTargetsInRect = (rect: BoxSelectRect) => {
    const normalizedRect = normalizeRect(rect);
    if (toolMode === 'add' && activeAddBuffId) {
      const hitIds = skillButtons
        .filter((button) => {
          if (button.selectedBuff?.includes(activeAddBuffId)) {
            return false;
          }
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

      setPendingAddByBuff((current) => {
        const currentTargets = current[activeAddBuffId] ?? [];
        const hitSet = new Set(hitIds);
        const shouldRemove = hitIds.some((id) => currentTargets.includes(id));
        return {
          ...current,
          [activeAddBuffId]: shouldRemove
            ? currentTargets.filter((id) => !hitSet.has(id))
            : Array.from(new Set([...currentTargets, ...hitIds])),
        };
      });
      return;
    }

    if (toolMode === 'remove' && activeRemoveBuffId) {
      const hitIds = skillButtons
        .filter((button) => {
          if (!button.selectedBuff?.includes(activeRemoveBuffId)) {
            return false;
          }
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

      setPendingRemoveByBuff((current) => {
        const currentTargets = current[activeRemoveBuffId] ?? [];
        const hitSet = new Set(hitIds);
        const shouldRemove = hitIds.some((id) => currentTargets.includes(id));
        return {
          ...current,
          [activeRemoveBuffId]: shouldRemove
            ? currentTargets.filter((id) => !hitSet.has(id))
            : Array.from(new Set([...currentTargets, ...hitIds])),
        };
      });
      return;
    }

    const hitIds = skillButtons
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
    setSelectedButtonIds((current) => {
      const hitSet = new Set(hitIds);
      const shouldRemove = hitIds.some((id) => current.includes(id));
      return shouldRemove
        ? current.filter((id) => !hitSet.has(id))
        : Array.from(new Set([...current, ...hitIds]));
    });
  };

  const handleBoxSelectMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!['normal', 'add', 'remove'].includes(toolMode) || !isBoxSelectArmed || event.button !== 0) {
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
      toggleAddTargetsInRect(boxSelectRect);
      setBoxSelectRect(null);
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
                  src={normalizeAssetUrl(character.avatarUrl)}
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
    const isAddOwned = toolMode === 'add' && Boolean(activeAddBuffId && button.selectedBuff?.includes(activeAddBuffId));
    const isAddTarget = toolMode === 'add' && Boolean(activeAddBuffId && pendingAddByBuff[activeAddBuffId]?.includes(button.id));
    const isRemoveOwned = toolMode === 'remove' && Boolean(activeRemoveBuffId && button.selectedBuff?.includes(activeRemoveBuffId));
    const isRemoveTarget = toolMode === 'remove' && Boolean(activeRemoveBuffId && pendingRemoveByBuff[activeRemoveBuffId]?.includes(button.id));
    const isEditAddTarget = toolMode === 'edit' && (editAddCountByButton.get(button.id) ?? 0) > 0;
    const isEditRemoveTarget = toolMode === 'edit' && (editRemoveCountByButton.get(button.id) ?? 0) > 0;
    const pendingAddCount = toolMode === 'edit' ? (editAddCountByButton.get(button.id) ?? 0) : (pendingAddCountByButton.get(button.id) ?? 0);
    const pendingRemoveCount = toolMode === 'edit' ? (editRemoveCountByButton.get(button.id) ?? 0) : (pendingRemoveCountByButton.get(button.id) ?? 0);
    const element = character?.element ?? '';

    return (
      <BuffEditSkillButton
        key={button.id}
        button={button}
        element={element}
        isSelected={isSelected}
        isAddOwned={isAddOwned}
        isAddTarget={isAddTarget}
        isRemoveOwned={isRemoveOwned}
        isRemoveTarget={isRemoveTarget}
        isEditAddTarget={isEditAddTarget}
        isEditRemoveTarget={isEditRemoveTarget}
        pendingAddCount={pendingAddCount}
        pendingRemoveCount={pendingRemoveCount}
        onToggle={toggleButton}
      />
    );
  };

  const renderBuffTag = (
    buffId: string,
    options: { selected?: boolean; white?: boolean; gray?: boolean; intent?: 'add' | 'remove'; onClick?: () => void } = {}
  ) => {
    const buff = buffById.get(buffId);
    const label = buff ? getBuffLabel(buff) : '缺失 Buff';
    const missingLine = getMissingBuffShortId(buffId);
    return (
      <button
        key={buffId}
        type="button"
        className={`buff-edit-buff-card${options.selected ? ' is-selected' : ''}${options.white ? ' is-white' : ''}${options.gray ? ' is-gray' : ''}${options.intent === 'add' ? ' is-add-intent' : ''}${options.intent === 'remove' ? ' is-remove-intent' : ''}`}
        onClick={options.onClick}
        disabled={!options.onClick}
        title={buff ? `${label} / ${getBuffSourceLabel(buff)} / ${getBuffValueLine(buff)}` : `实体缺失：${buffId}`}
      >
        <span className="buff-edit-buff-card-title">{label}</span>
        <span>{buff ? getBuffSourceLabel(buff) : '可点击清理引用'}</span>
        <span>{buff ? getBuffValueLine(buff) : missingLine}</span>
      </button>
    );
  };

  const isSourceFilterActive = (filter: SourceFilter): boolean => (
    activeSourceFilter?.kind === filter.kind && activeSourceFilter.id === filter.id
  );

  const renderRightSideButtons = () => {
    if (toolMode === 'filter' || toolMode === 'add' || toolMode === 'remove') {
      const characterButtons = selectedCharacters.slice(0, 4).map((character, index) => {
        const filter: SourceFilter = { kind: 'character', id: character.id, name: character.name };
        return (
          <button
            key={`source-character-${character.id}`}
            className={`buff-edit-secondary-button buff-edit-secondary-avatar-button${isSourceFilterActive(filter) ? ' is-active' : ''}`}
            type="button"
            title={character.name}
            aria-label={`筛选干员来源 ${character.name}`}
            style={{ left: secondaryButtonLeft, top: 48 + index * 40 }}
            onClick={() => toggleSourceFilter(filter)}
          >
            {character.avatarUrl ? <img src={normalizeAssetUrl(character.avatarUrl)} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
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
            style={{ left: secondaryButtonLeft, top: 248 + index * 40 }}
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
            style={{ left: secondaryButtonLeft, top: 208 }}
            onClick={() => toggleSourceFilter(equipmentFilter)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 4l6 2v5h-3v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8H3V6l6-2a3 3 0 0 0 6 0" />
            </svg>
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
        style={{ left: secondaryButtonLeft, top: 48 + index * 40 }}
        onClick={() => toggleCharacterQuickSelect(character)}
      >
        {character.avatarUrl ? <img src={normalizeAssetUrl(character.avatarUrl)} alt="" /> : <span>{character.name.slice(0, 1)}</span>}
      </button>
    ));
  };

  const renderRightPanel = () => {
    if (toolMode === 'remove') {
      const draftBuffCount = Object.keys(pendingRemoveByBuff).filter((buffId) => (pendingRemoveByBuff[buffId] ?? []).length > 0).length;
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>删减 Buff</h3>
            <span>{draftBuffCount} Buff 草稿</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: activeRemoveBuffId === buff.id,
                onClick: () => setActiveRemoveBuffId((current) => current === buff.id ? null : buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
        </div>
      );
    }

    if (toolMode === 'add') {
      const draftBuffCount = Object.keys(pendingAddByBuff).filter((buffId) => (pendingAddByBuff[buffId] ?? []).length > 0).length;
      return (
        <div className="buff-edit-right-panel">
          <div className="buff-edit-right-head">
            <h3>增加 Buff</h3>
            <span>{draftBuffCount} Buff 草稿</span>
          </div>
          <div className="buff-edit-tag-list">
            {visibleFilterBuffs.length > 0 ? (
              visibleFilterBuffs.map((buff) => renderBuffTag(buff.id, {
                selected: activeAddBuffId === buff.id,
                onClick: () => setActiveAddBuffId((current) => current === buff.id ? null : buff.id),
              }))
            ) : (
              <div className="buff-edit-right-empty">暂无 Buff</div>
            )}
          </div>
          <section className="buff-edit-right-section buff-edit-candidate-section">
            <div className="buff-edit-candidate-head">
              <h4>候选 Buff</h4>
              <span>Tab 打开面板添加候选 Buff</span>
            </div>
            {candidateAddBuffs.length > 0 ? (
              <div className="buff-edit-tag-list">
                {candidateAddBuffs.map((buff) => renderBuffTag(buff.id, {
                  selected: activeAddBuffId === buff.id,
                  onClick: () => setActiveAddBuffId((current) => current === buff.id ? null : buff.id),
                }))}
              </div>
            ) : (
              <div className="buff-edit-candidate-empty">候选 Buff 为空</div>
            )}
            {isCandidateAdderOpen ? (
              <div className="buff-edit-candidate-empty">候选 Buff 面板已打开，Tab 切换入口，Esc 关闭</div>
            ) : null}
          </section>
        </div>
      );
    }

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
                ? commonBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editRemoveByBuff[buffId] ?? []).length > 0,
                  intent: 'remove',
                  onClick: () => toggleEditRemoveBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无共同 Buff</div>}
            </div>
          </section>
          <section className="buff-edit-right-section">
            <h4>已用剩余 Buff</h4>
            <div className="buff-edit-tag-list">
              {usedNonCommonBuffIds.length > 0
                ? usedNonCommonBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editAddByBuff[buffId] ?? []).length > 0,
                  intent: 'add',
                  onClick: () => toggleEditAddBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无剩余 Buff</div>}
            </div>
          </section>
          <section className="buff-edit-right-section">
            <h4>未用 Buff</h4>
            <div className="buff-edit-tag-list">
              {unusedBuffIds.length > 0
                ? unusedBuffIds.map((buffId) => renderBuffTag(buffId, {
                  selected: (editAddByBuff[buffId] ?? []).length > 0,
                  gray: true,
                  intent: 'add',
                  onClick: () => toggleEditAddBuff(buffId),
                }))
                : <div className="buff-edit-right-empty">暂无未用 Buff</div>}
            </div>
          </section>
        </div>
      );
    }

    return <div className="buff-edit-right-placeholder" />;
  };

  const renderCandidateAdderModal = () => {
    if (toolMode !== 'add' || !isCandidateAdderOpen) {
      return null;
    }

    return (
      <div className="skill-button-inline-buff-search-mask" onClick={() => {
        setIsCandidateAdderOpen(false);
        setCandidateSearchKeyword('');
      }}>
        <div
          className="skill-button-inline-buff-search is-workbench-mode buff-edit-candidate-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="skill-button-inline-buff-search-head">
            <h5>{getCandidateAdderModeLabel(candidateAdderMode)}</h5>
            <span>Tab 切换入口 / Esc 关闭</span>
          </div>
          <div className="skill-button-inline-buff-search-modes">
            {CANDIDATE_ADDER_MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`skill-button-inline-buff-search-mode${candidateAdderMode === option.key ? ' is-active' : ''}`}
                onClick={() => {
                  setCandidateAdderMode(option.key);
                  setCandidateSearchKeyword('');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="skill-button-buff-workbench">
            <div className="skill-button-buff-workbench-main">
              {candidateAdderMode === 'anomaly-state' ? (
                <SkillButtonAnomalyStatePanel
                  activeAnomalyStateOption={anomalyStateWorkbench.activeAnomalyStateOption}
                  activeAnomalyStateLevel={anomalyStateWorkbench.activeAnomalyStateLevel}
                  activeAnomalyStateDurationSeconds={anomalyStateWorkbench.activeAnomalyStateDurationSeconds}
                  activeAnomalyStatePreview={anomalyStateWorkbench.activeAnomalyStatePreview}
                  activeAnomalyStateSourceCharacter={anomalyStateWorkbench.activeAnomalyStateSourceCharacter}
                  sourceCharacters={anomalyStateWorkbench.sourceCharacters}
                  selectedAnomalyStateSnapshots={batchAnomalyStateSnapshots}
                  onSelectAnomalyState={anomalyStateWorkbench.handleSelectAnomalyState}
                  onCreateSnapshot={handleCreateAnomalyStateCandidate}
                  onSetActiveAnomalyStateLevel={anomalyStateWorkbench.setActiveAnomalyStateLevel}
                  onSetActiveAnomalyStateSourceId={anomalyStateWorkbench.setActiveAnomalyStateSourceId}
                  onSetActiveAnomalyStateDurationSeconds={anomalyStateWorkbench.setActiveAnomalyStateDurationSeconds}
                  onRemoveAnomalyStateSnapshotCard={handleDeleteBatchAnomalyStateSnapshot}
                />
              ) : (
                <div className="skill-button-local-buff-panel">
                <input
                  ref={candidateSearchInputRef}
                  className="skill-button-inline-buff-search-input"
                  value={candidateSearchKeyword}
                  onChange={(event) => setCandidateSearchKeyword(event.target.value)}
                  placeholder="搜索组 / 项 / Buff / 类型 / 条件"
                />
                <div className="skill-button-inline-buff-search-results">
                  {candidateSearchKeyword.trim().length === 0 ? (
                    <div className="skill-button-inline-buff-search-empty">
                      输入关键词后再显示{getCandidateAdderModeLabel(candidateAdderMode)}结果
                    </div>
                  ) : candidateSearchResults.length > 0 ? (
                    candidateSearchResults.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className="skill-button-inline-buff-search-item"
                        onClick={() => handleAddCandidateSearchResult(entry)}
                      >
                        <div className="local-buff-search-item-head">
                          <strong>{entry.displayName}</strong>
                          <span>{entry.effectKind === 'extraHit' ? '额外伤害段' : entry.type || '暂无'}</span>
                        </div>
                        <p>{entry.groupName}{entry.itemName ? ` / ${entry.itemName}` : ''}</p>
                        <p>{entry.effectKind === 'extraHit'
                          ? `倍率: ${((entry.extraHitConfig?.baseMultiplier ?? 0) * 100).toFixed(1)}% / ${entry.extraHitConfig?.damageType || 'physical'} / ${entry.extraHitConfig?.skillType || '空'} / CD ${entry.extraHitConfig?.cooldownSeconds ?? 0}s`
                          : `数值: ${entry.value ?? '-'}${entry.condition ? ` / ${entry.condition}` : ''}`}</p>
                      </button>
                    ))
                  ) : (
                    <div className="skill-button-inline-buff-search-empty">
                      没有匹配到{getCandidateAdderModeLabel(candidateAdderMode)}
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
            <aside className="skill-button-buff-resource-rail">
              <div className="skill-anomaly-board skill-anomaly-cache-board">
                <div className="skill-anomaly-board-section">
                  <p className="skill-anomaly-board-title">{candidateAdderMode === 'anomaly-state' ? '缓存快照' : '本轮候选 Buff'}</p>
                  <div className="skill-anomaly-board-list skill-anomaly-cache-list">
                    {candidateAdderMode === 'anomaly-state' ? (
                      batchAnomalyStateSnapshots.length === 0 ? (
                        <div className="skill-button-buff-empty">暂无缓存快照</div>
                      ) : (
                        batchAnomalyStateSnapshots.map((snapshot) => (
                          <button
                            key={`available-state-${snapshot.id}`}
                            type="button"
                            className="anomaly-board-card is-state"
                            onClick={() => handleAddAnomalyStateSnapshotCandidate(snapshot)}
                            title="单击加入本轮候选 Buff"
                          >
                            <span className="anomaly-board-card-title">{snapshot.primaryText}</span>
                            <span>{snapshot.sourceCharacterName}</span>
                            <span>{snapshot.secondaryText}</span>
                            <span
                              className="anomaly-board-card-delete-text"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteBatchAnomalyStateSnapshot(snapshot.id);
                              }}
                            >
                              删除
                            </span>
                          </button>
                        ))
                      )
                    ) : candidateAddBuffs.length === 0 ? (
                      <div className="skill-button-buff-empty">暂无候选 Buff</div>
                    ) : (
                      candidateAddBuffs.map((buff) => (
                        <button
                          key={`candidate-add-modal-${buff.id}`}
                          type="button"
                          className={`anomaly-board-card${activeAddBuffId === buff.id ? ' is-state' : ''}`}
                          onClick={() => setActiveAddBuffId(buff.id)}
                          title="单击设为当前待添加 Buff"
                        >
                          <span className="anomaly-board-card-title">{buff.displayName || buff.name}</span>
                          <span>{buff.sourceName || buff.source || '未知来源'}</span>
                          <span>{getBuffValueLine(buff)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  };

  return (
    <WorkbenchSplitSurface
      rootClassName={`buff-batch-edit-workbench ${isWorkbenchTopZoneOpen ? 'has-top-zone' : ''}${toolMode === 'add' ? ' is-add-mode' : ''}${toolMode === 'remove' ? ' is-remove-mode' : ''}${toolMode === 'edit' ? ' is-edit-mode' : ''}`}
      layoutClassName="buff-edit-layout"
      layoutRef={layoutRef}
      overlay={renderCandidateAdderModal()}
    >
        <section className="canvas-left-zone buff-edit-left-zone">
          <div className="canvas-area buff-edit-canvas-area">
            <div ref={canvasRef} className="canvas-container buff-edit-canvas" style={{ height: canvasHeight }}>
              <div className="buff-edit-tool-layer">
                <button
                  className={`buff-edit-box-select-button${isBoxSelectArmed ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setIsBoxSelectArmed((value) => !value)}
                  disabled={!['normal', 'add', 'remove'].includes(toolMode)}
                  title="框选技能按钮"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4h5v2H7v3H5V4Zm9 0h5v5h-2V6h-3V4ZM5 15h2v3h3v2H5v-5Zm12 0h2v5h-5v-2h3v-3ZM9 9h6v6H9V9Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-clear-selection-button${toolMode === 'add' || toolMode === 'edit' ? ' is-cancel-add' : ''}${toolMode === 'remove' ? ' is-cancel-remove' : ''}`}
                  type="button"
                  onClick={() => {
                    if (toolMode === 'add') {
                      handleCancelAddMode();
                      return;
                    }
                    if (toolMode === 'remove') {
                      handleCancelRemoveMode();
                      return;
                    }
                    if (toolMode === 'edit') {
                      handleCancelEditMode();
                      return;
                    }
                    setSelectedButtonIds([]);
                    setIsBoxSelectArmed(false);
                    setBoxSelectRect(null);
                  }}
                  disabled={toolMode !== 'normal' && toolMode !== 'add' && toolMode !== 'remove' && toolMode !== 'edit'}
                  title={toolMode === 'add' ? '取消增加' : toolMode === 'remove' ? '取消删减' : toolMode === 'edit' ? '取消编辑' : '取消全部选中'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-filter-button${toolMode === 'filter' ? ' is-active' : ''}`}
                  type="button"
                  onClick={handleToggleFilterMode}
                  disabled={toolMode === 'edit' || toolMode === 'add' || toolMode === 'remove'}
                  title="筛选 Buff"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5h16l-6.2 7.1V18l-3.6 1.8v-7.7L4 5Zm4.4 2 3.8 4.4v5.2l.6-.3v-4.9L16.6 7H8.4Z" />
                  </svg>
                </button>
                <button
                  className={`buff-edit-mode-button${toolMode === 'edit' ? ' is-confirm-edit' : ''}`}
                  type="button"
                  onClick={handleToggleEditMode}
                  disabled={toolMode === 'filter' || toolMode === 'add' || toolMode === 'remove'}
                  title={toolMode === 'edit' ? '确认编辑' : '编辑目录'}
                >
                  {toolMode === 'edit' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 4h9v2H7v12h10v-7h2v9H5V4Zm11.8.6 2.6 2.6-7.8 7.8H9v-2.6l7.8-7.8Zm1.2 2.6-1.2-1.2L11 11.8V13h1.2L18 7.2Z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`buff-edit-add-button${toolMode === 'add' ? ' is-confirm-add' : ''}`}
                  type="button"
                  onClick={handleToggleAddMode}
                  disabled={toolMode === 'filter' || toolMode === 'edit' || toolMode === 'remove'}
                  title={toolMode === 'add' ? '确认增加' : '增加 Buff'}
                >
                  {toolMode === 'add' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
                    </svg>
                  )}
                </button>
                <button
                  className={`buff-edit-remove-button${toolMode === 'remove' ? ' is-confirm-remove' : ''}`}
                  type="button"
                  onClick={handleToggleRemoveMode}
                  disabled={toolMode === 'filter' || toolMode === 'edit' || toolMode === 'add'}
                  title={toolMode === 'remove' ? '确认删减' : '删减 Buff'}
                >
                  {toolMode === 'remove' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 11h14v2H5v-2Z" />
                    </svg>
                  )}
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
    </WorkbenchSplitSurface>
  );
}
