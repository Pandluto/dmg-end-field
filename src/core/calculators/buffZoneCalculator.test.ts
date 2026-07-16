import type { SkillButtonBuff } from '../../types/storage';
import { calculateHitBuffZones, resolveBuffInstanceValue } from './buffZoneCalculator';
import { normalizeStoredBuffDefinition } from '../services/buffStorageNormalization';

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function buff(
  id: string,
  type: string,
  value?: number,
  options: Partial<SkillButtonBuff> = {}
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'test',
    source: 'test',
    type,
    value,
    refCount: 1,
    ...options,
  };
}

const ordinary = buff('ordinary', 'magicVulnerability', 0.2);
const countable = buff('countable', 'magicVulnerability', 0.2, {
  category: 'countable',
  maxStacks: 5,
});

assertClose(resolveBuffInstanceValue(ordinary).runtimeCoefficient, 1, 'ordinary buff should default k to 1');
assertClose(resolveBuffInstanceValue(ordinary).effectiveValue, 0.2, 'ordinary buff should resolve kn');
assertClose(
  resolveBuffInstanceValue(countable, { countable: 2 }).effectiveValue,
  0.4,
  'countable buff should resolve value times stack count'
);

const coldMultiplier = buff('cold-multiplier', 'iceVulnerability', undefined, {
  multiplier: { coefficient: 1.1 },
});
const magicMultiplier = buff('magic-multiplier', 'magicVulnerability', undefined, {
  multiplier: { coefficient: 1.1 },
});

const baseInput = {
  context: { element: 'ice', skillType: 'B' } as const,
  damageBonus: {
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
  },
  baseSkillMultiplier: 1,
};

assertClose(
  calculateHitBuffZones({
    ...baseInput,
    buffs: [ordinary, coldMultiplier],
  }).vulnerability.finalValue,
  1.22,
  'element multiplier should multiply only matched vulnerability bonuses'
);

assertClose(
  calculateHitBuffZones({
    ...baseInput,
    buffs: [ordinary, magicMultiplier, coldMultiplier],
  }).vulnerability.finalValue,
  1.242,
  'multiple matched multipliers should multiply vulnerability bonuses independently'
);

assertClose(
  calculateHitBuffZones({
    ...baseInput,
    buffs: [countable, magicMultiplier, coldMultiplier],
    stackCounts: { countable: 2 },
  }).vulnerability.finalValue,
  1.484,
  'countable additive contribution should resolve before multiplier aggregation without scaling the base zone value'
);

const allZoneMultiplierResult = calculateHitBuffZones({
  ...baseInput,
  buffs: [
    buff('damage-bonus', 'iceDmgBonus', 0.16),
    buff('fragile', 'iceFragile', 0.16),
    buff('amplify', 'iceAmplify', 0.16),
    buff('damage-bonus-multiplier', 'iceDmgBonus', undefined, { multiplier: { coefficient: 1.5 } }),
    buff('fragile-multiplier', 'iceFragile', undefined, { multiplier: { coefficient: 1.5 } }),
    buff('amplify-multiplier', 'iceAmplify', undefined, { multiplier: { coefficient: 1.5 } }),
  ],
});

assertClose(allZoneMultiplierResult.damageBonus.finalValue, 1.24, 'damage bonus multiplier should not scale the base 1');
assertClose(allZoneMultiplierResult.fragile.finalValue, 1.24, 'fragile multiplier should not scale the base 1');
assertClose(allZoneMultiplierResult.amplify.finalValue, 1.24, 'amplify multiplier should not scale the base 1');

assertClose(
  calculateHitBuffZones({
    ...baseInput,
    buffs: [ordinary],
  }).vulnerability.finalValue,
  1.2,
  'missing multiplier should preserve historical additive result'
);

const migratedLegacyMultiplier = normalizeStoredBuffDefinition(
  buff('legacy', 'multiplierMultiplier', 1.25)
);
if (
  migratedLegacyMultiplier.type !== 'multiplierBonus'
  || migratedLegacyMultiplier.value !== undefined
  || migratedLegacyMultiplier.multiplier?.coefficient !== 1.25
) {
  throw new Error('legacy multiplierMultiplier should migrate to multiplierBonus + multiplier.coefficient');
}
