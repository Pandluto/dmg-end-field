import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../core/domain/buff';
import { normalizeBuffMultiplier, validateBuffMultiplierDefinition } from '../core/domain/buffMultiplier';
import { getBuffTypeRegistryEntry, getMultiplierSupportedBuffTypes, isMultiplierSupportedBuffType } from '../core/domain/buffTypeRegistry';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';

export const OPERATOR_BUFF_GROUPS = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
] as const;

export const OPERATOR_BUFF_CATEGORIES = ['passive', 'condition', 'countable'] as const;
export const MULTIPLIER_SUPPORTED_BUFF_TYPES = getMultiplierSupportedBuffTypes();
export const OPERATOR_BUFF_BUSINESS_TYPES = ['passive', 'condition', 'countable', 'multiplier', 'extraHit'] as const;

export const OPERATOR_BUFF_TYPE_OPTIONS = [
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
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
] as const;

export const OPERATOR_BUFF_TYPE_LABELS: Record<string, string> = {
  atkPercentBoost: '攻击力百分比',
  atk: '固定攻击力',
  flatAtk: '固定攻击力',
  mainStat: '主能力固定值',
  subStat: '副能力固定值',
  mainStatBoost: '主能力提升',
  subStatBoost: '副能力提升',
  allStatBoost: '全属性提升',
  strengthBoost: '力量提升',
  agilityBoost: '敏捷提升',
  intelligenceBoost: '智识提升',
  willBoost: '意志提升',
  hpPercent: '生命百分比',
  critRateBoost: '暴击率',
  critDmgBonusBoost: '暴击伤害',
  physicalDmgBonus: '物理伤害加成',
  magicDmgBonus: '法术伤害加成',
  fireDmgBonus: '灼热伤害加成',
  electricDmgBonus: '电磁伤害加成',
  iceDmgBonus: '寒冷伤害加成',
  natureDmgBonus: '自然伤害加成',
  allDmgBonus: '全伤害加成',
  skillDmgBonus: '战技伤害加成',
  chainSkillDmgBonus: '连携技伤害加成',
  ultimateDmgBonus: '终结技伤害加成',
  normalAttackDmgBonus: '普攻伤害加成',
  dotDmgBonus: '持续伤害加成',
  allSkillDmgBonus: '全技能伤害加成',
  imbalanceDmgBonus: '失衡伤害加成',
  physicalFragile: '物理易伤',
  fireFragile: '灼热易伤',
  electricFragile: '电磁易伤',
  iceFragile: '寒冷易伤',
  natureFragile: '自然易伤',
  magicFragile: '法术易伤',
  physicalVulnerability: '物理脆弱',
  fireVulnerability: '灼热脆弱',
  electricVulnerability: '电磁脆弱',
  iceVulnerability: '寒冷脆弱',
  natureVulnerability: '自然脆弱',
  magicVulnerability: '法术脆弱',
  physicalAmplify: '物理增幅',
  magicAmplify: '法术增幅',
  fireAmplify: '灼热增幅',
  electricAmplify: '电磁增幅',
  iceAmplify: '寒冷增幅',
  natureAmplify: '自然增幅',
  allCorrosion: '全属性降抗',
  physicalCorrosion: '物理降抗',
  magicCorrosion: '法术降抗',
  fireCorrosion: '灼热降抗',
  electricCorrosion: '电磁降抗',
  iceCorrosion: '寒冷降抗',
  natureCorrosion: '自然降抗',
  allResistanceIgnore: '无视全部抗性',
  physicalResistanceIgnore: '无视物理抗性',
  magicResistanceIgnore: '无视法术抗性',
  fireResistanceIgnore: '无视灼热抗性',
  electricResistanceIgnore: '无视电磁抗性',
  iceResistanceIgnore: '无视寒冷抗性',
  natureResistanceIgnore: '无视自然抗性',
  comboDamageBonus: '连击伤害加成',
  multiplierBonus: '倍率加算',
  sourceSkillBoost: '源石技艺强度',
  ultimateChargeEfficiency: '终结技充能效率',
  healingBonus: '治疗效率',
  receivedHealingBonus: '受治疗效率',
  chainCooldownReduction: '连携技冷却缩减',
  imbalanceEfficiency: '失衡效率',
  damageReduction: '伤害减免',
};

