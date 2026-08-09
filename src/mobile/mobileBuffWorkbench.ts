import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import type { Character } from '../types';
import type { AnomalyStateSnapshot, PersistedAnomalyCard, SkillButtonBuff } from '../types/storage';
import { createMobileId } from './mobileDraft';

export type MobileBuffCatalogMode =
  | 'buff-group'
  | 'operator'
  | 'weapon'
  | 'equipment'
  | 'anomaly'
  | 'anomaly-state'
  | 'state'
  | 'extra-hit';

export type MobileOperatorBuffGroup = 'talent' | 'potential' | 'skill';
export type MobileAnomalyCategory = 'magic' | 'physical';
export type MobileBurnDamageMode = 'dotOnly' | 'initialOnly' | 'splitDot';

export interface MobileAnomalyOption {
  key: string;
  label: string;
  kind: 'damage' | 'state';
  category: MobileAnomalyCategory;
  usesAnomalyLevel?: boolean;
  supportsDuration?: boolean;
  supportsBurnMode?: boolean;
  levelOptions: number[];
}

export interface MobileAnomalyStateOption {
  key: 'conductive' | 'corrosion' | 'armor-break';
  label: string;
  category: MobileAnomalyCategory;
  supportsDuration?: boolean;
  levelOptions: number[];
}

export const MOBILE_BUFF_CATALOG_MODES: Array<{ key: MobileBuffCatalogMode; label: string; shortLabel: string }> = [
  { key: 'buff-group', label: 'Buff 组', shortLabel: 'Buff组' },
  { key: 'operator', label: '干员 Buff', shortLabel: '干员' },
  { key: 'weapon', label: '武器 Buff', shortLabel: '武器' },
  { key: 'equipment', label: '装备 Buff', shortLabel: '装备' },
  { key: 'anomaly', label: '异常伤害', shortLabel: '异常伤害' },
  { key: 'anomaly-state', label: '异常状态', shortLabel: '异常状态' },
  { key: 'state', label: '状态区', shortLabel: '状态区' },
  { key: 'extra-hit', label: '额外 Hit', shortLabel: '额外 Hit' },
];

export const MOBILE_OPERATOR_BUFF_GROUPS: Array<{ key: MobileOperatorBuffGroup; label: string }> = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
];

