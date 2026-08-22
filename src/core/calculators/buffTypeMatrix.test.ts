import type { SkillButtonBuff } from '../../types/storage';
import { BUFF_TYPE_LABELS } from '../domain/buffTypeMetadata';
import { BUFF_TYPE_REGISTRY } from '../domain/buffTypeRegistry';
import { normalizeStoredBuffDefinition } from '../services/buffStorageNormalization';
import {
  calculateBuffTotals,
  calculateResistanceZone,
  type BuffCalculationResult,
} from './buffCalculator';
import { calculateHitBuffZones } from './buffZoneCalculator';
import {
  buildConfigSnapshot,
  type OperatorPanelInput,
} from './operatorPanelCalculator';

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

function assertArrayEqual(actual: string[], expected: string[], message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function buff(
  id: string,
  type: string,
  value: number | undefined,
  options: Partial<SkillButtonBuff> = {},
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'complete-buff-type-matrix',
    source: 'test',
    type,
    value,
    category: 'condition',
    effectKind: 'modifier',
    refCount: 1,
    ...options,
  };
}

/**
 * Every public Buff type must belong to exactly one executable contract:
 * - runtime: consumed by the hit/panel runtime calculator;
 * - panel: resolved while constructing the operator panel;
 * - migration: accepted only as a historical storage alias.
 */
const RUNTIME_TOTAL_FIELD_BY_TYPE = {
  atkPercentBoost: 'atkPercentBoost',
  flatAtk: 'flatAtk',
  mainStat: 'mainStat',
  subStat: 'subStat',
  mainStatBoost: 'mainStatBoost',
  subStatBoost: 'subStatBoost',
  allStatBoost: 'allStatBoost',
  strengthBoost: 'strengthBoost',
  agilityBoost: 'agilityBoost',
  intelligenceBoost: 'intelligenceBoost',
  willBoost: 'willBoost',
  critRateBoost: 'critRateBoost',
  critDmgBonusBoost: 'critDmgBonusBoost',
  physicalDmgBonus: 'physicalDmgBonus',
  magicDmgBonus: 'magicDmgBonus',
  fireDmgBonus: 'fireDmgBonus',
  electricDmgBonus: 'electricDmgBonus',
  iceDmgBonus: 'iceDmgBonus',
  natureDmgBonus: 'natureDmgBonus',
  // Historical runtime behavior folds all-element into the magic bucket.
  allElementDmgBonus: 'magicDmgBonus',
  allDmgBonus: 'allDmgBonus',
  skillDmgBonus: 'skillDmgBonus',
  chainSkillDmgBonus: 'chainSkillDmgBonus',
  ultimateDmgBonus: 'ultimateDmgBonus',
  normalAttackDmgBonus: 'normalAttackDmgBonus',
  dotDmgBonus: 'dotDmgBonus',
  allSkillDmgBonus: 'allSkillDmgBonus',
  physicalFragile: 'physicalFragile',
  fireFragile: 'fireFragile',
  electricFragile: 'electricFragile',
  iceFragile: 'iceFragile',
  natureFragile: 'natureFragile',
  magicFragile: 'magicFragile',
  physicalVulnerability: 'physicalVulnerability',
  fireVulnerability: 'fireVulnerability',
  electricVulnerability: 'electricVulnerability',
  iceVulnerability: 'iceVulnerability',
  natureVulnerability: 'natureVulnerability',
  magicVulnerability: 'magicVulnerability',
  physicalAmplify: 'physicalAmplify',
  magicAmplify: 'magicAmplify',
  fireAmplify: 'fireAmplify',
  electricAmplify: 'electricAmplify',
  iceAmplify: 'iceAmplify',
  natureAmplify: 'natureAmplify',
  allCorrosion: 'allCorrosion',
  physicalCorrosion: 'physicalCorrosion',
  magicCorrosion: 'magicCorrosion',
  fireCorrosion: 'fireCorrosion',
  electricCorrosion: 'electricCorrosion',
  iceCorrosion: 'iceCorrosion',
  natureCorrosion: 'natureCorrosion',
  allResistanceIgnore: 'allResistanceIgnore',
  physicalResistanceIgnore: 'physicalResistanceIgnore',
  magicResistanceIgnore: 'magicResistanceIgnore',
  fireResistanceIgnore: 'fireResistanceIgnore',
  electricResistanceIgnore: 'electricResistanceIgnore',
  iceResistanceIgnore: 'iceResistanceIgnore',
  natureResistanceIgnore: 'natureResistanceIgnore',
  comboDamageBonus: 'comboDamageBonus',
  imbalanceDmgBonus: 'imbalanceDamageBonus',
  multiplierBonus: 'multiplierBonus',
  sourceSkillBoost: 'sourceSkillBoost',
} as const satisfies Record<string, keyof BuffCalculationResult>;

