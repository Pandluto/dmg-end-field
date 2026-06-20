import type { BuffExtraHitConfig, BuffMultiplier, CandidateBuff } from '../../core/domain/buff';
import { calculateBuffedPanel, getBuffEffectiveValue } from '../../core/calculators/buffCalculator';
import type {
  AppliedBuffTagViewModel,
  SkillDamagePanel,
  SkillDamagePanelBase,
} from '../../core/calculators/skillDamage.types';
import { getCandidateBuffList } from '../../core/repositories';
import type { PersistedAnomalyCard, SkillButtonBuff } from '../../types/storage';

export type AnomalyCardKind = 'state' | 'damage';
export type AnomalyCategory = 'magic' | 'physical';
export type BurnDamageMode = 'dotOnly' | 'initialOnly' | 'splitDot';

export interface AnomalyOption {
  key: string;
  label: string;
  kind: AnomalyCardKind;
  category: AnomalyCategory;
  supportsSource: boolean;
  usesAnomalyLevel?: boolean;
  supportsDotToggle?: boolean;
  supportsDuration?: boolean;
  levelOptions: number[];
}

export interface SelectedAnomalyCard {
  id: string;
  key: string;
  label: string;
  kind: AnomalyCardKind;
  category: AnomalyCategory;
  level: number;
  sourceName?: string;
  includeDotInTotal?: boolean;
  burnDamageMode?: BurnDamageMode;
  durationSeconds?: number;
  primaryText: string;
  secondaryText: string;
  tertiaryText?: string;
  selectedBuffIds: string[];
}

export interface AnomalyDamageSegmentView {
  key: string;
  sourceKind: 'anomaly' | 'buff-extra-hit';
  title: string;
  sequenceTitle: string;
  compactTitle: string;
  buffText: string;
  appliedBuffTags: AppliedBuffTagViewModel[];
  elementText: string;
  elementKey: string;
  skillTypeText: string;
  panelAtkText: string;
  critRateText: string;
  critDmgText: string;
  sourceSkillBoostText: string;
  levelCoefficientText: string;
  sourceSkillZoneText: string;
  baseMultiplierText: string;
  multiplierText: string;
  multiplierFormulaText: string;
  expectedText: string;
  critText: string;
  nonCritText: string;
  expectedValue: number;
  critValue: number;
  nonCritValue: number;
  formulaText: string;
  elementBonusText: string;
  skillBonusText: string;
  allDamageBonusText: string;
  damageBonusRateText: string;
  resistanceBaseText: string;
  corrosionText: string;
  resistanceIgnoreText: string;
  resistanceZoneText: string;
  resistanceFormulaText: string;
  amplifyRateText: string;
  amplifyFormulaText: string;
  fragileRateText: string;
  fragileFormulaText: string;
  vulnerabilityRateText: string;
  vulnerabilityFormulaText: string;
  comboDamageBonusText: string;
  comboFormulaText: string;
  imbalanceDamageBonusText: string;
  imbalanceFormulaText: string;
  defenseZoneText: string;
  nonCritFormulaText: string;
  imbalanceText?: string;
  cooldownText?: string;
  sourceBuffName?: string;
}

export interface LocalBuffSearchResult {
  key: string;
  sourceKind: 'local' | 'candidate';
  ownerBuffDomain?: CandidateBuff['ownerBuffDomain'];
  ownerBuffGroup?: CandidateBuff['ownerBuffGroup'];
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  effectId: string;
  displayName: string;
  name: string;
  type?: string;
  value?: number;
  description?: string;
  condition?: string;
  category?: 'condition' | 'countable' | 'passive';
  maxStacks?: number;
  sourceName: string;
  source?: string;
  level?: string;
  effectKind?: 'modifier' | 'extraHit';
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
}

export type BuffSourceSearchMode = 'buff-group' | 'operator' | 'weapon' | 'equipment';

export const BUFF_SOURCE_SEARCH_MODE_OPTIONS: Array<{ key: BuffSourceSearchMode; label: string }> = [
  { key: 'buff-group', label: 'Buff组' },
  { key: 'operator', label: '干员' },
  { key: 'weapon', label: '武器' },
  { key: 'equipment', label: '装备' },
];