const OPERATOR_PERCENTLIKE_BUFF_TYPES = new Set([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
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
  'comboDamageBonus',
  'multiplierBonus',
]);

export const OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS = [
  { value: 'hp', label: '生命值' },
  { value: 'atk', label: '攻击力' },
  { value: 'strength', label: '力量' },
  { value: 'agility', label: '敏捷' },
  { value: 'intelligence', label: '智识' },
  { value: 'will', label: '意志' },
  { value: 'sourceSkill', label: '源石技艺强度' },
] as const;

export const OPERATOR_BUFF_DERIVED_SOURCE_LABELS = Object.fromEntries(
  OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<OperatorBuffDerivedSource, string>;

export type OperatorBuffGroupKey = (typeof OPERATOR_BUFF_GROUPS)[number]['key'];
export type OperatorBuffCategory = (typeof OPERATOR_BUFF_CATEGORIES)[number];
export type OperatorBuffBusinessType = (typeof OPERATOR_BUFF_BUSINESS_TYPES)[number];
export type OperatorBuffValueMode = 'fixed' | 'derived';
export type OperatorBuffDerivedSource = 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
export type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;

export interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

export interface OperatorBuffEffect {
  schemaVersion?: 2;
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  maxStacks?: number;
  unit?: 'flat' | 'percent' | string;
  condition?: string;
  description?: string;
  raw?: string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}

export function createDefaultBuffs(): OperatorBuffs {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

export function createDefaultBuffEffect(effectKey = 'effect1'): OperatorBuffEffect {
  return {
    effectId: effectKey,
    name: '新 Buff',
    type: '',
    category: 'passive',
    unit: '',
    valueMode: 'fixed',
    description: '',
    raw: '',
    effectKind: 'modifier',
  };
}

export function getOperatorBuffTypeLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return OPERATOR_BUFF_TYPE_LABELS[trimmed] ?? trimmed;
}

export function getOperatorBuffTypeDisplayLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return `${getOperatorBuffTypeLabel(trimmed)} · ${trimmed}`;
}

const OPERATOR_RUNTIME_COEFFICIENT_ZONES = new Set(['damageBonus', 'fragile', 'vulnerability', 'amplify']);
const OPERATOR_COUNTABLE_EXTRA_BUFF_TYPES = new Set([
  'atkPercentBoost',
  'critRateBoost',
  'critDmgBonusBoost',
]);
const OPERATOR_MULTIPLIER_BUFF_TYPES = new Set([
  'multiplierBonus',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
]);

export function isOperatorRuntimeCoefficientBuffType(buffType: string | undefined): boolean {
  const entry = getBuffTypeRegistryEntry(buffType);
  return Boolean(entry && OPERATOR_RUNTIME_COEFFICIENT_ZONES.has(entry.zone));
}

function isOperatorCountableBuffType(buffType: string | undefined): boolean {
  return isOperatorRuntimeCoefficientBuffType(buffType)
    || Boolean(buffType && OPERATOR_COUNTABLE_EXTRA_BUFF_TYPES.has(buffType));
}

export function deriveOperatorBuffBusinessType(effect: OperatorBuffEffect | null | undefined): OperatorBuffBusinessType {
  if (!effect) return 'passive';
  if (effect.effectKind === 'extraHit') {
    return effect.category === 'countable' ? 'extraHit' : 'passive';
  }
  if (normalizeBuffMultiplier(effect.multiplier)) return 'multiplier';
  if (effect.category === 'countable') return 'countable';
  if (effect.category === 'condition') return 'condition';
  return 'passive';
}

function normalizeTypeForBusinessType(type: string, businessType: OperatorBuffBusinessType): string {
  if (!type) return '';
  if (businessType === 'countable') {
    return isOperatorCountableBuffType(type) ? type : '';
  }
  if (businessType === 'multiplier') {
    return OPERATOR_MULTIPLIER_BUFF_TYPES.has(type) ? type : '';
  }
  return type;
}

