import type { BuffEffectKind, BuffExtraHitConfig } from '../../core/domain/buff';
import { normalizeExtraHitConfig, validateExtraHitConfig } from '../../core/services/buffExtraHit';
import { createLegacyFillDomainCore, createLegacyFillSchemaTemplate, type LegacyFillValidationResult } from '../index';

export const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
export const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
export const ALL_WEAPON_STORAGE_KEYS = [WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY];

export type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
export type WeaponEffectBucket = 'value' | 'effect';

export interface WeaponEffectData {
  name: string;
  type: string;
  category: string;
  levels: Record<string, number>;
  maxStacks?: number;
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
      name: string;
      type: string;
      category: string;
      levels: Record<string, number>;
      maxStacks?: number;
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
  'hp',
  'healingBonus',
  'ultimateChargeEfficiency',
];
const EFFECT_TYPE_ALIASES: Record<string, string> = {
  atkPercent: 'atkPercentBoost',
  critRate: 'critRateBoost',
  critDmg: 'critDmgBonusBoost',
  elementalDmgBonus: 'allDmgBonus',
};

export const WEAPON_FILL_CONTRACT_VERSION = 'weapon-fill-20260614-extra-hit-v4';

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
};

export function getWeaponFillAdapterDiagnostics() {
  return {
    contractVersion: WEAPON_FILL_CONTRACT_VERSION,
    validEffectCategories: [...VALID_EFFECT_CATEGORIES],
    supportedEffectTypeCount: SUPPORTED_EFFECT_TYPES.length,
    supportedEffectTypes: [...SUPPORTED_EFFECT_TYPES],
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
      if (!isRecord(skill.effects)) errors.push(`skills.${skillKey}.effects must be object`);
      if (!isRecord(skill.levels)) errors.push(`skills.${skillKey}.levels must be object`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], normalized: payload as unknown as WeaponDraft };
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function preserveExistingImageUrl(nextPayload: WeaponDraft, currentDraft?: WeaponDraft): WeaponDraft {
  const next = JSON.parse(JSON.stringify(nextPayload)) as WeaponDraft;
  if (currentDraft && next.id === currentDraft.id && hasText(currentDraft.imgUrl)) {
    next.imgUrl = currentDraft.imgUrl;
  }
  return next;
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
        const effect = effectValue as Record<string, unknown>;
        const effectKind = effect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
        if (typeof effect.name !== 'string') {
          errors.push(`skills.${skillKey}.effects.${effectKey}.name 必须是字符串`);
        }
        if (effectKind === 'modifier' && typeof effect.type !== 'string') {
          errors.push(`skills.${skillKey}.effects.${effectKey}.type 必须是字符串`);
        } else if (effectKind === 'modifier' && !SUPPORTED_EFFECT_TYPES.includes(normalizeEffectType(effect.type as string))) {
          errors.push(`skills.${skillKey}.effects.${effectKey}.type "${effect.type}" 不在支持的类型列表中: ${SUPPORTED_EFFECT_TYPES.join('/')}`);
        }
        if (typeof effect.category !== 'string' || !VALID_EFFECT_CATEGORIES.includes(effect.category)) {
          errors.push(`skills.${skillKey}.effects.${effectKey}.category 必须是 condition、passive 或 countable`);
        }
        if (effectKind === 'extraHit') {
          if (effect.category !== 'passive' && effect.category !== 'countable') {
            errors.push(`skills.${skillKey}.effects.${effectKey}.category 在 extraHit 时必须是 passive 或 countable`);
          }
          validateExtraHitConfig(effect.extraHitConfig, `skills.${skillKey}.effects.${effectKey}.extraHitConfig`, errors);
        }
        if (effect.category === 'countable' && (typeof effect.maxStacks !== 'number' || !Number.isFinite(effect.maxStacks) || effect.maxStacks <= 0)) {
          errors.push(`skills.${skillKey}.effects.${effectKey}.maxStacks 在 countable 时必须是正数`);
        }
        const levels = effect.levels;
        if (levels && typeof levels === 'object') {
          for (const [levelKey, levelValue] of Object.entries(levels)) {
            if (typeof levelValue !== 'number' || Number.isNaN(levelValue)) {
              errors.push(`skills.${skillKey}.effects.${effectKey}.levels.${levelKey} 必须是 number，不接受字符串数字`);
            }
          }
        }
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
      skillData.effects[effectKey] = {
        name: effect.name || effectKey,
        type: effect.effectKind === 'extraHit' ? '' : normalizeEffectType(effect.type || ''),
        category: normalizeEffectCategory(effect.category || ''),
        levels: normalizeNumericRecord(effect.levels),
        ...(effect.category === 'countable' && typeof effect.maxStacks === 'number'
          ? { maxStacks: Math.max(1, Math.floor(effect.maxStacks)) }
          : {}),
        effectKind: effect.effectKind === 'extraHit' ? 'extraHit' : 'modifier',
        ...(effect.effectKind === 'extraHit'
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
