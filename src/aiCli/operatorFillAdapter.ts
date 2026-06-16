import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import { normalizeExtraHitConfig, validateExtraHitConfig } from '../core/services/buffExtraHit';

export const OPERATOR_DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
export const OPERATOR_LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';

const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
const ATTRIBUTE_KEYS = ['strength', 'agility', 'intelligence', 'will', 'atk', 'hp'] as const;
const BUTTON_TYPES = ['A', 'B', 'E', 'Q'] as const;
const HIT_SKILL_TYPES = ['A', 'B', 'E', 'Q', 'Dot'] as const;
const ELEMENT_TYPES = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;
const ABILITY_TYPES = ['力量', '敏捷', '智识', '意志'] as const;
const PROFESSION_TYPES = ['突击', '重装', '近卫', '辅助', '先锋', '术师'] as const;
const WEAPON_TYPES = ['手铳', '双手剑', '长柄武器', '法术单元', '单手剑'] as const;
const BUFF_GROUPS = ['talent', 'potential', 'skill'] as const;
const BUFF_CATEGORIES = ['passive', 'condition', 'countable'] as const;
const BUFF_VALUE_MODES = ['fixed', 'derived'] as const;
const BUFF_DERIVED_SOURCES = ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] as const;
const SUPPORTED_OPERATOR_EFFECT_TYPES = [
  'atkPercentBoost',
  'atk',
  'flatAtk',
  'mainStat',
  'subStat',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
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
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
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
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
];

function normalizeEnumText(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
    : '';
}

function findAllowedValue<T extends readonly string[]>(rawValue: unknown, allowed: T) {
  const normalizedValue = normalizeEnumText(rawValue);
  return allowed.find((value) => normalizeEnumText(value) === normalizedValue) as T[number] | undefined;
}

function formatInvalidEnum(field: string, rawValue: unknown, allowed: readonly string[]) {
  const value = typeof rawValue === 'string' ? JSON.stringify(rawValue) : String(rawValue);
  return `${field} unsupported: ${value}; must be one of ${allowed.join('/')}`;
}

type ButtonType = (typeof BUTTON_TYPES)[number];
type HitSkillType = (typeof HIT_SKILL_TYPES)[number];
type ElementType = (typeof ELEMENT_TYPES)[number];
type SkillLevelKey = (typeof SKILL_LEVEL_KEYS)[number];
type AttributeLevelKey = (typeof ATTRIBUTE_LEVEL_KEYS)[number];
type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
type OperatorBuffGroupKey = (typeof BUFF_GROUPS)[number];
type OperatorBuffCategory = (typeof BUFF_CATEGORIES)[number];
type OperatorBuffValueMode = (typeof BUFF_VALUE_MODES)[number];
type OperatorBuffDerivedSource = (typeof BUFF_DERIVED_SOURCES)[number];

interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

interface OperatorBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  maxStacks?: number;
  unit?: 'flat' | 'percent' | string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
  description?: string;
  raw?: string;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;
type AttributeLevels = Record<AttributeKey, Record<AttributeLevelKey, number>>;

interface HitMetaDraft {
  displayName: string;
  element: ElementType;
  skillType: HitSkillType;
  levels: Record<SkillLevelKey, number>;
}

interface SkillDraft {
  displayName: string;
  buttonType: ButtonType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, HitMetaDraft>;
}

export interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: AttributeLevels;
  skills: Record<string, SkillDraft>;
  buffs: OperatorBuffs;
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

function defaultAttributes(): AttributeLevels {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key) => [key, Object.fromEntries(ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, 0]))]),
  ) as AttributeLevels;
}

function normalizeOperatorAttributes(rawAttributes: unknown): AttributeLevels {
  if (!isRecord(rawAttributes)) return defaultAttributes();
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => {
      const rawLevels = isRecord(rawAttributes[attributeKey]) ? rawAttributes[attributeKey] : {};
      return [
        attributeKey,
        Object.fromEntries(
          ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, Number(rawLevels[levelKey] ?? 0)]),
        ),
      ];
    }),
  ) as AttributeLevels;
}

