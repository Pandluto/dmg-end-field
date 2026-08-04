import type { ElementType, HitSkillType, SkillType } from '../../types';
import type { SkillDamageCalcInputV2 } from './skillDamage.types';
import type {
  DamageBonusSnapshot,
  SkillButtonBuff,
} from '../../types/storage';

function createBuff(
  id: string,
  type: string,
  value: number | undefined,
  options: Partial<SkillButtonBuff> = {},
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'synthetic-full-multiplier-fixture',
    source: 'test',
    type,
    value,
    category: 'condition',
    effectKind: 'modifier',
    refCount: 1,
    ...options,
  };
}

function createMultiplierBuff(id: string, type: string, coefficient: number): SkillButtonBuff {
  return createBuff(id, type, undefined, { multiplier: { coefficient } });
}

const DERIVED_SOURCE_VALUES = {
  atk: 2400,
} as const;

function createDerivedBuff(
  id: string,
  type: string,
  source: keyof typeof DERIVED_SOURCE_VALUES,
  perPointValue: number,
  options: Partial<SkillButtonBuff> = {},
): SkillButtonBuff {
  // The pure skill calculator consumes resolved `value`; derived-source resolution belongs to its caller.
  const value = DERIVED_SOURCE_VALUES[source] * perPointValue;
  return createBuff(id, type, value, {
    valueMode: 'derived',
    derivedValue: { source, perPointValue },
    ...options,
  });
}

function createHit(
  key: string,
  displayName: string,
  multiplier: number,
  element: ElementType,
  skillType: HitSkillType,
) {
  return { key, displayName, multiplier, element, skillType };
}

const panelBase = {
  baseAtk: 1800,
  characterAtk: 720,
  weaponAtk: 380,
  weaponAtkPercent: 12,
  abilityBonus: 8,
  critRate: 0.21,
  critDmg: 0.62,
  strength: 150,
  agility: 100,
  intelligence: 80,
  will: 70,
  mainStatFinal: 168,
  subStatFinal: 112,
  mainStatRaw: 140,
  subStatRaw: 100,
  mainStatField: 'strength' as const,
  subStatField: 'agility' as const,
  mainStatScale: 0.10,
  subStatScale: 0.05,
  allStatScale: 0.08,
};

