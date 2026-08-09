import type { Character } from '../types';
import {
  MOBILE_DRAFT_SCHEMA_VERSION,
  MOBILE_EQUIPMENT_SLOT_KEYS,
  MOBILE_INITIAL_SLOT_COUNT,
  MOBILE_PAGE_IDS,
  type MobileDraft,
  type MobileOperatorConfig,
  type MobilePageId,
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
      skillLevels: { skill1: 1, skill2: 1, skill3: 1 },
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
      .map((slot) => ({ id: slot.id, action: slot.action ?? null }))
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
