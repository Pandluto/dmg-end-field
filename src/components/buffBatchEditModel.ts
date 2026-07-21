import { getSkillButtonTable } from '../core/repositories';
import { getCharacterInputMap } from '../core/repositories/operatorConfigRepository';
import { addBuffToButton } from '../core/services/buffService';
import { buildAnomalyStateSnapshotBuffs } from '../core/services/anomalyStateBuffs';
import { resolveRuntimeTemplateSkill } from '../core/services/skillDamageTemplateResolver';
import {
  BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  getBuffSourceSearchModeLabel,
  type BuffSourceSearchMode,
  type LocalBuffSearchResult,
} from './CanvasBoard/skillButton.shared';
import {
  getGridLineCenterY,
  getGridNodeCenterX,
  GRID_GROUP_HEIGHT,
  GRID_GROUP_GAP,
  GRID_NODE_COUNT,
  GRID_STACK_PADDING_TOP,
  LINE_ROW_INDICES,
} from '../core/calculators/gridSnapLayout';
import { SKILL_BUTTON_BASELINE_OFFSET_Y } from '../constants/canvas-layout';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { resolveSkillIconUrl } from '../utils/assetResolver';
import { safeSessionStorage } from '../utils/storage';
import type { Character, SkillButtonData, SkillType, TimelineData } from '../types';
import type { AnomalyStateSnapshot, PersistedSkillButton, SkillButtonBuff } from '../types/storage';

export const SKILL_BUTTON_SIZE = 44;
export const SKILL_BUTTON_RADIUS = SKILL_BUTTON_SIZE / 2;
export const SKILL_BUTTON_VISUAL_OFFSET_X = 40;
export const SKILL_BUTTON_VISUAL_OFFSET_Y = 15;
export const SKILL_BUTTON_BASE_WIDTH = 80;
export const SKILL_BUTTON_BASE_HEIGHT = 30;
export const SKILL_BUTTON_HIT_WIDTH = SKILL_BUTTON_RADIUS + SKILL_BUTTON_BASE_WIDTH;
export const SKILL_BUTTON_HIT_HEIGHT = Math.max(SKILL_BUTTON_SIZE, SKILL_BUTTON_RADIUS + SKILL_BUTTON_BASE_HEIGHT);
export const BUFF_EDIT_RIGHT_ZONE_WIDTH = 300;
export const BUFF_EDIT_SECONDARY_BUTTON_WIDTH = 32;
export const BUFF_EDIT_SECONDARY_BUTTON_GAP = 3;
export const BUFF_EDIT_SECONDARY_BUTTON_LEFT_FALLBACK = 1365;
export const BUFF_EDIT_TOP_SPACER_HEIGHT = 30;

export const columnLabels = Array.from({ length: GRID_NODE_COUNT }, (_, index) => String.fromCharCode(65 + index));
export const rowLabels = Array.from({ length: 8 }, (_, index) => String(index + 1));

export interface BoxSelectRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export type EditToolMode = 'normal' | 'filter' | 'edit' | 'add' | 'remove';
export type SourceFilter =
  | { kind: 'character'; id: string; name: string }
  | { kind: 'weapon'; id: string; name: string }
  | { kind: 'equipment'; id: 'equipment'; name: string };
export type CandidateAdderMode = BuffSourceSearchMode | 'anomaly-state';

export const CANDIDATE_ADDER_MODE_OPTIONS: Array<{ key: CandidateAdderMode; label: string }> = [
  ...BUFF_SOURCE_SEARCH_MODE_OPTIONS,
  { key: 'anomaly-state', label: '异常状态区' },
];

const CANDIDATE_SOURCE_MODES = new Set<CandidateAdderMode>(BUFF_SOURCE_SEARCH_MODE_OPTIONS.map((option) => option.key));

export function isCandidateSourceMode(mode: CandidateAdderMode): mode is BuffSourceSearchMode {
  return CANDIDATE_SOURCE_MODES.has(mode);
}

export function getCandidateAdderModeLabel(mode: CandidateAdderMode): string {
  return isCandidateSourceMode(mode) ? getBuffSourceSearchModeLabel(mode) : '异常状态区';
}

export function getNextCandidateAdderMode(mode: CandidateAdderMode): CandidateAdderMode {
  const index = CANDIDATE_ADDER_MODE_OPTIONS.findIndex((option) => option.key === mode);
  return CANDIDATE_ADDER_MODE_OPTIONS[(index + 1) % CANDIDATE_ADDER_MODE_OPTIONS.length].key;
}

