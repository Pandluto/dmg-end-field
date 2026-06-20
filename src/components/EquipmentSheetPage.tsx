import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { pinyin } from 'pinyin-pro';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl, resolvePublicPath } from '../utils/assetResolver';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { imageBridge, getUserImageUrl } from '../utils/imageBridge';
import type { ImageAssetEntry } from './ImageManager/types';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import * as buffModel from './operatorDraftBuffModel';
import equipmentValuePresetsRaw from '../data/equipmentValuePresets.json';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import './DamageSheetPage.css';
import './EquipmentSheetPage.css';

const EQUIPMENT_SHEET_PAGE_PATH = APP_ROUTE_PATHS.equipmentSheet;
const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const EQUIPMENT_LIBRARY_SHARE_TYPE = 'equipment-library-share.v1';
const EQUIPMENT_LIBRARY_PATH = 'data/equipments/equipments.json';

type EquipmentPart = '护甲' | '护手' | '配件';
type EquipmentEffectId = 'effect1' | 'effect2' | 'effect3';
type EquipmentLevelKey = '0' | '1' | '2' | '3';
type EquipmentFixedTypeKey = 'defense' | 'hp' | 'flatAtk';
type EquipmentUnit = 'flat' | 'percent';
type EquipmentEffectCategory = 'ability' | 'buff';

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
  typeKey: string;
  value: number;
  unit: EquipmentUnit;
  description?: string;
  raw?: string;
  valueMode?: buffModel.OperatorBuffValueMode;
  derivedValue?: buffModel.OperatorBuffDerivedValue;
  maxStacks?: number;
  multiplier?: import('../core/domain/buff').BuffMultiplier;
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

interface EquipmentLibrary {
  updatedAt?: string;
  migration?: {
    source?: string;
    migratedAt?: string;
    warnings?: string[];
    reviewRequired?: boolean;
  };
  gearSets: Record<string, EquipmentGearSet>;
}

interface EquipmentValuePresetEffect {
  effectId?: string;
  label?: string;
  typeKey?: string;
  category?: EquipmentEffectCategory | string;
  unit?: EquipmentUnit | string;
  raw?: string;
  levels?: Partial<Record<EquipmentLevelKey, number>>;
}

interface EquipmentValuePresetItem {
  fixedStat?: Partial<EquipmentFixedStat>;
  effects?: Record<string, EquipmentValuePresetEffect>;
}

interface EquipmentValuePresetFile {
  gearSets?: Record<string, {
    equipments?: Record<string, EquipmentValuePresetItem>;
  }>;
}

interface EquipmentValueCatalogEntry {
  label: string;
  typeKey: string;
  category: EquipmentEffectCategory;
  unit: EquipmentUnit;
  raw: string;
  levels: Partial<Record<EquipmentLevelKey, number>>;
  count: number;
}

type EquipmentRow =
  | {
      kind: 'set';
      key: string;
      gearSetId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'equipment';
      key: string;
      gearSetId: string;
      equipmentId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'threePieceBuffHeader';
      key: string;
      gearSetId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'threePieceBuff';
      key: string;
      gearSetId: string;
      effectId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'fixedStat';
      key: string;
      gearSetId: string;
      equipmentId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'effect';
      key: string;
      gearSetId: string;
      equipmentId: string;
      effectId: EquipmentEffectId;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'effectLevels';
      key: string;
      gearSetId: string;
      equipmentId: string;
      effectId: EquipmentEffectId;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    };

interface EquipmentSheetColumn {
  key: 'name' | 'idText' | 'field' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

interface EquipmentWorkbookCell {
  key: string;
  address: string;
  value: string;
  width: number;
  columnKey: EquipmentSheetColumn['key'];
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

interface EquipmentWorkbookRow {
  key: string;
  rowNumber: number;
  kind: EquipmentRow['kind'];
  sourceRow: EquipmentRow;
  cells: EquipmentWorkbookCell[];
}

type EquipmentSelection = {
  address: string;
  sourceRowKey: string;
  columnKey: EquipmentSheetColumn['key'];
};

type EquipmentFormulaBinding = {
  key: string;
  value: string;
  inputMode: 'text' | 'number';
  readOnly?: boolean;
  control?: 'input' | 'select' | 'search-select' | 'image-search-select';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  commit: (rawValue: string) => void;
};

interface EquipmentImageOption {
  key: string;
  fileName: string;
  baseName: string;
  relativePath: string;
  source: 'builtin' | 'user';
  displayUrl: string;
  searchText: string;
}

type EquipmentExplorerNode =
  | { kind: 'set'; gearSetId: string }
  | { kind: 'threePieceBuffHeader'; gearSetId: string }
  | { kind: 'threePieceBuff'; gearSetId: string; effectId: string }
  | { kind: 'equipment'; gearSetId: string; equipmentId: string }
  | { kind: 'fixedStat'; gearSetId: string; equipmentId: string }
  | { kind: 'effect'; gearSetId: string; equipmentId: string; effectId: EquipmentEffectId };

type EquipmentContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | EquipmentExplorerNode['kind'] | 'effectLevels';
  gearSetId?: string;
  equipmentId?: string;
  effectId?: string;
};

type EquipmentContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};

const EQUIPMENT_PARTS: EquipmentPart[] = ['护甲', '护手', '配件'];
const EFFECT_IDS: EquipmentEffectId[] = ['effect1', 'effect2', 'effect3'];
const LEVEL_KEYS: EquipmentLevelKey[] = ['0', '1', '2', '3'];
const COLUMNS: EquipmentSheetColumn[] = [
  { key: 'name', title: '名称', width: 220 },
  { key: 'idText', title: 'ID', width: 150 },
  { key: 'field', title: '字段', width: 180, align: 'center' },
  { key: 'level', title: '等级', width: 72, align: 'center' },
  { key: 'effectKey', title: '效果键', width: 180 },
  { key: 'valueText', title: '数值', width: 120, align: 'right' },
  { key: 'description', title: '描述', width: 420 },
];