export function inferOperatorBuffUnit(buffType: string): 'flat' | 'percent' {
  return OPERATOR_PERCENTLIKE_BUFF_TYPES.has(buffType.trim()) ? 'percent' : 'flat';
}

export function formatOperatorBuffPerPointValue(value: number) {
  return Number(value.toFixed(6)).toString();
}

export function buildOperatorBuffTypeSearchText(buffType: string, buildSearchIndex: (values: Array<string | undefined | null>) => string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '';
  return buildSearchIndex([trimmed, getOperatorBuffTypeLabel(trimmed), getOperatorBuffTypeDisplayLabel(trimmed)]);
}

export function getFilteredOperatorBuffTypeOptions(params: {
  query: string;
  selectedEffect: OperatorBuffEffect | null;
  buildSearchIndex: (values: Array<string | undefined | null>) => string;
}) {
  const keyword = params.query.trim().toLowerCase();
  const businessType = deriveOperatorBuffBusinessType(params.selectedEffect);
  const availableOptions = businessType === 'countable'
    ? OPERATOR_BUFF_TYPE_OPTIONS.filter((option) => isOperatorCountableBuffType(option))
    : businessType === 'multiplier'
      ? OPERATOR_BUFF_TYPE_OPTIONS.filter((option) => OPERATOR_MULTIPLIER_BUFF_TYPES.has(option))
      : OPERATOR_BUFF_TYPE_OPTIONS;
  const filtered = keyword
    ? availableOptions.filter((option) => buildOperatorBuffTypeSearchText(option, params.buildSearchIndex).toLowerCase().includes(keyword))
    : availableOptions;
  const selectedType = params.selectedEffect?.type?.trim();
  if (!selectedType || filtered.includes(selectedType as typeof OPERATOR_BUFF_TYPE_OPTIONS[number])) {
    return filtered;
  }
  return [selectedType, ...filtered];
}

export function normalizeBuffEffect(effectKey: string, rawEffect: unknown): OperatorBuffEffect {
  const source = rawEffect && typeof rawEffect === 'object' ? rawEffect as Record<string, unknown> : {};
  const isLegacySkillMultiplier = source.type === 'multiplierMultiplier';
  const rawCategory = typeof source.category === 'string' ? source.category : '';
  const normalizedCategory: OperatorBuffCategory = rawCategory === 'condition'
    ? 'condition'
    : rawCategory === 'countable'
      ? 'countable'
      : 'passive';
  const effectKind: BuffEffectKind = source.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const normalizedMultiplier = effectKind === 'extraHit'
    ? undefined
    : normalizeBuffMultiplier(source.multiplier)
      ?? (isLegacySkillMultiplier && typeof source.value === 'number' && Number.isFinite(source.value) && source.value > 0
        ? { coefficient: source.value }
        : undefined);
  const category: OperatorBuffCategory = effectKind === 'extraHit' && normalizedCategory !== 'countable'
    ? 'passive'
    : normalizedMultiplier
      ? 'condition'
      : normalizedCategory;
  const rawValue = source.value;
  const valueMode: OperatorBuffValueMode = effectKind === 'extraHit' || category === 'countable'
    ? 'fixed'
    : source.valueMode === 'derived' ? 'derived' : 'fixed';
  const rawDerivedValue = source.derivedValue && typeof source.derivedValue === 'object'
    ? source.derivedValue as Record<string, unknown>
    : {};
  const rawDerivedSource = typeof rawDerivedValue.source === 'string' ? rawDerivedValue.source : '';
  const derivedSource = OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.some((option) => option.value === rawDerivedSource)
    ? rawDerivedSource as OperatorBuffDerivedSource
    : null;
  const rawPerPointValue = rawDerivedValue.perPointValue ?? rawDerivedValue.scale;
  return {
    schemaVersion: 2,
    effectId: String(source.effectId || effectKey),
    name: String(source.name || effectKey),
    type: effectKind === 'extraHit' ? '' : isLegacySkillMultiplier ? 'multiplierBonus' : String(source.type || ''),
    category,
    ...(!isLegacySkillMultiplier && typeof rawValue === 'number' && Number.isFinite(rawValue) ? { value: rawValue } : {}),
    ...(category === 'countable' && typeof source.maxStacks === 'number' && Number.isFinite(source.maxStacks) ? { maxStacks: Math.max(1, Math.floor(source.maxStacks)) } : {}),
    unit: typeof source.unit === 'string' ? source.unit : '',
    condition: typeof source.condition === 'string' ? source.condition : '',
    valueMode,
    ...(valueMode === 'derived' && derivedSource && typeof rawPerPointValue === 'number' && Number.isFinite(rawPerPointValue)
      ? { derivedValue: { source: derivedSource, perPointValue: rawPerPointValue } }
      : {}),
    description: typeof source.description === 'string' ? source.description : '',
    raw: typeof source.raw === 'string' ? source.raw : '',
    effectKind,
    ...(normalizedMultiplier ? { multiplier: normalizedMultiplier } : {}),
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(source.extraHitConfig, `${effectKey}-extra-hit`) }
      : {}),
  };
}

