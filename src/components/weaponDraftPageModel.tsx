import type * as React from 'react';
import { pinyin } from 'pinyin-pro';
import { APP_ROUTE_PATHS } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import { getUserImageUrl } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';

export const WEAPON_SHEET_PAGE_PATH = APP_ROUTE_PATHS.weaponSheet;
export const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
export const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
export const WEAPON_LIBRARY_SHARE_TYPE = 'weapon-library-share.v1';

export type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
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

export interface WeaponImageOption {
  key: string;
  fileName: string;
  baseName: string;
  relativePath: string;
  source: 'builtin' | 'user';
  displayUrl: string;
  searchText: string;
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

export interface WeaponSheetColumn {
  key: 'name' | 'idText' | 'slot' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface WeaponWorkbookCell {
  key: string;
  address: string;
  value: string;
  columnKey: WeaponSheetColumn['key'];
  width: number;
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

export interface WeaponWorkbookRow {
  key: string;
  rowNumber: number;
  kind: WeaponSheetRow['kind'];
  sourceRow: WeaponSheetRow;
  cells: WeaponWorkbookCell[];
}

export interface WeaponWorkbookSelection {
  address: string;
  sourceRowKey: string;
  columnKey: WeaponSheetColumn['key'];
}

export interface FormulaBinding {
  key: string;
  focusId: string;
  inputMode: 'text' | 'number';
  value: string;
  placeholder: string;
  control?: 'input' | 'select' | 'search-select' | 'image-search-select';
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
  onValueChange?: (value: string) => void;
  apply: (draft: WeaponDraft, rawInput: string) => WeaponDraft;
}

export type WeaponExplorerDragNode =
  | {
      kind: 'draft';
      draftId: string;
    }
  | {
      kind: 'skill';
      draftId: string;
      skillKey: WeaponSkillKey;
    }
  | {
      kind: 'effect';
      draftId: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      effectKey: string;
    };

export type WeaponExplorerDragState = {
  source: WeaponExplorerDragNode;
  over: WeaponExplorerDragNode | null;
  x: number;
  y: number;
};

export type WeaponSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'skill' | 'effect';
  draftId?: string;
  skillKey?: WeaponSkillKey;
  effectKey?: string;
  bucket?: WeaponEffectBucket;
};

export type WeaponSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};

export const SKILL_KEYS: WeaponSkillKey[] = ['skill1', 'skill2', 'skill3'];
export const LEVEL_KEYS = Array.from({ length: 9 }, (_, index) => String(index + 1));
export const ATTACK_GROWTH_MILESTONE_KEYS = ['1', '10', '20', '30', '40', '50', '60', '70', '80', '90'] as const;
export const SKILL1_OPTIONS = ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升', '副能力提升'] as const;
export const SKILL2_OPTIONS = ['攻击提升', '生命提升', '物理伤害提升', '灼热伤害提升', '电磁伤害提升', '寒冷伤害提升', '自然伤害提升', '暴击率提升', '源石技艺提升', '终结技充能效率提升', '法术伤害提升', '治疗效率提升'] as const;
export const WEAPON_BUFF_TYPE_OPTIONS = [
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
] as const;
export const WEAPON_BUFF_TYPE_LABELS: Record<string, string> = {
  atkPercentBoost: '攻击力百分比',
  flatAtk: '固定攻击力',
  mainStatBoost: '主能力提升',
  subStatBoost: '副能力提升',
  allStatBoost: '全属性提升',
  strengthBoost: '力量提升',
  agilityBoost: '敏捷提升',
  intelligenceBoost: '智识提升',
  willBoost: '意志提升',
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
  multiplierMultiplier: '倍率乘算',
  sourceSkillBoost: '源石技艺强度',
  hp: '生命',
  healingBonus: '治疗效率',
  ultimateChargeEfficiency: '终结技充能效率',
};
export const SKILL1_BUFF_TYPE_MAP: Record<string, string> = {
  敏捷提升: 'agilityBoost',
  力量提升: 'strengthBoost',
  意志提升: 'willBoost',
  智识提升: 'intelligenceBoost',
  主能力提升: 'mainStatBoost',
  副能力提升: 'subStatBoost',
};
export const SKILL2_BUFF_TYPE_MAP: Record<string, string> = {
  攻击提升: 'atkPercentBoost',
  生命提升: 'hp',
  物理伤害提升: 'physicalDmgBonus',
  灼热伤害提升: 'fireDmgBonus',
  电磁伤害提升: 'electricDmgBonus',
  寒冷伤害提升: 'iceDmgBonus',
  自然伤害提升: 'natureDmgBonus',
  暴击率提升: 'critRateBoost',
  源石技艺提升: 'sourceSkillBoost',
  终结技充能效率提升: 'ultimateChargeEfficiency',
  法术伤害提升: 'magicDmgBonus',
  治疗效率提升: 'healingBonus',
};

export function isWeaponSheetPath(pathname: string) {
  return pathname === WEAPON_SHEET_PAGE_PATH;
}

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
    // 转换为 Raw 类型以便统一访问所有字段
    const rawSkill = sourceSkill as RawWeaponSkillData | undefined;
    // 检测格式：新格式有 effects，旧格式有 effectTypes/effectCategories
    const hasNewEffects = rawSkill?.effects && Object.keys(rawSkill.effects).length > 0;
    const hasOldEffects = (rawSkill?.effectTypes && Object.keys(rawSkill.effectTypes).length > 0)
      || (rawSkill?.effectCategories && Object.keys(rawSkill.effectCategories).length > 0);

