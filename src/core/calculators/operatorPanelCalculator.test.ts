import { buildConfigSnapshot, OperatorPanelInput } from './operatorPanelCalculator';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const baseInput: OperatorPanelInput = {
  operator: {
    id: 'test-operator',
    name: 'Test Operator',
    level: 90,
    potential: '0潜',
    mainStat: '力量',
    subStat: '敏捷',
    attributes: {
      level90: {
        atk: 100,
        hp: 1000,
        strength: 10,
        agility: 20,
        intelligence: 30,
        will: 40,
      },
    },
  },
  weapon: {
    id: 'test-weapon',
    name: 'Test Weapon',
    config: {
      level: 90,
      potential: '0潜',
      skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
    },
    data: {
      attackGrowth: { '90': 50 },
      skills: {},
    },
  },
  equipment: {
    pieces: [],
    setBuffs: [],
  },
};

const sourceSkillSnapshot = buildConfigSnapshot({
  ...baseInput,
  equipment: {
    pieces: [],
    setBuffs: [
      {
        effectId: 'set-source-skill',
        label: '源石技艺强度',
        typeKey: 'sourceSkillBoost',
        level: '三件套',
        value: 30,
        unit: 'percent',
        raw: '源石技艺强度 +30%',
        gearSetId: 'burn',
        gearSetName: '动火用',
        category: 'passive',
      },
    ],
  },
});

assertEqual(sourceSkillSnapshot.panel.calc.sourceSkillBoost, 30, 'sourceSkillBoost set buff should stay as flat source skill points');
assertEqual(sourceSkillSnapshot.panel.display.sourceSkill, 30, 'sourceSkill display should include flat sourceSkillBoost points');

const damagePercentSnapshot = buildConfigSnapshot({
  ...baseInput,
  equipment: {
    pieces: [],
    setBuffs: [
      {
        effectId: 'set-physical',
        label: '物理伤害加成',
        typeKey: 'physicalDmgBonus',
        level: '三件套',
        value: 30,
        unit: 'percent',
        raw: '物理伤害加成 +30%',
        gearSetId: 'physical',
        gearSetName: '物理套',
        category: 'passive',
      },
    ],
  },
});

assertEqual(damagePercentSnapshot.panel.calc.damageBonus.physicalDmgBonus, 0.3, 'percent damage set buff should still normalize to ratio');
