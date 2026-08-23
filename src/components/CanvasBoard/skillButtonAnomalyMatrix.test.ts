import { calculateBuffTotals } from '../../core/calculators/buffCalculator';
import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import {
  ANOMALY_GROUPS,
  type BurnDamageMode,
  type SelectedAnomalyCard,
} from './skillButton.shared';
import { buildAnomalyDamageSegments } from './skillButtonAnomalyDamage';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function modifier(
  id: string,
  type: string,
  value?: number,
  multiplierCoefficient?: number,
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'complete-anomaly-matrix',
    source: 'test',
    type,
    value,
    multiplier: multiplierCoefficient === undefined
      ? undefined
      : { coefficient: multiplierCoefficient },
    category: 'condition',
    effectKind: 'modifier',
    refCount: 1,
  };
}

const ZERO_DAMAGE_BONUS: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};

const SOURCE_SKILL_BUFF = modifier('anomaly-source-skill', 'sourceSkillBoost', 18);
const MULTIPLIER_BONUS_BUFF = modifier('anomaly-multiplier-add', 'multiplierBonus', 0.25);
const MULTIPLIER_PRODUCT_BUFF = modifier('anomaly-multiplier-product', 'multiplierBonus', undefined, 1.12);
const MATRIX_BUFFS = [SOURCE_SKILL_BUFF, MULTIPLIER_BONUS_BUFF, MULTIPLIER_PRODUCT_BUFF];

function card(
  key: string,
  label: string,
  category: 'magic' | 'physical',
  level: number,
  burnDamageMode?: BurnDamageMode,
  durationSeconds?: number,
): SelectedAnomalyCard {
  return {
    id: `matrix-${key}-${burnDamageMode ?? 'default'}`,
    key,
    label,
    kind: 'damage',
    category,
    level,
    burnDamageMode,
    durationSeconds,
    primaryText: `${label} Lv${level}`,
    secondaryText: '完整异常矩阵',
    selectedBuffIds: MATRIX_BUFFS.map((item) => item.id),
  };
}

function buildSegments(selectedCards: SelectedAnomalyCard[]) {
  return buildAnomalyDamageSegments({
    panelBase: null,
    panelData: { atk: 1000, critRate: 0, critDmg: 0 },
    hitCards: [],
    selectedAnomalyDamages: selectedCards,
    buttonCharacterId: 'anomaly-matrix-operator',
    element: 'fire',
    damageBonus: ZERO_DAMAGE_BONUS,
    targetResistance: {
      physicalResistance: 0,
      fireResistance: 0,
      electricResistance: 0,
      iceResistance: 0,
      natureResistance: 0,
    },
    fullCombinedModifierBuffList: MATRIX_BUFFS,
    extraHitBuffList: [],
    manuallyDisabledBuffIdsBySegmentKey: {},
    singleHitBuffTargetByBuffId: selectedCards[0]
      ? { [MULTIPLIER_BONUS_BUFF.id]: selectedCards[0].id }
      : {},
    getEffectiveCharacterSourceSkillBoost: (_characterId, buffs = []) => (
      12 + calculateBuffTotals(buffs).sourceSkillBoost
    ),
  });
}

const ANOMALY_GOLDENS = [
  { key: 'conductive', label: '导电', category: 'magic', level: 1, element: 'electric', base: '160.0%', nonCrit: 1833.7142857142858 },
  { key: 'corrosion', label: '腐蚀', category: 'magic', level: 2, element: 'nature', base: '240.0%', nonCrit: 2680.5714285714284 },
  { key: 'burn', label: '燃烧', category: 'magic', level: 3, element: 'fire', base: '320.0%', nonCrit: 3527.4285714285716 },
  { key: 'freeze', label: '冻结', category: 'magic', level: 4, element: 'ice', base: '400.0%', nonCrit: 4374.285714285715 },
  { key: 'shatter-ice', label: '碎冰', category: 'magic', level: 2, element: 'physical', base: '360.0%', nonCrit: 3950.8571428571436 },
  { key: 'magic-burst', label: '法术爆发', category: 'magic', level: 1, element: 'fire', base: '160.0%', nonCrit: 1833.7142857142858 },
  { key: 'knockdown', label: '倒地', category: 'physical', level: 1, element: 'physical', base: '120.0%', nonCrit: 1211.942857142857 },
  { key: 'launch', label: '击飞', category: 'physical', level: 1, element: 'physical', base: '120.0%', nonCrit: 1211.942857142857 },
  { key: 'armor-break', label: '碎甲', category: 'physical', level: 3, element: 'physical', base: '200.0%', nonCrit: 1926.5714285714287 },
  { key: 'smash', label: '猛击', category: 'physical', level: 4, element: 'physical', base: '750.0%', nonCrit: 6839.642857142859 },
] as const;

