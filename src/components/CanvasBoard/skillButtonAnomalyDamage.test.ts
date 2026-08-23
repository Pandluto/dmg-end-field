import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import type { SelectedAnomalyCard } from './skillButton.shared';
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

function modifierBuff(
  id: string,
  value?: number,
  multiplierCoefficient?: number
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'integration golden',
    source: 'test',
    type: 'multiplierBonus',
    value,
    multiplier: multiplierCoefficient === undefined
      ? undefined
      : { coefficient: multiplierCoefficient },
    refCount: 1,
  };
}

const zeroDamageBonus: DamageBonusSnapshot = {
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

const anomalyCards: SelectedAnomalyCard[] = [
  {
    id: 'magic-burst-card',
    key: 'magic-burst',
    label: '法术爆发',
    kind: 'damage',
    category: 'magic',
    level: 0,
    primaryText: '',
    secondaryText: '',
    selectedBuffIds: [],
  },
  {
    id: 'burn-card',
    key: 'burn',
    label: '燃烧',
    kind: 'damage',
    category: 'magic',
    level: 1,
    burnDamageMode: 'dotOnly',
    durationSeconds: 10,
    primaryText: '',
    secondaryText: '',
    selectedBuffIds: [],
  },
];

const extraHitBuff: SkillButtonBuff & {
  effectKind: 'extraHit';
  extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']>;
} = {
  id: 'extra-hit',
  name: 'extra-hit',
  displayName: '额外伤害',
  sourceName: 'integration golden',
  source: 'test',
  refCount: 1,
  effectKind: 'extraHit',
  extraHitConfig: {
    baseMultiplier: 2,
    damageType: 'fire',
    skillType: 'B',
    imbalanceValue: 0,
    cooldownSeconds: 0,
  },
};

const segments = buildAnomalyDamageSegments({
  panelBase: null,
  panelData: { atk: 1000, critRate: 0, critDmg: 0 },
  hitCards: [],
  selectedAnomalyDamages: anomalyCards,
  buttonCharacterId: 'operator',
  element: 'fire',
  damageBonus: zeroDamageBonus,
  targetResistance: { fireResistance: 0 },
  fullCombinedModifierBuffList: [
    modifierBuff('additive', 0.4),
    modifierBuff('multiplier', undefined, 1.2),
  ],
  extraHitBuffList: [extraHitBuff],
  manuallyDisabledBuffIdsBySegmentKey: {
    'buff-extra-hit-extra-hit': ['additive'],
  },
  singleHitBuffTargetByBuffId: {
    additive: 'buff-extra-hit-extra-hit',
  },
  getEffectiveCharacterSourceSkillBoost: () => 0,
});

assertEqual(segments.length, 3, 'golden should include anomaly, burn DoT, and extra-hit segments');

const [anomaly, burnDot, extraHit] = segments;

assertEqual(anomaly.multiplierText, '279.2%', 'anomaly should not inherit a single-hit additive Buff targeted elsewhere');
assertEqual(anomaly.multiplierFormulaText, '(232.7% + 0.0%) × 1.200', 'anomaly formula should retain the ordinary multiplier Buff');
assertEqual(anomaly.nonCritText, '1396', 'anomaly non-crit text should exclude the single-hit additive Buff');
assertClose(anomaly.nonCritValue, 1395.9183673469388, 'anomaly damage should exclude a single-hit additive Buff targeted elsewhere');

assertEqual(burnDot.multiplierText, '418.8%', 'burn DoT should not inherit a single-hit additive Buff targeted elsewhere');
assertEqual(burnDot.multiplierFormulaText, '(349.0% + 0.0%) × 1.200', 'burn DoT formula should retain the ordinary multiplier Buff');
assertEqual(burnDot.nonCritText, '2094', 'burn DoT non-crit text should exclude the single-hit additive Buff');
assertClose(burnDot.nonCritValue, 2093.877551020408, 'burn DoT damage should exclude a single-hit additive Buff targeted elsewhere');

assertEqual(extraHit.multiplierText, '288.0%', 'extra-hit multiplier text should include additive and multiplier buffs');
assertEqual(extraHit.multiplierFormulaText, '(200.0% + 40.0%) × 1.200', 'extra-hit formula should expose operation order');
assertEqual(extraHit.nonCritText, '1440', 'extra-hit non-crit text should use the final multiplier');
assertClose(extraHit.nonCritValue, 1440, 'extra-hit damage should apply (base + additive) times multiplier');

function buildSourceSkillExtraHit(levelCurve: 'physicalAnomaly' | 'artsBurst') {
  return buildAnomalyDamageSegments({
    panelBase: null,
    panelData: { atk: 1000, critRate: 0, critDmg: 0 },
    hitCards: [],
    selectedAnomalyDamages: [],
    buttonCharacterId: 'operator',
    element: 'physical',
    damageBonus: zeroDamageBonus,
    targetResistance: { physicalResistance: 0 },
    fullCombinedModifierBuffList: [],
    extraHitBuffList: [{
      ...extraHitBuff,
      id: `source-skill-${levelCurve}`,
      extraHitConfig: {
        ...extraHitBuff.extraHitConfig,
        baseMultiplier: 1,
        damageType: 'physical',
        skillType: '',
        formulaMode: 'sourceSkill',
        levelCurve,
      },
    }],
    manuallyDisabledBuffIdsBySegmentKey: {},
    getEffectiveCharacterSourceSkillBoost: () => 100,
  })[0];
}

const physicalSourceSkillHit = buildSourceSkillExtraHit('physicalAnomaly');
assertEqual(physicalSourceSkillHit.levelCoefficientText, '1.227', 'physical anomaly curve should use the 392 denominator');
assertEqual(physicalSourceSkillHit.sourceSkillZoneText, '2.000', 'source-skill extra hit should expose its source-skill zone');
assertEqual(physicalSourceSkillHit.multiplierFormulaText, '(245.4% + 0.0%) × 1.000', 'physical source-skill formula should scale the base multiplier');
assertClose(physicalSourceSkillHit.nonCritValue, 1227.0408163265306, 'physical source-skill extra hit should apply level and source-skill coefficients');

const artsSourceSkillHit = buildSourceSkillExtraHit('artsBurst');
assertEqual(artsSourceSkillHit.levelCoefficientText, '1.454', 'arts burst curve should use the 196 denominator');
assertEqual(artsSourceSkillHit.multiplierFormulaText, '(290.8% + 0.0%) × 1.000', 'arts-burst source-skill formula should scale the base multiplier');
assertClose(artsSourceSkillHit.nonCritValue, 1454.0816326530612, 'arts-burst source-skill extra hit should apply level and source-skill coefficients');