    if (skillKey === 'skill3' && hasNewEffects) {
      // 新格式：直接复制 effects，过滤无效条目
      Object.entries(rawSkill!.effects!).forEach(([key, effect]) => {
        if (!key.trim()) return;
        const levels: Record<string, number> = {};
        LEVEL_KEYS.forEach((levelKey) => {
          const v = effect?.levels?.[levelKey];
          if (typeof v === 'number') levels[levelKey] = v;
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
      // 旧格式迁移：从 effectTypes/effectCategories + level.passive/effects 收集
      const effectKeys = new Set<string>();
      Object.keys(rawSkill?.effectCategories ?? {}).forEach((key) => effectKeys.add(key));
      Object.keys(rawSkill?.effectTypes ?? {}).forEach((key) => effectKeys.add(key));
      const sourceLevels = rawSkill?.levels ?? {};
      Object.values(sourceLevels).forEach((level) => {
        if (level) {
          Object.keys(level.passive ?? {}).forEach((key) => effectKeys.add(key));
          Object.keys(level.effects ?? {}).forEach((key) => effectKeys.add(key));
        }
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
          const v = rawLevel.passive?.[effectKey]
            ?? rawLevel.effects?.[effectKey];
          if (typeof v === 'number') levels[levelKey] = v;
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
    // skill1/skill2 不需要 effects

    // 复制 level 数据（只保留 value 和 description）
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

export function projectWeaponEffectForLevel(effectKey: string, effect: WeaponEffectData, levelKey: string): buffModel.OperatorBuffEffect {
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
      multiplier: { coefficient: typeof levelValue === 'number' ? levelValue : normalized.multiplier?.coefficient ?? 1 },
    };
  }
  if (normalized.valueMode === 'derived') {
    return {
      ...normalized,
      derivedValue: {
        source: normalized.derivedValue?.source ?? 'intelligence',
        perPointValue: typeof levelValue === 'number' ? levelValue : normalized.derivedValue?.perPointValue ?? 0,
      },
    };
  }
  return { ...normalized, value: levelValue };
}

export function applyWeaponDrawerEffect(effect: WeaponEffectData, levelKey: string, next: buffModel.OperatorBuffEffect): WeaponEffectData {
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
      ...(typeof nextLevelValue === 'number' && Number.isFinite(nextLevelValue) ? { [levelKey]: nextLevelValue } : {}),
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

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadLocalWeaponLibrary() {
  const raw = readLocalStorageJson<Record<string, RawWeaponDraft>>(WEAPON_LIBRARY_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...draftValue, id: draftId })]),
  ) as Record<string, WeaponDraft>;
}

export function loadDraftFromStorage() {
  const raw = readLocalStorageJson<RawWeaponDraft | null>(WEAPON_DRAFT_STORAGE_KEY, null);
  if (!raw) {
    return createEmptyWeaponDraft();
  }
  return normalizeWeaponDraft(raw);
}

export function buildWeaponSheetColumns(): WeaponSheetColumn[] {
  return [
    { key: 'name', title: '名称', width: 220 },
    { key: 'idText', title: 'ID', width: 120 },
    { key: 'slot', title: '字段', width: 220, align: 'center' },
    { key: 'level', title: '等级', width: 72, align: 'center' },
    { key: 'effectKey', title: '效果键', width: 180 },
    { key: 'valueText', title: '数值', width: 110, align: 'right' },
    { key: 'description', title: '描述', width: 420 },
  ];
}

export function formatSkillDefaultName(skillKey: WeaponSkillKey) {
  if (skillKey === 'skill1') return '能力值';
  if (skillKey === 'skill2') return '属性';
  return '特效';
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
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '-';
  }
  return WEAPON_BUFF_TYPE_LABELS[trimmed] ?? trimmed;
}

export function getBuffTypeDisplayLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '-';
  }
  return `${getBuffTypeLabel(trimmed)} · ${trimmed}`;
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

export function buildBuffTypeSearchText(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '';
  }
  return buildSearchIndex([trimmed, getBuffTypeLabel(trimmed), getBuffTypeDisplayLabel(trimmed)]);
}