const buffs: SkillButtonBuff[] = [
  // Attack zone: additive attack, fixed attack, ability flats/additives, and ability multipliers.
  createBuff('atk-percent', 'atkPercentBoost', 0.12),
  createBuff('flat-atk', 'flatAtk', 85),
  createBuff('main-flat', 'mainStat', 12),
  createBuff('sub-flat', 'subStat', 9),
  createBuff('main-additive', 'mainStatBoost', 0.08),
  createBuff('sub-additive', 'subStatBoost', 0.06),
  createBuff('all-additive', 'allStatBoost', 0.04),
  createBuff('strength-flat', 'strengthBoost', 10),
  createBuff('agility-flat', 'agilityBoost', 7),
  createMultiplierBuff('main-multiplier', 'mainStatBoost', 1.10),
  createMultiplierBuff('sub-multiplier', 'subStatBoost', 1.08),
  createMultiplierBuff('all-multiplier', 'allStatBoost', 1.05),
  createMultiplierBuff('strength-multiplier', 'strengthBoost', 1.04),
  createMultiplierBuff('agility-multiplier', 'agilityBoost', 1.03),

  // Crit zone.
  createBuff('crit-rate', 'critRateBoost', 0.15),
  createBuff('crit-damage', 'critDmgBonusBoost', 0.22),

  // Damage-bonus zone. The hidden allElementDmgBonus panel field is intentional:
  // the calculator reads it even though DamageBonusSnapshot does not declare it.
  createBuff('all-damage', 'allDmgBonus', 0.10, { category: 'passive' }),
  createBuff('magic-damage', 'magicDmgBonus', 0.08),
  createBuff('all-element-damage', 'allElementDmgBonus', 0.09),
  createBuff('fire-damage', 'fireDmgBonus', 0.11),
  createBuff('physical-damage', 'physicalDmgBonus', 0.13),
  createBuff('skill-damage', 'skillDmgBonus', 0.12),
  createBuff('chain-damage', 'chainSkillDmgBonus', 0.14),
  createBuff('all-skill-damage', 'allSkillDmgBonus', 0.05),
  createMultiplierBuff('fire-damage-multiplier', 'fireDmgBonus', 1.10),
  createMultiplierBuff('physical-damage-multiplier', 'physicalDmgBonus', 1.12),

  // Fragile (易伤) zone: fire and magic apply to the fire hit; physical applies to the physical hit.
  createBuff('magic-fragile', 'magicFragile', 0.07),
  createBuff('fire-fragile', 'fireFragile', 0.10),
  createBuff('physical-fragile', 'physicalFragile', 0.08),
  createMultiplierBuff('magic-fragile-multiplier', 'magicFragile', 1.10),
  createMultiplierBuff('fire-fragile-multiplier', 'fireFragile', 1.20),
  createMultiplierBuff('physical-fragile-multiplier', 'physicalFragile', 1.15),

  // Vulnerability (脆弱) zone.
  createBuff('magic-vulnerability', 'magicVulnerability', 0.06),
  createBuff('fire-vulnerability', 'fireVulnerability', 0.09),
  createBuff('physical-vulnerability', 'physicalVulnerability', 0.07),
  createMultiplierBuff('magic-vulnerability-multiplier', 'magicVulnerability', 1.12),
  createMultiplierBuff('fire-vulnerability-multiplier', 'fireVulnerability', 1.15),
  createMultiplierBuff('physical-vulnerability-multiplier', 'physicalVulnerability', 1.10),

  // Amplify zone.
  createBuff('magic-amplify', 'magicAmplify', 0.05),
  createBuff('fire-amplify', 'fireAmplify', 0.08),
  createBuff('physical-amplify', 'physicalAmplify', 0.06),
  createMultiplierBuff('magic-amplify-multiplier', 'magicAmplify', 1.18),
  createMultiplierBuff('fire-amplify-multiplier', 'fireAmplify', 1.25),
  createMultiplierBuff('physical-amplify-multiplier', 'physicalAmplify', 1.14),

  // Skill multiplier zone.
  createBuff('skill-multiplier-additive', 'multiplierBonus', 0.35),
  createMultiplierBuff('skill-multiplier-multiplier', 'multiplierBonus', 1.18),

  // Resistance zone: values are percentage points, not ratios.
  createBuff('all-corrosion', 'allCorrosion', 6),
  createBuff('magic-corrosion', 'magicCorrosion', 5),
  createBuff('fire-corrosion', 'fireCorrosion', 4),
  createBuff('physical-corrosion', 'physicalCorrosion', 3),
  createBuff('all-resistance-ignore', 'allResistanceIgnore', 2),
  createBuff('magic-resistance-ignore', 'magicResistanceIgnore', 3),
  createBuff('fire-resistance-ignore', 'fireResistanceIgnore', 5),
  createBuff('physical-resistance-ignore', 'physicalResistanceIgnore', 4),

  // Combo and imbalance zones.
  createBuff('combo-direct', 'comboDamageBonus', 0.08),
  createBuff('combo-countable', 'comboDamageBonus', 0.06, { category: 'countable', maxStacks: 3 }),
  createDerivedBuff('combo-derived', 'comboDamageBonus', 'atk', 0.000025),
  createBuff('imbalance', 'imbalanceDmgBonus', 0.17),
];

const damageBonus = {
  physicalDmgBonus: 0.09,
  fireDmgBonus: 0.07,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0.04,
  allElementDmgBonus: 0.05,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0.13,
  chainSkillDmgBonus: 0.11,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0.05,
  imbalanceDmgBonus: 0.12,
  allDmgBonus: 0.06,
} as DamageBonusSnapshot & { allElementDmgBonus: number };