function validateOperatorAttributes(rawAttributes: unknown, errors: string[]) {
  if (!isRecord(rawAttributes)) {
    errors.push('attributes must be object');
    return;
  }

  for (const [attributeKey, rawLevels] of Object.entries(rawAttributes)) {
    if (!findAllowedValue(attributeKey, ATTRIBUTE_KEYS)) {
      errors.push(formatInvalidEnum('attribute key', attributeKey, ATTRIBUTE_KEYS));
      continue;
    }
    if (!isRecord(rawLevels)) {
      errors.push(`attributes.${attributeKey} must be object`);
      continue;
    }
    for (const [levelKey, value] of Object.entries(rawLevels)) {
      if (!ATTRIBUTE_LEVEL_KEYS.includes(levelKey as never)) {
        errors.push(`invalid attribute level key: attributes.${attributeKey}.${levelKey}; must be one of ${ATTRIBUTE_LEVEL_KEYS.join('/')}`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`attributes.${attributeKey}.${levelKey} must be number`);
      }
    }
  }
}

function defaultBuffs(): OperatorBuffs {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function normalizeOperatorBuffEffect(effectKey: string, rawEffect: Record<string, unknown>): OperatorBuffEffect {
  const effectKind: BuffEffectKind = rawEffect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const category = effectKind === 'extraHit' ? 'passive' : findAllowedValue(rawEffect.category, BUFF_CATEGORIES)
    || (normalizeEnumText(rawEffect.category) === 'positive' ? 'passive' : 'passive');
  const valueMode: OperatorBuffValueMode = category === 'countable'
    ? 'fixed'
    : rawEffect.valueMode === 'derived' ? 'derived' : 'fixed';
  const rawDerivedValue = isRecord(rawEffect.derivedValue) ? rawEffect.derivedValue : {};
  const rawDerivedSource = findAllowedValue(rawDerivedValue.source, BUFF_DERIVED_SOURCES);
  const rawPerPointValue = rawDerivedValue.perPointValue ?? rawDerivedValue.scale;
  return {
    effectId: typeof rawEffect.effectId === 'string' && rawEffect.effectId ? rawEffect.effectId : effectKey,
    name: typeof rawEffect.name === 'string' && rawEffect.name ? rawEffect.name : effectKey,
    type: effectKind === 'extraHit' ? '' : String(rawEffect.type || ''),
    category,
    ...(typeof rawEffect.value === 'number' && Number.isFinite(rawEffect.value) ? { value: rawEffect.value } : {}),
    ...(category === 'countable' && typeof rawEffect.maxStacks === 'number' && Number.isFinite(rawEffect.maxStacks)
      ? { maxStacks: Math.max(1, Math.floor(rawEffect.maxStacks)) }
      : {}),
    ...(typeof rawEffect.unit === 'string' && rawEffect.unit ? { unit: rawEffect.unit } : {}),
    valueMode,
    ...(valueMode === 'derived' && rawDerivedSource && typeof rawPerPointValue === 'number' && Number.isFinite(rawPerPointValue)
      ? { derivedValue: { source: rawDerivedSource, perPointValue: rawPerPointValue } }
      : {}),
    ...(typeof rawEffect.description === 'string' && rawEffect.description ? { description: rawEffect.description } : {}),
    ...(typeof rawEffect.raw === 'string' && rawEffect.raw ? { raw: rawEffect.raw } : {}),
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(rawEffect.extraHitConfig, `${effectKey}-extra-hit`) }
      : {}),
  };
}

function normalizeOperatorBuffs(rawBuffs: unknown): OperatorBuffs {
  if (!isRecord(rawBuffs)) return defaultBuffs();
  return Object.fromEntries(
    BUFF_GROUPS.map((groupKey) => {
      const rawGroup = isRecord(rawBuffs[groupKey]) ? rawBuffs[groupKey] : {};
      const rawEffects = isRecord(rawGroup.effects) ? rawGroup.effects : {};
      return [
        groupKey,
        {
          effects: Object.fromEntries(
            Object.entries(rawEffects)
              .filter(([, rawEffect]) => isRecord(rawEffect))
              .map(([effectKey, rawEffect]) => [effectKey, normalizeOperatorBuffEffect(effectKey, rawEffect as Record<string, unknown>)]),
          ),
        },
      ];
    }),
  ) as OperatorBuffs;
}

