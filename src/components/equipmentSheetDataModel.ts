import type * as React from 'react';
import { pinyin } from 'pinyin-pro';
import { APP_ROUTE_PATHS } from '../utils/appRoute';
import { resolvePublicPath } from '../utils/assetResolver';
import { getUserImageUrl } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';
import * as buffModel from './operatorDraftBuffModel';
import equipmentValuePresetsRaw from '../data/equipmentValuePresets.json';

export const EQUIPMENT_SHEET_PAGE_PATH = APP_ROUTE_PATHS.equipmentSheet;
export const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
export const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';
export const EQUIPMENT_LIBRARY_SHARE_TYPE = 'equipment-library-share.v1';
export const EQUIPMENT_LIBRARY_PATH = 'data/equipments/equipments.json';

import type {
  EquipmentEffect,
  EquipmentEffectCategory,
  EquipmentEffectId,
  EquipmentEffectShape,
  EquipmentFixedStat,
  EquipmentFixedTypeKey,
  EquipmentGearSet,
  EquipmentImageOption,
  EquipmentItem,
  EquipmentLevelKey,
  EquipmentLibrary,
  EquipmentPart,
  EquipmentSheetColumn,
  EquipmentThreePieceBuff,
  EquipmentUnit,
  EquipmentValueCatalogEntry,
  EquipmentValuePresetEffect,
  EquipmentValuePresetFile,
  EquipmentValuePresetItem,
} from './equipmentSheetTypes';
export * from './equipmentSheetTypes';

export const EQUIPMENT_PARTS: EquipmentPart[] = ['护甲', '护手', '配件'];
export const EFFECT_IDS: EquipmentEffectId[] = ['effect1', 'effect2', 'effect3'];
export const LEVEL_KEYS: EquipmentLevelKey[] = ['0', '1', '2', '3'];
export const COLUMNS: EquipmentSheetColumn[] = [
  { key: 'name', title: '名称', width: 220 },
  { key: 'idText', title: 'ID', width: 150 },
  { key: 'field', title: '字段', width: 180, align: 'center' },
  { key: 'level', title: '等级', width: 72, align: 'center' },
  { key: 'effectKey', title: '效果键', width: 180 },
  { key: 'valueText', title: '数值', width: 120, align: 'right' },
  { key: 'description', title: '描述', width: 420 },
];

export const BUFF_TYPE_OPTIONS = [
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
  'sourceSkillBoost',
  'imbalanceDmgBonus',
  'ultimateChargeEfficiency',
  'healingBonus',
  'hpPercent',
  'damageReduction',
  'fireNatureDmgBonus',
  'iceElectricDmgBonus',
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
];

export const BUFF_TYPE_LABELS: Record<string, string> = {
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
  normalAttackDmgBonus: '普通攻击伤害加成',
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
  sourceSkillBoost: '源石技艺强度',
  imbalanceDmgBonus: '对失衡目标伤害加成',
  ultimateChargeEfficiency: '终结技充能效率',
  healingBonus: '治疗效率加成',
  hpPercent: '生命值',
  damageReduction: '全伤害减免',
  fireNatureDmgBonus: '灼热和自然伤害',
  iceElectricDmgBonus: '寒冷和电磁伤害',
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
};

export const EMPTY_LIBRARY: EquipmentLibrary = {
  updatedAt: '',
  gearSets: {},
};

export function isEquipmentSheetPath(pathname: string) {
  return pathname === EQUIPMENT_SHEET_PAGE_PATH;
}

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
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

export function normalizePart(value: unknown): EquipmentPart {
  return EQUIPMENT_PARTS.includes(value as EquipmentPart) ? value as EquipmentPart : '配件';
}

export function normalizeUnit(value: unknown): EquipmentUnit {
  return value === 'percent' ? 'percent' : 'flat';
}

export function normalizeCategory(value: unknown): EquipmentEffectCategory {
  return value === 'ability' ? 'ability' : 'buff';
}

