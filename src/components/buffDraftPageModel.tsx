import type { ReactNode } from 'react';
import { pinyin } from 'pinyin-pro';
import type { BuffCategory, BuffEffectKind, BuffExtraHitConfig, CandidateBuff } from '../core/domain/buff';
import { normalizeBuffMultiplier } from '../core/domain/buffMultiplier';
import { getMultiplierSupportedBuffTypes, isMultiplierSupportedBuffType } from '../core/domain/buffTypeRegistry';
import { normalizeStoredBuffDefinition } from '../core/services/buffStorageNormalization';
import { APP_ROUTE_PATHS } from '../utils/appRoute';
import type { OperatorBuffEffect } from './operatorDraftBuffModel';

export const BUFF_SHEET_PAGE_PATH = APP_ROUTE_PATHS.buffSheet;
export const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
export const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';
export const BUFF_LIBRARY_SHARE_TYPE = 'buff-library-share.v1';
export const BUFF_UNDO_STORAGE_KEY = 'def.buff-editor.undo.v1';
export const BUFF_UNDO_LIMIT = 8;

export interface BuffUndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  selectedDraftId?: string;
  draftState?: BuffDraft;
  selectedItemKey?: string | null;
  selectedEffectKey?: string | null;
  localEntries: Array<[string, string | null]>;
}

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

