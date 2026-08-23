import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../../core/domain/buff';
import { normalizeBuffMultiplier, validateBuffMultiplierDefinition } from '../../core/domain/buffMultiplier';
import {
  normalizeExtraHitCategory,
  normalizeExtraHitConfig,
  validateExtraHitConfig,
} from '../../core/services/buffExtraHit';
import { createLegacyFillDomainCore, createLegacyFillSchemaTemplate, type LegacyFillValidationResult } from '../index';
import { preserveExistingWeaponImageUrlValue } from '../preserveAssets';

export const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
export const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
export const ALL_WEAPON_STORAGE_KEYS = [WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY];

export type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
export type WeaponEffectBucket = 'value' | 'effect';
export const WEAPON_EFFECT_VALUE_MODES = ['fixed', 'derived'] as const;
export const WEAPON_EFFECT_DERIVED_SOURCES = ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] as const;

type WeaponEffectValueMode = (typeof WEAPON_EFFECT_VALUE_MODES)[number];
type WeaponEffectDerivedSource = (typeof WEAPON_EFFECT_DERIVED_SOURCES)[number];

interface WeaponEffectDerivedValue {
  source: WeaponEffectDerivedSource;
  perPointValue: number;
}

export interface WeaponEffectData {
  schemaVersion?: 2;
  effectId?: string;
  name: string;
  type: string;
  category: string;
  levels: Record<string, number>;
  valueMode?: WeaponEffectValueMode;
  derivedValue?: WeaponEffectDerivedValue;
  maxStacks?: number;
  unit?: string;
  condition?: string;
  description?: string;
  raw?: string;
  multiplier?: BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface WeaponLevelData {
  value?: number;
  description: string;
}

export interface WeaponSkillData {
  name: string;
  statType: string;
  effects: Record<string, WeaponEffectData>;
  levels: Record<string, WeaponLevelData>;
}

export interface WeaponDraft {
  id: string;
  name: string;
  rarity: number;
  type: string;
  description: string;
  imgUrl: string;
  attackGrowth: Record<string, number>;
  skills: Record<WeaponSkillKey, WeaponSkillData>;
}

export interface WeaponFillAiDraft {
  id: string;
  name: string;
  rarity: number;
  type?: string;
  description: string;
  imgUrl?: string;
  attackGrowth?: Record<string, number>;
  sourceName: string;
  source: string;
  skills: Record<string, {
    name: string;
    statType: string;
    effects: Record<string, {
      schemaVersion?: 2;
      effectId?: string;
      name: string;
      type: string;
      category: string;
      levels: Record<string, number>;
      valueMode?: WeaponEffectValueMode;
      derivedValue?: WeaponEffectDerivedValue;
      maxStacks?: number;
      unit?: string;
      condition?: string;
      description?: string;
      raw?: string;
      multiplier?: BuffMultiplier;
      effectKind?: BuffEffectKind;
      extraHitConfig?: BuffExtraHitConfig;
    }>;
    levels: Record<string, {
      value?: number;
      description?: string;
    }>;
  }>;
}

const VALID_SKILL_KEYS: WeaponSkillKey[] = ['skill1', 'skill2', 'skill3'];
const VALID_EFFECT_CATEGORIES: string[] = ['condition', 'passive', 'countable'];
export const SUPPORTED_EFFECT_TYPES: string[] = [
  'atkPercentBoost',
  'flatAtk',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allDmgBonus',
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
  'sourceSkillBoost',
  'atk',
  'mainStat',
  'subStat',
  'hpPercent',
  'imbalanceDmgBonus',
  'hp',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
  'ultimateChargeEfficiency',
];
const EFFECT_TYPE_ALIASES: Record<string, string> = {
  atkPercent: 'atkPercentBoost',
  critRate: 'critRateBoost',
  critDmg: 'critDmgBonusBoost',
  elementalDmgBonus: 'allDmgBonus',
  multiplierMultiplier: 'multiplierBonus',
};

export const WEAPON_FILL_CONTRACT_VERSION = 'weapon-fill-20260823-advanced-buff-v6';

export const WEAPON_FILL_AI_DRAFT_SCHEMA = {
  id: 'string',
  name: 'string',
  rarity: 'number',
  type: 'string optional; weapon-sheet top-level type',
  description: 'string',
  imgUrl: 'string optional; weapon-sheet top-level imgUrl',
  attackGrowth: 'Record<string, number> optional; weapon-sheet top-level attackGrowth',
  sourceName: 'string',
  source: 'string',
  skills: {
    skill1: 'WeaponFillSkill optional',
    skill2: 'WeaponFillSkill optional',
    skill3: 'WeaponFillSkill optional',
  },
  effect: {
    fields: ['schemaVersion?', 'effectId?', 'name', 'effectKind?', 'type', 'category', 'levels', 'valueMode?', 'derivedValue?', 'maxStacks?', 'unit?', 'condition?', 'description?', 'raw?', 'multiplier?', 'extraHitConfig?'],
    multiplier: 'modifier only; category=condition; incompatible with countable/derived/extraHit. “提升至原本的1.15倍” uses type=multiplierBonus + multiplier.coefficient=1.15, while each weapon level stores its direct coefficient in levels',
    additiveMultiplier: '“额外伤害倍率+9%” remains type=multiplierBonus without multiplier; condition/countable values use decimal levels such as 0.09',
    derivedValue: `{ source: ${WEAPON_EFFECT_DERIVED_SOURCES.join('|')}, perPointValue: number }; valueMode=derived only; each weapon level stores its per-point value in levels`,
    extraHitCategory: 'condition/countable only; never passive. countable defaults maxStacks to 1; 1 is a normal single segment and values greater than 1 create multiple independent segments',
    extraHitConfig: '{ key, damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds, trigger, formulaMode?, levelCurve? }; formulaMode defaults inherited. Use sourceSkill only with explicit source-skill-strength evidence; physical abnormal damage uses levelCurve=physicalAnomaly, shatter/Arts burst uses artsBurst',
  },
};

export function getWeaponFillAdapterDiagnostics() {
  return {
    contractVersion: WEAPON_FILL_CONTRACT_VERSION,
    validEffectCategories: [...VALID_EFFECT_CATEGORIES],
    supportedEffectTypeCount: SUPPORTED_EFFECT_TYPES.length,
    supportedEffectTypes: [...SUPPORTED_EFFECT_TYPES],
    extraHitCategories: ['condition', 'countable'],
    extraHitFormulaModes: ['inherited', 'sourceSkill'],
    extraHitLevelCurves: ['physicalAnomaly', 'artsBurst'],
    valueModes: [...WEAPON_EFFECT_VALUE_MODES],
    derivedSources: [...WEAPON_EFFECT_DERIVED_SOURCES],
    preservesMultiplier: true,
    rejectsLegacyUrl: true,
    preservedEffectSkill: 'skill3',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEffectType(type: string) {
  return EFFECT_TYPE_ALIASES[type] ?? type;
}

function normalizeEffectCategory(category: string) {
  return VALID_EFFECT_CATEGORIES.includes(category) ? category : 'condition';
}

function normalizeNumericRecord(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'number' && Number.isFinite(entryValue)),
  ) as Record<string, number>;
}

function normalizeDerivedValue(value: unknown): WeaponEffectDerivedValue | undefined {
  if (!isRecord(value)) return undefined;
  const source = WEAPON_EFFECT_DERIVED_SOURCES.includes(value.source as WeaponEffectDerivedSource)
    ? value.source as WeaponEffectDerivedSource
    : undefined;
  const perPointValue = value.perPointValue ?? value.scale;
  return source && typeof perPointValue === 'number' && Number.isFinite(perPointValue)
    ? { source, perPointValue }
    : undefined;
}

function firstPositiveLevel(levels: unknown): number | undefined {
  if (!isRecord(levels)) return undefined;
  return Object.values(levels).find((value): value is number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
  ));
}

