import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../../core/domain/buff';
import { normalizeBuffMultiplier, validateBuffMultiplierDefinition } from '../../core/domain/buffMultiplier';
import {
  normalizeExtraHitCategory,
  normalizeExtraHitConfig,
  validateExtraHitConfig,
} from '../../core/services/buffExtraHit';
import {
  createLegacyFillDomainCore,
  createLegacyFillSchemaTemplate,
  type LegacyFillValidationResult,
} from '..';
import {
  mergeEquipmentLibraryPatchValue,
  preserveExistingEquipmentImageUrlsValue,
} from '../preserveAssets';

export const EQUIPMENT_PARTS = ['护甲', '护手', '配件'] as const;
export const EQUIPMENT_EFFECT_IDS = ['effect1', 'effect2', 'effect3'] as const;
export const EQUIPMENT_LEVEL_KEYS = ['0', '1', '2', '3'] as const;
export const EQUIPMENT_FIXED_STAT_TYPES = ['defense', 'hp', 'flatAtk'] as const;
export const EQUIPMENT_UNITS = ['flat', 'percent'] as const;
export const EQUIPMENT_EFFECT_CATEGORIES = ['ability', 'buff'] as const;
export const EQUIPMENT_THREE_PIECE_CATEGORIES = ['positive', 'passive', 'condition', 'countable', ''] as const;
export const EQUIPMENT_BUFF_VALUE_MODES = ['fixed', 'derived'] as const;
export const EQUIPMENT_BUFF_DERIVED_SOURCES = ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] as const;
const EFFECT_IDS = EQUIPMENT_EFFECT_IDS;
const LEVEL_KEYS = EQUIPMENT_LEVEL_KEYS;
const FIXED_STAT_TYPES = EQUIPMENT_FIXED_STAT_TYPES;
const UNITS = EQUIPMENT_UNITS;
const EFFECT_CATEGORIES = EQUIPMENT_EFFECT_CATEGORIES;
const THREE_PIECE_CATEGORIES = EQUIPMENT_THREE_PIECE_CATEGORIES;
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
export const SUPPORTED_EQUIPMENT_EFFECT_TYPES = [
  'atk',
  'mainStat',
  'subStat',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
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
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'allCorrosion',
  'physicalCorrosion',
  'magicCorrosion',
  'fireCorrosion',
  'electricCorrosion',
  'iceCorrosion',
  'natureCorrosion',
  'allResistanceIgnore',
  'physicalResistanceIgnore',
  'magicResistanceIgnore',
  'fireResistanceIgnore',
  'electricResistanceIgnore',
  'iceResistanceIgnore',
  'natureResistanceIgnore',
  'comboDamageBonus',
  'multiplierBonus',
  'multiplierMultiplier',
  'imbalanceDmgBonus',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
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
type EquipmentBuffValueMode = (typeof EQUIPMENT_BUFF_VALUE_MODES)[number];
type EquipmentBuffDerivedSource = (typeof EQUIPMENT_BUFF_DERIVED_SOURCES)[number];

interface EquipmentBuffDerivedValue {
  source: EquipmentBuffDerivedSource;
  perPointValue: number;
}

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
  schemaVersion?: 2;
  effectId: string;
  name: string;
  category: 'positive' | 'passive' | 'condition' | 'countable' | '';
  type?: string;
  typeKey: string;
  value: number;
  unit: EquipmentUnit;
  condition?: string;
  description?: string;
  raw?: string;
  valueMode?: EquipmentBuffValueMode;
  derivedValue?: EquipmentBuffDerivedValue;
  maxStacks?: number;
  multiplier?: BuffMultiplier;
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
  schemaVersion?: 2;
  gearSetId: string;
  name: string;
  buffId?: string;
  imgUrl?: string;
  threePieceBuff?: EquipmentThreePieceBuff;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuff>;
  equipments: Record<string, EquipmentItem>;
}