const BUFF_TYPE_OPTIONS = [
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

const BUFF_TYPE_LABELS: Record<string, string> = {
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

const EMPTY_LIBRARY: EquipmentLibrary = {
  updatedAt: '',
  gearSets: {},
};

function isEquipmentSheetPath(pathname: string) {
  return pathname === EQUIPMENT_SHEET_PAGE_PATH;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
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

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizePart(value: unknown): EquipmentPart {
  return EQUIPMENT_PARTS.includes(value as EquipmentPart) ? value as EquipmentPart : '配件';
}

function normalizeUnit(value: unknown): EquipmentUnit {
  return value === 'percent' ? 'percent' : 'flat';
}

function normalizeCategory(value: unknown): EquipmentEffectCategory {
  return value === 'ability' ? 'ability' : 'buff';
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildEquipmentImageAssetUrl(entry: ImageAssetEntry) {
  const userUrl = getUserImageUrl(entry);
  if (userUrl) return userUrl;
  const isFileProtocol = window.location.protocol === 'file:';
  const path = isFileProtocol
    ? entry.relativePath
    : entry.relativePath.split('/').map(encodeURIComponent).join('/');
  return resolvePublicPath(path);
}

function buildEquipmentImageOption(entry: ImageAssetEntry): EquipmentImageOption | null {
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

function slugifyIdPart(value: unknown, fallback = 'item'): string {
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

function normalizeEnglishId(prefix: string, value: unknown, fallbackSource: unknown, existingIds: Set<string>): string {
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

function stopEditingKeyPropagation(event: React.KeyboardEvent<HTMLElement>) {
  if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
    event.stopPropagation();
  }
}

function normalizeThreePieceBuff(effectId: string, raw: Partial<EquipmentThreePieceBuff> | null | undefined): EquipmentThreePieceBuff {
  const normalized = buffModel.normalizeBuffEffect(effectId, {
    ...raw,
    type: raw?.typeKey,
    category: raw?.category === 'positive' || raw?.category === '' ? 'passive' : raw?.category,
  });
  return {
    ...normalized,
    effectId: normalized.effectId,
    name: normalized.name || '新建效果',
    category: normalized.category,
    typeKey: normalized.type,
    value: normalized.effectKind === 'extraHit' ? 0 : normalizeNumber(normalized.value),
    unit: normalizeUnit(normalized.unit),
    description: normalized.description,
    raw: normalized.raw,
  };
}

function equipmentBuffToDrawer(buff: EquipmentThreePieceBuff): buffModel.OperatorBuffEffect {
  return buffModel.normalizeBuffEffect(buff.effectId, { ...buff, type: buff.typeKey });
}

function drawerEffectToEquipmentBuff(effect: buffModel.OperatorBuffEffect): EquipmentThreePieceBuff {
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

const EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS = buffModel.OPERATOR_BUFF_BUSINESS_TYPES.map((value) => ({
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

function getEquipmentBuffBusinessType(buff: EquipmentThreePieceBuff | undefined) {
  return buff ? buffModel.deriveOperatorBuffBusinessType(equipmentBuffToDrawer(buff)) : 'passive';
}

const EQUIPMENT_VALUE_PRESETS = equipmentValuePresetsRaw as EquipmentValuePresetFile;

const DEFAULT_FIXED_STAT_BY_PART: Record<EquipmentPart, EquipmentFixedStat> = {
  '护甲': { label: '防御力', typeKey: 'defense', value: 56, unit: 'flat', raw: '防御力：+56' },
  '护手': { label: '防御力', typeKey: 'defense', value: 42, unit: 'flat', raw: '防御力：+42' },
  '配件': { label: '防御力', typeKey: 'defense', value: 21, unit: 'flat', raw: '防御力：+21' },
};

const ABILITY_TYPE_KEYS = new Set(['strengthBoost', 'agilityBoost', 'intelligenceBoost', 'willBoost']);

function inferPresetPart(preset: EquipmentValuePresetItem): EquipmentPart | null {
  const value = normalizeNumber(preset.fixedStat?.value, NaN);
  if ([56, 40].includes(value)) return '护甲';
  if ([42, 30].includes(value)) return '护手';
  if ([21, 15].includes(value)) return '配件';
  return null;
}

function parseLevelValuesFromRaw(raw: unknown): Partial<Record<EquipmentLevelKey, number>> {
  const text = String(raw || '');
  const valueText = text.includes('：') ? text.split('：').slice(1).join('：') : text;
  const matches = valueText.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  return LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey, index) => {
    const parsed = Number(matches[index]);
    if (Number.isFinite(parsed)) {
      acc[levelKey] = parsed;
    }
    return acc;
  }, {});
}

function normalizePresetLevels(effect: EquipmentValuePresetEffect): Partial<Record<EquipmentLevelKey, number>> {
  const levels = LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey) => {
    const value = effect.levels?.[levelKey];
    if (typeof value === 'number' && Number.isFinite(value)) {
      acc[levelKey] = value;
    }
    return acc;
  }, {});
  const values = LEVEL_KEYS.map((levelKey) => levels[levelKey]).filter((value): value is number => typeof value === 'number');
  const rawLevels = parseLevelValuesFromRaw(effect.raw);
  const rawValues = LEVEL_KEYS.map((levelKey) => rawLevels[levelKey]).filter((value): value is number => typeof value === 'number');
  const hasSuspiciousFlatLevels = values.length === LEVEL_KEYS.length && new Set(values).size === 1 && rawValues.length === LEVEL_KEYS.length && new Set(rawValues).size > 1;
  return hasSuspiciousFlatLevels ? rawLevels : levels;
}

function makeValueCatalogKey(part: EquipmentPart, effectId: EquipmentEffectId, typeKey: string) {
  return `${part}:${effectId}:${typeKey}`;
}

function buildEquipmentValueCatalog() {
  const catalog: Record<string, EquipmentValueCatalogEntry> = {};
  Object.values(EQUIPMENT_VALUE_PRESETS.gearSets || {}).forEach((gearSet) => {
    Object.values(gearSet.equipments || {}).forEach((preset) => {
      const part = inferPresetPart(preset);
      if (!part) return;
      Object.entries(preset.effects || {}).forEach(([effectId, effect]) => {
        if (!EFFECT_IDS.includes(effectId as EquipmentEffectId)) return;
        const typeKey = String(effect.typeKey || '');
        if (!typeKey) return;
        const typedEffectId = effectId as EquipmentEffectId;
        const key = makeValueCatalogKey(part, typedEffectId, typeKey);
        const entry: EquipmentValueCatalogEntry = {
          label: String(effect.label || BUFF_TYPE_LABELS[typeKey] || typeKey),
          typeKey,
          category: normalizeCategory(effect.category || (ABILITY_TYPE_KEYS.has(typeKey) ? 'ability' : 'buff')),
          unit: normalizeUnit(effect.unit),
          raw: String(effect.raw || ''),
          levels: normalizePresetLevels(effect),
          count: 1,
        };
        const existing = catalog[key];
        if (!existing || Object.keys(entry.levels).length > Object.keys(existing.levels).length) {
          catalog[key] = entry;
        } else if (existing) {
          existing.count += 1;
        }
      });
    });
  });
  return catalog;
}

const EQUIPMENT_VALUE_CATALOG = buildEquipmentValueCatalog();

function getEquipmentEffectValuePreset(part: EquipmentPart, effectId: EquipmentEffectId, typeKey: string): EquipmentValueCatalogEntry | null {
  if (!typeKey) return null;
  return EQUIPMENT_VALUE_CATALOG[makeValueCatalogKey(part, effectId, typeKey)] ?? null;
}

function getEquipmentEffectTypeOptions(part: EquipmentPart, effectId: EquipmentEffectId, category: EquipmentEffectCategory) {
  const keyPrefix = `${part}:${effectId}:`;
  const options = Object.entries(EQUIPMENT_VALUE_CATALOG)
    .filter(([key, entry]) => key.startsWith(keyPrefix) && entry.category === category)
    .map(([, entry]) => entry.typeKey)
    .sort((a, b) => (BUFF_TYPE_LABELS[a] || a).localeCompare(BUFF_TYPE_LABELS[b] || b, 'zh-CN'));
  return options.length > 0 ? options : BUFF_TYPE_OPTIONS;
}

function applyFixedStatPresetForPart(fixedStat: EquipmentFixedStat | undefined, part: EquipmentPart): EquipmentFixedStat {
  const preset = DEFAULT_FIXED_STAT_BY_PART[part];
  return {
    label: fixedStat?.label || preset.label,
    typeKey: fixedStat?.typeKey || preset.typeKey,
    value: fixedStat?.typeKey && fixedStat.typeKey !== 'defense' ? fixedStat.value : preset.value,
    unit: fixedStat?.unit || preset.unit,
    raw: fixedStat?.typeKey && fixedStat.typeKey !== 'defense' ? fixedStat.raw : preset.raw,
  };
}

function applyEffectValueCatalogForPart(effect: EquipmentEffect, part: EquipmentPart): EquipmentEffect {
  const preset = getEquipmentEffectValuePreset(part, effect.effectId, effect.typeKey);
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

function applyEquipmentPartValueCatalog(equipment: EquipmentItem, part = equipment.part): EquipmentItem {
  return {
    ...equipment,
    part,
    fixedStat: equipment.fixedStat ? applyFixedStatPresetForPart(equipment.fixedStat, part) : equipment.fixedStat,
    effects: Object.fromEntries(
      Object.entries(equipment.effects).map(([effectId, effect]) => [
        effectId,
        effect ? applyEffectValueCatalogForPart(effect, part) : effect,
      ]),
    ) as Partial<Record<EquipmentEffectId, EquipmentEffect>>,
  };
}

function getEquipmentValuePreset(gearSetId: string, equipmentId: string): EquipmentValuePresetItem | null {
  return EQUIPMENT_VALUE_PRESETS.gearSets?.[gearSetId]?.equipments?.[equipmentId] ?? null;
}

function applyEquipmentValuePreset(item: EquipmentItem, preset: EquipmentValuePresetItem | null): EquipmentItem {
  if (!preset) return item;
  const next: EquipmentItem = { ...item, effects: { ...item.effects } };
  if (preset.fixedStat) {
    next.fixedStat = {
      label: String(next.fixedStat?.label || preset.fixedStat.label || '防御力'),
      typeKey: (['defense', 'hp', 'flatAtk'].includes(String(next.fixedStat?.typeKey || preset.fixedStat.typeKey || 'defense'))
        ? String(next.fixedStat?.typeKey || preset.fixedStat.typeKey || 'defense')
        : 'defense') as EquipmentFixedTypeKey,
      value: normalizeNumber(preset.fixedStat.value),
      unit: normalizeUnit(next.fixedStat?.unit || preset.fixedStat.unit),
      raw: String(next.fixedStat?.raw || preset.fixedStat.raw || ''),
    };
  }
  Object.entries(preset.effects || {}).forEach(([effectId, presetEffect]) => {
    if (!EFFECT_IDS.includes(effectId as EquipmentEffectId)) return;
    const typedEffectId = effectId as EquipmentEffectId;
    const existing = next.effects[typedEffectId];
    next.effects[typedEffectId] = {
      effectId: typedEffectId,
      label: String(existing?.label || presetEffect.label || typedEffectId),
      typeKey: String(existing?.typeKey || presetEffect.typeKey || ''),
      category: normalizeCategory(existing?.category || presetEffect.category),
      unit: normalizeUnit(existing?.unit || presetEffect.unit),
      raw: String(existing?.raw || presetEffect.raw || ''),
      levels: normalizePresetLevels(presetEffect),
    };
  });
  return applyEquipmentPartValueCatalog(next);
}

function normalizeEquipmentLibrary(raw: unknown): EquipmentLibrary {
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
        item.effects[effectId] = {
          effectId,
          label: String(effect.label || effectId),
          typeKey: String(effect.typeKey || ''),
          category: normalizeCategory(effect.category),
          unit: normalizeUnit(effect.unit),
          raw: String(effect.raw || ''),
          levels: LEVEL_KEYS.reduce<Partial<Record<EquipmentLevelKey, number>>>((acc, levelKey) => {
            const rawLevel = effect.levels?.[levelKey];
            if (rawLevel !== undefined && rawLevel !== null) {
              const parsed = Number(rawLevel);
              if (Number.isFinite(parsed)) {
                acc[levelKey] = parsed;
              }
            }
            return acc;
          }, {}),
        };
      });
      gearSet.equipments[equipmentId] = applyEquipmentValuePreset(item, getEquipmentValuePreset(gearSetId, equipmentId));
    });
    next.gearSets[gearSetId] = gearSet;
  });
  return next;
}

async function readEquipmentLibraryFromFile(): Promise<EquipmentLibrary> {
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

async function writeEquipmentLibraryToFile(library: EquipmentLibrary): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.desktopRuntime?.writeEquipmentLibrary;
  if (!bridge) {
    return { ok: false, error: '当前 Web 环境无法直接写入本地 JSON，请通过导出 JSON 手动更新文件。' };
  }
  const result = await bridge({ ...library, updatedAt: new Date().toISOString() });
  return result.ok ? { ok: true } : { ok: false, error: result.error || '写入装备库失败' };
}

function createEmptyLibrary(): EquipmentLibrary {
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

function getGearSets(library: EquipmentLibrary) {
  return Object.values(library.gearSets);
}

function getEquipments(gearSet: EquipmentGearSet) {
  return Object.values(gearSet.equipments);
}

function getSortedEquipments(gearSet: EquipmentGearSet) {
  const partOrder = new Map<EquipmentPart, number>([['护甲', 0], ['护手', 1], ['配件', 2]]);
  return getEquipments(gearSet).sort((a, b) => {
    const partDiff = (partOrder.get(a.part) ?? 99) - (partOrder.get(b.part) ?? 99);
    return partDiff || a.name.localeCompare(b.name, 'zh-CN');
  });
}

function getEffectEntries(equipment: EquipmentItem) {
  return EFFECT_IDS.flatMap((effectId) => {
    const effect = equipment.effects[effectId];
    return effect ? [[effectId, effect] as const] : [];
  });
}

function applyCellValueToLibrary(
  library: EquipmentLibrary,
  row: EquipmentRow,
  columnKey: EquipmentSheetColumn['key'],
  rawValue: string,
) {
  if (row.kind === 'set') {
    return updateLibrarySet(library, row.gearSetId, (gearSet) => ({
      ...gearSet,
      name: columnKey === 'name' ? rawValue : gearSet.name,
      gearSetId: gearSet.gearSetId,
      buffId: columnKey === 'effectKey' ? rawValue : gearSet.buffId,
      imgUrl: columnKey === 'description' ? rawValue : gearSet.imgUrl,
    }));
  }
  if (row.kind === 'equipment') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const nextPart = columnKey === 'field' ? normalizePart(rawValue) : equipment.part;
      return applyEquipmentPartValueCatalog({
        ...equipment,
        name: columnKey === 'name' ? rawValue : equipment.name,
        part: nextPart,
        imgUrl: columnKey === 'description' ? rawValue : equipment.imgUrl,
      }, nextPart);
    });
  }
  if (row.kind === 'threePieceBuff') {
    return updateLibrarySet(library, row.gearSetId, (gearSet) => {
      const current = gearSet.threePieceBuffs?.[row.effectId] || {
        effectId: row.effectId,
        name: '新建效果',
        category: '' as 'positive' | 'passive' | 'condition' | '',
        typeKey: '',
        value: 0,
        unit: 'percent' as EquipmentUnit,
        raw: '',
      };
      if (columnKey === 'field') {
        const nextEffect = buffModel.applyBuffBusinessType(
          equipmentBuffToDrawer(current),
          buffModel.OPERATOR_BUFF_BUSINESS_TYPES.includes(rawValue as buffModel.OperatorBuffBusinessType)
            ? rawValue as buffModel.OperatorBuffBusinessType
            : 'passive',
          row.effectId,
        );
        return {
          ...gearSet,
          threePieceBuffs: {
            ...(gearSet.threePieceBuffs || {}),
            [row.effectId]: drawerEffectToEquipmentBuff(nextEffect),
          },
        };
      }
      const nextEffectKind: BuffEffectKind = current.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
      return {
        ...gearSet,
        threePieceBuffs: {
          ...(gearSet.threePieceBuffs || {}),
          [row.effectId]: {
            ...current,
            name: columnKey === 'name' ? rawValue : current.name,
            category: current.category,
            typeKey: nextEffectKind === 'extraHit' ? '' : columnKey === 'effectKey' ? rawValue : current.typeKey,
            value: nextEffectKind === 'extraHit' ? 0 : columnKey === 'valueText' ? normalizeNumber(rawValue, current.value) : current.value,
            raw: columnKey === 'description' ? rawValue : current.raw,
            effectKind: nextEffectKind,
            ...(nextEffectKind === 'extraHit'
              ? {
                  extraHitConfig: normalizeExtraHitConfig({
                    ...current.extraHitConfig,
                    ...(columnKey === 'effectKey' ? { damageType: rawValue } : {}),
                    ...(columnKey === 'valueText' ? { baseMultiplier: normalizeNumber(rawValue, current.extraHitConfig?.baseMultiplier) } : {}),
                  }, `${row.effectId}-extra-hit`),
                }
              : { extraHitConfig: undefined }),
          },
        },
      };
    });
  }
  if (row.kind === 'fixedStat') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const nextTypeKey = columnKey === 'effectKey' && ['defense', 'hp', 'flatAtk'].includes(rawValue)
        ? rawValue as EquipmentFixedTypeKey
        : equipment.fixedStat?.typeKey || 'defense';
      const nextFixedStat: EquipmentFixedStat = {
        label: columnKey === 'name' ? rawValue : equipment.fixedStat?.label || '防御力',
        typeKey: nextTypeKey,
        value: equipment.fixedStat?.value || 0,
        unit: equipment.fixedStat?.unit || 'flat',
        raw: columnKey === 'description' ? rawValue : equipment.fixedStat?.raw,
      };
      return {
        ...equipment,
        fixedStat: nextTypeKey === 'defense'
          ? applyFixedStatPresetForPart(nextFixedStat, equipment.part)
          : nextFixedStat,
      };
    });
  }
  if (row.kind === 'effect') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const effect = equipment.effects[row.effectId];
      if (!effect) return equipment;
      const nextCategory = columnKey === 'field' ? normalizeCategory(rawValue === '能力值' ? 'ability' : rawValue) : effect.category;
      const nextTypeKey = columnKey === 'effectKey' ? rawValue : effect.typeKey;
      const availableTypeKeys = getEquipmentEffectTypeOptions(equipment.part, row.effectId, nextCategory);
      const normalizedTypeKey = nextTypeKey && availableTypeKeys.includes(nextTypeKey) ? nextTypeKey : '';
      const nextEffect: EquipmentEffect = {
        ...effect,
        label: columnKey === 'name' ? rawValue : effect.label,
        category: nextCategory,
        typeKey: normalizedTypeKey,
        unit: effect.unit,
        raw: columnKey === 'description' ? rawValue : effect.raw,
        levels: normalizedTypeKey ? effect.levels : {},
      };
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [row.effectId]: columnKey === 'effectKey' || columnKey === 'field'
            ? applyEffectValueCatalogForPart(nextEffect, equipment.part)
            : nextEffect,
        },
      };
    });
  }
  return library;
}