export function validateRawDraftBuffMultipliers(rawDraft: { buffs?: unknown }) {
  const rawBuffs = rawDraft.buffs && typeof rawDraft.buffs === 'object'
    ? rawDraft.buffs as Record<string, unknown>
    : {};
  for (const { key: groupKey } of OPERATOR_BUFF_GROUPS) {
    const rawGroup = rawBuffs[groupKey] && typeof rawBuffs[groupKey] === 'object'
      ? rawBuffs[groupKey] as Record<string, unknown>
      : {};
    const rawEffects = rawGroup.effects && typeof rawGroup.effects === 'object'
      ? rawGroup.effects as Record<string, unknown>
      : {};
    for (const [effectKey, rawEffect] of Object.entries(rawEffects)) {
      if (!rawEffect || typeof rawEffect !== 'object') continue;
      const source = rawEffect as Record<string, unknown>;
      const isLegacySkillMultiplier = source.type === 'multiplierMultiplier';
      if (source.multiplier === undefined && !isLegacySkillMultiplier) continue;
      const multiplier = source.multiplier ?? (
        typeof source.value === 'number' ? { coefficient: source.value } : undefined
      );
      const errors = validateBuffMultiplierDefinition({
        type: isLegacySkillMultiplier ? 'multiplierBonus' : String(source.type || ''),
        category: source.category === 'countable'
          ? 'countable'
          : source.category === 'condition' ? 'condition' : 'passive',
        effectKind: source.effectKind === 'extraHit' ? 'extraHit' : 'modifier',
        multiplier: multiplier as BuffMultiplier | undefined,
      });
      if (errors.length > 0) {
        throw new Error(`${groupKey}.${effectKey}: ${errors[0]}`);
      }
    }
  }
}

export function normalizeBuffs(rawBuffs: unknown): OperatorBuffs {
  const source = rawBuffs && typeof rawBuffs === 'object' ? rawBuffs as Record<string, unknown> : {};
  return Object.fromEntries(
    OPERATOR_BUFF_GROUPS.map(({ key }) => {
      const rawGroup = source[key] && typeof source[key] === 'object' ? source[key] as Record<string, unknown> : {};
      const rawEffects = rawGroup.effects && typeof rawGroup.effects === 'object' ? rawGroup.effects as Record<string, unknown> : {};
      return [
        key,
        {
          effects: Object.fromEntries(
            Object.entries(rawEffects).map(([effectKey, rawEffect]) => [effectKey, normalizeBuffEffect(effectKey, rawEffect)]),
          ),
        },
      ];
    }),
  ) as OperatorBuffs;
}