function validateWeaponEffect(rawEffect: Record<string, unknown>, path: string, errors: string[]) {
  const effectKind: BuffEffectKind = rawEffect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const isLegacySkillMultiplier = rawEffect.type === 'multiplierMultiplier';
  const normalizedType = effectKind === 'extraHit' ? '' : normalizeEffectType(String(rawEffect.type || ''));
  const rawCategory = typeof rawEffect.category === 'string' && VALID_EFFECT_CATEGORIES.includes(rawEffect.category)
    ? rawEffect.category
    : undefined;

  if (typeof rawEffect.name !== 'string') errors.push(`${path}.name must be string`);
  if (effectKind === 'modifier' && (!normalizedType || !SUPPORTED_EFFECT_TYPES.includes(normalizedType))) {
    errors.push(`${path}.type unsupported`);
  }
  if (!rawCategory) errors.push(`${path}.category must be condition/passive/countable`);
  if (rawEffect.effectKind !== undefined && rawEffect.effectKind !== 'modifier' && rawEffect.effectKind !== 'extraHit') {
    errors.push(`${path}.effectKind must be modifier or extraHit`);
  }

  if (!isRecord(rawEffect.levels)) {
    errors.push(`${path}.levels must be object`);
  } else {
    for (const [levelKey, levelValue] of Object.entries(rawEffect.levels)) {
      if (typeof levelValue !== 'number' || !Number.isFinite(levelValue)) {
        errors.push(`${path}.levels.${levelKey} must be number`);
      }
    }
  }

  if (effectKind === 'extraHit') {
    if (rawCategory !== 'condition' && rawCategory !== 'countable') {
      errors.push(`${path}.category must be condition or countable for extraHit`);
    }
    validateExtraHitConfig(rawEffect.extraHitConfig, `${path}.extraHitConfig`, errors);
    if (rawEffect.multiplier !== undefined) errors.push(`${path}.multiplier is not allowed for extraHit`);
    if (rawEffect.valueMode === 'derived' || rawEffect.derivedValue !== undefined) {
      errors.push(`${path} extraHit does not support derivedValue`);
    }
  }

  const countableMaxStacks = effectKind === 'extraHit' ? Number(rawEffect.maxStacks ?? 1) : rawEffect.maxStacks;
  if (rawCategory === 'countable' && (typeof countableMaxStacks !== 'number' || !Number.isFinite(countableMaxStacks) || countableMaxStacks <= 0)) {
    errors.push(`${path}.maxStacks must be positive number for countable`);
  }

  const valueMode = rawEffect.valueMode === undefined ? 'fixed' : rawEffect.valueMode;
  if (!WEAPON_EFFECT_VALUE_MODES.includes(valueMode as WeaponEffectValueMode)) {
    errors.push(`${path}.valueMode must be fixed or derived`);
  }
  if (valueMode === 'derived') {
    if (rawCategory === 'countable') errors.push(`${path} countable does not support derivedValue`);
    if (!normalizeDerivedValue(rawEffect.derivedValue)) {
      errors.push(`${path}.derivedValue requires a supported source and finite perPointValue`);
    }
  } else if (rawEffect.derivedValue !== undefined) {
    errors.push(`${path}.derivedValue requires valueMode=derived`);
  }

  const multiplier = normalizeBuffMultiplier(rawEffect.multiplier)
    ?? (isLegacySkillMultiplier ? { coefficient: firstPositiveLevel(rawEffect.levels) ?? 1 } : undefined);
  if (rawEffect.multiplier !== undefined && !normalizeBuffMultiplier(rawEffect.multiplier)) {
    errors.push(`${path}.multiplier.coefficient must be a positive number`);
  }
  if (multiplier) {
    validateBuffMultiplierDefinition({
      type: normalizedType,
      category: rawCategory as 'condition' | 'passive' | 'countable' | undefined,
      effectKind,
      multiplier,
    }).forEach((message) => errors.push(`${path}: ${message}`));
    if (valueMode === 'derived') errors.push(`${path}.multiplier is incompatible with derivedValue`);
    if (isRecord(rawEffect.levels) && Object.values(rawEffect.levels).some((value) => typeof value === 'number' && value <= 0)) {
      errors.push(`${path}.levels must contain positive direct coefficients for multiplier`);
    }
  }
}