export interface EquipmentLibrary {
  schemaVersion?: 2;
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

function normalizeEquipmentBuffType(raw: Record<string, unknown>): string {
  const type = String(raw.typeKey || raw.type || '');
  return type === 'multiplierMultiplier' ? 'multiplierBonus' : type;
}

function normalizeEquipmentDerivedValue(value: unknown): EquipmentBuffDerivedValue | undefined {
  if (!isRecord(value)) return undefined;
  const source = EQUIPMENT_BUFF_DERIVED_SOURCES.includes(value.source as EquipmentBuffDerivedSource)
    ? value.source as EquipmentBuffDerivedSource
    : undefined;
  const perPointValue = value.perPointValue ?? value.scale;
  return source && typeof perPointValue === 'number' && Number.isFinite(perPointValue)
    ? { source, perPointValue }
    : undefined;
}

export function emptyEquipmentLibrary(): EquipmentLibrary {
  return { updatedAt: '', gearSets: {} };
}

export function formatEquipmentLibrarySummary(library: EquipmentLibrary) {
  return Object.values(library.gearSets || {})
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
    .map((gearSet) => ({
      id: gearSet.gearSetId,
      name: gearSet.name,
      equipments: Object.keys(gearSet.equipments || {}).length,
      effects: Object.values(gearSet.equipments || {}).reduce((sum, item) => sum + Object.keys(item.effects || {}).length, 0),
    }));
}

export function preserveExistingEquipmentImageUrls(nextPayload: EquipmentLibrary, currentLibrary?: EquipmentLibrary): EquipmentLibrary {
  return preserveExistingEquipmentImageUrlsValue(nextPayload, currentLibrary);
}

export function mergeEquipmentLibraryPatch(baseLibrary: EquipmentLibrary, patch: EquipmentLibrary): EquipmentLibrary {
  return mergeEquipmentLibraryPatchValue(baseLibrary, patch);
}

export function parseEquipmentFillJsonPayload(rawPayload: unknown) {
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

export function validateEquipmentLibraryShape(raw: unknown): LegacyFillValidationResult<EquipmentLibrary> {
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
  const typeKey = normalizeEquipmentBuffType(raw);
  const rawCategory = raw.category === 'positive' || raw.category === '' ? 'passive' : raw.category;
  const isLegacySkillMultiplier = raw.typeKey === 'multiplierMultiplier' || raw.type === 'multiplierMultiplier';
  const legacyMultiplier = isLegacySkillMultiplier && typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value > 0
    ? { coefficient: raw.value }
    : undefined;
  const normalizedMultiplier = normalizeBuffMultiplier(raw.multiplier) ?? legacyMultiplier;
  if (typeof raw.effectId !== 'string') errors.push(`${path}.effectId must be string`);
  if (typeof raw.name !== 'string') errors.push(`${path}.name must be string`);
  if (typeof raw.category !== 'string' || !THREE_PIECE_CATEGORIES.includes(raw.category as never)) errors.push(`${path}.category must be positive/passive/condition/countable/empty`);
  if (effectKind === 'modifier' && typeof raw.typeKey !== 'string' && typeof raw.type !== 'string') errors.push(`${path}.typeKey must be string`);
  if (effectKind === 'modifier' && typeKey && !SUPPORTED_EQUIPMENT_EFFECT_TYPES.includes(typeKey)) errors.push(`${path}.typeKey unsupported: ${typeKey}`);
  if (effectKind === 'modifier' && !normalizedMultiplier && (typeof raw.value !== 'number' || !Number.isFinite(raw.value))) errors.push(`${path}.value must be number`);
  if (typeof raw.unit !== 'string' || !UNITS.includes(raw.unit as never)) errors.push(`${path}.unit must be flat/percent`);
  if (effectKind === 'extraHit') {
    if (raw.category !== 'condition' && raw.category !== 'countable') errors.push(`${path}.category must be condition or countable for extraHit`);
    validateExtraHitConfig(raw.extraHitConfig, `${path}.extraHitConfig`, errors);
    if (raw.multiplier !== undefined) errors.push(`${path}.multiplier is not allowed for extraHit`);
    if (raw.valueMode === 'derived' || raw.derivedValue !== undefined) errors.push(`${path} extraHit does not support derivedValue`);
  }
  const countableMaxStacks = effectKind === 'extraHit' ? Number(raw.maxStacks ?? 1) : raw.maxStacks;
  if (raw.category === 'countable' && (typeof countableMaxStacks !== 'number' || !Number.isFinite(countableMaxStacks) || countableMaxStacks <= 0)) {
    errors.push(`${path}.maxStacks must be positive number for countable`);
  }
  const valueMode = raw.valueMode === undefined ? 'fixed' : raw.valueMode;
  if (!EQUIPMENT_BUFF_VALUE_MODES.includes(valueMode as EquipmentBuffValueMode)) {
    errors.push(`${path}.valueMode must be fixed or derived`);
  }
  if (valueMode === 'derived') {
    if (raw.category === 'countable') errors.push(`${path} countable does not support derivedValue`);
    if (!normalizeEquipmentDerivedValue(raw.derivedValue)) {
      errors.push(`${path}.derivedValue requires a supported source and finite perPointValue`);
    }
  } else if (raw.derivedValue !== undefined) {
    errors.push(`${path}.derivedValue requires valueMode=derived`);
  }
  if (raw.multiplier !== undefined || legacyMultiplier) {
    if (!normalizedMultiplier) {
      errors.push(`${path}.multiplier.coefficient must be a positive number`);
    } else {
      validateBuffMultiplierDefinition({
        type: typeKey,
        category: rawCategory as 'condition' | 'passive' | 'countable' | undefined,
        effectKind,
        multiplier: normalizedMultiplier,
      }).forEach((message) => errors.push(`${path}: ${message}`));
      if (valueMode === 'derived') errors.push(`${path}.multiplier is incompatible with derivedValue`);
    }
  }
  if (raw.typeKey === 'multiplierMultiplier' && raw.multiplier === undefined && (
    typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value <= 0
  )) {
    errors.push(`${path}.value must be a positive legacy multiplier coefficient`);
  }
}

function normalizeThreePieceBuff(raw: Record<string, unknown>, fallbackKey: string): EquipmentThreePieceBuff {
  const effectKind: BuffEffectKind = raw.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const isLegacySkillMultiplier = raw.typeKey === 'multiplierMultiplier' || raw.type === 'multiplierMultiplier';
  const typeKey = effectKind === 'extraHit' ? '' : normalizeEquipmentBuffType(raw);
  const unit = raw.unit as EquipmentUnit;
  const rawValue = Number(raw.value || 0);
  const normalizedMultiplier = effectKind === 'extraHit'
    ? undefined
    : normalizeBuffMultiplier(raw.multiplier)
      ?? (isLegacySkillMultiplier && rawValue > 0 ? { coefficient: rawValue } : undefined);
  const category = effectKind === 'extraHit'
    ? normalizeExtraHitCategory(raw.category)
    : normalizedMultiplier
      ? 'condition'
      : raw.category === 'positive' || raw.category === '' ? 'passive' : raw.category as EquipmentThreePieceBuff['category'];
  const valueMode: EquipmentBuffValueMode = effectKind === 'extraHit' || category === 'countable' || normalizedMultiplier
    ? 'fixed'
    : raw.valueMode === 'derived' ? 'derived' : 'fixed';
  const derivedValue = valueMode === 'derived' ? normalizeEquipmentDerivedValue(raw.derivedValue) : undefined;
  return {
    schemaVersion: 2,
    effectId: String(raw.effectId || fallbackKey),
    name: String(raw.name || fallbackKey),
    category,
    type: typeKey,
    typeKey,
    value: effectKind === 'extraHit' || isLegacySkillMultiplier ? 0 : normalizeLegacyEquipmentPercentValue(typeKey, unit, rawValue, raw.raw),
    unit,
    condition: typeof raw.condition === 'string' ? raw.condition : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    raw: typeof raw.raw === 'string' ? raw.raw : '',
    valueMode,
    ...(derivedValue ? { derivedValue } : {}),
    ...(category === 'countable'
      ? { maxStacks: Math.max(1, Math.floor(Number(raw.maxStacks ?? 1))) }
      : {}),
    ...(normalizedMultiplier ? { multiplier: normalizedMultiplier } : {}),
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

export function normalizeEquipmentLibrary(raw: Record<string, unknown>): EquipmentLibrary {
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
      schemaVersion: 2,
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
    schemaVersion: 2,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(isRecord(raw.migration) ? {
      migration: {
        ...(typeof raw.migration.source === 'string' ? { source: raw.migration.source } : {}),
        ...(typeof raw.migration.migratedAt === 'string' ? { migratedAt: raw.migration.migratedAt } : {}),
        ...(Array.isArray(raw.migration.warnings)
          ? { warnings: raw.migration.warnings.filter((warning): warning is string => typeof warning === 'string') }
          : {}),
        ...(typeof raw.migration.reviewRequired === 'boolean' ? { reviewRequired: raw.migration.reviewRequired } : {}),
      },
    } : {}),
    gearSets,
  };
}

export function createEquipmentFillDraftSchema(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    formatName: 'EquipmentFillAiDraft',
    gearSets: 'Record<string, { gearSetId, name, equipments }>',
    part: EQUIPMENT_PARTS,
    fixedStatTypeKey: EQUIPMENT_FIXED_STAT_TYPES,
    effectSlots: EQUIPMENT_EFFECT_IDS,
    levelKeys: EQUIPMENT_LEVEL_KEYS,
    category: EQUIPMENT_EFFECT_CATEGORIES,
    unit: EQUIPMENT_UNITS,
    threePieceEffectKind: ['modifier', 'extraHit'],
    threePieceCategory: EQUIPMENT_THREE_PIECE_CATEGORIES,
    threePieceFields: ['schemaVersion?', 'effectId', 'name', 'effectKind?', 'typeKey', 'category', 'value?', 'unit', 'condition?', 'description?', 'raw?', 'valueMode?', 'derivedValue?', 'maxStacks?', 'multiplier?', 'extraHitConfig?'],
    supportedThreePieceTypes: SUPPORTED_EQUIPMENT_EFFECT_TYPES,
    multiplier: 'three-piece modifier only; category=condition; incompatible with countable/derived/extraHit. “提升至原本的1.1倍” uses multiplier.coefficient=1.1 and does not write 0.1 to value',
    corrosionRule: 'Ignore duration changes. “降低的最大抗性提升至原本的1.1倍” uses typeKey=allCorrosion + multiplier.coefficient=1.1; “额外提升原本的20%” uses coefficient=1.2',
    additiveMultiplier: '“额外伤害倍率+9%” remains typeKey=multiplierBonus without multiplier; condition/countable uses value=0.09',
    derivedValue: `{ source: ${EQUIPMENT_BUFF_DERIVED_SOURCES.join('|')}, perPointValue: number }; requires valueMode=derived and is incompatible with countable/multiplier/extraHit`,
    extraHitCategory: 'condition/countable only; never passive. countable defaults maxStacks to 1; 1 is a normal single segment and values greater than 1 create multiple independent segments',
    extraHitConfig: '{ key, damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds, trigger, formulaMode?, levelCurve? }; skillType empty/A/B/E/Q/Dot (250%=2.5). formulaMode defaults inherited. Use sourceSkill only with explicit source-skill-strength evidence; physical abnormal damage uses levelCurve=physicalAnomaly, shatter/Arts burst uses artsBurst',
  });
}

export const equipmentFillDomainCore = createLegacyFillDomainCore<EquipmentLibrary>({
  domain: 'equipment',
  schemaVersion: 1,
  schema: () => createLegacyFillSchemaTemplate({
    domain: 'equipment',
    schemaVersion: 1,
    payloadSchema: createEquipmentFillDraftSchema(),
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