function buildRows(library: EquipmentLibrary): EquipmentRow[] {
  return getGearSets(library).flatMap((gearSet) => {
    const setRow: EquipmentRow = {
      kind: 'set',
      key: `set-${gearSet.gearSetId}`,
      gearSetId: gearSet.gearSetId,
      title: gearSet.name,
      idText: gearSet.gearSetId,
      field: '套装',
      level: '-',
      effectKey: gearSet.buffId || 'buffId 未填写',
      valueText: '',
      description: gearSet.imgUrl || '',
    };
    const threePieceBuffRows: EquipmentRow[] = [{
      kind: 'threePieceBuffHeader',
      key: `three-piece-buff-header-${gearSet.gearSetId}`,
      gearSetId: gearSet.gearSetId,
      title: '三件套效果：',
      idText: '',
      field: '',
      level: '',
      effectKey: '',
      valueText: '',
      description: '',
    }];
    Object.entries(gearSet.threePieceBuffs || {}).forEach(([effectId, threePieceBuff]) => {
      threePieceBuffRows.push({
        kind: 'threePieceBuff',
        key: `three-piece-buff-${gearSet.gearSetId}-${effectId}`,
        gearSetId: gearSet.gearSetId,
        effectId,
        title: threePieceBuff.name || '新建效果',
        idText: threePieceBuff.effectId || effectId,
        field: getEquipmentBuffBusinessType(threePieceBuff),
        level: '3件',
        effectKey: threePieceBuff.effectKind === 'extraHit'
          ? `${threePieceBuff.extraHitConfig?.damageType || 'physical'} / ${threePieceBuff.extraHitConfig?.skillType || '空'}`
          : threePieceBuff.typeKey,
        valueText: String(threePieceBuff.effectKind === 'extraHit' ? threePieceBuff.extraHitConfig?.baseMultiplier ?? 1 : threePieceBuff.value),
        description: threePieceBuff.raw || '',
      });
    });
    const equipmentRows = getSortedEquipments(gearSet).flatMap((equipment) => {
      const rows: EquipmentRow[] = [{
        kind: 'equipment',
        key: `equipment-${gearSet.gearSetId}-${equipment.equipmentId}`,
        gearSetId: gearSet.gearSetId,
        equipmentId: equipment.equipmentId,
        title: equipment.name,
        idText: equipment.equipmentId,
        field: equipment.part,
        level: '-',
        effectKey: '',
        valueText: '',
        description: equipment.imgUrl || '',
      }];
      if (equipment.fixedStat) {
        rows.push({
          kind: 'fixedStat',
          key: `fixed-${gearSet.gearSetId}-${equipment.equipmentId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          title: equipment.fixedStat.label,
          idText: equipment.fixedStat.typeKey,
          field: '固定',
          level: '-',
          effectKey: equipment.fixedStat.typeKey,
          valueText: `${equipment.fixedStat.value}${equipment.fixedStat.unit === 'percent' ? '%' : ''}`,
          description: equipment.fixedStat.raw || '',
        });
      }
      getEffectEntries(equipment).forEach(([effectId, effect]) => {
        rows.push({
          kind: 'effect',
          key: `effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          effectId,
          title: effect.label,
          idText: effectId,
          field: effect.category === 'ability' ? '能力值' : 'Buff类型',
          level: 'Lv0~Lv3',
          effectKey: effect.typeKey,
          valueText: effect.unit === 'percent' ? '%' : '',
          description: effect.raw || `${BUFF_TYPE_LABELS[effect.typeKey] || effect.typeKey}`,
        });
        rows.push({
          kind: 'effectLevels',
          key: `levels-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          effectId,
          title: `${effect.label} 等级数值`,
          idText: effectId,
          field: '等级数值',
          level: 'Lv0~Lv3',
          effectKey: effect.typeKey,
          valueText: '',
          description: '',
        });
      });
      return rows;
    });
    return [setRow, ...threePieceBuffRows, ...equipmentRows];
  });
}

function filterVisibleRows(
  rows: EquipmentRow[],
  collapsedGearSetIds: Record<string, boolean>,
  collapsedEquipmentIds: Record<string, boolean>,
  collapsedEffectIds: Record<string, boolean>,
  collapsedThreePieceBuffIds: Record<string, boolean>
): EquipmentRow[] {
  return rows.filter((row) => {
    if (row.kind === 'set') {
      return true;
    }
    if (collapsedGearSetIds[row.gearSetId] !== false) {
      return false;
    }
    if (row.kind === 'threePieceBuff') {
      return collapsedThreePieceBuffIds[row.gearSetId] !== true;
    }
    if (row.kind === 'threePieceBuffHeader') {
      return true;
    }
    if (row.kind === 'equipment') {
      return true;
    }
    const equipmentKey = `${row.gearSetId}:${row.equipmentId}`;
    if (collapsedEquipmentIds[equipmentKey] !== false) {
      return false;
    }
    if (row.kind === 'fixedStat' || row.kind === 'effect') {
      return true;
    }
    const effectKey = `${row.gearSetId}:${row.equipmentId}:${row.effectId}`;
    return collapsedEffectIds[effectKey] === false;
  });
}

function columnIndexToLabel(index: number) {
  let dividend = index + 1;
  let label = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return label;
}

function buildWorkbookRows(rows: EquipmentRow[]) {
  const getCellValue = (row: EquipmentRow, columnKey: EquipmentSheetColumn['key']) => {
    switch (columnKey) {
      case 'name':
        return row.title;
      case 'idText':
        return row.idText;
      case 'field':
        return row.field;
      case 'level':
        return row.level;
      case 'effectKey':
        return row.effectKey;
      case 'valueText':
        return row.valueText;
      case 'description':
        return row.description;
      default:
        return '';
    }
  };

  return rows.map<EquipmentWorkbookRow>((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: COLUMNS.map((column, columnIndex) => ({
      key: `${row.key}-${column.key}`,
      address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
      value: String(getCellValue(row, column.key)),
      width: column.width,
      columnKey: column.key,
      align: column.align ?? 'left',
      sourceRowKey: row.key,
    })),
  }));
}

function getWorkbookRowClassName(row: EquipmentWorkbookRow) {
  if (row.kind === 'set') return 'damage-sheet-excel-row is-character weapon-sheet-row-weapon';
  if (row.kind === 'threePieceBuffHeader') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-header';
  if (row.kind === 'threePieceBuff') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-effect';
  if (row.kind === 'equipment') return 'damage-sheet-excel-row is-button weapon-sheet-row-skill';
  if (row.kind === 'fixedStat') return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  if (row.kind === 'effect') return 'damage-sheet-excel-row is-character weapon-sheet-row-effect';
  return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
}

function renderMenuIcon(icon: EquipmentContextMenuAction['icon']) {
  switch (icon) {
    case 'new':
      return <path d="M8 3.25v9.5M3.25 8h9.5" />;
    case 'delete':
      return (
        <>
          <path d="M4.25 5.25h7.5" />
          <path d="M6.25 2.75h3.5" />
          <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
          <path d="M4.75 5.25l.5 7h5.5l.5-7" />
        </>
      );
    case 'collapse':
      return <path d="M4 8h8" />;
    case 'expand':
      return <path d="M8 4v8M4 8h8" />;
    case 'open':
    default:
      return <path d="M5.75 4.25h6v6M11.75 4.25L4.25 11.75" />;
  }
}

function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function makeNextId(prefix: string, existingIds: string[]) {
  let index = existingIds.length + 1;
  let candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  while (existingIds.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  }
  return candidate;
}

function updateLibrarySet(library: EquipmentLibrary, gearSetId: string, updater: (set: EquipmentGearSet) => EquipmentGearSet): EquipmentLibrary {
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

function updateLibraryEquipment(
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

export { isEquipmentSheetPath };

export function EquipmentSheetPage() {
  const [library, setLibrary] = useState<EquipmentLibrary>(() => normalizeEquipmentLibrary(EMPTY_LIBRARY));
  const [selectedRowKey, setSelectedRowKey] = useState('');
  const [selectedCell, setSelectedCell] = useState<EquipmentSelection | null>(null);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [activeGearSetId, setActiveGearSetId] = useState<string | null>(null);
  const [activeEquipmentId, setActiveEquipmentId] = useState<string | null>(null);
  const [collapsedGearSetIds, setCollapsedGearSetIds] = useState<Record<string, boolean>>({});
  const [collapsedEquipmentIds, setCollapsedEquipmentIds] = useState<Record<string, boolean>>({});
  const [collapsedEffectIds, setCollapsedEffectIds] = useState<Record<string, boolean>>({});
  const [collapsedThreePieceBuffIds, setCollapsedThreePieceBuffIds] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [contextMenu, setContextMenu] = useState<EquipmentContextMenuState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ gearSetId: string; effectId: string } | null>(null);
  const [message, setMessage] = useState('正在读取装备库...');
  const [formulaInput, setFormulaInput] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [imageAssets, setImageAssets] = useState<ImageAssetEntry[]>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetsError, setImageAssetsError] = useState('');
  const [equipmentImageQuery, setEquipmentImageQuery] = useState('');
  const [isEquipmentImageDrawerOpen, setIsEquipmentImageDrawerOpen] = useState(false);
  const [equipmentImageLoadFailed, setEquipmentImageLoadFailed] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaveConfirmModalOpen, setIsSaveConfirmModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<EquipmentGearSet> | null>(null);
  const [exportScope, setExportScope] = useState<'current' | 'all'>('current');
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const equipmentImageFormulaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    readEquipmentLibraryFromFile()
      .then((fileLibrary) => {
        if (cancelled) return;
        const cached = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, EMPTY_LIBRARY));
        const hasCachedData = Object.keys(cached.gearSets).length > 0;
        const shouldUseCached = !window.desktopRuntime?.readEquipmentLibrary && hasCachedData;
        const nextLibrary = shouldUseCached ? cached : fileLibrary;
        setLibrary(nextLibrary);
        setIsDirty(false);
        if (shouldUseCached) {
          setMessage('已从 localStorage 加载浏览器保存的装备库草稿。');
          return;
        }
        setMessage(fileLibrary.migration?.reviewRequired ? '装备库已加载。迁移数据需要人工复核 typeKey 映射。' : '装备库已加载。');
      })
      .catch((error) => {
        if (cancelled) return;
        const cached = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, EMPTY_LIBRARY));
        if (Object.keys(cached.gearSets).length > 0) {
          setLibrary(cached);
          setIsDirty(false);
          setMessage(`读取本地 JSON 失败，已使用 localStorage：${error instanceof Error ? error.message : String(error)}`);
        } else {
          setLibrary(createEmptyLibrary());
          setMessage(`读取装备库失败，已创建空库：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setImageAssetsLoading(true);
    setImageAssetsError('');
    imageBridge.listAssets()
      .then((assets) => {
        if (cancelled) return;
        setImageAssets(assets);
      })
      .catch((error) => {
        if (cancelled) return;
        setImageAssets([]);
        setImageAssetsError(error instanceof Error ? error.message : '图片资源加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setImageAssetsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGearSets = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    const sets = getGearSets(library);
    if (!keyword) return sets;
    return sets
      .map((gearSet) => {
        const equipments = Object.fromEntries(
          getEquipments(gearSet)
            .filter((equipment) => {
              const effectText = getEffectEntries(equipment).map(([, effect]) => `${effect.label} ${effect.typeKey}`).join(' ');
              return `${gearSet.name} ${gearSet.gearSetId} ${equipment.name} ${equipment.equipmentId} ${equipment.part} ${effectText}`.toLowerCase().includes(keyword);
            })
            .map((equipment) => [equipment.equipmentId, equipment])
        );
        if (`${gearSet.name} ${gearSet.gearSetId} ${gearSet.buffId || ''}`.toLowerCase().includes(keyword) || Object.keys(equipments).length > 0) {
          return { ...gearSet, equipments };
        }
        return null;
      })
      .filter((gearSet): gearSet is EquipmentGearSet => Boolean(gearSet));
  }, [filterKeyword, library]);

  const tableGearSets = useMemo(() => {
    if (activeGearSetId) {
      const activeGearSet = filteredGearSets.find((gearSet) => gearSet.gearSetId === activeGearSetId) ?? library.gearSets[activeGearSetId];
      if (!activeGearSet) return [];
      if (!activeEquipmentId) return [activeGearSet];
      const activeEquipment = activeGearSet.equipments[activeEquipmentId] ?? library.gearSets[activeGearSetId]?.equipments[activeEquipmentId];
      return activeEquipment
        ? [{ ...activeGearSet, equipments: { [activeEquipment.equipmentId]: activeEquipment } }]
        : [activeGearSet];
    }
    return filteredGearSets.map((gearSet) => ({ ...gearSet, equipments: {} }));
  }, [activeEquipmentId, activeGearSetId, filteredGearSets, library.gearSets]);
  const rows = useMemo(() => buildRows({ ...library, gearSets: Object.fromEntries(tableGearSets.map((gearSet) => [gearSet.gearSetId, gearSet])) }), [library, tableGearSets]);
  const visibleRows = useMemo(
    () => filterVisibleRows(rows, collapsedGearSetIds, collapsedEquipmentIds, collapsedEffectIds, collapsedThreePieceBuffIds),
    [collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds, rows],
  );
  const workbookRows = useMemo(() => buildWorkbookRows(visibleRows), [visibleRows]);
  const selectedRow = useMemo(() => visibleRows.find((row) => row.key === selectedRowKey) ?? visibleRows[0] ?? null, [selectedRowKey, visibleRows]);
  const previewImageMeta = useMemo(() => {
    if (!selectedRow) {
      return { imgUrl: '', title: '装备配图预览', alt: '装备配图' };
    }
    if (
      selectedRow.kind === 'set'
      || selectedRow.kind === 'threePieceBuffHeader'
      || selectedRow.kind === 'threePieceBuff'
    ) {
      const gearSet = library.gearSets[selectedRow.gearSetId];
      return {
        imgUrl: gearSet?.imgUrl?.trim() || '',
        title: gearSet?.imgUrl?.trim() || '套装配图预览',
        alt: gearSet?.name || '套装配图',
      };
    }
    const gearSet = library.gearSets[selectedRow.gearSetId];
    const equipment = gearSet?.equipments[selectedRow.equipmentId];
    return {
      imgUrl: equipment?.imgUrl?.trim() || '',
      title: equipment?.imgUrl?.trim() || '装备配图预览',
      alt: equipment?.name || '装备配图',
    };
  }, [library.gearSets, selectedRow]);
  const equipmentImageOptions = useMemo(
    () => imageAssets.map(buildEquipmentImageOption).filter((option): option is EquipmentImageOption => option !== null),
    [imageAssets],
  );
  const filteredEquipmentImageOptions = useMemo(() => {
    const keyword = equipmentImageQuery.trim().toLowerCase();
    if (!keyword) return equipmentImageOptions;
    return equipmentImageOptions.filter((option) => option.searchText.includes(keyword));
  }, [equipmentImageOptions, equipmentImageQuery]);
  const currentShareFile = useMemo(() => {
    const payload = exportScope === 'current' && selectedRow?.gearSetId && library.gearSets[selectedRow.gearSetId]
      ? { [selectedRow.gearSetId]: library.gearSets[selectedRow.gearSetId] }
      : library.gearSets;
    return buildDraftLibraryShareFile(EQUIPMENT_LIBRARY_SHARE_TYPE, payload, exportScope === 'current' ? selectedRow?.title : 'equipment-library');
  }, [exportScope, library.gearSets, selectedRow]);
  const currentShareText = useMemo(() => JSON.stringify(currentShareFile, null, 2), [currentShareFile]);

  useEffect(() => {
    if (activeGearSetId && !library.gearSets[activeGearSetId]) {
      setActiveGearSetId(null);
      setActiveEquipmentId(null);
      return;
    }
    if (activeGearSetId && activeEquipmentId && !library.gearSets[activeGearSetId]?.equipments[activeEquipmentId]) {
      setActiveEquipmentId(null);
    }
  }, [activeEquipmentId, activeGearSetId, library.gearSets]);

  useEffect(() => {
    if (!selectedRow && visibleRows[0]) {
      setSelectedRowKey(visibleRows[0].key);
    }
  }, [selectedRow, visibleRows]);

  const mutateLibrary = useCallback((updater: (prev: EquipmentLibrary) => EquipmentLibrary) => {
    setLibrary((prev) => {
      const next = { ...updater(prev), updatedAt: new Date().toISOString() };
      setIsDirty(true);
      return next;
    });
  }, []);

  const openEquipmentBuffDrawer = useCallback((gearSetId: string, effectId: string) => {
    setBuffDrawerTarget({ gearSetId, effectId });
  }, []);

  const createThreePieceEffectInSet = useCallback((gearSetId: string) => {
    let nextEffectId = 'effect1';
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const current = gearSet.threePieceBuffs || {};
      let index = 1;
      while (current[`effect${index}`]) {
        index += 1;
      }
      nextEffectId = `effect${index}`;
      return {
        ...gearSet,
        threePieceBuffs: {
          ...current,
          [nextEffectId]: {
            effectId: nextEffectId,
            name: '新建效果',
            category: '',
            typeKey: '',
            value: 0,
            unit: 'percent',
            raw: '',
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`three-piece-buff-${gearSetId}-${nextEffectId}`);
    setBuffDrawerTarget({ gearSetId, effectId: nextEffectId });
  }, [mutateLibrary]);

  const duplicateThreePieceEffect = useCallback((gearSetId: string, effectId: string) => {
    let nextEffectId = 'effect1';
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const source = gearSet.threePieceBuffs?.[effectId];
      if (!source) return gearSet;
      const current = gearSet.threePieceBuffs || {};
      let index = 1;
      while (current[`effect${index}`]) {
        index += 1;
      }
      nextEffectId = `effect${index}`;
      return {
        ...gearSet,
        threePieceBuffs: {
          ...current,
          [nextEffectId]: {
            ...JSON.parse(JSON.stringify(source)),
            effectId: nextEffectId,
            name: `${source.name} 副本`,
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`three-piece-buff-${gearSetId}-${nextEffectId}`);
    setBuffDrawerTarget({ gearSetId, effectId: nextEffectId });
  }, [mutateLibrary]);

  const handleCreateNew = useCallback(() => {
    if (selectedRow?.kind === 'threePieceBuffHeader' || selectedRow?.kind === 'threePieceBuff') {
      createThreePieceEffectInSet(selectedRow.gearSetId);
      return;
    }
    if (selectedRow?.kind === 'set') {
      const gearSet = library.gearSets[selectedRow.gearSetId];
      if (!gearSet) return;
      const equipmentId = makeNextId('equipment', Object.keys(gearSet.equipments));
      mutateLibrary((prev) => updateLibrarySet(prev, selectedRow.gearSetId, (target) => ({
        ...target,
        equipments: {
          ...target.equipments,
          [equipmentId]: {
            equipmentId,
            name: '新建装备',
            part: '护甲',
            imgUrl: '',
            fixedStat: DEFAULT_FIXED_STAT_BY_PART['护甲'],
            effects: {},
          },
        },
      })));
      setActiveGearSetId(selectedRow.gearSetId);
      setActiveEquipmentId(equipmentId);
      setCollapsedGearSetIds((prev) => ({ ...prev, [selectedRow.gearSetId]: false }));
      setSelectedRowKey(`equipment-${selectedRow.gearSetId}-${equipmentId}`);
      return;
    }
    if (selectedRow?.kind === 'equipment' || selectedRow?.kind === 'fixedStat' || selectedRow?.kind === 'effect' || selectedRow?.kind === 'effectLevels') {
      const gearSetId = selectedRow.gearSetId;
      const equipmentId = selectedRow.equipmentId;
      mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
        const freeEffectId = EFFECT_IDS.find((effectId) => !equipment.effects[effectId]);
        if (!freeEffectId) return equipment;
        return {
          ...equipment,
          effects: {
            ...equipment.effects,
            [freeEffectId]: {
              effectId: freeEffectId,
              label: '新建增益',
              typeKey: '',
              category: 'buff',
              unit: 'flat',
              levels: {},
            },
          },
        };
      }));
      setActiveGearSetId(gearSetId);
      setActiveEquipmentId(equipmentId);
      setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
      setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
      return;
    }
    const gearSetId = makeNextId('gear-set', Object.keys(library.gearSets));
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        [gearSetId]: {
          gearSetId,
          name: '新建套装',
          buffId: '',
          imgUrl: '',
          threePieceBuffs: {},
          equipments: {},
        },
      },
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setSelectedRowKey(`set-${gearSetId}`);
  }, [createThreePieceEffectInSet, library.gearSets, mutateLibrary, selectedRow]);

  const createGearSet = useCallback(() => {
    const gearSetId = makeNextId('gear-set', Object.keys(library.gearSets));
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        [gearSetId]: {
          gearSetId,
          name: '新建套装',
          buffId: '',
          imgUrl: '',
          threePieceBuffs: {},
          equipments: {},
        },
      },
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(null);
    setSelectedRowKey(`set-${gearSetId}`);
  }, [library.gearSets, mutateLibrary]);

  const createEquipmentInSet = useCallback((gearSetId: string) => {
    const gearSet = library.gearSets[gearSetId];
    if (!gearSet) return;
    const equipmentId = makeNextId('equipment', Object.keys(gearSet.equipments));
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (target) => ({
      ...target,
      equipments: {
        ...target.equipments,
        [equipmentId]: {
          equipmentId,
          name: '新建装备',
          part: '护甲',
          imgUrl: '',
          fixedStat: DEFAULT_FIXED_STAT_BY_PART['护甲'],
          effects: {},
        },
      },
    })));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setSelectedRowKey(`equipment-${gearSetId}-${equipmentId}`);
  }, [library.gearSets, mutateLibrary]);

  const createEffectInEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    let nextEffectId: EquipmentEffectId | null = null;
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
      const freeEffectId = EFFECT_IDS.find((effectId) => !equipment.effects[effectId]);
      if (!freeEffectId) return equipment;
      nextEffectId = freeEffectId;
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [freeEffectId]: {
            effectId: freeEffectId,
            label: '新建增益',
            typeKey: '',
            category: 'buff',
            unit: 'flat',
            levels: {},
          },
        },
      };
    }));
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    if (nextEffectId) {
      setSelectedRowKey(`effect-${gearSetId}-${equipmentId}-${nextEffectId}`);
    }
  }, [mutateLibrary]);

  const handleNormalize = useCallback(() => {
    mutateLibrary((prev) => ({
      ...prev,
      gearSets: Object.fromEntries(
        getGearSets(prev)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((gearSet) => [gearSet.gearSetId, {
            ...gearSet,
            equipments: Object.fromEntries(getSortedEquipments(gearSet).map((equipment) => [equipment.equipmentId, {
              ...equipment,
              effects: Object.fromEntries(getEffectEntries(equipment).map(([effectId, effect]) => [effectId, effect])),
            }])),
          }])
      ),
    }));
    setMessage('已整理：套装按名称，装备按护甲/护手/配件，effect 按 effect1-3。');
  }, [mutateLibrary]);

  const openContextMenu = useCallback((event: ReactMouseEvent, state: EquipmentContextMenuState) => {
    event.preventDefault();
    setContextMenu(state);
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const focusRow = useCallback((rowKey: string, options: { expandAncestors?: boolean; scroll?: boolean } = {}) => {
    const row = rows.find((candidate) => candidate.key === rowKey);
    if (row) {
      setActiveGearSetId(row.gearSetId);
      setActiveEquipmentId(
        row.kind === 'equipment' || row.kind === 'fixedStat' || row.kind === 'effect' || row.kind === 'effectLevels'
          ? row.equipmentId
          : null,
      );
    }
    if (options.expandAncestors && row) {
      setCollapsedGearSetIds((prev) => ({ ...prev, [row.gearSetId]: false }));
      if (row.kind === 'equipment' || row.kind === 'fixedStat' || row.kind === 'effect' || row.kind === 'effectLevels') {
        setCollapsedEquipmentIds((prev) => ({ ...prev, [`${row.gearSetId}:${row.equipmentId}`]: false }));
      }
      if (row.kind === 'effect' || row.kind === 'effectLevels') {
        setCollapsedEffectIds((prev) => ({ ...prev, [`${row.gearSetId}:${row.equipmentId}:${row.effectId}`]: false }));
      }
    }
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
    if (options.scroll) {
      window.requestAnimationFrame(() => {
        tableScrollRef.current
          ?.querySelector<HTMLElement>(`[data-equipment-row-key="${CSS.escape(rowKey)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [rows]);

  const toggleRowCollapsed = useCallback((row: EquipmentRow) => {
    if (row.kind === 'set') {
      setCollapsedGearSetIds((prev) => ({ ...prev, [row.gearSetId]: prev[row.gearSetId] === false }));
    } else if (row.kind === 'equipment') {
      const key = `${row.gearSetId}:${row.equipmentId}`;
      setCollapsedEquipmentIds((prev) => ({ ...prev, [key]: prev[key] === false }));
    } else if (row.kind === 'threePieceBuffHeader') {
      setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [row.gearSetId]: prev[row.gearSetId] !== true }));
    } else if (row.kind === 'effect') {
      const key = `${row.gearSetId}:${row.equipmentId}:${row.effectId}`;
      setCollapsedEffectIds((prev) => ({ ...prev, [key]: prev[key] === false }));
    }
  }, []);

  const isRowCollapsed = useCallback((row: EquipmentRow) => {
    if (row.kind === 'set') {
      return collapsedGearSetIds[row.gearSetId] !== false;
    }
    if (row.kind === 'equipment') {
      return collapsedEquipmentIds[`${row.gearSetId}:${row.equipmentId}`] !== false;
    }
    if (row.kind === 'threePieceBuffHeader') {
      return collapsedThreePieceBuffIds[row.gearSetId] === true;
    }
    if (row.kind === 'effect') {
      return collapsedEffectIds[`${row.gearSetId}:${row.equipmentId}:${row.effectId}`] !== false;
    }
    return false;
  }, [collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds]);

  const collapseAll = useCallback(() => {
    setCollapsedGearSetIds({});
    setCollapsedEquipmentIds({});
    setCollapsedEffectIds({});
    setCollapsedThreePieceBuffIds({});
  }, []);

  const expandAll = useCallback(() => {
    const nextGearSets: Record<string, boolean> = {};
    const nextEquipments: Record<string, boolean> = {};
    const nextEffects: Record<string, boolean> = {};
    const nextThreePieceBuffs: Record<string, boolean> = {};
    getGearSets(library).forEach((gearSet) => {
      nextGearSets[gearSet.gearSetId] = false;
      if (Object.keys(gearSet.threePieceBuffs || {}).length > 0) {
        nextThreePieceBuffs[gearSet.gearSetId] = false;
      }
      getEquipments(gearSet).forEach((equipment) => {
        nextEquipments[`${gearSet.gearSetId}:${equipment.equipmentId}`] = false;
        getEffectEntries(equipment).forEach(([effectId]) => {
          nextEffects[`${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`] = false;
        });
      });
    });
    setCollapsedGearSetIds(nextGearSets);
    setCollapsedEquipmentIds(nextEquipments);
    setCollapsedEffectIds(nextEffects);
    setCollapsedThreePieceBuffIds(nextThreePieceBuffs);
  }, [library]);

  const expandCurrentEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
    if (!equipment) return;
    setActiveGearSetId(gearSetId);
    setActiveEquipmentId(equipmentId);
    setCollapsedGearSetIds((prev) => ({ ...prev, [gearSetId]: false }));
    setCollapsedEquipmentIds((prev) => ({ ...prev, [`${gearSetId}:${equipmentId}`]: false }));
    setCollapsedEffectIds((prev) => {
      const next = { ...prev };
      getEffectEntries(equipment).forEach(([effectId]) => {
        next[`${gearSetId}:${equipmentId}:${effectId}`] = false;
      });
      return next;
    });
  }, [library.gearSets]);

  const addFixedStat = useCallback((gearSetId: string, equipmentId: string) => {
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => equipment.fixedStat ? equipment : {
      ...equipment,
      fixedStat: DEFAULT_FIXED_STAT_BY_PART[equipment.part],
    }));
  }, [mutateLibrary]);

  const deleteNode = useCallback((state: EquipmentContextMenuState) => {
    if (state.target === 'set' && state.gearSetId) {
      mutateLibrary((prev) => {
        const nextGearSets = { ...prev.gearSets };
        delete nextGearSets[state.gearSetId!];
        return { ...prev, gearSets: nextGearSets };
      });
    }
    if (state.target === 'equipment' && state.gearSetId && state.equipmentId) {
      mutateLibrary((prev) => updateLibrarySet(prev, state.gearSetId!, (gearSet) => {
        const nextEquipments = { ...gearSet.equipments };
        delete nextEquipments[state.equipmentId!];
        return { ...gearSet, equipments: nextEquipments };
      }));
    }
    if (state.target === 'fixedStat' && state.gearSetId && state.equipmentId) {
      mutateLibrary((prev) => updateLibraryEquipment(prev, state.gearSetId!, state.equipmentId!, (equipment) => {
        const { fixedStat: _fixedStat, ...rest } = equipment;
        return rest;
      }));
    }
    if (state.target === 'effect' && state.gearSetId && state.equipmentId && state.effectId) {
      const effectId = state.effectId as EquipmentEffectId;
      mutateLibrary((prev) => updateLibraryEquipment(prev, state.gearSetId!, state.equipmentId!, (equipment) => {
        const nextEffects = { ...equipment.effects };
        delete nextEffects[effectId];
        return { ...equipment, effects: nextEffects };
      }));
    }
    if (state.target === 'threePieceBuff' && state.gearSetId) {
      const effectId = state.effectId!;
      mutateLibrary((prev) => updateLibrarySet(prev, state.gearSetId!, (gearSet) => {
        const nextThreePieceBuffs = { ...(gearSet.threePieceBuffs || {}) };
        delete nextThreePieceBuffs[effectId];
        return { ...gearSet, threePieceBuffs: nextThreePieceBuffs };
      }));
      setSelectedRowKey(`three-piece-buff-header-${state.gearSetId}`);
    }
    closeContextMenu();
  }, [closeContextMenu, mutateLibrary]);

  const duplicateEquipment = useCallback((gearSetId: string, equipmentId: string) => {
    mutateLibrary((prev) => updateLibrarySet(prev, gearSetId, (gearSet) => {
      const source = gearSet.equipments[equipmentId];
      if (!source) return gearSet;
      const nextId = makeNextId(`${equipmentId}-copy`, Object.keys(gearSet.equipments));
      return {
        ...gearSet,
        equipments: {
          ...gearSet.equipments,
          [nextId]: { ...JSON.parse(JSON.stringify(source)), equipmentId: nextId, name: `${source.name} 副本` },
        },
      };
    }));
  }, [mutateLibrary]);

  const duplicateEffect = useCallback((gearSetId: string, equipmentId: string, effectId: EquipmentEffectId) => {
    mutateLibrary((prev) => updateLibraryEquipment(prev, gearSetId, equipmentId, (equipment) => {
      const freeEffectId = EFFECT_IDS.find((candidate) => !equipment.effects[candidate]);
      const source = equipment.effects[effectId];
      if (!freeEffectId || !source) return equipment;
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [freeEffectId]: { ...JSON.parse(JSON.stringify(source)), effectId: freeEffectId, label: `${source.label} 副本` },
        },
      };
    }));
  }, [mutateLibrary]);

  const copyJsonToClipboard = useCallback(async (value: unknown) => {
    const text = JSON.stringify(value, null, 2);
    await navigator.clipboard?.writeText(text);
    setMessage('已复制 JSON 到剪贴板。');
  }, []);

  const buildContextMenuActions = useCallback((state: EquipmentContextMenuState): EquipmentContextMenuAction[] => {
    const actions: EquipmentContextMenuAction[] = [];
    if (state.target === 'blank') {
      actions.push(
        { key: 'new-set', label: '新增套装', icon: 'new', onClick: createGearSet },
        { key: 'collapse-all', label: '全部折叠', icon: 'collapse', onClick: collapseAll },
        { key: 'expand-all', label: '全部展开', icon: 'expand', onClick: expandAll },
      );
    }
    if (state.target === 'set' && state.gearSetId) {
      const gearSet = library.gearSets[state.gearSetId];
      actions.push(
        { key: 'new-equipment', label: '新增装备', icon: 'new', onClick: () => createEquipmentInSet(state.gearSetId!) },
        {
          key: 'toggle-set',
          label: collapsedGearSetIds[state.gearSetId] === false ? '折叠套装' : '展开套装',
          icon: collapsedGearSetIds[state.gearSetId] === false ? 'collapse' : 'expand',
          onClick: () => setCollapsedGearSetIds((prev) => ({ ...prev, [state.gearSetId!]: prev[state.gearSetId!] === false })),
        },
        { key: 'export-set', label: '导出当前套装', icon: 'open', onClick: () => gearSet && downloadJson(`${gearSet.gearSetId}.json`, JSON.stringify(buildDraftLibraryShareFile(EQUIPMENT_LIBRARY_SHARE_TYPE, { [gearSet.gearSetId]: gearSet }, gearSet.name), null, 2)) },
        { key: 'delete-set', label: '删除套装', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'threePieceBuffHeader' && state.gearSetId) {
      const gearSet = library.gearSets[state.gearSetId];
      const hasEffects = Object.keys(gearSet?.threePieceBuffs || {}).length > 0;
      const isCollapsed = collapsedThreePieceBuffIds[state.gearSetId] === true;
      actions.push(
        { key: 'new-three-piece-effect', label: '添加 effect', icon: 'new', onClick: () => createThreePieceEffectInSet(state.gearSetId!) },
        ...(hasEffects
          ? [{ key: 'toggle-three-piece-effect', label: isCollapsed ? '展开 effect' : '折叠 effect', icon: isCollapsed ? 'expand' as const : 'collapse' as const, onClick: () => setCollapsedThreePieceBuffIds((prev) => ({ ...prev, [state.gearSetId!]: !isCollapsed })) }]
          : []),
      );
    }
    if (state.target === 'threePieceBuff' && state.gearSetId && state.effectId) {
      actions.push(
        { key: 'edit-three-piece-effect', label: '编辑 Buff', icon: 'open', onClick: () => openEquipmentBuffDrawer(state.gearSetId!, state.effectId!) },
        { key: 'copy-three-piece-effect', label: '复制 effect', icon: 'new', onClick: () => duplicateThreePieceEffect(state.gearSetId!, state.effectId!) },
        { key: 'delete-three-piece-effect', label: '删除 effect', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'equipment' && state.gearSetId && state.equipmentId) {
      const equipment = library.gearSets[state.gearSetId]?.equipments[state.equipmentId];
      if (equipment && !equipment.fixedStat) {
        actions.push({ key: 'add-fixed', label: '新增固定数值', icon: 'new', onClick: () => addFixedStat(state.gearSetId!, state.equipmentId!) });
      }
      if (equipment && getEffectEntries(equipment).length < 3) {
        actions.push({ key: 'add-effect', label: '新增 effect', icon: 'new', onClick: () => createEffectInEquipment(state.gearSetId!, state.equipmentId!) });
      }
      const isCollapsed = collapsedEquipmentIds[`${state.gearSetId}:${state.equipmentId}`] !== false;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'toggle-equipment', label: isCollapsed ? '展开装备' : '折叠装备', icon: isCollapsed ? 'expand' : 'collapse', onClick: () => setCollapsedEquipmentIds((prev) => ({ ...prev, [`${state.gearSetId}:${state.equipmentId}`]: !isCollapsed })) },
        { key: 'copy-equipment', label: '复制装备', icon: 'new', onClick: () => duplicateEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'delete-equipment', label: '删除装备', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if (state.target === 'fixedStat' && state.gearSetId && state.equipmentId) {
      const fixedStat = library.gearSets[state.gearSetId]?.equipments[state.equipmentId]?.fixedStat;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'copy-fixed-json', label: '复制 fixedStat JSON', icon: 'open', onClick: () => copyJsonToClipboard(fixedStat ?? {}) },
        { key: 'delete-fixed', label: '删除 fixedStat', icon: 'delete', onClick: () => deleteNode(state) },
      );
    }
    if ((state.target === 'effect' || state.target === 'effectLevels') && state.gearSetId && state.equipmentId && state.effectId) {
      const effectId = state.effectId as EquipmentEffectId;
      const effect = library.gearSets[state.gearSetId]?.equipments[state.equipmentId]?.effects[effectId];
      const effectCollapseKey = `${state.gearSetId}:${state.equipmentId}:${state.effectId}`;
      const isCollapsed = collapsedEffectIds[effectCollapseKey] !== false;
      actions.push(
        { key: 'expand-current-equipment', label: '全部展开当前装备', icon: 'expand', onClick: () => expandCurrentEquipment(state.gearSetId!, state.equipmentId!) },
        { key: 'toggle-effect', label: isCollapsed ? '展开等级' : '折叠等级', icon: isCollapsed ? 'expand' : 'collapse', onClick: () => setCollapsedEffectIds((prev) => ({ ...prev, [effectCollapseKey]: !isCollapsed })) },
        { key: 'copy-effect', label: '复制 effect', icon: 'new', onClick: () => duplicateEffect(state.gearSetId!, state.equipmentId!, effectId) },
        { key: 'copy-level-json', label: '复制等级 JSON', icon: 'open', onClick: () => copyJsonToClipboard(effect?.levels ?? {}) },
        { key: 'delete-effect', label: '删除 effect', icon: 'delete', onClick: () => deleteNode({ ...state, target: 'effect' }) },
      );
    }
    return actions;
  }, [addFixedStat, collapsedEffectIds, collapsedEquipmentIds, collapsedGearSetIds, collapsedThreePieceBuffIds, collapseAll, copyJsonToClipboard, createEffectInEquipment, createEquipmentInSet, createGearSet, createThreePieceEffectInSet, deleteNode, duplicateEffect, duplicateEquipment, duplicateThreePieceEffect, expandAll, expandCurrentEquipment, handleCreateNew, library.gearSets, openEquipmentBuffDrawer]);

  const updateCellValue = useCallback((row: EquipmentRow, columnKey: EquipmentSheetColumn['key'], rawValue: string) => {
    mutateLibrary((prev) => applyCellValueToLibrary(prev, row, columnKey, rawValue));
  }, [mutateLibrary]);

  const selectedWorkbookRow = useMemo(
    () => workbookRows.find((row) => row.sourceRow.key === selectedCell?.sourceRowKey) ?? null,
    [selectedCell?.sourceRowKey, workbookRows],
  );
  const selectedWorkbookCell = useMemo(
    () => selectedWorkbookRow?.cells.find((cell) => cell.columnKey === selectedCell?.columnKey) ?? null,
    [selectedCell?.columnKey, selectedWorkbookRow],
  );
  const formulaBinding = useMemo<EquipmentFormulaBinding | null>(() => {
    if (!selectedWorkbookRow || !selectedWorkbookCell) {
      return null;
    }
    const row = selectedWorkbookRow.sourceRow;
    const columnKey = selectedWorkbookCell.columnKey;
    if (row.kind === 'effectLevels') {
      const levelKey = selectedCell?.address?.replace(/^Lv/, '') as EquipmentLevelKey;
      if (!LEVEL_KEYS.includes(levelKey)) {
        return null;
      }
      const effect = library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.effects[row.effectId];
      return {
        key: `${row.key}:${levelKey}`,
        value: effect?.levels[levelKey] == null ? '' : String(effect.levels[levelKey]),
        inputMode: 'number',
        placeholder: `Lv${levelKey}`,
        readOnly: true,
        commit: () => undefined,
      };
    }
    const editable =
      (row.kind === 'set' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'threePieceBuffHeader' && false)
      || (row.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(columnKey))
      || (row.kind === 'equipment' && ['name', 'field', 'description'].includes(columnKey))
      || (row.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'effect' && ['name', 'field', 'effectKey', 'description'].includes(columnKey));
    if (!editable) {
      return {
        key: `${row.key}:${columnKey}:readonly`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        readOnly: true,
        commit: () => undefined,
      };
    }
    if ((row.kind === 'set' || row.kind === 'equipment') && columnKey === 'description') {
      const value = row.kind === 'set'
        ? library.gearSets[row.gearSetId]?.imgUrl ?? ''
        : library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.imgUrl ?? '';
      return {
        key: `${row.key}:imgUrl`,
        value,
        inputMode: 'text',
        control: 'image-search-select',
        placeholder: row.kind === 'set' ? '搜索套装配图' : '搜索装备配图',
        commit: (nextValue) => updateCellValue(row, columnKey, nextValue),
      };
    }
    if (row.kind === 'equipment' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_PARTS.map((part) => ({ value: part, label: part })),
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'threePieceBuff' && columnKey === 'field') {
      const selectedBuff = library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId];
      return {
        key: `${row.key}:${columnKey}`,
        value: getEquipmentBuffBusinessType(selectedBuff),
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'fixedStat' && columnKey === 'effectKey') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'defense', label: '防御力 · defense' },
          { value: 'hp', label: '生命 · hp' },
          { value: 'flatAtk', label: '固定攻击力 · flatAtk' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'effect' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: row.field === '能力值' ? 'ability' : 'buff',
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'ability', label: '能力值' },
          { value: 'buff', label: 'Buff类型' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if ((row.kind === 'effect' || row.kind === 'threePieceBuff') && columnKey === 'effectKey') {
      if (row.kind === 'threePieceBuff' && library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId]?.effectKind === 'extraHit') {
        return {
          key: `${row.key}:${columnKey}:extra-hit-types`,
          value: selectedWorkbookCell.value,
          inputMode: 'text',
          readOnly: true,
          commit: () => undefined,
        };
      }
      const effectOptions = row.kind === 'effect'
        ? (() => {
            const equipment = library.gearSets[row.gearSetId]?.equipments[row.equipmentId];
            const effect = equipment?.effects[row.effectId];
            return equipment && effect
              ? getEquipmentEffectTypeOptions(equipment.part, row.effectId, effect.category).map((typeKey) => ({
                  value: typeKey,
                  label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`,
                }))
              : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
          })()
        : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'search-select',
        options: effectOptions,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCell.value,
      inputMode: columnKey === 'valueText' ? 'number' : 'text',
      commit: (value) => updateCellValue(row, columnKey, value),
    };
  }, [library.gearSets, selectedCell?.address, selectedWorkbookCell, selectedWorkbookRow, updateCellValue]);

  const hasUnsavedChanges = isDirty
    || Boolean(formulaBinding && !formulaBinding.readOnly && formulaInput !== formulaBinding.value);

  const handleSelectEquipmentImage = useCallback((displayUrl: string) => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit(displayUrl);
    setFormulaInput(displayUrl);
    setEquipmentImageQuery(displayUrl);
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding]);

  const handleClearEquipmentImage = useCallback(() => {
    if (!formulaBinding || formulaBinding.control !== 'image-search-select') return;
    formulaBinding.commit('');
    setFormulaInput('');
    setEquipmentImageQuery('');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding]);

  useEffect(() => {
    setFormulaInput(formulaBinding?.value ?? '');
    if (formulaBinding?.control !== 'search-select') {
      setBuffTypeQuery('');
    }
    setEquipmentImageQuery(formulaBinding?.control === 'image-search-select' ? (formulaBinding.value ?? '') : '');
    setIsEquipmentImageDrawerOpen(false);
  }, [formulaBinding?.key, formulaBinding?.value, formulaBinding?.control]);

  useEffect(() => {
    if (!isEquipmentImageDrawerOpen) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (equipmentImageFormulaRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsEquipmentImageDrawerOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsEquipmentImageDrawerOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [isEquipmentImageDrawerOpen]);

  useEffect(() => {
    setEquipmentImageLoadFailed(false);
  }, [previewImageMeta.imgUrl]);

  const buildLibraryWithCommittedFormulaInput = useCallback((baseLibrary: EquipmentLibrary) => {
    if (!formulaBinding || formulaBinding.readOnly || formulaInput === formulaBinding.value || !selectedWorkbookRow || !selectedCell) {
      return baseLibrary;
    }
    const row = selectedWorkbookRow.sourceRow;
    if (row.kind === 'effectLevels') return baseLibrary;
    return applyCellValueToLibrary(baseLibrary, row, selectedCell.columnKey, formulaInput);
  }, [formulaBinding, formulaInput, selectedCell, selectedWorkbookRow]);

  const commitFormulaInput = useCallback(() => {
    if (!formulaBinding || formulaBinding.readOnly) {
      return;
    }
    formulaBinding.commit(formulaInput);
  }, [formulaBinding, formulaInput]);

  const performSave = useCallback(async () => {
    const committedLibrary = buildLibraryWithCommittedFormulaInput(library);
    const emptyBuffSets = getGearSets(committedLibrary).filter((gearSet) => !gearSet.buffId?.trim()).length;
    const nextLibrary = { ...committedLibrary, updatedAt: new Date().toISOString() };
    const warning = emptyBuffSets > 0 ? ` ${emptyBuffSets} 个套装 buffId 为空，请后续补齐。` : '';
    if (committedLibrary !== library) {
      setLibrary(committedLibrary);
    }
    if (!window.desktopRuntime?.writeEquipmentLibrary) {
      writeLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      setLibrary(nextLibrary);
      setIsDirty(false);
      setIsSaveConfirmModalOpen(false);
      setMessage(`浏览器环境已保存到 localStorage。${warning}`);
      return;
    }
    const result = await writeEquipmentLibraryToFile(nextLibrary);
    if (result.ok) {
      writeLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, nextLibrary);
      setLibrary(nextLibrary);
      setIsDirty(false);
      setIsSaveConfirmModalOpen(false);
    }
    setMessage(result.ok ? `已保存到本地 JSON。缓存已同步更新。${warning}` : `${result.error}${warning}`);
  }, [buildLibraryWithCommittedFormulaInput, library]);

  const handleSave = useCallback(() => {
    if (isOverwriteProtectionEnabled) {
      setIsSaveConfirmModalOpen(true);
      return;
    }
    void performSave();
  }, [isOverwriteProtectionEnabled, performSave]);

  const handleConfirmSave = useCallback(() => {
    setIsSaveConfirmModalOpen(false);
    void performSave();
  }, [performSave]);

  const clearSelectedCell = useCallback(() => {
    if (!selectedWorkbookRow || !selectedCell) {
      return;
    }
    const row = selectedWorkbookRow.sourceRow;
    const columnKey = selectedCell.columnKey;
    if (columnKey === 'idText' || (row.kind === 'equipment' && columnKey === 'field')) {
      return;
    }
    if (row.kind === 'effectLevels') {
      return;
    }
    const editable =
      (row.kind === 'set' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'threePieceBuffHeader' && false)
      || (row.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(columnKey))
      || (row.kind === 'equipment' && ['name', 'description'].includes(columnKey))
      || (row.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'effect' && ['name', 'effectKey', 'description'].includes(columnKey));
    if (editable) {
      updateCellValue(row, columnKey, '');
    }
  }, [selectedCell, selectedWorkbookRow, updateCellValue]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [handleSave]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (!selectedCell) {
        return;
      }
      const currentRowIndex = workbookRows.findIndex((row) => row.sourceRow.key === selectedCell.sourceRowKey);
      const currentColumnIndex = COLUMNS.findIndex((column) => column.key === selectedCell.columnKey);
      if (currentRowIndex < 0 || currentColumnIndex < 0) {
        return;
      }
      const selectByIndex = (rowIndex: number, columnIndex: number) => {
        const nextRow = workbookRows[Math.max(0, Math.min(workbookRows.length - 1, rowIndex))];
        const nextColumn = COLUMNS[Math.max(0, Math.min(COLUMNS.length - 1, columnIndex))];
        if (!nextRow || !nextColumn) return;
        setSelectedRowKey(nextRow.sourceRow.key);
        setSelectedCell({
          address: `${columnIndexToLabel(COLUMNS.indexOf(nextColumn))}${nextRow.rowNumber}`,
          sourceRowKey: nextRow.sourceRow.key,
          columnKey: nextColumn.key,
        });
      };
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectByIndex(currentRowIndex - 1, currentColumnIndex);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectByIndex(currentRowIndex + 1, currentColumnIndex);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectByIndex(currentRowIndex, currentColumnIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectByIndex(currentRowIndex, currentColumnIndex + 1);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        let nextRowIndex = currentRowIndex;
        let nextColumnIndex = currentColumnIndex + direction;
        if (nextColumnIndex >= COLUMNS.length) {
          nextColumnIndex = 0;
          nextRowIndex += 1;
        }
        if (nextColumnIndex < 0) {
          nextColumnIndex = COLUMNS.length - 1;
          nextRowIndex -= 1;
        }
        selectByIndex(nextRowIndex, nextColumnIndex);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        clearSelectedCell();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelectedCell, selectedCell, workbookRows]);

  const openShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleCopyShareJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentShareText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = currentShareText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, [currentShareText]);

  const prepareImportShare = useCallback((rawText: string) => {
    const parsed = parseDraftLibraryShareFile(rawText, EQUIPMENT_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setPendingImportShare(null);
      setShareImportError('导入失败：文件不是有效的装备库分享 JSON。');
      return;
    }
    const normalizedPayload = normalizeEquipmentLibrary({
      gearSets: parsed.payload,
    }).gearSets;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效套装。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<EquipmentGearSet>);
  }, []);

  const handleExportLocalLibrary = useCallback(() => {
    downloadJson(buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt), currentShareText);
  }, [currentShareFile.exportedAt, currentShareFile.label, currentShareText]);

  const handleOpenShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const handleParseImportText = useCallback(() => {
    prepareImportShare(shareImportText);
  }, [prepareImportShare, shareImportText]);

  const handleCancelImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setShareImportText(text);
    prepareImportShare(text);
  }, [prepareImportShare]);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) return;
    mutateLibrary((prev) => normalizeEquipmentLibrary({
      ...prev,
      gearSets: {
        ...prev.gearSets,
        ...pendingImportShare.payload,
      },
    }));
    setMessage(`已导入 ${Object.keys(pendingImportShare.payload).length} 个套装。`);
    closeShareModal();
  }, [closeShareModal, mutateLibrary, pendingImportShare]);

  const renderFormulaEditor = () => {
    if (!formulaBinding) {
      return <div className="damage-sheet-formula-value">{message}</div>;
    }
    if (formulaBinding.readOnly) {
      return <input className="buff-sheet-formula-input" value={formulaBinding.value} readOnly />;
    }
    if (formulaBinding.control === 'select') {
      return (
        <select
          className="buff-sheet-formula-input is-select"
          value={formulaBinding.value}
          onChange={(event) => formulaBinding.commit(event.target.value)}
        >
          {(formulaBinding.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (formulaBinding.control === 'search-select') {
      const keyword = buffTypeQuery.trim().toLowerCase();
      const searchOptions = (formulaBinding.options ?? BUFF_TYPE_OPTIONS.map((typeKey) => ({
        value: typeKey,
        label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`,
      }))).filter((option) => !keyword || `${option.label} ${option.value}`.toLowerCase().includes(keyword));
      return (
        <div className="buff-sheet-formula-type-editor">
          <input
            className="buff-sheet-formula-input buff-sheet-formula-type-search"
            value={buffTypeQuery}
            onChange={(event) => setBuffTypeQuery(event.target.value)}
            placeholder="搜索类型：敏捷 / 物理 / sourceSkillBoost"
          />
          <select
            className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
            value={formulaBinding.value}
            onChange={(event) => formulaBinding.commit(event.target.value)}
          >
            <option value="">未映射</option>
            {searchOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }
    if (formulaBinding.control === 'image-search-select') {
      const clearLabel = selectedWorkbookRow?.sourceRow.kind === 'set' ? '清空套装配图' : '清空装备配图';
      const clearHint = selectedWorkbookRow?.sourceRow.kind === 'set' ? '移除当前套装 imgUrl' : '移除当前装备 imgUrl';
      return (
        <div className="weapon-sheet-image-formula-editor" ref={equipmentImageFormulaRef}>
          <input
            className="buff-sheet-formula-input weapon-sheet-image-formula-search"
            value={equipmentImageQuery}
            onChange={(event) => setEquipmentImageQuery(event.target.value)}
            onClick={() => setIsEquipmentImageDrawerOpen(true)}
            onKeyDown={stopEditingKeyPropagation}
            placeholder="搜索图片：文件名 / baseName / 路径 / URL"
          />
          {isEquipmentImageDrawerOpen ? (
            <div className="weapon-sheet-image-formula-results">
              <div className="weapon-sheet-image-formula-toolbar">
                <button
                  type="button"
                  className={`weapon-sheet-image-option weapon-sheet-image-option-clear${!formulaBinding.value ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleClearEquipmentImage}
                >
                  <span className="weapon-sheet-image-option-thumb weapon-sheet-image-option-thumb-empty">无图</span>
                  <span className="weapon-sheet-image-option-meta">
                    <strong>{clearLabel}</strong>
                    <span>{clearHint}</span>
                  </span>
                </button>
              </div>
              {imageAssetsLoading ? (
                <div className="weapon-sheet-image-picker-empty">图片资源加载中...</div>
              ) : imageAssetsError ? (
                <div className="weapon-sheet-image-picker-empty">图片资源加载失败：{imageAssetsError}</div>
              ) : filteredEquipmentImageOptions.length === 0 ? (
                <div className="weapon-sheet-image-picker-empty">没有匹配的图片</div>
              ) : (
                <div className="weapon-sheet-image-picker-list">
                  {filteredEquipmentImageOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`weapon-sheet-image-option${formulaBinding.value === option.displayUrl ? ' is-active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectEquipmentImage(option.displayUrl)}
                    >
                      <span className="weapon-sheet-image-option-thumb">
                        <img src={option.displayUrl} alt={option.fileName} />
                      </span>
                      <span className="weapon-sheet-image-option-meta">
                        <strong>{option.fileName}</strong>
                        <span>{option.relativePath}</span>
                        <em>{option.source === 'user' ? 'user' : 'builtin'}</em>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <input
        className="buff-sheet-formula-input"
        type={formulaBinding.inputMode === 'number' ? 'number' : 'text'}
        step="any"
        value={formulaInput}
        placeholder={formulaBinding.placeholder}
        onChange={(event) => setFormulaInput(event.target.value)}
        onBlur={commitFormulaInput}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitFormulaInput();
          }
          if (event.key === 'Escape') {
            setFormulaInput(formulaBinding.value);
          }
        }}
      />
    );
  };

  const renderEditableCell = (row: EquipmentWorkbookRow, cell: EquipmentWorkbookCell) => {
    const sourceRow = row.sourceRow;
    const editable =
      (sourceRow.kind === 'set' && ['name', 'effectKey', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'threePieceBuffHeader' && false)
      || (sourceRow.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'equipment' && ['name', 'field', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(cell.columnKey))
      || (sourceRow.kind === 'effect' && ['name', 'field', 'effectKey', 'description'].includes(cell.columnKey));
    if (!editable) {
      return cell.value;
    }
    if (sourceRow.kind === 'equipment' && cell.columnKey === 'field') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          {EQUIPMENT_PARTS.map((part) => <option key={part} value={part}>{part}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'threePieceBuff' && cell.columnKey === 'field') {
      const buff = library.gearSets[sourceRow.gearSetId]?.threePieceBuffs?.[sourceRow.effectId];
      return (
        <select
          className="weapon-sheet-inline-input"
          value={getEquipmentBuffBusinessType(buff)}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          {EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'effect' && cell.columnKey === 'field') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={sourceRow.field === '能力值' ? 'ability' : 'buff'}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="ability">能力值</option>
          <option value="buff">Buff类型</option>
        </select>
      );
    }
    if ((sourceRow.kind === 'effect' || sourceRow.kind === 'threePieceBuff') && cell.columnKey === 'effectKey') {
      const isExtraHit = sourceRow.kind === 'threePieceBuff'
        && library.gearSets[sourceRow.gearSetId]?.threePieceBuffs?.[sourceRow.effectId]?.effectKind === 'extraHit';
      if (isExtraHit) return cell.value;
      const typeOptions = sourceRow.kind === 'effect'
        ? (() => {
            const equipment = library.gearSets[sourceRow.gearSetId]?.equipments[sourceRow.equipmentId];
            const effect = equipment?.effects[sourceRow.effectId];
            return equipment && effect
              ? getEquipmentEffectTypeOptions(equipment.part, sourceRow.effectId, effect.category)
              : BUFF_TYPE_OPTIONS;
          })()
        : BUFF_TYPE_OPTIONS;
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="">未映射</option>
          {typeOptions.map((typeKey) => <option key={typeKey} value={typeKey}>{`${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`}</option>)}
        </select>
      );
    }
    if (sourceRow.kind === 'fixedStat' && cell.columnKey === 'effectKey') {
      return (
        <select
          className="weapon-sheet-inline-input"
          value={cell.value}
          onKeyDown={stopEditingKeyPropagation}
          onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
        >
          <option value="defense">防御力 · defense</option>
          <option value="hp">生命 · hp</option>
          <option value="flatAtk">固定攻击力 · flatAtk</option>
        </select>
      );
    }
    return (
      <input
        className="weapon-sheet-inline-input"
        value={cell.value}
        type={cell.columnKey === 'valueText' ? 'number' : 'text'}
        step="any"
        onKeyDown={stopEditingKeyPropagation}
        onChange={(event) => updateCellValue(sourceRow, cell.columnKey, event.target.value)}
      />
    );
  };

  const renderExplorer = () => (
    <div className="buff-sheet-explorer-tree">
      <button
        type="button"
        className={`buff-sheet-explorer-row equipment-sheet-explorer-all${activeGearSetId ? '' : ' is-active'}`}
        onClick={() => {
          setActiveGearSetId(null);
          setActiveEquipmentId(null);
          setSelectedCell(null);
          setSelectedRowKey(filteredGearSets[0] ? `set-${filteredGearSets[0].gearSetId}` : '');
        }}
      >
        <span className="buff-sheet-explorer-label">全部套装</span>
        <span className="buff-sheet-explorer-count">{filteredGearSets.length}</span>
      </button>
      {filteredGearSets.length === 0 ? (
        <div className="damage-sheet-detail-empty">没有匹配的装备。</div>
      ) : filteredGearSets.map((gearSet) => {
        const isSetCollapsed = collapsedGearSetIds[gearSet.gearSetId] !== false;
        return (
          <div key={gearSet.gearSetId} className="buff-sheet-explorer-node">
            <button
              type="button"
              className={`buff-sheet-explorer-row${activeGearSetId === gearSet.gearSetId && selectedRowKey === `set-${gearSet.gearSetId}` ? ' is-active' : ''}`}
              onClick={() => {
                setActiveGearSetId(gearSet.gearSetId);
                setActiveEquipmentId(null);
                focusRow(`set-${gearSet.gearSetId}`, { expandAncestors: true, scroll: true });
              }}
              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'set', gearSetId: gearSet.gearSetId })}
            >
              <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                event.stopPropagation();
                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: prev[gearSet.gearSetId] === false }));
              }}>{isSetCollapsed ? '[+]' : '[-]'}</span>
              <span className="buff-sheet-explorer-label">{gearSet.name}</span>
              <span className="buff-sheet-explorer-count">{getEquipments(gearSet).length}</span>
            </button>
            {!isSetCollapsed ? (
              <div className="buff-sheet-explorer-children">
                {getSortedEquipments(gearSet).map((equipment) => {
                  const equipmentCollapseKey = `${gearSet.gearSetId}:${equipment.equipmentId}`;
                  const isEquipmentCollapsed = collapsedEquipmentIds[equipmentCollapseKey] !== false;
                  return (
                    <div key={equipment.equipmentId} className="buff-sheet-explorer-node">
                      <button
                        type="button"
                        className={`buff-sheet-explorer-child${selectedRowKey === `equipment-${gearSet.gearSetId}-${equipment.equipmentId}` ? ' is-active' : ''}`}
                        onClick={() => {
                          setActiveGearSetId(gearSet.gearSetId);
                          setActiveEquipmentId(equipment.equipmentId);
                          setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                          setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                          focusRow(`equipment-${gearSet.gearSetId}-${equipment.equipmentId}`, { expandAncestors: true, scroll: true });
                        }}
                        onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'equipment', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId })}
                      >
                        <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                          event.stopPropagation();
                          setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: prev[equipmentCollapseKey] === false }));
                        }}>{isEquipmentCollapsed ? '[+]' : '[-]'}</span>
                        <span className="buff-sheet-explorer-label">{equipment.name}</span>
                        <span className="buff-sheet-explorer-count">{equipment.part}</span>
                      </button>
                      {!isEquipmentCollapsed ? (
                        <div className="buff-sheet-explorer-children">
                          {equipment.fixedStat ? (
                            <button
                              type="button"
                              className={`buff-sheet-explorer-effect${selectedRowKey === `fixed-${gearSet.gearSetId}-${equipment.equipmentId}` ? ' is-active' : ''}`}
                              onClick={() => {
                                setActiveGearSetId(gearSet.gearSetId);
                                setActiveEquipmentId(equipment.equipmentId);
                                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                                setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                                focusRow(`fixed-${gearSet.gearSetId}-${equipment.equipmentId}`, { expandAncestors: true, scroll: true });
                              }}
                              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'fixedStat', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId })}
                            >
                              <span className="buff-sheet-explorer-label">{equipment.fixedStat.label}</span>
                              <span className="buff-sheet-explorer-count">固定</span>
                            </button>
                          ) : null}
                          {getEffectEntries(equipment).map(([effectId, effect]) => (
                            <button
                              key={effectId}
                              type="button"
                              className={`buff-sheet-explorer-effect${selectedRowKey === `effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}` ? ' is-active' : ''}`}
                              onClick={() => {
                                setActiveGearSetId(gearSet.gearSetId);
                                setActiveEquipmentId(equipment.equipmentId);
                                setCollapsedGearSetIds((prev) => ({ ...prev, [gearSet.gearSetId]: false }));
                                setCollapsedEquipmentIds((prev) => ({ ...prev, [equipmentCollapseKey]: false }));
                                focusRow(`effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`, { expandAncestors: true, scroll: true });
                              }}
                              onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effect', gearSetId: gearSet.gearSetId, equipmentId: equipment.equipmentId, effectId })}
                            >
                              <span className="damage-sheet-row-toggle buff-sheet-explorer-toggle" onClick={(event) => {
                                event.stopPropagation();
                                const key = `${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`;
                                setCollapsedEffectIds((prev) => ({ ...prev, [key]: prev[key] === false }));
                              }}>{collapsedEffectIds[`${gearSet.gearSetId}:${equipment.equipmentId}:${effectId}`] !== false ? '[+]' : '[-]'}</span>
                              <span className="buff-sheet-explorer-label">{`${effectId} · ${effect.label}`}</span>
                              <span className="buff-sheet-explorer-count">Lv0~Lv3</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <main className="damage-sheet-page buff-sheet-page weapon-sheet-page equipment-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Equipment</h1>
            <p>{'装备数据工作表 · 按 gearSet -> equipment -> fixed/effect -> Lv0~Lv3 编辑'}</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <span className={`equipment-sheet-save-status${hasUnsavedChanges ? ' is-dirty' : ''}`}>{hasUnsavedChanges ? '未保存' : '已保存'}</span>
          <button type="button" className="damage-sheet-action-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.weaponSheet)}>
            打开 Sheet-Weapon
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNew} title="新建装备项">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 3.25v9.5M3.25 8h9.5" /></svg></span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSave} title="保存当前装备库">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" /><path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" /></svg></span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalize} title="整理套装与装备顺序">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" /><path d="M11 3.25l1.75 1.25L11 5.75" /></svg></span>
            <span className="buff-sheet-tool-text">整理</span>
          </button>
          <button type="button" className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`} onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)} title="切换覆盖保护">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" /><path d="M6.25 8.25L7.4 9.4l2.35-2.55" /></svg></span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('export')} title="导出本地装备库">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 3v6.5" /><path d="M5.75 7.25L8 9.5l2.25-2.25" /><path d="M3.5 11.75h9" /></svg></span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openShareModal('import')} title="导入装备分享">
            <span className="buff-sheet-tool-icon" aria-hidden="true"><svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false"><path d="M8 13V6.5" /><path d="M5.75 8.75L8 6.5l2.25 2.25" /><path d="M3.5 3.25h9" /></svg></span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
        </div>

        <div className={`weapon-sheet-image-slot${previewImageMeta.imgUrl ? ' has-image' : ''}${equipmentImageLoadFailed ? ' is-broken' : ''}`} title={previewImageMeta.title}>
          <div className="weapon-sheet-image-slot-square">
            {previewImageMeta.imgUrl && !equipmentImageLoadFailed ? (
              <img
                className="weapon-sheet-image-preview"
                src={normalizeAssetUrl(previewImageMeta.imgUrl)}
                alt={previewImageMeta.alt}
                onError={() => setEquipmentImageLoadFailed(true)}
              />
            ) : null}
            {previewImageMeta.imgUrl && equipmentImageLoadFailed ? (
              <span className="weapon-sheet-image-fallback">加载失败</span>
            ) : null}
            {!previewImageMeta.imgUrl ? (
              <span className="weapon-sheet-image-fallback">主图</span>
            ) : null}
          </div>
        </div>

        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace weapon-sheet-workspace" onClick={closeContextMenu}>
        <aside
          className="damage-sheet-sidebar buff-sheet-explorer"
          onContextMenu={(event) => openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'blank' })}
        >
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input className="buff-sheet-search-input" value={filterKeyword} onChange={(event) => setFilterKeyword(event.target.value)} placeholder="按套装 / 装备 / 属性搜索" />
          <input ref={shareImportInputRef} type="file" accept=".json,application/json" className="operator-draft-file-input" onChange={handleShareFileSelected} />
          {renderExplorer()}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div className="damage-sheet-excel-scroll" ref={tableScrollRef}>
            <div className="damage-sheet-excel-row is-header">
              <div className="damage-sheet-excel-row-number">#</div>
              <div className="damage-sheet-excel-row-cells">
                {COLUMNS.map((column) => (
                  <div key={column.key} className={`damage-sheet-excel-cell is-header is-${column.align ?? 'left'}`} style={{ width: `${column.width}px` }}>{column.title}</div>
                ))}
              </div>
            </div>
            {workbookRows.map((row) => (
              <div
                key={row.key}
                data-equipment-row-key={row.sourceRow.key}
                className={`${getWorkbookRowClassName(row)}${selectedRowKey === row.sourceRow.key ? ' is-active' : ''}`}
                onClick={() => focusRow(row.sourceRow.key)}
                onDoubleClick={() => {
                  if (row.sourceRow.kind === 'threePieceBuff') {
                    openEquipmentBuffDrawer(row.sourceRow.gearSetId, row.sourceRow.effectId);
                  }
                }}
                onContextMenu={(event) => {
                  const sourceRow = row.sourceRow;
                  if (sourceRow.kind === 'set') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'set', gearSetId: sourceRow.gearSetId });
                  } else if (sourceRow.kind === 'threePieceBuffHeader') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'threePieceBuffHeader', gearSetId: sourceRow.gearSetId });
                  } else if (sourceRow.kind === 'threePieceBuff') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'threePieceBuff', gearSetId: sourceRow.gearSetId, effectId: sourceRow.effectId });
                  } else if (sourceRow.kind === 'equipment') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'equipment', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId });
                  } else if (sourceRow.kind === 'fixedStat') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'fixedStat', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId });
                  } else if (sourceRow.kind === 'effect') {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effect', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId, effectId: sourceRow.effectId });
                  } else {
                    openContextMenu(event, { x: event.clientX, y: event.clientY, target: 'effectLevels', gearSetId: sourceRow.gearSetId, equipmentId: sourceRow.equipmentId, effectId: sourceRow.effectId });
                  }
                }}
              >
                <div className="damage-sheet-excel-row-number">
                  {row.sourceRow.kind === 'set' || row.sourceRow.kind === 'threePieceBuffHeader' || row.sourceRow.kind === 'equipment' || row.sourceRow.kind === 'effect' ? (
                    <span className="damage-sheet-row-toggle" onClick={(event) => {
                      event.stopPropagation();
                      toggleRowCollapsed(row.sourceRow);
                    }}>{isRowCollapsed(row.sourceRow) ? '[+]' : '[-]'}</span>
                  ) : row.rowNumber}
                </div>
                <div className="damage-sheet-excel-row-cells">
                  {row.sourceRow.kind === 'effectLevels' ? (() => {
                    const levelRow = row.sourceRow;
                    const gearSet = library.gearSets[levelRow.gearSetId];
                    const equipment = gearSet?.equipments[levelRow.equipmentId];
                    const effect = equipment?.effects[levelRow.effectId];
                    return (
                      <div className="damage-sheet-excel-cell is-effectLevels is-left weapon-sheet-growth-merged-cell" style={{ width: `${COLUMNS.reduce((sum, column) => sum + column.width, 0)}px` }}>
                        <div className="weapon-sheet-growth-inline-grid weapon-sheet-levels-inline-grid">
                          {LEVEL_KEYS.map((levelKey) => (
                            <div key={levelKey} className="weapon-sheet-growth-inline-item">
                              <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                              <span
                                className="weapon-sheet-inline-input equipment-sheet-preset-value"
                                tabIndex={0}
                                onFocus={() => setSelectedCell({ address: `Lv${levelKey}`, sourceRowKey: levelRow.key, columnKey: 'valueText' })}
                              >
                                {effect?.levels[levelKey] ?? '-'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })() : row.cells.map((cell) => (
                    <div
                      key={cell.key}
                      className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align} is-col-${cell.columnKey}${selectedCell?.address === cell.address ? ' is-active' : ''}`}
                      style={{ width: `${cell.width}px` }}
                      onClick={(event) => {
                        event.stopPropagation();
                        const isTopLevelCell = row.sourceRow.kind === 'set' || row.sourceRow.kind === 'equipment';
                        if (isTopLevelCell) {
                          setSelectedRowKey(row.sourceRow.key);
                        } else {
                          focusRow(row.sourceRow.key);
                        }
                        setSelectedCell({ address: cell.address, sourceRowKey: cell.sourceRowKey, columnKey: cell.columnKey });
                      }}
                    >
                      {renderEditableCell(row, cell)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <BuffEffectEditorDrawer
        open={Boolean(buffDrawerTarget)}
        sourceLabel={`装备三件套 · ${buffDrawerTarget ? library.gearSets[buffDrawerTarget.gearSetId]?.name ?? buffDrawerTarget.gearSetId : ''}`}
        effect={buffDrawerTarget
          ? (() => {
              const buff = library.gearSets[buffDrawerTarget.gearSetId]?.threePieceBuffs?.[buffDrawerTarget.effectId];
              return buff ? equipmentBuffToDrawer(buff) : null;
            })()
          : null}
        onChange={(nextEffect) => {
          if (!buffDrawerTarget) return;
          mutateLibrary((prev) => updateLibrarySet(prev, buffDrawerTarget.gearSetId, (gearSet) => ({
            ...gearSet,
            threePieceBuffs: {
              ...(gearSet.threePieceBuffs || {}),
              [buffDrawerTarget.effectId]: drawerEffectToEquipmentBuff(nextEffect),
            },
          })));
        }}
        onClose={() => setBuffDrawerTarget(null)}
      />

      {contextMenu ? (
        <div className="buff-sheet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          {buildContextMenuActions(contextMenu).map((action) => (
            <button key={action.key} type="button" className="buff-sheet-context-menu-item" onClick={() => { action.onClick(); closeContextMenu(); }}>
              <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">{renderMenuIcon(action.icon)}</svg>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {isSaveConfirmModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsSaveConfirmModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认保存装备库</h3>
                <p>保护开启时，保存前需要确认覆盖本地装备 JSON。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <p>确认后会将当前 Sheet Equipment 编辑内容写入本地装备库文件。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsSaveConfirmModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmSave}>
                确认保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isShareModalOpen ? (
        <div className="buff-sheet-share-modal-mask" onClick={closeShareModal}>
          <div className="buff-sheet-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="buff-sheet-share-modal-header">
              <div className="buff-sheet-share-modal-tabs">
                <button type="button" className={`buff-sheet-share-modal-tab${shareModalMode === 'export' ? ' is-active' : ''}`} onClick={() => setShareModalMode('export')}>导出</button>
                <button type="button" className={`buff-sheet-share-modal-tab${shareModalMode === 'import' ? ' is-active' : ''}`} onClick={() => setShareModalMode('import')}>导入</button>
              </div>
              <button type="button" className="buff-sheet-share-modal-close" onClick={closeShareModal} aria-label="关闭">×</button>
            </div>
            {shareModalMode === 'export' ? (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-tabs">
                    <button type="button" className={`buff-sheet-share-modal-tab${exportScope === 'current' ? ' is-active' : ''}`} onClick={() => setExportScope('current')}>导出当前</button>
                    <button type="button" className={`buff-sheet-share-modal-tab${exportScope === 'all' ? ' is-active' : ''}`} onClick={() => setExportScope('all')}>导出全部</button>
                  </div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleCopyShareJson}>复制 JSON</button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleExportLocalLibrary}>导出文件</button>
                  </div>
                </div>
                <textarea className="buff-sheet-share-textarea is-preview" readOnly value={currentShareText} spellCheck={false} />
              </div>
            ) : (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleOpenShareImportPicker}>导入文件</button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleParseImportText}>读取粘贴内容</button>
                  </div>
                </div>
                <textarea
                  className="buff-sheet-share-textarea"
                  value={shareImportText}
                  onChange={(event) => {
                    setShareImportText(event.target.value);
                    if (shareImportError) {
                      setShareImportError('');
                    }
                  }}
                  placeholder="把装备分享 JSON 粘贴到这里，或点击右上角导入文件。"
                  spellCheck={false}
                />
                {shareImportError ? <div className="buff-sheet-share-feedback is-error">{shareImportError}</div> : null}
                {pendingImportShare ? (
                  <div className="buff-sheet-share-import-preview">
                    <div className="buff-sheet-share-import-title">导入预览</div>
                    <div className="buff-sheet-share-import-meta">
                      <span>{`名称：${pendingImportShare.label}`}</span>
                      <span>{`套装数：${Object.keys(pendingImportShare.payload).length}`}</span>
                    </div>
                    <div className="buff-sheet-share-modal-actions">
                      <button type="button" className="buff-sheet-share-action" onClick={handleCancelImportShare}>清空预览</button>
                      <button type="button" className="buff-sheet-share-action is-primary" onClick={handleConfirmImportShare}>确认导入</button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