export function validateDraftBuffEffects(draft: { buffs: OperatorBuffs }) {
  return OPERATOR_BUFF_GROUPS.flatMap(({ key: groupKey }) => (
    Object.entries(draft.buffs[groupKey].effects).flatMap(([effectKey, effect]) => (
      validateBuffMultiplierDefinition(effect).map((message) => `${groupKey}.${effectKey}: ${message}`)
    ))
  ));
}

export function getBuffEffectSummary(effect: OperatorBuffEffect) {
  const mode = effect.effectKind === 'extraHit'
    ? `${((effect.extraHitConfig?.baseMultiplier ?? 1) * 100).toFixed(0)}% ${effect.extraHitConfig?.damageType ?? 'physical'} / ${effect.extraHitConfig?.skillType || '空'} / ${effect.category === 'countable' ? `计层/${effect.maxStacks ?? 1}` : '常驻'}`
    : effect.category === 'condition' ? '条件' : effect.category === 'countable' ? `计层/${effect.maxStacks ?? 1}` : '常驻';
  if (effect.multiplier) {
    return `${mode} · 乘算 ×${effect.multiplier.coefficient}`;
  }
  if (effect.valueMode === 'derived' && effect.derivedValue) {
    return `${mode} · ${OPERATOR_BUFF_DERIVED_SOURCE_LABELS[effect.derivedValue.source]} 每点提升 ${formatOperatorBuffPerPointValue(effect.derivedValue.perPointValue)}`;
  }
  if (typeof effect.value === 'number') {
    return `${mode} · ${effect.value}${(effect.unit || inferOperatorBuffUnit(effect.type)) === 'percent' ? '%' : ''}`;
  }
  return mode;
}

export function applyBuffEffectKind(effect: OperatorBuffEffect, effectKind: BuffEffectKind, fallbackKey: string): OperatorBuffEffect {
  if (effectKind === 'extraHit') {
    return {
      ...effect,
      effectKind,
      type: '',
      value: undefined,
      valueMode: 'fixed',
      derivedValue: undefined,
      multiplier: undefined,
      category: effect.category === 'countable' ? 'countable' : 'passive',
      extraHitConfig: normalizeExtraHitConfig(effect.extraHitConfig, `${effect.effectId || fallbackKey}-extra-hit`),
    };
  }
  return {
    ...effect,
    effectKind,
    extraHitConfig: undefined,
  };
}

export function applyBuffBusinessType(effect: OperatorBuffEffect, businessType: OperatorBuffBusinessType, fallbackKey: string): OperatorBuffEffect {
  if (businessType === 'extraHit') {
    return {
      ...applyBuffEffectKind(effect, 'extraHit', fallbackKey),
      category: 'countable',
      maxStacks: effect.maxStacks ?? 1,
    };
  }

  if (businessType === 'passive' && effect.effectKind === 'extraHit') {
    const { maxStacks: _maxStacks, ...rest } = effect;
    return {
      ...rest,
      schemaVersion: 2,
      category: 'passive',
      valueMode: 'fixed',
      multiplier: undefined,
      derivedValue: undefined,
      extraHitConfig: normalizeExtraHitConfig(effect.extraHitConfig, `${effect.effectId || fallbackKey}-extra-hit`),
    };
  }

  const nextType = normalizeTypeForBusinessType(effect.type, businessType);
  const base = {
    ...effect,
    schemaVersion: 2 as const,
    effectKind: 'modifier' as const,
    extraHitConfig: undefined,
    type: nextType,
    unit: nextType ? inferOperatorBuffUnit(nextType) : '',
  };

  if (businessType === 'passive') {
    const { multiplier: _multiplier, maxStacks: _maxStacks, ...rest } = base;
    return {
      ...rest,
      category: 'passive',
      valueMode: rest.valueMode ?? 'fixed',
    };
  }

  if (businessType === 'condition') {
    const { multiplier: _multiplier, maxStacks: _maxStacks, ...rest } = base;
    return {
      ...rest,
      category: 'condition',
      valueMode: rest.valueMode ?? 'fixed',
    };
  }

  if (businessType === 'countable') {
    const { multiplier: _multiplier, derivedValue: _derivedValue, ...rest } = base;
    return {
      ...rest,
      category: 'countable',
      valueMode: 'fixed',
      maxStacks: effect.maxStacks ?? 1,
    };
  }

  const { value: _value, maxStacks: _maxStacks, derivedValue: _derivedValue, ...rest } = base;
  return {
    ...rest,
    category: 'condition',
    valueMode: 'fixed',
    multiplier: normalizeBuffMultiplier(effect.multiplier) ?? { coefficient: 1 },
  };
}