export function getBuffSourceSearchModeLabel(mode: BuffSourceSearchMode): string {
  return BUFF_SOURCE_SEARCH_MODE_OPTIONS.find((option) => option.key === mode)?.label || 'Buff组';
}

export function filterBuffSearchEntriesBySourceMode(
  entries: LocalBuffSearchResult[],
  mode: BuffSourceSearchMode
): LocalBuffSearchResult[] {
  if (mode === 'buff-group') {
    return entries.filter((entry) => entry.sourceKind === 'local');
  }
  return entries.filter((entry) => entry.sourceKind === 'candidate' && entry.ownerBuffDomain === mode);
}

const LOCAL_BUFF_LIBRARY_KEY = 'def.buff-editor.library.v1';

export const ANOMALY_GROUPS: Array<{ key: AnomalyCategory; label: string; items: AnomalyOption[] }> = [
  {
    key: 'magic',
    label: '法术异常',
    items: [
      { key: 'conductive', label: '导电', kind: 'damage', category: 'magic', supportsSource: false, levelOptions: [1, 2, 3, 4] },
      { key: 'corrosion', label: '腐蚀', kind: 'damage', category: 'magic', supportsSource: false, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'burn', label: '燃烧', kind: 'damage', category: 'magic', supportsSource: false, supportsDotToggle: true, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'freeze', label: '冻结', kind: 'damage', category: 'magic', supportsSource: false, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'shatter-ice', label: '碎冰', kind: 'damage', category: 'magic', supportsSource: false, levelOptions: [1, 2, 3, 4] },
      { key: 'magic-burst', label: '法术爆发', kind: 'damage', category: 'magic', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
    ],
  },
  {
    key: 'physical',
    label: '物理异常',
    items: [
      { key: 'knockdown', label: '倒地', kind: 'damage', category: 'physical', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'launch', label: '击飞', kind: 'damage', category: 'physical', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'armor-break', label: '碎甲', kind: 'damage', category: 'physical', supportsSource: false, supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'smash', label: '猛击', kind: 'damage', category: 'physical', supportsSource: false, levelOptions: [1, 2, 3, 4] },
    ],
  },
];

export const ANOMALY_STATE_OPTIONS: Array<{ key: 'conductive' | 'corrosion' | 'armor-break'; label: string; category: AnomalyCategory; supportsDuration?: boolean; levelOptions: number[] }> = [
  { key: 'conductive', label: '导电', category: 'magic', levelOptions: [1, 2, 3, 4] },
  { key: 'corrosion', label: '腐蚀', category: 'magic', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
  { key: 'armor-break', label: '碎甲', category: 'physical', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
];

export const FIXED_STATE_OPTIONS: AnomalyOption[] = [
  { key: 'combo-state', label: '连击', kind: 'state', category: 'physical', supportsSource: false, levelOptions: [1, 2, 3, 4] },
  { key: 'imbalance-state', label: '失衡', kind: 'state', category: 'physical', supportsSource: false, usesAnomalyLevel: false, levelOptions: [1] },
];

export const ALL_ANOMALY_OPTIONS: AnomalyOption[] = [
  ...FIXED_STATE_OPTIONS,
  ...ANOMALY_GROUPS.flatMap((group) => group.items),
];

export function normalizePersistedAnomalyCard(card: PersistedAnomalyCard): SelectedAnomalyCard {
  return {
    ...card,
    selectedBuffIds: Array.isArray(card.selectedBuffIds) ? card.selectedBuffIds : [],
  };
}

export function isModifierBuff(buff: SkillButtonBuff): boolean {
  return buff.effectKind !== 'extraHit';
}

export function isExtraHitBuff(buff: SkillButtonBuff): buff is SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: BuffExtraHitConfig } {
  return buff.effectKind === 'extraHit' && !!buff.extraHitConfig;
}

function normalizeAppliedBuffMaxStacks(buff: SkillButtonBuff): number {
  return typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks) && buff.maxStacks > 0
    ? Math.floor(buff.maxStacks)
    : 1;
}

function normalizeAppliedBuffStackCount(buff: SkillButtonBuff, stackCounts: Record<string, number>): number {
  const maxStacks = normalizeAppliedBuffMaxStacks(buff);
  const rawCount = stackCounts[buff.id];
  return typeof rawCount === 'number' && Number.isFinite(rawCount)
    ? Math.min(Math.max(Math.floor(rawCount), 0), maxStacks)
    : maxStacks;
}

function formatAppliedBuffValue(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(rounded);
}

export function buildAppliedBuffTags(
  buffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {}
): AppliedBuffTagViewModel[] {
  return buffs.map((buff) => {
    const isCountable = buff.category === 'countable';
    const maxStacks = normalizeAppliedBuffMaxStacks(buff);
    const stackCount = isCountable ? normalizeAppliedBuffStackCount(buff, stackCounts) : undefined;
    const effectiveValue = getBuffEffectiveValue(buff, stackCounts);
    const valueText = isCountable && typeof buff.value === 'number' && Number.isFinite(buff.value)
      ? `合计 ${formatAppliedBuffValue(effectiveValue)}`
      : '';
    const stackText = isCountable ? `${stackCount}/${maxStacks}层` : '';
    const extraText = [stackText, valueText].filter(Boolean).join(' · ');
    const displayLabel = extraText ? `${buff.displayName} · ${extraText}` : buff.displayName;
    return {
      id: buff.id,
      label: buff.displayName,
      displayLabel,
      sourceName: buff.sourceName,
      type: buff.type,
      value: buff.value,
      effectiveValue,
      multiplierCoefficient: buff.multiplier?.coefficient,
      isMultiplier: Boolean(buff.multiplier),
      stackCount,
      maxStacks: isCountable ? maxStacks : undefined,
      isCountable,
    };
  });
}

export function getNormalHitSegmentKey(hitKey: string): string {
  return `normal-hit-${hitKey}`;
}

export function buildPanelFromBase(
  panelBase: SkillDamagePanelBase | null,
  fallbackPanel: SkillDamagePanel | null,
  appliedBuffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {}
): SkillDamagePanel | null {
  if (!panelBase) {
    return fallbackPanel;
  }

  return calculateBuffedPanel(panelBase, appliedBuffs.filter(isModifierBuff), stackCounts);
}

export function isFixedStateKey(key: string): boolean {
  return FIXED_STATE_OPTIONS.some((option) => option.key === key);
}

export function getAnomalyDurationOptions(option: AnomalyOption): number[] {
  switch (option.key) {
    case 'conductive':
    case 'armor-break':
      return [12, 18, 24, 30];
    case 'freeze':
      return [6, 7, 8, 9];
    case 'corrosion':
      return [15];
    case 'burn':
      return [10];
    default:
      return [];
  }
}

export function createAnomalyCardId(baseKey: string): string {
  return `${baseKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readLocalBuffSearchEntries(): LocalBuffSearchResult[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_BUFF_LIBRARY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Record<string, {
      id?: string;
      name?: string;
      sourceName?: string;
      items?: Record<string, {
        id?: string;
        name?: string;
        sourceName?: string;
        effects?: Record<string, {
          id?: string;
          displayName?: string;
          name?: string;
          type?: string;
          value?: number;
          category?: 'condition' | 'countable' | 'passive';
          maxStacks?: number;
          description?: string;
          condition?: string;
          sourceName?: string;
          source?: string;
          level?: string;
          effectKind?: 'modifier' | 'extraHit';
          extraHitConfig?: BuffExtraHitConfig;
          multiplier?: BuffMultiplier;
        }>;
      }>;
    }>;

    return Object.entries(parsed).flatMap(([groupId, group]) =>
      Object.entries(group.items || {}).flatMap(([itemId, item]) =>
        Object.entries(item.effects || {}).map(([effectId, effect]) => ({
          key: `${groupId}/${itemId}/${effectId}`,
          sourceKind: 'local',
          groupId,
          groupName: group.name || groupId,
          itemId,
          itemName: item.name || itemId,
          effectId,
          displayName: effect.displayName || effectId,
          name: effect.name || effectId,
          type: effect.type,
          value: effect.value,
          category: effect.category,
          maxStacks: effect.maxStacks,
          description: effect.description,
          condition: effect.condition,
          sourceName: effect.sourceName || item.sourceName || group.sourceName || group.name || groupId,
          source: effect.source || 'local_custom',
          level: effect.level || '',
          effectKind: effect.effectKind,
          extraHitConfig: effect.extraHitConfig,
          multiplier: effect.multiplier,
        }))
      )
    );
  } catch {
    return [];
  }
}

const BUFF_SOURCE_DOMAIN_LABELS: Record<NonNullable<CandidateBuff['ownerBuffDomain']>, string> = {
  operator: '干员',
  weapon: '武器',
  equipment: '装备',
};

const BUFF_SOURCE_GROUP_LABELS: Record<NonNullable<CandidateBuff['ownerBuffGroup']>, string> = {
  talent: '天赋',
  potential: '潜能',
  skill: '技能',
  weaponSkill: '技能',
  threePiece: '三件套',
};

function inferCandidateBuffDomain(buff: CandidateBuff): CandidateBuff['ownerBuffDomain'] {
  if (buff.ownerBuffDomain) return buff.ownerBuffDomain;
  if (buff.ownerBuffGroup === 'weaponSkill') return 'weapon';
  if (buff.ownerBuffGroup === 'threePiece') return 'equipment';
  if (buff.ownerBuffGroup) return 'operator';
  return undefined;
}

function buildCandidateBuffSourcePath(buff: CandidateBuff): Pick<LocalBuffSearchResult, 'groupName' | 'itemName'> {
  const sourceName = buff.sourceName || buff.source || '候选 Buff';
  const sourceDomain = inferCandidateBuffDomain(buff);
  if (!sourceDomain) {
    return {
      groupName: '候选 Buff',
      itemName: sourceName,
    };
  }

  const groupLabel = buff.ownerBuffGroup ? BUFF_SOURCE_GROUP_LABELS[buff.ownerBuffGroup] : '';
  return {
    groupName: BUFF_SOURCE_DOMAIN_LABELS[sourceDomain],
    itemName: groupLabel ? `${sourceName} / ${groupLabel}` : sourceName,
  };
}

export function readCandidateBuffSearchEntries(): LocalBuffSearchResult[] {
  return getCandidateBuffList().map((buff, index): LocalBuffSearchResult => {
    const sourcePath = buildCandidateBuffSourcePath(buff);
    const ownerBuffDomain = inferCandidateBuffDomain(buff);
    return {
      key: `candidate-${index}-${buff.name}-${buff.displayName}`,
      sourceKind: 'candidate',
      ownerBuffDomain,
      ownerBuffGroup: buff.ownerBuffGroup,
      groupId: '',
      groupName: sourcePath.groupName,
      itemId: '',
      itemName: sourcePath.itemName,
      effectId: '',
      displayName: buff.displayName,
      name: buff.name,
      type: buff.type,
      value: buff.value,
      category: buff.category,
      maxStacks: buff.maxStacks,
      description: buff.description,
      condition: buff.condition,
      sourceName: buff.sourceName,
      source: buff.source,
      level: buff.level || '',
      effectKind: buff.effectKind,
      extraHitConfig: buff.extraHitConfig,
      multiplier: buff.multiplier,
    };
  });
}

export function dedupeLocalBuffSearchResults(entries: LocalBuffSearchResult[]): LocalBuffSearchResult[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.displayName,
      entry.name,
      entry.sourceName,
      entry.type ?? '',
      entry.value ?? '',
      entry.condition ?? '',
      entry.category ?? '',
      entry.maxStacks ?? '',
      entry.effectKind ?? '',
      entry.extraHitConfig ? JSON.stringify(entry.extraHitConfig) : '',
    ].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