export function validateWeaponProposalPayload(payload: unknown): LegacyFillValidationResult<WeaponDraft> {
  if (!isRecord(payload)) {
    return { ok: false, errors: ['proposal payload must be object'] };
  }
  const errors: string[] = [];
  for (const key of ['id', 'name', 'type', 'description', 'imgUrl']) {
    if (typeof payload[key] !== 'string') {
      errors.push(`${key} must be string`);
    }
  }
  if (typeof payload.rarity !== 'number' || !Number.isFinite(payload.rarity)) {
    errors.push('rarity must be number');
  }
  if (!isRecord(payload.attackGrowth)) {
    errors.push('attackGrowth must be object');
  }
  if (!isRecord(payload.skills)) {
    errors.push('skills must be object');
  } else {
    for (const skillKey of VALID_SKILL_KEYS) {
      const skill = payload.skills[skillKey];
      if (!isRecord(skill)) {
        errors.push(`skills.${skillKey} must be object`);
        continue;
      }
      if (typeof skill.name !== 'string') errors.push(`skills.${skillKey}.name must be string`);
      if (typeof skill.statType !== 'string') errors.push(`skills.${skillKey}.statType must be string`);
      if (!isRecord(skill.effects)) {
        errors.push(`skills.${skillKey}.effects must be object`);
      } else {
        for (const [effectKey, rawEffect] of Object.entries(skill.effects)) {
          if (!isRecord(rawEffect)) {
            errors.push(`skills.${skillKey}.effects.${effectKey} must be object`);
            continue;
          }
          validateWeaponEffect(rawEffect, `skills.${skillKey}.effects.${effectKey}`, errors);
        }
      }
      if (!isRecord(skill.levels)) errors.push(`skills.${skillKey}.levels must be object`);
    }
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, errors: [], normalized: convertWeaponFillAiDraftToWeaponDraft(payload as unknown as WeaponFillAiDraft) };
}