export function getButtonLineIndex(button: PersistedSkillButton): number {
  const legacyLineIndex = (button as PersistedSkillButton & { lineIndex?: number }).lineIndex;
  if (typeof legacyLineIndex === 'number') {
    return legacyLineIndex;
  }
  return Math.max(0, Math.min(LINE_ROW_INDICES.length - 1, button.staffIndex ?? 0));
}

export function getButtonStaffGroupIndex(button: PersistedSkillButton): number {
  const legacyLineIndex = (button as PersistedSkillButton & { lineIndex?: number }).lineIndex;
  if (typeof legacyLineIndex === 'number') {
    return Math.max(0, button.staffIndex ?? 0);
  }
  return Math.max(0, Math.floor((button.nodeIndex ?? 0) / GRID_NODE_COUNT));
}

export function getButtonSkillType(button: PersistedSkillButton): SkillType {
  return ['A', 'B', 'E', 'Q', 'Dot'].includes(button.skillType)
    ? button.skillType as SkillType
    : 'A';
}

export function buildButtonPosition(button: PersistedSkillButton): { x: number; y: number } {
  if (button.position && Number.isFinite(button.position.x) && Number.isFinite(button.position.y)) {
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

export function readVisualSkillButtons(
  selectedCharacters: Character[],
  gridContentOffsetX: number | null,
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
      const groupIndex = typeof timelineButton.nodeIndex === 'number' && Number.isFinite(timelineButton.nodeIndex)
        ? Math.floor(timelineButton.nodeIndex / GRID_NODE_COUNT)
        : 0;
      const localNodeIndex = typeof timelineButton.nodeIndex === 'number' && Number.isFinite(timelineButton.nodeIndex)
        ? timelineButton.nodeIndex % GRID_NODE_COUNT
        : 0;
      const restoredLineIndex = lineIndex >= 0 ? lineIndex : 0;
      const normalizedPosition = {
        x: gridContentOffsetX !== null
          ? gridContentOffsetX + getGridNodeCenterX(localNodeIndex)
          : timelineButton.position.x,
        y: GRID_STACK_PADDING_TOP + groupIndex * (GRID_GROUP_HEIGHT + GRID_GROUP_GAP) + getGridLineCenterY(restoredLineIndex) + SKILL_BUTTON_BASELINE_OFFSET_Y,
      };
      const restoredButtonCharacterId = character?.id ?? timelineButton.characterId ?? timelineButton.characterName;
      const resolvedRuntimeSkill = resolveRuntimeTemplateSkill({
        id: timelineButton.id,
        characterId: restoredButtonCharacterId,
        characterName: timelineButton.characterName,
        skillType: timelineButton.skillType,
        position: normalizedPosition,
        staffIndex: groupIndex,
        lineIndex: restoredLineIndex,
        isDragging: false,
        isSelected: false,
        isFromSandbox: true,
        runtimeSkillId: timelineButton.runtimeSkillId,
        skillDisplayName: timelineButton.skillDisplayName,
        skillIconUrl: timelineButton.skillIconUrl,
        customHits: timelineButton.customHits,
        element: character?.element,
      });
      const resolvedSkillIconUrl = resolvedRuntimeSkill?.iconUrl
        ?? timelineButton.skillIconUrl
        ?? resolveSkillIconUrl(timelineButton.characterName, timelineButton.skillType);

      buttons.push({
        ...persistedButton,
        ...({ lineIndex: restoredLineIndex } as { lineIndex: number }),
        id: timelineButton.id,
        characterId: restoredButtonCharacterId,
        characterName: timelineButton.characterName,
        skillType: timelineButton.skillType,
        staffIndex: groupIndex,
        nodeIndex: localNodeIndex,
        nodeNumber: timelineButton.nodeNumber,
        position: normalizedPosition,
        runtimeSkillId: resolvedRuntimeSkill?.id ?? timelineButton.runtimeSkillId,
        skillDisplayName: resolvedRuntimeSkill?.displayName || timelineButton.skillDisplayName,
        skillIconUrl: resolvedSkillIconUrl,
        customHits: timelineButton.customHits,
        selectedBuff: persistedButton?.selectedBuff ?? timelineButton.buffIds ?? [],
        panelConfig: persistedButton?.panelConfig,
        runtimeSnapshot: persistedButton?.runtimeSnapshot ?? null,
      });
    });
  });

  return buttons.sort(sortButtons);
}

