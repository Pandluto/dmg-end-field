import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import { normalizeExtraHitConfig, validateExtraHitConfig } from '../core/services/buffExtraHit';
import { createLegacyFillDomainCore, createLegacyFillProposalPayload, createLegacyFillSchemaTemplate } from '../legacyFillCore';

export const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
export const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';

const EQUIPMENT_PARTS = ['护甲', '护手', '配件'] as const;
const EFFECT_IDS = ['effect1', 'effect2', 'effect3'] as const;
const LEVEL_KEYS = ['0', '1', '2', '3'] as const;
const FIXED_STAT_TYPES = ['defense', 'hp', 'flatAtk'] as const;
const UNITS = ['flat', 'percent'] as const;
const EFFECT_CATEGORIES = ['ability', 'buff'] as const;
const THREE_PIECE_CATEGORIES = ['positive', 'passive', 'condition', 'countable', ''] as const;
const NON_DECIMAL_EQUIPMENT_EFFECT_TYPE_KEYS = new Set([
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'flatAtk',
  'mainStat',
  'subStat',
  'sourceSkillBoost',
]);
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

function normalizeLegacyEquipmentPercentValue(typeKey: string, unit: EquipmentUnit | string | undefined, value: number, raw?: unknown): number {
  if (unit !== 'percent' || NON_DECIMAL_EQUIPMENT_EFFECT_TYPE_KEYS.has(typeKey)) return value;
  const rawText = String(raw || '');
  if (!rawText.includes('%')) return value;
  const rawNumbers = (rawText.match(/[+-]?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
  const matchesStoredDecimal = rawNumbers.some((rawNumber) => Math.abs(value - rawNumber / 100) < 1e-4);
  if (matchesStoredDecimal) return value;
  const matchesLegacyPercent = rawNumbers.some((rawNumber) => Math.abs(value - rawNumber) < 1e-6);
  if (matchesLegacyPercent) return value / 100;
  if (Math.abs(value) > 1) return value / 100;
  return value;
}

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
  category: 'positive' | 'passive' | 'condition' | 'countable' | '';
  typeKey: string;
  value: number;
  unit: EquipmentUnit;
  raw?: string;
  maxStacks?: number;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
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

function readEquipmentMergeBaseline(): EquipmentLibrary {
  return mergeEquipmentLibraryPatch(readEquipmentLibrary(), readCurrentEquipmentLibrary());
}

function mergeEquipmentLibraryPatch(baseLibrary: EquipmentLibrary, patch: EquipmentLibrary): EquipmentLibrary {
  const base = JSON.parse(JSON.stringify(baseLibrary)) as EquipmentLibrary;
  const nextGearSets = { ...(base.gearSets || {}) };

  for (const [patchKey, patchSet] of Object.entries(patch.gearSets || {})) {
    const existingEntry = Object.entries(nextGearSets).find(([key, gearSet]) => (
      key === patchKey || key === patchSet.gearSetId || gearSet.gearSetId === patchSet.gearSetId
    ));
    if (existingEntry && existingEntry[0] !== patchSet.gearSetId) {
      delete nextGearSets[existingEntry[0]];
    }
    nextGearSets[patchSet.gearSetId || patchKey] = patchSet;
  }

  return preserveExistingImageUrls({
    ...base,
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString(),
    migration: patch.migration ?? base.migration,
    gearSets: nextGearSets,
  }, baseLibrary);
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

function validateThreePieceBuff(raw: Record<string, unknown>, path: string, errors: string[]) {
  const effectKind = raw.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  if (typeof raw.effectId !== 'string') errors.push(`${path}.effectId must be string`);
  if (typeof raw.name !== 'string') errors.push(`${path}.name must be string`);
  if (typeof raw.category !== 'string' || !THREE_PIECE_CATEGORIES.includes(raw.category as never)) errors.push(`${path}.category must be positive/passive/condition/countable/empty`);
  if (effectKind === 'modifier' && typeof raw.typeKey !== 'string') errors.push(`${path}.typeKey must be string`);
  if (effectKind === 'modifier' && raw.typeKey && !SUPPORTED_EQUIPMENT_EFFECT_TYPES.includes(String(raw.typeKey))) errors.push(`${path}.typeKey unsupported: ${String(raw.typeKey)}`);
  if (effectKind === 'modifier' && (typeof raw.value !== 'number' || !Number.isFinite(raw.value))) errors.push(`${path}.value must be number`);
  if (typeof raw.unit !== 'string' || !UNITS.includes(raw.unit as never)) errors.push(`${path}.unit must be flat/percent`);
  if (effectKind === 'extraHit') {
    if (raw.category !== 'passive' && raw.category !== 'countable') errors.push(`${path}.category must be passive or countable for extraHit`);
    validateExtraHitConfig(raw.extraHitConfig, `${path}.extraHitConfig`, errors);
  }
  if (raw.category === 'countable' && (typeof raw.maxStacks !== 'number' || !Number.isFinite(raw.maxStacks) || raw.maxStacks <= 0)) {
    errors.push(`${path}.maxStacks must be positive number for countable`);
  }
}

function normalizeThreePieceBuff(raw: Record<string, unknown>, fallbackKey: string): EquipmentThreePieceBuff {
  const effectKind: BuffEffectKind = raw.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const typeKey = effectKind === 'extraHit' ? '' : String(raw.typeKey || '');
  const unit = raw.unit as EquipmentUnit;
  const rawValue = Number(raw.value || 0);
  return {
    effectId: String(raw.effectId || fallbackKey),
    name: String(raw.name || fallbackKey),
    category: raw.category as EquipmentThreePieceBuff['category'],
    typeKey,
    value: effectKind === 'extraHit' ? 0 : normalizeLegacyEquipmentPercentValue(typeKey, unit, rawValue, raw.raw),
    unit,
    raw: typeof raw.raw === 'string' ? raw.raw : '',
    ...(raw.category === 'countable' && typeof raw.maxStacks === 'number'
      ? { maxStacks: Math.max(1, Math.floor(raw.maxStacks)) }
      : {}),
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(raw.extraHitConfig, `${fallbackKey}-extra-hit`) }
      : {}),
  };
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
        const typeKey = String(rawEffect.typeKey || '');
        const unit = rawEffect.unit as EquipmentUnit;
        const levels = Object.fromEntries(Object.entries((rawEffect.levels || {}) as Record<string, unknown>).flatMap(([levelKey, levelValue]) => {
          const parsed = typeof levelValue === 'number' && Number.isFinite(levelValue) ? levelValue : Number(levelValue);
          return Number.isFinite(parsed)
            ? [[levelKey, normalizeLegacyEquipmentPercentValue(typeKey, unit, parsed, rawEffect.raw)]]
            : [];
        })) as Partial<Record<EquipmentLevelKey, number>>;
        effects[effectId as EquipmentEffectId] = {
          effectId: rawEffect.effectId as EquipmentEffectId,
          label: String(rawEffect.label || effectId),
          typeKey,
          category: rawEffect.category as EquipmentEffectCategory,
          levels,
          unit,
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
      threePieceBuff: isRecord(rawSet.threePieceBuff) ? normalizeThreePieceBuff(rawSet.threePieceBuff, `${gearSetId}-three-piece`) : undefined,
      threePieceBuffs: isRecord(rawSet.threePieceBuffs)
        ? Object.fromEntries(Object.entries(rawSet.threePieceBuffs).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])).map(([key, buff]) => [key, normalizeThreePieceBuff(buff, key)]))
        : undefined,
      equipments,
    };
  }
  return {
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    gearSets,
  };
}