export function applyBuffType(effect: OperatorBuffEffect, nextType: string): OperatorBuffEffect {
  const businessType = deriveOperatorBuffBusinessType(effect);
  const normalizedType = normalizeTypeForBusinessType(nextType, businessType);
  return {
    ...effect,
    type: normalizedType,
    unit: normalizedType ? inferOperatorBuffUnit(normalizedType) : '',
    ...((businessType === 'multiplier' && !OPERATOR_MULTIPLIER_BUFF_TYPES.has(normalizedType)) || (!isMultiplierSupportedBuffType(normalizedType) && effect.multiplier)
      ? { multiplier: undefined }
      : {}),
  };
}

export function applyBuffCategory(effect: OperatorBuffEffect, nextCategory: OperatorBuffCategory): OperatorBuffEffect {
  return {
    ...effect,
    category: nextCategory,
    ...(nextCategory === 'countable'
      ? { valueMode: 'fixed' as const, derivedValue: undefined, maxStacks: effect.maxStacks ?? 1, multiplier: undefined }
      : {}),
  };
}

export function setBuffMultiplierEnabled(effect: OperatorBuffEffect, enabled: boolean): OperatorBuffEffect {
  if (!enabled) {
    const { multiplier: _multiplier, ...rest } = effect;
    return rest;
  }
  const nextType = isMultiplierSupportedBuffType(effect.type)
    ? effect.type
    : 'multiplierBonus';
  return {
    ...effect,
    type: nextType,
    unit: inferOperatorBuffUnit(nextType),
    category: 'condition',
    value: undefined,
    valueMode: 'fixed',
    derivedValue: undefined,
    multiplier: { coefficient: 1 },
  };
}

export function setBuffMultiplierCoefficient(effect: OperatorBuffEffect, coefficient: number | null | undefined): OperatorBuffEffect {
  return {
    ...effect,
    multiplier: { coefficient: coefficient ?? 1 },
  };
}

export function applyBuffValueMode(effect: OperatorBuffEffect, mode: OperatorBuffValueMode): OperatorBuffEffect {
  const nextMode = effect.category === 'countable' ? 'fixed' : mode;
  return {
    ...effect,
    valueMode: nextMode,
    ...(nextMode === 'derived' && !effect.derivedValue
      ? { derivedValue: { source: 'intelligence' as const, perPointValue: 0.001 } }
      : {}),
  };
}

export function applyFixedBuffValue(effect: OperatorBuffEffect, value: number | null | undefined): OperatorBuffEffect {
  if (value == null) {
    const { value: _value, ...rest } = effect;
    return rest;
  }
  return { ...effect, value };
}

export function applyDerivedBuffSource(effect: OperatorBuffEffect, source: OperatorBuffDerivedSource): OperatorBuffEffect {
  return {
    ...effect,
    valueMode: 'derived',
    derivedValue: {
      source,
      perPointValue: effect.derivedValue?.perPointValue ?? 0.001,
    },
  };
}

export function applyDerivedBuffPerPointValue(effect: OperatorBuffEffect, value: number | null | undefined): OperatorBuffEffect {
  return {
    ...effect,
    valueMode: 'derived',
    derivedValue: {
      source: effect.derivedValue?.source ?? 'intelligence',
      perPointValue: value ?? 0,
    },
  };
}

export function applyBuffMaxStacks(effect: OperatorBuffEffect, value: number | null | undefined): OperatorBuffEffect {
  return {
    ...effect,
    maxStacks: Math.max(1, value ?? 1),
    valueMode: 'fixed',
    derivedValue: undefined,
  };
}