const PANEL_ONLY_TYPES = [
  'atk',
  'hp',
  'hpPercent',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
  'fireNatureDmgBonus',
  'iceElectricDmgBonus',
] as const;

const MIGRATION_ONLY_TYPES = ['multiplierMultiplier'] as const;

const classifiedTypes = [
  ...Object.keys(RUNTIME_TOTAL_FIELD_BY_TYPE),
  ...PANEL_ONLY_TYPES,
  ...MIGRATION_ONLY_TYPES,
].sort();
const metadataTypes = Object.keys(BUFF_TYPE_LABELS).sort();
assertArrayEqual(classifiedTypes, metadataTypes, 'all public Buff types must have an explicit calculation contract');
assertEqual(new Set(classifiedTypes).size, classifiedTypes.length, 'Buff type contracts must not overlap');

Object.entries(RUNTIME_TOTAL_FIELD_BY_TYPE).forEach(([type, field], index) => {
  const value = 0.01 + index * 0.001;
  const totals = calculateBuffTotals([buff(`runtime-${type}`, type, value)]);
  assertClose(totals[field], value, `${type} should reach runtime total ${field}`);
});

const legacyMultiplier = normalizeStoredBuffDefinition(buff(
  'legacy-multiplier',
  'multiplierMultiplier',
  1.17,
));
assertEqual(legacyMultiplier.type, 'multiplierBonus', 'legacy multiplier type should migrate to multiplierBonus');
assertEqual(legacyMultiplier.value, undefined, 'legacy multiplier migration should remove additive value');
assertClose(
  legacyMultiplier.multiplier?.coefficient ?? 0,
  1.17,
  'legacy multiplier migration should preserve its coefficient',
);

const legacyPassiveExtraHit = normalizeStoredBuffDefinition(buff(
  'legacy-passive-extra-hit',
  '',
  0,
  {
    effectKind: 'extraHit',
    category: 'passive',
    maxStacks: 9,
    extraHitConfig: {
      key: 'legacy-passive-extra-hit',
      damageType: 'physical',
      skillType: '',
      baseMultiplier: 1,
      imbalanceValue: 0,
      cooldownSeconds: 0,
      trigger: 'physicalAbnormal',
    },
  },
));
assertEqual(legacyPassiveExtraHit.category, 'condition', 'legacy passive extraHit should fall back to condition');
assertEqual(legacyPassiveExtraHit.maxStacks, undefined, 'condition extraHit should not retain a stale maxStacks');
assertEqual(legacyPassiveExtraHit.extraHitConfig?.formulaMode, 'inherited', 'legacy extraHit should preserve the original formula by default');

const countableExtraHit = normalizeStoredBuffDefinition({
  ...legacyPassiveExtraHit,
  id: 'countable-extra-hit',
  category: 'countable' as const,
  maxStacks: undefined,
});
assertEqual(countableExtraHit.category, 'countable', 'explicit countable extraHit should stay countable');
assertEqual(countableExtraHit.maxStacks, 1, 'countable extraHit without maxStacks should default to one segment');

