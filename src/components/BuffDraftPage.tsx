import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import ExcelJS from 'exceljs';
import { pinyin } from 'pinyin-pro';
import './OperatorDraftPage.css';
import './BuffDraftPage.css';
import type { BuffCategory, BuffEffectKind, BuffExtraHitConfig, CandidateBuff } from '../core/domain/buff';
import { normalizeBuffMultiplier } from '../core/domain/buffMultiplier';
import { getMultiplierSupportedBuffTypes, isMultiplierSupportedBuffType } from '../core/domain/buffTypeRegistry';
import { normalizeStoredBuffDefinition } from '../core/services/buffStorageNormalization';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import BuffEffectEditorDrawer from './BuffEffectEditorDrawer';
import type { OperatorBuffEffect } from './operatorDraftBuffModel';

const BUFF_SHEET_PAGE_PATH = APP_ROUTE_PATHS.buffSheet;
const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';
const BUFF_LIBRARY_SHARE_TYPE = 'buff-library-share.v1';
const BUFF_UNDO_STORAGE_KEY = 'def.buff-editor.undo.v1';
const BUFF_UNDO_LIMIT = 8;

interface BuffUndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  selectedDraftId?: string;
  draftState?: BuffDraft;
  selectedItemKey?: string | null;
  selectedEffectKey?: string | null;
  localEntries: Array<[string, string | null]>;
}

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
  'allElementDmgBonus',
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
  'sourceSkillBoost',
] as const;

const BUFF_TYPE_LABELS: Record<(typeof BUFF_TYPE_OPTIONS)[number], { label: string; keywords: string[] }> = {
  atkPercentBoost: { label: '攻击力百分比', keywords: ['攻击', '攻击力', 'atk'] },
  flatAtk: { label: '固定攻击力', keywords: ['攻击', '固定攻击', 'atk'] },
  mainStatBoost: { label: '主能力提升', keywords: ['主能力', '主属性', '主词条'] },
  subStatBoost: { label: '副能力提升', keywords: ['副能力', '副属性', '副词条'] },
  allStatBoost: { label: '全属性提升', keywords: ['全属性', '全能力'] },
  strengthBoost: { label: '力量提升', keywords: ['力量', 'strength'] },
  agilityBoost: { label: '敏捷提升', keywords: ['敏捷', 'agility'] },
  intelligenceBoost: { label: '智识提升', keywords: ['智识', '智能', 'intelligence'] },
  willBoost: { label: '意志提升', keywords: ['意志', 'will'] },
  critRateBoost: { label: '暴击率', keywords: ['暴击', '暴击率', 'crit'] },
  critDmgBonusBoost: { label: '暴击伤害', keywords: ['暴伤', '暴击伤害', 'crit'] },
  physicalDmgBonus: { label: '物理伤害加成', keywords: ['物理', '物伤'] },
  magicDmgBonus: { label: '法术伤害加成', keywords: ['法术', '魔法', 'magic'] },
  fireDmgBonus: { label: '灼热伤害加成', keywords: ['灼热', '火', '火伤'] },
  electricDmgBonus: { label: '电磁伤害加成', keywords: ['电磁', '雷', '电伤'] },
  iceDmgBonus: { label: '寒冷伤害加成', keywords: ['寒冷', '冰', '冰伤'] },
  natureDmgBonus: { label: '自然伤害加成', keywords: ['自然', '自然伤害'] },
  allElementDmgBonus: { label: '全元素伤害加成', keywords: ['元素', '全元素', '法术'] },
  allDmgBonus: { label: '全伤害加成', keywords: ['全伤害', '全增伤', '全部伤害'] },
  skillDmgBonus: { label: '战技伤害加成', keywords: ['战技', '技能', 'skill'] },
  chainSkillDmgBonus: { label: '连携技伤害加成', keywords: ['连携', '连携技'] },
  ultimateDmgBonus: { label: '终结技伤害加成', keywords: ['终结', '大招', 'ultimate'] },
  normalAttackDmgBonus: { label: '普攻伤害加成', keywords: ['普攻', '普通攻击'] },
  dotDmgBonus: { label: '持续伤害加成', keywords: ['持续伤害', 'Dot', 'DOT', 'dot'] },
  allSkillDmgBonus: { label: '全技能伤害加成', keywords: ['全技能', '技能'] },
  physicalFragile: { label: '物伤易伤', keywords: ['物理', '物伤', '易伤', '受伤增加'] },
  fireFragile: { label: '灼热脆弱', keywords: ['灼热', '脆弱'] },
  electricFragile: { label: '电磁脆弱', keywords: ['电磁', '脆弱'] },
  iceFragile: { label: '寒冷脆弱', keywords: ['寒冷', '脆弱'] },
  natureFragile: { label: '自然脆弱', keywords: ['自然', '脆弱'] },
  magicFragile: { label: '法术脆弱', keywords: ['法术', '脆弱'] },
  physicalVulnerability: { label: '物理脆弱', keywords: ['物理', '脆弱'] },
  fireVulnerability: { label: '灼热易伤', keywords: ['灼热', '易伤'] },
  electricVulnerability: { label: '电磁易伤', keywords: ['电磁', '易伤'] },
  iceVulnerability: { label: '寒冷易伤', keywords: ['寒冷', '易伤'] },
  natureVulnerability: { label: '自然易伤', keywords: ['自然', '易伤'] },
  magicVulnerability: { label: '法术脆弱', keywords: ['法术', '异伤', '易伤', '脆弱', '魔法'] },
  physicalAmplify: { label: '物理增幅', keywords: ['物理', '增幅'] },
  magicAmplify: { label: '法术增幅', keywords: ['法术', '增幅'] },
  fireAmplify: { label: '灼热增幅', keywords: ['灼热', '增幅'] },
  electricAmplify: { label: '电磁增幅', keywords: ['电磁', '增幅'] },
  iceAmplify: { label: '寒冷增幅', keywords: ['寒冷', '增幅'] },
  natureAmplify: { label: '自然增幅', keywords: ['自然', '增幅'] },
  allCorrosion: { label: '全属性降抗', keywords: ['腐蚀', '降抗', '全抗降低'] },
  physicalCorrosion: { label: '物理降抗', keywords: ['腐蚀', '物理降抗', '物抗降低'] },
  magicCorrosion: { label: '法术降抗', keywords: ['腐蚀', '法术降抗', '法抗降低'] },
  fireCorrosion: { label: '灼热降抗', keywords: ['腐蚀', '灼热降抗', '火抗降低'] },
  electricCorrosion: { label: '电磁降抗', keywords: ['腐蚀', '电磁降抗', '雷抗降低'] },
  iceCorrosion: { label: '寒冷降抗', keywords: ['腐蚀', '寒冷降抗', '冰抗降低'] },
  natureCorrosion: { label: '自然降抗', keywords: ['腐蚀', '自然降抗', '自然抗性降低'] },
  allResistanceIgnore: { label: '无视全部抗性', keywords: ['无视抗性', '全部抗性忽略', '全抗穿透'] },
  physicalResistanceIgnore: { label: '无视物理抗性', keywords: ['无视物理抗性', '物理穿透', '物理抗性忽略'] },
  magicResistanceIgnore: { label: '无视法术抗性', keywords: ['无视法术抗性', '法术穿透', '法术抗性忽略'] },
  fireResistanceIgnore: { label: '无视灼热抗性', keywords: ['无视灼热抗性', '灼热穿透', '火抗忽略'] },
  electricResistanceIgnore: { label: '无视电磁抗性', keywords: ['无视电磁抗性', '电磁穿透', '雷抗忽略'] },
  iceResistanceIgnore: { label: '无视寒冷抗性', keywords: ['无视寒冷抗性', '寒冷穿透', '冰抗忽略'] },
  natureResistanceIgnore: { label: '无视自然抗性', keywords: ['无视自然抗性', '自然穿透', '自然抗性忽略'] },
  comboDamageBonus: { label: '连击伤害加成', keywords: ['连击', 'combo'] },
  multiplierBonus: { label: '倍率加算', keywords: ['倍率', '加算', '乘区'] },
  sourceSkillBoost: { label: '源石技艺强度', keywords: ['源石技艺', '强度', '记忆强度'] },
};

const PERCENT_STYLE_TYPES = new Set<string>([
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'multiplierBonus',
]);

const DISPLAY_PERCENT_TYPES = new Set<string>([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allElementDmgBonus',
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
  'comboDamageBonus',
  'sourceSkillBoost',
]);

const BUFF_CATEGORY_OPTIONS: BuffCategory[] = ['condition', 'countable', 'passive'];
const BUFF_CATEGORY_LABELS: Record<BuffCategory, string> = {
  condition: '条件',
  countable: '计层',
  passive: '常驻',
};
const MULTIPLIER_SUPPORTED_BUFF_TYPES = getMultiplierSupportedBuffTypes();

const DISPLAY_FLAT_TYPES = new Set<string>([
  'flatAtk',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
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
]);

const BUFF_EFFECT_KIND_OPTIONS: BuffEffectKind[] = ['modifier', 'extraHit'];

const DEFAULT_EXTRA_HIT_CONFIG: BuffExtraHitConfig = {
  key: 'dianjian',
  damageType: 'physical',
  skillType: '',
  baseMultiplier: 2.5,
  imbalanceValue: 10,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal',
};

function normalizeExtraHitConfig(value?: Partial<BuffExtraHitConfig>): BuffExtraHitConfig {
  return {
    key: value?.key?.trim() || DEFAULT_EXTRA_HIT_CONFIG.key,
    damageType: value?.damageType || DEFAULT_EXTRA_HIT_CONFIG.damageType,
    skillType: value?.skillType ?? DEFAULT_EXTRA_HIT_CONFIG.skillType,
    baseMultiplier: Number(value?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier) || DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier,
    imbalanceValue: Number(value?.imbalanceValue ?? DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue) || DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue,
    cooldownSeconds: Number(value?.cooldownSeconds ?? DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds) || DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds,
    trigger: value?.trigger || DEFAULT_EXTRA_HIT_CONFIG.trigger,
  };
}

function getEffectKindLabel(kind: BuffEffectKind | undefined) {
  return kind === 'extraHit' ? '额外伤害段' : '普通加成';
}

interface BuffEffectDraft extends CandidateBuff {
  id: string;
}

function buffSheetEffectToDrawer(effect: BuffEffectDraft): OperatorBuffEffect {
  return {
    schemaVersion: 2,
    effectId: effect.id,
    name: effect.displayName || effect.name || effect.id,
    type: effect.type || '',
    category: normalizeBuffCategory(effect.category),
    value: effect.value,
    maxStacks: effect.maxStacks,
    condition: effect.condition || '',
    description: effect.description || '',
    raw: '',
    valueMode: effect.valueMode ?? 'fixed',
    derivedValue: effect.derivedValue,
    effectKind: effect.effectKind ?? 'modifier',
    extraHitConfig: effect.extraHitConfig,
    multiplier: effect.multiplier,
  };
}

function applyDrawerEffectToBuffSheet(effect: BuffEffectDraft, nextEffect: OperatorBuffEffect): BuffEffectDraft {
  return {
    ...effect,
    schemaVersion: 2,
    id: nextEffect.effectId,
    displayName: nextEffect.name,
    type: nextEffect.type,
    category: nextEffect.category,
    value: nextEffect.value,
    maxStacks: nextEffect.maxStacks,
    condition: nextEffect.condition || '',
    description: nextEffect.description || '',
    valueMode: nextEffect.valueMode,
    derivedValue: nextEffect.derivedValue,
    effectKind: nextEffect.effectKind,
    extraHitConfig: nextEffect.extraHitConfig,
    multiplier: nextEffect.multiplier,
  };
}

interface BuffItemDraft {
  id: string;
  name: string;
  sourceName: string;
  description: string;
  effects: Record<string, BuffEffectDraft>;
}

interface BuffDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: Record<string, BuffItemDraft>;
}

type BuffItemInput = Omit<Partial<BuffItemDraft>, 'effects'> & {
  effects?: Record<string, Partial<BuffEffectDraft>>;
};