assertEqual(
  JSON.stringify(ANOMALY_GROUPS.flatMap((group) => group.items.map((item) => item.key)).sort()),
  JSON.stringify(ANOMALY_GOLDENS.map((item) => item.key).sort()),
  'every selectable anomaly damage should have a numeric golden',
);

ANOMALY_GOLDENS.forEach((golden) => {
  const [segment] = buildSegments([
    card(golden.key, golden.label, golden.category, golden.level, 'initialOnly'),
  ]);
  if (!segment) throw new Error(`${golden.key} did not produce an anomaly segment`);
  assertEqual(segment.sourceKind, 'anomaly', `${golden.key} source kind`);
  assertEqual(segment.elementKey, golden.element, `${golden.key} element mapping`);
  assertEqual(segment.baseMultiplierText, golden.base, `${golden.key} base multiplier`);
  assertEqual(segment.sourceSkillBoostText, '30.0', `${golden.key} source skill should be base 12 + Buff 18`);
  assertEqual(segment.sourceSkillZoneText, '1.300', `${golden.key} source skill zone`);
  assertClose(segment.nonCritValue, golden.nonCrit, `${golden.key} hard non-crit golden`);
  assertClose(segment.expectedValue, golden.nonCrit, `${golden.key} zero-crit expected golden`);
});

const [burnInitial] = buildSegments([
  card('burn', '燃烧初始', 'magic', 2, 'initialOnly', 4),
]);
assertEqual(burnInitial.key, 'matrix-burn-initialOnly', 'initial-only burn should retain the initial segment');
assertEqual(burnInitial.baseMultiplierText, '240.0%', 'initial-only burn multiplier');
assertClose(burnInitial.nonCritValue, 2680.5714285714284, 'initial-only burn golden');

const [burnDotOnly] = buildSegments([
  card('burn', '燃烧持续', 'magic', 2, 'dotOnly', 4),
]);
assertEqual(burnDotOnly.key, 'matrix-burn-dotOnly-dot', 'dot-only burn should replace initial damage with one total DoT segment');
assertEqual(burnDotOnly.baseMultiplierText, '144.0%', 'dot-only burn should multiply one tick by duration');
assertClose(burnDotOnly.nonCritValue, 1664.3428571428574, 'dot-only burn golden');

const burnSplit = buildSegments([
  card('burn', '燃烧逐跳', 'magic', 2, 'splitDot', 3),
]);
assertEqual(burnSplit.length, 3, 'split burn should produce one segment per second');
burnSplit.forEach((segment, index) => {
  assertEqual(segment.key, `matrix-burn-splitDot-dot-${index + 1}`, `split burn segment ${index + 1} key`);
  assertEqual(segment.baseMultiplierText, '36.0%', `split burn segment ${index + 1} multiplier`);
  assertClose(segment.nonCritValue, 521.0857142857144, `split burn segment ${index + 1} golden`);
});

const [withoutSourceSkillBuff] = buildAnomalyDamageSegments({
  panelBase: null,
  panelData: { atk: 1000, critRate: 0, critDmg: 0 },
  hitCards: [],
  selectedAnomalyDamages: [{
    ...card('conductive', '导电', 'magic', 1),
    selectedBuffIds: [MULTIPLIER_BONUS_BUFF.id, MULTIPLIER_PRODUCT_BUFF.id],
  }],
  buttonCharacterId: 'anomaly-matrix-operator',
  element: 'fire',
  damageBonus: ZERO_DAMAGE_BONUS,
  targetResistance: { electricResistance: 0 },
  fullCombinedModifierBuffList: MATRIX_BUFFS,
  extraHitBuffList: [],
  manuallyDisabledBuffIdsBySegmentKey: {},
  singleHitBuffTargetByBuffId: {
    [MULTIPLIER_BONUS_BUFF.id]: 'matrix-conductive-default',
  },
  getEffectiveCharacterSourceSkillBoost: (_characterId, buffs = []) => (
    12 + calculateBuffTotals(buffs).sourceSkillBoost
  ),
});
assertEqual(withoutSourceSkillBuff.sourceSkillBoostText, '12.0', 'unselected source-skill Buff must not leak into anomaly damage');
assertEqual(withoutSourceSkillBuff.sourceSkillZoneText, '1.120', 'base source skill should remain when Buff is unselected');
assertClose(withoutSourceSkillBuff.nonCritValue, 1599.2, 'source-skill selection should be observable in the final golden');