export function sortButtons(a: PersistedSkillButton, b: PersistedSkillButton): number {
  const staffDiff = getButtonStaffGroupIndex(a) - getButtonStaffGroupIndex(b);
  if (staffDiff !== 0) return staffDiff;
  const lineDiff = getButtonLineIndex(a) - getButtonLineIndex(b);
  if (lineDiff !== 0) return lineDiff;
  return (a.nodeIndex ?? 0) - (b.nodeIndex ?? 0);
}

export function getInitialSkillButtons(selectedCharacters: Character[]): PersistedSkillButton[] {
  return readVisualSkillButtons(selectedCharacters, null);
}

export function getFallbackSkillButtons(): PersistedSkillButton[] {
  return Object.values(getSkillButtonTable()).sort(sortButtons);
}

export function getStaffGroupCount(skillButtons: PersistedSkillButton[]): number {
  return Math.max(1, ...skillButtons.map((button) => getButtonStaffGroupIndex(button) + 1));
}

export function normalizeRect(rect: BoxSelectRect) {
  const left = Math.min(rect.startX, rect.currentX);
  const top = Math.min(rect.startY, rect.currentY);
  const right = Math.max(rect.startX, rect.currentX);
  const bottom = Math.max(rect.startY, rect.currentY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function intersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function getBuffLabel(buff: SkillButtonBuff): string {
  return buff.displayName?.trim() || buff.name?.trim() || buff.id;
}

export function getBuffSourceLabel(buff: SkillButtonBuff): string {
  return buff.sourceName?.trim() || buff.source?.trim() || '未知来源';
}

export function getBuffValueLine(buff: SkillButtonBuff): string {
  if (buff.effectKind === 'extraHit') {
    return `额外伤害 · ${((buff.extraHitConfig?.baseMultiplier ?? 0) * 100).toFixed(1)}% · ${buff.extraHitConfig?.damageType || 'physical'} · ${buff.extraHitConfig?.skillType || '空'} · ${buff.extraHitConfig?.cooldownSeconds ?? 0}s CD`;
  }
  const type = buff.type?.trim() || buff.name?.trim() || buff.id;
  return typeof buff.value === 'number' ? `${type} · ${buff.value}` : type;
}

export function getMissingBuffShortId(buffId: string): string {
  return buffId.length > 18 ? `${buffId.slice(0, 18)}...` : buffId;
}

export function compareBuffBySource(a: SkillButtonBuff, b: SkillButtonBuff): number {
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

export function resolveWeaponImageUrl(weaponName: string): string {
  return `http://127.0.0.1:31457/user-images/${encodeURIComponent(`${weaponName}.png`)}`;
}

export function getCharacterWeaponName(character: Character, inputMap: ReturnType<typeof getCharacterInputMap>): string {
  const input = inputMap[character.id] ?? inputMap[character.name];
  return input?.weapon?.name?.trim() || '';
}

export function buffMatchesSourceFilter(buff: SkillButtonBuff, filter: SourceFilter | null): boolean {
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

export function buffFromSearchResult(entry: LocalBuffSearchResult): SkillButtonBuff {
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
    ownerBuffDomain: entry.ownerBuffDomain,
    ownerCharacterId: entry.ownerCharacterId,
    ownerBuffGroup: entry.ownerBuffGroup,
    valueMode: entry.valueMode,
    derivedValue: entry.derivedValue,
    effectKind: entry.effectKind,
    extraHitConfig: entry.extraHitConfig,
    multiplier: entry.multiplier,
    refCount: 1,
  };
}

export function addDraftBuffToButton(buttonId: string, buff: SkillButtonBuff) {
  const { id: _id, ...buffWithoutId } = buff;
  return addBuffToButton(buttonId, buffWithoutId);
}

export function candidateBuffFromAnomalyStateSnapshot(snapshot: AnomalyStateSnapshot): SkillButtonBuff | null {
  const [snapshotBuff] = buildAnomalyStateSnapshotBuffs([snapshot]);
  if (!snapshotBuff) return null;
  return {
    ...snapshotBuff,
    id: `candidate-add-${snapshotBuff.id}`,
    sourceName: snapshot.sourceCharacterName,
    condition: snapshot.secondaryText || snapshotBuff.condition,
  };
}

export function dedupeBuffIds(buffIds: string[]): string[] {
  return Array.from(new Set(buffIds.filter(Boolean)));
}