const PANEL_BASE_INPUT: OperatorPanelInput = {
  operator: {
    id: 'buff-matrix-panel-operator',
    name: 'Buff 矩阵面板干员',
    level: 90,
    potential: '0潜',
    element: 'fire',
    mainStat: '力量',
    subStat: '敏捷',
    mainStatFlatBonus: 0,
    subStatFlatBonus: 0,
    attributes: {
      level90: {
        atk: 1000,
        hp: 10000,
        strength: 100,
        agility: 80,
        intelligence: 60,
        will: 40,
      },
    },
  },
  equipment: { pieces: [], setBuffs: [] },
};

function buildPanelWithBuff(type: string, value: number) {
  return buildConfigSnapshot({
    ...PANEL_BASE_INPUT,
    operator: {
      ...PANEL_BASE_INPUT.operator,
      buffs: {
        talent: {
          effects: {
            matrix: {
              effectId: `panel-${type}`,
              name: type,
              type,
              value,
              category: 'passive',
            },
          },
        },
        potential: { effects: {} },
        skill: { effects: {} },
      },
    },
  });
}

assertClose(buildPanelWithBuff('atk', 75).panel.calc.flatAtk, 75, 'atk panel alias should become fixed attack');
assertClose(buildPanelWithBuff('hp', 0.2).panel.calc.hpPercent, 0.2, 'hp panel alias should become hpPercent');
assertClose(buildPanelWithBuff('hp', 0.2).panel.display.hp, 12000, 'hp panel alias should scale displayed HP');
assertClose(buildPanelWithBuff('hpPercent', 0.25).panel.display.hp, 12500, 'hpPercent should scale displayed HP');
([
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
] as const).forEach((type, index) => {
  const value = 0.11 + index * 0.01;
  const snapshot = buildPanelWithBuff(type, value);
  assertClose(snapshot.panel.calc[type], value, `${type} should survive operator panel calculation`);
});

const fireNaturePanel = buildPanelWithBuff('fireNatureDmgBonus', 0.21).panel.calc.damageBonus;
assertClose(fireNaturePanel.fireDmgBonus, 0.21, 'fireNatureDmgBonus should reach fire damage');
assertClose(fireNaturePanel.natureDmgBonus, 0.21, 'fireNatureDmgBonus should reach nature damage');
assertClose(fireNaturePanel.electricDmgBonus, 0, 'fireNatureDmgBonus should not reach electric damage');
const iceElectricPanel = buildPanelWithBuff('iceElectricDmgBonus', 0.22).panel.calc.damageBonus;
assertClose(iceElectricPanel.iceDmgBonus, 0.22, 'iceElectricDmgBonus should reach ice damage');
assertClose(iceElectricPanel.electricDmgBonus, 0.22, 'iceElectricDmgBonus should reach electric damage');
assertClose(iceElectricPanel.fireDmgBonus, 0, 'iceElectricDmgBonus should not reach fire damage');

const DERIVED_SOURCES = ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] as const;
DERIVED_SOURCES.forEach((source) => {
  const perPointValue = 0.0001;
  const sourceSkillBaseEffect = source === 'sourceSkill'
    ? {
        baseSourceSkill: {
          effectId: 'derived-source-skill-base',
          name: '派生测试源石技艺基值',
          type: 'sourceSkillBoost',
          value: 25,
          category: 'passive' as const,
        },
      }
    : {};
  const snapshot = buildConfigSnapshot({
    ...PANEL_BASE_INPUT,
    operator: {
      ...PANEL_BASE_INPUT.operator,
      buffs: {
        talent: {
          effects: {
            ...sourceSkillBaseEffect,
            derived: {
              effectId: `derived-${source}`,
              name: `${source} 派生全伤`,
              type: 'allDmgBonus',
              category: 'passive',
              valueMode: 'derived',
              derivedValue: { source, perPointValue },
            },
          },
        },
        potential: { effects: {} },
        skill: { effects: {} },
      },
    },
  });
  const display = snapshot.panel.display;
  const sourceValue = source === 'hp'
    ? display.hp
    : source === 'atk'
      ? display.atk
      : source === 'sourceSkill'
        ? display.sourceSkill
        : display.abilityValues[source];
  const expected = sourceValue * perPointValue;
  const resolvedEffect = snapshot.operator.buffs.talent.effects.derived;
  assertClose(resolvedEffect.value ?? 0, expected, `${source} derived Buff should persist its resolved value`);
  assertClose(snapshot.panel.calc.damageBonus.allDmgBonus, expected, `${source} derived Buff should enter panel totals`);
});