function getNumericIndex(key: string, prefix: 'item' | 'buff') {
  const match = key.match(new RegExp(`${prefix}-(\\d+)`));
  return Number(match?.[1] || 1);
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function pad3(value: number) {
  return String(value).padStart(3, '0');
}

function createDefaultBuffDisplayName(buffKey: string) {
  return `Buff 效果 ${pad2(getNumericIndex(buffKey, 'buff'))}`;
}

function createDefaultBuffName(buffKey: string) {
  return `custom_buff_${pad3(getNumericIndex(buffKey, 'buff'))}`;
}

function createDefaultBuffEffect(buffKey = 'buff-1', sourceName = '本地自定义'): BuffEffectDraft {
  return {
    id: buffKey,
    displayName: createDefaultBuffDisplayName(buffKey),
    name: createDefaultBuffName(buffKey),
    level: '',
    value: 0,
    type: '',
    source: 'local_custom',
    sourceName,
    description: '',
    condition: '',
    effectKind: 'modifier',
  };
}

function createDefaultItemName(itemKey: string) {
  return `自定义项 ${pad2(getNumericIndex(itemKey, 'item'))}`;
}

function createDefaultBuffItem(itemKey = 'item-1', sourceName = '本地自定义'): BuffItemDraft {
  return {
    id: itemKey,
    name: createDefaultItemName(itemKey),
    sourceName,
    description: '',
    effects: {
      'buff-1': createDefaultBuffEffect('buff-1', sourceName),
    },
  };
}

function createDefaultBuffDraft(): BuffDraft {
  return {
    id: 'custom-buff-001',
    name: '本地 Buff 草稿',
    sourceName: '本地自定义',
    source: 'local_custom',
    description: '用于维护自定义本地 Buff 组。',
    items: {
      'item-1': createDefaultBuffItem('item-1', '本地自定义'),
    },
  };
}

function createEmptyBuffDraft(nextId = 'custom-buff-001'): BuffDraft {
  return {
    id: nextId,
    name: '新建 Buff 组',
    sourceName: '本地自定义',
    source: 'local_custom',
    description: '',
    items: {},
  };
}

function getNextDraftId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-buff-${pad3(index)}`)) {
    index += 1;
  }
  return `custom-buff-${pad3(index)}`;
}

function buildBuffDraftIdFromName(name: string) {
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

function getBuffTypeDisplayLabel(type?: string) {
  if (!type) {
    return '暂无';
  }
  const meta = BUFF_TYPE_LABELS[type as keyof typeof BUFF_TYPE_LABELS];
  return meta ? `${meta.label} · ${type}` : type;
}

function getBuffTypePlainLabel(type?: string) {
  if (!type) {
    return '';
  }
  const meta = BUFF_TYPE_LABELS[type as keyof typeof BUFF_TYPE_LABELS];
  return meta?.label || type;
}

function normalizeLegacyBuffType(type: unknown) {
  if (type === 'magicTakenDmgBonus') return 'magicVulnerability';
  return typeof type === 'string' ? type : '';
}

function normalizeBuffCategory(category: unknown): BuffCategory {
  if (category === 'countable' || category === 'passive' || category === 'condition') {
    return category;
  }
  if (category === 'positive') {
    return 'passive';
  }
  return 'condition';
}

function normalizeBuffSheetEffectDefinition(effect: Partial<BuffEffectDraft>) {
  return normalizeStoredBuffDefinition({
    ...effect,
    type: normalizeLegacyBuffType(effect.type),
  }) as Partial<BuffEffectDraft>;
}

function getBuffEffectMultiplier(effect: Partial<BuffEffectDraft>) {
  return normalizeBuffMultiplier(effect.multiplier);
}

function canUseBuffMultiplier(type: string | undefined) {
  return isMultiplierSupportedBuffType(type);
}

function formatEffectValueForDisplay(effect: Partial<BuffEffectDraft>) {
  const numericValue = Number(effect.value);
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return '';
  }

  const type = effect.type || '';
  if (DISPLAY_PERCENT_TYPES.has(type)) {
    return `${numericValue}%`;
  }

  if (type === 'multiplierBonus') {
    return numericValue >= 0 && numericValue <= 2 ? `${numericValue}x` : String(numericValue);
  }

  if (DISPLAY_FLAT_TYPES.has(type)) {
    return `${numericValue}`;
  }

  return `${numericValue}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeExplicitEffectDisplayName(displayName: string, typeLabel: string) {
  if (!typeLabel) {
    return displayName;
  }

  const escapedTypeLabel = escapeRegExp(typeLabel);
  const repeatedTokenPattern = String.raw`(\d+(?:\.\d+)?(?:%|x)?)(?:\1)+`;
  const naturalSentencePattern = new RegExp(`(^|[，,：:、\\s])((?:\\d+(?:\\.\\d+)?(?:%|x)?)+)(${escapedTypeLabel})(?=\\s*[+\\-]\\d)`);
  const repeatedBeforeTypePattern = new RegExp(`(^|[，,：:、\\s])(${repeatedTokenPattern})(${escapedTypeLabel})`);

  const normalizedNaturalSentence = displayName.replace(naturalSentencePattern, '$1$3');
  return normalizedNaturalSentence.replace(repeatedBeforeTypePattern, '$1$3');
}

function buildFallbackEffectDisplayName(effectKey: string, effect: Partial<BuffEffectDraft>, fallbackName: string) {
  const explicitDisplayName = effect.displayName?.trim();
  const typeLabel = getBuffTypePlainLabel(effect.type);
  const valueLabel = formatEffectValueForDisplay(effect);

  if (explicitDisplayName) {
    const defaultDisplayName = createDefaultBuffDisplayName(effectKey);
    const isSystemGeneratedName = explicitDisplayName === fallbackName || explicitDisplayName === defaultDisplayName;
    const isBareTypeLabel = !!typeLabel && explicitDisplayName === typeLabel;

    // 这里必须保证幂等：
    // - 用户/导入方已经写好的自然语言 displayName 不允许在刷新时被再次加工
    // - 只有系统默认名，或纯类型名，才允许按“数值 + 类型”自动生成
    if ((isSystemGeneratedName || isBareTypeLabel) && typeLabel) {
      return valueLabel ? `${valueLabel}${typeLabel}` : typeLabel;
    }
    return sanitizeExplicitEffectDisplayName(explicitDisplayName, typeLabel);
  }

  if (typeLabel) {
    return valueLabel ? `${valueLabel}${typeLabel}` : typeLabel;
  }

  const explicitName = effect.name?.trim();
  if (explicitName && !/^custom_buff_\d+$/i.test(explicitName)) {
    return explicitName;
  }

  const description = effect.description?.trim();
  if (description) {
    return description.length > 18 ? `${description.slice(0, 18)}...` : description;
  }

  return fallbackName || createDefaultBuffDisplayName(effectKey);
}

function formatBuffNumericValue(type: string | undefined, value: number | undefined) {
  const numericValue = Number(value ?? 0);
  if (PERCENT_STYLE_TYPES.has(type || '')) {
    return `${(numericValue).toFixed(1).replace(/\.0$/, '')}%`;
  }
  return String(numericValue);
}

function formatBuffEffectValueText(effect: Partial<BuffEffectDraft>) {
  if (effect.effectKind === 'extraHit') {
    return `${effect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}x`;
  }
  const multiplier = getBuffEffectMultiplier(effect);
  if (multiplier) {
    return `×${multiplier.coefficient}`;
  }
  return formatBuffNumericValue(effect.type, effect.value);
}

function applyBuffEffectKind(effect: BuffEffectDraft, nextKind: BuffEffectKind): BuffEffectDraft {
  if (nextKind === 'extraHit') {
    const category = normalizeBuffCategory(effect.category) === 'countable' ? 'countable' : 'passive';
    return {
      ...effect,
      effectKind: 'extraHit',
      type: '',
      value: 0,
      category,
      maxStacks: category === 'countable' ? effect.maxStacks ?? 1 : undefined,
      multiplier: undefined,
      extraHitConfig: normalizeExtraHitConfig(effect.extraHitConfig),
    };
  }
  return {
    ...effect,
    effectKind: 'modifier',
    extraHitConfig: undefined,
  };
}

function applyBuffType(effect: BuffEffectDraft, nextType: string): BuffEffectDraft {
  const normalizedType = normalizeLegacyBuffType(nextType);
  return {
    ...effect,
    type: normalizedType,
    ...(canUseBuffMultiplier(normalizedType) ? {} : { multiplier: undefined }),
  };
}

function applyBuffCategory(effect: BuffEffectDraft, nextCategory: BuffCategory): BuffEffectDraft {
  const category = getBuffEffectMultiplier(effect)
    ? 'condition'
    : effect.effectKind === 'extraHit' && nextCategory === 'condition'
      ? 'passive'
      : nextCategory;
  return {
    ...effect,
    category,
    ...(category === 'countable'
      ? { maxStacks: effect.maxStacks ?? 1, multiplier: undefined }
      : { maxStacks: undefined }),
  };
}

function setBuffMultiplierEnabled(effect: BuffEffectDraft, enabled: boolean): BuffEffectDraft {
  if (!enabled) {
    const { multiplier: _multiplier, ...rest } = effect;
    return rest;
  }
  const nextType = canUseBuffMultiplier(effect.type)
    ? effect.type || 'multiplierBonus'
    : 'multiplierBonus';
  return {
    ...effect,
    effectKind: 'modifier',
    type: nextType,
    category: 'condition',
    value: undefined,
    multiplier: { coefficient: 1 },
    extraHitConfig: undefined,
  };
}

function setBuffMultiplierCoefficient(effect: BuffEffectDraft, coefficient: number): BuffEffectDraft {
  return {
    ...effect,
    multiplier: { coefficient: Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1 },
  };
}

function setBuffMaxStacks(effect: BuffEffectDraft, maxStacks: number): BuffEffectDraft {
  return {
    ...effect,
    maxStacks: Math.max(1, Math.floor(Number.isFinite(maxStacks) ? maxStacks : 1)),
  };
}

function isBuffSheetPath(pathname: string) {
  return pathname === BUFF_SHEET_PAGE_PATH;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getNextItemKey(draft: BuffDraft) {
  let index = 1;
  while (draft.items[`item-${index}`]) {
    index += 1;
  }
  return `item-${index}`;
}

function getNextEffectKey(item: BuffItemDraft) {
  let index = 1;
  while (item.effects[`buff-${index}`]) {
    index += 1;
  }
  return `buff-${index}`;
}

function normalizeEffect(effectKey: string, effect: Partial<BuffEffectDraft>, item: BuffItemDraft): BuffEffectDraft {
  const fallback = createDefaultBuffEffect(effectKey, item.sourceName);
  const normalizedEffect = normalizeBuffSheetEffectDefinition(effect);
  const effectKind = normalizedEffect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const normalizedCategory = normalizeBuffCategory(normalizedEffect.category);
  const rawCategory = effectKind === 'extraHit' && normalizedCategory !== 'countable'
    ? 'passive'
    : normalizedCategory;
  const type = effectKind === 'extraHit' ? '' : normalizeLegacyBuffType(normalizedEffect.type ?? fallback.type);
  const multiplier = effectKind === 'modifier' && rawCategory !== 'countable' && canUseBuffMultiplier(type)
    ? getBuffEffectMultiplier(normalizedEffect)
    : undefined;
  const category = multiplier ? 'condition' : rawCategory;
  const rawMaxStacks = Number(normalizedEffect.maxStacks);
  return {
    ...fallback,
    ...normalizedEffect,
    schemaVersion: 2,
    id: normalizedEffect.id?.trim() || effectKey,
    displayName: buildFallbackEffectDisplayName(effectKey, normalizedEffect, fallback.displayName),
    name: normalizedEffect.name?.trim() || fallback.name,
    level: normalizedEffect.level || '',
    source: normalizedEffect.source?.trim() || 'local_custom',
    sourceName: normalizedEffect.sourceName?.trim() || item.sourceName,
    description: normalizedEffect.description || '',
    condition: normalizedEffect.condition || '',
    value: Number(normalizedEffect.value ?? fallback.value) || 0,
    type,
    category,
    maxStacks: category === 'countable' && Number.isFinite(rawMaxStacks) ? Math.max(1, Math.floor(rawMaxStacks)) : undefined,
    multiplier,
    effectKind,
    extraHitConfig: effectKind === 'extraHit'
      ? normalizeExtraHitConfig(normalizedEffect.extraHitConfig)
      : undefined,
  };
}

function normalizeItem(
  itemKey: string,
  item: BuffItemInput,
  topSourceName: string
): BuffItemDraft {
  const fallback = createDefaultBuffItem(itemKey, topSourceName);
  const normalizedItem: BuffItemDraft = {
    ...fallback,
    ...item,
    id: item.id?.trim() || itemKey,
    name: item.name?.trim() || fallback.name,
    sourceName: item.sourceName?.trim() || topSourceName,
    description: item.description || '',
    effects: {},
  };

  const hasExplicitEffects = !!item.effects && typeof item.effects === 'object';
  const rawEffects = hasExplicitEffects ? item.effects! : fallback.effects;
  Object.entries(rawEffects).forEach(([effectKey, effectValue]) => {
    normalizedItem.effects[effectKey] = normalizeEffect(effectKey, effectValue, normalizedItem);
  });

  if (!hasExplicitEffects && !Object.keys(normalizedItem.effects).length) {
    normalizedItem.effects['buff-1'] = createDefaultBuffEffect('buff-1', normalizedItem.sourceName);
  }

  return normalizedItem;
}

function normalizeBuffDraft(value: Partial<BuffDraft> & { buffs?: Record<string, Partial<BuffEffectDraft>> }) {
  const normalizedDraft: BuffDraft = {
    id: value.id?.trim() || 'custom-buff-001',
    name: value.name?.trim() || '本地 Buff 草稿',
    sourceName: value.sourceName?.trim() || '本地自定义',
    source: value.source?.trim() || 'local_custom',
    description: value.description || '',
    items: {},
  };

  const hasExplicitItems = !!value.items && typeof value.items === 'object';
  const hasLegacyBuffs = !!value.buffs && typeof value.buffs === 'object';

  const rawItems: Record<string, BuffItemInput> =
    hasExplicitItems
      ? (value.items ?? {})
      : hasLegacyBuffs
        ? {
            'item-1': {
              id: 'item-1',
              name: createDefaultItemName('item-1'),
              sourceName: normalizedDraft.sourceName,
              description: normalizedDraft.description,
              effects: value.buffs ?? {},
            },
          }
        : {
            'item-1': createDefaultBuffItem('item-1', normalizedDraft.sourceName),
          };

  Object.entries(rawItems).forEach(([itemKey, itemValue]) => {
    normalizedDraft.items[itemKey] = normalizeItem(itemKey, itemValue, normalizedDraft.sourceName);
  });

  if (!hasExplicitItems && !hasLegacyBuffs && !Object.keys(normalizedDraft.items).length) {
    normalizedDraft.items['item-1'] = createDefaultBuffItem('item-1', normalizedDraft.sourceName);
  }

  return normalizedDraft;
}

function normalizeBuffDraftLibrary(library: Record<string, BuffDraft>): Record<string, BuffDraft> {
  return Object.fromEntries(
    Object.entries(library).map(([draftId, draftValue]) => [draftId, normalizeBuffDraft(draftValue)])
  );
}

function reorderDraftStructure(draft: BuffDraft) {
  const reorderedItems: Record<string, BuffItemDraft> = {};

  Object.values(draft.items).forEach((item, itemIndex) => {
    const nextItemKey = `item-${itemIndex + 1}`;
    const nextItemName = item.name?.trim() ? item.name : createDefaultItemName(nextItemKey);
    const reorderedEffects: Record<string, BuffEffectDraft> = {};

    Object.values(item.effects).forEach((effect, effectIndex) => {
      const nextEffectKey = `buff-${effectIndex + 1}`;
      reorderedEffects[nextEffectKey] = {
        ...effect,
        id: nextEffectKey,
        displayName: effect.displayName?.trim() ? effect.displayName : createDefaultBuffDisplayName(nextEffectKey),
        name: effect.name?.trim() ? effect.name : createDefaultBuffName(nextEffectKey),
        sourceName: effect.sourceName?.trim() || item.sourceName || draft.sourceName,
      };
    });

    reorderedItems[nextItemKey] = {
      ...item,
      id: nextItemKey,
      name: nextItemName,
      sourceName: item.sourceName?.trim() || draft.sourceName,
      effects: reorderedEffects,
    };
  });

  return {
    ...draft,
    items: reorderedItems,
  };
}

function parseImportedBuffDraft(rawText: string) {
  const parsed = JSON.parse(rawText) as Partial<BuffDraft> & { buffs?: Record<string, Partial<BuffEffectDraft>> };
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name) {
    throw new Error('JSON 缺少 id / name');
  }
  return normalizeBuffDraft(parsed);
}

function loadDraftFromStorage() {
  if (typeof window === 'undefined') {
    return createDefaultBuffDraft();
  }
  const raw = window.localStorage.getItem(BUFF_DRAFT_STORAGE_KEY);
  if (!raw) {
    return createDefaultBuffDraft();
  }
  try {
    return parseImportedBuffDraft(raw);
  } catch {
    return createDefaultBuffDraft();
  }
}

function loadLocalBuffLibrary() {
  if (typeof window === 'undefined') {
    return {} as Record<string, BuffDraft>;
  }

  const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
  if (!raw) {
    return {} as Record<string, BuffDraft>;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<BuffDraft> & { buffs?: Record<string, Partial<BuffEffectDraft>> }>;
    return Object.fromEntries(
      Object.entries(parsed).map(([draftId, draftValue]) => [draftId, normalizeBuffDraft(draftValue)])
    );
  } catch {
    return {} as Record<string, BuffDraft>;
  }
}

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

type BuffSheetRow =
  | {
      kind: 'group';
      key: string;
      title: string;
      summary: string;
      searchText: string;
    }
  | {
      kind: 'item';
      key: string;
      itemKey: string;
      title: string;
      idText: string;
      summary: string;
      description: string;
      effectCount: number;
      searchText: string;
    }
  | {
      kind: 'effect';
      key: string;
      itemKey: string;
      effectKey: string;
      title: string;
      idText: string;
      effectKind: string;
      typeLabel: string;
      valueText: string;
      categoryText: string;
      sourceName: string;
      condition: string;
      description: string;
      searchText: string;
    };

type BuffExplorerDragNode =
  | {
      kind: 'draft';
      draftId: string;
    }
  | {
      kind: 'item';
      draftId: string;
      itemKey: string;
    }
  | {
      kind: 'effect';
      draftId: string;
      itemKey: string;
      effectKey: string;
    };

type BuffExplorerDragState = {
  source: BuffExplorerDragNode;
  over: BuffExplorerDragNode | null;
  x: number;
  y: number;
};

type BuffSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'item' | 'effect';
  draftId?: string;
  itemKey?: string;
  effectKey?: string;
};

type BuffSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open' | 'copy';
  onClick: () => void;
};

function renderBuffSheetMenuIcon(icon: BuffSheetContextMenuAction['icon']) {
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
      return (
        <>
          <path d="M3.25 5.25h9.5" />
          <path d="M5.75 8h6.5" />
          <path d="M8.25 10.75h4" />
        </>
      );
    case 'expand':
      return (
        <>
          <path d="M3.25 5.25h9.5" />
          <path d="M3.25 8h9.5" />
          <path d="M3.25 10.75h9.5" />
        </>
      );
    case 'open':
      return (
        <>
          <path d="M3.25 4.25h3l1.25 1.5h5.25v6.5H3.25z" />
          <path d="M7.5 5.75h5.25" />
        </>
      );
    case 'copy':
      return (
        <>
          <path d="M5.25 4.25h5.5v7.5h-5.5z" />
          <path d="M8.75 4.25V3.25h-4.5v6.5h1" />
        </>
      );
    default:
      return null;
  }
}

function formatBuffUndoLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`;
}

function readBuffUndoSnapshots(): BuffUndoSnapshot[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(BUFF_UNDO_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as BuffUndoSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffUndoSnapshots(snapshots: BuffUndoSnapshot[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(BUFF_UNDO_STORAGE_KEY, JSON.stringify(snapshots));
}

function captureBuffUndoSnapshot(
  label: string,
  options?: {
    selectedDraftId?: string;
    draftState?: BuffDraft;
    selectedItemKey?: string | null;
    selectedEffectKey?: string | null;
  },
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const localEntries: Array<[string, string | null]> = [
    [BUFF_DRAFT_STORAGE_KEY, window.localStorage.getItem(BUFF_DRAFT_STORAGE_KEY)],
    [BUFF_LIBRARY_STORAGE_KEY, window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY)],
  ];

  const snapshot: BuffUndoSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    label,
    selectedDraftId: options?.selectedDraftId,
    draftState: options?.draftState ? cloneValue(options.draftState) : undefined,
    selectedItemKey: options?.selectedItemKey,
    selectedEffectKey: options?.selectedEffectKey,
    localEntries,
  };

  writeBuffUndoSnapshots([snapshot, ...readBuffUndoSnapshots()].slice(0, BUFF_UNDO_LIMIT));
}

function restoreBuffUndoSnapshot(snapshotId: string): BuffUndoSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const snapshots = readBuffUndoSnapshots();
  const target = snapshots.find((item) => item.id === snapshotId);
  if (!target) {
    return null;
  }

  target.localEntries.forEach(([key, value]) => {
    if (value == null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  });

  writeBuffUndoSnapshots(snapshots.filter((item) => item.id !== snapshotId));
  return target;
}

function buildBuffSheetRows(draft: BuffDraft): BuffSheetRow[] {
  const rows: BuffSheetRow[] = [
    {
      kind: 'group',
      key: `group-${draft.id}`,
      title: draft.name,
      summary: `${Object.keys(draft.items).length} 个自定义项`,
      searchText: `${draft.name} ${draft.id} ${draft.description} ${draft.sourceName}`.toLowerCase(),
    },
  ];

  Object.entries(draft.items).forEach(([itemKey, item]) => {
    rows.push({
      kind: 'item',
      key: `item-${itemKey}`,
      itemKey,
      title: item.name,
      idText: item.id,
      summary: `${Object.keys(item.effects).length} 个效果`,
      description: item.description || '-',
      effectCount: Object.keys(item.effects).length,
      searchText: `${item.name} ${item.id} ${item.description} ${item.sourceName}`.toLowerCase(),
    });

    Object.entries(item.effects).forEach(([effectKey, effect]) => {
      rows.push({
        kind: 'effect',
        key: `effect-${itemKey}-${effectKey}`,
        itemKey,
        effectKey,
        title: effect.displayName || effectKey,
        idText: effect.id,
        effectKind: getEffectKindLabel(effect.effectKind),
        typeLabel: effect.effectKind === 'extraHit'
          ? '额外伤害段'
          : `${getBuffEffectMultiplier(effect) ? '乘算 · ' : ''}${effect.type ? getBuffTypeDisplayLabel(effect.type) : '暂无'}`,
        valueText: formatBuffEffectValueText(effect),
        categoryText: `${BUFF_CATEGORY_LABELS[normalizeBuffCategory(effect.category)]}${normalizeBuffCategory(effect.category) === 'countable' ? `/${effect.maxStacks ?? 1}` : ''}`,
        sourceName: effect.sourceName || item.sourceName || draft.sourceName,
        condition: effect.condition || '-',
        description: effect.description || '-',
        searchText: [
          effect.displayName,
          effect.id,
          effect.type,
          effect.condition,
          effect.description,
          effect.sourceName,
          effect.effectKind,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      });
    });
  });

  return rows;
}

function reorderRecordEntries<T>(record: Record<string, T>, sourceKey: string, targetKey: string): Record<string, T> {
  if (sourceKey === targetKey || !record[sourceKey] || !record[targetKey]) {
    return record;
  }
  const entries = Object.entries(record);
  const sourceIndex = entries.findIndex(([key]) => key === sourceKey);
  const targetIndex = entries.findIndex(([key]) => key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0) {
    return record;
  }
  const [movedEntry] = entries.splice(sourceIndex, 1);
  entries.splice(targetIndex, 0, movedEntry);
  return Object.fromEntries(entries);
}

function formatBuffExplorerDragKindLabel(kind: BuffExplorerDragNode['kind']): string {
  if (kind === 'draft') {
    return '组';
  }
  if (kind === 'item') {
    return '项';
  }
  return '效果';
}

function buildCollapsedDraftState(library: Record<string, BuffDraft>): Record<string, boolean> {
  return Object.fromEntries(Object.keys(library).map((draftId) => [draftId, true]));
}

function buildCollapsedItemState(
  library: Record<string, BuffDraft>,
  getItemCollapseKey: (draftId: string, itemKey: string) => string,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(library).flatMap(([draftId, draft]) => (
      Object.keys(draft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), true] as const)
    )),
  );
}

interface BuffSheetColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
}

interface BuffWorkbookMergeInfo {
  master: boolean;
  colSpan: number;
  rowSpan: number;
  hidden: boolean;
}

interface BuffWorkbookCellView {
  key: string;
  address: string;
  value: string;
  width: number;
  colSpan: number;
  rowSpan: number;
  align: 'left' | 'right' | 'center';
  kind: 'group' | 'header' | 'character' | 'button' | 'data';
  sourceRowKey?: string;
  columnKey?: string;
}

interface BuffWorkbookRowView {
  key: string;
  rowNumber: number;
  kind: BuffWorkbookCellView['kind'];
  cells: BuffWorkbookCellView[];
  sourceRow?: BuffSheetRow;
}

type BuffWorkbookSelection = {
  address: string;
  value: string;
  sourceRowKey?: string;
  columnKey?: string;
};

type FormulaFocusSnapshot = {
  focusId: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

function renderBuffWorkbookCellContent(cell: BuffWorkbookCellView, sourceRow?: BuffSheetRow): ReactNode {
  if (!sourceRow) {
    return cell.value;
  }
  if (cell.columnKey !== 'name') {
    return cell.value;
  }
  if (sourceRow.kind === 'group') {
    return (
      <span className="buff-sheet-grid-title-wrap">
        <span className="buff-sheet-grid-title-main">
          {sourceRow.title}
          <span className="buff-sheet-grid-title-summary">{sourceRow.summary}</span>
        </span>
        <span className="buff-sheet-grid-title-sub">{sourceRow.key.replace(/^group-/, '')}</span>
      </span>
    );
  }
  if (sourceRow.kind === 'item') {
    return (
      <span className="buff-sheet-grid-title-wrap">
        <span className="buff-sheet-grid-title-main">{sourceRow.title}</span>
        <span className="buff-sheet-grid-title-sub">{sourceRow.idText}</span>
      </span>
    );
  }
  return cell.value;
}

function buildBuffSheetColumns(): BuffSheetColumn[] {
  return [
    { key: 'name', title: '名称', width: 200, group: '索引' },
    { key: 'idText', title: 'ID', width: 110, group: '索引' },
    { key: 'level', title: '层级', width: 60, group: '索引', align: 'center' },
    { key: 'effectKind', title: '效果种类', width: 90, group: '效果区', align: 'center' },
    { key: 'typeLabel', title: '类型', width: 170, group: '效果区' },
    { key: 'valueText', title: '数值', width: 84, group: '效果区', align: 'right' },
    { key: 'categoryText', title: '分类', width: 92, group: '效果区', align: 'center' },
    { key: 'sourceName', title: '来源', width: 110, group: '文本区' },
    { key: 'condition', title: '条件', width: 180, group: '文本区' },
    { key: 'description', title: '描述', width: 240, group: '文本区' },
  ];
}

function buildBuffColumnGroups(columns: BuffSheetColumn[]): Array<{ group: string; width: number; count: number }> {
  const groups: Array<{ group: string; width: number; count: number }> = [];
  columns.forEach((column) => {
    const existing = groups[groups.length - 1];
    if (existing && existing.group === column.group) {
      existing.width += column.width;
      existing.count += 1;
      return;
    }
    groups.push({ group: column.group, width: column.width, count: 1 });
  });
  return groups;
}

function registerBuffMerge(
  mergeMap: Record<string, BuffWorkbookMergeInfo>,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number
): void {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      mergeMap[`${row}:${col}`] = {
        master: row === rowStart && col === colStart,
        colSpan: colEnd - colStart + 1,
        rowSpan: rowEnd - rowStart + 1,
        hidden: !(row === rowStart && col === colStart),
      };
    }
  }
}

function getBuffWorkbookCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((item) => item.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text;
  }
  return String(value);
}

function mapBuffWorkbookAlignment(value: ExcelJS.Alignment['horizontal'] | undefined): BuffWorkbookCellView['align'] {
  if (value === 'right') {
    return 'right';
  }
  if (value === 'center') {
    return 'center';
  }
  return 'left';
}

function buildBuffWorkbookView(rows: BuffSheetRow[], columns: BuffSheetColumn[]): BuffWorkbookRowView[] {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet-Buff');
  const mergeMap: Record<string, BuffWorkbookMergeInfo> = {};
  const rowKinds: Record<number, BuffWorkbookCellView['kind']> = {};
  const sheetRowsByWorksheetRow: Record<number, BuffSheetRow> = {};
  const columnGroups = buildBuffColumnGroups(columns);

  let currentColumn = 1;
  columnGroups.forEach((group) => {
    const startColumn = currentColumn;
    const endColumn = startColumn + group.count - 1;
    if (group.count > 1) {
      worksheet.mergeCells(1, startColumn, 1, endColumn);
      registerBuffMerge(mergeMap, 1, startColumn, 1, endColumn);
    }
    const cell = worksheet.getCell(1, startColumn);
    cell.value = group.group;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true, color: { argb: 'FF185C37' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F7F4' },
    };
    currentColumn = endColumn + 1;
  });
  rowKinds[1] = 'group';
  worksheet.getRow(1).height = 22;

  columns.forEach((column, index) => {
    const cell = worksheet.getCell(2, index + 1);
    cell.value = column.title;
    cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
    cell.alignment = {
      horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
      vertical: 'middle',
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFDFDFD' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      left: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      right: { style: 'thin', color: { argb: 'FFD7D7D7' } },
    };
    worksheet.getColumn(index + 1).width = Math.max(3, column.width / 10);
  });
  rowKinds[2] = 'header';
  worksheet.getRow(2).height = 24;

  let excelRowIndex = 3;
  rows.forEach((row) => {
    if (row.kind === 'group') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = `${row.title} · ${row.summary}`;
      cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF4F1' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      };
      worksheet.getRow(excelRowIndex).height = 22;
      rowKinds[excelRowIndex] = 'character';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    if (row.kind === 'item') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = `${row.title} · ${row.summary} · ${row.description}`;
      cell.font = { bold: true, color: { argb: 'FF2B2F33' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF7F9F8' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE1E4E8' } },
      };
      worksheet.getRow(excelRowIndex).height = 20;
      rowKinds[excelRowIndex] = 'button';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    const values: Record<string, string> = {
      name: row.title,
      idText: row.idText,
      level: '效果',
      effectKind: row.effectKind,
      typeLabel: row.typeLabel,
      valueText: row.valueText,
      categoryText: row.categoryText,
      sourceName: row.sourceName,
      condition: row.condition,
      description: row.description,
    };

    columns.forEach((column, index) => {
      const cell = worksheet.getCell(excelRowIndex, index + 1);
      cell.value = values[column.key] ?? '';
      cell.alignment = {
        horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
        vertical: 'middle',
      };
      cell.font = { size: 10, color: { argb: 'FF202124' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE8EAED' } },
        bottom: { style: 'thin', color: { argb: 'FFE8EAED' } },
        left: { style: 'thin', color: { argb: 'FFE8EAED' } },
        right: { style: 'thin', color: { argb: 'FFE8EAED' } },
      };
    });
    worksheet.getRow(excelRowIndex).height = 20;
    rowKinds[excelRowIndex] = 'data';
    sheetRowsByWorksheetRow[excelRowIndex] = row;
    excelRowIndex += 1;
  });

  const result: BuffWorkbookRowView[] = [];
  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const rowKind = rowKinds[rowIndex] ?? 'data';
    const cells: BuffWorkbookCellView[] = [];

    for (let colIndex = 1; colIndex <= columns.length; colIndex += 1) {
      const mergeInfo = mergeMap[`${rowIndex}:${colIndex}`];
      if (mergeInfo?.hidden) {
        continue;
      }
      const cell = worksheet.getCell(rowIndex, colIndex);
      const width = mergeInfo?.master
        ? columns.slice(colIndex - 1, colIndex - 1 + (mergeInfo.colSpan || 1)).reduce((sum, column) => sum + column.width, 0)
        : columns[colIndex - 1]?.width ?? 60;
      cells.push({
        key: `${rowIndex}:${colIndex}`,
        address: cell.address,
        value: getBuffWorkbookCellText(cell),
        width,
        colSpan: mergeInfo?.colSpan ?? 1,
        rowSpan: mergeInfo?.rowSpan ?? 1,
        align: mapBuffWorkbookAlignment(cell.alignment?.horizontal),
        kind: rowKind,
        sourceRowKey: sheetRowsByWorksheetRow[rowIndex]?.key,
        columnKey: columns[colIndex - 1]?.key,
      });
    }

    result.push({
      key: `row-${rowIndex}`,
      rowNumber: rowIndex,
      kind: rowKind,
      cells,
      sourceRow: sheetRowsByWorksheetRow[rowIndex],
    });
  }

  return result;
}

export { isBuffSheetPath };

export function BuffDraftSheetPage() {
  const [draft, setDraft] = useState<BuffDraft>(() => loadDraftFromStorage());
  const [localLibrary, setLocalLibrary] = useState<Record<string, BuffDraft>>({});
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [undoSnapshots, setUndoSnapshots] = useState<BuffUndoSnapshot[]>([]);
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [collapsedDraftIds, setCollapsedDraftIds] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<BuffWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [effectValueInput, setEffectValueInput] = useState('');
  const [formulaTextInput, setFormulaTextInput] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<BuffDraft> | null>(null);
  const [contextMenu, setContextMenu] = useState<BuffSheetContextMenuState | null>(null);
  const [dragState, setDragState] = useState<BuffExplorerDragState | null>(null);
  const [buffDrawerTarget, setBuffDrawerTarget] = useState<{ itemKey: string; effectKey: string } | null>(null);
  const columns = useMemo(() => buildBuffSheetColumns(), []);
  const getItemCollapseKey = useCallback((draftId: string, itemKey: string) => `${draftId}:${itemKey}`, []);
  const dragHoldTimerRef = useRef<number | null>(null);
  const pendingDragSourceRef = useRef<{ source: BuffExplorerDragNode; x: number; y: number } | null>(null);
  const suppressExplorerClickRef = useRef(false);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLDivElement>(null);
  const pendingFormulaFocusRef = useRef<FormulaFocusSnapshot | null>(null);
  const [formulaFocusRestoreToken, setFormulaFocusRestoreToken] = useState(0);

  const applyExplorerDefaultCollapse = useCallback((nextLibrary: Record<string, BuffDraft>) => {
    setCollapsedDraftIds(buildCollapsedDraftState(nextLibrary));
    setCollapsedItems(buildCollapsedItemState(nextLibrary, getItemCollapseKey));
  }, [getItemCollapseKey]);

  const syncUndoSnapshots = useCallback(() => {
    setUndoSnapshots(readBuffUndoSnapshots());
  }, []);

  const withUndo = useCallback((label: string, fn: () => void) => {
    captureBuffUndoSnapshot(label, {
      selectedDraftId: selectedLocalDraftId || draft.id || undefined,
    });
    fn();
    syncUndoSnapshots();
  }, [draft.id, selectedLocalDraftId, syncUndoSnapshots]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = restoreBuffUndoSnapshot(snapshotId);
    if (!restored) {
      return;
    }

    const nextLibrary = loadLocalBuffLibrary();
    const nextDraftFromStorage = loadDraftFromStorage();
    const nextSelectedId = restored.selectedDraftId && nextLibrary[restored.selectedDraftId]
      ? restored.selectedDraftId
      : (Object.keys(nextLibrary)[0] ?? nextDraftFromStorage.id);
    const nextDraft = nextSelectedId && nextLibrary[nextSelectedId]
      ? normalizeBuffDraft(cloneValue(nextLibrary[nextSelectedId]))
      : nextDraftFromStorage;

    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId(nextSelectedId);
    setDraft(nextDraft);
    setFilterKeyword('');
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
    setIsUndoMenuOpen(false);
    syncUndoSnapshots();
  }, [applyExplorerDefaultCollapse, syncUndoSnapshots]);

  const refreshLocalLibrary = useCallback(() => {
    const nextLibrary = {
      ...loadLocalBuffLibrary(),
      [draft.id]: normalizeBuffDraft(draft),
    };
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId((prev) => prev || draft.id || Object.keys(nextLibrary)[0] || '');
  }, [applyExplorerDefaultCollapse, draft]);

  useEffect(() => {
    syncUndoSnapshots();
  }, [syncUndoSnapshots]);

  const handleCollapseAllDrafts = useCallback(() => {
    applyExplorerDefaultCollapse(localLibrary);
  }, [applyExplorerDefaultCollapse, localLibrary]);

  const handleExpandAllDrafts = useCallback(() => {
    setCollapsedDraftIds(Object.fromEntries(Object.keys(localLibrary).map((draftId) => [draftId, false])));
  }, [localLibrary]);

  const handleCollapseAllItemsInDraft = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    setCollapsedItems((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.keys(targetDraft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), true])),
    }));
  }, [getItemCollapseKey, localLibrary]);

  const handleExpandAllItemsInDraft = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    setCollapsedItems((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.keys(targetDraft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), false])),
    }));
  }, [getItemCollapseKey, localLibrary]);

  const downloadSheetShareFile = useCallback((shareFile: DraftLibraryShareFile<BuffDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const currentSheetShareFile = useMemo(() => buildDraftLibraryShareFile(
    BUFF_LIBRARY_SHARE_TYPE,
    loadLocalBuffLibrary(),
    draft.name || selectedLocalDraftId || 'buff-library',
  ), [draft.name, selectedLocalDraftId]);
  const currentSheetShareText = useMemo(() => JSON.stringify(currentSheetShareFile, null, 2), [currentSheetShareFile]);

  const openSheetShareModal = useCallback((mode: 'export' | 'import') => {
    setShareModalMode(mode);
    setIsShareModalOpen(true);
    setShareImportError('');
    if (mode === 'import') {
      setPendingImportShare(null);
    }
  }, []);

  const closeSheetShareModal = useCallback(() => {
    setIsShareModalOpen(false);
    setShareImportError('');
    setPendingImportShare(null);
  }, []);

  const handleExportSheetLibraryShare = useCallback(() => {
    const library = loadLocalBuffLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      return;
    }
    const shareFile = buildDraftLibraryShareFile(
      BUFF_LIBRARY_SHARE_TYPE,
      library,
      draft.name || selectedLocalDraftId || 'buff-library',
    );
    downloadSheetShareFile(shareFile);
  }, [downloadSheetShareFile, draft.name, selectedLocalDraftId]);

  const handleOpenSheetShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const prepareSheetImportShare = useCallback((rawText: string) => {
    const parsedShare = parseDraftLibraryShareFile(rawText, BUFF_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setPendingImportShare(null);
      setShareImportError('JSON 无效，或不是 Buff 分享文件。');
      return;
    }
    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedBuffDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      }),
    ) as Record<string, BuffDraft>;
    if (Object.keys(normalizedPayload).length === 0) {
      setPendingImportShare(null);
      setShareImportError('JSON 中没有可导入的有效 Buff 分组。');
      return;
    }
    setShareImportError('');
    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
  }, []);

  const handleSheetShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    setShareImportText(rawText);
    prepareSheetImportShare(rawText);
    event.target.value = '';
  }, [prepareSheetImportShare]);

  const handleParseSheetImportText = useCallback(() => {
    prepareSheetImportShare(shareImportText);
  }, [prepareSheetImportShare, shareImportText]);

  const handleCopySheetShareJson = useCallback(async () => {
    await copyText(currentSheetShareText);
  }, [currentSheetShareText]);

  const handleCancelSheetImportShare = useCallback(() => {
    setPendingImportShare(null);
    setShareImportError('');
  }, []);

  const handleConfirmSheetImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = normalizeBuffDraftLibrary({
      ...loadLocalBuffLibrary(),
      ...pendingImportShare.payload,
    });
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    const nextSelectedId = selectedLocalDraftId && nextLibrary[selectedLocalDraftId]
      ? selectedLocalDraftId
      : (Object.keys(pendingImportShare.payload)[0] ?? Object.keys(nextLibrary)[0] ?? '');
    if (nextSelectedId && nextLibrary[nextSelectedId]) {
      setSelectedLocalDraftId(nextSelectedId);
      setDraft(nextLibrary[nextSelectedId]);
      setPendingFocusRowKey(`group-${nextSelectedId}`);
    }
    setPendingImportShare(null);
    setShareImportText('');
    setShareImportError('');
    setIsShareModalOpen(false);
  }, [applyExplorerDefaultCollapse, pendingImportShare, selectedLocalDraftId]);

  useEffect(() => {
    const nextLibrary = {
      ...loadLocalBuffLibrary(),
      [draft.id]: normalizeBuffDraft(draft),
    };
    setLocalLibrary(nextLibrary);
    applyExplorerDefaultCollapse(nextLibrary);
    setSelectedLocalDraftId((prev) => prev || draft.id || Object.keys(nextLibrary)[0] || '');
    // Only initialize once. Subsequent draft edits must not re-collapse the explorer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => buildBuffSheetRows(draft), [draft]);
  const visibleRows = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    if (!keyword) {
      return rows.filter((row) => row.kind !== 'effect' || !collapsedItems[getItemCollapseKey(draft.id, row.itemKey)]);
    }

    const matchedItemKeys = new Set<string>();
    rows.forEach((row) => {
      if (row.kind === 'effect' && row.searchText.includes(keyword)) {
        matchedItemKeys.add(row.itemKey);
      }
    });

    return rows.filter((row) => {
      if (row.kind === 'group') {
        return true;
      }
      if (row.kind === 'item') {
        return row.searchText.includes(keyword) || matchedItemKeys.has(row.itemKey);
      }
      return row.searchText.includes(keyword);
    });
  }, [collapsedItems, draft.id, filterKeyword, getItemCollapseKey, rows]);
  const workbookRows = useMemo(() => buildBuffWorkbookView(visibleRows, columns), [columns, visibleRows]);

  useLayoutEffect(() => {
    const snapshot = pendingFormulaFocusRef.current;
    if (!snapshot) {
      return;
    }
    const container = formulaBarRef.current;
    if (!container) {
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-formula-focus-id="${snapshot.focusId}"]`);
    if (!target) {
      return;
    }
    target.focus();
    if ('setSelectionRange' in target && typeof snapshot.selectionStart === 'number' && typeof snapshot.selectionEnd === 'number') {
      (target as HTMLInputElement).setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
    pendingFormulaFocusRef.current = null;
  }, [formulaFocusRestoreToken]);

  useEffect(() => {
    const resolveCellFromSelection = (selection: BuffWorkbookSelection | null) => {
      if (!selection) {
        return null;
      }
      if (selection.sourceRowKey) {
        const matchedRow = workbookRows.find((row) => row.sourceRow?.key === selection.sourceRowKey);
        if (matchedRow) {
          if (selection.columnKey) {
            const matchedCell = matchedRow.cells.find((cell) => cell.columnKey === selection.columnKey);
            if (matchedCell) {
              return matchedCell;
            }
          }
          return matchedRow.cells[0] ?? null;
        }
      }
      return workbookRows
        .flatMap((row) => row.cells)
        .find((cell) => cell.address === selection.address) ?? null;
    };

    const resolveCellByRowKey = (rowKey: string) => {
      const matchedRow = workbookRows.find((row) => row.sourceRow?.key === rowKey);
      return matchedRow?.cells[0] ?? null;
    };

    if (pendingFocusRowKey) {
      const targetCell = resolveCellByRowKey(pendingFocusRowKey);
      if (targetCell) {
        setSelectedWorkbookCell({
          address: targetCell.address,
          value: targetCell.value,
          sourceRowKey: targetCell.sourceRowKey,
          columnKey: targetCell.columnKey,
        });
        setPendingFocusRowKey(null);
        return;
      }
    }

    const firstDataRow = workbookRows.find((row) => row.kind === 'data') ?? workbookRows[0] ?? null;
    const firstCell = firstDataRow?.cells[0] ?? null;
    if (!firstCell) {
      setSelectedWorkbookCell(null);
      return;
    }
    const resolvedSelectedCell = resolveCellFromSelection(selectedWorkbookCell);
    if (resolvedSelectedCell) {
      if (
        resolvedSelectedCell.address !== selectedWorkbookCell?.address
        || resolvedSelectedCell.value !== selectedWorkbookCell?.value
        || resolvedSelectedCell.sourceRowKey !== selectedWorkbookCell?.sourceRowKey
        || resolvedSelectedCell.columnKey !== selectedWorkbookCell?.columnKey
      ) {
        setSelectedWorkbookCell({
          address: resolvedSelectedCell.address,
          value: resolvedSelectedCell.value,
          sourceRowKey: resolvedSelectedCell.sourceRowKey,
          columnKey: resolvedSelectedCell.columnKey,
        });
      }
      return;
    }
    if (!selectedWorkbookCell) {
      setSelectedWorkbookCell({
        address: firstCell.address,
        value: firstCell.value,
        sourceRowKey: firstCell.sourceRowKey,
        columnKey: firstCell.columnKey,
      });
    }
  }, [pendingFocusRowKey, selectedWorkbookCell, workbookRows]);

  const handleLoadDraftById = useCallback((draftId: string) => {
    const nextDraft = localLibrary[draftId];
    if (!nextDraft) {
      return;
    }
    setDraft(nextDraft);
    setSelectedLocalDraftId(draftId);
    setCollapsedDraftIds(buildCollapsedDraftState(localLibrary));
    setCollapsedItems(buildCollapsedItemState(localLibrary, getItemCollapseKey));
    setFilterKeyword('');
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
  }, [getItemCollapseKey, localLibrary]);

  const openBuffDrawer = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = draftId === draft.id ? draft : localLibrary[draftId];
    if (!targetDraft?.items[itemKey]?.effects[effectKey]) {
      return;
    }
    if (draftId !== draft.id) {
      setDraft(targetDraft);
      setSelectedLocalDraftId(draftId);
      setSelectedWorkbookCell(null);
      setPendingFocusRowKey(`effect-${itemKey}-${effectKey}`);
    }
    setBuffDrawerTarget({ itemKey, effectKey });
  }, [draft, localLibrary]);

  const handleOpenWorkbenchPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.home);
  };

  const handleOpenBuffEditorPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.buffSheet);
  };

  const toggleItemCollapsed = (itemKey: string) => {
    const collapseKey = getItemCollapseKey(draft.id, itemKey);
    setCollapsedItems((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  };

  const toggleDraftCollapsed = (draftId: string) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: !prev[draftId] }));
  };

  const setDraftCollapsed = useCallback((draftId: string, collapsed: boolean) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: collapsed }));
  }, []);

  const setItemCollapsed = useCallback((draftId: string, itemKey: string, collapsed: boolean) => {
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: collapsed }));
  }, [getItemCollapseKey]);

  const selectedWorkbookSummary = selectedWorkbookCell?.sourceRowKey
    ? visibleRows.find((row) => row.key === selectedWorkbookCell.sourceRowKey)
    : null;
  const selectedItemKey = selectedWorkbookSummary?.kind === 'item'
    ? selectedWorkbookSummary.itemKey
    : selectedWorkbookSummary?.kind === 'effect'
      ? selectedWorkbookSummary.itemKey
      : null;
  const selectedEffectKey = selectedWorkbookSummary?.kind === 'effect'
    ? selectedWorkbookSummary.effectKey
    : null;
  const selectedItem = selectedItemKey ? draft.items[selectedItemKey] ?? null : null;
  const selectedEffect = selectedItemKey && selectedEffectKey
    ? draft.items[selectedItemKey]?.effects[selectedEffectKey] ?? null
    : null;
  const drawerEffect = buffDrawerTarget
    ? draft.items[buffDrawerTarget.itemKey]?.effects[buffDrawerTarget.effectKey] ?? null
    : null;
  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    const options = getBuffEffectMultiplier(selectedEffect ?? {})
      ? BUFF_TYPE_OPTIONS.filter((option) => MULTIPLIER_SUPPORTED_BUFF_TYPES.includes(option))
      : BUFF_TYPE_OPTIONS;
    if (!keyword) {
      return options;
    }
    return options.filter((option) => {
      const meta = BUFF_TYPE_LABELS[option];
      const haystack = [option, meta.label, ...meta.keywords].join('|').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [buffTypeQuery, selectedEffect]);

  useEffect(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
      setEffectValueInput('');
      return;
    }
    const multiplier = getBuffEffectMultiplier(selectedEffect);
    if (multiplier) {
      setEffectValueInput(String(multiplier.coefficient));
      return;
    }
    setEffectValueInput(String(selectedEffect.value ?? 0));
  }, [selectedEffect?.effectKind, selectedEffect?.id, selectedEffect?.multiplier, selectedEffect?.value]);

  const updateDraftField = useCallback(<K extends keyof BuffDraft>(field: K, value: BuffDraft[K]) => {
    setDraft((prev) => {
      if (field === 'name') {
        const nextName = String(value);
        return {
          ...prev,
          name: nextName,
          id: buildBuffDraftIdFromName(nextName) || prev.id,
        };
      }
      return { ...prev, [field]: value };
    });
  }, []);

  const updateSelectedItem = useCallback((updater: (item: BuffItemDraft) => BuffItemDraft) => {
    if (!selectedItemKey) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: updater(prev.items[selectedItemKey]),
      },
    }));
  }, [selectedItemKey]);

  const updateSelectedEffect = useCallback((updater: (effect: BuffEffectDraft) => BuffEffectDraft) => {
    if (!selectedItemKey || !selectedEffectKey) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: {
          ...prev.items[selectedItemKey],
          effects: {
            ...prev.items[selectedItemKey].effects,
            [selectedEffectKey]: updater(prev.items[selectedItemKey].effects[selectedEffectKey]),
          },
        },
      },
    }));
  }, [selectedEffectKey, selectedItemKey]);

  const formulaTextBinding = useMemo(() => {
    if (!selectedWorkbookSummary) {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'group:id',
          focusId: 'group-id',
          value: draft.id,
          placeholder: '组 ID',
          commit: (nextValue: string) => updateDraftField('id', nextValue),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'group:description',
          focusId: 'group-description',
          value: draft.description,
          placeholder: '组描述',
          commit: (nextValue: string) => updateDraftField('description', nextValue),
        };
      }
      return {
        key: 'group:name',
        focusId: 'group-name',
        value: draft.name,
        placeholder: '组名称',
        commit: (nextValue: string) => updateDraftField('name', nextValue),
      };
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: `item:${selectedItem.id}:id`,
          focusId: 'item-id',
          value: selectedItem.id,
          placeholder: '项 ID',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, id: nextValue })),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `item:${selectedItem.id}:description`,
          focusId: 'item-description',
          value: selectedItem.description,
          placeholder: '项描述',
          commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, description: nextValue })),
        };
      }
      return {
        key: `item:${selectedItem.id}:name`,
        focusId: 'item-name',
        value: selectedItem.name,
        placeholder: '项名称',
        commit: (nextValue: string) => updateSelectedItem((prev) => ({ ...prev, name: nextValue })),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect' && selectedEffect) {
      switch (selectedWorkbookCell?.columnKey) {
        case 'condition':
          return {
            key: `effect:${selectedEffect.id}:condition`,
            focusId: 'effect-condition',
            value: selectedEffect.condition || '',
            placeholder: '条件',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, condition: nextValue })),
          };
        case 'description':
          return {
            key: `effect:${selectedEffect.id}:description`,
            focusId: 'effect-description',
            value: selectedEffect.description || '',
            placeholder: '描述',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, description: nextValue })),
          };
        default:
          return {
            key: `effect:${selectedEffect.id}:displayName`,
            focusId: 'effect-display-name',
            value: selectedEffect.displayName,
            placeholder: '效果名称',
            commit: (nextValue: string) => updateSelectedEffect((prev) => ({ ...prev, displayName: nextValue })),
          };
      }
    }

    return null;
  }, [
    draft.description,
    draft.id,
    draft.name,
    selectedEffect,
    selectedItem,
    selectedWorkbookCell?.columnKey,
    selectedWorkbookSummary,
    updateDraftField,
    updateSelectedEffect,
    updateSelectedItem,
  ]);

  useEffect(() => {
    setFormulaTextInput(formulaTextBinding?.value ?? '');
  }, [formulaTextBinding?.key, formulaTextBinding?.value]);

  const updateSelectedEffectKind = useCallback((nextKind: BuffEffectKind) => {
    updateSelectedEffect((prev) => applyBuffEffectKind(prev, nextKind));
  }, [updateSelectedEffect]);

  const handleEffectValueInputChange = useCallback((nextValue: string) => {
    setEffectValueInput(nextValue);
    if (!selectedEffect || getBuffEffectMultiplier(selectedEffect)) {
      return;
    }
    if (nextValue.trim() === '') {
      return;
    }
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    }
  }, [selectedEffect, updateSelectedEffect]);

  const finalizeEffectValueInput = useCallback(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit' || getBuffEffectMultiplier(selectedEffect)) {
      setEffectValueInput('');
      return;
    }
    const trimmed = effectValueInput.trim();
    if (trimmed === '') {
      updateSelectedEffect((prev) => ({ ...prev, value: 0 }));
      setEffectValueInput('0');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setEffectValueInput(String(selectedEffect.value ?? 0));
      return;
    }
    updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    setEffectValueInput(String(parsed));
  }, [effectValueInput, selectedEffect, updateSelectedEffect]);

  const buildDraftWithFormulaTextInput = useCallback((baseDraft: BuffDraft) => {
    if (!formulaTextBinding || formulaTextInput === formulaTextBinding.value) {
      return baseDraft;
    }

    if (selectedWorkbookSummary?.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return { ...baseDraft, id: formulaTextInput };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return { ...baseDraft, description: formulaTextInput };
      }
      return {
        ...baseDraft,
        name: formulaTextInput,
        id: buildBuffDraftIdFromName(formulaTextInput) || baseDraft.id,
      };
    }

    if (selectedWorkbookSummary?.kind === 'item' && selectedItemKey) {
      const targetItem = baseDraft.items[selectedItemKey];
      if (!targetItem) {
        return baseDraft;
      }

      const nextItem = selectedWorkbookCell?.columnKey === 'idText'
        ? { ...targetItem, id: formulaTextInput }
        : selectedWorkbookCell?.columnKey === 'description'
          ? { ...targetItem, description: formulaTextInput }
          : { ...targetItem, name: formulaTextInput };

      return {
        ...baseDraft,
        items: {
          ...baseDraft.items,
          [selectedItemKey]: nextItem,
        },
      };
    }

    if (selectedWorkbookSummary?.kind === 'effect' && selectedItemKey && selectedEffectKey) {
      const targetItem = baseDraft.items[selectedItemKey];
      const targetEffect = targetItem?.effects[selectedEffectKey];
      if (!targetItem || !targetEffect) {
        return baseDraft;
      }

      const nextEffect = selectedWorkbookCell?.columnKey === 'condition'
        ? { ...targetEffect, condition: formulaTextInput }
        : selectedWorkbookCell?.columnKey === 'description'
          ? { ...targetEffect, description: formulaTextInput }
          : { ...targetEffect, displayName: formulaTextInput };

      return {
        ...baseDraft,
        items: {
          ...baseDraft.items,
          [selectedItemKey]: {
            ...targetItem,
            effects: {
              ...targetItem.effects,
              [selectedEffectKey]: nextEffect,
            },
          },
        },
      };
    }

    return baseDraft;
  }, [
    formulaTextBinding,
    formulaTextInput,
    selectedEffectKey,
    selectedItemKey,
    selectedWorkbookCell?.columnKey,
    selectedWorkbookSummary,
  ]);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean, focusRowKey?: string | null, draftOverride?: BuffDraft) => {
    const library = loadLocalBuffLibrary();
    const existingIds = Object.keys(library);
    const workingDraft = draftOverride ?? draft;
    const nextDraftId = workingDraft.id.trim() || getNextDraftId(existingIds);

    if (library[nextDraftId] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }

    const nextDraft = normalizeBuffDraft({
      ...workingDraft,
      id: nextDraftId,
    });

    const nextLibrary = normalizeBuffDraftLibrary({ ...library });
    nextLibrary[nextDraftId] = nextDraft;

    const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    setDraft(nextDraft);
    setLocalLibrary(normalizedLibrary);
    setSelectedLocalDraftId(nextDraftId);
    setIsOverwriteDraftModalOpen(false);
    setPendingFocusRowKey(focusRowKey ?? `group-${nextDraftId}`);
    return true;
  }, [draft, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    const formulaField = activeElement instanceof HTMLElement
      ? activeElement.closest<HTMLElement>('[data-formula-focus-id]')
      : null;
    const nextDraft = buildDraftWithFormulaTextInput(draft);
    if (formulaField && formulaBarRef.current?.contains(formulaField)) {
      const selectionCapable = formulaField as HTMLInputElement;
      pendingFormulaFocusRef.current = {
        focusId: formulaField.dataset.formulaFocusId || '',
        selectionStart: typeof selectionCapable.selectionStart === 'number' ? selectionCapable.selectionStart : null,
        selectionEnd: typeof selectionCapable.selectionEnd === 'number' ? selectionCapable.selectionEnd : null,
      };
      setFormulaFocusRestoreToken((prev) => prev + 1);
    }
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    persistDraftToLibrary(!isOverwriteProtectionEnabled, selectedWorkbookCell?.sourceRowKey ?? null, nextDraft);
  }, [buildDraftWithFormulaTextInput, draft, isOverwriteProtectionEnabled, persistDraftToLibrary, selectedWorkbookCell]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    const nextDraft = buildDraftWithFormulaTextInput(draft);
    if (nextDraft !== draft) {
      setDraft(nextDraft);
    }
    persistDraftToLibrary(true, selectedWorkbookCell?.sourceRowKey ?? null, nextDraft);
  }, [buildDraftWithFormulaTextInput, draft, persistDraftToLibrary, selectedWorkbookCell]);

  const handleCreateNewDraft = useCallback(() => {
    const nextDraftId = getNextDraftId(Object.keys(localLibrary));
    const nextDraft = createEmptyBuffDraft(nextDraftId);
    setLocalLibrary((prev) => ({
      ...prev,
      [nextDraftId]: nextDraft,
    }));
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextDraftId);
    setCollapsedDraftIds((prev) => ({
      ...prev,
      [nextDraftId]: true,
    }));
    setSelectedWorkbookCell(null);
    setPendingFocusRowKey(`group-${nextDraftId}`);
  }, [localLibrary]);

  const handleNormalizeDraft = useCallback(() => {
    const nextDraft = reorderDraftStructure(cloneValue(draft));
    setDraft(nextDraft);
    setPendingFocusRowKey(`group-${nextDraft.id}`);
  }, [draft]);

  const persistLibraryState = useCallback((nextLibrary: Record<string, BuffDraft>, nextSelectedId?: string) => {
    const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
    setLocalLibrary(normalizedLibrary);
    if (nextSelectedId) {
      setSelectedLocalDraftId(nextSelectedId);
      if (normalizedLibrary[nextSelectedId]) {
        setDraft(normalizedLibrary[nextSelectedId]);
        window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(normalizedLibrary[nextSelectedId]));
      }
    }
  }, []);

  const handleCreateDraftItem = useCallback((draftId: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft) {
      return;
    }
    const nextItemKey = getNextItemKey(targetDraft);
    const nextItem = createDefaultBuffItem(nextItemKey, targetDraft.sourceName || targetDraft.name);
    const nextDraft = {
      ...cloneValue(targetDraft),
      items: {
        ...cloneValue(targetDraft.items),
        [nextItemKey]: nextItem,
      },
    };
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, nextItemKey)]: false }));
    setPendingFocusRowKey(`item-${nextItemKey}`);
  }, [getItemCollapseKey, localLibrary, persistLibraryState]);

  const handleDuplicateDraftItem = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem) {
      return;
    }
    const nextItemKey = getNextItemKey(targetDraft);
    const duplicated = cloneValue(targetItem);
    duplicated.id = nextItemKey;
    duplicated.name = `${targetItem.name}（副本）`;
    const nextDraft = {
      ...cloneValue(targetDraft),
      items: {
        ...cloneValue(targetDraft.items),
        [nextItemKey]: duplicated,
      },
    };
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setPendingFocusRowKey(`item-${nextItemKey}`);
  }, [localLibrary, persistLibraryState]);

  const handleDeleteDraftItem = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    if (!targetDraft?.items[itemKey]) {
      return;
    }
    withUndo(`删除自定义项 · ${itemKey}`, () => {
      const nextDraft = cloneValue(targetDraft);
      delete nextDraft.items[itemKey];
      const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
      persistLibraryState(nextLibrary, draftId);
      const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
      setPendingFocusRowKey(nextItemKey ? `item-${nextItemKey}` : `group-${nextDraft.id}`);
    });
  }, [localLibrary, persistLibraryState, withUndo]);

  const handleCreateDraftEffect = useCallback((draftId: string, itemKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem) {
      return;
    }
    const nextEffectKey = getNextEffectKey(targetItem);
    const nextEffect = createDefaultBuffEffect(nextEffectKey, targetItem.sourceName || targetDraft.sourceName);
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items[itemKey].effects[nextEffectKey] = nextEffect;
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: false }));
    setPendingFocusRowKey(`effect-${itemKey}-${nextEffectKey}`);
    setBuffDrawerTarget({ itemKey, effectKey: nextEffectKey });
  }, [getItemCollapseKey, localLibrary, persistLibraryState]);

  const handleDuplicateDraftEffect = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    const targetEffect = targetItem?.effects[effectKey];
    if (!targetDraft || !targetItem || !targetEffect) {
      return;
    }
    const nextEffectKey = getNextEffectKey(targetItem);
    const duplicated = cloneValue(targetEffect);
    duplicated.id = nextEffectKey;
    duplicated.displayName = `${targetEffect.displayName}（副本）`;
    duplicated.name = `${createDefaultBuffName(nextEffectKey)}_copy`;
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items[itemKey].effects[nextEffectKey] = duplicated;
    const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
    persistLibraryState(nextLibrary, draftId);
    setPendingFocusRowKey(`effect-${itemKey}-${nextEffectKey}`);
    setBuffDrawerTarget({ itemKey, effectKey: nextEffectKey });
  }, [localLibrary, persistLibraryState]);

  const handleDeleteDraftEffect = useCallback((draftId: string, itemKey: string, effectKey: string) => {
    const targetDraft = localLibrary[draftId];
    const targetItem = targetDraft?.items[itemKey];
    if (!targetDraft || !targetItem?.effects[effectKey]) {
      return;
    }
    withUndo(`删除 Buff 效果 · ${effectKey}`, () => {
      const nextDraft = cloneValue(targetDraft);
      delete nextDraft.items[itemKey].effects[effectKey];
      const nextLibrary = { ...localLibrary, [draftId]: nextDraft };
      persistLibraryState(nextLibrary, draftId);
      const nextEffectKey = Object.keys(nextDraft.items[itemKey].effects)[0] ?? null;
      setPendingFocusRowKey(nextEffectKey ? `effect-${itemKey}-${nextEffectKey}` : `item-${itemKey}`);
    });
  }, [localLibrary, persistLibraryState, withUndo]);

  const handleDeleteDraftGroup = useCallback((draftId: string) => {
    if (!localLibrary[draftId]) {
      return;
    }
    withUndo(`删除本地组 · ${draftId}`, () => {
      const nextLibrary = cloneValue(localLibrary);
      delete nextLibrary[draftId];
      const nextSelectedId = Object.keys(nextLibrary)[0] ?? '';
      const normalizedLibrary = normalizeBuffDraftLibrary(nextLibrary);
      window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(normalizedLibrary));
      setLocalLibrary(normalizedLibrary);
      setSelectedLocalDraftId(nextSelectedId);
      if (nextSelectedId && normalizedLibrary[nextSelectedId]) {
        setDraft(normalizedLibrary[nextSelectedId]);
        setPendingFocusRowKey(`group-${nextSelectedId}`);
      } else {
        const nextDraftId = getNextDraftId([]);
        const nextDraft = createEmptyBuffDraft(nextDraftId);
        setDraft(nextDraft);
        setPendingFocusRowKey(`group-${nextDraftId}`);
      }
    });
  }, [localLibrary, withUndo]);

  const openContextMenu = useCallback((event: ReactMouseEvent, nextMenu: BuffSheetContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(nextMenu);
  }, []);

  const openWorkbookContextMenu = useCallback((
    event: ReactMouseEvent,
    sourceRow?: BuffSheetRow,
    selectedCell?: { address: string; value: string; sourceRowKey?: string; columnKey?: string },
  ) => {
    if (selectedCell) {
      setSelectedWorkbookCell(selectedCell);
    }
    if (!sourceRow) {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'blank',
      });
      return;
    }
    if (sourceRow.kind === 'group') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'draft',
        draftId: draft.id,
      });
      return;
    }
    if (sourceRow.kind === 'item') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'item',
        draftId: draft.id,
        itemKey: sourceRow.itemKey,
      });
      return;
    }
    openContextMenu(event, {
      x: event.clientX,
      y: event.clientY,
      target: 'effect',
      draftId: draft.id,
      itemKey: sourceRow.itemKey,
      effectKey: sourceRow.effectKey,
    });
  }, [draft.id, openContextMenu]);

  const getExplorerDragNodeKey = useCallback((node: BuffExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'item') {
      return `item:${node.draftId}:${node.itemKey}`;
    }
    return `effect:${node.draftId}:${node.itemKey}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: BuffExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
    if (!targetDraft) {
      return node.draftId;
    }
    if (node.kind === 'draft') {
      return targetDraft.name || node.draftId;
    }
    const targetItem = targetDraft.items[node.itemKey];
    if (!targetItem) {
      return node.itemKey;
    }
    if (node.kind === 'item') {
      return targetItem.name || node.itemKey;
    }
    const targetEffect = targetItem.effects[node.effectKey];
    return targetEffect?.displayName || node.effectKey;
  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const consumeSuppressedExplorerClick = useCallback(() => {
    if (!suppressExplorerClickRef.current) {
      return false;
    }
    suppressExplorerClickRef.current = false;
    return true;
  }, []);

  const canStartExplorerDrag = useCallback((node: BuffExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    if (node.kind === 'draft') {
      return Boolean(collapsedDraftIds[node.draftId]);
    }
    if (node.kind === 'item') {
      return Boolean(collapsedItems[getItemCollapseKey(node.draftId, node.itemKey)]);
    }
    return true;
  }, [collapsedDraftIds, collapsedItems, filterKeyword, getItemCollapseKey]);

  const isValidExplorerDropTarget = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'item') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.itemKey === target.itemKey;
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): BuffExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-buff-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.buffDragKind;
    const draftId = row.dataset.buffDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind: 'draft', draftId };
    }
    const itemKey = row.dataset.buffItemKey;
    if (!itemKey) {
      return null;
    }
    if (kind === 'item') {
      return { kind: 'item', draftId, itemKey };
    }
    const effectKey = row.dataset.buffEffectKey;
    if (!effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, itemKey, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      const nextLibrary = reorderRecordEntries(localLibrary, source.draftId, target.draftId);
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`group-${source.draftId}`);
      return;
    }

    if (source.kind === 'item' && target.kind === 'item') {
      const targetDraft = localLibrary[source.draftId];
      if (!targetDraft) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items = reorderRecordEntries(nextDraft.items, source.itemKey, target.itemKey);
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`item-${source.itemKey}`);
      return;
    }

    if (source.kind === 'effect' && target.kind === 'effect') {
      const targetDraft = localLibrary[source.draftId];
      const targetItem = targetDraft?.items[source.itemKey];
      if (!targetDraft || !targetItem) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items[source.itemKey].effects = reorderRecordEntries(
        nextDraft.items[source.itemKey].effects,
        source.effectKey,
        target.effectKey,
      );
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`effect-${source.itemKey}-${source.effectKey}`);
    }
  }, [isValidExplorerDropTarget, localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: BuffExplorerDragNode) => {
    if (event.button !== 0 || !canStartExplorerDrag(source)) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.buff-sheet-explorer-toggle')) {
      return;
    }
    clearPendingExplorerDrag();
    pendingDragSourceRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
    };
    dragHoldTimerRef.current = window.setTimeout(() => {
      suppressExplorerClickRef.current = true;
      setContextMenu(null);
      setDragState({ source, over: null, x: event.clientX, y: event.clientY });
      pendingDragSourceRef.current = null;
      dragHoldTimerRef.current = null;
    }, 220);
  }, [canStartExplorerDrag, clearPendingExplorerDrag]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handlePointerDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingDragSourceRef.current;
      if (pending) {
        const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
        if (distance > 6) {
          clearPendingExplorerDrag();
        }
      }
      if (!dragState) {
        return;
      }
      event.preventDefault();
      const hoveredNode = resolveExplorerDragNodeFromElement(document.elementFromPoint(event.clientX, event.clientY));
      setDragState((prev) => {
        if (!prev) {
          return prev;
        }
        const nextOver = isValidExplorerDropTarget(prev.source, hoveredNode) ? hoveredNode : null;
        const previousOverKey = prev.over ? getExplorerDragNodeKey(prev.over) : '';
        const nextOverKey = nextOver ? getExplorerDragNodeKey(nextOver) : '';
        if (previousOverKey === nextOverKey && prev.x === event.clientX && prev.y === event.clientY) {
          return prev;
        }
        return {
          ...prev,
          over: nextOver,
          x: event.clientX,
          y: event.clientY,
        };
      });
    };

    const finalizeDrag = () => {
      clearPendingExplorerDrag();
      setDragState((prev) => {
        if (prev?.over) {
          applyExplorerReorder(prev.source, prev.over);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finalizeDrag, true);
    window.addEventListener('pointercancel', finalizeDrag, true);
    window.addEventListener('blur', finalizeDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finalizeDrag, true);
      window.removeEventListener('pointercancel', finalizeDrag, true);
      window.removeEventListener('blur', finalizeDrag);
    };
  }, [applyExplorerReorder, clearPendingExplorerDrag, dragState, getExplorerDragNodeKey, isValidExplorerDropTarget, resolveExplorerDragNodeFromElement]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      handleSaveDraft();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveDraft]);

  const renderFormulaEditor = () => {
    if (!selectedWorkbookSummary) {
      return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Buff workbook'}</div>;
    }

    const commitFormulaTextInput = () => {
      if (!formulaTextBinding) {
        return;
      }
      if (formulaTextInput === formulaTextBinding.value) {
        return;
      }
      formulaTextBinding.commit(formulaTextInput);
    };

    const handleFormulaTextInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        commitFormulaTextInput();
        event.currentTarget.blur();
        return;
      }
      if (event.key === 'Escape') {
        setFormulaTextInput(formulaTextBinding?.value ?? '');
        event.currentTarget.blur();
      }
    };

    if (selectedWorkbookSummary.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="group-id" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="group-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组描述" />;
      }
      return <input data-formula-focus-id="group-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="组名称" />;
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="item-id" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="item-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项描述" />;
      }
      return <input data-formula-focus-id="item-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="项名称" />;
    }

    if (selectedWorkbookSummary.kind === 'effect' && selectedEffect) {
      switch (selectedWorkbookCell?.columnKey) {
        case 'idText':
          return <div className="damage-sheet-formula-value">{selectedEffect.id}</div>;
        case 'effectKind':
          return (
            <select data-formula-focus-id="effect-kind" className="buff-sheet-formula-input is-select" value={selectedEffect.effectKind || 'modifier'} onChange={(event) => updateSelectedEffectKind(event.target.value as BuffEffectKind)}>
              {BUFF_EFFECT_KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>{getEffectKindLabel(option)}</option>
              ))}
            </select>
          );
        case 'typeLabel':
          return (
            <div className="buff-sheet-formula-type-editor">
              <input
                data-formula-focus-id="effect-type-search"
                className="buff-sheet-formula-input buff-sheet-formula-type-search"
                value={buffTypeQuery}
                onChange={(event) => setBuffTypeQuery(event.target.value)}
                placeholder="搜索类型：法术 / 异伤 / 倍率 / 源石技艺"
                disabled={selectedEffect.effectKind === 'extraHit'}
              />
              <select
                data-formula-focus-id="effect-type-select"
                className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
                value={selectedEffect.type || ''}
                onChange={(event) => updateSelectedEffect((prev) => applyBuffType(prev, event.target.value))}
                disabled={selectedEffect.effectKind === 'extraHit'}
              >
                <option value="">暂无类型</option>
                {filteredBuffTypeOptions.map((option) => (
                  <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
                ))}
              </select>
              {selectedEffect.effectKind !== 'extraHit' && (
                <label className="buff-sheet-formula-inline-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(getBuffEffectMultiplier(selectedEffect))}
                    disabled={normalizeBuffCategory(selectedEffect.category) === 'countable'}
                    onChange={(event) => updateSelectedEffect((prev) => setBuffMultiplierEnabled(prev, event.target.checked))}
                  />
                  乘算
                </label>
              )}
            </div>
          );
        case 'valueText':
          return (
            <input
              data-formula-focus-id="effect-value"
              className="buff-sheet-formula-input"
              type="text"
              inputMode="decimal"
              value={selectedEffect.effectKind === 'extraHit' ? 0 : effectValueInput}
              onChange={(event) => handleEffectValueInputChange(event.target.value)}
              onBlur={getBuffEffectMultiplier(selectedEffect)
                ? (event) => updateSelectedEffect((prev) => setBuffMultiplierCoefficient(prev, Number(event.target.value)))
                : finalizeEffectValueInput}
              disabled={selectedEffect.effectKind === 'extraHit'}
              placeholder={getBuffEffectMultiplier(selectedEffect) ? '乘算系数' : '数值'}
            />
          );
        case 'categoryText':
          return (
            <div className="buff-sheet-formula-type-editor">
              <select
                data-formula-focus-id="effect-category"
                className="buff-sheet-formula-input is-select"
                value={normalizeBuffCategory(selectedEffect.category)}
                onChange={(event) => updateSelectedEffect((prev) => applyBuffCategory(prev, event.target.value as BuffCategory))}
                disabled={Boolean(getBuffEffectMultiplier(selectedEffect))}
              >
                {BUFF_CATEGORY_OPTIONS
                  .filter((option) => selectedEffect.effectKind !== 'extraHit' || option !== 'condition')
                  .map((option) => (
                    <option key={option} value={option}>{BUFF_CATEGORY_LABELS[option]}</option>
                  ))}
              </select>
              {normalizeBuffCategory(selectedEffect.category) === 'countable' && (
                <input
                  data-formula-focus-id="effect-max-stacks"
                  className="buff-sheet-formula-input"
                  type="number"
                  min={1}
                  step={1}
                  value={selectedEffect.maxStacks ?? 1}
                  onChange={(event) => updateSelectedEffect((prev) => setBuffMaxStacks(prev, Number(event.target.value)))}
                  placeholder="最大层数"
                />
              )}
            </div>
          );
        case 'condition':
          return <input data-formula-focus-id="effect-condition" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="条件" />;
        case 'description':
          return <input data-formula-focus-id="effect-description" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="描述" />;
        default:
          return <input data-formula-focus-id="effect-display-name" className="buff-sheet-formula-input" value={formulaTextInput} onChange={(event) => setFormulaTextInput(event.target.value)} onBlur={commitFormulaTextInput} onKeyDown={handleFormulaTextInputKeyDown} placeholder="效果名称" />;
      }
    }

    return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Buff workbook'}</div>;
  };

  const dragSourceKey = dragState ? getExplorerDragNodeKey(dragState.source) : '';
  const dragTargetKey = dragState?.over ? getExplorerDragNodeKey(dragState.over) : '';
  const dragSourceLabel = dragState ? getExplorerDragNodeLabel(dragState.source) : '';
  const dragTargetLabel = dragState?.over ? getExplorerDragNodeLabel(dragState.over) : '';
  const dragTargetKindLabel = dragState?.over ? formatBuffExplorerDragKindLabel(dragState.over.kind) : '';
  const currentContextMenuActions = useMemo<BuffSheetContextMenuAction[]>(() => {
    if (!contextMenu) {
      return [];
    }
    if (contextMenu.target === 'blank') {
      return [
        { key: 'new-draft', label: '新建组', icon: 'new', onClick: () => handleCreateNewDraft() },
        { key: 'collapse-all-drafts', label: '折叠全部组', icon: 'collapse', onClick: () => handleCollapseAllDrafts() },
        { key: 'expand-all-drafts', label: '展开全部组', icon: 'expand', onClick: () => handleExpandAllDrafts() },
      ];
    }
    if (contextMenu.target === 'draft' && contextMenu.draftId) {
      const isCollapsed = Boolean(collapsedDraftIds[contextMenu.draftId]);
      return [
        { key: 'open-draft', label: '打开组', icon: 'open', onClick: () => handleLoadDraftById(contextMenu.draftId!) },
        {
          key: 'toggle-draft-collapse',
          label: isCollapsed ? '展开此组' : '折叠此组',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setDraftCollapsed(contextMenu.draftId!, !isCollapsed),
        },
        { key: 'collapse-draft-items', label: '折叠全部项', icon: 'collapse', onClick: () => handleCollapseAllItemsInDraft(contextMenu.draftId!) },
        { key: 'expand-draft-items', label: '展开全部项', icon: 'expand', onClick: () => handleExpandAllItemsInDraft(contextMenu.draftId!) },
        { key: 'create-item', label: '新建项', icon: 'new', onClick: () => handleCreateDraftItem(contextMenu.draftId!) },
        { key: 'delete-draft', label: '删除组', icon: 'delete', onClick: () => handleDeleteDraftGroup(contextMenu.draftId!) },
      ];
    }
    if (contextMenu.target === 'item' && contextMenu.draftId && contextMenu.itemKey) {
      const collapseKey = getItemCollapseKey(contextMenu.draftId, contextMenu.itemKey);
      const isCollapsed = Boolean(collapsedItems[collapseKey]);
      return [
        { key: 'create-effect', label: '新建效果', icon: 'new', onClick: () => handleCreateDraftEffect(contextMenu.draftId!, contextMenu.itemKey!) },
        {
          key: 'toggle-item-collapse',
          label: isCollapsed ? '展开此项' : '折叠此项',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setItemCollapsed(contextMenu.draftId!, contextMenu.itemKey!, !isCollapsed),
        },
        { key: 'duplicate-item', label: '复制项', icon: 'copy', onClick: () => handleDuplicateDraftItem(contextMenu.draftId!, contextMenu.itemKey!) },
        { key: 'delete-item', label: '删除项', icon: 'delete', onClick: () => handleDeleteDraftItem(contextMenu.draftId!, contextMenu.itemKey!) },
      ];
    }
    if (contextMenu.target === 'effect' && contextMenu.draftId && contextMenu.itemKey && contextMenu.effectKey) {
      return [
        { key: 'edit-effect', label: '编辑 Buff', icon: 'open', onClick: () => openBuffDrawer(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
        { key: 'duplicate-effect', label: '复制效果', icon: 'copy', onClick: () => handleDuplicateDraftEffect(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
        { key: 'delete-effect', label: '删除效果', icon: 'delete', onClick: () => handleDeleteDraftEffect(contextMenu.draftId!, contextMenu.itemKey!, contextMenu.effectKey!) },
      ];
    }
    return [];
  }, [
    collapsedDraftIds,
    collapsedItems,
    contextMenu,
    getItemCollapseKey,
    handleCollapseAllDrafts,
    handleCollapseAllItemsInDraft,
    handleCreateDraftEffect,
    handleCreateDraftItem,
    handleCreateNewDraft,
    handleDeleteDraftEffect,
    handleDeleteDraftGroup,
    handleDeleteDraftItem,
    handleDuplicateDraftEffect,
    handleDuplicateDraftItem,
    handleExpandAllDrafts,
    handleExpandAllItemsInDraft,
    handleLoadDraftById,
    openBuffDrawer,
    setDraftCollapsed,
    setItemCollapsed,
  ]);

  return (
    <main className="damage-sheet-page buff-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={handleOpenWorkbenchPage}>
            返回主界面
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Buff</h1>
            <p>沿用表格工作表框架，把 Buff 组、自定义项、效果三层平铺到同一张表里。</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <div className="damage-sheet-undo-wrap">
            <button
              type="button"
              className="damage-sheet-action-button"
              onClick={() => setIsUndoMenuOpen((open) => !open)}
              disabled={undoSnapshots.length === 0}
            >
              撤回
            </button>
            {isUndoMenuOpen && undoSnapshots.length > 0 ? (
              <div className="damage-sheet-undo-menu">
                {undoSnapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className="damage-sheet-undo-item"
                    onClick={() => handleRestoreUndoSnapshot(snapshot.id)}
                    title={snapshot.label}
                  >
                    <strong>{formatBuffUndoLabel(snapshot.createdAt)}</strong>
                    <span>{snapshot.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="damage-sheet-action-button" onClick={handleOpenBuffEditorPage}>
            返回编辑器
          </button>
          <button type="button" className="damage-sheet-action-button" onClick={refreshLocalLibrary}>
            刷新本地库
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNewDraft} title="新建组">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSaveDraft} title="保存当前组">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" />
                <path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalizeDraft} title="整理项与效果顺序">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" />
                <path d="M11 3.25l1.75 1.25L11 5.75" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">整理</span>
          </button>
          <button
            type="button"
            className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
            title="切换覆盖保护"
          >
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" />
                <path d="M6.25 8.25L7.4 9.4l2.35-2.55" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openSheetShareModal('export')} title="导出本地 Buff 库">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3v6.5" />
                <path d="M5.75 7.25L8 9.5l2.25-2.25" />
                <path d="M3.5 11.75h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={() => openSheetShareModal('import')} title="导入 Buff 分享">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 13V6.5" />
                <path d="M5.75 8.75L8 6.5l2.25 2.25" />
                <path d="M3.5 3.25h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
        </div>
        <div ref={formulaBarRef} className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedWorkbookCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace buff-sheet-workspace">
        <aside className="damage-sheet-sidebar buff-sheet-explorer" onContextMenu={(event) => openContextMenu(event, {
          x: event.clientX,
          y: event.clientY,
          target: 'blank',
        })}>
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input
            className="buff-sheet-search-input"
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="搜索组 / 项 / 效果"
          />
          <input
            ref={shareImportInputRef}
            type="file"
            accept=".json,application/json"
            className="operator-draft-file-input"
            onChange={handleSheetShareFileSelected}
          />
          <div className="buff-sheet-explorer-tree">
            {Object.entries(localLibrary).map(([draftId, draftValue]) => {
              const isCollapsed = collapsedDraftIds[draftId];
              const itemEntries = Object.entries(draftValue.items);
              const draftDragNode: BuffExplorerDragNode = { kind: 'draft', draftId };
              return (
                <div key={draftId} className="buff-sheet-explorer-node">
                  <button
                    type="button"
                    className={`buff-sheet-explorer-row${selectedLocalDraftId === draftId ? ' is-active' : ''}${dragSourceKey === getExplorerDragNodeKey(draftDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(draftDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(draftDragNode) ? ' is-draggable' : ''}`}
                    data-buff-drag-kind="draft"
                    data-buff-draft-id={draftId}
                    onPointerDown={(event) => handleExplorerPointerDown(event, draftDragNode)}
                    onClick={() => {
                      if (consumeSuppressedExplorerClick()) {
                        return;
                      }
                      handleLoadDraftById(draftId);
                    }}
                    onContextMenu={(event) => openContextMenu(event, {
                      x: event.clientX,
                      y: event.clientY,
                      target: 'draft',
                      draftId,
                    })}
                  >
                    <span
                      className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleDraftCollapsed(draftId);
                      }}
                    >
                      {isCollapsed ? '[+]' : '[-]'}
                    </span>
                    <span className="buff-sheet-explorer-label">{draftValue.name}</span>
                  </button>
                  {!isCollapsed ? (
                    <div className="buff-sheet-explorer-children">
                      {itemEntries.map(([itemKey, item]) => {
                        const itemDragNode: BuffExplorerDragNode = { kind: 'item', draftId, itemKey };
                        return (
                        <div key={itemKey} className="buff-sheet-explorer-node">
                          <button
                            type="button"
                            className={`buff-sheet-explorer-child${dragSourceKey === getExplorerDragNodeKey(itemDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(itemDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(itemDragNode) ? ' is-draggable' : ''}`}
                            data-buff-drag-kind="item"
                            data-buff-draft-id={draftId}
                            data-buff-item-key={itemKey}
                            onPointerDown={(event) => handleExplorerPointerDown(event, itemDragNode)}
                            onClick={() => {
                              if (consumeSuppressedExplorerClick()) {
                                return;
                              }
                              handleLoadDraftById(draftId);
                              setCollapsedItems((prev) => ({ ...prev, [getItemCollapseKey(draftId, itemKey)]: false }));
                              setPendingFocusRowKey(`item-${itemKey}`);
                            }}
                            onContextMenu={(event) => openContextMenu(event, {
                              x: event.clientX,
                              y: event.clientY,
                              target: 'item',
                              draftId,
                              itemKey,
                            })}
                          >
                            <span
                              className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                              onClick={(event) => {
                                event.stopPropagation();
                                setCollapsedItems((prev) => ({
                                  ...prev,
                                  [getItemCollapseKey(draftId, itemKey)]: !prev[getItemCollapseKey(draftId, itemKey)],
                                }));
                              }}
                            >
                              {collapsedItems[getItemCollapseKey(draftId, itemKey)] ? '[+]' : '[-]'}
                            </span>
                            <span className="buff-sheet-explorer-label">{item.name}</span>
                            <span className="buff-sheet-explorer-count">{Object.keys(item.effects).length}</span>
                          </button>
                          {!collapsedItems[getItemCollapseKey(draftId, itemKey)] ? (
                            <div className="buff-sheet-explorer-children buff-sheet-explorer-effects">
                              {Object.entries(item.effects).map(([effectKey, effect]) => {
                                const effectDragNode: BuffExplorerDragNode = { kind: 'effect', draftId, itemKey, effectKey };
                                return (
                                <button
                                  key={effectKey}
                                  type="button"
                                  className={`buff-sheet-explorer-effect${dragSourceKey === getExplorerDragNodeKey(effectDragNode) ? ' is-drag-source' : ''}${dragTargetKey === getExplorerDragNodeKey(effectDragNode) ? ' is-drag-target' : ''}${canStartExplorerDrag(effectDragNode) ? ' is-draggable' : ''}`}
                                  data-buff-drag-kind="effect"
                                  data-buff-draft-id={draftId}
                                  data-buff-item-key={itemKey}
                                  data-buff-effect-key={effectKey}
                                  onPointerDown={(event) => handleExplorerPointerDown(event, effectDragNode)}
                                  onClick={() => {
                                    if (consumeSuppressedExplorerClick()) {
                                      return;
                                    }
                                    handleLoadDraftById(draftId);
                                    setPendingFocusRowKey(`effect-${itemKey}-${effectKey}`);
                                  }}
                                  onContextMenu={(event) => openContextMenu(event, {
                                    x: event.clientX,
                                    y: event.clientY,
                                    target: 'effect',
                                    draftId,
                                    itemKey,
                                    effectKey,
                                  })}
                                >
                                  <span className="buff-sheet-explorer-bullet">·</span>
                                  <span className="buff-sheet-explorer-label">{effect.displayName || effectKey}</span>
                                </button>
                                );
                              })}
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
          {contextMenu ? (
            <div
              className="buff-sheet-context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {currentContextMenuActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className="buff-sheet-context-menu-item"
                  onClick={() => {
                    action.onClick();
                    setContextMenu(null);
                  }}
                >
                  <span className="buff-sheet-context-menu-icon" aria-hidden="true">
                    <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
                      {renderBuffSheetMenuIcon(action.icon)}
                    </svg>
                  </span>
                  <span className="buff-sheet-context-menu-label">{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div
            className="damage-sheet-excel-scroll"
            onContextMenu={(event) => openWorkbookContextMenu(event)}
          >
            {workbookRows.length === 0 ? (
              <div className="damage-sheet-empty-state">
                <h2>当前没有可展示的 Buff 数据</h2>
                <p>先在本地 Buff 编辑器里准备一组数据，再打开这张表。</p>
              </div>
            ) : (
              workbookRows.map((row) => (
                <div
                  key={row.key}
                  className={`damage-sheet-excel-row is-${row.kind}`}
                  onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                  onDoubleClick={() => {
                    if (row.sourceRow?.kind === 'effect') {
                      openBuffDrawer(draft.id, row.sourceRow.itemKey, row.sourceRow.effectKey);
                    }
                  }}
                >
                  <div
                    className="damage-sheet-excel-row-number"
                    onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                  >
                    {row.sourceRow?.kind === 'item' ? (
                      <button
                        type="button"
                        className="damage-sheet-row-toggle"
                        onClick={() => toggleItemCollapsed((row.sourceRow as Extract<BuffSheetRow, { kind: 'item' }>).itemKey)}
                      >
                        {collapsedItems[getItemCollapseKey(draft.id, (row.sourceRow as Extract<BuffSheetRow, { kind: 'item' }>).itemKey)] ? '[+]' : '[-]'}
                      </button>
                    ) : row.rowNumber}
                  </div>
                  <div className="damage-sheet-excel-row-cells">
                    {row.cells.map((cell) => (
                      <div
                        key={cell.key}
                        className={`damage-sheet-excel-cell is-${cell.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                        style={{ width: `${cell.width}px` }}
                        onClick={() => setSelectedWorkbookCell({
                          address: cell.address,
                          value: cell.value,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                        onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                          address: cell.address,
                          value: cell.value,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                      >
                        {renderBuffWorkbookCellContent(cell, row.sourceRow)}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      <BuffEffectEditorDrawer
        open={Boolean(buffDrawerTarget && drawerEffect)}
        sourceLabel={`Buff Sheet · ${buffDrawerTarget ? draft.items[buffDrawerTarget.itemKey]?.name ?? draft.name : draft.name}`}
        effect={drawerEffect ? buffSheetEffectToDrawer(drawerEffect) : null}
        onChange={(nextEffect) => {
          if (!buffDrawerTarget) {
            return;
          }
          setDraft((prev) => {
            const currentEffect = prev.items[buffDrawerTarget.itemKey]?.effects[buffDrawerTarget.effectKey];
            if (!currentEffect) {
              return prev;
            }
            return {
              ...prev,
              items: {
                ...prev.items,
                [buffDrawerTarget.itemKey]: {
                  ...prev.items[buffDrawerTarget.itemKey],
                  effects: {
                    ...prev.items[buffDrawerTarget.itemKey].effects,
                    [buffDrawerTarget.effectKey]: applyDrawerEffectToBuffSheet(currentEffect, nextEffect),
                  },
                },
              },
            };
          });
        }}
        onClose={() => setBuffDrawerTarget(null)}
      />
      {dragState ? (
        <div
          className="buff-sheet-drag-preview"
          style={{ left: `${dragState.x + 8}px`, top: `${dragState.y + 10}px` }}
        >
          <div className="buff-sheet-drag-preview-title">{dragSourceLabel}</div>
          <div className={`buff-sheet-drag-preview-drop${dragState.over ? ' is-active' : ''}`}>
            {dragState.over
              ? `将放到该${dragTargetKindLabel}位置：${dragTargetLabel}`
              : '移动到同层级目标上方后松开'}
          </div>
        </div>
      ) : null}
      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认覆盖本地 Buff 组</h3>
                <p>当前 ID 已存在于本地库中。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{draft.name || draft.id || '未命名 Buff 组'}</strong>
              <p>保护开启时，确认后会用当前 Sheet-Buff 编辑内容覆盖本地同 ID Buff 组。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsOverwriteDraftModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmOverwriteDraft}>
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isShareModalOpen ? (
        <div className="buff-sheet-share-modal-mask" onClick={closeSheetShareModal}>
          <div className="buff-sheet-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="buff-sheet-share-modal-header">
              <div className="buff-sheet-share-modal-tabs">
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${shareModalMode === 'export' ? ' is-active' : ''}`}
                  onClick={() => setShareModalMode('export')}
                >
                  导出
                </button>
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${shareModalMode === 'import' ? ' is-active' : ''}`}
                  onClick={() => setShareModalMode('import')}
                >
                  导入
                </button>
              </div>
              <button type="button" className="buff-sheet-share-modal-close" onClick={closeSheetShareModal} aria-label="关闭">
                ×
              </button>
            </div>
            {shareModalMode === 'export' ? (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">预览当前本地 Buff 库分享 JSON</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleCopySheetShareJson}>
                      复制 JSON
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleExportSheetLibraryShare}>
                      导出文件
                    </button>
                  </div>
                </div>
                <textarea
                  className="buff-sheet-share-textarea is-preview"
                  value={currentSheetShareText}
                  readOnly
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="buff-sheet-share-modal-body">
                <div className="buff-sheet-share-modal-copybar">
                  <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
                  <div className="buff-sheet-share-modal-actions">
                    <button type="button" className="buff-sheet-share-action" onClick={handleOpenSheetShareImportPicker}>
                      导入文件
                    </button>
                    <button type="button" className="buff-sheet-share-action is-primary" onClick={handleParseSheetImportText}>
                      读取粘贴内容
                    </button>
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
                  placeholder="把 Buff 分享 JSON 粘贴到这里，或点击右上角导入文件。"
                  spellCheck={false}
                />
                {shareImportError ? (
                  <div className="buff-sheet-share-feedback is-error">{shareImportError}</div>
                ) : null}
                {pendingImportShare ? (
                  <div className="buff-sheet-share-import-preview">
                    <div className="buff-sheet-share-import-title">导入预览</div>
                    <div className="buff-sheet-share-import-meta">
                      <span>{`名称：${pendingImportShare.label}`}</span>
                      <span>{`分组数：${Object.keys(pendingImportShare.payload).length}`}</span>
                    </div>
                    <div className="buff-sheet-share-modal-actions">
                      <button type="button" className="buff-sheet-share-action" onClick={handleCancelSheetImportShare}>
                        清空预览
                      </button>
                      <button type="button" className="buff-sheet-share-action is-primary" onClick={handleConfirmSheetImportShare}>
                        确认导入
                      </button>
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
