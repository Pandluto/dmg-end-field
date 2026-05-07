import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

const BUFF_DRAFT_PAGE_PATH = '/buff-draft';
const BUFF_DRAFT_STORAGE_KEY = 'def.buff-editor.draft.v1';
const BUFF_LIBRARY_STORAGE_KEY = 'def.buff-editor.library.v1';
const BUFF_LIBRARY_SHARE_TYPE = 'buff-library-share.v1';

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

export { isBuffDraftPath };

export function BuffDraftPage() {
  const [draft, setDraft] = useState<BuffDraft>(() => loadDraftFromStorage());
  const [localDraftIds, setLocalDraftIds] = useState<string[]>([]);
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [messages, setMessages] = useState<string[]>(['已进入本地 Buff 编辑器']);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [selectedEffectKey, setSelectedEffectKey] = useState<string | null>(null);
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [isExportPreviewOpen, setIsExportPreviewOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [shareDraftName, setShareDraftName] = useState('');
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

  const loadDraftIntoEditor = (nextDraft: BuffDraft, message: string) => {
    const normalized = normalizeBuffDraft(cloneValue(nextDraft));
    const firstItemKey = Object.keys(normalized.items)[0] ?? null;
    const firstEffectKey = firstItemKey ? Object.keys(normalized.items[firstItemKey].effects)[0] ?? null : null;
    setDraft(normalized);
    setSelectedItemKey(firstItemKey);
    setSelectedEffectKey(firstEffectKey);
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

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
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`确认删除本地组「${selectedLocalDraftId}」吗？该操作不会自动清空当前编辑器内容。`)
    ) {
      setMessages((prev) => [`[OK] 已取消删除本地组：${selectedLocalDraftId}`, ...prev].slice(0, 12));
      return;
    }
    const raw = window.localStorage.getItem(BUFF_LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, BuffDraft>) : {};
    if (!library[selectedLocalDraftId]) {
      setMessages((prev) => ['[ERR] 选中的本地组不存在', ...prev].slice(0, 12));
      return;
    }
    delete library[selectedLocalDraftId];
    window.localStorage.setItem(BUFF_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    const remainingIds = Object.keys(library);
    const nextSelectedId = remainingIds[0] || '';
    setLocalDraftIds(remainingIds);
    setSelectedLocalDraftId(nextSelectedId);
    if (draft.id === selectedLocalDraftId) {
      const nextDraft = nextSelectedId ? normalizeBuffDraft(cloneValue(library[nextSelectedId])) : createEmptyBuffDraft(getNextDraftId(remainingIds));
      setDraft(nextDraft);
      setSelectedItemKey(Object.keys(nextDraft.items)[0] ?? null);
      setSelectedEffectKey(
        Object.keys(nextDraft.items)[0] ? Object.keys(nextDraft.items[Object.keys(nextDraft.items)[0]].effects)[0] ?? null : null
      );
      window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    }
    setMessages((prev) => [`[OK] 已删除本地组：${selectedLocalDraftId}`, ...prev].slice(0, 12));
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
    if (typeof window !== 'undefined' && !window.confirm(`确认删除自定义项「${selectedItemKey}」吗？`)) {
      setMessages((prev) => [`[OK] 已取消删除自定义项：${selectedItemKey}`, ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneValue(draft);
    delete nextDraft.items[selectedItemKey];
    const nextItemKey = Object.keys(nextDraft.items)[0] ?? null;
    const nextEffectKey = nextItemKey ? Object.keys(nextDraft.items[nextItemKey].effects)[0] ?? null : null;
    setDraft(nextDraft);
    setSelectedItemKey(nextItemKey);
    setSelectedEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已删除自定义项：${selectedItemKey}`, ...prev].slice(0, 12));
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
    if (typeof window !== 'undefined' && !window.confirm(`确认删除 Buff 效果「${selectedEffectKey}」吗？`)) {
      setMessages((prev) => [`[OK] 已取消删除 Buff 效果：${selectedEffectKey}`, ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneValue(draft);
    delete nextDraft.items[selectedItemKey].effects[selectedEffectKey];
    const nextEffectKey = Object.keys(nextDraft.items[selectedItemKey].effects)[0] ?? null;
    setDraft(nextDraft);
    setSelectedEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已删除 Buff 效果：${selectedEffectKey}`, ...prev].slice(0, 12));
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
                            value={selectedEffect.value ?? 0}
                            onChange={(event) => updateSelectedEffect((prev) => ({ ...prev, value: Number(event.target.value) || 0 }))}
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

