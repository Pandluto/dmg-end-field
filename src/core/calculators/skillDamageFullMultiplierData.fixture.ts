import { buildConfigSnapshot, type EquipmentPieceInput, type OperatorPanelInput } from './operatorPanelCalculator';
import type { ResolvedSkillDamageTemplate, SkillDamageCalcInputV2, SkillDamagePanelBase } from './skillDamage.types';
import type { ElementType, HitSkillType, SkillType, TimelineData } from '../../types';
import type {
  DamageBonusSnapshot,
  PersistedSkillButton,
  SkillButtonBuff,
  SkillButtonTable,
} from '../../types/storage';
import type { LocalDataArchive } from '../../platform/data/localDataPackages';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { LegacyTimelineArchive } from '../../platform/timeline/browserTimelineStore';

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

// The SQLite payload intentionally carries two independent Buff groups:
// comprehensive multiplier coverage and per-skill target coverage.
export const SYNTHETIC_ALL_BUFF_LIST = buildRefCountedBuffList(
  [FULL_ZONE_BUFFS, SYNTHETIC_TARGET_BUFFS],
  [
    FULL_ZONE_BUFFS.map((buff) => buff.id),
    ...SYNTHETIC_TARGET_CASES.map((input) => input.buffs.map((buff) => buff.id)),
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

const timelineButtons = [
  ...Object.values(SYNTHETIC_SKILL_TEMPLATES),
  SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
].map(buildTimelineButton);

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
  anomalyStateSnapshots: [],
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
      { base: 2.4, afterBonus: 2.75, afterMultiply: 3.2449999999999997 },
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
        skillMultiplier: { additiveTotal: 0.35, multiplierProduct: 1.18, finalValue: 3.2449999999999997 },
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
          base: 16960.53490175,
          afterCrit: 22540.55088442575,
          afterBonus: 45193.804523273626,
          afterDefense: 22596.902261636813,
          afterResistance: 19659.304967624026,
          afterAmplify: 23428.97669516593,
          afterFragile: 28686.439065561164,
          afterVulnerability: 34228.659093027585,
          afterCombo: 43128.11045721476,
          final: 50459.88923494126,
        },
        crit: {
          base: 16960.53490175,
          afterCrit: 32903.437709395,
          afterBonus: 65971.39260733698,
          afterDefense: 32985.69630366849,
          afterResistance: 28697.555784191587,
          afterAmplify: 34200.31210581032,
          afterFragile: 41874.862142354155,
          afterVulnerability: 49965.08550825698,
          afterCombo: 62956.0077404038,
          final: 73658.52905627244,
        },
        nonCrit: {
          base: 16960.53490175,
          afterCrit: 16960.53490175,
          afterBonus: 34005.87247800875,
          afterDefense: 17002.936239004375,
          afterResistance: 14792.554527933806,
          afterAmplify: 17629.02685866511,
          afterFragile: 21584.980485749562,
          afterVulnerability: 25755.19871559638,
          afterCombo: 32451.55038165144,
          final: 37968.31394653218,
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
    expected: [50459.88923494126, 25661.67766567775],
    crit: [73658.52905627244, 37459.4843276259],
    nonCrit: [37968.31394653218, 19309.01254001336],
  },
} as const;
