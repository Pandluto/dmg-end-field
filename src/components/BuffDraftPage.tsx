import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import ExcelJS from 'exceljs';
import { pinyin } from 'pinyin-pro';
import './OperatorDraftPage.css';
import './BuffDraftPage.css';
import type { BuffEffectKind, BuffExtraHitConfig, CandidateBuff } from '../core/domain/buff';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';

const BUFF_DRAFT_PAGE_PATH = APP_ROUTE_PATHS.buffDraft;
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
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
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
  'magicTakenDmgBonus',
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'comboDamageBonus',
  'multiplierBonus',
  'multiplierMultiplier',
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
  skillDmgBonus: { label: '战技伤害加成', keywords: ['战技', '技能', 'skill'] },
  chainSkillDmgBonus: { label: '连携技伤害加成', keywords: ['连携', '连携技'] },
  ultimateDmgBonus: { label: '终结技伤害加成', keywords: ['终结', '大招', 'ultimate'] },
  normalAttackDmgBonus: { label: '普攻伤害加成', keywords: ['普攻', '普通攻击'] },
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
  magicTakenDmgBonus: { label: '法术易伤', keywords: ['法术', '异伤', '易伤', '魔法'] },
  physicalAmplify: { label: '物理增幅', keywords: ['物理', '增幅'] },
  magicAmplify: { label: '法术增幅', keywords: ['法术', '增幅'] },
  fireAmplify: { label: '灼热增幅', keywords: ['灼热', '增幅'] },
  electricAmplify: { label: '电磁增幅', keywords: ['电磁', '增幅'] },
  iceAmplify: { label: '寒冷增幅', keywords: ['寒冷', '增幅'] },
  natureAmplify: { label: '自然增幅', keywords: ['自然', '增幅'] },
  comboDamageBonus: { label: '连击伤害加成', keywords: ['连击', 'combo'] },
  multiplierBonus: { label: '倍率加算', keywords: ['倍率', '加算', '乘区'] },
  multiplierMultiplier: { label: '倍率乘算', keywords: ['倍率', '乘算', '乘区'] },
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
  'multiplierMultiplier',
]);

const BUFF_EFFECT_KIND_OPTIONS: BuffEffectKind[] = ['modifier', 'extraHit'];

const DEFAULT_EXTRA_HIT_CONFIG: BuffExtraHitConfig = {
  key: 'dianjian',
  damageType: 'physical',
  baseMultiplier: 2.5,
  imbalanceValue: 10,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal',
};

