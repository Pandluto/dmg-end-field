import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';

export const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
export const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';

const EQUIPMENT_PARTS = ['护甲', '护手', '配件'] as const;
const EFFECT_IDS = ['effect1', 'effect2', 'effect3'] as const;
const LEVEL_KEYS = ['0', '1', '2', '3'] as const;
const FIXED_STAT_TYPES = ['defense', 'hp', 'flatAtk'] as const;
const UNITS = ['flat', 'percent'] as const;
const EFFECT_CATEGORIES = ['ability', 'buff'] as const;
const THREE_PIECE_CATEGORIES = ['positive', 'condition', ''] as const;
const SUPPORTED_EQUIPMENT_EFFECT_TYPES = [
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'mainStatBoost',
  'subStatBoost',
  'atkPercentBoost',
  'hpPercent',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allDmgBonus',
  'fireNatureDmgBonus',
  'iceElectricDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'allSkillDmgBonus',
  'physicalFragile',
  'fireFragile',
  'electricFragile',
  'iceFragile',
  'natureFragile',
  'magicFragile',
  'physicalVulnerability',
  'fireVulnerability',
  'electricVulnerability',
  'iceVulnerability',
  'natureVulnerability',
  'magicVulnerability',
  'imbalanceDmgBonus',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'damageReduction',
  'defense',
  'hp',
  'flatAtk',
];

type EquipmentPart = (typeof EQUIPMENT_PARTS)[number];
type EquipmentEffectId = (typeof EFFECT_IDS)[number];
type EquipmentLevelKey = (typeof LEVEL_KEYS)[number];
type EquipmentFixedTypeKey = (typeof FIXED_STAT_TYPES)[number];
type EquipmentUnit = (typeof UNITS)[number];
type EquipmentEffectCategory = (typeof EFFECT_CATEGORIES)[number];

interface EquipmentFixedStat {
  label: string;
  typeKey: EquipmentFixedTypeKey;
  value: number;
  unit: EquipmentUnit;
  raw?: string;
}

interface EquipmentEffect {
  effectId: EquipmentEffectId;
  label: string;
  typeKey: string;
  category: EquipmentEffectCategory;
  levels: Partial<Record<EquipmentLevelKey, number>>;
  unit: EquipmentUnit;
  raw?: string;
}

interface EquipmentThreePieceBuff {
  effectId: string;
  name: string;
  category: 'positive' | 'condition' | '';
  typeKey: string;
  value: number;
  unit: EquipmentUnit;
  raw?: string;
}

interface EquipmentItem {
  equipmentId: string;
  name: string;
  part: EquipmentPart;
  imgUrl?: string;
  fixedStat?: EquipmentFixedStat;
  effects: Partial<Record<EquipmentEffectId, EquipmentEffect>>;
}

interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  buffId?: string;
  imgUrl?: string;
  threePieceBuff?: EquipmentThreePieceBuff;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuff>;
  equipments: Record<string, EquipmentItem>;
}