function createFallbackOperatorDraft(): OperatorDraft {
  return {
    id: 'custom-operator-001',
    name: '新干员',
    avatarUrl: '',
    rarity: 6,
    profession: '',
    weapon: '',
    element: 'physical',
    mainStat: '',
    subStat: '',
    level: 90,
    attributes: defaultAttributes(),
    skills: {},
    buffs: defaultBuffs(),
  };
}

function buildTypedSkillKey(buttonType: ButtonType, index: number): string {
  return `skill-${buttonType}-${index}`;
}

function normalizeOperatorSkillKeys(skills: Record<string, SkillDraft>): Record<string, SkillDraft> {
  const nextSkills: Record<string, SkillDraft> = {};
  const nextTypeIndexes: Record<ButtonType, number> = {
    A: 0,
    B: 0,
    E: 0,
    Q: 0,
  };

  Object.values(skills).forEach((skill) => {
    const nextSkillKey = buildTypedSkillKey(skill.buttonType, nextTypeIndexes[skill.buttonType] += 1);
    nextSkills[nextSkillKey] = skill;
  });

  return nextSkills;
}

export function readCurrentOperatorDraft(): OperatorDraft {
  return readJsonStorage<OperatorDraft>(OPERATOR_DRAFT_STORAGE_KEY, createFallbackOperatorDraft());
}

export function readOperatorLibrary(): Record<string, OperatorDraft> {
  return readJsonStorage<Record<string, OperatorDraft>>(OPERATOR_LIBRARY_STORAGE_KEY, {});
}