function normalizeExtraHitConfig(value?: Partial<BuffExtraHitConfig>): BuffExtraHitConfig {
  return {
    key: value?.key?.trim() || DEFAULT_EXTRA_HIT_CONFIG.key,
    damageType: value?.damageType || DEFAULT_EXTRA_HIT_CONFIG.damageType,
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

function formatBuffNumericValue(type: string | undefined, value: number | undefined) {
  const numericValue = Number(value ?? 0);
  if (PERCENT_STYLE_TYPES.has(type || '')) {
    return `${(numericValue * 100).toFixed(1).replace(/\.0$/, '')}%`;
  }
  return String(numericValue);
}

function getBuffValueHint(type: string | undefined, value: number | undefined) {
  const numericValue = Number(value ?? 0);
  if (PERCENT_STYLE_TYPES.has(type || '')) {
    return `展示为 ${formatBuffNumericValue(type, numericValue)}，底层存储 ${numericValue}`;
  }
  return `当前按小数记录：${numericValue}`;
}

function isBuffDraftPath(pathname: string) {
  return pathname === BUFF_DRAFT_PAGE_PATH;
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
  const effectKind = effect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  return {
    ...fallback,
    ...effect,
    id: effect.id?.trim() || effectKey,
    displayName: effect.displayName?.trim() || fallback.displayName,
    name: effect.name?.trim() || fallback.name,
    level: effect.level || '',
    source: effect.source?.trim() || 'local_custom',
    sourceName: effect.sourceName?.trim() || item.sourceName,
    description: effect.description || '',
    condition: effect.condition || '',
    value: Number(effect.value ?? fallback.value) || 0,
    type: effectKind === 'extraHit' ? '' : (effect.type ?? fallback.type),
    effectKind,
    extraHitConfig: effectKind === 'extraHit'
      ? normalizeExtraHitConfig(effect.extraHitConfig)
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

function moveRecordEntry<T>(record: Record<string, T>, fromKey: string, toKey: string) {
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

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-c-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

function renderMiniMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={`li-${index}`}>{renderInlineMarkdown(item, `list-${nodes.length}-${index}`)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith('## ')) {
      nodes.push(<h4 key={`h4-${index}`}>{renderInlineMarkdown(line.slice(3), `h4-${index}`)}</h4>);
      return;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.slice(2), `h3-${index}`)}</h3>);
      return;
    }
    nodes.push(<p key={`p-${index}`}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
  });

  flushList();
  return nodes;
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
          : (effect.type ? getBuffTypeDisplayLabel(effect.type) : '暂无'),
        valueText: effect.effectKind === 'extraHit'
          ? `${effect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}x`
          : formatBuffNumericValue(effect.type, effect.value),
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

export { isBuffDraftPath, isBuffSheetPath };

export function BuffDraftPage() {
  const [draft, setDraft] = useState<BuffDraft>(() => loadDraftFromStorage());
  const [localDraftIds, setLocalDraftIds] = useState<string[]>([]);
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [messages, setMessages] = useState<string[]>(['已进入本地 Buff 编辑器']);
  const [undoSnapshots, setUndoSnapshots] = useState<BuffUndoSnapshot[]>([]);
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [selectedEffectKey, setSelectedEffectKey] = useState<string | null>(null);
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [isExportPreviewOpen, setIsExportPreviewOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [shareDraftName, setShareDraftName] = useState('');
  const [effectValueInput, setEffectValueInput] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<BuffDraft> | null>(null);
  const [dragReadyTarget, setDragReadyTarget] = useState<{ kind: 'item' | 'effect'; key: string } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ kind: 'item' | 'effect'; key: string } | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const itemKeys = Object.keys(draft.items);
    if (!selectedItemKey || !draft.items[selectedItemKey]) {
      setSelectedItemKey(itemKeys[0] ?? null);
    }
  }, [draft.items, selectedItemKey]);

  useEffect(() => {
    const currentItem = selectedItemKey ? draft.items[selectedItemKey] : null;
    const effectKeys = currentItem ? Object.keys(currentItem.effects) : [];
    if (!selectedEffectKey || !currentItem?.effects[selectedEffectKey]) {
      setSelectedEffectKey(effectKeys[0] ?? null);
    }
  }, [draft.items, selectedItemKey, selectedEffectKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const localIds: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, BuffDraft>;
        localIds.push(...Object.keys(parsed));
      } catch {
        // ignore
      }
    }
    setLocalDraftIds(localIds);
    setSelectedLocalDraftId((prev) => prev || localIds[0] || '');
  }, [draft.id]);

  const orderedDraft = useMemo(() => draft, [draft]);
  const draftJson = useMemo(() => JSON.stringify(orderedDraft, null, 2), [orderedDraft]);
  const itemEntries = Object.entries(draft.items);
  const selectedItem = selectedItemKey ? draft.items[selectedItemKey] : null;
  const effectEntries = selectedItem ? Object.entries(selectedItem.effects) : [];
  const selectedEffect = selectedItem && selectedEffectKey ? selectedItem.effects[selectedEffectKey] : null;

  useEffect(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
      setEffectValueInput('');
      return;
    }
    setEffectValueInput(String(selectedEffect.value ?? 0));
  }, [selectedEffect?.effectKind, selectedEffect?.id, selectedEffect?.value]);

  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    if (!keyword) {
      return BUFF_TYPE_OPTIONS;
    }
    return BUFF_TYPE_OPTIONS.filter((option) => {
      const meta = BUFF_TYPE_LABELS[option];
      const haystack = [option, meta.label, ...meta.keywords].join('|').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [buffTypeQuery]);

  const markdown = useMemo(() => {
    const itemLines = Object.entries(draft.items).flatMap(([itemKey, item]) => {
      const effectLines = Object.entries(item.effects).map(
        ([effectKey, effect]) =>
          `- \`${itemKey}/${effectKey}\` **${effect.displayName || effectKey}**：\`${getBuffTypeDisplayLabel(effect.type)}\` / ${formatBuffNumericValue(effect.type, effect.value)}`
      );
      return [`- **${item.name}**：${item.description || '暂无项描述'}`, ...effectLines];
    });
    return [
      '# Buff 信息',
      `**组名称**：${draft.name}`,
      `**组 ID**：\`${draft.id}\``,
      `**描述**：${draft.description || '-'}`,
      '## 自定义项概览',
      ...(itemLines.length ? itemLines : ['- 暂无自定义项']),
    ].join('\n');
  }, [draft]);

  const updateDraftField = <K extends keyof BuffDraft>(field: K, value: BuffDraft[K]) => {
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
  };

  const updateSelectedItem = (updater: (item: BuffItemDraft) => BuffItemDraft) => {
    if (!selectedItemKey) return;
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: updater(prev.items[selectedItemKey]),
      },
    }));
  };

  const updateSelectedEffect = (updater: (effect: BuffEffectDraft) => BuffEffectDraft) => {
    if (!selectedItemKey || !selectedEffectKey) return;
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
  };

  const updateSelectedEffectKind = (nextKind: BuffEffectKind) => {
    updateSelectedEffect((prev) => ({
      ...prev,
      effectKind: nextKind,
      type: nextKind === 'extraHit' ? '' : prev.type,
      value: nextKind === 'extraHit' ? 0 : prev.value,
      extraHitConfig: nextKind === 'extraHit'
        ? normalizeExtraHitConfig(prev.extraHitConfig)
        : undefined,
    }));
  };

  const handleEffectValueInputChange = (nextValue: string) => {
    setEffectValueInput(nextValue);
    if (nextValue.trim() === '') {
      return;
    }
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    }
  };

  const finalizeEffectValueInput = () => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
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
  };

  const loadDraftIntoEditor = (nextDraft: BuffDraft, message: string) => {
    const normalized = normalizeBuffDraft(cloneValue(nextDraft));
    const firstItemKey = Object.keys(normalized.items)[0] ?? null;
    const firstEffectKey = firstItemKey ? Object.keys(normalized.items[firstItemKey].effects)[0] ?? null : null;
    setDraft(normalized);
    setSelectedItemKey(firstItemKey);
    setSelectedEffectKey(firstEffectKey);
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

  const syncUndoSnapshots = useCallback(() => {
    setUndoSnapshots(readBuffUndoSnapshots());
  }, []);

  const withUndo = useCallback((label: string, fn: () => void) => {
    captureBuffUndoSnapshot(label, {
      selectedDraftId: selectedLocalDraftId || draft.id || undefined,
      draftState: draft,
      selectedItemKey,
      selectedEffectKey,
    });
    fn();
    syncUndoSnapshots();
  }, [draft, selectedEffectKey, selectedItemKey, selectedLocalDraftId, syncUndoSnapshots]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = restoreBuffUndoSnapshot(snapshotId);
    if (!restored) {
      return;
    }

    const nextLibrary = loadLocalBuffLibrary();
    const nextDraftFromStorage = restored.draftState ? normalizeBuffDraft(cloneValue(restored.draftState)) : loadDraftFromStorage();
    const nextSelectedId = restored.selectedDraftId && nextLibrary[restored.selectedDraftId]
      ? restored.selectedDraftId
      : (Object.keys(nextLibrary)[0] ?? nextDraftFromStorage.id);
    const nextDraft = nextSelectedId && nextLibrary[nextSelectedId]
      ? (restored.draftState ? nextDraftFromStorage : normalizeBuffDraft(cloneValue(nextLibrary[nextSelectedId])))
      : nextDraftFromStorage;
    const nextItemKey = restored.selectedItemKey && nextDraft.items[restored.selectedItemKey]
      ? restored.selectedItemKey
      : (Object.keys(nextDraft.items)[0] ?? null);
    const nextEffectKey = nextItemKey
      ? (restored.selectedEffectKey && nextDraft.items[nextItemKey].effects[restored.selectedEffectKey]
        ? restored.selectedEffectKey
        : (Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null))
      : null;

    setLocalDraftIds(Object.keys(nextLibrary));
    setSelectedLocalDraftId(nextSelectedId);
    setDraft(nextDraft);
    setSelectedItemKey(nextItemKey);
    setSelectedEffectKey(nextEffectKey);
    setIsUndoMenuOpen(false);
    syncUndoSnapshots();
    setMessages((prev) => [`[OK] 已撤回：${restored.label}`, ...prev].slice(0, 12));
  }, [syncUndoSnapshots]);

  const handleCreateNewDraft = () => {
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, BuffDraft>) : {};
    const nextDraftId = getNextDraftId(Object.keys(library));
    const nextDraft = createEmptyBuffDraft(nextDraftId);
    setDraft(nextDraft);
    setSelectedItemKey(null);
    setSelectedEffectKey(null);
    setSelectedLocalDraftId(nextDraftId);
    setMessages((prev) => [`[OK] 已新建空组：${nextDraftId}`, ...prev].slice(0, 12));
  };

  const persistDraftToLibrary = (allowOverwrite: boolean) => {
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, BuffDraft>) : {};
    const existingIds = Object.keys(library);
    const nextDraftId = orderedDraft.id.trim() || getNextDraftId(existingIds);
    if (library[nextDraftId] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }
    const nextDraft = {
      ...orderedDraft,
      id: nextDraftId,
    };
    library[nextDraft.id] = nextDraft;
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    if (nextDraft.id !== orderedDraft.id) {
      setDraft(nextDraft);
    }
    setLocalDraftIds((prev) => (prev.includes(nextDraft.id) ? prev : [...prev, nextDraft.id]));
    setSelectedLocalDraftId(nextDraft.id);
    setMessages((prev) => [`[OK] 已保存到本地：${nextDraft.id}`, ...prev].slice(0, 12));
    return true;
  };

  const handleSaveDraft = (options?: { allowOverwriteOnConflict?: boolean }) => {
    persistDraftToLibrary(Boolean(options?.allowOverwriteOnConflict));
  };

  const handleConfirmOverwriteDraft = () => {
    const saved = persistDraftToLibrary(true);
    if (saved) {
      setMessages((prev) => [`[OK] 已覆盖本地 Buff 组：${orderedDraft.id.trim() || '未命名'}`, ...prev].slice(0, 12));
    }
    setIsOverwriteDraftModalOpen(false);
  };

  const handleOpenExportPreview = () => {
    setIsExportPreviewOpen(true);
    setMessages((prev) => ['[OK] 已打开导出 JSON 预览', ...prev].slice(0, 12));
  };

  const handleCopyExportJson = async () => {
    await copyText(JSON.stringify(orderedDraft, null, 2));
    setMessages((prev) => ['[OK] 已复制导出 JSON', ...prev].slice(0, 12));
  };

  const readLocalBuffLibrary = () => {
    if (typeof window === 'undefined') {
      return {} as Record<string, BuffDraft>;
    }

    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, BuffDraft>;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([draftId, value]) => {
          try {
            const normalizedDraft = parseImportedBuffDraft(JSON.stringify(value));
            return [[draftId, normalizedDraft] as const];
          } catch {
            return [];
          }
        })
      );
    } catch {
      return {} as Record<string, BuffDraft>;
    }
  };

  const downloadShareFile = (shareFile: DraftLibraryShareFile<BuffDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setPendingImportShare(null);
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setShareDraftName('');
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportLocalLibraryShare = () => {
    const library = readLocalBuffLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      setMessages((prev) => ['[ERR] 本地没有可分享的 Buff 库数据', ...prev].slice(0, 12));
      return;
    }

    const shareFile = buildDraftLibraryShareFile(BUFF_LIBRARY_SHARE_TYPE, library, shareDraftName);
    downloadShareFile(shareFile);
    setMessages((prev) => [`[OK] 已导出 Buff 分享：${shareFile.label}（${draftCount} 组）`, ...prev].slice(0, 12));
  };

  const handleOpenShareImportPicker = () => {
    shareImportInputRef.current?.click();
  };

  const handleShareFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsedShare = parseDraftLibraryShareFile(rawText, BUFF_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setMessages((prev) => ['[ERR] 导入失败：文件不是有效的 Buff 分享 JSON', ...prev].slice(0, 12));
      event.target.value = '';
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
      })
    ) as Record<string, BuffDraft>;

    if (Object.keys(normalizedPayload).length === 0) {
      setMessages((prev) => ['[ERR] 导入失败：分享文件内没有有效的 Buff 组', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }

    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
    event.target.value = '';
  };

  const handleCancelImportShare = () => {
    setPendingImportShare(null);
  };

  const handleConfirmImportShare = () => {
    if (typeof window === 'undefined' || !pendingImportShare) {
      return;
    }

    const currentLibrary = readLocalBuffLibrary();
    const nextLibrary = {
      ...currentLibrary,
      ...pendingImportShare.payload,
    };
    const nextIds = Object.keys(nextLibrary);
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalDraftIds(nextIds);
    setSelectedLocalDraftId((prev) => prev && nextLibrary[prev] ? prev : (Object.keys(pendingImportShare.payload)[0] ?? nextIds[0] ?? ''));
    setIsShareModalOpen(false);
    setShareDraftName('');
    setPendingImportShare(null);
    setMessages((prev) => [
      `[OK] 已导入 Buff 分享：${pendingImportShare.label}（${Object.keys(pendingImportShare.payload).length} 组）`,
      ...prev,
    ].slice(0, 12));
  };

  const handleImportLocalDraft = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可导入数据', ...prev].slice(0, 12));
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, BuffDraft>;
      const localDraft = parsed[selectedLocalDraftId];
      if (!selectedLocalDraftId || !localDraft) {
        setMessages((prev) => ['[ERR] 未找到所选本地 Buff 草稿', ...prev].slice(0, 12));
        return;
      }
      loadDraftIntoEditor(localDraft, `[OK] 已从本地导入：${localDraft.id}`);
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法导入', ...prev].slice(0, 12));
    }
  };

  const handleSaveAsNewDraft = () => {
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, BuffDraft>) : {};
    const nextDraftId = getNextDraftId(Object.keys(library));
    const nextDraft = {
      ...cloneValue(orderedDraft),
      id: nextDraftId,
    };
    library[nextDraftId] = nextDraft;
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    setDraft(nextDraft);
    setLocalDraftIds(Object.keys(library));
    setSelectedLocalDraftId(nextDraftId);
    setMessages((prev) => [`[OK] 已另存为新组：${nextDraftId}`, ...prev].slice(0, 12));
  };

  const handleDeleteLocalDraft = () => {
    if (!selectedLocalDraftId) {
      setMessages((prev) => ['[ERR] 当前没有选中的本地组', ...prev].slice(0, 12));
      return;
    }
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, BuffDraft>) : {};
    if (!library[selectedLocalDraftId]) {
      setMessages((prev) => ['[ERR] 选中的本地组不存在', ...prev].slice(0, 12));
      return;
    }
    withUndo(`删除本地组 · ${selectedLocalDraftId}`, () => {
      delete library[selectedLocalDraftId];
      window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(library));
      const remainingIds = Object.keys(library);
      const nextSelectedId = remainingIds[0] || '';
      setLocalDraftIds(remainingIds);
      setSelectedLocalDraftId(nextSelectedId);
      if (draft.id === selectedLocalDraftId) {
        const nextDraft = nextSelectedId ? normalizeBuffDraft(cloneValue(library[nextSelectedId])) : createEmptyBuffDraft(getNextDraftId(remainingIds));
        const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
        const nextEffectKey = nextItemKey ? Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null : null;
        setDraft(nextDraft);
        setSelectedItemKey(nextItemKey);
        setSelectedEffectKey(nextEffectKey);
        window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
      }
      setMessages((prev) => [`[OK] 已删除本地组：${selectedLocalDraftId}`, ...prev].slice(0, 12));
    });
  };

  const clearDragTimer = () => {
    if (dragTimerRef.current !== null) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const beginDragPress = (kind: 'item' | 'effect', key: string) => {
    clearDragTimer();
    dragTimerRef.current = window.setTimeout(() => {
      setDragReadyTarget({ kind, key });
    }, 220);
  };

  const endDragPress = () => {
    clearDragTimer();
  };

  const handleItemDrop = (targetKey: string) => {
    if (!dragReadyTarget || dragReadyTarget.kind !== 'item' || !draft.items[dragReadyTarget.key]) {
      setDragOverTarget(null);
      setDragReadyTarget(null);
      return;
    }
    const nextItems = moveRecordEntry(draft.items, dragReadyTarget.key, targetKey);
    setDraft((prev) => ({ ...prev, items: nextItems }));
    setSelectedItemKey(dragReadyTarget.key);
    setDragOverTarget(null);
    setDragReadyTarget(null);
    setMessages((prev) => [`[OK] 已调整自定义项顺序：${dragReadyTarget.key} -> ${targetKey}`, ...prev].slice(0, 12));
  };

  const handleEffectDrop = (targetKey: string) => {
    if (!dragReadyTarget || dragReadyTarget.kind !== 'effect' || !selectedItemKey || !selectedItem?.effects[dragReadyTarget.key]) {
      setDragOverTarget(null);
      setDragReadyTarget(null);
      return;
    }
    const nextEffects = moveRecordEntry(selectedItem.effects, dragReadyTarget.key, targetKey);
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: {
          ...prev.items[selectedItemKey],
          effects: nextEffects,
        },
      },
    }));
    setSelectedEffectKey(dragReadyTarget.key);
    setDragOverTarget(null);
    setDragReadyTarget(null);
    setMessages((prev) => [`[OK] 已调整 Buff 效果顺序：${dragReadyTarget.key} -> ${targetKey}`, ...prev].slice(0, 12));
  };

  const handleNormalizeDraft = () => {
    const nextDraft = reorderDraftStructure(cloneValue(draft));
    const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
    const nextEffectKey = nextItemKey ? Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null : null;
    setDraft(nextDraft);
    setSelectedItemKey(nextItemKey);
    setSelectedEffectKey(nextEffectKey);
    setMessages((prev) => ['[OK] 已整理当前组的项 ID 与 Buff 效果 ID', ...prev].slice(0, 12));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      handleSaveDraft({
        allowOverwriteOnConflict: !isOverwriteProtectionEnabled,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearDragTimer();
    };
  }, [orderedDraft, isOverwriteProtectionEnabled]);

  const handleAddItem = () => {
    const nextItemKey = getNextItemKey(draft);
    const nextItem = createDefaultBuffItem(nextItemKey, draft.sourceName || draft.name);
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [nextItemKey]: nextItem,
      },
    }));
    setSelectedItemKey(nextItemKey);
    setSelectedEffectKey('buff-1');
    setMessages((prev) => [`[OK] 已新增自定义项：${nextItem.name}`, ...prev].slice(0, 12));
  };

  const duplicateSelectedItem = () => {
    if (!selectedItemKey || !selectedItem) {
      setMessages((prev) => ['[ERR] 当前没有可复制的自定义项', ...prev].slice(0, 12));
      return;
    }
    const nextItemKey = getNextItemKey(draft);
    const duplicated = cloneValue(selectedItem);
    duplicated.id = nextItemKey;
    duplicated.name = `${selectedItem.name}（副本）`;
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [nextItemKey]: duplicated,
      },
    }));
    setSelectedItemKey(nextItemKey);
    setSelectedEffectKey(Object.keys(duplicated.effects)[0] ?? null);
    setMessages((prev) => [`[OK] 已复制自定义项：${selectedItemKey} -> ${nextItemKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveItem = () => {
    if (!selectedItemKey || !draft.items[selectedItemKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的自定义项', ...prev].slice(0, 12));
      return;
    }
    withUndo(`删除自定义项 · ${selectedItemKey}`, () => {
      const nextDraft = cloneValue(draft);
      delete nextDraft.items[selectedItemKey];
      const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
      const nextEffectKey = nextItemKey ? Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null : null;
      setDraft(nextDraft);
      setSelectedItemKey(nextItemKey);
      setSelectedEffectKey(nextEffectKey);
      setMessages((prev) => [`[OK] 已删除自定义项：${selectedItemKey}`, ...prev].slice(0, 12));
    });
  };

  const handleAddEffect = () => {
    if (!selectedItemKey || !selectedItem) {
      setMessages((prev) => ['[ERR] 当前没有可新增 Buff 效果的自定义项', ...prev].slice(0, 12));
      return;
    }
    const nextEffectKey = getNextEffectKey(selectedItem);
    const nextEffect = createDefaultBuffEffect(nextEffectKey, selectedItem.sourceName || draft.sourceName);
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: {
          ...prev.items[selectedItemKey],
          effects: {
            ...prev.items[selectedItemKey].effects,
            [nextEffectKey]: nextEffect,
          },
        },
      },
    }));
    setSelectedEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已新增 Buff 效果：${nextEffect.displayName}`, ...prev].slice(0, 12));
  };

  const duplicateSelectedEffect = () => {
    if (!selectedItemKey || !selectedItem || !selectedEffectKey || !selectedEffect) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 Buff 效果', ...prev].slice(0, 12));
      return;
    }
    const nextEffectKey = getNextEffectKey(selectedItem);
    const duplicated = cloneValue(selectedEffect);
    duplicated.id = nextEffectKey;
    duplicated.displayName = `${selectedEffect.displayName}（副本）`;
    duplicated.name = `${createDefaultBuffName(nextEffectKey)}_copy`;
    setDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [selectedItemKey]: {
          ...prev.items[selectedItemKey],
          effects: {
            ...prev.items[selectedItemKey].effects,
            [nextEffectKey]: duplicated,
          },
        },
      },
    }));
    setSelectedEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已复制 Buff 效果：${selectedEffectKey} -> ${nextEffectKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveEffect = () => {
    if (!selectedItemKey || !selectedItem || !selectedEffectKey || !selectedItem.effects[selectedEffectKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 Buff 效果', ...prev].slice(0, 12));
      return;
    }
    withUndo(`删除 Buff 效果 · ${selectedEffectKey}`, () => {
      const nextDraft = cloneValue(draft);
      delete nextDraft.items[selectedItemKey].effects[selectedEffectKey];
      const nextEffectKey = Object.keys(nextDraft.items[selectedItemKey].effects)[0] ?? null;
      setDraft(nextDraft);
      setSelectedEffectKey(nextEffectKey);
      setMessages((prev) => [`[OK] 已删除 Buff 效果：${selectedEffectKey}`, ...prev].slice(0, 12));
    });
  };

  const handleOpenOperatorDraftPage = () => {
    if (typeof window === 'undefined') {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.draft);
  };

  const handleOpenWorkbenchPage = () => {
    if (typeof window === 'undefined') {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.home);
  };

  const handleOpenBuffSheetPage = () => {
    if (typeof window === 'undefined') {
      return;
    }
    navigateToAppPath(APP_ROUTE_PATHS.buffSheet);
  };

  useEffect(() => {
    syncUndoSnapshots();
  }, [syncUndoSnapshots]);

  return (
    <main className="operator-draft-page buff-draft-page">
      <section className="operator-draft-shell">
        <section className="operator-draft-preview-panel">
          <div className="operator-draft-workbench">
            <div className="operator-draft-column operator-draft-column-cli">
              <section className="operator-draft-command-panel">
                <div className="operator-draft-panel-header">
                  <p className="operator-draft-eyebrow">Draft</p>
                  <h1>本地 Buff 编辑器</h1>
                  <p className="operator-draft-subtitle">当前草稿 = 一组 Buff；左侧维护自定义项；每个自定义项内再维护多条 Buff 效果。</p>
                </div>

                <div className="operator-draft-command-box">
                  <div className="operator-draft-command-actions">
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenExportPreview}>
                      导出 JSON
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      分享库
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenBuffSheetPage}>
                      Sheet-Buff
                    </button>
                  </div>

                  <div className="operator-draft-reference-box">
                    <label>
                      <span>本地 Buff 组</span>
                      <select value={selectedLocalDraftId} onChange={(event) => setSelectedLocalDraftId(event.target.value)}>
                        <option value="">选择本地组</option>
                        {localDraftIds.map((draftId) => (
                          <option key={draftId} value={draftId}>
                            {draftId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="operator-draft-command-actions">
                      <button type="button" className="operator-draft-ghost-button" onClick={handleImportLocalDraft}>
                        载入所选组
                      </button>
                      <button type="button" className="operator-draft-ghost-button" onClick={handleDeleteLocalDraft}>
                        删除本地组
                      </button>
                    </div>
                  </div>

                  <div className="operator-draft-reference-box">
                    <label>
                      <span>分享导入</span>
                      <input value="点击打开分享弹窗" readOnly />
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      打开分享弹窗
                    </button>
                  </div>
                </div>
              </section>

              <section className="operator-draft-markdown-panel">
                <div className="operator-draft-section-header">
                  <h3>说明预览</h3>
                </div>
                <div className="operator-draft-markdown-body">{renderMiniMarkdown(markdown)}</div>
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-left">
              <section className="operator-draft-basic-panel">
                <div className="operator-draft-section-header">
                  <h3>基础信息</h3>
                  <div className="operator-draft-section-actions">
                    <button
                      type="button"
                      className="operator-draft-ghost-button"
                      onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
                    >
                      {isOverwriteProtectionEnabled ? '保护开' : '保护关'}
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleNormalizeDraft}>整理</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleCreateNewDraft}>新建</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleSaveAsNewDraft}>另存为</button>
                    <button
                      type="button"
                      className="operator-draft-ghost-button"
                      onClick={() => handleSaveDraft({ allowOverwriteOnConflict: !isOverwriteProtectionEnabled })}
                    >
                      保存到本地
                    </button>
                  </div>
                </div>
                <div className="operator-draft-basic-grid">
                  <div className="operator-draft-avatar-wrap operator-draft-avatar-wrap-dense">
                    <div className="operator-draft-avatar operator-draft-avatar-fallback">B</div>
                  </div>
                  <label>
                    <span>组名称</span>
                    <input value={draft.name} onChange={(event) => updateDraftField('name', event.target.value)} />
                  </label>
                  <label>
                    <span>组 ID</span>
                    <input value={draft.id} onChange={(event) => updateDraftField('id', event.target.value)} />
                  </label>
                  <label className="is-wide">
                    <span>描述</span>
                    <input value={draft.description} onChange={(event) => updateDraftField('description', event.target.value)} />
                  </label>
                </div>
              </section>

              <section className="operator-draft-skill-list">
                <div className="operator-draft-section-header">
                  <h3>自定义项列表</h3>
                  <div className="operator-draft-section-actions">
                    <button type="button" className="operator-draft-ghost-button" onClick={handleAddItem}>新增</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={duplicateSelectedItem}>复制</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveItem}>删除</button>
                  </div>
                </div>
                {itemEntries.map(([itemKey, item]) => (
                  <button
                    key={itemKey}
                    type="button"
                    className={`operator-draft-skill-item${selectedItemKey === itemKey ? ' is-active' : ''}${dragReadyTarget?.kind === 'item' && dragReadyTarget.key === itemKey ? ' is-dragging' : ''}${dragOverTarget?.kind === 'item' && dragOverTarget.key === itemKey ? ' is-drag-over' : ''}`}
                    draggable={dragReadyTarget?.kind === 'item' && dragReadyTarget.key === itemKey}
                    onClick={() => {
                      setSelectedItemKey(itemKey);
                      setSelectedEffectKey(Object.keys(item.effects)[0] ?? null);
                    }}
                    onMouseDown={() => beginDragPress('item', itemKey)}
                    onMouseUp={endDragPress}
                    onMouseLeave={endDragPress}
                    onDragStart={(event) => {
                      if (!(dragReadyTarget?.kind === 'item' && dragReadyTarget.key === itemKey)) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      if (dragReadyTarget?.kind !== 'item') return;
                      event.preventDefault();
                      setDragOverTarget({ kind: 'item', key: itemKey });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleItemDrop(itemKey);
                    }}
                    onDragEnd={() => {
                      setDragReadyTarget(null);
                      setDragOverTarget(null);
                    }}
                  >
                    <div className="operator-draft-skill-icon-wrap">
                      <div className="operator-draft-skill-icon operator-draft-skill-icon-fallback">I</div>
                    </div>
                    <div className="operator-draft-skill-meta">
                      <strong>{item.name}</strong>
                      <span>{`${item.id} / ${Object.keys(item.effects).length} 个效果`}</span>
                    </div>
                  </button>
                ))}
                {!itemEntries.length ? <p className="operator-draft-empty">当前没有自定义项。</p> : null}
              </section>

              <section className="operator-draft-skill-list buff-draft-effect-list">
                <div className="operator-draft-section-header">
                  <h3>Buff 效果列表</h3>
                  <div className="operator-draft-section-actions">
                    <button type="button" className="operator-draft-ghost-button" onClick={handleAddEffect}>新增</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={duplicateSelectedEffect}>复制</button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveEffect}>删除</button>
                  </div>
                </div>
                {effectEntries.map(([effectKey, effect]) => (
                  <button
                    key={effectKey}
                    type="button"
                    className={`operator-draft-skill-item${selectedEffectKey === effectKey ? ' is-active' : ''}${dragReadyTarget?.kind === 'effect' && dragReadyTarget.key === effectKey ? ' is-dragging' : ''}${dragOverTarget?.kind === 'effect' && dragOverTarget.key === effectKey ? ' is-drag-over' : ''}`}
                    draggable={dragReadyTarget?.kind === 'effect' && dragReadyTarget.key === effectKey}
                    onClick={() => setSelectedEffectKey(effectKey)}
                    onMouseDown={() => beginDragPress('effect', effectKey)}
                    onMouseUp={endDragPress}
                    onMouseLeave={endDragPress}
                    onDragStart={(event) => {
                      if (!(dragReadyTarget?.kind === 'effect' && dragReadyTarget.key === effectKey)) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      if (dragReadyTarget?.kind !== 'effect') return;
                      event.preventDefault();
                      setDragOverTarget({ kind: 'effect', key: effectKey });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleEffectDrop(effectKey);
                    }}
                    onDragEnd={() => {
                      setDragReadyTarget(null);
                      setDragOverTarget(null);
                    }}
                  >
                    <div className="operator-draft-skill-icon-wrap">
                      <div className="operator-draft-skill-icon operator-draft-skill-icon-fallback">B</div>
                    </div>
                    <div className="operator-draft-skill-meta">
                      <strong>{effect.displayName || effectKey}</strong>
                      <span>{effect.effectKind === 'extraHit'
                        ? `${effect.id} / 额外伤害段 / ${effect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}x`
                        : `${effect.id} / ${getBuffTypeDisplayLabel(effect.type)} / ${formatBuffNumericValue(effect.type, effect.value)}`}</span>
                    </div>
                  </button>
                ))}
                {!effectEntries.length ? <p className="operator-draft-empty">当前自定义项下没有 Buff 效果。</p> : null}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-main">
              <section className="operator-draft-skill-detail">
                <div className="operator-draft-section-header">
                  <h3>自定义项详情</h3>
                </div>
                {selectedItem ? (
                  <div className="operator-draft-skill-hero">
                    <div className="operator-draft-skill-hero-icon operator-draft-skill-icon-fallback">I</div>
                    <div className="operator-draft-skill-form">
                      <label>
                        <span>项名称</span>
                        <input value={selectedItem.name} onChange={(event) => updateSelectedItem((prev) => ({ ...prev, name: event.target.value }))} />
                      </label>
                      <label className="is-wide">
                        <span>项描述</span>
                        <input value={selectedItem.description} onChange={(event) => updateSelectedItem((prev) => ({ ...prev, description: event.target.value }))} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有可预览的自定义项。</p>
                )}
              </section>

              <section className="operator-draft-skill-detail">
                <div className="operator-draft-section-header">
                  <h3>Buff 效果详情</h3>
                </div>
                {selectedEffect ? (
                  <div className="operator-draft-skill-hero">
                    <div className="operator-draft-skill-hero-icon operator-draft-skill-icon-fallback">B</div>
                    <div className="operator-draft-skill-form">
                      <label>
                        <span>效果名称</span>
                        <input value={selectedEffect.displayName} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, displayName: event.target.value }))} />
                      </label>
                      <label>
                        <span>效果类型</span>
                        <select
                          value={selectedEffect.effectKind || 'modifier'}
                          onChange={(event) => updateSelectedEffectKind(event.target.value as BuffEffectKind)}
                        >
                          {BUFF_EFFECT_KIND_OPTIONS.map((option) => (
                            <option key={option} value={option}>{getEffectKindLabel(option)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>类型</span>
                        <div className="buff-draft-type-picker">
                          <input
                            value={buffTypeQuery}
                            onChange={(event) => setBuffTypeQuery(event.target.value)}
                            placeholder="搜索类型：法术 / 异伤 / 倍率 / 源石技艺"
                            disabled={selectedEffect.effectKind === 'extraHit'}
                          />
                          <select
                            value={selectedEffect.type || ''}
                            onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, type: event.target.value }))}
                            disabled={selectedEffect.effectKind === 'extraHit'}
                          >
                            <option value="">暂无</option>
                            {filteredBuffTypeOptions.map((option) => (
                              <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
                            ))}
                          </select>
                        </div>
                      </label>
                      <label>
                        <span>数值</span>
                        <div className="buff-draft-value-editor">
                          <input
                            type="number"
                            value={selectedEffect.effectKind === 'extraHit' ? 0 : effectValueInput}
                            onChange={(event) => handleEffectValueInputChange(event.target.value)}
                            onBlur={finalizeEffectValueInput}
                            disabled={selectedEffect.effectKind === 'extraHit'}
                          />
                          <small>
                            {selectedEffect.effectKind === 'extraHit'
                              ? '额外伤害段不走普通 modifier 数值，这里保持 0。'
                              : getBuffValueHint(selectedEffect.type, selectedEffect.value)}
                          </small>
                        </div>
                      </label>
                      {selectedEffect.effectKind === 'extraHit' && (
                        <div className="buff-draft-extra-hit-grid is-wide">
                          <label>
                            <span>额外段 Key</span>
                            <input
                              value={selectedEffect.extraHitConfig?.key || DEFAULT_EXTRA_HIT_CONFIG.key}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  key: event.target.value,
                                }),
                              }))}
                            />
                          </label>
                          <label>
                            <span>伤害类型</span>
                            <select
                              value={selectedEffect.extraHitConfig?.damageType || DEFAULT_EXTRA_HIT_CONFIG.damageType}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  damageType: event.target.value as BuffExtraHitConfig['damageType'],
                                }),
                              }))}
                            >
                              <option value="physical">物理</option>
                              <option value="magic">法术</option>
                              <option value="fire">灼热</option>
                              <option value="electric">电磁</option>
                              <option value="ice">寒冷</option>
                              <option value="nature">自然</option>
                            </select>
                          </label>
                          <label>
                            <span>基础倍率</span>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEffect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  baseMultiplier: Number(event.target.value) || DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier,
                                }),
                              }))}
                            />
                          </label>
                          <label>
                            <span>失衡值</span>
                            <input
                              type="number"
                              value={selectedEffect.extraHitConfig?.imbalanceValue ?? DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  imbalanceValue: Number(event.target.value) || DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue,
                                }),
                              }))}
                            />
                          </label>
                          <label>
                            <span>冷却秒数</span>
                            <input
                              type="number"
                              value={selectedEffect.extraHitConfig?.cooldownSeconds ?? DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  cooldownSeconds: Number(event.target.value) || DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds,
                                }),
                              }))}
                            />
                          </label>
                          <label>
                            <span>触发条件</span>
                            <select
                              value={selectedEffect.extraHitConfig?.trigger || DEFAULT_EXTRA_HIT_CONFIG.trigger}
                              onChange={(event) => updateSelectedEffect((prev) => ({
                                ...prev,
                                extraHitConfig: normalizeExtraHitConfig({
                                  ...prev.extraHitConfig,
                                  trigger: event.target.value as BuffExtraHitConfig['trigger'],
                                }),
                              }))}
                            >
                              <option value="physicalAbnormal">物理异常后触发</option>
                            </select>
                          </label>
                        </div>
                      )}
                      <label className="is-wide">
                        <span>触发条件</span>
                        <input value={selectedEffect.condition || ''} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, condition: event.target.value }))} />
                      </label>
                      <label className="is-wide">
                        <span>描述</span>
                        <input value={selectedEffect.description} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, description: event.target.value }))} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有选中的 Buff 效果。</p>
                )}
              </section>

            </div>

            <div className="operator-draft-column operator-draft-column-right">
              <section className="operator-draft-hit-detail">
                <div className="operator-draft-section-header">
                  <h3>字段速览</h3>
                </div>
                {selectedItem && selectedEffect ? (
                  <div className="buff-draft-quick-text">
                    <p><strong>组名称</strong>：{draft.name}</p>
                    <p><strong>自定义项</strong>：{selectedItem.name}</p>
                    <p><strong>效果名称</strong>：{selectedEffect.displayName}</p>
                    <p><strong>效果类型</strong>：{getEffectKindLabel(selectedEffect.effectKind)}</p>
                    <p><strong>类型</strong>：{selectedEffect.effectKind === 'extraHit' ? '额外伤害段' : (selectedEffect.type ? getBuffTypeDisplayLabel(selectedEffect.type) : '暂无')}</p>
                    <p><strong>数值</strong>：{selectedEffect.effectKind === 'extraHit' ? '-' : formatBuffNumericValue(selectedEffect.type, selectedEffect.value)}</p>
                    {selectedEffect.effectKind === 'extraHit' && (
                      <>
                        <p><strong>额外段</strong>：{selectedEffect.extraHitConfig?.key || DEFAULT_EXTRA_HIT_CONFIG.key}</p>
                        <p><strong>基础倍率</strong>：{selectedEffect.extraHitConfig?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier}x</p>
                        <p><strong>伤害类型</strong>：{selectedEffect.extraHitConfig?.damageType || DEFAULT_EXTRA_HIT_CONFIG.damageType}</p>
                        <p><strong>失衡值</strong>：{selectedEffect.extraHitConfig?.imbalanceValue ?? DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue}</p>
                        <p><strong>冷却</strong>：{selectedEffect.extraHitConfig?.cooldownSeconds ?? DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds}s</p>
                      </>
                    )}
                    <p><strong>触发条件</strong>：{selectedEffect.condition || '-'}</p>
                    <p><strong>描述</strong>：{selectedEffect.description || '-'}</p>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有选中的 Buff 效果。</p>
                )}
              </section>

              <section className="operator-draft-history operator-draft-history-side">
                <div className="operator-draft-section-header">
                  <h3>操作记录</h3>
                  <div className="operator-draft-section-actions">
                    <div className="buff-draft-undo-wrap">
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => setIsUndoMenuOpen((open) => !open)}
                        disabled={undoSnapshots.length === 0}
                      >
                        撤回
                      </button>
                      {isUndoMenuOpen && undoSnapshots.length > 0 ? (
                        <div className="buff-draft-undo-menu">
                          {undoSnapshots.map((snapshot) => (
                            <button
                              key={snapshot.id}
                              type="button"
                              className="buff-draft-undo-item"
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
                  </div>
                </div>
                <ul>
                  {messages.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
                <div className="operator-draft-history-footer">
                  <button type="button" className="operator-draft-ghost-button" onClick={handleOpenWorkbenchPage}>
                    主界面
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleOpenOperatorDraftPage}>
                    编辑干员
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleOpenBuffSheetPage}>
                    表格化
                  </button>
                  <button type="button" className="operator-draft-ghost-button is-active">
                    编辑BUFF
                  </button>
                </div>
              </section>
            </div>
          </div>
        </section>
      </section>

      {isExportPreviewOpen ? (
        <div className="buff-draft-modal-mask" onClick={() => setIsExportPreviewOpen(false)}>
          <section className="buff-draft-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>导出 JSON 预览</h3>
              <div className="operator-draft-section-actions">
                <button type="button" className="operator-draft-copy-button" onClick={handleCopyExportJson}>
                  复制
                </button>
                <button type="button" className="operator-draft-ghost-button" onClick={() => setIsExportPreviewOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <pre className="operator-draft-json buff-draft-modal-json">{draftJson}</pre>
          </section>
        </div>
      ) : null}
      {isShareModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={handleCloseShareModal}>
          <div className="operator-draft-modal operator-draft-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>Buff 库分享</h3>
              <span>导出 / 导入本地库</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`当前本地 Buff 库共有 ${localDraftIds.length} 个分组。`}</p>
              <p>导出会打包整个本地 Buff 库；导入会把分享文件中的分组合并回本地库，并覆盖同 ID 分组。</p>
            </div>
            <label className="operator-draft-share-label">
              <span>分享文件名</span>
              <input
                value={shareDraftName}
                onChange={(event) => setShareDraftName(event.target.value)}
                placeholder="留空则默认使用未命名"
              />
            </label>
            <input
              ref={shareImportInputRef}
              type="file"
              accept=".json,application/json"
              className="operator-draft-file-input"
              onChange={handleShareFileSelected}
            />
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleExportLocalLibraryShare}>
                一键导出 JSON
              </button>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCloseShareModal}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingImportShare ? (
        <div className="operator-draft-modal-overlay" onClick={handleCancelImportShare}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>确认导入 Buff 分享</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`即将导入分享「${pendingImportShare.label}」。`}</p>
              <p>{`本次会写入 ${Object.keys(pendingImportShare.payload).length} 个 Buff 分组，并覆盖本地同 ID 记录。`}</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCancelImportShare}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>覆盖本地 Buff 组</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`本地库中已存在 ID 为「${orderedDraft.id.trim() || '未命名'}」的 Buff 组。`}</p>
              <p>保护开启时，确认后会用当前编辑器内容覆盖本地同 ID Buff 组。</p>
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
    </main>
  );
}

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
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<BuffWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [effectValueInput, setEffectValueInput] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalMode, setShareModalMode] = useState<'export' | 'import'>('export');
  const [shareImportText, setShareImportText] = useState('');
  const [shareImportError, setShareImportError] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<BuffDraft> | null>(null);
  const [contextMenu, setContextMenu] = useState<BuffSheetContextMenuState | null>(null);
  const [dragState, setDragState] = useState<BuffExplorerDragState | null>(null);
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
    const nextLibrary = {
      ...loadLocalBuffLibrary(),
      ...pendingImportShare.payload,
    };
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
  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    if (!keyword) {
      return BUFF_TYPE_OPTIONS;
    }
    return BUFF_TYPE_OPTIONS.filter((option) => {
      const meta = BUFF_TYPE_LABELS[option];
      const haystack = [option, meta.label, ...meta.keywords].join('|').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [buffTypeQuery]);

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

  const handleOpenWorkbenchPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.home);
  };

  const handleOpenBuffEditorPage = () => {
    navigateToAppPath(APP_ROUTE_PATHS.buffDraft);
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

  useEffect(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
      setEffectValueInput('');
      return;
    }
    setEffectValueInput(String(selectedEffect.value ?? 0));
  }, [selectedEffect?.effectKind, selectedEffect?.id, selectedEffect?.value]);

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

  const updateSelectedEffectKind = useCallback((nextKind: BuffEffectKind) => {
    updateSelectedEffect((prev) => ({
      ...prev,
      effectKind: nextKind,
      type: nextKind === 'extraHit' ? '' : prev.type,
      value: nextKind === 'extraHit' ? 0 : prev.value,
      extraHitConfig: nextKind === 'extraHit'
        ? normalizeExtraHitConfig(prev.extraHitConfig)
        : undefined,
    }));
  }, [updateSelectedEffect]);

  const handleEffectValueInputChange = useCallback((nextValue: string) => {
    setEffectValueInput(nextValue);
    if (nextValue.trim() === '') {
      return;
    }
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      updateSelectedEffect((prev) => ({ ...prev, value: parsed }));
    }
  }, [updateSelectedEffect]);

  const finalizeEffectValueInput = useCallback(() => {
    if (!selectedEffect || selectedEffect.effectKind === 'extraHit') {
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

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean, focusRowKey?: string | null) => {
    const library = loadLocalBuffLibrary();
    const existingIds = Object.keys(library);
    const nextDraftId = draft.id.trim() || getNextDraftId(existingIds);
    if (library[nextDraftId] && nextDraftId !== selectedLocalDraftId && !allowOverwrite) {
      return false;
    }
    const nextDraft = {
      ...draft,
      id: nextDraftId,
    };
    const nextLibrary = {
      ...library,
      [nextDraftId]: nextDraft,
    };
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    setDraft(nextDraft);
    setLocalLibrary(nextLibrary);
    setSelectedLocalDraftId(nextDraftId);
    setPendingFocusRowKey(focusRowKey ?? `group-${nextDraftId}`);
    return true;
  }, [draft, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    const formulaField = activeElement instanceof HTMLElement
      ? activeElement.closest<HTMLElement>('[data-formula-focus-id]')
      : null;
    if (formulaField && formulaBarRef.current?.contains(formulaField)) {
      const selectionCapable = formulaField as HTMLInputElement;
      pendingFormulaFocusRef.current = {
        focusId: formulaField.dataset.formulaFocusId || '',
        selectionStart: typeof selectionCapable.selectionStart === 'number' ? selectionCapable.selectionStart : null,
        selectionEnd: typeof selectionCapable.selectionEnd === 'number' ? selectionCapable.selectionEnd : null,
      };
      setFormulaFocusRestoreToken((prev) => prev + 1);
    }
    persistDraftToLibrary(!isOverwriteProtectionEnabled, selectedWorkbookCell?.sourceRowKey ?? null);
  }, [isOverwriteProtectionEnabled, persistDraftToLibrary, selectedWorkbookCell]);

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
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalLibrary(nextLibrary);
    if (nextSelectedId) {
      setSelectedLocalDraftId(nextSelectedId);
      if (nextLibrary[nextSelectedId]) {
        setDraft(nextLibrary[nextSelectedId]);
        window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextLibrary[nextSelectedId]));
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
      window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
      setLocalLibrary(nextLibrary);
      setSelectedLocalDraftId(nextSelectedId);
      if (nextSelectedId && nextLibrary[nextSelectedId]) {
        setDraft(nextLibrary[nextSelectedId]);
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

    if (selectedWorkbookSummary.kind === 'group') {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="group-id" className="buff-sheet-formula-input" value={draft.id} onChange={(event) => updateDraftField('id', event.target.value)} placeholder="组 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="group-description" className="buff-sheet-formula-input" value={draft.description} onChange={(event) => updateDraftField('description', event.target.value)} placeholder="组描述" />;
      }
      return <input data-formula-focus-id="group-name" className="buff-sheet-formula-input" value={draft.name} onChange={(event) => updateDraftField('name', event.target.value)} placeholder="组名称" />;
    }

    if (selectedWorkbookSummary.kind === 'item' && selectedItem) {
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return <input data-formula-focus-id="item-id" className="buff-sheet-formula-input" value={selectedItem.id} onChange={(event) => updateSelectedItem((prev) => ({ ...prev, id: event.target.value }))} placeholder="项 ID" />;
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return <input data-formula-focus-id="item-description" className="buff-sheet-formula-input" value={selectedItem.description} onChange={(event) => updateSelectedItem((prev) => ({ ...prev, description: event.target.value }))} placeholder="项描述" />;
      }
      return <input data-formula-focus-id="item-name" className="buff-sheet-formula-input" value={selectedItem.name} onChange={(event) => updateSelectedItem((prev) => ({ ...prev, name: event.target.value }))} placeholder="项名称" />;
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
                onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, type: event.target.value }))}
                disabled={selectedEffect.effectKind === 'extraHit'}
              >
                <option value="">暂无类型</option>
                {filteredBuffTypeOptions.map((option) => (
                  <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
                ))}
              </select>
            </div>
          );
        case 'valueText':
          return (
            <input
              data-formula-focus-id="effect-value"
              className="buff-sheet-formula-input"
              type="number"
              value={selectedEffect.effectKind === 'extraHit' ? 0 : effectValueInput}
              onChange={(event) => handleEffectValueInputChange(event.target.value)}
              onBlur={finalizeEffectValueInput}
              disabled={selectedEffect.effectKind === 'extraHit'}
              placeholder="数值"
            />
          );
        case 'condition':
          return <input data-formula-focus-id="effect-condition" className="buff-sheet-formula-input" value={selectedEffect.condition || ''} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, condition: event.target.value }))} placeholder="条件" />;
        case 'description':
          return <input data-formula-focus-id="effect-description" className="buff-sheet-formula-input" value={selectedEffect.description || ''} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, description: event.target.value }))} placeholder="描述" />;
        default:
          return <input data-formula-focus-id="effect-display-name" className="buff-sheet-formula-input" value={selectedEffect.displayName} onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="效果名称" />;
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

      <main className="damage-sheet-workspace">
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
