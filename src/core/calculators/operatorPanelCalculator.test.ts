import { buildConfigSnapshot } from './operatorPanelCalculator.ts';
import { calculateSkillButtonDamageV2 } from './skillButtonDamageCalculatorV2.ts';
import { buildSnapshotEquipmentCandidateBuffs, buildSnapshotWeaponCandidateBuffs } from '../services/operatorConfigCandidateBuffService.ts';
import type { DamageBonusSnapshot } from '../../types/storage.ts';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertAlmostEqual(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const snapshot = buildConfigSnapshot({
  operator: {
    id: 'op-test',
    name: '测试干员',
    level: 90,
    potential: '0潜',
    element: 'fire',
    mainStat: '力量',
    subStat: '敏捷',
    favorValue: 60,
    attributes: {
      level90: {
        atk: 100,
        hp: 1000,
        strength: 100,
        agility: 50,
        intelligence: 20,
        will: 10,
      },
    },
  },
  weapon: {
    id: 'weapon-test',
    name: '测试武器',
    config: {
      level: 90,
      potential: '0潜',
      skillLevels: {
        skill1: 1,
        skill2: 1,
        skill3: 1,
      },
    },
    data: {
      attackGrowth: {
        90: 20,
      },
      skills: {
        skill1: {
          name: '力量提升',
          statType: '力量提升',
          levels: {
            1: { value: 10 },
          },
        },
        skill2: {
          name: '生命提升',
          statType: '生命提升',
          levels: {
            1: { value: 20 },
          },
        },
        skill3: {
          name: '被动与条件测试',
          effects: {
            passiveCrit: {
              name: '暴击伤害',
              type: 'critDmgBonusBoost',
              category: 'passive',
              levels: {
                1: 10,
              },
            },
            conditionAtk: {
              name: '条件攻击',
              type: 'atkPercentBoost',
              category: 'condition',
              levels: {
                1: 100,
              },
            },
          },
        },
      },
    },
  },
  equipment: {
    pieces: [
      {
        slotKey: 'armor',
        equipmentId: 'equip-test',
        name: '测试装备',
        part: '护甲',
        effects: [
          {
            effectId: 'effect1',
            label: '攻击力',
            typeKey: 'atkPercentBoost',
            level: 1,
            value: 10,
            unit: 'percent',
          },
          {
            effectId: 'effect2',
            label: '法术伤害加成',
            typeKey: 'magicDmgBonus',
            level: 1,
            value: 15,
            unit: 'percent',
          },
          {
            effectId: 'effect3',
            label: '所有技能伤害加成',
            typeKey: 'allSkillDmgBonus',
            level: 1,
            value: 5,
            unit: 'percent',
          },
          {
            effectId: 'effect4',
            label: '寒冷和电磁伤害加成',
            typeKey: 'iceElectricDmgBonus',
            level: 1,
            value: 11,
            unit: 'percent',
          },
          {
            effectId: 'effect5',
            label: '敏捷提升',
            typeKey: 'agilityBoost',
            level: 1,
            value: 8,
            unit: 'flat',
          },
        ],
      },
      {
        slotKey: 'glove',
        equipmentId: 'equip-crit',
        name: '暴伤装备',
        part: '护手',
        effects: [
          {
            effectId: 'effect1',
            label: '暴击伤害',
            typeKey: 'critDmgBonusBoost',
            level: 1,
            value: 22,
            unit: 'percent',
          },
          {
            effectId: 'effect2',
            label: '物理伤害加成',
            typeKey: 'physicalDmgBonus',
            level: 1,
            value: 7,
            unit: 'percent',
          },
          {
            effectId: 'effect3',
            label: '对失衡目标伤害加成',
            typeKey: 'imbalanceDmgBonus',
            level: 1,
            value: 9,
            unit: 'percent',
          },
          {
            effectId: 'effect4',
            label: '灼热和自然伤害加成',
            typeKey: 'fireNatureDmgBonus',
            level: 1,
            value: 12,
            unit: 'percent',
          },
        ],
      },
      {
        slotKey: 'accessory1',
        equipmentId: 'equip-third',
        name: '三件套测试装备',
        part: '配件',
        effects: [],
      },
      {
        slotKey: 'accessory2',
        equipmentId: 'equip-third',
        name: '三件套测试装备复制槽',
        part: '配件',
        effects: [],
      },
    ],
    setBuffs: [
      {
        gearSetId: 'set-passive-test',
        gearSetName: '常驻三件套',
        effectId: 'effect1',
        label: '三件套技艺',
        typeKey: 'sourceSkillBoost',
        category: 'passive',
        level: '三件套',
        value: 5,
        unit: 'flat',
      },
      {
        gearSetId: 'set-condition-test',
        gearSetName: '条件三件套',
        effectId: 'effect1',
        label: '三件套条件全伤害',
        typeKey: 'allDmgBonus',
        category: 'condition',
        level: '三件套',
        value: 99,
        unit: 'percent',
      },
    ],
  },
});

assertEqual(snapshot.weapon.totals.hpPercent, 0.2, 'skill2 hp normalizes to hpPercent');
assertEqual(snapshot.equipment.totals.agilityBoost, 8, 'equipment agility enters equipment totals');
assertEqual(snapshot.panel.calc.agility, 58, 'equipment agility enters panel agility');
assertEqual('atk' in snapshot.panel.calc, false, 'panel calc does not store formula result atk');
assertEqual(snapshot.weapon.totals.atkPercentBoost ?? 0, 0, 'condition skill3 does not enter weapon totals');
assertEqual(snapshot.panel.calc.critDmgBonusBoost, 0.32, 'crit damage boost stays atomic in panel calc');
assertEqual(snapshot.panel.display.critDmg, 0.82, 'crit damage display sums default, equipment, skill3 passive');
assertEqual(snapshot.equipment.setBuffs.length, 2, 'equipment set buffs are preserved in snapshot');
assertEqual(snapshot.equipment.totals.sourceSkillBoost, 5, 'passive three-piece buff enters equipment totals');
assertEqual(snapshot.panel.calc.sourceSkillBoost, 5, 'passive three-piece buff enters panel calc');
assertEqual(snapshot.panel.calc.damageBonus.allDmgBonus, 0, 'condition three-piece buff does not enter panel calc');
assertEqual(snapshot.panel.display.damageBonus.magicDmgBonus, 0.15, 'magicDmgBonus stays atomic in display snapshot');
assertEqual(snapshot.panel.display.damageBonus.fireDmgBonus, 0.27, 'fire display damage includes magic and split fire/nature bonus');
assertEqual(snapshot.panel.display.damageBonus.physicalDmgBonus, 0.07, 'magicDmgBonus does not expand to physical');
assertEqual(snapshot.panel.display.damageBonus.skillDmgBonus, 0.05, 'allSkillDmgBonus expands to skill damage');
assertEqual(snapshot.panel.display.damageBonus.imbalanceDmgBonus, 0.09, 'imbalance damage passes through display');
assertEqual(snapshot.equipment.totals.iceElectricDmgBonus, 0.11, 'ice/electric composite equipment bonus normalizes to decimal');
assertEqual(snapshot.equipment.totals.fireNatureDmgBonus, 0.12, 'fire/nature composite equipment bonus normalizes to decimal');
assertEqual(snapshot.panel.calc.damageBonus.iceDmgBonus, 0.11, 'ice/electric composite equipment bonus enters calc ice damage');
assertEqual(snapshot.panel.calc.damageBonus.electricDmgBonus, 0.11, 'ice/electric composite equipment bonus enters calc electric damage');
assertEqual(snapshot.panel.calc.damageBonus.fireDmgBonus, 0.12, 'fire/nature composite equipment bonus enters calc fire damage');
assertEqual(snapshot.panel.calc.damageBonus.natureDmgBonus, 0.12, 'fire/nature composite equipment bonus enters calc nature damage');
assertEqual(snapshot.panel.display.damageBonus.iceDmgBonus, 0.26, 'display ice damage includes magic and split ice/electric bonus');
assertEqual(snapshot.panel.display.damageBonus.electricDmgBonus, 0.26, 'display electric damage includes magic and split ice/electric bonus');
assertEqual(snapshot.panel.display.damageBonus.fireDmgBonus, 0.27, 'display fire damage includes magic and split fire/nature bonus');
assertEqual(snapshot.panel.display.damageBonus.natureDmgBonus, 0.27, 'display nature damage includes magic and split fire/nature bonus');
assertEqual(snapshot.detailMarkdown.includes('- 寒冷伤害加成: 26%'), true, 'detail markdown shows split ice/electric bonus');
assertEqual(snapshot.detailMarkdown.includes('- 电磁伤害加成: 26%'), true, 'detail markdown shows split ice/electric bonus');

const weaponCandidates = buildSnapshotWeaponCandidateBuffs(snapshot);
assertEqual(weaponCandidates.length, 1, 'only condition skill3 enters snapshot candidate buffs');
assertEqual(weaponCandidates[0].type, 'atkPercentBoost', 'weapon skill3 condition keeps type');
assertEqual(weaponCandidates[0].origin, 'operatorConfigSnapshot', 'weapon candidate is tagged as snapshot-derived');
assertEqual(weaponCandidates[0].ownerCharacterId, 'op-test', 'weapon candidate records owner character');

const equipmentLibrary = {
  gearSets: {
    'set-test': {
      gearSetId: 'set-test',
      name: '测试三件套',
      equipments: {
        'equip-test': { equipmentId: 'equip-test' },
        'equip-crit': { equipmentId: 'equip-crit' },
        'equip-third': { equipmentId: 'equip-third' },
      },
      threePieceBuffs: {
        effect1: {
          effectId: 'effect1',
          name: '三件套全伤害',
          category: 'condition',
          typeKey: 'allDmgBonus',
          value: 0.12,
          raw: '三件套：全伤害 +12%',
        },
      },
    },
  },
};
const equipmentCandidates = buildSnapshotEquipmentCandidateBuffs(snapshot, equipmentLibrary);
assertEqual(equipmentCandidates.length, 1, 'three selected equipments trigger three-piece candidate');
assertEqual(equipmentCandidates[0].type, 'allDmgBonus', 'three-piece candidate keeps all damage type');
assertEqual(equipmentCandidates[0].ownerCharacterId, 'op-test', 'three-piece candidate records owner character');

const twoPieceSnapshot = {
  ...snapshot,
  equipment: {
    ...snapshot.equipment,
    pieces: snapshot.equipment.pieces.slice(0, 2),
  },
};
assertEqual(buildSnapshotEquipmentCandidateBuffs(twoPieceSnapshot, equipmentLibrary).length, 0, 'two selected equipments do not trigger three-piece candidate');

function emptyDamageBonus(overrides: Partial<DamageBonusSnapshot> = {}): DamageBonusSnapshot {
  return {
    physicalDmgBonus: 0,
    fireDmgBonus: 0,
    electricDmgBonus: 0,
    iceDmgBonus: 0,
    natureDmgBonus: 0,
    magicDmgBonus: 0,
    normalAttackDmgBonus: 0,
    skillDmgBonus: 0,
    chainSkillDmgBonus: 0,
    ultimateDmgBonus: 0,
    allSkillDmgBonus: 0,
    imbalanceDmgBonus: 0,
    allDmgBonus: 0,
    ...overrides,
  };
}

const physicalDamage = calculateSkillButtonDamageV2({
  buttonId: 'button-physical',
  characterId: 'op-test',
  runtimeSkillId: 'skill-physical',
  template: {
    characterId: 'op-test',
    characterName: '测试干员',
    runtimeSkillId: 'skill-physical',
    displayName: '物理测试',
    buttonType: 'A',
    hits: [{ key: 'hit1', displayName: '物理段', multiplier: 1, element: 'physical', skillType: 'A' }],
  },
  buffs: [],
  panel: { atk: 100, critRate: 0, critDmg: 0 },
  damageBonus: emptyDamageBonus({ physicalDmgBonus: 0.2, allDmgBonus: 0.1 }),
});
assertAlmostEqual(physicalDamage.hits[0].zones.elementBonus, 0.2, 'physical element zone excludes allDmgBonus');
assertAlmostEqual(physicalDamage.hits[0].zones.allDamageBonus, 0.1, 'physical all damage zone includes allDmgBonus once');
assertAlmostEqual(physicalDamage.hits[0].nonCrit.final, 65, 'physical damage applies allDmgBonus exactly once');

const fireDamage = calculateSkillButtonDamageV2({
  buttonId: 'button-fire',
  characterId: 'op-test',
  runtimeSkillId: 'skill-fire',
  template: {
    characterId: 'op-test',
    characterName: '测试干员',
    runtimeSkillId: 'skill-fire',
    displayName: '火伤测试',
    buttonType: 'A',
    hits: [{ key: 'hit1', displayName: '火伤段', multiplier: 1, element: 'fire', skillType: 'A' }],
  },
  buffs: [],
  panel: { atk: 100, critRate: 0, critDmg: 0 },
  damageBonus: emptyDamageBonus({ fireDmgBonus: 0.05, magicDmgBonus: 0.2, allDmgBonus: 0.1 }),
});
assertAlmostEqual(fireDamage.hits[0].zones.elementBonus, 0.25, 'element zone includes element and magic bonuses');
assertAlmostEqual(fireDamage.hits[0].zones.allDamageBonus, 0.1, 'element all damage zone includes allDmgBonus once');
assertAlmostEqual(fireDamage.hits[0].nonCrit.final, 67.5, 'element damage applies allDmgBonus exactly once');