export const BUFF_TYPE_LABELS: Record<(typeof BUFF_TYPE_OPTIONS)[number], { label: string; keywords: string[] }> = {
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

export const PERCENT_STYLE_TYPES = new Set<string>([
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'multiplierBonus',
]);

export const DISPLAY_PERCENT_TYPES = new Set<string>([
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

export const BUFF_CATEGORY_OPTIONS: BuffCategory[] = ['condition', 'countable', 'passive'];
export const BUFF_CATEGORY_LABELS: Record<BuffCategory, string> = {
  condition: '条件',
  countable: '计层',
  passive: '常驻',
};
export const MULTIPLIER_SUPPORTED_BUFF_TYPES = getMultiplierSupportedBuffTypes();

export const DISPLAY_FLAT_TYPES = new Set<string>([
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

export const BUFF_EFFECT_KIND_OPTIONS: BuffEffectKind[] = ['modifier', 'extraHit'];

export const DEFAULT_EXTRA_HIT_CONFIG: BuffExtraHitConfig = {
  key: 'dianjian',
  damageType: 'physical',
  skillType: '',
  baseMultiplier: 2.5,
  imbalanceValue: 10,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal',
};

export function normalizeExtraHitConfig(value?: Partial<BuffExtraHitConfig>): BuffExtraHitConfig {
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

export function getEffectKindLabel(kind: BuffEffectKind | undefined) {
  return kind === 'extraHit' ? '额外伤害段' : '普通加成';
}

export interface BuffEffectDraft extends CandidateBuff {
  id: string;
}

export function buffSheetEffectToDrawer(effect: BuffEffectDraft): OperatorBuffEffect {
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

export function applyDrawerEffectToBuffSheet(effect: BuffEffectDraft, nextEffect: OperatorBuffEffect): BuffEffectDraft {
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

export interface BuffItemDraft {
  id: string;
  name: string;
  sourceName: string;
  description: string;
  effects: Record<string, BuffEffectDraft>;
}

export interface BuffDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: Record<string, BuffItemDraft>;
}

export type BuffItemInput = Omit<Partial<BuffItemDraft>, 'effects'> & {
  effects?: Record<string, Partial<BuffEffectDraft>>;
};

export function getNumericIndex(key: string, prefix: 'item' | 'buff') {
  const match = key.match(new RegExp(`${prefix}-(\\d+)`));
  return Number(match?.[1] || 1);
}

export function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function pad3(value: number) {
  return String(value).padStart(3, '0');
}

export function createDefaultBuffDisplayName(buffKey: string) {
  return `Buff 效果 ${pad2(getNumericIndex(buffKey, 'buff'))}`;
}

export function createDefaultBuffName(buffKey: string) {
  return `custom_buff_${pad3(getNumericIndex(buffKey, 'buff'))}`;
}

export function createDefaultBuffEffect(buffKey = 'buff-1', sourceName = '本地自定义'): BuffEffectDraft {
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

export function createDefaultItemName(itemKey: string) {
  return `自定义项 ${pad2(getNumericIndex(itemKey, 'item'))}`;
}

export function createDefaultBuffItem(itemKey = 'item-1', sourceName = '本地自定义'): BuffItemDraft {
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

export function createDefaultBuffDraft(): BuffDraft {
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

export function createEmptyBuffDraft(nextId = 'custom-buff-001'): BuffDraft {
  return {
    id: nextId,
    name: '新建 Buff 组',
    sourceName: '本地自定义',
    source: 'local_custom',
    description: '',
    items: {},
  };
}

export function getNextDraftId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-buff-${pad3(index)}`)) {
    index += 1;
  }
  return `custom-buff-${pad3(index)}`;
}

export function buildBuffDraftIdFromName(name: string) {
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

export function getBuffTypeDisplayLabel(type?: string) {
  if (!type) {
    return '暂无';
  }
  const meta = BUFF_TYPE_LABELS[type as keyof typeof BUFF_TYPE_LABELS];
  return meta ? `${meta.label} · ${type}` : type;
}

export function getBuffTypePlainLabel(type?: string) {
  if (!type) {
    return '';
  }
  const meta = BUFF_TYPE_LABELS[type as keyof typeof BUFF_TYPE_LABELS];
  return meta?.label || type;
}

export function normalizeLegacyBuffType(type: unknown) {
  if (type === 'magicTakenDmgBonus') return 'magicVulnerability';
  return typeof type === 'string' ? type : '';
}

export function normalizeBuffCategory(category: unknown): BuffCategory {
  if (category === 'countable' || category === 'passive' || category === 'condition') {
    return category;
  }
  if (category === 'positive') {
    return 'passive';
  }
  return 'condition';
}

export function normalizeBuffSheetEffectDefinition(effect: Partial<BuffEffectDraft>) {
  return normalizeStoredBuffDefinition({
    ...effect,
    type: normalizeLegacyBuffType(effect.type),
  }) as Partial<BuffEffectDraft>;
}

export function getBuffEffectMultiplier(effect: Partial<BuffEffectDraft>) {
  return normalizeBuffMultiplier(effect.multiplier);
}

export function canUseBuffMultiplier(type: string | undefined) {
  return isMultiplierSupportedBuffType(type);
}

export function formatEffectValueForDisplay(effect: Partial<BuffEffectDraft>) {
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

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeExplicitEffectDisplayName(displayName: string, typeLabel: string) {
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

export function buildFallbackEffectDisplayName(effectKey: string, effect: Partial<BuffEffectDraft>, fallbackName: string) {
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

export function formatBuffNumericValue(type: string | undefined, value: number | undefined) {
  const numericValue = Number(value ?? 0);
  if (PERCENT_STYLE_TYPES.has(type || '')) {
    return `${(numericValue).toFixed(1).replace(/\.0$/, '')}%`;
  }
  return String(numericValue);
}

export function formatBuffEffectValueText(effect: Partial<BuffEffectDraft>) {
  if (effect.effectKind === 'extraHit') {
    return `${effect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}x`;
  }
  const multiplier = getBuffEffectMultiplier(effect);
  if (multiplier) {
    return `×${multiplier.coefficient}`;
  }
  return formatBuffNumericValue(effect.type, effect.value);
}

export function applyBuffEffectKind(effect: BuffEffectDraft, nextKind: BuffEffectKind): BuffEffectDraft {
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

export function applyBuffType(effect: BuffEffectDraft, nextType: string): BuffEffectDraft {
  const normalizedType = normalizeLegacyBuffType(nextType);
  return {
    ...effect,
    type: normalizedType,
    ...(canUseBuffMultiplier(normalizedType) ? {} : { multiplier: undefined }),
  };
}

export function applyBuffCategory(effect: BuffEffectDraft, nextCategory: BuffCategory): BuffEffectDraft {
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

export function setBuffMultiplierEnabled(effect: BuffEffectDraft, enabled: boolean): BuffEffectDraft {
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

export function setBuffMultiplierCoefficient(effect: BuffEffectDraft, coefficient: number): BuffEffectDraft {
  return {
    ...effect,
    multiplier: { coefficient: Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1 },
  };
}

export function setBuffMaxStacks(effect: BuffEffectDraft, maxStacks: number): BuffEffectDraft {
  return {
    ...effect,
    maxStacks: Math.max(1, Math.floor(Number.isFinite(maxStacks) ? maxStacks : 1)),
  };
}

export function isBuffSheetPath(pathname: string) {
  return pathname === BUFF_SHEET_PAGE_PATH;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function getNextItemKey(draft: BuffDraft) {
  let index = 1;
  while (draft.items[`item-${index}`]) {
    index += 1;
  }
  return `item-${index}`;
}

export function getNextEffectKey(item: BuffItemDraft) {
  let index = 1;
  while (item.effects[`buff-${index}`]) {
    index += 1;
  }
  return `buff-${index}`;
}

export function normalizeEffect(effectKey: string, effect: Partial<BuffEffectDraft>, item: BuffItemDraft): BuffEffectDraft {
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

export function normalizeItem(
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

export function normalizeBuffDraft(value: Partial<BuffDraft> & { buffs?: Record<string, Partial<BuffEffectDraft>> }) {
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

export function normalizeBuffDraftLibrary(library: Record<string, BuffDraft>): Record<string, BuffDraft> {
  return Object.fromEntries(
    Object.entries(library).map(([draftId, draftValue]) => [draftId, normalizeBuffDraft(draftValue)])
  );
}

export function reorderDraftStructure(draft: BuffDraft) {
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

export function parseImportedBuffDraft(rawText: string) {
  const parsed = JSON.parse(rawText) as Partial<BuffDraft> & { buffs?: Record<string, Partial<BuffEffectDraft>> };
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name) {
    throw new Error('JSON 缺少 id / name');
  }
  return normalizeBuffDraft(parsed);
}

export function loadDraftFromStorage() {
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

export function loadLocalBuffLibrary() {
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

export async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

export type BuffSheetRow =
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

export type BuffExplorerDragNode =
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

export type BuffExplorerDragState = {
  source: BuffExplorerDragNode;
  over: BuffExplorerDragNode | null;
  x: number;
  y: number;
};

export type BuffSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'item' | 'effect';
  draftId?: string;
  itemKey?: string;
  effectKey?: string;
};

export type BuffSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open' | 'copy';
  onClick: () => void;
};

export function renderBuffSheetMenuIcon(icon: BuffSheetContextMenuAction['icon']) {
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

export function formatBuffUndoLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`;
}

export function readBuffUndoSnapshots(): BuffUndoSnapshot[] {
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

export function writeBuffUndoSnapshots(snapshots: BuffUndoSnapshot[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(BUFF_UNDO_STORAGE_KEY, JSON.stringify(snapshots));
}

export function captureBuffUndoSnapshot(
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

export function restoreBuffUndoSnapshot(snapshotId: string): BuffUndoSnapshot | null {
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

export function buildBuffSheetRows(draft: BuffDraft): BuffSheetRow[] {
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

export function reorderRecordEntries<T>(record: Record<string, T>, sourceKey: string, targetKey: string): Record<string, T> {
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

export function formatBuffExplorerDragKindLabel(kind: BuffExplorerDragNode['kind']): string {
  if (kind === 'draft') {
    return '组';
  }
  if (kind === 'item') {
    return '项';
  }
  return '效果';
}

export function buildCollapsedDraftState(library: Record<string, BuffDraft>): Record<string, boolean> {
  return Object.fromEntries(Object.keys(library).map((draftId) => [draftId, true]));
}

export function buildCollapsedItemState(
  library: Record<string, BuffDraft>,
  getItemCollapseKey: (draftId: string, itemKey: string) => string,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(library).flatMap(([draftId, draft]) => (
      Object.keys(draft.items).map((itemKey) => [getItemCollapseKey(draftId, itemKey), true] as const)
    )),
  );
}

export interface BuffSheetColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
}

export interface BuffWorkbookCellView {
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

export interface BuffWorkbookRowView {
  key: string;
  rowNumber: number;
  kind: BuffWorkbookCellView['kind'];
  cells: BuffWorkbookCellView[];
  sourceRow?: BuffSheetRow;
}

export type BuffWorkbookSelection = {
  address: string;
  value: string;
  sourceRowKey?: string;
  columnKey?: string;
};

export type FormulaFocusSnapshot = {
  focusId: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
};

export function renderBuffWorkbookCellContent(cell: BuffWorkbookCellView, sourceRow?: BuffSheetRow): ReactNode {
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

export function buildBuffSheetColumns(): BuffSheetColumn[] {
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

export function buildBuffColumnGroups(columns: BuffSheetColumn[]): Array<{ group: string; width: number; count: number }> {
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

export function buffColumnIndexToLabel(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function buildBuffWorkbookView(rows: BuffSheetRow[], columns: BuffSheetColumn[]): BuffWorkbookRowView[] {
  const columnGroups = buildBuffColumnGroups(columns);
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let groupStartColumn = 0;
  const groupRow: BuffWorkbookRowView = {
    key: 'row-1',
    rowNumber: 1,
    kind: 'group',
    cells: columnGroups.map((group) => {
      const startColumn = groupStartColumn;
      groupStartColumn += group.count;
      return {
        key: `1:${startColumn + 1}`,
        address: `${buffColumnIndexToLabel(startColumn)}1`,
        value: group.group,
        width: group.width,
        colSpan: group.count,
        rowSpan: 1,
        align: 'center',
        kind: 'group',
        columnKey: columns[startColumn]?.key,
      };
    }),
  };
  const headerRow: BuffWorkbookRowView = {
    key: 'row-2',
    rowNumber: 2,
    kind: 'header',
    cells: columns.map((column, index) => ({
      key: `2:${index + 1}`,
      address: `${buffColumnIndexToLabel(index)}2`,
      value: column.title,
      width: column.width,
      colSpan: 1,
      rowSpan: 1,
      align: column.align ?? 'left',
      kind: 'header',
      columnKey: column.key,
    })),
  };

  const dataRows = rows.map<BuffWorkbookRowView>((row, index) => {
    const rowNumber = index + 3;
    const rowKind = row.kind === 'group' ? 'character' : row.kind === 'item' ? 'button' : 'data';
    if (row.kind !== 'effect') {
      return {
        key: `row-${rowNumber}`,
        rowNumber,
        kind: rowKind,
        sourceRow: row,
        cells: [{
          key: `${rowNumber}:1`,
          address: `A${rowNumber}`,
          value: row.kind === 'group'
            ? `${row.title} · ${row.summary}`
            : `${row.title} · ${row.summary} · ${row.description}`,
          width: totalWidth,
          colSpan: columns.length,
          rowSpan: 1,
          align: 'left',
          kind: rowKind,
          sourceRowKey: row.key,
          columnKey: columns[0]?.key,
        }],
      };
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
    return {
      key: `row-${rowNumber}`,
      rowNumber,
      kind: 'data',
      sourceRow: row,
      cells: columns.map((column, columnIndex) => ({
        key: `${rowNumber}:${columnIndex + 1}`,
        address: `${buffColumnIndexToLabel(columnIndex)}${rowNumber}`,
        value: values[column.key] ?? '',
        width: column.width,
        colSpan: 1,
        rowSpan: 1,
        align: column.align ?? 'left',
        kind: 'data',
        sourceRowKey: row.key,
        columnKey: column.key,
      })),
    };
  });

  return [groupRow, headerRow, ...dataRows];
}