export const equipmentFillDomainCore = createLegacyFillDomainCore<EquipmentLibrary>({
  domain: 'equipment',
  schemaVersion: 1,
  schema: () => createLegacyFillSchemaTemplate({
    domain: 'equipment',
    schemaVersion: 1,
    payloadSchema: { formatName: 'EquipmentFillAiDraft', gearSets: 'record' },
  }),
  normalize(candidate) {
    const validation = validateEquipmentLibraryShape(candidate);
    if (!validation.ok || !validation.normalized) throw new TypeError(validation.errors.join('; '));
    return validation.normalized;
  },
  validate: validateEquipmentLibraryShape,
  summarize(payload) {
    const gearSetCount = Object.keys(payload.gearSets || {}).length;
    const equipmentCount = Object.values(payload.gearSets || {}).reduce((sum, set) => sum + Object.keys(set.equipments || {}).length, 0);
    return `equipment fill: gearSets=${gearSetCount} equipments=${equipmentCount}`;
  },
  targetId: (payload) => Object.keys(payload.gearSets || {}).sort().join('|'),
});

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
    return validateEquipmentLibraryShape(parsed.value);
  },

  validateProposalPayload(payload): AgentFillValidationResult<EquipmentLibrary> {
    return equipmentFillDomainCore.validate(payload);
  },

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<EquipmentLibrary> {
    const draft = mergeEquipmentLibraryPatch(readEquipmentMergeBaseline(), validation.normalized!);
    return createLegacyFillProposalPayload({
      rawCommand,
      normalized: draft,
      summary: equipmentFillAdapter.summarizeProposal(draft),
    });
  },

  summarizeProposal(payload): string {
    return equipmentFillDomainCore.summarize(payload);
  },

  getProposalTargetId(payload): string {
    return equipmentFillDomainCore.targetId(payload);
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
          threePieceEffectKind: ['modifier', 'extraHit'],
          threePieceCategory: THREE_PIECE_CATEGORIES,
          extraHitConfig: '{ key, damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds, trigger }; skillType empty/A/B/E/Q/Dot (250%=2.5)',
        },
        supportedEffectTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,
        storageBoundary: {
          workingDraft: EQUIPMENT_DRAFT_STORAGE_KEY,
          savedTruth: EQUIPMENT_LIBRARY_STORAGE_KEY,
        },
        instruction: 'Return exactly one EquipmentFillAiDraft JSON object for equipment.fill.apply. No Markdown. No explanation. gearSets may contain only the gear sets being changed; omitted gear sets are preserved by incremental merge. Each submitted gear set must include its complete gearSetId/name/equipments structure. For an independent triggered damage instance in threePieceBuff/threePieceBuffs, set effectKind="extraHit", category="passive" or "countable", typeKey="", value=0, and provide extraHitConfig including skillType empty/A/B/E/Q/Dot. If category=countable, provide maxStacks; runtime creates one independent segment per active stack. Use equipment.setBuff for three-piece Buff-only updates. Use app-provided source data outside Agent CLI when needed. equipment.fill.apply creates a proposal only.',
        approvalSaveWarning: 'Approval applies to def.equipment-sheet.draft.v1. Save writes def.equipment-sheet.library.v1.',
      },
    };
  },

  applyToWorkingState(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(EQUIPMENT_DRAFT_STORAGE_KEY, mergeEquipmentLibraryPatch(readEquipmentMergeBaseline(), payload));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload): { ok: boolean; error?: string } {
    try {
      const nextLibrary = mergeEquipmentLibraryPatch(readEquipmentLibrary(), payload);
      writeJsonStorage(EQUIPMENT_LIBRARY_STORAGE_KEY, nextLibrary);
      writeJsonStorage(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