export function buildWeaponImageAssetUrl(entry: ImageAssetEntry) {
  const userUrl = getUserImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

export function buildWeaponImageOption(entry: ImageAssetEntry): WeaponImageOption | null {
  if (entry.kind === 'dir') return null;
  const displayUrl = buildWeaponImageAssetUrl(entry);
  const source = entry.source === 'release' || entry.source === 'user' || entry.source === 'legacy' ? 'user' : 'builtin';
  return {
    key: entry.relativePath,
    fileName: entry.fileName,
    baseName: entry.baseName,
    relativePath: entry.relativePath,
    source,
    displayUrl,
    searchText: buildSearchIndex([entry.fileName, entry.baseName, entry.relativePath, displayUrl, source]),
  };
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

export function getEffectBuffType(skillKey: WeaponSkillKey, skill: WeaponSkillData, effectKey: string) {
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

export function getEffectCategory(skillKey: WeaponSkillKey, skill: WeaponSkillData, effectKey: string): string {
  if (skillKey === 'skill1' || skillKey === 'skill2') {
    return 'condition';
  }
  const effect = skill.effects[effectKey];
  return effect ? buffModel.deriveOperatorBuffBusinessType(buffModel.normalizeBuffEffect(effectKey, effect)) : 'condition';
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

export function interpolateWeaponLevelValues(sourceLevels: Record<string, number | undefined>): Record<string, number> | null {
  const anchors = LEVEL_KEYS
    .map((levelKey) => ({ levelKey, coordinate: getWeaponLevelCoordinate(levelKey), value: sourceLevels[levelKey] }))
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
    LEVEL_KEYS.map((levelKey) => [levelKey, roundLevelValue(base + step * getWeaponLevelCoordinate(levelKey))]),
  );
}

export function applyEffectLevelsInterpolation(
  draft: WeaponDraft,
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  if (bucket === 'value') {
    return draft;
  }
  if (skillKey !== 'skill3') {
    return draft;
  }
  // effect bucket: read/write from skill.effects[effectKey].levels
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

export function buildWeaponEffectIdText(
  skillKey: WeaponSkillKey,
  effectIndex: number,
) {
  return `${skillKey}-effect${effectIndex}`;
}

export function parseInlineLevelAddress(address?: string | null) {
  if (!address) {
    return '';
  }
  const match = /^Lv([1-9])$/i.exec(address.trim());
  return match?.[1] ?? '';
}

/**
 * Sheet-Weapon 是表格式编辑器，不允许浏览器 number input 的默认 stepper 行为干扰单元格编辑语义。
 * 此函数用于拦截键盘事件，防止方向键、Backspace 等按键冒泡到外层的表格导航逻辑。
 */
export function stopEditingKeyPropagation(event: React.KeyboardEvent<HTMLInputElement>, options?: { isNumberInput?: boolean }) {
  const { isNumberInput = false } = options ?? {};

  // 对所有输入框：阻止 Backspace/Delete 冒泡，防止触发外层行为
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.stopPropagation();
    return;
  }

  // 对所有输入框：阻止 Home/End 冒泡
  if (event.key === 'Home' || event.key === 'End') {
    event.stopPropagation();
    return;
  }

  // 对 number input：阻止上下方向键的默认增减值行为，并阻止冒泡
  if (isNumberInput && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  // 对所有输入框：阻止左右方向键冒泡（但保留默认光标移动行为）
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.stopPropagation();
    return;
  }

  // 阻止上下方向键冒泡（文本输入框保留默认行为，只阻止冒泡）
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.stopPropagation();
    return;
  }
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
      searchText: buildSearchIndex([draft.name, draft.id, draft.type, draft.description, draft.imgUrl, String(draft.attackGrowth['1'] ?? ''), String(draft.attackGrowth['90'] ?? '')]),
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
      searchText: buildSearchIndex(['攻击成长', ...ATTACK_GROWTH_MILESTONE_KEYS.map((levelKey) => `Lv${levelKey} ${draft.attackGrowth[levelKey] ?? ''}`)]),
    },
  ];

  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const hasValue = LEVEL_KEYS.some((lk) => typeof skill.levels[lk].value === 'number');
    const effectCount = skillKey === 'skill3'
      ? Object.keys(skill.effects).length + (hasValue ? 1 : 0)
      : 1;
    rows.push({
      kind: 'skill',
      key: `skill-${skillKey}`,
      skillKey,
      title: skill.name || formatSkillDefaultName(skillKey),
      idText: skillKey,
      slot: skillKey === 'skill3' ? '-' : getBuffTypeDisplayLabel(getSkillAutoBuffType(skillKey, skill.statType)),
      level: '-',
      effectKey: `${effectCount} 个效果`,
      valueText: '-',
      description: '',
      searchText: buildSearchIndex([skillKey, skill.name, skill.statType, getSkillAutoBuffType(skillKey, skill.statType)]),
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
        valueText: `${LEVEL_KEYS.filter((levelKey) => typeof skill.levels[levelKey].value === 'number').length} 个等级`,
        description: skillKey === 'skill1' ? '能力值曲线' : '属性曲线',
        searchText: buildSearchIndex([skill.name, skillKey, skill.statType, getSkillAutoBuffType(skillKey, skill.statType)]),
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
        searchText: buildSearchIndex([skill.name, skillKey, skill.statType, getSkillAutoBuffType(skillKey, skill.statType), 'levels']),
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
        valueText: `${LEVEL_KEYS.filter((levelKey) => typeof skill.levels[levelKey].value === 'number').length} 个等级`,
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

    // 遍历 skill.effects（插入顺序即显示顺序）
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
        searchText: buildSearchIndex([skill.name, skillKey, effectData.name, effectKey, buffType, getBuffTypeLabel(buffType)]),
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
        searchText: buildSearchIndex([skill.name, skillKey, effectData.name, effectKey, buffType, getBuffTypeLabel(buffType), 'levels']),
      });
    });
  });

  return rows;
}

