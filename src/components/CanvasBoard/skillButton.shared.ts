import type { BuffExtraHitConfig } from '../../core/domain/buff';
import { calculateBuffTotals } from '../../core/calculators/buffCalculator';
import type {
  AppliedBuffTagViewModel,
  SkillDamagePanel,
  SkillDamagePanelBase,
} from '../../core/calculators/skillDamage.types';
import { getCandidateBuffList } from '../../core/repositories';
import type { PersistedAnomalyCard, SkillButtonBuff } from '../../types/storage';

export type AnomalyCardKind = 'state' | 'damage';
export type AnomalyCategory = 'magic' | 'physical';

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
  sourceName: string;
  source?: string;
  level?: string;
  effectKind?: 'modifier' | 'extraHit';
  extraHitConfig?: BuffExtraHitConfig;
}

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
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

export function buildAppliedBuffTags(buffs: SkillButtonBuff[]): AppliedBuffTagViewModel[] {
  return buffs.map((buff) => ({
    id: buff.id,
    label: buff.displayName,
    sourceName: buff.sourceName,
  }));
}

export function getNormalHitSegmentKey(hitKey: string): string {
  return `normal-hit-${hitKey}`;
}

export function buildPanelFromBase(
  panelBase: SkillDamagePanelBase | null,
  fallbackPanel: SkillDamagePanel | null,
  appliedBuffs: SkillButtonBuff[]
): SkillDamagePanel | null {
  if (!panelBase) {
    return fallbackPanel;
  }

  const buffTotals = calculateBuffTotals(appliedBuffs.filter(isModifierBuff));
  const currentAtkPercent = panelBase.weaponAtkPercent * 0.01;
  const rawAtk = panelBase.characterAtk + panelBase.weaponAtk;
  const fixedAtk = panelBase.baseAtk - rawAtk * (1 + currentAtkPercent);
  const nextBaseAtk = rawAtk * (1 + currentAtkPercent + buffTotals.atkPercentBoost) + fixedAtk;
  const abilityAtkPercentBonus = panelBase.abilityBonus * 0.01;

  return {
    atk: nextBaseAtk * (1 + abilityAtkPercentBonus),
    critRate: (panelBase.critRate ?? 0.05) + buffTotals.critRateBoost,
    critDmg: (panelBase.critDmg ?? 0.5) + buffTotals.critDmgBonusBoost,
  };
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
          description?: string;
          condition?: string;
          sourceName?: string;
          source?: string;
          level?: string;
          effectKind?: 'modifier' | 'extraHit';
          extraHitConfig?: BuffExtraHitConfig;
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
          description: effect.description,
          condition: effect.condition,
          sourceName: effect.sourceName || item.sourceName || group.sourceName || group.name || groupId,
          source: effect.source || 'local_custom',
          level: effect.level || '',
          effectKind: effect.effectKind,
          extraHitConfig: effect.extraHitConfig,
        }))
      )
    );
  } catch {
    return [];
  }
}

export function readCandidateBuffSearchEntries(): LocalBuffSearchResult[] {
  return getCandidateBuffList().map((buff, index) => ({
    key: `candidate-${index}-${buff.name}-${buff.displayName}`,
    sourceKind: 'candidate',
    groupId: '',
    groupName: '陈列区 Buff',
    itemId: '',
    itemName: buff.sourceName || buff.source || '候选 Buff',
    effectId: '',
    displayName: buff.displayName,
    name: buff.name,
    type: buff.type,
    value: buff.value,
    description: buff.description,
    condition: buff.condition,
    sourceName: buff.sourceName,
    source: buff.source,
    level: buff.level || '',
    effectKind: buff.effectKind,
    extraHitConfig: buff.extraHitConfig,
  }));
}
