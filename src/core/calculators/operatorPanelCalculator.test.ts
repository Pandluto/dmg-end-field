import { buildConfigSnapshot } from './operatorPanelCalculator.ts';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
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
    ],
  },
});

assertEqual(snapshot.weapon.totals.hpPercent, 0.2, 'skill2 hp normalizes to hpPercent');
assertEqual(snapshot.equipment.totals.agilityBoost, 8, 'equipment agility enters equipment totals');
assertEqual(snapshot.panel.calc.agility, 58, 'equipment agility enters panel agility');
assertEqual(snapshot.weapon.totals.atkPercentBoost ?? 0, 0, 'condition skill3 does not enter weapon totals');
assertEqual(snapshot.panel.calc.critDmg, 0.82, 'crit damage sums default, equipment, skill3 passive');
assertEqual(snapshot.panel.display.damageBonus.fireDmgBonus, 0.15, 'magicDmgBonus expands to non-physical elements');
assertEqual(snapshot.panel.display.damageBonus.physicalDmgBonus, 0.07, 'magicDmgBonus does not expand to physical');
assertEqual(snapshot.panel.display.damageBonus.skillDmgBonus, 0.05, 'allSkillDmgBonus expands to skill damage');
assertEqual(snapshot.panel.display.damageBonus.imbalanceDmgBonus, 0.09, 'imbalance damage passes through display');
assertEqual(snapshot.equipment.totals.iceElectricDmgBonus, 0.11, 'ice/electric composite equipment bonus normalizes to decimal');
assertEqual(snapshot.equipment.totals.fireNatureDmgBonus, 0.12, 'fire/nature composite equipment bonus normalizes to decimal');
assertEqual(snapshot.panel.display.damageBonus.iceDmgBonus, 0.15, 'phase3 does not split ice/electric composite bonus into display');
assertEqual(snapshot.panel.display.damageBonus.natureDmgBonus, 0.15, 'phase3 does not split fire/nature composite bonus into display');