export interface EquipmentLibrary {
  updatedAt?: string;
  migration?: {
    source?: string;
    migratedAt?: string;
    warnings?: string[];
    reviewRequired?: boolean;
  };
  gearSets: Record<string, EquipmentGearSet>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emptyEquipmentLibrary(): EquipmentLibrary {
  return { updatedAt: '', gearSets: {} };
}

export function readCurrentEquipmentLibrary(): EquipmentLibrary {
  return readJsonStorage<EquipmentLibrary>(EQUIPMENT_DRAFT_STORAGE_KEY, emptyEquipmentLibrary());
}

export function readEquipmentLibrary(): EquipmentLibrary {
  return readJsonStorage<EquipmentLibrary>(EQUIPMENT_LIBRARY_STORAGE_KEY, emptyEquipmentLibrary());
}

export function formatEquipmentLibrarySummary(library = readEquipmentLibrary()) {
  return Object.values(library.gearSets || {})
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
    .map((gearSet) => ({
      id: gearSet.gearSetId,
      name: gearSet.name,
      equipments: Object.keys(gearSet.equipments || {}).length,
      effects: Object.values(gearSet.equipments || {}).reduce((sum, item) => sum + Object.keys(item.effects || {}).length, 0),
    }));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function preserveExistingImageUrls(nextPayload: EquipmentLibrary, currentLibrary?: EquipmentLibrary): EquipmentLibrary {
  const next = JSON.parse(JSON.stringify(nextPayload)) as EquipmentLibrary;
  const currentGearSets = currentLibrary?.gearSets || {};

  for (const [gearSetKey, nextSet] of Object.entries(next.gearSets || {})) {
    const currentSet = currentGearSets[gearSetKey] || currentGearSets[nextSet.gearSetId];
    if (currentSet && nextSet.gearSetId === currentSet.gearSetId && hasText(currentSet.imgUrl)) {
      nextSet.imgUrl = currentSet.imgUrl;
    }

    for (const [equipmentKey, nextEquipment] of Object.entries(nextSet.equipments || {})) {
      const currentEquipment = currentSet?.equipments?.[equipmentKey] || currentSet?.equipments?.[nextEquipment.equipmentId];
      if (currentEquipment && nextEquipment.equipmentId === currentEquipment.equipmentId && hasText(currentEquipment.imgUrl)) {
        nextEquipment.imgUrl = currentEquipment.imgUrl;
      }
    }
  }

  return next;
}

function parseJsonPayload(rawPayload: unknown) {
  if (typeof rawPayload !== 'string') {
    return { value: null, errors: ['payload must be string'] };
  }
  try {
    const parsed = JSON.parse(rawPayload.trim()) as Record<string, unknown>;
    return { value: isRecord(parsed.draft) ? parsed.draft : parsed, errors: [] };
  } catch (error) {
    return { value: null, errors: [`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function validateEquipmentLibraryShape(raw: unknown): AgentFillValidationResult<EquipmentLibrary> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['root must be object'] };
  if (!isRecord(raw.gearSets)) errors.push('gearSets must be object');
  if (isRecord(raw.gearSets)) {
    for (const [gearSetKey, rawSet] of Object.entries(raw.gearSets)) {
      if (!isRecord(rawSet)) {
        errors.push(`gearSets.${gearSetKey} must be object`);
        continue;
      }
      if (typeof rawSet.gearSetId !== 'string' || !rawSet.gearSetId.trim()) errors.push(`gearSets.${gearSetKey}.gearSetId must be non-empty string`);
      if (typeof rawSet.name !== 'string' || !rawSet.name.trim()) errors.push(`gearSets.${gearSetKey}.name must be non-empty string`);
      if (!isRecord(rawSet.equipments)) errors.push(`gearSets.${gearSetKey}.equipments must be object`);
      if (isRecord(rawSet.threePieceBuff)) validateThreePieceBuff(rawSet.threePieceBuff, `gearSets.${gearSetKey}.threePieceBuff`, errors);
      if (rawSet.threePieceBuffs !== undefined && !isRecord(rawSet.threePieceBuffs)) {
        errors.push(`gearSets.${gearSetKey}.threePieceBuffs must be object`);
      } else if (isRecord(rawSet.threePieceBuffs)) {
        for (const [buffKey, rawBuff] of Object.entries(rawSet.threePieceBuffs)) {
          if (!isRecord(rawBuff)) {
            errors.push(`gearSets.${gearSetKey}.threePieceBuffs.${buffKey} must be object`);
          } else {
            validateThreePieceBuff(rawBuff, `gearSets.${gearSetKey}.threePieceBuffs.${buffKey}`, errors);
          }
        }
      }
      if (isRecord(rawSet.equipments)) {
        for (const [equipmentKey, rawEquipment] of Object.entries(rawSet.equipments)) {
          validateEquipmentItem(rawEquipment, `gearSets.${gearSetKey}.equipments.${equipmentKey}`, errors);
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], normalized: normalizeEquipmentLibrary(raw) };
}

function validateNoGearSetShrink(payload: EquipmentLibrary, errors: string[]) {
  const nextCount = Object.keys(payload.gearSets || {}).length;
  const currentCount = Object.keys(readCurrentEquipmentLibrary().gearSets || {}).length;
  const savedCount = Object.keys(readEquipmentLibrary().gearSets || {}).length;
  const baselineCount = Math.max(currentCount, savedCount);
  if (baselineCount > 0 && nextCount < baselineCount) {
    errors.push(
      `equipment.fill.apply rejected partial gearSets: payload=${nextCount}, current=${currentCount}, saved=${savedCount}. Use equipment.setBuff for single gear set buff updates.`,
    );
  }
}

function validateThreePieceBuff(raw: Record<string, unknown>, path: string, errors: string[]) {
  if (typeof raw.effectId !== 'string') errors.push(`${path}.effectId must be string`);
  if (typeof raw.name !== 'string') errors.push(`${path}.name must be string`);
  if (typeof raw.category !== 'string' || !THREE_PIECE_CATEGORIES.includes(raw.category as never)) errors.push(`${path}.category must be positive/condition/empty`);
  if (typeof raw.typeKey !== 'string') errors.push(`${path}.typeKey must be string`);
  if (raw.typeKey && !SUPPORTED_EQUIPMENT_EFFECT_TYPES.includes(String(raw.typeKey))) errors.push(`${path}.typeKey unsupported: ${String(raw.typeKey)}`);
  if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) errors.push(`${path}.value must be number`);
  if (typeof raw.unit !== 'string' || !UNITS.includes(raw.unit as never)) errors.push(`${path}.unit must be flat/percent`);
}

function validateEquipmentItem(raw: unknown, path: string, errors: string[]) {
  if (!isRecord(raw)) {
    errors.push(`${path} must be object`);
    return;
  }
  if (typeof raw.equipmentId !== 'string' || !raw.equipmentId.trim()) errors.push(`${path}.equipmentId must be non-empty string`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push(`${path}.name must be non-empty string`);
  if (typeof raw.part !== 'string' || !EQUIPMENT_PARTS.includes(raw.part as never)) errors.push(`${path}.part must be ${EQUIPMENT_PARTS.join('/')}`);
  if (raw.fixedStat !== undefined) {
    if (!isRecord(raw.fixedStat)) {
      errors.push(`${path}.fixedStat must be object`);
    } else {
      if (typeof raw.fixedStat.typeKey !== 'string' || !FIXED_STAT_TYPES.includes(raw.fixedStat.typeKey as never)) errors.push(`${path}.fixedStat.typeKey must be ${FIXED_STAT_TYPES.join('/')}`);
      if (typeof raw.fixedStat.value !== 'number' || !Number.isFinite(raw.fixedStat.value)) errors.push(`${path}.fixedStat.value must be number`);
      if (typeof raw.fixedStat.unit !== 'string' || !UNITS.includes(raw.fixedStat.unit as never)) errors.push(`${path}.fixedStat.unit must be flat/percent`);
    }
  }
  if (!isRecord(raw.effects)) errors.push(`${path}.effects must be object`);
  if (isRecord(raw.effects)) {
    for (const [effectKey, rawEffect] of Object.entries(raw.effects)) {
      if (!EFFECT_IDS.includes(effectKey as never)) errors.push(`${path}.effects.${effectKey} invalid effect slot`);
      if (!isRecord(rawEffect)) {
        errors.push(`${path}.effects.${effectKey} must be object`);
        continue;
      }
      if (typeof rawEffect.effectId !== 'string' || !EFFECT_IDS.includes(rawEffect.effectId as never)) errors.push(`${path}.effects.${effectKey}.effectId must be effect1/effect2/effect3`);
      if (typeof rawEffect.typeKey !== 'string') errors.push(`${path}.effects.${effectKey}.typeKey must be string`);
      if (rawEffect.typeKey && !SUPPORTED_EQUIPMENT_EFFECT_TYPES.includes(String(rawEffect.typeKey))) errors.push(`${path}.effects.${effectKey}.typeKey unsupported: ${String(rawEffect.typeKey)}`);
      if (typeof rawEffect.category !== 'string' || !EFFECT_CATEGORIES.includes(rawEffect.category as never)) errors.push(`${path}.effects.${effectKey}.category must be ability/buff`);
      if (typeof rawEffect.unit !== 'string' || !UNITS.includes(rawEffect.unit as never)) errors.push(`${path}.effects.${effectKey}.unit must be flat/percent`);
      if (!isRecord(rawEffect.levels)) errors.push(`${path}.effects.${effectKey}.levels must be object`);
      if (isRecord(rawEffect.levels)) {
        for (const [levelKey, levelValue] of Object.entries(rawEffect.levels)) {
          if (!LEVEL_KEYS.includes(levelKey as never)) errors.push(`${path}.effects.${effectKey}.levels.${levelKey} invalid level key`);
          if (typeof levelValue !== 'number' || !Number.isFinite(levelValue)) errors.push(`${path}.effects.${effectKey}.levels.${levelKey} must be number`);
        }
      }
    }
  }
}

function normalizeEquipmentLibrary(raw: Record<string, unknown>): EquipmentLibrary {
  const sourceGearSets = raw.gearSets as Record<string, Record<string, unknown>>;
  const gearSets: Record<string, EquipmentGearSet> = {};
  for (const [fallbackSetId, rawSet] of Object.entries(sourceGearSets)) {
    const gearSetId = String(rawSet.gearSetId || fallbackSetId);
    const equipments: Record<string, EquipmentItem> = {};
    for (const [fallbackEquipmentId, rawEquipment] of Object.entries((rawSet.equipments || {}) as Record<string, Record<string, unknown>>)) {
      const equipmentId = String(rawEquipment.equipmentId || fallbackEquipmentId);
      const effects: Partial<Record<EquipmentEffectId, EquipmentEffect>> = {};
      for (const [effectId, rawEffect] of Object.entries((rawEquipment.effects || {}) as Record<string, Record<string, unknown>>)) {
        if (!EFFECT_IDS.includes(effectId as never)) continue;
        effects[effectId as EquipmentEffectId] = {
          effectId: rawEffect.effectId as EquipmentEffectId,
          label: String(rawEffect.label || effectId),
          typeKey: String(rawEffect.typeKey || ''),
          category: rawEffect.category as EquipmentEffectCategory,
          levels: rawEffect.levels as Partial<Record<EquipmentLevelKey, number>>,
          unit: rawEffect.unit as EquipmentUnit,
          raw: typeof rawEffect.raw === 'string' ? rawEffect.raw : '',
        };
      }
      equipments[equipmentId] = {
        equipmentId,
        name: String(rawEquipment.name || equipmentId),
        part: rawEquipment.part as EquipmentPart,
        imgUrl: typeof rawEquipment.imgUrl === 'string' ? rawEquipment.imgUrl : '',
        fixedStat: isRecord(rawEquipment.fixedStat) ? rawEquipment.fixedStat as unknown as EquipmentFixedStat : undefined,
        effects,
      };
    }
    gearSets[gearSetId] = {
      gearSetId,
      name: String(rawSet.name || gearSetId),
      buffId: typeof rawSet.buffId === 'string' ? rawSet.buffId : '',
      imgUrl: typeof rawSet.imgUrl === 'string' ? rawSet.imgUrl : '',
      threePieceBuff: isRecord(rawSet.threePieceBuff) ? rawSet.threePieceBuff as unknown as EquipmentThreePieceBuff : undefined,
      threePieceBuffs: isRecord(rawSet.threePieceBuffs) ? rawSet.threePieceBuffs as unknown as Record<string, EquipmentThreePieceBuff> : undefined,
      equipments,
    };
  }
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    gearSets,
  };
}

export const equipmentFillAdapter: AgentFillDomainAdapter<EquipmentLibrary> = {
  domain: 'equipment',
  workflow: 'equipment.fill',
  commandPrefix: 'equipment.fill',
  draftStorageKey: EQUIPMENT_DRAFT_STORAGE_KEY,
  libraryStorageKey: EQUIPMENT_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,

  validateAiDraft(rawPayload): AgentFillValidationResult<EquipmentLibrary> {
    const parsed = parseJsonPayload(rawPayload);
    if (!parsed.value) return { ok: false, errors: parsed.errors };
    const validation = validateEquipmentLibraryShape(parsed.value);
    if (!validation.ok || !validation.normalized) return validation;
    const errors: string[] = [];
    validateNoGearSetShrink(validation.normalized, errors);
    return errors.length ? { ok: false, errors } : validation;
  },

  validateProposalPayload(payload): AgentFillValidationResult<EquipmentLibrary> {
    const validation = validateEquipmentLibraryShape(payload);
    if (!validation.ok || !validation.normalized) return validation;
    const errors: string[] = [];
    validateNoGearSetShrink(validation.normalized, errors);
    return errors.length ? { ok: false, errors } : validation;
  },

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<EquipmentLibrary> {
    const draft = validation.normalized!;
    return {
      rawCommand,
      normalized: draft,
      summary: equipmentFillAdapter.summarizeProposal(draft),
    };
  },

  summarizeProposal(payload): string {
    const gearSetCount = Object.keys(payload.gearSets || {}).length;
    const equipmentCount = Object.values(payload.gearSets || {}).reduce((sum, set) => sum + Object.keys(set.equipments || {}).length, 0);
    return `equipment fill: gearSets=${gearSetCount} equipments=${equipmentCount}`;
  },

  getProposalTargetId(payload): string {
    return Object.keys(payload.gearSets || {}).sort().join('|');
  },

  buildTaskPackage() {
    const draft = readCurrentEquipmentLibrary();
    return {
      lines: [`[info] equipment.fill.task ready: gearSets=${Object.keys(draft.gearSets || {}).length}`],
      data: {
        tool: 'equipment.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        equipmentFillAiDraftSchema: {
          gearSets: 'Record<string, { gearSetId, name, equipments }>',
          part: EQUIPMENT_PARTS,
          fixedStatTypeKey: FIXED_STAT_TYPES,
          effectSlots: EFFECT_IDS,
          levelKeys: LEVEL_KEYS,
          category: EFFECT_CATEGORIES,
          unit: UNITS,
        },
        supportedEffectTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,
        storageBoundary: {
          workingDraft: EQUIPMENT_DRAFT_STORAGE_KEY,
          savedTruth: EQUIPMENT_LIBRARY_STORAGE_KEY,
        },
        instruction: 'Return exactly one full EquipmentFillAiDraft JSON object for equipment.fill.apply. No Markdown. No explanation. Do not submit only one gearSet through equipment.fill.apply; use equipment.setBuff for single gear set threePieceBuff updates. Use app-provided source data outside Agent CLI when needed. equipment.fill.apply creates a proposal only.',
        approvalSaveWarning: 'Approval applies to def.equipment-sheet.draft.v1. Save writes def.equipment-sheet.library.v1.',
      },
    };
  },

  applyToWorkingState(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(EQUIPMENT_DRAFT_STORAGE_KEY, preserveExistingImageUrls(payload, readCurrentEquipmentLibrary()));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(EQUIPMENT_LIBRARY_STORAGE_KEY, preserveExistingImageUrls(payload, readEquipmentLibrary()));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
