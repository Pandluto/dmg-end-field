import { buildConfigSnapshot, type EquipmentPieceInput, type OperatorPanelInput } from './operatorPanelCalculator';
import type { ResolvedSkillDamageTemplate, SkillDamageCalcInputV2, SkillDamagePanelBase } from './skillDamage.types';
import type { ElementType, HitSkillType, SkillType, TimelineData } from '../../types';
import type {
  AnomalyStateSnapshot,
  DamageBonusSnapshot,
  PersistedAnomalyCard,
  PersistedSkillButton,
  SkillButtonBuff,
  SkillButtonTable,
} from '../../types/storage';
import type { LocalDataArchive } from '../../platform/data/localDataPackages';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { LegacyTimelineArchive } from '../../platform/timeline/browserTimelineStore';
import { BUFF_TYPE_LABELS } from '../domain/buffTypeMetadata';

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

function createMultiplierBuff(
  id: string,
  type: string,
  coefficient: number,
  options: Partial<SkillButtonBuff> = {},
): SkillButtonBuff {
  return createBuff(id, type, undefined, { ...options, multiplier: { coefficient } });
}

const DERIVED_SOURCE_VALUES = {
  atk: 2400,
} as const;

export function createFixtureDerivedBuff(
  id: string,
  type: string,
  source: keyof typeof DERIVED_SOURCE_VALUES,
  perPointValue: number,
  options: Partial<SkillButtonBuff> = {},
): SkillButtonBuff {
  // SkillButtonDamageV2 consumes resolved `value`; derived-source resolution belongs to the caller.
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

const operatorBuffs: NonNullable<OperatorPanelInput['operator']['buffs']> = {
  talent: {
    effects: {
      'talent-main-scale': {
        effectId: 'talent-main-scale',
        name: '测试主能力缩放',
        type: 'mainStatBoost',
        category: 'passive',
        value: 0.10,
      },
      'talent-all-scale': {
        effectId: 'talent-all-scale',
        name: '测试全能力缩放',
        type: 'allStatBoost',
        category: 'passive',
        value: 0.08,
      },
      'talent-flat-atk': {
        effectId: 'talent-flat-atk',
        name: '测试固定攻击',
        type: 'flatAtk',
        category: 'positive',
        value: 568,
      },
    },
  },
  potential: { effects: {} },
  skill: {
    effects: {
      'skill-sub-scale': {
        effectId: 'skill-sub-scale',
        name: '测试副能力缩放',
        type: 'subStatBoost',
        category: 'passive',
        value: 0.05,
      },
      'skill-crit-rate': {
        effectId: 'skill-crit-rate',
        name: '测试暴击率',
        type: 'critRateBoost',
        category: 'positive',
        value: 0.15,
      },
      'skill-crit-damage': {
        effectId: 'skill-crit-damage',
        name: '测试暴击伤害',
        type: 'critDmgBonusBoost',
        category: 'positive',
        value: 0.22,
      },
      'skill-derived-attack': {
        effectId: 'skill-derived-attack',
        name: '测试派生攻击',
        type: 'atkPercentBoost',
        category: 'passive',
        valueMode: 'derived',
        derivedValue: { source: 'agility', perPointValue: 0.0005 },
      },
    },
  },
};

const weaponData = {
  attackGrowth: { '90': 380 },
  skills: {
    skill1: {
      name: '测试力量提升',
      statType: '力量提升',
      levels: { '9': { value: 6 } },
    },
    skill2: {
      name: '测试灼热伤害提升',
      statType: '灼热伤害提升',
      levels: { '9': { value: 0.07 } },
    },
    skill3: {
      effects: {
        skill: {
          name: '测试战技伤害',
          type: 'skillDmgBonus',
          category: 'passive',
          levels: { '4': 0.13 },
        },
        magic: {
          name: '测试法术伤害',
          type: 'magicDmgBonus',
          category: 'passive',
          levels: { '4': 0.09 },
        },
        condition: {
          name: '测试条件电磁伤害',
          type: 'electricDmgBonus',
          category: 'condition',
          levels: { '4': 0.05 },
        },
        multiplier: {
          name: '测试条件电磁倍率',
          type: 'electricDmgBonus',
          category: 'condition',
          levels: { '4': 1.08 },
          multiplier: { coefficient: 1.08 },
        },
      },
    },
  },
} satisfies NonNullable<OperatorPanelInput['weapon']>['data'];

function createEquipmentPiece(
  slotKey: string,
  equipmentId: string,
  name: string,
  part: string,
  effect: EquipmentPieceInput['effects'][number],
): EquipmentPieceInput {
  return { slotKey, equipmentId, name, part, effects: [effect] };
}

const equipmentPieces: EquipmentPieceInput[] = [
  createEquipmentPiece('accessory1', 'fixture-equipment-1', '测试配件一', '配件', {
    effectId: 'effect1', label: '物理伤害', typeKey: 'physicalDmgBonus', level: 3, value: 0.09, unit: 'percent',
  }),
  createEquipmentPiece('accessory2', 'fixture-equipment-2', '测试配件二', '配件', {
    effectId: 'effect1', label: '连携技伤害', typeKey: 'chainSkillDmgBonus', level: 3, value: 0.11, unit: 'percent',
  }),
  createEquipmentPiece('armor', 'fixture-equipment-3', '测试护甲', '护甲', {
    effectId: 'effect1', label: '所有技能伤害', typeKey: 'allSkillDmgBonus', level: 3, value: 0.05, unit: 'percent',
  }),
  createEquipmentPiece('glove', 'fixture-equipment-4', '测试护手', '护手', {
    effectId: 'effect1', label: '失衡目标伤害', typeKey: 'imbalanceDmgBonus', level: 3, value: 0.12, unit: 'percent',
  }),
];

const equipmentSetBuffs = [
  { effectId: 'set-atk', label: '测试套装攻击', typeKey: 'atkPercentBoost', level: '三件套', value: 0.12, unit: 'percent', gearSetId: 'fixture-set', gearSetName: '测试三件套', category: 'positive' as const },
  { effectId: 'set-all-damage', label: '测试套装全伤', typeKey: 'allDmgBonus', level: '三件套', value: 0.06, unit: 'percent', gearSetId: 'fixture-set', gearSetName: '测试三件套', category: 'passive' as const },
  { effectId: 'set-source-skill', label: '测试套装技艺', typeKey: 'sourceSkillBoost', level: '三件套', value: 12, unit: 'flat', gearSetId: 'fixture-set', gearSetName: '测试三件套', category: 'passive' as const },
  { effectId: 'set-nature-condition', label: '测试套装自然条件', typeKey: 'natureDmgBonus', level: '三件套', value: 0.08, unit: 'percent', gearSetId: 'fixture-set', gearSetName: '测试三件套', category: 'condition' as const },
];

export const SYNTHETIC_OPERATOR_PANEL_INPUT: OperatorPanelInput = {
  operator: {
    id: 'synthetic-full-multiplier-operator',
    name: '测试满乘区干员',
    level: 90,
    potential: '0潜',
    element: 'fire',
    mainStat: '力量',
    subStat: '敏捷',
    mainStatFlatBonus: 0,
    subStatFlatBonus: 0,
    attributes: {
      level90: {
        atk: 720,
        hp: 9000,
        strength: 134,
        agility: 100,
        intelligence: 80,
        will: 70,
      },
    },
    skillConfig: { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' },
    buffs: operatorBuffs,
  },
  weapon: {
    id: 'synthetic-full-multiplier-weapon',
    name: '测试满乘区武器',
    config: { level: 90, potential: '0潜', skillLevels: { skill1: 9, skill2: 9, skill3: 4 } },
    data: weaponData,
  },
  equipment: {
    pieces: equipmentPieces,
    setBuffs: equipmentSetBuffs,
  },
};

export const SYNTHETIC_CONFIG_SNAPSHOT = buildConfigSnapshot(SYNTHETIC_OPERATOR_PANEL_INPUT);

export function configSnapshotToSkillPanelBase(snapshot = SYNTHETIC_CONFIG_SNAPSHOT): SkillDamagePanelBase {
  const display = snapshot.panel.display;
  const calc = snapshot.panel.calc;
  return {
    baseAtk: display.baseAtk,
    characterAtk: calc.operatorAtk,
    weaponAtk: calc.weaponAtk,
    weaponAtkPercent: display.weaponAtkPercent,
    abilityBonus: display.abilityBonus,
    critRate: display.critRate,
    critDmg: display.critDmg,
    strength: display.abilityValues.strength,
    agility: display.abilityValues.agility,
    intelligence: display.abilityValues.intelligence,
    will: display.abilityValues.will,
    mainStatFinal: display.mainStatFinal,
    subStatFinal: display.subStatFinal,
    mainStatRaw: display.abilityDetail.rawMainStat,
    subStatRaw: display.abilityDetail.rawSubStat,
    mainStatField: 'strength',
    subStatField: 'agility',
    mainStatScale: display.abilityDetail.mainStatScale,
    subStatScale: display.abilityDetail.subStatScale,
    allStatScale: display.abilityDetail.allStatScale,
  };
}

export const SYNTHETIC_SKILL_PANEL_BASE = configSnapshotToSkillPanelBase();
export const SYNTHETIC_DAMAGE_BONUS = SYNTHETIC_CONFIG_SNAPSHOT.panel.calc.damageBonus as DamageBonusSnapshot;

// The comprehensive skill keeps every final damage zone active and includes two hit branches.
export const FULL_ZONE_BUFFS: SkillButtonBuff[] = [
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
  createBuff('crit-rate', 'critRateBoost', 0.15),
  createBuff('crit-damage', 'critDmgBonusBoost', 0.22),
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
  createBuff('magic-fragile', 'magicFragile', 0.07),
  createBuff('fire-fragile', 'fireFragile', 0.10),
  createBuff('physical-fragile', 'physicalFragile', 0.08),
  createMultiplierBuff('magic-fragile-multiplier', 'magicFragile', 1.10),
  createMultiplierBuff('fire-fragile-multiplier', 'fireFragile', 1.20),
  createMultiplierBuff('physical-fragile-multiplier', 'physicalFragile', 1.15),
  createBuff('magic-vulnerability', 'magicVulnerability', 0.06),
  createBuff('fire-vulnerability', 'fireVulnerability', 0.09),
  createBuff('physical-vulnerability', 'physicalVulnerability', 0.07),
  createMultiplierBuff('magic-vulnerability-multiplier', 'magicVulnerability', 1.12),
  createMultiplierBuff('fire-vulnerability-multiplier', 'fireVulnerability', 1.15),
  createMultiplierBuff('physical-vulnerability-multiplier', 'physicalVulnerability', 1.10),
  createBuff('magic-amplify', 'magicAmplify', 0.05),
  createBuff('fire-amplify', 'fireAmplify', 0.08),
  createBuff('physical-amplify', 'physicalAmplify', 0.06),
  createMultiplierBuff('magic-amplify-multiplier', 'magicAmplify', 1.18),
  createMultiplierBuff('fire-amplify-multiplier', 'fireAmplify', 1.25),
  createMultiplierBuff('physical-amplify-multiplier', 'physicalAmplify', 1.14),
  createBuff('skill-multiplier-additive', 'multiplierBonus', 0.35),
  createMultiplierBuff('skill-multiplier-multiplier', 'multiplierBonus', 1.18),
  createBuff('all-corrosion', 'allCorrosion', 6),
  createBuff('magic-corrosion', 'magicCorrosion', 5),
  createBuff('fire-corrosion', 'fireCorrosion', 4),
  createBuff('physical-corrosion', 'physicalCorrosion', 3),
  createBuff('all-resistance-ignore', 'allResistanceIgnore', 2),
  createBuff('magic-resistance-ignore', 'magicResistanceIgnore', 3),
  createBuff('fire-resistance-ignore', 'fireResistanceIgnore', 5),
  createBuff('physical-resistance-ignore', 'physicalResistanceIgnore', 4),
  createBuff('combo-direct', 'comboDamageBonus', 0.08),
  createBuff('combo-countable', 'comboDamageBonus', 0.06, { category: 'countable', maxStacks: 3 }),
  createFixtureDerivedBuff('combo-derived', 'comboDamageBonus', 'atk', 0.000025),
  createBuff('imbalance', 'imbalanceDmgBonus', 0.17),
];

export const FULL_ZONE_STACK_COUNTS = { 'combo-countable': 2 };

export const SYNTHETIC_FULL_MULTIPLIER_TEMPLATE: ResolvedSkillDamageTemplate = {
  characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
  // This ID must also exist in the local operator draft below. Otherwise a
  // real SQLite checkout resolves the button back to the ordinary B skill.
  runtimeSkillId: 'skill-B-2',
  displayName: '综合满乘区技能',
  buttonType: 'B',
  hits: [
    createHit('fire-b', '灼热战技段', 2.4, 'fire', 'B'),
    createHit('physical-e', '物理连携段', 1.7, 'physical', 'E'),
  ],
};

export const SYNTHETIC_FULL_MULTIPLIER_INPUT: SkillDamageCalcInputV2 = {
  buttonId: 'synthetic-full-multiplier-button',
  characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  runtimeSkillId: SYNTHETIC_FULL_MULTIPLIER_TEMPLATE.runtimeSkillId,
  template: SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
  buffs: FULL_ZONE_BUFFS,
  buffStackCounts: FULL_ZONE_STACK_COUNTS,
  panel: {
    atk: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.atk,
    critRate: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critRate,
    critDmg: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critDmg,
  },
  panelBase: SYNTHETIC_SKILL_PANEL_BASE,
  damageBonus: SYNTHETIC_DAMAGE_BONUS,
  targetResistance: { fireResistance: 38, physicalResistance: 31 },
};

const weaponConditionDetail = SYNTHETIC_CONFIG_SNAPSHOT.weapon.skills.skill3.effects.find(
  (effect) => effect.effectKey === 'condition',
);
const weaponMultiplierDetail = SYNTHETIC_CONFIG_SNAPSHOT.weapon.skills.skill3.effects.find(
  (effect) => effect.effectKey === 'multiplier',
);
const setNatureCondition = SYNTHETIC_CONFIG_SNAPSHOT.equipment.setBuffs.find(
  (buff) => buff.effectId === 'set-nature-condition',
);
if (!weaponConditionDetail || !weaponMultiplierDetail || !setNatureCondition) {
  throw new Error('Synthetic source-target fixture is missing its weapon/set conditional details.');
}

const TARGET_TEST_BUFFS: Record<string, SkillButtonBuff> = {
  common: createBuff('target-common-passive', 'allDmgBonus', 0.04, { category: 'passive' }),
  aHit: createBuff('target-a-hit', 'physicalDmgBonus', 0.12, { target: { mode: 'damageKey', key: 'a-hit-2' } }),
  aMiss: createBuff('target-a-miss', 'electricDmgBonus', 0.12, { target: { mode: 'element', element: 'electric' } }),
  weaponCondition: createBuff('target-weapon-electric-condition', weaponConditionDetail.typeKey, weaponConditionDetail.value, {
    category: 'condition',
    sourceName: '测试满乘区武器 skill3',
    ownerBuffDomain: 'weapon',
    ownerBuffGroup: 'weaponSkill',
    target: { mode: 'element', element: 'electric' },
  }),
  bMiss: createBuff('target-b-miss', 'ultimateDmgBonus', 0.13, { target: { mode: 'skillType', skillType: 'Q' } }),
  setCondition: createBuff('target-set-nature-condition', setNatureCondition.typeKey, setNatureCondition.value, {
    category: 'condition',
    sourceName: '测试三件套',
    ownerBuffDomain: 'equipment',
    ownerBuffGroup: 'threePiece',
    target: { mode: 'skillType', skillType: 'E' },
  }),
  eMiss: createBuff('target-e-miss', 'iceDmgBonus', 0.14, { target: { mode: 'element', element: 'ice' } }),
  qElement: createBuff('target-q-element', 'iceDmgBonus', 0.15, { target: { mode: 'element', element: 'ice' } }),
  qMiss: createBuff('target-q-miss', 'skillDmgBonus', 0.15, { target: { mode: 'skillType', skillType: 'B' } }),
  dotSkill: createBuff('target-dot-skill', 'fireDmgBonus', 0.16, { target: { mode: 'skillType', skillType: 'Dot' } }),
  dotMiss: createBuff('target-dot-miss', 'allDmgBonus', 0.16, { target: { mode: 'damageKey', key: 'missing-hit' } }),
};

export const SYNTHETIC_TARGET_BUFFS = Object.values(TARGET_TEST_BUFFS);

export const SYNTHETIC_SKILL_TEMPLATES: Record<'A' | 'B' | 'E' | 'Q' | 'Dot', ResolvedSkillDamageTemplate> = {
  A: {
    characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    runtimeSkillId: 'skill-A-1',
    displayName: '测试普通攻击',
    buttonType: 'A',
    hits: [createHit('a-hit-1', 'A 第一段', 1.1, 'fire', 'A'), createHit('a-hit-2', 'A 第二段', 1.4, 'physical', 'A')],
  },
  B: {
    characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    runtimeSkillId: 'skill-B-1',
    displayName: '测试战技',
    buttonType: 'B',
    hits: [createHit('b-hit-1', 'B 电磁段', 1.8, 'electric', 'B')],
  },
  E: {
    characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    runtimeSkillId: 'skill-E-1',
    displayName: '测试连携技',
    buttonType: 'E',
    hits: [createHit('e-hit-1', 'E 自然段', 2.1, 'nature', 'E')],
  },
  Q: {
    characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    runtimeSkillId: 'skill-Q-1',
    displayName: '测试终结技',
    buttonType: 'Q',
    hits: [createHit('q-hit-1', 'Q 寒冷段', 2.6, 'ice', 'Q')],
  },
  Dot: {
    characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    runtimeSkillId: 'skill-Dot-1',
    displayName: '测试持续伤害',
    buttonType: 'Dot',
    hits: [createHit('dot-hit-1', 'Dot 灼热段', 0.75, 'fire', 'Dot')],
  },
};

const targetCaseDefinitions = [
  { skillType: 'A' as const, selectedBuffKeys: ['common', 'aHit', 'aMiss'], matchedBuffKeys: ['common', 'aHit'], unmatchedBuffKeys: ['aMiss'], resistance: { fireResistance: 12, physicalResistance: 18 } },
  { skillType: 'B' as const, selectedBuffKeys: ['common', 'weaponCondition', 'bMiss'], matchedBuffKeys: ['common', 'weaponCondition'], unmatchedBuffKeys: ['bMiss'], resistance: { electricResistance: 16 } },
  { skillType: 'E' as const, selectedBuffKeys: ['common', 'setCondition', 'eMiss'], matchedBuffKeys: ['common', 'setCondition'], unmatchedBuffKeys: ['eMiss'], resistance: { natureResistance: 20 } },
  { skillType: 'Q' as const, selectedBuffKeys: ['common', 'qElement', 'qMiss'], matchedBuffKeys: ['common', 'qElement'], unmatchedBuffKeys: ['qMiss'], resistance: { iceResistance: 22 } },
  { skillType: 'Dot' as const, selectedBuffKeys: ['common', 'dotSkill', 'dotMiss'], matchedBuffKeys: ['common', 'dotSkill'], unmatchedBuffKeys: ['dotMiss'], resistance: { fireResistance: 14 } },
] as const;

function resolveTargetBuffIds(keys: readonly string[]): string[] {
  return keys.map((key) => TARGET_TEST_BUFFS[key].id);
}

export const SYNTHETIC_TARGET_SKILL_EXPECTATIONS = Object.fromEntries(
  targetCaseDefinitions.map(({ skillType, selectedBuffKeys, matchedBuffKeys, unmatchedBuffKeys }) => [
    skillType,
    {
      buttonId: `synthetic-button-${SYNTHETIC_SKILL_TEMPLATES[skillType].runtimeSkillId}`,
      selectedBuffIds: resolveTargetBuffIds(selectedBuffKeys),
      matchedBuffIds: resolveTargetBuffIds(matchedBuffKeys),
      unmatchedBuffIds: resolveTargetBuffIds(unmatchedBuffKeys),
    },
  ]),
) as Record<'A' | 'B' | 'E' | 'Q' | 'Dot', {
  buttonId: string;
  selectedBuffIds: string[];
  matchedBuffIds: string[];
  unmatchedBuffIds: string[];
}>;

export const SYNTHETIC_TARGET_CASES: SkillDamageCalcInputV2[] = targetCaseDefinitions.map(({ skillType, selectedBuffKeys, resistance }) => ({
  buttonId: `synthetic-target-${skillType}`,
  characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  runtimeSkillId: SYNTHETIC_SKILL_TEMPLATES[skillType].runtimeSkillId,
  template: SYNTHETIC_SKILL_TEMPLATES[skillType],
  buffs: selectedBuffKeys.map((id) => TARGET_TEST_BUFFS[id]),
  panel: {
    atk: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.atk,
    critRate: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critRate,
    critDmg: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critDmg,
  },
  panelBase: SYNTHETIC_SKILL_PANEL_BASE,
  damageBonus: SYNTHETIC_DAMAGE_BONUS,
  targetResistance: resistance,
}));

export const SYNTHETIC_ANOMALY_TEMPLATE: ResolvedSkillDamageTemplate = {
  characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
  runtimeSkillId: 'skill-B-3',
  displayName: '异常与状态矩阵承载技能',
  buttonType: 'B',
  hits: [createHit('anomaly-carrier-hit', '异常承载段（禁用）', 1, 'fire', 'B')],
};

export const SYNTHETIC_ANOMALY_MODIFIER_BUFFS: SkillButtonBuff[] = [
  createBuff('anomaly-source-skill', 'sourceSkillBoost', 18),
  createBuff('anomaly-multiplier-additive', 'multiplierBonus', 0.25),
  createMultiplierBuff('anomaly-multiplier-product', 'multiplierBonus', 1.12),
  createBuff('anomaly-all-damage', 'allDmgBonus', 0.04),
  createBuff('anomaly-magic-amplify', 'magicAmplify', 0.05),
  createBuff('anomaly-physical-amplify', 'physicalAmplify', 0.06),
  createBuff('anomaly-magic-vulnerability', 'magicVulnerability', 0.07),
  createBuff('anomaly-physical-vulnerability', 'physicalVulnerability', 0.08),
  createBuff('anomaly-all-corrosion', 'allCorrosion', 2),
  createBuff('anomaly-magic-corrosion', 'magicCorrosion', 3),
  createBuff('anomaly-physical-corrosion', 'physicalCorrosion', 4),
  createBuff('anomaly-all-resistance-ignore', 'allResistanceIgnore', 1),
  createBuff('anomaly-magic-resistance-ignore', 'magicResistanceIgnore', 2),
  createBuff('anomaly-physical-resistance-ignore', 'physicalResistanceIgnore', 3),
];

export const SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF: SkillButtonBuff = createBuff(
  'anomaly-countable-extra-hit',
  'physicalDmgBonus',
  undefined,
  {
    category: 'countable',
    maxStacks: 3,
    effectKind: 'extraHit',
    extraHitConfig: {
      key: 'synthetic-physical-extra-hit',
      damageType: 'physical',
      skillType: 'B',
      baseMultiplier: 1.3,
      imbalanceValue: 20,
      cooldownSeconds: 8,
      trigger: 'physicalAbnormal',
    },
  },
);

export const SYNTHETIC_ANOMALY_BUFFS = [
  ...SYNTHETIC_ANOMALY_MODIFIER_BUFFS,
  SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF,
];

function createAnomalyCard(
  id: string,
  key: string,
  label: string,
  category: 'magic' | 'physical',
  level: number,
  options: Partial<PersistedAnomalyCard> = {},
): PersistedAnomalyCard {
  return {
    id,
    key,
    label,
    kind: 'damage',
    category,
    level,
    primaryText: `${label} Lv${level}`,
    secondaryText: '测试专用异常矩阵',
    selectedBuffIds: [],
    ...options,
  };
}

export const SYNTHETIC_ANOMALY_DAMAGE_CARDS: PersistedAnomalyCard[] = [
  createAnomalyCard('matrix-conductive', 'conductive', '导电', 'magic', 1),
  createAnomalyCard('matrix-corrosion', 'corrosion', '腐蚀', 'magic', 2, { durationSeconds: 5 }),
  createAnomalyCard('matrix-burn-initial', 'burn', '燃烧', 'magic', 3, { burnDamageMode: 'initialOnly', durationSeconds: 4 }),
  createAnomalyCard('matrix-freeze', 'freeze', '冻结', 'magic', 4, { durationSeconds: 6 }),
  createAnomalyCard('matrix-shatter-ice', 'shatter-ice', '碎冰', 'magic', 2),
  createAnomalyCard('matrix-magic-burst', 'magic-burst', '法术爆发', 'magic', 1),
  createAnomalyCard('matrix-knockdown', 'knockdown', '倒地', 'physical', 1),
  createAnomalyCard('matrix-launch', 'launch', '击飞', 'physical', 1),
  createAnomalyCard('matrix-armor-break', 'armor-break', '碎甲', 'physical', 3, { durationSeconds: 10 }),
  createAnomalyCard('matrix-smash', 'smash', '猛击', 'physical', 4),
];

export const SYNTHETIC_ANOMALY_STATUS_CARDS: PersistedAnomalyCard[] = [
  createAnomalyCard('matrix-combo-state', 'combo-state', '连击', 'physical', 4, { kind: 'state' }),
  createAnomalyCard('matrix-imbalance-state', 'imbalance-state', '失衡', 'physical', 1, { kind: 'state' }),
];

export const SYNTHETIC_ANOMALY_STATE_SNAPSHOTS: AnomalyStateSnapshot[] = [
  {
    id: 1,
    key: 'conductive',
    label: '导电',
    level: 3,
    sourceButtonId: 'synthetic-anomaly-matrix-button',
    sourceCharacterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    sourceCharacterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    sourceSkillStrengthSnapshot: 60,
    effectValue: 0.26666666666666666,
    primaryText: '导电 Lv3 · 来源 测试满乘区干员',
    secondaryText: '快照效果: 26.7% 法术易伤',
    tertiaryText: '快照生效',
    createdAt: 1700000000001,
  },
  {
    id: 2,
    key: 'corrosion',
    label: '腐蚀',
    level: 2,
    sourceButtonId: 'synthetic-anomaly-matrix-button',
    sourceCharacterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    sourceCharacterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    sourceSkillStrengthSnapshot: 60,
    effectValue: 13.866666666666667,
    initialCorrosion: 6.4,
    tickCorrosionPerSecond: 1.4933333333333334,
    maxCorrosion: 21.333333333333332,
    currentCorrosion: 13.866666666666667,
    durationSeconds: 5,
    primaryText: '腐蚀 Lv2 · 来源 测试满乘区干员',
    secondaryText: '快照效果: 5s = 13.87 点全属性降抗',
    tertiaryText: '当前 5s',
    createdAt: 1700000000002,
  },
  {
    id: 3,
    key: 'armor-break',
    label: '碎甲',
    level: 4,
    sourceButtonId: 'synthetic-anomaly-matrix-button',
    sourceCharacterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
    sourceCharacterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    sourceSkillStrengthSnapshot: 60,
    effectValue: 0.32,
    durationSeconds: 10,
    primaryText: '碎甲 Lv4 · 来源 测试满乘区干员',
    secondaryText: '快照效果: 32.0% 物伤易伤',
    tertiaryText: '持续 10s',
    createdAt: 1700000000003,
  },
];

export const SYNTHETIC_BURN_DOT_CARD = createAnomalyCard(
  'matrix-burn-dot',
  'burn',
  '燃烧总持续',
  'magic',
  2,
  { burnDamageMode: 'dotOnly', durationSeconds: 4 },
);

export const SYNTHETIC_BURN_SPLIT_CARD = createAnomalyCard(
  'matrix-burn-split',
  'burn',
  '燃烧逐跳',
  'magic',
  2,
  { burnDamageMode: 'splitDot', durationSeconds: 3 },
);

export const SYNTHETIC_BUFF_TYPE_MATRIX_TYPES = Object.keys(BUFF_TYPE_LABELS);

const BUFF_TYPE_MATRIX_FLAT_TYPES = new Set([
  'atk',
  'flatAtk',
  'mainStat',
  'subStat',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'sourceSkillBoost',
]);

function resolveBuffTypeMatrixValue(type: string): number {
  if (type === 'multiplierMultiplier') return 1.03;
  if (BUFF_TYPE_MATRIX_FLAT_TYPES.has(type)) return 2;
  if (type.endsWith('Corrosion') || type.endsWith('ResistanceIgnore')) return 1;
  return 0.01;
}

export const SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS: SkillButtonBuff[] = SYNTHETIC_BUFF_TYPE_MATRIX_TYPES.map((type) => (
  createBuff(
    `type-matrix-${type}`,
    type,
    resolveBuffTypeMatrixValue(type),
    type === 'comboDamageBonus'
      ? { category: 'countable', maxStacks: 3 }
      : { category: 'condition' },
  )
));

export const SYNTHETIC_BUFF_TYPE_MATRIX_STACK_COUNTS = {
  'type-matrix-comboDamageBonus': 2,
};

export const SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE: ResolvedSkillDamageTemplate = {
  characterId: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
  runtimeSkillId: 'skill-B-4',
  displayName: '75 类 Buff 五系矩阵技能',
  buttonType: 'B',
  hits: [
    createHit('type-matrix-physical-a', '物理普攻矩阵段', 1, 'physical', 'A'),
    createHit('type-matrix-fire-b', '灼热战技矩阵段', 1.1, 'fire', 'B'),
    createHit('type-matrix-electric-e', '电磁连携矩阵段', 1.2, 'electric', 'E'),
    createHit('type-matrix-ice-q', '寒冷终结矩阵段', 1.3, 'ice', 'Q'),
    createHit('type-matrix-nature-dot', '自然持续矩阵段', 1.4, 'nature', 'Dot'),
  ],
};

export const SYNTHETIC_BUFF_TYPE_MATRIX_TARGET_RESISTANCE = {
  physicalResistance: 21,
  fireResistance: 22,
  electricResistance: 23,
  iceResistance: 24,
  natureResistance: 25,
};

function buildRefCountedBuffList(
  groups: SkillButtonBuff[][],
  selectedBuffGroups: string[][],
): SkillButtonBuff[] {
  const refCounts = new Map<string, number>();
  selectedBuffGroups.flat().forEach((buffId) => {
    refCounts.set(buffId, (refCounts.get(buffId) ?? 0) + 1);
  });
  return groups.flat().map((buff) => ({
    ...buff,
    refCount: refCounts.get(buff.id) ?? 0,
  }));
}

// The SQLite payload carries four independent Buff groups: comprehensive
// ordinary damage, per-skill targeting, anomaly/state, and all 75 public types.
export const SYNTHETIC_ALL_BUFF_LIST = buildRefCountedBuffList(
  [FULL_ZONE_BUFFS, SYNTHETIC_TARGET_BUFFS, SYNTHETIC_ANOMALY_BUFFS, SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS],
  [
    FULL_ZONE_BUFFS.map((buff) => buff.id),
    ...SYNTHETIC_TARGET_CASES.map((input) => input.buffs.map((buff) => buff.id)),
    SYNTHETIC_ANOMALY_BUFFS.map((buff) => buff.id),
    SYNTHETIC_ANOMALY_MODIFIER_BUFFS.map((buff) => buff.id),
    SYNTHETIC_ANOMALY_MODIFIER_BUFFS.map((buff) => buff.id),
    SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.map((buff) => buff.id),
  ],
);

function buildTimelineButton(
  template: ResolvedSkillDamageTemplate,
  index: number,
): PersistedSkillButton {
  const targetCase = SYNTHETIC_TARGET_CASES.find((input) => input.runtimeSkillId === template.runtimeSkillId);
  const selectedBuff = targetCase
    ? targetCase.buffs.map((buff) => buff.id)
    : FULL_ZONE_BUFFS.map((buff) => buff.id);
  const targetResistance = targetCase?.targetResistance ?? SYNTHETIC_FULL_MULTIPLIER_INPUT.targetResistance ?? {};
  return {
    id: `synthetic-button-${template.runtimeSkillId}`,
    characterId: template.characterId,
    characterName: template.characterName,
    skillType: template.buttonType,
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: index,
    nodeNumber: index + 1,
    position: { x: index * 44, y: 24 },
    runtimeSkillId: template.runtimeSkillId,
    skillDisplayName: template.displayName,
    customHits: template.hits,
    selectedBuff,
    buffStackCounts: targetCase ? {} : FULL_ZONE_STACK_COUNTS,
    resistanceConfig: { targetResistance },
    runtimeSnapshot: {
      atk: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.atk,
      critRate: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critRate,
      critDmg: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critDmg,
      characterComputed: null,
    },
  };
}

const ordinaryTimelineButtons = [
  ...Object.values(SYNTHETIC_SKILL_TEMPLATES),
  SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
].map(buildTimelineButton);

export const SYNTHETIC_ANOMALY_BUTTON_IDS = {
  matrix: 'synthetic-anomaly-matrix-button',
  burnDot: 'synthetic-anomaly-burn-dot-button',
  burnSplit: 'synthetic-anomaly-burn-split-button',
} as const;

export const SYNTHETIC_ANOMALY_TARGET_RESISTANCE = {
  physicalResistance: 31,
  fireResistance: 33,
  electricResistance: 35,
  iceResistance: 37,
  natureResistance: 39,
};

function buildAnomalyTimelineButton(
  id: string,
  index: number,
  selectedDamages: PersistedAnomalyCard[],
  selectedBuffs: SkillButtonBuff[],
  options: {
    selectedStatuses?: PersistedAnomalyCard[];
    selectedStateSnapshotIds?: number[];
    extraHitStacks?: number;
  } = {},
): PersistedSkillButton {
  const selectedBuff = selectedBuffs.map((buff) => buff.id);
  return {
    id,
    characterId: SYNTHETIC_ANOMALY_TEMPLATE.characterId,
    characterName: SYNTHETIC_ANOMALY_TEMPLATE.characterName,
    skillType: SYNTHETIC_ANOMALY_TEMPLATE.buttonType,
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: index,
    nodeNumber: index + 1,
    position: { x: index * 44, y: 24 },
    runtimeSkillId: SYNTHETIC_ANOMALY_TEMPLATE.runtimeSkillId,
    skillDisplayName: SYNTHETIC_ANOMALY_TEMPLATE.displayName,
    customHits: SYNTHETIC_ANOMALY_TEMPLATE.hits,
    selectedBuff,
    buffStackCounts: options.extraHitStacks === undefined
      ? {}
      : { [SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF.id]: options.extraHitStacks },
    anomalyConfig: {
      selectedStatuses: options.selectedStatuses ?? [],
      selectedDamages,
      selectedStateSnapshotIds: options.selectedStateSnapshotIds ?? [],
    },
    resistanceConfig: { targetResistance: SYNTHETIC_ANOMALY_TARGET_RESISTANCE },
    panelConfig: {
      selectedBuff,
      manualDisabledHitKeys: ['anomaly-carrier-hit'],
    },
    runtimeSnapshot: {
      atk: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.atk,
      critRate: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critRate,
      critDmg: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critDmg,
      characterComputed: null,
    },
  };
}

const anomalyTimelineButtons = [
  buildAnomalyTimelineButton(
    SYNTHETIC_ANOMALY_BUTTON_IDS.matrix,
    ordinaryTimelineButtons.length,
    SYNTHETIC_ANOMALY_DAMAGE_CARDS,
    SYNTHETIC_ANOMALY_BUFFS,
    {
      selectedStatuses: SYNTHETIC_ANOMALY_STATUS_CARDS,
      selectedStateSnapshotIds: SYNTHETIC_ANOMALY_STATE_SNAPSHOTS.map((snapshot) => snapshot.id),
      extraHitStacks: 2,
    },
  ),
  buildAnomalyTimelineButton(
    SYNTHETIC_ANOMALY_BUTTON_IDS.burnDot,
    ordinaryTimelineButtons.length + 1,
    [SYNTHETIC_BURN_DOT_CARD],
    SYNTHETIC_ANOMALY_MODIFIER_BUFFS,
  ),
  buildAnomalyTimelineButton(
    SYNTHETIC_ANOMALY_BUTTON_IDS.burnSplit,
    ordinaryTimelineButtons.length + 2,
    [SYNTHETIC_BURN_SPLIT_CARD],
    SYNTHETIC_ANOMALY_MODIFIER_BUFFS,
  ),
];

export const SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID = 'synthetic-buff-type-matrix-button';

const buffTypeMatrixSelectedBuff = SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.map((buff) => buff.id);
const buffTypeMatrixTimelineButton: PersistedSkillButton = {
  id: SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID,
  characterId: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.characterId,
  characterName: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.characterName,
  skillType: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.buttonType,
  staffIndex: 0,
  lineIndex: 0,
  nodeIndex: ordinaryTimelineButtons.length + anomalyTimelineButtons.length,
  nodeNumber: ordinaryTimelineButtons.length + anomalyTimelineButtons.length + 1,
  position: { x: (ordinaryTimelineButtons.length + anomalyTimelineButtons.length) * 44, y: 24 },
  runtimeSkillId: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.runtimeSkillId,
  skillDisplayName: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.displayName,
  customHits: SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.hits,
  selectedBuff: buffTypeMatrixSelectedBuff,
  buffStackCounts: SYNTHETIC_BUFF_TYPE_MATRIX_STACK_COUNTS,
  resistanceConfig: { targetResistance: SYNTHETIC_BUFF_TYPE_MATRIX_TARGET_RESISTANCE },
  panelConfig: { selectedBuff: buffTypeMatrixSelectedBuff },
  runtimeSnapshot: {
    atk: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.atk,
    critRate: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critRate,
    critDmg: SYNTHETIC_CONFIG_SNAPSHOT.panel.display.critDmg,
    characterComputed: null,
  },
};

const timelineButtons = [
  ...ordinaryTimelineButtons,
  ...anomalyTimelineButtons,
  buffTypeMatrixTimelineButton,
];

const timelineTable: SkillButtonTable = Object.fromEntries(timelineButtons.map((button) => [button.id, button]));
const timelineData: TimelineData = {
  version: 'synthetic-fixture-v1',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  staffLines: [{
    staffIndex: 0,
    characterName: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
    occupiedNodes: timelineButtons.map((_, index) => index),
    buttons: timelineButtons.map((button) => ({
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      skillType: button.skillType as SkillType,
      staffIndex: button.staffIndex,
      lineIndex: button.lineIndex,
      nodeIndex: button.nodeIndex,
      nodeNumber: button.nodeNumber,
      position: button.position,
      runtimeSkillId: button.runtimeSkillId,
      skillDisplayName: button.skillDisplayName,
      customHits: button.customHits,
      buffIds: button.selectedBuff,
    })),
  }],
};

export const SYNTHETIC_CHARACTER_INPUT: TimelineSnapshotPayload['characterInputMap'][string] = {
  potential: '0潜',
  skillLevels: { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' },
  weapon: {
    name: SYNTHETIC_OPERATOR_PANEL_INPUT.weapon?.name ?? '',
    potentialMode: 'P0',
  },
  equipment: {
    atkPercentBoost: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.atkPercentBoost ?? 0,
    physicalDmgBonus: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.physicalDmgBonus ?? 0,
    chainSkillDmgBonus: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.chainSkillDmgBonus ?? 0,
    allSkillDmgBonus: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.allSkillDmgBonus ?? 0,
    imbalanceDmgBonus: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.imbalanceDmgBonus ?? 0,
    allDmgBonus: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.allDmgBonus ?? 0,
    sourceSkillBoost: SYNTHETIC_CONFIG_SNAPSHOT.equipment.totals.sourceSkillBoost ?? 0,
  },
};

export const SYNTHETIC_TIMELINE_PAYLOAD: TimelineSnapshotPayload = {
  selectedCharacters: [SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id],
  timelineData,
  skillButtonTable: timelineTable,
  allBuffList: SYNTHETIC_ALL_BUFF_LIST,
  anomalyStateSnapshots: SYNTHETIC_ANOMALY_STATE_SNAPSHOTS,
  characterInputMap: { [SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id]: SYNTHETIC_CHARACTER_INPUT },
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: { [SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id]: SYNTHETIC_CONFIG_SNAPSHOT },
};

const ARCHIVE_ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
const operatorAttributesForArchive = Object.fromEntries(
  Object.entries(SYNTHETIC_OPERATOR_PANEL_INPUT.operator.attributes.level90 ?? {}).map(([attribute, value]) => [
    attribute,
    Object.fromEntries(ARCHIVE_ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, value])),
  ]),
);

const operatorDraftForArchive = {
  id: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.id,
  name: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.name,
  avatarUrl: '',
  rarity: 6,
  profession: '术师',
  weapon: SYNTHETIC_OPERATOR_PANEL_INPUT.weapon?.name ?? '测试武器',
  element: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.element,
  mainStat: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.mainStat,
  subStat: SYNTHETIC_OPERATOR_PANEL_INPUT.operator.subStat,
  level: 90,
  attributes: operatorAttributesForArchive,
  skills: Object.fromEntries([
    ...Object.values(SYNTHETIC_SKILL_TEMPLATES),
    SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
    SYNTHETIC_ANOMALY_TEMPLATE,
    SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE,
  ].map((template) => [
    // The key is the trusted runtime ID, including the second B skill used by
    // the comprehensive two-hit button.
    template.runtimeSkillId,
    {
      displayName: template.displayName,
      buttonType: template.buttonType,
      iconUrl: '',
      hitCount: template.hits.length,
      hitMeta: Object.fromEntries(template.hits.map((hit) => [hit.key, {
        displayName: hit.displayName,
        element: hit.element,
        skillType: hit.skillType,
        levels: { M3: hit.multiplier },
      }])),
    },
  ])),
  buffs: operatorBuffs,
};

const weaponDraftForArchive = {
  id: SYNTHETIC_OPERATOR_PANEL_INPUT.weapon?.id,
  name: SYNTHETIC_OPERATOR_PANEL_INPUT.weapon?.name,
  rarity: 6,
  type: '法术单元',
  description: '纯测试武器，不来自用户资料。',
  imgUrl: '',
  attackGrowth: weaponData.attackGrowth,
  skills: weaponData.skills,
};

const equipmentLibraryForArchive = {
  schemaVersion: 2,
  gearSets: {
    'fixture-set': {
      gearSetId: 'fixture-set',
      name: '测试三件套',
      threePieceBuffs: Object.fromEntries(equipmentSetBuffs.map((buff) => [buff.effectId, {
        effectId: buff.effectId,
        name: buff.label,
        category: buff.category,
        typeKey: buff.typeKey,
        value: buff.value,
        unit: buff.unit,
      }])),
      equipments: Object.fromEntries(equipmentPieces.map((piece) => [piece.equipmentId, {
        equipmentId: piece.equipmentId,
        name: piece.name,
        part: piece.part,
        effects: Object.fromEntries(piece.effects.map((effect) => [effect.effectId, {
          effectId: effect.effectId,
          label: effect.label,
          typeKey: effect.typeKey,
          category: 'buff',
          levels: { '3': effect.value },
          unit: effect.unit,
        }])),
      }])),
    },
  },
};

function buildArchiveBuffEffects(buffList: SkillButtonBuff[]) {
  return Object.fromEntries(buffList.map((buff) => [buff.id, {
    ...buff,
    effectId: buff.id,
    displayName: buff.displayName,
  }]));
}

const buffDraftForArchive = {
  id: 'synthetic-full-multiplier-buffs',
  name: '测试满乘区 Buff 集',
  sourceName: '纯测试 fixture',
  source: 'test',
  description: '完全合成，不复制用户存档。',
  items: {
    'synthetic-full-multiplier-item': {
      id: 'synthetic-full-multiplier-item',
      name: '综合满乘区',
      sourceName: '纯测试 fixture',
      description: '',
      effects: buildArchiveBuffEffects(SYNTHETIC_ALL_BUFF_LIST.filter((buff) => FULL_ZONE_BUFFS.some((fullBuff) => fullBuff.id === buff.id))),
    },
    'synthetic-target-item': {
      id: 'synthetic-target-item',
      name: '按技能目标 Buff',
      sourceName: '纯测试 fixture',
      description: '分别挂在 A/B/E/Q/Dot 按钮上的目标匹配与不匹配 Buff。',
      effects: buildArchiveBuffEffects(SYNTHETIC_ALL_BUFF_LIST.filter((buff) => SYNTHETIC_TARGET_BUFFS.some((targetBuff) => targetBuff.id === buff.id))),
    },
    'synthetic-anomaly-item': {
      id: 'synthetic-anomaly-item',
      name: '异常与状态矩阵 Buff',
      sourceName: '纯测试 fixture',
      description: '用于异常倍率、源石技艺顺序、状态快照、抗性与叠层额外 Hit 双跑。',
      effects: buildArchiveBuffEffects(SYNTHETIC_ALL_BUFF_LIST.filter((buff) => SYNTHETIC_ANOMALY_BUFFS.some((anomalyBuff) => anomalyBuff.id === buff.id))),
    },
    'synthetic-buff-type-matrix-item': {
      id: 'synthetic-buff-type-matrix-item',
      name: '75 类 Buff 完整目录',
      sourceName: '纯测试 fixture',
      description: '每个公开 Buff type 恰好一条，用于 SQLite 迁移、恢复与五系伤害双跑。',
      effects: buildArchiveBuffEffects(SYNTHETIC_ALL_BUFF_LIST.filter((buff) => SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.some((matrixBuff) => matrixBuff.id === buff.id))),
    },
  },
};

const legacyTimelineArchive: LegacyTimelineArchive = {
  type: 'dmg.timeline-archive.v1',
  archiveVersion: 1,
  source: 'local',
  archiveId: 'synthetic-full-multiplier-timeline',
  label: '测试满乘区排轴',
  createdAt: '2023-11-14T22:13:20.000Z',
  payload: SYNTHETIC_TIMELINE_PAYLOAD,
};

export const SYNTHETIC_LOCAL_DATA_ARCHIVE: LocalDataArchive = {
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'synthetic-full-multiplier-local-data',
  name: '测试满乘区本地数据',
  description: '完全合成的计算回归资料，不复制用户存档。',
  createdAt: '2023-11-14T22:13:20.000Z',
  exportedAt: '2023-11-14T22:13:20.000Z',
  sections: ['operators', 'weapons', 'equipments', 'buffs', 'timeline'],
  storage: {
    local: {
      'def.operator-editor.library.v1': { [operatorDraftForArchive.id]: operatorDraftForArchive },
      'def.weapon-sheet.library.v1': { [weaponDraftForArchive.id as string]: weaponDraftForArchive },
      'def.equipment-sheet.library.v1': equipmentLibraryForArchive,
      'def.buff-editor.library.v1': { [buffDraftForArchive.id]: buffDraftForArchive },
    },
    session: {},
  },
  timelineArchives: [legacyTimelineArchive],
};

export const SYNTHETIC_DAMAGE_GOLDEN = {
  targetCaseFinals: {
    A: {
      expected: [2671.0357629795844, 3688.629259164129],
      crit: [4015.892930353921, 5545.841193848166],
      nonCrit: [2334.8214711360006, 3224.32627549312],
    },
    B: {
      expected: [4701.905929873153],
      crit: [7069.299125333761],
      nonCrit: [4110.0576310080005],
    },
    E: {
      expected: [5261.13104829312],
      crit: [7910.092135545601],
      nonCrit: [4598.8907764800015],
    },
    Q: {
      expected: [6173.288184588097],
      crit: [9281.517200604481],
      nonCrit: [5396.230930584001],
    },
    Dot: {
      expected: [2005.77336294192],
      crit: [3015.6732379896],
      nonCrit: [1753.29839418],
    },
  },
  full: {
    panel: {
      atk: 5226.667150000001,
      critRate: 0.35,
      critDmg: 0.94,
    },
    multipliers: [
      { base: 2.4, afterBonus: 2.4, afterMultiply: 2.832 },
      { base: 1.7, afterBonus: 2.05, afterMultiply: 2.4189999999999996 },
    ],
    zones: [
      {
        elementBonus: 0.43999999999999995,
        skillBonus: 0.35,
        allDamageBonus: 0.16,
        damageBonus: { additiveTotal: 0.55, multiplierProduct: 1.1, finalValue: 2.005 },
        amplify: { additiveTotal: 0.13, multiplierProduct: 1.4749999999999999, finalValue: 1.1917499999999999 },
        fragile: { additiveTotal: 0.17, multiplierProduct: 1.32, finalValue: 1.2244 },
        vulnerability: { additiveTotal: 0.15, multiplierProduct: 1.288, finalValue: 1.1932 },
        skillMultiplier: { additiveTotal: 0, multiplierProduct: 1.18, finalValue: 2.832 },
        resistance: { baseResistance: 38, corrosion: 15, resistanceIgnore: 10, effectiveResistance: 23, resistanceZone: 0.87 },
        resistanceZone: 0.87,
        amplifyRate: 0.19174999999999986,
        fragileRate: 0.22439999999999993,
        vulnerabilityRate: 0.19320000000000004,
        comboDamageBonus: 0.26,
        imbalanceDamageBonus: 0.17,
        defenseZone: 0.5,
      },
      {
        elementBonus: 0.22,
        skillBonus: 0.35000000000000003,
        allDamageBonus: 0.16,
        damageBonus: { additiveTotal: 0.42, multiplierProduct: 1.12, finalValue: 1.7804000000000002 },
        amplify: { additiveTotal: 0.06, multiplierProduct: 1.14, finalValue: 1.0684 },
        fragile: { additiveTotal: 0.08, multiplierProduct: 1.15, finalValue: 1.092 },
        vulnerability: { additiveTotal: 0.07, multiplierProduct: 1.1, finalValue: 1.077 },
        skillMultiplier: { additiveTotal: 0.35, multiplierProduct: 1.18, finalValue: 2.4189999999999996 },
        resistance: { baseResistance: 31, corrosion: 9, resistanceIgnore: 6, effectiveResistance: 22, resistanceZone: 0.8400000000000001 },
        resistanceZone: 0.8400000000000001,
        amplifyRate: 0.06840000000000002,
        fragileRate: 0.09200000000000008,
        vulnerabilityRate: 0.07699999999999996,
        comboDamageBonus: 0.26,
        imbalanceDamageBonus: 0.29000000000000004,
        defenseZone: 0.5,
      },
    ],
    breakdowns: [
      {
        expected: {
          base: 14801.921368800002,
          afterCrit: 19671.7534991352,
          afterBonus: 39441.86576576607,
          afterDefense: 19720.932882883037,
          afterResistance: 17157.211608108242,
          afterAmplify: 20447.106933962994,
          afterFragile: 25035.43772994429,
          afterVulnerability: 29872.284299369527,
          afterCombo: 37639.078217205606,
          final: 44037.72151413056,
        },
        crit: {
          base: 14801.921368800002,
          afterCrit: 28715.727455472002,
          afterBonus: 57575.03354822136,
          afterDefense: 28787.51677411068,
          afterResistance: 25045.13959347629,
          afterAmplify: 29847.545110525367,
          afterFragile: 36545.33423332726,
          afterVulnerability: 43605.89280720609,
          afterCombo: 54943.42493707967,
          final: 64283.807176383205,
        },
        nonCrit: {
          base: 14801.921368800002,
          afterCrit: 14801.921368800002,
          afterBonus: 29677.852344444003,
          afterDefense: 14838.926172222002,
          afterResistance: 12909.86576983314,
          afterAmplify: 15385.332531198645,
          afterFragile: 18837.80115119962,
          afterVulnerability: 22477.264333611387,
          afterCombo: 28321.35306035035,
          final: 33135.983080609905,
        },
      },
      {
        expected: {
          base: 12643.30783585,
          afterCrit: 16802.95611384465,
          afterBonus: 29915.98306508902,
          afterDefense: 14957.99153254451,
          afterResistance: 12564.71288733739,
          afterAmplify: 13424.139248831267,
          afterFragile: 14659.160059723745,
          afterVulnerability: 15787.915384322472,
          afterCombo: 19892.773384246317,
          final: 25661.67766567775,
        },
        crit: {
          base: 12643.30783585,
          afterCrit: 24528.017201549,
          afterBonus: 43669.68182563784,
          afterDefense: 21834.84091281892,
          afterResistance: 18341.266366767893,
          afterAmplify: 19595.80898625482,
          afterFragile: 21398.623412990262,
          afterVulnerability: 23046.317415790512,
          afterCombo: 29038.359943896045,
          final: 37459.4843276259,
        },
        nonCrit: {
          base: 12643.30783585,
          afterCrit: 12643.30783585,
          afterBonus: 22510.145270947345,
          afterDefense: 11255.072635473673,
          afterResistance: 9454.261013797886,
          afterAmplify: 10100.932467141662,
          afterFragile: 11030.218254118696,
          afterVulnerability: 11879.545059685835,
          afterCombo: 14968.226775204153,
          final: 19309.01254001336,
        },
      },
    ],
    expected: [44037.72151413056, 25661.67766567775],
    crit: [64283.807176383205, 37459.4843276259],
    nonCrit: [33135.983080609905, 19309.01254001336],
  },
} as const;

export const SYNTHETIC_ANOMALY_REPORT_GOLDEN = {
  [SYNTHETIC_ANOMALY_BUTTON_IDS.matrix]: {
    expected: 484218.334778702,
    nonCrit: 423267.775156208,
    hits: [
      { id: 'normal-synthetic-anomaly-matrix-button-anomaly-carrier-hit-0', sourceKind: 'normal', elementLabel: '火', expected: 0, nonCrit: 0, baseResistance: 33, corrosion: 0, resistanceIgnore: 0, resistanceZone: 0.67 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-conductive', sourceKind: 'anomaly', elementLabel: '雷', expected: 23999.068182226, nonCrit: 20978.206452994, baseResistance: 35, corrosion: 18.866666667, resistanceIgnore: 3, resistanceZone: 0.868666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-corrosion', sourceKind: 'anomaly', elementLabel: '自然', expected: 33467.001899547, nonCrit: 29254.372289813, baseResistance: 39, corrosion: 18.866666667, resistanceIgnore: 3, resistanceZone: 0.828666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-burn-initial', sourceKind: 'anomaly', elementLabel: '火', expected: 50006.937311384, nonCrit: 43712.357789671, baseResistance: 33, corrosion: 18.866666667, resistanceIgnore: 3, resistanceZone: 0.888666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-freeze', sourceKind: 'anomaly', elementLabel: '冰', expected: 55931.162429577, nonCrit: 48890.87624963, baseResistance: 37, corrosion: 18.866666667, resistanceIgnore: 3, resistanceZone: 0.848666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-shatter-ice', sourceKind: 'anomaly', elementLabel: '物理', expected: 64117.098920036, nonCrit: 56046.415139892, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-magic-burst', sourceKind: 'anomaly', elementLabel: '法术', expected: 46923.844078602, nonCrit: 41017.346222554, baseResistance: 0, corrosion: 15.866666667, resistanceIgnore: 1, resistanceZone: 1.168666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-knockdown', sourceKind: 'anomaly', elementLabel: '物理', expected: 19668.202936, nonCrit: 17192.485083916, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-launch', sourceKind: 'anomaly', elementLabel: '物理', expected: 19668.202936, nonCrit: 17192.485083916, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-armor-break', sourceKind: 'anomaly', elementLabel: '物理', expected: 31265.663727061, nonCrit: 27330.125635543, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'anomaly-synthetic-anomaly-matrix-button-matrix-smash', sourceKind: 'anomaly', elementLabel: '物理', expected: 110998.206665607, nonCrit: 97026.404427978, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'extra-hit-synthetic-anomaly-matrix-button-anomaly-countable-extra-hit-1', sourceKind: 'extraHit', elementLabel: '物理', expected: 14086.472846331, nonCrit: 12313.35039015, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
      { id: 'extra-hit-synthetic-anomaly-matrix-button-anomaly-countable-extra-hit-2', sourceKind: 'extraHit', elementLabel: '物理', expected: 14086.472846331, nonCrit: 12313.35039015, baseResistance: 31, corrosion: 19.866666667, resistanceIgnore: 4, resistanceZone: 0.928666667 },
    ],
  },
  [SYNTHETIC_ANOMALY_BUTTON_IDS.burnDot]: {
    expected: 6910.245156632,
    nonCrit: 6040.424087965,
    hits: [
      { id: 'normal-synthetic-anomaly-burn-dot-button-anomaly-carrier-hit-0', sourceKind: 'normal', elementLabel: '火', expected: 0, nonCrit: 0, baseResistance: 33, corrosion: 0, resistanceIgnore: 0, resistanceZone: 0.67 },
      { id: 'anomaly-synthetic-anomaly-burn-dot-button-matrix-burn-dot-dot', sourceKind: 'anomaly', elementLabel: '火', expected: 6910.245156632, nonCrit: 6040.424087965, baseResistance: 33, corrosion: 5, resistanceIgnore: 3, resistanceZone: 0.75 },
    ],
  },
  [SYNTHETIC_ANOMALY_BUTTON_IDS.burnSplit]: {
    expected: 6490.543732403,
    nonCrit: 5673.552213639,
    hits: [
      { id: 'normal-synthetic-anomaly-burn-split-button-anomaly-carrier-hit-0', sourceKind: 'normal', elementLabel: '火', expected: 0, nonCrit: 0, baseResistance: 33, corrosion: 0, resistanceIgnore: 0, resistanceZone: 0.67 },
      { id: 'anomaly-synthetic-anomaly-burn-split-button-matrix-burn-split-dot-1', sourceKind: 'anomaly', elementLabel: '火', expected: 2163.514577468, nonCrit: 1891.184071213, baseResistance: 33, corrosion: 5, resistanceIgnore: 3, resistanceZone: 0.75 },
      { id: 'anomaly-synthetic-anomaly-burn-split-button-matrix-burn-split-dot-2', sourceKind: 'anomaly', elementLabel: '火', expected: 2163.514577468, nonCrit: 1891.184071213, baseResistance: 33, corrosion: 5, resistanceIgnore: 3, resistanceZone: 0.75 },
      { id: 'anomaly-synthetic-anomaly-burn-split-button-matrix-burn-split-dot-3', sourceKind: 'anomaly', elementLabel: '火', expected: 2163.514577468, nonCrit: 1891.184071213, baseResistance: 33, corrosion: 5, resistanceIgnore: 3, resistanceZone: 0.75 },
    ],
  },
} as const;

export const SYNTHETIC_BUFF_TYPE_MATRIX_REPORT_GOLDEN = {
  expected: 16773.298120644,
  nonCrit: 14543.742409299,
  hits: [
    {
      id: 'normal-synthetic-buff-type-matrix-button-type-matrix-physical-a-0',
      elementLabel: '物理',
      skillTypeLabel: 'A',
      expected: 2757.583952463,
      nonCrit: 2391.03785005,
      resistance: { baseResistance: 21, corrosion: 2, resistanceIgnore: 2, resistanceZone: 0.83 },
      zones: {
        skillMultiplier: { additiveTotal: 0.01, multiplierProduct: 1.03, finalValue: 1.0403 },
        damageBonus: { additiveTotal: 0.03, multiplierProduct: 1, finalValue: 1.18 },
        amplify: { additiveTotal: 0.01, multiplierProduct: 1, finalValue: 1.01 },
        fragile: { additiveTotal: 0.01, multiplierProduct: 1, finalValue: 1.01 },
        vulnerability: { additiveTotal: 0.01, multiplierProduct: 1, finalValue: 1.01 },
      },
    },
    {
      id: 'normal-synthetic-buff-type-matrix-button-type-matrix-fire-b-1',
      elementLabel: '火',
      skillTypeLabel: 'B',
      expected: 3493.668663356,
      nonCrit: 3029.280034125,
      resistance: { baseResistance: 22, corrosion: 3, resistanceIgnore: 3, resistanceZone: 0.84 },
      zones: {
        skillMultiplier: { additiveTotal: 0.01, multiplierProduct: 1.03, finalValue: 1.1433 },
        damageBonus: { additiveTotal: 0.06, multiplierProduct: 1, finalValue: 1.46 },
        amplify: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        fragile: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        vulnerability: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
      },
    },
    {
      id: 'normal-synthetic-buff-type-matrix-button-type-matrix-electric-e-2',
      elementLabel: '雷',
      skillTypeLabel: 'E',
      expected: 3531.104933868,
      nonCrit: 3061.740166364,
      resistance: { baseResistance: 23, corrosion: 3, resistanceIgnore: 3, resistanceZone: 0.83 },
      zones: {
        skillMultiplier: { additiveTotal: 0.01, multiplierProduct: 1.03, finalValue: 1.2463 },
        damageBonus: { additiveTotal: 0.06, multiplierProduct: 1, finalValue: 1.37 },
        amplify: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        fragile: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        vulnerability: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
      },
    },
    {
      id: 'normal-synthetic-buff-type-matrix-button-type-matrix-ice-q-3',
      elementLabel: '冰',
      skillTypeLabel: 'Q',
      expected: 3473.619842815,
      nonCrit: 3011.896161289,
      resistance: { baseResistance: 24, corrosion: 3, resistanceIgnore: 3, resistanceZone: 0.82 },
      zones: {
        skillMultiplier: { additiveTotal: 0.01, multiplierProduct: 1.03, finalValue: 1.3493 },
        damageBonus: { additiveTotal: 0.06, multiplierProduct: 1, finalValue: 1.26 },
        amplify: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        fragile: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        vulnerability: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
      },
    },
    {
      id: 'normal-synthetic-buff-type-matrix-button-type-matrix-nature-dot-4',
      elementLabel: '自然',
      skillTypeLabel: '持续伤害',
      expected: 3517.320728142,
      nonCrit: 3049.78819747,
      resistance: { baseResistance: 25, corrosion: 3, resistanceIgnore: 3, resistanceZone: 0.81 },
      zones: {
        skillMultiplier: { additiveTotal: 0.01, multiplierProduct: 1.03, finalValue: 1.4523 },
        damageBonus: { additiveTotal: 0.05, multiplierProduct: 1, finalValue: 1.2 },
        amplify: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        fragile: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
        vulnerability: { additiveTotal: 0.02, multiplierProduct: 1, finalValue: 1.02 },
      },
    },
  ],
} as const;