export const MOBILE_ANOMALY_GROUPS: Array<{ key: MobileAnomalyCategory; label: string; items: MobileAnomalyOption[] }> = [
  {
    key: 'magic',
    label: '法术异常',
    items: [
      { key: 'conductive', label: '导电', kind: 'damage', category: 'magic', levelOptions: [1, 2, 3, 4] },
      { key: 'corrosion', label: '腐蚀', kind: 'damage', category: 'magic', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'burn', label: '燃烧', kind: 'damage', category: 'magic', supportsDuration: true, supportsBurnMode: true, levelOptions: [1, 2, 3, 4] },
      { key: 'freeze', label: '冻结', kind: 'damage', category: 'magic', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'shatter-ice', label: '碎冰', kind: 'damage', category: 'magic', levelOptions: [1, 2, 3, 4] },
      { key: 'magic-burst', label: '法术爆发', kind: 'damage', category: 'magic', usesAnomalyLevel: false, levelOptions: [1] },
    ],
  },
  {
    key: 'physical',
    label: '物理异常',
    items: [
      { key: 'knockdown', label: '倒地', kind: 'damage', category: 'physical', usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'launch', label: '击飞', kind: 'damage', category: 'physical', usesAnomalyLevel: false, levelOptions: [1] },
      { key: 'armor-break', label: '碎甲', kind: 'damage', category: 'physical', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
      { key: 'smash', label: '猛击', kind: 'damage', category: 'physical', levelOptions: [1, 2, 3, 4] },
    ],
  },
];

export const MOBILE_ANOMALY_STATE_OPTIONS: MobileAnomalyStateOption[] = [
  { key: 'conductive', label: '导电', category: 'magic', levelOptions: [1, 2, 3, 4] },
  { key: 'corrosion', label: '腐蚀', category: 'magic', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
  { key: 'armor-break', label: '碎甲', category: 'physical', supportsDuration: true, levelOptions: [1, 2, 3, 4] },
];

export const MOBILE_FIXED_STATE_OPTIONS: MobileAnomalyOption[] = [
  { key: 'combo-state', label: '连击', kind: 'state', category: 'physical', levelOptions: [1, 2, 3, 4] },
  { key: 'imbalance-state', label: '失衡', kind: 'state', category: 'physical', usesAnomalyLevel: false, levelOptions: [1] },
];

export function getMobileAnomalyDurationOptions(option: Pick<MobileAnomalyOption, 'key'>): number[] {
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

export function getMobileAnomalyStateDurationOptions(option: MobileAnomalyStateOption): number[] {
  if (option.key === 'corrosion') return [0, 5, 10, 15];
  if (option.key === 'armor-break') return [12, 18, 24, 30];
  return [];
}

function getAnomalyDamageSummary(option: MobileAnomalyOption, level: number): string {
  if (option.key === 'magic-burst') return '160% 法术爆发 Hit';
  if (option.key === 'smash') return `${150 * (1 + level)}% 独立 Hit`;
  if (option.key === 'armor-break') return `${50 * (1 + level)}% 独立 Hit`;
  if (option.key === 'shatter-ice') return `${120 * (1 + level)}% 物理 Hit`;
  if (option.key === 'knockdown' || option.key === 'launch') return '120% 物理 Hit';
  if (option.key === 'freeze') return `${80 * (1 + level)}% 寒冷 Hit`;
  if (option.key === 'burn') return `${80 * (1 + level)}% 初始 Hit`;
  return `${80 * (1 + level)}% 初始 Hit`;
}

export function buildMobileAnomalyCard(input: {
  option: MobileAnomalyOption;
  level: number;
  durationSeconds?: number;
  burnDamageMode?: MobileBurnDamageMode;
}): PersistedAnomalyCard {
  const { option } = input;
  const level = option.usesAnomalyLevel === false ? 1 : Math.min(Math.max(Math.round(input.level), 1), 4);
  if (option.key === 'combo-state') {
    const skillBonus = [30, 45, 60, 75][level - 1] ?? 30;
    const ultimateBonus = [20, 30, 40, 50][level - 1] ?? 20;
    return {
      id: createMobileId(option.key),
      key: option.key,
      label: option.label,
      kind: 'state',
      category: option.category,
      level,
      primaryText: `${option.label} ${level} 层`,
      secondaryText: `战技 +${skillBonus}% / 终结技 +${ultimateBonus}%`,
      tertiaryText: '独立连击区',
      selectedBuffIds: [],
    };
  }
  if (option.key === 'imbalance-state') {
    return {
      id: createMobileId(option.key),
      key: option.key,
      label: option.label,
      kind: 'state',
      category: option.category,
      level: 1,
      primaryText: option.label,
      secondaryText: '失衡伤害 +30%',
      tertiaryText: '独立失衡区',
      selectedBuffIds: [],
    };
  }

  const burnDamageMode = option.key === 'burn' ? input.burnDamageMode ?? 'dotOnly' : undefined;
  const durationSeconds = option.supportsDuration ? input.durationSeconds : undefined;
  const burnModeLabel = burnDamageMode === 'initialOnly'
    ? '仅初始段'
    : burnDamageMode === 'splitDot'
      ? '持续伤害逐秒拆分'
      : '仅持续总伤';
  return {
    id: createMobileId(option.key),
    key: option.key,
    label: option.label,
    kind: 'damage',
    category: option.category,
    level,
    primaryText: option.usesAnomalyLevel === false ? option.label : `${option.label} Lv${level}`,
    secondaryText: getAnomalyDamageSummary(option, level),
    ...(burnDamageMode ? {
      includeDotInTotal: burnDamageMode !== 'initialOnly',
      burnDamageMode,
    } : {}),
    ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
    tertiaryText: option.key === 'burn'
      ? `${burnModeLabel}${typeof durationSeconds === 'number' ? ` · ${durationSeconds}s` : ''}`
      : typeof durationSeconds === 'number'
        ? `持续 ${durationSeconds}s`
        : '独立异常伤害段',
    selectedBuffIds: [],
  };
}

export function buildMobileAnomalyStateSnapshot(input: {
  option: MobileAnomalyStateOption;
  level: number;
  durationSeconds?: number;
  sourceCharacter: Pick<Character, 'id' | 'name'>;
  sourceSnapshot?: ConfigSnapshot | null;
  sourceButtonId: string;
}): AnomalyStateSnapshot {
  const level = Math.min(Math.max(Math.round(input.level), 1), 4);
  const sourceSkillStrength = input.sourceSnapshot?.panel.display.sourceSkill ?? 0;
  const effectEnhancement = sourceSkillStrength > 0
    ? (2 * sourceSkillStrength) / (sourceSkillStrength + 300)
    : 0;
  const durationSeconds = input.option.supportsDuration ? Math.max(0, input.durationSeconds ?? 0) : undefined;
  const baseSnapshot = {
    id: Date.now() * 100 + Math.floor(Math.random() * 100),
    key: input.option.key,
    label: input.option.label,
    level,
    sourceButtonId: input.sourceButtonId,
    sourceCharacterId: input.sourceCharacter.id,
    sourceCharacterName: input.sourceCharacter.name,
    sourceSkillStrengthSnapshot: sourceSkillStrength,
    createdAt: Date.now(),
  } as const;

  if (input.option.key === 'conductive' || input.option.key === 'armor-break') {
    const baseRate = [0.12, 0.16, 0.2, 0.24][level - 1] ?? 0.12;
    const effectValue = baseRate * (1 + effectEnhancement);
    const effectLabel = input.option.key === 'conductive' ? '法术易伤' : '物伤易伤';
    return {
      ...baseSnapshot,
      effectValue,
      ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
      primaryText: `${input.option.label} Lv${level} · ${input.sourceCharacter.name}`,
      secondaryText: `${(effectValue * 100).toFixed(1)}% ${effectLabel}`,
      tertiaryText: typeof durationSeconds === 'number' ? `持续 ${durationSeconds}s` : `技艺快照 ${sourceSkillStrength.toFixed(0)}`,
    };
  }

  const baseStart = [3.6, 4.8, 6, 7.2][level - 1] ?? 3.6;
  const baseTick = [0.84, 1.12, 1.4, 1.68][level - 1] ?? 0.84;
  const baseCap = [12, 16, 20, 24][level - 1] ?? 12;
  const initialCorrosion = baseStart * (1 + effectEnhancement);
  const tickCorrosionPerSecond = baseTick * (1 + effectEnhancement);
  const maxCorrosion = baseCap * (1 + effectEnhancement);
  const currentCorrosion = Math.min(maxCorrosion, initialCorrosion + tickCorrosionPerSecond * (durationSeconds ?? 0));
  return {
    ...baseSnapshot,
    effectValue: currentCorrosion,
    initialCorrosion,
    tickCorrosionPerSecond,
    maxCorrosion,
    currentCorrosion,
    durationSeconds,
    primaryText: `${input.option.label} Lv${level} · ${input.sourceCharacter.name}`,
    secondaryText: `全属性降抗 ${currentCorrosion.toFixed(2)}`,
    tertiaryText: `${durationSeconds ?? 0}s · 上限 ${maxCorrosion.toFixed(2)}`,
  };
}

const CHINESE_POTENTIAL_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

export function getRequiredPotentialCount(buffName: string): number | null {
  const normalizedName = buffName.replace(/\s+/g, '');
  const suffixMatch = normalizedName.match(/潜能([1-6一二三四五六])/);
  const prefixMatch = normalizedName.match(/([1-6一二三四五六])潜/);
  const token = suffixMatch?.[1] ?? prefixMatch?.[1];
  return token ? CHINESE_POTENTIAL_NUMBERS[token] ?? Number(token) : null;
}

export function filterMobileBuffCandidates(input: {
  buffs: SkillButtonBuff[];
  mode: MobileBuffCatalogMode;
  characterId: string | null;
  operatorBuffGroup: MobileOperatorBuffGroup | null;
  potentialCounts: Record<string, number>;
}): SkillButtonBuff[] {
  if (['anomaly', 'anomaly-state', 'state'].includes(input.mode)) return [];
  return input.buffs
    .filter((buff) => {
      if (input.mode === 'extra-hit') return buff.effectKind === 'extraHit' && Boolean(buff.extraHitConfig);
      if (buff.effectKind === 'extraHit') return false;
      if (input.mode === 'buff-group') return !buff.ownerBuffDomain;
      return buff.ownerBuffDomain === input.mode;
    })
    .filter((buff) => (
      !input.characterId
      || buff.ownerCharacterId === input.characterId
      || (input.mode === 'extra-hit' && !buff.ownerCharacterId)
    ))
    .filter((buff) => {
      if (input.mode !== 'operator' || !input.operatorBuffGroup) return true;
      if (input.operatorBuffGroup === 'potential') {
        return buff.ownerBuffGroup === 'potential'
          || getRequiredPotentialCount(buff.displayName || buff.name) !== null;
      }
      return buff.ownerBuffGroup === input.operatorBuffGroup;
    })
    .filter((buff) => {
      if (input.mode !== 'operator') return true;
      const required = getRequiredPotentialCount(buff.displayName || buff.name);
      if (required === null) return true;
      return (input.potentialCounts[buff.ownerCharacterId ?? ''] ?? 0) > required;
    });
}

export function getMobileBuffSourceLabel(buff: SkillButtonBuff): string {
  if (buff.effectKind === 'extraHit') return '额外 Hit';
  switch (buff.ownerBuffGroup) {
    case 'talent': return '天赋';
    case 'potential': return '潜能';
    case 'skill': return '技能';
    case 'weaponSkill': return '武器';
    case 'threePiece': return '装备';
    default: return 'Buff组';
  }
}