export function preserveExistingImageUrl(nextPayload: WeaponDraft, currentDraft?: WeaponDraft): WeaponDraft {
  return preserveExistingWeaponImageUrlValue(nextPayload, currentDraft);
}

export function createFallbackWeaponDraft(): WeaponDraft {
  return {
    id: 'custom-weapon-001',
    name: '本地 Weapon 草稿',
    rarity: 1,
    type: 'sword',
    description: '',
    imgUrl: '',
    attackGrowth: {},
    skills: {
      skill1: { name: 'Skill 1', statType: 'atk', effects: {}, levels: {} },
      skill2: { name: 'Skill 2', statType: 'atk', effects: {}, levels: {} },
      skill3: { name: 'Skill 3', statType: 'atk', effects: {}, levels: {} },
    },
  };
}

export function validateWeaponFillAiDraft(candidate: unknown): LegacyFillValidationResult<WeaponFillAiDraft> {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, errors: ['根节点必须是对象'] };
  }
  const obj = candidate as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !obj.id) {
    errors.push('id 必须是字符串');
  }
  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('name 必须是字符串');
  }
  if (typeof obj.rarity !== 'number' || !Number.isFinite(obj.rarity)) {
    errors.push('rarity 必须是 number');
  }
  if (typeof obj.description !== 'string') {
    errors.push('description 必须是字符串');
  }
  if (obj.type !== undefined && typeof obj.type !== 'string') {
    errors.push('type 必须是字符串');
  }
  if (obj.imgUrl !== undefined && typeof obj.imgUrl !== 'string') {
    errors.push('imgUrl 必须是字符串');
  }
  if (obj.url !== undefined) {
    errors.push('url 不属于 weapon-sheet 图片字段；如无图片请省略 imgUrl 或传空字符串');
  }
  if (obj.attackGrowth !== undefined) {
    if (!isRecord(obj.attackGrowth)) {
      errors.push('attackGrowth 必须是对象');
    } else {
      for (const [levelKey, levelValue] of Object.entries(obj.attackGrowth)) {
        if (typeof levelValue !== 'number' || !Number.isFinite(levelValue)) {
          errors.push(`attackGrowth.${levelKey} 必须是 number`);
        }
      }
    }
  }

  const skills = obj.skills;
  if (!skills || typeof skills !== 'object') {
    errors.push('skills 必须是对象');
    return { ok: false, errors };
  }

  for (const [skillKey, skillValue] of Object.entries(skills)) {
    if (!VALID_SKILL_KEYS.includes(skillKey as WeaponSkillKey)) {
      errors.push(`非法 skill key: ${skillKey}，只允许 skill1/skill2/skill3`);
      continue;
    }
    if (!skillValue || typeof skillValue !== 'object') {
      errors.push(`skills.${skillKey} 必须是对象`);
      continue;
    }
    const skill = skillValue as Record<string, unknown>;
    if (typeof skill.name !== 'string') {
      errors.push(`skills.${skillKey}.name 必须是字符串`);
    }
    if (typeof skill.statType !== 'string') {
      errors.push(`skills.${skillKey}.statType 必须是字符串`);
    }

    const effects = skill.effects;
    if (effects && typeof effects === 'object') {
      if (skillKey !== 'skill3' && Object.keys(effects).length > 0) {
        errors.push(`skills.${skillKey}.effects 不会被 weapon-sheet 保留；只允许 skill3.effects`);
      }
      for (const [effectKey, effectValue] of Object.entries(effects)) {
        if (!effectValue || typeof effectValue !== 'object') {
          errors.push(`skills.${skillKey}.effects.${effectKey} 必须是对象`);
          continue;
        }
        validateWeaponEffect(effectValue as Record<string, unknown>, `skills.${skillKey}.effects.${effectKey}`, errors);
      }
    }

    const levels = skill.levels;
    if (levels && typeof levels === 'object') {
      for (const [levelKey, levelValue] of Object.entries(levels)) {
        if (!levelValue || typeof levelValue !== 'object') {
          errors.push(`skills.${skillKey}.levels.${levelKey} 必须是对象`);
          continue;
        }
        const lv = levelValue as Record<string, unknown>;
        if (lv.value !== undefined && (typeof lv.value !== 'number' || Number.isNaN(lv.value))) {
          errors.push(`skills.${skillKey}.levels.${levelKey}.value 必须是 number`);
        }
        if (lv.description !== undefined && typeof lv.description !== 'string') {
          errors.push(`skills.${skillKey}.levels.${levelKey}.description 必须是字符串`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function convertWeaponFillAiDraftToWeaponDraft(candidate: WeaponFillAiDraft): WeaponDraft {
  const skills: Record<WeaponSkillKey, WeaponSkillData> = {
    skill1: { name: 'Skill 1', statType: 'atk', effects: {}, levels: {} },
    skill2: { name: 'Skill 2', statType: 'atk', effects: {}, levels: {} },
    skill3: { name: 'Skill 3', statType: 'atk', effects: {}, levels: {} },
  };
  for (const [key, skill] of Object.entries(candidate.skills)) {
    if (!VALID_SKILL_KEYS.includes(key as WeaponSkillKey)) continue;
    const skillData: WeaponSkillData = {
      name: skill.name || key,
      statType: skill.statType || 'atk',
      effects: {},
      levels: {},
    };
    for (const [effectKey, effect] of Object.entries(skill.effects || {})) {
      if (key !== 'skill3') {
        continue;
      }
      const effectKind: BuffEffectKind = effect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
      const isLegacySkillMultiplier = effect.type === 'multiplierMultiplier';
      const normalizedMultiplier = effectKind === 'extraHit'
        ? undefined
        : normalizeBuffMultiplier(effect.multiplier)
          ?? (isLegacySkillMultiplier ? { coefficient: firstPositiveLevel(effect.levels) ?? 1 } : undefined);
      const category = effectKind === 'extraHit'
        ? normalizeExtraHitCategory(effect.category)
        : normalizedMultiplier
          ? 'condition'
          : normalizeEffectCategory(effect.category || '');
      const valueMode: WeaponEffectValueMode = effectKind === 'extraHit' || category === 'countable' || normalizedMultiplier
        ? 'fixed'
        : effect.valueMode === 'derived' ? 'derived' : 'fixed';
      const derivedValue = valueMode === 'derived' ? normalizeDerivedValue(effect.derivedValue) : undefined;
      skillData.effects[effectKey] = {
        schemaVersion: 2,
        effectId: typeof effect.effectId === 'string' && effect.effectId.trim() ? effect.effectId.trim() : effectKey,
        name: effect.name || effectKey,
        type: effectKind === 'extraHit' ? '' : normalizeEffectType(effect.type || ''),
        category,
        levels: normalizeNumericRecord(effect.levels),
        valueMode,
        ...(derivedValue ? { derivedValue } : {}),
        ...(category === 'countable'
          ? { maxStacks: Math.max(1, Math.floor(Number(effect.maxStacks ?? 1))) }
          : {}),
        unit: typeof effect.unit === 'string' ? effect.unit : '',
        condition: typeof effect.condition === 'string' ? effect.condition : '',
        description: typeof effect.description === 'string' ? effect.description : '',
        raw: typeof effect.raw === 'string' ? effect.raw : '',
        ...(normalizedMultiplier ? { multiplier: normalizedMultiplier } : {}),
        effectKind,
        ...(effectKind === 'extraHit'
          ? { extraHitConfig: normalizeExtraHitConfig(effect.extraHitConfig, `${effectKey}-extra-hit`) }
          : {}),
      };
    }
    for (const [levelKey, level] of Object.entries(skill.levels || {})) {
      skillData.levels[levelKey] = {
        value: level.value,
        description: level.description || '',
      };
    }
    skills[key as WeaponSkillKey] = skillData;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    rarity: candidate.rarity,
    type: candidate.type?.trim() || '',
    description: candidate.description || '',
    imgUrl: candidate.imgUrl?.trim() || '',
    attackGrowth: normalizeNumericRecord(candidate.attackGrowth),
    skills,
  };
}

function extractBalancedJsonObject(rawText: string) {
  const text = rawText.trim();
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function parseWeaponFillResult(rawText: string): { draft: WeaponDraft | null; errors: string[] } {
  const normalizedText = rawText.trim();
  if (!normalizedText) {
    return { draft: null, errors: ['AI response is empty'] };
  }
  const candidates = [normalizedText];
  const balancedJson = extractBalancedJsonObject(normalizedText);
  if (balancedJson && balancedJson !== normalizedText) {
    candidates.push(balancedJson);
  }
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const rawDraft = parsed && typeof parsed.draft === 'object' ? parsed.draft : parsed;
      const validation = validateWeaponFillAiDraft(rawDraft);
      if (!validation.ok) {
        errors.push(...validation.errors);
        continue;
      }
      return { draft: convertWeaponFillAiDraftToWeaponDraft(rawDraft as WeaponFillAiDraft), errors: [] };
    } catch (error) {
      errors.push(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { draft: null, errors: Array.from(new Set(errors)) };
}

export const weaponFillDomainCore = createLegacyFillDomainCore<WeaponDraft>({
  domain: 'weapon',
  schemaVersion: 1,
  schema: () => createLegacyFillSchemaTemplate({ domain: 'weapon', schemaVersion: 1, payloadSchema: WEAPON_FILL_AI_DRAFT_SCHEMA }),
  normalize(candidate) {
    const validation = validateWeaponProposalPayload(candidate);
    if (!validation.ok || !validation.normalized) throw new TypeError(validation.errors.join('; '));
    return validation.normalized;
  },
  validate: validateWeaponProposalPayload,
  summarize(payload) {
    const skillCount = Object.keys(payload.skills).length;
    const effectCount = Object.values(payload.skills).reduce((sum, skill) => sum + Object.keys(skill.effects).length, 0);
    return `weapon fill: name=${payload.name} skills=${skillCount} effects=${effectCount}`;
  },
  targetId: (payload) => payload.id,
});