const ZERO_DAMAGE_BONUS = {
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

const zoneBuffs = [...BUFF_TYPE_REGISTRY.keys()].map((type) => buff(`zone-${type}`, type, 0.01));
const ZONE_CONTEXT_EXPECTATIONS = [
  {
    element: 'physical' as const,
    skillType: 'A' as const,
    types: [
      'physicalDmgBonus', 'allDmgBonus', 'normalAttackDmgBonus',
      'physicalFragile', 'physicalVulnerability', 'physicalAmplify', 'multiplierBonus',
    ],
  },
  {
    element: 'fire' as const,
    skillType: 'A' as const,
    types: [
      'magicDmgBonus', 'allElementDmgBonus', 'fireDmgBonus', 'allDmgBonus', 'normalAttackDmgBonus',
      'magicFragile', 'fireFragile', 'magicVulnerability', 'fireVulnerability',
      'magicAmplify', 'fireAmplify', 'multiplierBonus',
    ],
  },
  {
    element: 'electric' as const,
    skillType: 'B' as const,
    types: [
      'magicDmgBonus', 'allElementDmgBonus', 'electricDmgBonus', 'allDmgBonus',
      'skillDmgBonus', 'allSkillDmgBonus', 'magicFragile', 'electricFragile',
      'magicVulnerability', 'electricVulnerability', 'magicAmplify', 'electricAmplify',
      'multiplierBonus',
    ],
  },
  {
    element: 'ice' as const,
    skillType: 'E' as const,
    types: [
      'magicDmgBonus', 'allElementDmgBonus', 'iceDmgBonus', 'allDmgBonus',
      'chainSkillDmgBonus', 'allSkillDmgBonus', 'magicFragile', 'iceFragile',
      'magicVulnerability', 'iceVulnerability', 'magicAmplify', 'iceAmplify',
      'multiplierBonus',
    ],
  },
  {
    element: 'nature' as const,
    skillType: 'Q' as const,
    types: [
      'magicDmgBonus', 'allElementDmgBonus', 'natureDmgBonus', 'allDmgBonus',
      'ultimateDmgBonus', 'allSkillDmgBonus', 'magicFragile', 'natureFragile',
      'magicVulnerability', 'natureVulnerability', 'magicAmplify', 'natureAmplify',
      'multiplierBonus',
    ],
  },
  {
    element: 'fire' as const,
    skillType: 'Dot' as const,
    types: [
      'magicDmgBonus', 'allElementDmgBonus', 'fireDmgBonus', 'allDmgBonus', 'dotDmgBonus',
      'magicFragile', 'fireFragile', 'magicVulnerability', 'fireVulnerability',
      'magicAmplify', 'fireAmplify', 'multiplierBonus',
    ],
  },
] as const;

ZONE_CONTEXT_EXPECTATIONS.forEach(({ element, skillType, types }) => {
  const result = calculateHitBuffZones({
    context: { element, skillType },
    buffs: zoneBuffs,
    damageBonus: ZERO_DAMAGE_BONUS,
    baseSkillMultiplier: 1,
  });
  assertArrayEqual(
    result.contributions.map((item) => item.type).sort(),
    [...types].sort(),
    `${element}/${skillType} should match the exact Buff zone set`,
  );
});

assertArrayEqual(
  [...new Set(ZONE_CONTEXT_EXPECTATIONS.flatMap((item) => [...item.types]))].sort(),
  [...BUFF_TYPE_REGISTRY.keys()].sort(),
  'zone contexts should exercise every registered damage type',
);

for (const type of BUFF_TYPE_REGISTRY.keys()) {
  const matchingContext = ZONE_CONTEXT_EXPECTATIONS.find((item) => item.types.includes(type as never));
  if (!matchingContext) throw new Error(`no direct-multiplier context for ${type}`);
  const result = calculateHitBuffZones({
    context: { element: matchingContext.element, skillType: matchingContext.skillType },
    buffs: [buff(`zone-multiplier-${type}`, type, undefined, { multiplier: { coefficient: 1.1 } })],
    damageBonus: ZERO_DAMAGE_BONUS,
    baseSkillMultiplier: 1,
  });
  const contribution = result.contributions[0];
  if (!contribution) throw new Error(`${type} direct multiplier did not contribute`);
  assertEqual(contribution.multiplier, true, `${type} should retain direct-multiplier semantics`);
  assertClose(contribution.multiplierCoefficient ?? 0, 1.1, `${type} direct-multiplier coefficient`);
}

const resistanceBuffs = [
  buff('res-all-corrosion', 'allCorrosion', 1),
  buff('res-physical-corrosion', 'physicalCorrosion', 2),
  buff('res-magic-corrosion', 'magicCorrosion', 3),
  buff('res-fire-corrosion', 'fireCorrosion', 4),
  buff('res-electric-corrosion', 'electricCorrosion', 5),
  buff('res-ice-corrosion', 'iceCorrosion', 6),
  buff('res-nature-corrosion', 'natureCorrosion', 7),
  buff('res-all-ignore', 'allResistanceIgnore', 8),
  buff('res-physical-ignore', 'physicalResistanceIgnore', 9),
  buff('res-magic-ignore', 'magicResistanceIgnore', 10),
  buff('res-fire-ignore', 'fireResistanceIgnore', 11),
  buff('res-electric-ignore', 'electricResistanceIgnore', 12),
  buff('res-ice-ignore', 'iceResistanceIgnore', 13),
  buff('res-nature-ignore', 'natureResistanceIgnore', 14),
];
const resistanceTotals = calculateBuffTotals(resistanceBuffs);
([
  ['physical', 'physicalResistance', 3, 17],
  ['fire', 'fireResistance', 8, 29],
  ['electric', 'electricResistance', 9, 30],
  ['ice', 'iceResistance', 10, 31],
  ['nature', 'natureResistance', 11, 32],
] as const).forEach(([element, resistanceField, corrosion, resistanceIgnore]) => {
  const result = calculateResistanceZone(element, { [resistanceField]: 50 }, resistanceTotals);
  assertClose(result.baseResistance, 50, `${element} should read its configured target resistance`);
  assertClose(result.corrosion, corrosion, `${element} corrosion matrix`);
  assertClose(result.resistanceIgnore, resistanceIgnore, `${element} resistance-ignore matrix`);
  assertClose(
    result.resistanceZone,
    1 - (50 - corrosion) / 100 + resistanceIgnore / 100,
    `${element} resistance operation order`,
  );
});

const categoryBuffs = [
  buff('category-condition', 'allDmgBonus', 0.1, { category: 'condition' }),
  buff('category-passive', 'allDmgBonus', 0.2, { category: 'passive' }),
  buff('category-countable', 'allDmgBonus', 0.3, { category: 'countable', maxStacks: 4 }),
];
assertClose(
  calculateBuffTotals(categoryBuffs, { 'category-countable': 2 }).allDmgBonus,
  0.9,
  'condition, passive, and explicit countable stacks should all resolve',
);
assertClose(
  calculateBuffTotals(categoryBuffs).allDmgBonus,
  1.5,
  'countable Buff should default to max stacks when no runtime count is stored',
);
