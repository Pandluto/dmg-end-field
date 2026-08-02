import { pinyin } from 'pinyin-pro';
import type { BuffCategory, BuffEffectKind, CandidateBuff } from '../core/domain/buff';
import { normalizeBuffMultiplier } from '../core/domain/buffMultiplier';
import { isMultiplierSupportedBuffType } from '../core/domain/buffTypeRegistry';
import { normalizeStoredBuffDefinition } from '../core/services/buffStorageNormalization';
import type { OperatorBuffEffect } from './operatorDraftBuffModel';
import {
  BUFF_CATEGORY_LABELS,
  BUFF_TYPE_LABELS,
  DEFAULT_EXTRA_HIT_CONFIG,
  DISPLAY_FLAT_TYPES,
  DISPLAY_PERCENT_TYPES,
  PERCENT_STYLE_TYPES,
  getEffectKindLabel,
  normalizeExtraHitConfig,
} from './buffDraftCatalog';

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
  const naturalSentencePattern = new RegExp(`(^|[，,：:、\\s])((?:\\d+(?:\\.\\d+)?(?:%|x)?)+)(${escapedTypeLabel})(?=\\s*[+\\-]\\d)`);
  const repeatedBeforeTypePattern = new RegExp(`(^|[，,：:、\\s])(\\d+(?:\\.\\d+)?(?:%|x)?)(?:\\2)+(${escapedTypeLabel})`);

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