export function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildEquipmentImageAssetUrl(entry: ImageAssetEntry) {
  const userUrl = getUserImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

export function buildEquipmentImageOption(entry: ImageAssetEntry): EquipmentImageOption | null {
  if (entry.kind === 'dir') return null;
  const displayUrl = buildEquipmentImageAssetUrl(entry);
  const source = entry.source === 'release' || entry.source === 'user' || entry.source === 'legacy' ? 'user' : 'builtin';
  return {
    key: entry.relativePath,
    fileName: entry.fileName,
    baseName: entry.baseName,
    relativePath: entry.relativePath,
    source,
    displayUrl,
    searchText: `${entry.fileName} ${entry.baseName} ${entry.relativePath} ${displayUrl} ${source}`.toLowerCase(),
  };
}

export function slugifyIdPart(value: unknown, fallback = 'item'): string {
  const source = String(value || '').trim() || fallback;
  const transliterated = pinyin(source, { toneType: 'none', type: 'array' })
    .join('-')
    .toLowerCase();
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || fallback;
}

export function normalizeEnglishId(prefix: string, value: unknown, fallbackSource: unknown, existingIds: Set<string>): string {
  const raw = String(value || '').trim();
  const rawWithoutPrefix = raw.startsWith(`${prefix}-`) ? raw.slice(prefix.length + 1) : raw;
  const needsNormalization = !new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]*$`).test(raw);
  const base = needsNormalization ? slugifyIdPart(fallbackSource || rawWithoutPrefix, 'item') : rawWithoutPrefix;
  let candidate = `${prefix}-${base}`.replace(/-{2,}/g, '-').replace(/-$/g, '');
  if (!/^[a-z][a-z0-9-]*$/.test(candidate)) {
    candidate = `${prefix}-item`;
  }
  let unique = candidate;
  let index = 2;
  while (existingIds.has(unique)) {
    unique = `${candidate}-${index}`;
    index += 1;
  }
  existingIds.add(unique);
  return unique;
}

export function stopEditingKeyPropagation(event: React.KeyboardEvent<HTMLElement>) {
  if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
    event.stopPropagation();
  }
}

export function normalizeThreePieceBuff(effectId: string, raw: Partial<EquipmentThreePieceBuff> | null | undefined): EquipmentThreePieceBuff {
  const normalized = buffModel.normalizeBuffEffect(effectId, {
    ...raw,
    type: raw?.typeKey,
    category: raw?.category === 'positive' || raw?.category === '' ? 'passive' : raw?.category,
  });
  const unit = normalizeUnit(normalized.unit);
  const typeKey = normalized.type;
  return {
    ...normalized,
    effectId: normalized.effectId,
    name: normalized.name || '新建效果',
    category: normalized.category,
    typeKey,
    value: normalized.effectKind === 'extraHit' ? 0 : normalizeLegacyPercentValue(typeKey, unit, normalizeNumber(normalized.value), normalized.raw),
    unit,
    description: normalized.description,
    raw: normalized.raw,
  };
}

export function equipmentBuffToDrawer(buff: EquipmentThreePieceBuff): buffModel.OperatorBuffEffect {
  return buffModel.normalizeBuffEffect(buff.effectId, { ...buff, type: buff.typeKey });
}

export function drawerEffectToEquipmentBuff(effect: buffModel.OperatorBuffEffect): EquipmentThreePieceBuff {
  const normalized = buffModel.normalizeBuffEffect(effect.effectId, effect);
  return {
    ...normalized,
    effectId: normalized.effectId,
    name: normalized.name,
    category: normalized.category,
    typeKey: normalized.type,
    value: normalized.effectKind === 'extraHit' ? 0 : normalizeNumber(normalized.value),
    unit: normalizeUnit(normalized.unit),
  };
}

export const EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS = buffModel.OPERATOR_BUFF_BUSINESS_TYPES.map((value) => ({
  value,
  label: value === 'passive'
    ? '常驻 · passive'
    : value === 'condition'
      ? '条件 · condition'
      : value === 'countable'
        ? '计层 · countable'
        : value === 'multiplier'
          ? '乘算 · multiplier'
          : '计层额外伤害段 · countable extraHit',
}));

export function getEquipmentBuffBusinessType(buff: EquipmentThreePieceBuff | undefined) {
  return buff ? buffModel.deriveOperatorBuffBusinessType(equipmentBuffToDrawer(buff)) : 'passive';
}

export const EQUIPMENT_VALUE_PRESETS = equipmentValuePresetsRaw as EquipmentValuePresetFile;
export const EQUIPMENT_VALUE_CATALOG_EXCLUDED_GEAR_SET_IDS = new Set(['gear-set-tian-zai-fang-hu', 'gear-set-shu-nan']);

export const DEFAULT_FIXED_STAT_BY_PART: Record<EquipmentPart, EquipmentFixedStat> = {
  '护甲': { label: '防御力', typeKey: 'defense', value: 56, unit: 'flat', raw: '防御力：+56' },
  '护手': { label: '防御力', typeKey: 'defense', value: 42, unit: 'flat', raw: '防御力：+42' },
  '配件': { label: '防御力', typeKey: 'defense', value: 21, unit: 'flat', raw: '防御力：+21' },
};

export const ABILITY_TYPE_KEYS = new Set(['strengthBoost', 'agilityBoost', 'intelligenceBoost', 'willBoost']);
export const NON_DECIMAL_EQUIPMENT_EFFECT_TYPE_KEYS = new Set([
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'flatAtk',
  'mainStat',
  'subStat',
  'sourceSkillBoost',
]);

export function shouldStoreEquipmentEffectAsDecimal(typeKey: string, unit: EquipmentUnit | string | undefined): boolean {
  return unit === 'percent' && !NON_DECIMAL_EQUIPMENT_EFFECT_TYPE_KEYS.has(typeKey);
}

export function normalizeLegacyPercentValue(typeKey: string, unit: EquipmentUnit | string | undefined, value: number, raw?: unknown): number {
  if (!shouldStoreEquipmentEffectAsDecimal(typeKey, unit)) return value;
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

export function inferPresetPart(preset: EquipmentValuePresetItem): EquipmentPart | null {
  const value = normalizeNumber(preset.fixedStat?.value, NaN);
  if ([56, 40].includes(value)) return '护甲';
  if ([42, 30].includes(value)) return '护手';
  if ([21, 15].includes(value)) return '配件';
  return null;
}

export function parseLevelValuesFromRaw(raw: unknown, typeKey = '', unit: EquipmentUnit | string | undefined = 'flat'): Partial<Record<EquipmentLevelKey, number>> {
  const text = String(raw || '');
  const valueText = text.includes('：') ? text.split('：').slice(1).join('：') : text;
  const matches = valueText.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  return LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey, index) => {
    const parsed = Number(matches[index]);
    if (Number.isFinite(parsed)) {
      acc[levelKey] = normalizeLegacyPercentValue(typeKey, unit, parsed, raw);
    }
    return acc;
  }, {});
}

export function normalizePresetLevels(effect: EquipmentValuePresetEffect): Partial<Record<EquipmentLevelKey, number>> {
  const typeKey = String(effect.typeKey || '');
  const unit = normalizeUnit(effect.unit);
  const levels = LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey) => {
    const value = effect.levels?.[levelKey];
    if (typeof value === 'number' && Number.isFinite(value)) {
      acc[levelKey] = normalizeLegacyPercentValue(typeKey, unit, value, effect.raw);
    }
    return acc;
  }, {});
  const values = LEVEL_KEYS.map((levelKey) => levels[levelKey]).filter((value): value is number => typeof value === 'number');
  const rawLevels = parseLevelValuesFromRaw(effect.raw, typeKey, unit);
  const rawValues = LEVEL_KEYS.map((levelKey) => rawLevels[levelKey]).filter((value): value is number => typeof value === 'number');
  const hasSuspiciousFlatLevels = values.length === LEVEL_KEYS.length && new Set(values).size === 1 && rawValues.length === LEVEL_KEYS.length && new Set(rawValues).size > 1;
  return hasSuspiciousFlatLevels ? rawLevels : levels;
}

export function getEquipmentEffectShapeFromCount(effectCount: number): EquipmentEffectShape {
  return effectCount <= 2 ? 'two-effects' : 'three-effects';
}

export function getEquipmentEffectShape(equipment: Pick<EquipmentItem, 'effects'>): EquipmentEffectShape {
  return getEquipmentEffectShapeFromCount(Object.keys(equipment.effects).length);
}

export function makeValueCatalogKey(part: EquipmentPart, effectId: EquipmentEffectId, typeKey: string, shape: EquipmentEffectShape) {
  return `${part}:${effectId}:${typeKey}:${shape}`;
}

export function makeCatalogLevelsSignature(levels: Partial<Record<EquipmentLevelKey, number>>) {
  return LEVEL_KEYS.map((levelKey) => {
    const value = levels[levelKey];
    return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '';
  }).join('/');
}

export function getNumberPrecision(value: number) {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  if (!text.includes('.')) return 0;
  return text.split('.')[1]?.length ?? 0;
}

export function getCatalogLevelsPrecisionScore(levels: Partial<Record<EquipmentLevelKey, number>>) {
  return LEVEL_KEYS.reduce((score, levelKey) => {
    const value = levels[levelKey];
    return score + (typeof value === 'number' ? getNumberPrecision(value) : 0);
  }, 0);
}

export function buildEquipmentValueCatalog() {
  const catalogCandidates: Record<string, EquipmentValueCatalogEntry[]> = {};
  Object.entries(EQUIPMENT_VALUE_PRESETS.gearSets || {}).forEach(([gearSetId, gearSet]) => {
    if (EQUIPMENT_VALUE_CATALOG_EXCLUDED_GEAR_SET_IDS.has(gearSetId)) {
      return;
    }
    Object.values(gearSet.equipments || {}).forEach((preset) => {
      const part = inferPresetPart(preset);
      if (!part) return;
      const shape = getEquipmentEffectShapeFromCount(Object.keys(preset.effects || {}).length);
      Object.entries(preset.effects || {}).forEach(([effectId, effect]) => {
        if (!EFFECT_IDS.includes(effectId as EquipmentEffectId)) return;
        const typeKey = String(effect.typeKey || '');
        if (!typeKey) return;
        const typedEffectId = effectId as EquipmentEffectId;
        const key = makeValueCatalogKey(part, typedEffectId, typeKey, shape);
        const entry: EquipmentValueCatalogEntry = {
          label: String(effect.label || BUFF_TYPE_LABELS[typeKey] || typeKey),
          typeKey,
          category: normalizeCategory(effect.category || (ABILITY_TYPE_KEYS.has(typeKey) ? 'ability' : 'buff')),
          unit: normalizeUnit(effect.unit),
          raw: String(effect.raw || ''),
          levels: normalizePresetLevels(effect),
          count: 1,
        };
        const candidates = catalogCandidates[key] || [];
        const existing = candidates.find((candidate) => (
          candidate.category === entry.category
          && candidate.unit === entry.unit
          && makeCatalogLevelsSignature(candidate.levels) === makeCatalogLevelsSignature(entry.levels)
        ));
        if (existing) {
          const nextCount = existing.count + 1;
          if (getCatalogLevelsPrecisionScore(entry.levels) > getCatalogLevelsPrecisionScore(existing.levels)) {
            Object.assign(existing, entry);
          }
          existing.count = nextCount;
        } else {
          candidates.push(entry);
          catalogCandidates[key] = candidates;
        }
      });
    });
  });
  return Object.fromEntries(Object.entries(catalogCandidates).map(([key, candidates]) => {
    const [best] = candidates.sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      const precisionDiff = getCatalogLevelsPrecisionScore(b.levels) - getCatalogLevelsPrecisionScore(a.levels);
      if (precisionDiff !== 0) return precisionDiff;
      const levelDiff = normalizeNumber(b.levels['3'], 0) - normalizeNumber(a.levels['3'], 0);
      if (levelDiff !== 0) return levelDiff;
      return Object.keys(b.levels).length - Object.keys(a.levels).length;
    });
    return [key, best];
  }));
}

export const EQUIPMENT_VALUE_CATALOG = buildEquipmentValueCatalog();

export function getEquipmentEffectValuePreset(part: EquipmentPart, effectId: EquipmentEffectId, typeKey: string, shape: EquipmentEffectShape): EquipmentValueCatalogEntry | null {
  if (!typeKey) return null;
  return EQUIPMENT_VALUE_CATALOG[makeValueCatalogKey(part, effectId, typeKey, shape)] ?? null;
}

export function getEquipmentEffectTypeOptions(part: EquipmentPart, effectId: EquipmentEffectId, category: EquipmentEffectCategory, shape: EquipmentEffectShape) {
  const keyPrefix = `${part}:${effectId}:`;
  const keySuffix = `:${shape}`;
  const options = Object.entries(EQUIPMENT_VALUE_CATALOG)
    .filter(([key, entry]) => key.startsWith(keyPrefix) && key.endsWith(keySuffix) && entry.category === category)
    .map(([, entry]) => entry.typeKey)
    .sort((a, b) => (BUFF_TYPE_LABELS[a] || a).localeCompare(BUFF_TYPE_LABELS[b] || b, 'zh-CN'));
  return options.length > 0 ? options : BUFF_TYPE_OPTIONS;
}

export function applyFixedStatPresetForPart(fixedStat: EquipmentFixedStat | undefined, part: EquipmentPart): EquipmentFixedStat {
  const preset = DEFAULT_FIXED_STAT_BY_PART[part];
  return {
    label: fixedStat?.label || preset.label,
    typeKey: fixedStat?.typeKey || preset.typeKey,
    value: fixedStat?.typeKey && fixedStat.typeKey !== 'defense' ? fixedStat.value : preset.value,
    unit: fixedStat?.unit || preset.unit,
    raw: fixedStat?.typeKey && fixedStat.typeKey !== 'defense' ? fixedStat.raw : preset.raw,
  };
}

export function applyEffectValueCatalogForPart(effect: EquipmentEffect, part: EquipmentPart, shape: EquipmentEffectShape): EquipmentEffect {
  const preset = getEquipmentEffectValuePreset(part, effect.effectId, effect.typeKey, shape);
  if (!preset) return effect;
  return {
    ...effect,
    label: effect.label && effect.label !== effect.effectId && effect.label !== '新建增益'
      ? effect.label
      : preset.label,
    category: preset.category,
    unit: preset.unit,
    raw: effect.raw || preset.raw,
    levels: { ...preset.levels },
  };
}

export function normalizeEquipmentLibrary(raw: unknown): EquipmentLibrary {
  const source = raw as Partial<EquipmentLibrary> | null | undefined;
  const next: EquipmentLibrary = {
    updatedAt: typeof source?.updatedAt === 'string' ? source.updatedAt : '',
    migration: source?.migration,
    gearSets: {},
  };
  const rawGearSets = source?.gearSets && typeof source.gearSets === 'object' ? source.gearSets : {};
  const usedGearSetIds = new Set<string>();
  Object.entries(rawGearSets).forEach(([fallbackSetId, rawSet]) => {
    const setValue = rawSet as Partial<EquipmentGearSet>;
    const gearSetId = normalizeEnglishId('gear-set', setValue.gearSetId || fallbackSetId, setValue.name || setValue.gearSetId || fallbackSetId, usedGearSetIds);
    const gearSet: EquipmentGearSet = {
      gearSetId,
      name: String(setValue.name || gearSetId),
      buffId: String(setValue.buffId || ''),
      imgUrl: String(setValue.imgUrl || ''),
      equipments: {},
    };
    const rawThreePieceBuffs = setValue.threePieceBuffs && typeof setValue.threePieceBuffs === 'object'
      ? setValue.threePieceBuffs
      : {};
    const threePieceBuffs: Record<string, EquipmentThreePieceBuff> = {};
    Object.entries(rawThreePieceBuffs).forEach(([fallbackEffectId, rawBuff]) => {
      const buff = normalizeThreePieceBuff(fallbackEffectId, rawBuff as Partial<EquipmentThreePieceBuff>);
      threePieceBuffs[buff.effectId] = buff;
    });
    if (setValue.threePieceBuff && Object.keys(threePieceBuffs).length === 0) {
      const buff = normalizeThreePieceBuff('effect1', setValue.threePieceBuff);
      threePieceBuffs[buff.effectId] = buff;
    }
    if (Object.keys(threePieceBuffs).length > 0) {
      gearSet.threePieceBuffs = threePieceBuffs;
    }
    const rawEquipments = setValue.equipments && typeof setValue.equipments === 'object' ? setValue.equipments : {};
    const usedEquipmentIds = new Set<string>();
    Object.entries(rawEquipments).forEach(([fallbackEquipmentId, rawEquipment]) => {
      const itemValue = rawEquipment as Partial<EquipmentItem>;
      const equipmentId = normalizeEnglishId('equipment', itemValue.equipmentId || fallbackEquipmentId, itemValue.equipmentId || fallbackEquipmentId || itemValue.name, usedEquipmentIds);
      const item: EquipmentItem = {
        equipmentId,
        name: String(itemValue.name || equipmentId),
        part: normalizePart(itemValue.part),
        imgUrl: String(itemValue.imgUrl || ''),
        fixedStat: undefined,
        effects: {},
      };
      if (itemValue.fixedStat) {
        item.fixedStat = {
          label: String(itemValue.fixedStat.label || '防御力'),
          typeKey: (['defense', 'hp', 'flatAtk'].includes(itemValue.fixedStat.typeKey) ? itemValue.fixedStat.typeKey : 'defense') as EquipmentFixedTypeKey,
          value: normalizeNumber(itemValue.fixedStat.value),
          unit: normalizeUnit(itemValue.fixedStat.unit),
          raw: String(itemValue.fixedStat.raw || ''),
        };
      }
      const rawEffects = itemValue.effects && typeof itemValue.effects === 'object' ? itemValue.effects : {};
      EFFECT_IDS.forEach((effectId) => {
        const rawEffect = rawEffects[effectId];
        if (!rawEffect) {
          return;
        }
        const effect = rawEffect as Partial<EquipmentEffect>;
        const typeKey = String(effect.typeKey || '');
        const unit = normalizeUnit(effect.unit);
        item.effects[effectId] = {
          effectId,
          label: String(effect.label || effectId),
          typeKey,
          category: normalizeCategory(effect.category),
          unit,
          raw: String(effect.raw || ''),
          levels: LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey) => {
            const rawLevel = effect.levels?.[levelKey];
            if (rawLevel !== undefined && rawLevel !== null) {
              const parsed = Number(rawLevel);
              if (Number.isFinite(parsed)) {
                acc[levelKey] = normalizeLegacyPercentValue(typeKey, unit, parsed, effect.raw);
              }
            }
            return acc;
          }, {}),
        };
      });
      gearSet.equipments[equipmentId] = item;
    });
    next.gearSets[gearSetId] = gearSet;
  });
  return next;
}

export function readCachedEquipmentLibrary(): EquipmentLibrary {
  const libraryCache = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, EMPTY_LIBRARY));
  if (Object.keys(libraryCache.gearSets).length > 0) {
    return libraryCache;
  }
  return normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, EMPTY_LIBRARY));
}

export async function readEquipmentLibraryFromFile(): Promise<EquipmentLibrary> {
  const bridge = window.desktopRuntime?.readEquipmentLibrary;
  if (bridge) {
    const result = await bridge();
    if (result.ok) {
      return normalizeEquipmentLibrary(result.data);
    }
    throw new Error(result.error || '读取装备库失败');
  }
  const response = await fetch(resolvePublicPath(EQUIPMENT_LIBRARY_PATH), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取装备库失败：HTTP ${response.status}`);
  }
  return normalizeEquipmentLibrary(await response.json());
}