export function formatOperatorLibrarySummary(library = readOperatorLibrary()) {
  return Object.entries(library)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
    .map(([id, operator]) => ({
      id,
      name: operator.name || '',
      rarity: Number(operator.rarity || 0),
      profession: operator.profession || '',
      element: operator.element || '',
      skills: operator.skills ? Object.keys(operator.skills).length : 0,
    }));
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

function validateOperatorDraftShape(raw: unknown): AgentFillValidationResult<OperatorDraft> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['root must be object'] };
  const obj = raw;
  if (typeof obj.id !== 'string' || !obj.id.trim()) errors.push('id must be non-empty string');
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('name must be non-empty string');
  if (typeof obj.rarity !== 'number' || !Number.isFinite(obj.rarity)) errors.push('rarity must be number');
  if (!findAllowedValue(obj.profession, PROFESSION_TYPES)) errors.push(formatInvalidEnum('profession', obj.profession, PROFESSION_TYPES));
  if (!findAllowedValue(obj.weapon, WEAPON_TYPES)) errors.push(formatInvalidEnum('weapon', obj.weapon, WEAPON_TYPES));
  if (!findAllowedValue(obj.element, ELEMENT_TYPES)) errors.push(formatInvalidEnum('element', obj.element, ELEMENT_TYPES));
  if (!findAllowedValue(obj.mainStat, ABILITY_TYPES)) errors.push(formatInvalidEnum('mainStat', obj.mainStat, ABILITY_TYPES));
  if (!findAllowedValue(obj.subStat, ABILITY_TYPES)) errors.push(formatInvalidEnum('subStat', obj.subStat, ABILITY_TYPES));
  validateOperatorAttributes(obj.attributes, errors);
  if (!isRecord(obj.skills) || Object.keys(obj.skills).length === 0) {
    errors.push('skills must be non-empty object');
  } else {
    for (const [skillKey, rawSkill] of Object.entries(obj.skills)) {
      if (!isRecord(rawSkill)) {
        errors.push(`skills.${skillKey} must be object`);
        continue;
      }
      if (typeof rawSkill.displayName !== 'string') errors.push(`skills.${skillKey}.displayName must be string`);
      if (!findAllowedValue(rawSkill.buttonType, BUTTON_TYPES)) errors.push(formatInvalidEnum(`skills.${skillKey}.buttonType`, rawSkill.buttonType, BUTTON_TYPES));
      if (rawSkill.hitMeta !== undefined && !isRecord(rawSkill.hitMeta)) errors.push(`skills.${skillKey}.hitMeta must be object`);
      if (isRecord(rawSkill.hitMeta)) {
        for (const [hitKey, rawHit] of Object.entries(rawSkill.hitMeta)) {
          if (!isRecord(rawHit)) {
            errors.push(`skills.${skillKey}.hitMeta.${hitKey} must be object`);
            continue;
          }
          if (typeof rawHit.displayName !== 'string') errors.push(`skills.${skillKey}.hitMeta.${hitKey}.displayName must be string`);
          if (!findAllowedValue(rawHit.element, ELEMENT_TYPES)) errors.push(formatInvalidEnum(`skills.${skillKey}.hitMeta.${hitKey}.element`, rawHit.element, ELEMENT_TYPES));
          if (!findAllowedValue(rawHit.skillType, HIT_SKILL_TYPES)) errors.push(formatInvalidEnum(`skills.${skillKey}.hitMeta.${hitKey}.skillType`, rawHit.skillType, HIT_SKILL_TYPES));
          if (!isRecord(rawHit.levels)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.levels must be object`);
          if (isRecord(rawHit.levels)) {
            for (const [levelKey, value] of Object.entries(rawHit.levels)) {
              if (!SKILL_LEVEL_KEYS.includes(levelKey as never)) errors.push(`invalid skill level key: ${levelKey}`);
              if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.levels.${levelKey} must be number`);
            }
          }
        }
      }
    }
  }
  if (obj.buffs !== undefined) {
    if (!isRecord(obj.buffs)) {
      errors.push('buffs must be object');
    } else {
      for (const [groupKey, rawGroup] of Object.entries(obj.buffs)) {
        if (!findAllowedValue(groupKey, BUFF_GROUPS)) errors.push(formatInvalidEnum('buff group', groupKey, BUFF_GROUPS));
        if (!isRecord(rawGroup) || !isRecord(rawGroup.effects)) {
          errors.push(`buffs.${groupKey}.effects must be object`);
          continue;
        }
        for (const [effectKey, rawEffect] of Object.entries(rawGroup.effects)) {
          if (!isRecord(rawEffect)) {
            errors.push(`buffs.${groupKey}.effects.${effectKey} must be object`);
            continue;
          }
          const effectKind = rawEffect.effectKind === undefined ? 'modifier' : rawEffect.effectKind;
          if (effectKind !== 'modifier' && effectKind !== 'extraHit') {
            errors.push(`buffs.${groupKey}.effects.${effectKey}.effectKind must be modifier or extraHit`);
          }
          if (effectKind === 'extraHit') {
            validateExtraHitConfig(rawEffect.extraHitConfig, `buffs.${groupKey}.effects.${effectKey}.extraHitConfig`, errors);
            if (rawEffect.category !== undefined && rawEffect.category !== 'passive') {
              errors.push(`buffs.${groupKey}.effects.${effectKey}.category must be passive for extraHit`);
            }
          } else if (typeof rawEffect.type !== 'string' || !SUPPORTED_OPERATOR_EFFECT_TYPES.includes(rawEffect.type)) {
            errors.push(`unsupported operator buff type: ${String(rawEffect.type)}`);
          }
          const buffCategory = findAllowedValue(rawEffect.category, BUFF_CATEGORIES)
            || (normalizeEnumText(rawEffect.category) === 'positive' ? 'passive' : undefined);
          if (!buffCategory) errors.push(formatInvalidEnum(`buffs.${groupKey}.effects.${effectKey}.category`, rawEffect.category, BUFF_CATEGORIES));
          if (buffCategory === 'countable') {
            if (typeof rawEffect.maxStacks !== 'number' || !Number.isFinite(rawEffect.maxStacks) || rawEffect.maxStacks <= 0) {
              errors.push(`buffs.${groupKey}.effects.${effectKey}.maxStacks must be positive number when category is countable`);
            }
            if (rawEffect.valueMode === 'derived' || rawEffect.derivedValue !== undefined) {
              errors.push(`buffs.${groupKey}.effects.${effectKey} countable does not support derivedValue`);
            }
          }
          if (effectKind !== 'extraHit' && rawEffect.value !== undefined && (typeof rawEffect.value !== 'number' || !Number.isFinite(rawEffect.value))) errors.push(`buffs.${groupKey}.effects.${effectKey}.value must be number`);
          const valueMode = rawEffect.valueMode === undefined ? 'fixed' : findAllowedValue(rawEffect.valueMode, BUFF_VALUE_MODES);
          if (!valueMode) errors.push(formatInvalidEnum(`buffs.${groupKey}.effects.${effectKey}.valueMode`, rawEffect.valueMode, BUFF_VALUE_MODES));
          if (valueMode === 'derived') {
            if (!isRecord(rawEffect.derivedValue)) {
              errors.push(`buffs.${groupKey}.effects.${effectKey}.derivedValue must be object when valueMode is derived`);
            } else {
              if (!findAllowedValue(rawEffect.derivedValue.source, BUFF_DERIVED_SOURCES)) {
                errors.push(formatInvalidEnum(`buffs.${groupKey}.effects.${effectKey}.derivedValue.source`, rawEffect.derivedValue.source, BUFF_DERIVED_SOURCES));
              }
              const rawPerPointValue = rawEffect.derivedValue.perPointValue ?? rawEffect.derivedValue.scale;
              if (typeof rawPerPointValue !== 'number' || !Number.isFinite(rawPerPointValue)) {
                errors.push(`buffs.${groupKey}.effects.${effectKey}.derivedValue.perPointValue must be number`);
              }
            }
          }
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], normalized: normalizeOperatorDraft(obj) };
}

function normalizeOperatorDraft(obj: Record<string, unknown>): OperatorDraft {
  const skills: Record<string, SkillDraft> = {};
  for (const [skillKey, rawSkill] of Object.entries(obj.skills as Record<string, Record<string, unknown>>)) {
    const hitMeta: Record<string, HitMetaDraft> = {};
    if (isRecord(rawSkill.hitMeta)) {
      for (const [hitKey, rawHit] of Object.entries(rawSkill.hitMeta)) {
        if (!isRecord(rawHit)) continue;
        hitMeta[hitKey] = {
          displayName: String(rawHit.displayName || hitKey),
          element: findAllowedValue(rawHit.element, ELEMENT_TYPES) as ElementType,
          skillType: findAllowedValue(rawHit.skillType, HIT_SKILL_TYPES) as HitSkillType,
          levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, Number((rawHit.levels as Record<string, number> | undefined)?.[levelKey] ?? 0)])) as Record<SkillLevelKey, number>,
        };
      }
    }
    skills[skillKey] = {
      displayName: String(rawSkill.displayName || skillKey),
      buttonType: findAllowedValue(rawSkill.buttonType, BUTTON_TYPES) as ButtonType,
      iconUrl: typeof rawSkill.iconUrl === 'string' ? rawSkill.iconUrl : '',
      hitCount: Object.keys(hitMeta).length || Number(rawSkill.hitCount || 0) || 1,
      hitMeta: Object.keys(hitMeta).length ? hitMeta : {
        hit1: {
          displayName: '第1击',
          element: findAllowedValue(obj.element, ELEMENT_TYPES) as ElementType,
          skillType: findAllowedValue(rawSkill.buttonType, BUTTON_TYPES) as ButtonType,
          levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, 0])) as Record<SkillLevelKey, number>,
        },
      },
    };
  }
  return {
    ...createFallbackOperatorDraft(),
    id: String(obj.id),
    name: String(obj.name),
    avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : '',
    rarity: Number(obj.rarity),
    profession: findAllowedValue(obj.profession, PROFESSION_TYPES) || String(obj.profession),
    weapon: findAllowedValue(obj.weapon, WEAPON_TYPES) || String(obj.weapon),
    element: findAllowedValue(obj.element, ELEMENT_TYPES) || String(obj.element),
    mainStat: findAllowedValue(obj.mainStat, ABILITY_TYPES) || String(obj.mainStat),
    subStat: findAllowedValue(obj.subStat, ABILITY_TYPES) || String(obj.subStat),
    attributes: normalizeOperatorAttributes(obj.attributes),
    skills: normalizeOperatorSkillKeys(skills),
    buffs: normalizeOperatorBuffs(obj.buffs),
  };
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function preserveExistingAssetUrls(nextPayload: OperatorDraft, currentDraft = readCurrentOperatorDraft()): OperatorDraft {
  const next = JSON.parse(JSON.stringify(nextPayload)) as OperatorDraft;
  if (next.id === currentDraft.id && hasText(currentDraft.avatarUrl)) {
    next.avatarUrl = currentDraft.avatarUrl;
  }

  for (const [skillKey, nextSkill] of Object.entries(next.skills || {})) {
    const currentSkill = currentDraft.skills?.[skillKey]
      ?? Object.values(currentDraft.skills || {}).find((skill) => (
        skill.buttonType === nextSkill.buttonType
        && skill.displayName === nextSkill.displayName
      ))
      ?? Object.values(currentDraft.skills || {}).find((skill) => skill.buttonType === nextSkill.buttonType);
    if (next.id === currentDraft.id && hasText(currentSkill?.iconUrl)) {
      nextSkill.iconUrl = currentSkill.iconUrl;
    }
  }

  return next;
}

