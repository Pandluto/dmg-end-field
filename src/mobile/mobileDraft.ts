import type { Character } from '../types';
import type { HitResistanceInput, SkillButtonBuff } from '../types/storage';
import {
  MOBILE_DRAFT_SCHEMA_VERSION,
  MOBILE_EQUIPMENT_SLOT_KEYS,
  MOBILE_INITIAL_SLOT_COUNT,
  MOBILE_PAGE_IDS,
  type MobileDraft,
  type MobileOperatorConfig,
  type MobilePageId,
  type MobileTimelineAction,
  type MobileTimelineSlot,
} from './model';

export const MOBILE_DRAFT_STORAGE_KEY = 'def.mobile-workbench.draft.v1';

let fallbackId = 0;

export function createMobileId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackId += 1;
  return `${prefix}-${Date.now()}-${fallbackId}`;
}

export function createEmptyMobileSlot(index?: number): MobileTimelineSlot {
  return {
    id: index === undefined ? createMobileId('mobile-slot') : `mobile-slot-${index + 1}`,
    action: null,
  };
}

export function createDefaultMobileOperatorConfig(character: Character): MobileOperatorConfig {
  return {
    characterId: character.id,
    level: 90,
    potential: '0潜',
    favorValue: 60,
    mainStatFlatBonus: 60,
    subStatFlatBonus: 0,
    skillLevels: { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' },
    weapon: {
      weaponId: '',
      level: 90,
      potential: '0潜',
      skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
    },
    equipment: Object.fromEntries(
      MOBILE_EQUIPMENT_SLOT_KEYS.map((slotKey) => [
        slotKey,
        { equipmentId: '', effectLevels: {} },
      ]),
    ) as MobileOperatorConfig['equipment'],
  };
}

export function createEmptyMobileDraft(now = Date.now()): MobileDraft {
  return {
    schemaVersion: MOBILE_DRAFT_SCHEMA_VERSION,
    selectedOperatorIds: [],
    operatorConfigs: {},
    slots: Array.from({ length: MOBILE_INITIAL_SLOT_COUNT }, (_, index) => createEmptyMobileSlot(index)),
    activePage: 'selection',
    activeOperatorId: '',
    updatedAt: now,
  };
}

function isMobilePageId(value: unknown): value is MobilePageId {
  return typeof value === 'string' && MOBILE_PAGE_IDS.includes(value as MobilePageId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )),
  );
}

function normalizeNestedNumberMap(value: unknown): Record<string, Record<string, number>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, counts]) => [key, normalizeNumberMap(counts)]),
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function normalizeAction(value: unknown): MobileTimelineAction | null {
  if (!isRecord(value)) return null;
  const skillType = typeof value.skillType === 'string'
    && ['A', 'B', 'E', 'Q', 'Dot'].includes(value.skillType)
    ? value.skillType as MobileTimelineAction['skillType']
    : null;
  if (
    typeof value.id !== 'string'
    || typeof value.operatorId !== 'string'
    || !value.id
    || !value.operatorId
    || !skillType
  ) return null;
  const disabledBuffIdsByHitKey = isRecord(value.disabledBuffIdsByHitKey)
    ? Object.fromEntries(
        Object.entries(value.disabledBuffIdsByHitKey)
          .map(([key, ids]) => [key, normalizeStringArray(ids)]),
      )
    : {};
  const resistanceKeys = new Set<keyof HitResistanceInput>([
    'physicalResistance',
    'fireResistance',
    'electricResistance',
    'iceResistance',
    'natureResistance',
  ]);
  const targetResistance = isRecord(value.targetResistance)
    ? Object.fromEntries(
        Object.entries(value.targetResistance).filter((entry): entry is [keyof HitResistanceInput, number] => (
          resistanceKeys.has(entry[0] as keyof HitResistanceInput)
          && typeof entry[1] === 'number'
          && Number.isFinite(entry[1])
        )),
      ) as HitResistanceInput
    : {};
  return {
    id: value.id,
    operatorId: value.operatorId,
    skillType,
    runtimeSkillId: typeof value.runtimeSkillId === 'string' ? value.runtimeSkillId : '',
    skillName: typeof value.skillName === 'string' ? value.skillName : skillType,
    ...(typeof value.skillIconUrl === 'string' ? { skillIconUrl: value.skillIconUrl } : {}),
    buffs: Array.isArray(value.buffs)
      ? value.buffs.filter((buff): buff is SkillButtonBuff => (
          isRecord(buff) && typeof buff.id === 'string'
        ))
      : [],
    buffStackCounts: normalizeNumberMap(value.buffStackCounts),
    buffStackCountsByHitKey: normalizeNestedNumberMap(value.buffStackCountsByHitKey),
    globallyDisabledBuffIds: normalizeStringArray(value.globallyDisabledBuffIds),
    disabledBuffIdsByHitKey,
    disabledHitKeys: normalizeStringArray(value.disabledHitKeys),
    targetResistance,
  };
}

export function normalizeMobileDraft(raw: unknown, now = Date.now()): MobileDraft {
  const fallback = createEmptyMobileDraft(now);
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<MobileDraft>;
  if (candidate.schemaVersion !== MOBILE_DRAFT_SCHEMA_VERSION) return fallback;

  const selectedOperatorIds = Array.isArray(candidate.selectedOperatorIds)
    ? candidate.selectedOperatorIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(0, 4)
    : [];
  const slots = Array.isArray(candidate.slots)
    ? candidate.slots
      .filter((slot): slot is MobileTimelineSlot => Boolean(slot && typeof slot.id === 'string'))
      .map((slot) => ({ id: slot.id, action: normalizeAction(slot.action) }))
    : [];
  while (slots.length < MOBILE_INITIAL_SLOT_COUNT) {
    slots.push(createEmptyMobileSlot(slots.length));
  }
  const operatorConfigs = candidate.operatorConfigs && typeof candidate.operatorConfigs === 'object'
    ? candidate.operatorConfigs
    : {};
  const activeOperatorId = selectedOperatorIds.includes(candidate.activeOperatorId || '')
    ? candidate.activeOperatorId || ''
    : selectedOperatorIds[0] || '';

  return {
    schemaVersion: MOBILE_DRAFT_SCHEMA_VERSION,
    selectedOperatorIds,
    operatorConfigs,
    slots,
    activePage: isMobilePageId(candidate.activePage) ? candidate.activePage : 'selection',
    activeOperatorId,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : now,
  };
}

export function readMobileDraft(): MobileDraft {
  if (typeof window === 'undefined') return createEmptyMobileDraft();
  try {
    const raw = window.localStorage.getItem(MOBILE_DRAFT_STORAGE_KEY);
    return raw ? normalizeMobileDraft(JSON.parse(raw)) : createEmptyMobileDraft();
  } catch {
    return createEmptyMobileDraft();
  }
}

export function writeMobileDraft(draft: MobileDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      MOBILE_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, updatedAt: Date.now() }),
    );
  } catch {
    // Mobile workbench remains usable in memory when browser storage is unavailable.
  }
}
