import { pinyin } from 'pinyin-pro';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import {
  getBuffTypeDisplayLabel as getCanonicalBuffTypeDisplayLabel,
  getBuffTypeLabel as getCanonicalBuffTypeLabel,
} from '../core/domain/buffTypeMetadata';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import {
  ATTACK_GROWTH_MILESTONE_KEYS,
  LEVEL_KEYS,
  SKILL1_BUFF_TYPE_MAP,
  SKILL2_BUFF_TYPE_MAP,
  SKILL_KEYS,
  type WeaponSkillKey,
} from './weaponDraftCatalog';

export type WeaponEffectBucket = 'value' | 'effect';

export interface WeaponEffectData {
  schemaVersion?: 2;
  effectId?: string;
  name: string;
  type: string;
  category: string;
  levels: Record<string, number>;
  valueMode?: buffModel.OperatorBuffValueMode;
  derivedValue?: buffModel.OperatorBuffDerivedValue;
  maxStacks?: number;
  unit?: string;
  description?: string;
  raw?: string;
  multiplier?: import('../core/domain/buff').BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface RawWeaponLevelData {
  value?: number;
  description?: string;
  passive?: Record<string, number>;
  effects?: Record<string, number>;
}

export interface RawWeaponSkillData {
  name?: string;
  statType?: string;
  effects?: Record<string, Partial<WeaponEffectData>>;
  /** @deprecated 旧格式，迁移到 effects */
  effectTypes?: Record<string, string>;
  /** @deprecated 旧格式，迁移到 effects */
  effectCategories?: Record<string, string>;
  levels?: Record<string, RawWeaponLevelData>;
}

export interface RawWeaponDraft {
  id?: string;
  name?: string;
  rarity?: number;
  type?: string;
  description?: string;
  imgUrl?: string;
  attackGrowth?: Record<string, number>;
  skills?: Record<string, RawWeaponSkillData>;
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

export type WeaponSheetRow =
  | {
      kind: 'weapon';
      key: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'growth';
      key: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'skill';
      key: string;
      skillKey: WeaponSkillKey;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'effect';
      key: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      sourceEffectKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'effectLevels';
      key: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      sourceEffectKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    };

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function buildWeaponIdFromName(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return '';
  }
  const rawPinyin = pinyin(trimmedName, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  const normalized = (rawPinyin || trimmedName.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

export function createEmptyWeaponLevelData(): WeaponLevelData {
  return {
    value: undefined,
    description: '',
  };
}

export function formatSkillDefaultName(skillKey: WeaponSkillKey) {
  if (skillKey === 'skill1') return '能力值';
  if (skillKey === 'skill2') return '属性';
  return '特效';
}

export function createEmptyWeaponSkillData(skillKey: WeaponSkillKey): WeaponSkillData {
  return {
    name: formatSkillDefaultName(skillKey),
    statType: '',
    effects: {},
    levels: Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => {
        const levelKey = String(index + 1);
        return [levelKey, createEmptyWeaponLevelData()];
      }),
    ) as Record<string, WeaponLevelData>,
  };
}

export function createEmptyWeaponDraft(nextId = 'custom-weapon-001'): WeaponDraft {
  return {
    id: nextId,
    name: '新建武器',
    rarity: 6,
    type: '',
    description: '',
    imgUrl: '',
    attackGrowth: {},
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };
}

export function normalizeWeaponDraft(raw: RawWeaponDraft | WeaponDraft | null | undefined): WeaponDraft {
  const fallbackId = buildWeaponIdFromName(raw?.name?.trim() || '') || 'custom-weapon-001';
  const nextDraft: WeaponDraft = {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId,
    name: raw?.name?.trim() || '未命名武器',
    rarity: Number(raw?.rarity ?? 6) || 6,
    type: raw?.type?.trim() || '',
    description: raw?.description?.trim() || '',
    imgUrl: raw?.imgUrl?.trim() || '',
    attackGrowth: Object.fromEntries(
      Object.entries(raw?.attackGrowth ?? {}).filter(([, value]) => typeof value === 'number')
    ),
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };

  SKILL_KEYS.forEach((skillKey) => {
    const sourceSkill = raw?.skills?.[skillKey];
    const nextSkill = createEmptyWeaponSkillData(skillKey);
    nextSkill.name = sourceSkill?.name?.trim() || formatSkillDefaultName(skillKey);
    nextSkill.statType = sourceSkill?.statType?.trim() || '';
    const rawSkill = sourceSkill as RawWeaponSkillData | undefined;
    const hasNewEffects = rawSkill?.effects && Object.keys(rawSkill.effects).length > 0;
    const hasOldEffects = (rawSkill?.effectTypes && Object.keys(rawSkill.effectTypes).length > 0)
      || (rawSkill?.effectCategories && Object.keys(rawSkill.effectCategories).length > 0);

    if (skillKey === 'skill3' && hasNewEffects) {
      Object.entries(rawSkill.effects!).forEach(([key, effect]) => {
        if (!key.trim()) return;
        const levels: Record<string, number> = {};
        LEVEL_KEYS.forEach((levelKey) => {
          const value = effect?.levels?.[levelKey];
          if (typeof value === 'number') levels[levelKey] = value;
        });
        if (Object.keys(levels).length > 0) {
          const normalized = buffModel.normalizeBuffEffect(key, effect);
          nextSkill.effects[key] = {
            ...normalized,
            effectId: normalized.effectId,
            name: effect?.name?.trim() || key,
            levels,
          };
        }
      });
    } else if (skillKey === 'skill3' && hasOldEffects) {
      const effectKeys = new Set<string>();
      Object.keys(rawSkill?.effectCategories ?? {}).forEach((key) => effectKeys.add(key));
      Object.keys(rawSkill?.effectTypes ?? {}).forEach((key) => effectKeys.add(key));
      const sourceLevels = rawSkill?.levels ?? {};
      Object.values(sourceLevels).forEach((level) => {
        if (!level) return;
        Object.keys(level.passive ?? {}).forEach((key) => effectKeys.add(key));
        Object.keys(level.effects ?? {}).forEach((key) => effectKeys.add(key));
      });

      Array.from(effectKeys).forEach((effectKey) => {
        const type = (rawSkill?.effectTypes?.[effectKey] || '').trim();
        const rawCategory = rawSkill?.effectCategories?.[effectKey];
        const category = typeof rawCategory === 'string' && rawCategory.trim()
          ? rawCategory.trim()
          : LEVEL_KEYS.some((levelKey) => typeof sourceLevels?.[levelKey]?.passive?.[effectKey] === 'number')
            ? 'passive'
            : 'condition';
        const levels: Record<string, number> = {};
        LEVEL_KEYS.forEach((levelKey) => {
          const rawLevel = sourceLevels?.[levelKey];
          if (!rawLevel) return;
          const value = rawLevel.passive?.[effectKey] ?? rawLevel.effects?.[effectKey];
          if (typeof value === 'number') levels[levelKey] = value;
        });
        if (Object.keys(levels).length > 0) {
          nextSkill.effects[effectKey] = {
            schemaVersion: 2,
            effectId: effectKey,
            name: effectKey,
            type,
            category,
            levels,
            valueMode: 'fixed',
            effectKind: 'modifier',
          };
        }
      });
    }

    Array.from({ length: 9 }, (_, index) => String(index + 1)).forEach((levelKey) => {
      const level = sourceSkill?.levels?.[levelKey];
      nextSkill.levels[levelKey] = {
        value: typeof level?.value === 'number' ? level.value : undefined,
        description: level?.description?.trim() || '',
      };
    });

    nextDraft.skills[skillKey] = nextSkill;
  });

  return nextDraft;
}

export function projectWeaponEffectForLevel(
  effectKey: string,
  effect: WeaponEffectData,
  levelKey: string,
): buffModel.OperatorBuffEffect {
  const normalized = buffModel.normalizeBuffEffect(effectKey, effect);
  const levelValue = effect.levels[levelKey];
  const businessType = buffModel.deriveOperatorBuffBusinessType(normalized);
  if (normalized.effectKind === 'extraHit') {
    const config = normalizeExtraHitConfig(normalized.extraHitConfig, `${effectKey}-extra-hit`);
    return {
      ...normalized,
      extraHitConfig: normalizeExtraHitConfig({
        ...config,
        baseMultiplier: typeof levelValue === 'number' ? levelValue : config.baseMultiplier,
      }, config.key),
    };
  }
  if (businessType === 'multiplier') {
    return {
      ...normalized,
      multiplier: {
        coefficient: typeof levelValue === 'number'
          ? levelValue
          : normalized.multiplier?.coefficient ?? 1,
      },
    };
  }
  if (normalized.valueMode === 'derived') {
    return {
      ...normalized,
      derivedValue: {
        source: normalized.derivedValue?.source ?? 'intelligence',
        perPointValue: typeof levelValue === 'number'
          ? levelValue
          : normalized.derivedValue?.perPointValue ?? 0,
      },
    };
  }
  return { ...normalized, value: levelValue };
}

export function applyWeaponDrawerEffect(
  effect: WeaponEffectData,
  levelKey: string,
  next: buffModel.OperatorBuffEffect,
): WeaponEffectData {
  const businessType = buffModel.deriveOperatorBuffBusinessType(next);
  const nextLevelValue = next.effectKind === 'extraHit'
    ? next.extraHitConfig?.baseMultiplier
    : businessType === 'multiplier'
      ? next.multiplier?.coefficient
      : next.valueMode === 'derived'
        ? next.derivedValue?.perPointValue
        : next.value;
  return {
    ...effect,
    ...next,
    category: next.category,
    levels: {
      ...effect.levels,
      ...(typeof nextLevelValue === 'number' && Number.isFinite(nextLevelValue)
        ? { [levelKey]: nextLevelValue }
        : {}),
    },
  };
}

export function buildNextCustomWeaponId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-weapon-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-weapon-${String(index).padStart(3, '0')}`;
}

export function getSkillAutoBuffType(skillKey: WeaponSkillKey, statType: string) {
  const trimmed = statType.trim();
  if (!trimmed) {
    return '';
  }
  if (skillKey === 'skill1') {
    return SKILL1_BUFF_TYPE_MAP[trimmed] ?? '';
  }
  if (skillKey === 'skill2') {
    return SKILL2_BUFF_TYPE_MAP[trimmed] ?? '';
  }
  return '';
}

export function getBuffTypeLabel(buffType: string) {
  return getCanonicalBuffTypeLabel(buffType, { emptyLabel: '-' });
}

export function getBuffTypeDisplayLabel(buffType: string) {
  return getCanonicalBuffTypeDisplayLabel(buffType, { emptyLabel: '-' });
}

export function buildSearchIndex(values: Array<string | undefined | null>) {
  const tokens = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const joined = tokens.join(' ');
  if (!joined) {
    return '';
  }
  const fullPinyin = pinyin(joined, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join(' ');
  const initials = pinyin(joined, { toneType: 'none', pattern: 'first', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  return [joined, joined.toLowerCase(), fullPinyin, initials].filter(Boolean).join(' | ');
}

export function decodeWeaponImageDisplayUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed.replace(/%([0-9A-Fa-f]{2})/g, (match) => {
      try {
        return decodeURIComponent(match);
      } catch {
        return match;
      }
    });
  }
}

export function formatWeaponImageCellValue(url: string) {
  const decoded = decodeWeaponImageDisplayUrl(url);
  if (!decoded) {
    return '占位';
  }
  if (decoded.length <= 36) {
    return decoded;
  }
  return `...${decoded.slice(-33)}`;
}

export function getEffectBuffType(
  skillKey: WeaponSkillKey,
  skill: WeaponSkillData,
  effectKey: string,
) {
  if (skillKey === 'skill1' || skillKey === 'skill2') {
    return getSkillAutoBuffType(skillKey, skill.statType);
  }
  return skill.effects[effectKey]?.type || '';
}

export const EFFECT_CATEGORY_OPTIONS = [
  { value: 'passive', label: '常驻 · passive' },
  { value: 'condition', label: '条件 · condition' },
  { value: 'countable', label: '计层 · countable' },
  { value: 'multiplier', label: '乘算 · multiplier' },
  { value: 'extraHit', label: '计层额外伤害段 · countable extraHit' },
];

export function getEffectCategoryLabel(category: string) {
  return EFFECT_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? '条件触发';
}

export function getEffectCategory(
  skillKey: WeaponSkillKey,
  skill: WeaponSkillData,
  effectKey: string,
): string {
  if (skillKey === 'skill1' || skillKey === 'skill2') {
    return 'condition';
  }
  const effect = skill.effects[effectKey];
  return effect
    ? buffModel.deriveOperatorBuffBusinessType(buffModel.normalizeBuffEffect(effectKey, effect))
    : 'condition';
}

export function autoFillAttackGrowthMilestones(attackGrowth: Record<string, number>) {
  const nextGrowth = { ...attackGrowth };
  const start = nextGrowth['1'];
  const end = nextGrowth['90'];
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return nextGrowth;
  }
  ATTACK_GROWTH_MILESTONE_KEYS.forEach((levelKey) => {
    if (levelKey === '1' || levelKey === '90') {
      return;
    }
    const ratio = (Number(levelKey) - 1) / 89;
    nextGrowth[levelKey] = Math.round(start + (end - start) * ratio);
  });
  return nextGrowth;
}

export function applyAttackGrowthInterpolation(draft: WeaponDraft) {
  return {
    ...draft,
    attackGrowth: autoFillAttackGrowthMilestones(draft.attackGrowth),
  };
}

export function getWeaponLevelCoordinate(levelKey: string): number {
  const level = Number(levelKey);
  if (level >= 9) return 9;
  return Math.max(0, level - 1);
}

export function roundLevelValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function interpolateWeaponLevelValues(
  sourceLevels: Record<string, number | undefined>,
): Record<string, number> | null {
  const anchors = LEVEL_KEYS
    .map((levelKey) => ({
      levelKey,
      coordinate: getWeaponLevelCoordinate(levelKey),
      value: sourceLevels[levelKey],
    }))
    .filter((entry): entry is { levelKey: string; coordinate: number; value: number } => (
      typeof entry.value === 'number' && Number.isFinite(entry.value)
    ));
  if (anchors.length < 2) {
    return null;
  }
  const [first, second] = anchors;
  const coordinateDiff = second.coordinate - first.coordinate;
  if (coordinateDiff === 0) {
    return null;
  }
  const step = (second.value - first.value) / coordinateDiff;
  const base = first.value - step * first.coordinate;
  return Object.fromEntries(
    LEVEL_KEYS.map((levelKey) => [
      levelKey,
      roundLevelValue(base + step * getWeaponLevelCoordinate(levelKey)),
    ]),
  );
}

export function applyEffectLevelsInterpolation(
  draft: WeaponDraft,
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  if (bucket === 'value' || skillKey !== 'skill3') {
    return draft;
  }
  const effect = draft.skills[skillKey].effects[effectKey];
  if (!effect) return draft;
  const interpolatedLevels = interpolateWeaponLevelValues(effect.levels);
  if (!interpolatedLevels) {
    return draft;
  }
  const nextEffectLevels = { ...effect.levels };
  LEVEL_KEYS.forEach((levelKey) => {
    nextEffectLevels[levelKey] = interpolatedLevels[levelKey];
  });
  return {
    ...draft,
    skills: {
      ...draft.skills,
      [skillKey]: {
        ...draft.skills[skillKey],
        effects: {
          ...draft.skills[skillKey].effects,
          [effectKey]: { ...effect, levels: nextEffectLevels },
        },
      },
    },
  };
}

export function buildWeaponEffectRowKey(
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  return bucket === 'value'
    ? `effect-${skillKey}-value`
    : `effect-${skillKey}-effect-${effectKey}`;
}

export function buildWeaponEffectLevelsRowKey(
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  return bucket === 'value'
    ? `effect-levels-${skillKey}-value`
    : `effect-levels-${skillKey}-effect-${effectKey}`;
}

export function buildWeaponEffectIdText(skillKey: WeaponSkillKey, effectIndex: number) {
  return `${skillKey}-effect${effectIndex}`;
}

export function parseInlineLevelAddress(address?: string | null) {
  if (!address) {
    return '';
  }
  const match = /^Lv([1-9])$/i.exec(address.trim());
  return match?.[1] ?? '';
}

export function buildWeaponSheetRows(draft: WeaponDraft): WeaponSheetRow[] {
  const rows: WeaponSheetRow[] = [
    {
      kind: 'weapon',
      key: `weapon-${draft.id}`,
      title: draft.name,
      idText: draft.id,
      slot: formatWeaponImageCellValue(draft.imgUrl),
      level: '-',
      effectKey: '-',
      valueText: `${draft.rarity}★`,
      description: draft.description || '-',
      searchText: buildSearchIndex([
        draft.name,
        draft.id,
        draft.type,
        draft.description,
        draft.imgUrl,
        String(draft.attackGrowth['1'] ?? ''),
        String(draft.attackGrowth['90'] ?? ''),
      ]),
    },
    {
      kind: 'growth',
      key: `growth-${draft.id}`,
      title: '攻击成长',
      idText: '',
      slot: '',
      level: '',
      effectKey: '',
      valueText: '',
      description: '',
      searchText: buildSearchIndex([
        '攻击成长',
        ...ATTACK_GROWTH_MILESTONE_KEYS.map(
          (levelKey) => `Lv${levelKey} ${draft.attackGrowth[levelKey] ?? ''}`,
        ),
      ]),
    },
  ];

  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const hasValue = LEVEL_KEYS.some((levelKey) => typeof skill.levels[levelKey].value === 'number');
    const effectCount = skillKey === 'skill3'
      ? Object.keys(skill.effects).length + (hasValue ? 1 : 0)
      : 1;
    rows.push({
      kind: 'skill',
      key: `skill-${skillKey}`,
      skillKey,
      title: skill.name || formatSkillDefaultName(skillKey),
      idText: skillKey,
      slot: skillKey === 'skill3'
        ? '-'
        : getBuffTypeDisplayLabel(getSkillAutoBuffType(skillKey, skill.statType)),
      level: '-',
      effectKey: `${effectCount} 个效果`,
      valueText: '-',
      description: '',
      searchText: buildSearchIndex([
        skillKey,
        skill.name,
        skill.statType,
        getSkillAutoBuffType(skillKey, skill.statType),
      ]),
    });

    if (skillKey !== 'skill3') {
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: skill.statType || '未设置',
        idText: `${skillKey}-series`,
        slot: getBuffTypeDisplayLabel(getSkillAutoBuffType(skillKey, skill.statType)),
        level: 'Lv1~Lv9',
        effectKey: skill.statType || '-',
        valueText: `${LEVEL_KEYS.filter(
          (levelKey) => typeof skill.levels[levelKey].value === 'number',
        ).length} 个等级`,
        description: skillKey === 'skill1' ? '能力值曲线' : '属性曲线',
        searchText: buildSearchIndex([
          skill.name,
          skillKey,
          skill.statType,
          getSkillAutoBuffType(skillKey, skill.statType),
        ]),
      });
      rows.push({
        kind: 'effectLevels',
        key: buildWeaponEffectLevelsRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'Lv',
        idText: '',
        slot: '',
        level: '',
        effectKey: '',
        valueText: '',
        description: '',
        searchText: buildSearchIndex([
          skill.name,
          skillKey,
          skill.statType,
          getSkillAutoBuffType(skillKey, skill.statType),
          'levels',
        ]),
      });
      return;
    }

    let skill3EffectIndex = 1;
    if (hasValue) {
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'value',
        idText: buildWeaponEffectIdText(skillKey, skill3EffectIndex),
        slot: 'value',
        level: 'Lv1~Lv9',
        effectKey: 'value',
        valueText: `${LEVEL_KEYS.filter(
          (levelKey) => typeof skill.levels[levelKey].value === 'number',
        ).length} 个等级`,
        description: '技能主数值',
        searchText: buildSearchIndex([skill.name, skillKey, 'value']),
      });
      skill3EffectIndex += 1;
      rows.push({
        kind: 'effectLevels',
        key: buildWeaponEffectLevelsRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'Lv',
        idText: '',
        slot: '',
        level: '',
        effectKey: '',
        valueText: '',
        description: '',
        searchText: buildSearchIndex([skill.name, skillKey, 'value', 'levels']),
      });
    }

    Object.entries(skill.effects).forEach(([effectKey, effectData]) => {
      const buffType = effectData.type;
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, 'effect', effectKey),
        skillKey,
        bucket: 'effect',
        sourceEffectKey: effectKey,
        title: effectData.name,
        idText: buildWeaponEffectIdText(skillKey, skill3EffectIndex),
        slot: getEffectCategoryLabel(getEffectCategory(skillKey, skill, effectKey)),
        level: 'Lv1~Lv9',
        effectKey: effectData.effectKind === 'extraHit'
          ? `${effectData.extraHitConfig?.damageType || 'physical'} / ${effectData.extraHitConfig?.skillType || '空'}`
          : effectKey,
        valueText: `${Object.keys(effectData.levels).length} 个等级`,
        description: '',
        searchText: buildSearchIndex([
          skill.name,
          skillKey,
          effectData.name,
          effectKey,
          buffType,
          getBuffTypeLabel(buffType),
        ]),
      });
      skill3EffectIndex += 1;
      rows.push({
        kind: 'effectLevels',
        key: buildWeaponEffectLevelsRowKey(skillKey, 'effect', effectKey),
        skillKey,
        bucket: 'effect',
        sourceEffectKey: effectKey,
        title: 'Lv',
        idText: '',
        slot: '',
        level: '',
        effectKey: '',
        valueText: '',
        description: '',
        searchText: buildSearchIndex([
          skill.name,
          skillKey,
          effectData.name,
          effectKey,
          buffType,
          getBuffTypeLabel(buffType),
          'levels',
        ]),
      });
    });
  });

  return rows;
}

export function moveRecordEntry<T>(record: Record<string, T>, fromKey: string, toKey: string) {
  const entries = Object.entries(record);
  const fromIndex = entries.findIndex(([key]) => key === fromKey);
  const toIndex = entries.findIndex(([key]) => key === toKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return record;
  }
  const nextEntries = [...entries];
  const [movedEntry] = nextEntries.splice(fromIndex, 1);
  nextEntries.splice(toIndex, 0, movedEntry);
  return Object.fromEntries(nextEntries) as Record<string, T>;
}

export function reorderWeaponDraft(draft: WeaponDraft): WeaponDraft {
  const nextSkills: Record<string, WeaponSkillData> = {};
  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const nextSkill: WeaponSkillData = {
      ...skill,
      effects: { ...skill.effects },
      levels: JSON.parse(JSON.stringify(skill.levels)),
    };

    if (skillKey === 'skill3') {
      const effectEntries = Object.entries(nextSkill.effects);
      const nextEffects: Record<string, WeaponEffectData> = {};
      effectEntries.forEach(([, effectData], index) => {
        nextEffects[`effect${index + 1}`] = effectData;
      });
      nextSkill.effects = nextEffects;
    }

    nextSkills[skillKey] = nextSkill;
  });

  return {
    ...draft,
    skills: nextSkills as Record<WeaponSkillKey, WeaponSkillData>,
  };
}
