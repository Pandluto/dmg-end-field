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

const operatorMainSubStatSnapshot = buildConfigSnapshot({
  ...baseInput,
  operator: {
    ...baseInput.operator,
    mainStatFlatBonus: 60,
    subStatFlatBonus: 0,
    buffs: {
      talent: {
        effects: {
          main: {
            effectId: 'main',
            name: 'Main stat positive',
            type: 'mainStat',
            category: 'positive',
            value: 30,
            unit: 'flat',
          },
          conditionMain: {
            effectId: 'conditionMain',
            name: 'Main stat condition',
            type: 'mainStat',
            category: 'condition',
            value: 999,
            unit: 'flat',
          },
        },
      },
      potential: {
        effects: {
          sub: {
            effectId: 'sub',
            name: 'Sub stat positive',
            type: 'subStat',
            category: 'positive',
            value: 12,
            unit: 'flat',
          },
        },
      },
      skill: { effects: {} },
    },
  },
});

assertEqual(operatorMainSubStatSnapshot.panel.calc.strength, 100, 'operator positive mainStat buff should add to resolved main ability');
assertEqual(operatorMainSubStatSnapshot.panel.calc.agility, 32, 'operator positive subStat buff should add to resolved sub ability');

const derivedOperatorBuffSnapshot = buildConfigSnapshot({
  ...baseInput,
  operator: {
    ...baseInput.operator,
    mainStatFlatBonus: 60,
    subStatFlatBonus: 0,
    buffs: {
      talent: {
        effects: {
          fixedIntelligence: {
            effectId: 'fixedIntelligence',
            name: 'Fixed intelligence',
            type: 'intelligenceBoost',
            category: 'positive',
            value: 20,
            unit: 'flat',
          },
          derivedFromIntelligence: {
            effectId: 'derivedFromIntelligence',
            name: 'Derived atk percent',
            type: 'atkPercentBoost',
            category: 'positive',
            valueMode: 'derived',
            unit: 'percent',
            derivedValue: {
              source: 'intelligence',
              perPointValue: 0.001,
            },
          },
          conditionDerived: {
            effectId: 'conditionDerived',
            name: 'Condition derived atk percent',
            type: 'atkPercentBoost',
            category: 'condition',
            valueMode: 'derived',
            unit: 'percent',
            derivedValue: {
              source: 'will',
              perPointValue: 10,
            },
          },
        },
      },
      potential: { effects: {} },
      skill: { effects: {} },
    },
  },
});

assertEqual(derivedOperatorBuffSnapshot.panel.calc.intelligence, 50, 'fixed operator buff should boost intelligence before derived values read it');
assertEqual(derivedOperatorBuffSnapshot.panel.calc.atkPercentBoost, 0.05, 'derived positive buff should read boosted intelligence and normalize by type/unit');

const operatorFlatAtkAliasSnapshot = buildConfigSnapshot({
  ...baseInput,
  operator: {
    ...baseInput.operator,
    buffs: {
      talent: {
        effects: {
          flatAtkAlias: {
            effectId: 'flatAtkAlias',
            name: 'Flat attack alias',
            type: 'flatAtk',
            category: 'positive',
            value: 25,
            unit: 'flat',
          },
        },
      },
      potential: { effects: {} },
      skill: { effects: {} },
    },
  },
});

assertEqual(operatorFlatAtkAliasSnapshot.panel.calc.flatAtk, 25, 'operator flatAtk alias should contribute to panel fixed attack');