export async function writeEquipmentLibraryToFile(library: EquipmentLibrary): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.desktopRuntime?.writeEquipmentLibrary;
  if (!bridge) {
    return { ok: false, error: '当前 Web 环境无法直接写入本地 JSON，请通过导出 JSON 手动更新文件。' };
  }
  const result = await bridge({ ...library, updatedAt: new Date().toISOString() });
  return result.ok ? { ok: true } : { ok: false, error: result.error || '写入装备库失败' };
}

export function createEmptyLibrary(): EquipmentLibrary {
  return {
    updatedAt: new Date().toISOString(),
    gearSets: {
      'gear-set-new': {
        gearSetId: 'gear-set-new',
        name: '新建套装',
        buffId: '',
        imgUrl: '',
        equipments: {},
      },
    },
  };
}

export function getGearSets(library: EquipmentLibrary) {
  return Object.values(library.gearSets);
}

export function getEquipments(gearSet: EquipmentGearSet) {
  return Object.values(gearSet.equipments);
}

export function getSortedEquipments(gearSet: EquipmentGearSet) {
  const partOrder = new Map<EquipmentPart, number>([['护甲', 0], ['护手', 1], ['配件', 2]]);
  return getEquipments(gearSet).sort((a, b) => {
    const partDiff = (partOrder.get(a.part) ?? 99) - (partOrder.get(b.part) ?? 99);
    return partDiff || a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function getEffectEntries(equipment: EquipmentItem) {
  return EFFECT_IDS.flatMap((effectId) => {
    const effect = equipment.effects[effectId];
    return effect ? [[effectId, effect] as const] : [];
  });
}

export function makeNextId(prefix: string, existingIds: string[]) {
  let index = existingIds.length + 1;
  let candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  while (existingIds.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  }
  return candidate;
}

export function updateLibrarySet(library: EquipmentLibrary, gearSetId: string, updater: (set: EquipmentGearSet) => EquipmentGearSet): EquipmentLibrary {
  const target = library.gearSets[gearSetId];
  if (!target) return library;
  return {
    ...library,
    gearSets: {
      ...library.gearSets,
      [gearSetId]: updater(target),
    },
  };
}

export function updateLibraryEquipment(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
  updater: (equipment: EquipmentItem) => EquipmentItem
): EquipmentLibrary {
  return updateLibrarySet(library, gearSetId, (gearSet) => {
    const equipment = gearSet.equipments[equipmentId];
    if (!equipment) return gearSet;
    return {
      ...gearSet,
      equipments: {
        ...gearSet.equipments,
        [equipmentId]: updater(equipment),
      },
    };
  });
}