export function columnIndexToLabel(index: number) {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function buildWeaponWorkbookRows(draft: WeaponDraft, rows: WeaponSheetRow[], columns: WeaponSheetColumn[]): WeaponWorkbookRow[] {
  return rows.map((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: columns.map((column, columnIndex) => {
      const cellValue = (() => {
        switch (column.key) {
          case 'name':
            return row.title;
          case 'idText':
            return row.idText;
          case 'slot':
            return row.slot;
          case 'level':
            return row.level;
          case 'effectKey':
            if (row.kind === 'effect' && row.skillKey === 'skill3' && row.bucket !== 'value') {
              if (draft.skills[row.skillKey].effects[row.sourceEffectKey]?.effectKind === 'extraHit') {
                return row.effectKey;
              }
              return getBuffTypeDisplayLabel(getEffectBuffType(row.skillKey, draft.skills[row.skillKey], row.sourceEffectKey));
            }
            return row.effectKey;
          case 'valueText':
            return row.valueText;
          case 'description':
            return row.description;
          default:
            return '';
        }
      })();
      return {
        key: `${row.key}-${column.key}`,
        address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
        value: cellValue,
        columnKey: column.key,
        width: column.width,
        align: column.align ?? 'left',
        sourceRowKey: row.key,
      };
    }),
  }));
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
      effectEntries.forEach(([_, effectData], index) => {
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

export function getWeaponWorkbookRowClassName(row: WeaponWorkbookRow) {
  if (row.kind === 'weapon') {
    return 'damage-sheet-excel-row is-button weapon-sheet-row-weapon';
  }
  if (row.kind === 'growth') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  }
  if (row.kind === 'skill') {
    return 'damage-sheet-excel-row is-character weapon-sheet-row-skill';
  }
  if (row.kind === 'effectLevels') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
  }
  return 'damage-sheet-excel-row is-data weapon-sheet-row-effect';
}