export const FULL_MULTIPLIER_FIXTURE: SkillDamageCalcInputV2 = {
  buttonId: 'synthetic-full-multiplier-button',
  characterId: 'synthetic-full-multiplier-character',
  runtimeSkillId: 'synthetic-full-multiplier-skill',
  template: {
    characterId: 'synthetic-full-multiplier-character',
    characterName: 'Synthetic Full Multiplier Character',
    runtimeSkillId: 'synthetic-full-multiplier-skill',
    displayName: 'Synthetic Full Multiplier Skill',
    buttonType: 'B' as SkillType,
    hits: [
      createHit('fire-b', 'Fire B hit', 2.4, 'fire', 'B'),
      createHit('physical-e', 'Physical E hit', 1.7, 'physical', 'E'),
    ],
  },
  buffs,
  buffStackCounts: { 'combo-countable': 2 },
  panel: { atk: 1800, critRate: 0.21, critDmg: 0.62 },
  panelBase,
  damageBonus,
  targetResistance: {
    fireResistance: 38,
    physicalResistance: 31,
  },
};

export const FULL_MULTIPLIER_GOLDEN = {
  panel: {
    rawAtk: 1100,
    weaponAtkRate: 0.12,
    atkPercentBoost: 0.12,
    flatAtk: 85,
    fixedAtk: 567.9999999999998,
    attackBaseAfterBuff: 1932,
    main: {
      rawValue: 140,
      directionalFlatBoost: 22,
      baseStatScale: 0.10,
      statBuffRate: 0.08,
      statAdditiveRate: 0.18,
      baseAllStatScale: 0.08,
      allStatBuffRate: 0.04,
      allStatAdditiveRate: 0.12,
      directionalMultiplier: 1.04,
      statMultiplier: 1.10,
      allStatMultiplier: 1.05,
      valueBeforeRounding: 257.1759590400001,
      finalValue: 257,
      attackBonus: 1.285,
    },
    sub: {
      rawValue: 100,
      directionalFlatBoost: 16,
      baseStatScale: 0.05,
      statBuffRate: 0.06,
      statAdditiveRate: 0.11,
      baseAllStatScale: 0.08,
      allStatBuffRate: 0.04,
      allStatAdditiveRate: 0.12,
      directionalMultiplier: 1.03,
      statMultiplier: 1.08,
      allStatMultiplier: 1.05,
      valueBeforeRounding: 168.44156582400007,
      finalValue: 168,
      attackBonus: 0.336,
    },
    abilityBonus: 1.621,
    finalAtk: 5063.772,
    critRate: 0.36,
    critDmg: 0.84,
  },
  hits: [
    {
      zones: {
        elementBonus: 0.44,
        skillBonus: 0.35,
        allDamageBonus: 0.16,
        damageBonus: { additiveTotal: 0.55, multiplierProduct: 1.10, finalValue: 2.005 },
        amplify: { additiveTotal: 0.13, multiplierProduct: 1.4749999999999999, finalValue: 1.1917499999999999 },
        fragile: { additiveTotal: 0.17, multiplierProduct: 1.32, finalValue: 1.2244 },
        vulnerability: { additiveTotal: 0.15, multiplierProduct: 1.288, finalValue: 1.1932 },
        skillMultiplier: { additiveTotal: 0.35, multiplierProduct: 1.18, finalValue: 3.2449999999999997 },
        resistance: { baseResistance: 38, corrosion: 15, resistanceIgnore: 10, effectiveResistance: 23, resistanceZone: 0.87 },
        comboDamageBonus: 0.26,
        imbalanceDamageBonus: 0.17,
        defenseZone: 0.5,
      },
      multiplier: { base: 2.4, afterBonus: 2.75, afterMultiply: 3.2449999999999997 },
      breakdown: {
        nonCrit: {
          base: 16431.94014,
          afterCrit: 16431.94014,
          afterBonus: 32946.0399807,
          afterDefense: 16473.01999035,
          afterResistance: 14331.527391604499,
          afterAmplify: 17079.59776894466,
          afterFragile: 20912.25950829584,
          afterVulnerability: 24952.508045298597,
          afterCombo: 31440.160137076233,
          final: 36784.98736037919,
        },
        crit: {
          base: 16431.94014,
          afterCrit: 30234.769857599997,
          afterBonus: 60620.71356448799,
          afterDefense: 30310.356782243995,
          afterResistance: 26370.010400552273,
          afterAmplify: 31426.45989485817,
          afterFragile: 38478.557495264344,
          afterVulnerability: 45912.61480334942,
          afterCombo: 57849.89465222027,
          final: 67684.3767430977,
        },
        expected: {
          base: 16431.94014,
          afterCrit: 21400.958838336,
          afterBonus: 42908.922470863676,
          afterDefense: 21454.461235431838,
          afterResistance: 18665.3812748257,
          afterAmplify: 22244.468134273528,
          afterFragile: 27236.126783604504,
          afterVulnerability: 32498.146478196897,
          afterCombo: 40947.66456252809,
          final: 47908.76753815786,
        },
      },
    },
    {
      zones: {
        elementBonus: 0.22,
        skillBonus: 0.35,
        allDamageBonus: 0.16,
        damageBonus: { additiveTotal: 0.42, multiplierProduct: 1.12, finalValue: 1.7804000000000002 },
        amplify: { additiveTotal: 0.06, multiplierProduct: 1.14, finalValue: 1.0684 },
        fragile: { additiveTotal: 0.08, multiplierProduct: 1.15, finalValue: 1.092 },
        vulnerability: { additiveTotal: 0.07, multiplierProduct: 1.1, finalValue: 1.077 },
        skillMultiplier: { additiveTotal: 0.35, multiplierProduct: 1.18, finalValue: 2.4189999999999996 },
        resistance: { baseResistance: 31, corrosion: 9, resistanceIgnore: 6, effectiveResistance: 22, resistanceZone: 0.8400000000000001 },
        comboDamageBonus: 0.26,
        imbalanceDamageBonus: 0.29000000000000004,
        defenseZone: 0.5,
      },
      multiplier: { base: 1.7, afterBonus: 2.05, afterMultiply: 2.4189999999999996 },
      breakdown: {
        nonCrit: {
          base: 12249.264467999998,
          afterCrit: 12249.264467999998,
          afterBonus: 21808.5904588272,
          afterDefense: 10904.2952294136,
          afterResistance: 9159.607992707424,
          afterAmplify: 9786.125179408613,
          afterFragile: 10686.448695914207,
          afterVulnerability: 11509.3052454996,
          afterCombo: 14501.724609329496,
          final: 18707.22474603505,
        },
        crit: {
          base: 12249.264467999998,
          afterCrit: 22538.646621119995,
          afterBonus: 40127.806444242044,
          afterDefense: 20063.903222121022,
          afterResistance: 16853.67870658166,
          afterAmplify: 18006.470330111846,
          afterFragile: 19663.065600482136,
          afterVulnerability: 21177.12165171926,
          afterCombo: 26683.173281166266,
          final: 34421.29353270448,
        },
        expected: {
          base: 12249.264467999998,
          afterCrit: 15953.442043123197,
          afterBonus: 28403.508213576544,
          afterDefense: 14201.754106788272,
          afterResistance: 11929.473449702149,
          afterAmplify: 12745.449433661775,
          afterFragile: 13918.03078155866,
          afterVulnerability: 14989.719151738676,
          afterCombo: 18887.04613119073,
          final: 24364.289509236045,
        },
      },
    },
  ],
  summary: {
    totalExpected: 72273.0570473939,
    totalCrit: 102105.67027580219,
    totalNonCrit: 55492.21210641424,
  },
} as const;