function readExistingOperatorDraftForPayload(payload: OperatorDraft): OperatorDraft | undefined {
  const libraryDraft = readOperatorLibrary()[payload.id];
  if (libraryDraft) {
    return libraryDraft;
  }
  const currentDraft = readCurrentOperatorDraft();
  return currentDraft.id === payload.id ? currentDraft : undefined;
}

function preserveExistingOperatorAssets(payload: OperatorDraft): OperatorDraft {
  const existingDraft = readExistingOperatorDraftForPayload(payload);
  return existingDraft ? preserveExistingAssetUrls(payload, existingDraft) : payload;
}

export const operatorFillAdapter: AgentFillDomainAdapter<OperatorDraft> = {
  domain: 'operator',
  workflow: 'operator.fill',
  commandPrefix: 'operator.fill',
  draftStorageKey: OPERATOR_DRAFT_STORAGE_KEY,
  libraryStorageKey: OPERATOR_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,

  validateAiDraft(rawPayload): AgentFillValidationResult<OperatorDraft> {
    const parsed = parseJsonPayload(rawPayload);
    if (!parsed.value) return { ok: false, errors: parsed.errors };
    return validateOperatorDraftShape(parsed.value);
  },

  validateProposalPayload: validateOperatorDraftShape,

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<OperatorDraft> {
    const draft = preserveExistingOperatorAssets(validation.normalized!);
    return {
      rawCommand,
      normalized: draft,
      summary: operatorFillAdapter.summarizeProposal(draft),
    };
  },

  summarizeProposal(payload): string {
    return `operator fill: name=${payload.name} skills=${Object.keys(payload.skills || {}).length}`;
  },

  getProposalTargetId(payload): string {
    return payload.id;
  },

  buildTaskPackage() {
    const draft = readCurrentOperatorDraft();
    const library = readOperatorLibrary();
    return {
      lines: [`[info] operator.fill.task ready: name=${draft.name} skills=${Object.keys(draft.skills || {}).length}`],
      data: {
        tool: 'operator.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        librarySummary: formatOperatorLibrarySummary(library),
        operatorFillAiDraftSchema: {
          formatName: 'ImportedOperatorDraft-compatible object',
          id: 'string',
          name: 'string',
          rarity: 'number',
          profession: PROFESSION_TYPES,
          weapon: WEAPON_TYPES,
          element: ELEMENT_TYPES,
          mainStat: ABILITY_TYPES,
          subStat: ABILITY_TYPES,
          attributes: `Record<${ATTRIBUTE_KEYS.join('|')}, Record<${ATTRIBUTE_LEVEL_KEYS.join('|')}, number>>; only these six key levels are accepted`,
          skills: 'Record<skillKey, { displayName, buttonType, iconUrl, hitCount, hitMeta }>; skillKey is system-maintained and normalized to skill-{buttonType}-{per-type index}, e.g. skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1. Each buttonType counts from 1. Legacy skill-1 input is accepted but normalized.',
          skillKeyNaming: 'Use skill-{buttonType}-{index}. The type comes from buttonType, not the old key text. Do not use plain A/B/E/Q as skill keys.',
          buttonType: BUTTON_TYPES,
          hitSkillType: HIT_SKILL_TYPES,
          hitMeta: 'Record<hitKey, { displayName, element, skillType, levels }>; hit skillType accepts A/B/E/Q/Dot',
          buffs: 'optional; talent/potential/skill groups only; each group is { effects: Record<effectKey, OperatorBuffEffect> }',
          buffEffect: {
            fields: ['effectId', 'name', 'effectKind?', 'type', 'category', 'value?', 'maxStacks?', 'unit?', 'valueMode?', 'derivedValue?', 'extraHitConfig?', 'description?', 'raw?'],
            category: BUFF_CATEGORIES,
            countable: 'category=countable requires maxStacks; countable only supports fixed value and no derivedValue',
            extraHit: 'effectKind=extraHit uses category=passive and requires extraHitConfig { key, damageType, skillType, baseMultiplier, imbalanceValue, cooldownSeconds, trigger }; skillType is empty/A/B/E/Q/Dot; 250% is baseMultiplier=2.5',
            valueMode: BUFF_VALUE_MODES,
            derivedValue: {
              meaning: 'source value derived Buff; runtime value = selected source value * perPointValue',
              source: BUFF_DERIVED_SOURCES,
              perPointValue: 'number; 每点提升多少。Percent-like types still use decimal numbers, e.g. 每点 +0.10% => 0.001',
              legacyAcceptedInput: 'derivedValue.scale is accepted during check/apply and normalized to perPointValue',
            },
          },
        },
        supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,
        instruction: 'Return exactly one ImportedOperatorDraft-compatible JSON object. No Markdown. No explanation. Prefer POST /api/operator/fill/check|apply with a JSON body for Chinese payloads; CLI JSON args may be shell-encoding sensitive. Use system skill keys in the latest format skill-{buttonType}-{index}, for example skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1; every buttonType counts from 1. Legacy skill-1 keys are accepted only for compatibility and will be normalized. Operator buffs use talent/potential/skill groups. Buff category must be passive/condition/countable; legacy positive is accepted only for migration and normalizes to passive. Countable buffs require maxStacks and only support fixed numeric value, no derivedValue. Fixed effects use valueMode fixed with numeric value. Derived effects use valueMode derived and derivedValue.source/perPointValue, where perPointValue means 每点提升多少, not an arbitrary formula. Percent-like buff types still use decimal numbers, e.g. 每点 +0.10% => 0.001. operator.fill.apply creates a proposal only; it does NOT save to library.',
        approvalSaveWarning: 'Approval applies to def.operator-editor.draft.v1. Save writes def.operator-editor.library.v1.',
      },
    };
  },

  applyToWorkingState(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, preserveExistingOperatorAssets(payload));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload): { ok: boolean; error?: string } {
    try {
      const mergedPayload = preserveExistingOperatorAssets(payload);
      writeJsonStorage(OPERATOR_LIBRARY_STORAGE_KEY, { ...readOperatorLibrary(), [mergedPayload.id]: mergedPayload });
      writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, mergedPayload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
