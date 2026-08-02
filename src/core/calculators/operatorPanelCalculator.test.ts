import { buildConfigSnapshot } from './operatorPanelCalculator';
import type { EquipmentEffectInput, OperatorPanelInput } from './operatorPanelCalculator';

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
    mainStatFlatBonus: 0,
    subStatFlatBonus: 0,
    attributes: {
      level90: {
        atk: 0,
        hp: 0,
        strength: 10,
        agility: 20,
        intelligence: 0,
        will: 0,
      },
    },
  },
  equipment: {
    pieces: [],
    setBuffs: [],
  },
};

function buildEquipmentSnapshot(effects: EquipmentEffectInput[]) {
  return buildConfigSnapshot({
    ...baseInput,
    equipment: {
      pieces: [
        {
          slotKey: 'accessory1',
          equipmentId: 'test-equipment',
          name: 'Test Equipment',
          effects,
        },
      ],
      setBuffs: [],
    },
  });
}

const effect1MainStat = (value: number): EquipmentEffectInput => ({
  effectId: 'effect1',
  label: '主能力',
  typeKey: 'mainStatBoost',
  level: 3,
  value,
  unit: 'percent',
});

const effect2SubStat = (value: number): EquipmentEffectInput => ({
  effectId: 'effect2',
  label: '副能力',
  typeKey: 'subStatBoost',
  level: 3,
  value,
  unit: 'percent',
});

const effect3SubStat = (value: number): EquipmentEffectInput => ({
  effectId: 'effect3',
  label: '副能力',
  typeKey: 'subStatBoost',
  level: 3,
  value,
  unit: 'percent',
});

const effect3PhysicalDamage = (value: number): EquipmentEffectInput => ({
  effectId: 'effect3',
  label: '物理伤害',
  typeKey: 'physicalDmgBonus',
  level: 3,
  value,
  unit: 'percent',
});

const finalEffect2Snapshot = buildEquipmentSnapshot([
  effect1MainStat(18),
  effect2SubStat(0.35),
]);

assertEqual(finalEffect2Snapshot.equipment.totals.mainStat, 18, 'effect1 mainStatBoost should be a fixed mainStat when effect2 is last');
assertEqual(finalEffect2Snapshot.equipment.totals.subStatBoost, 0.35, 'last effect2 subStatBoost should remain a percentage subStatBoost');
assertEqual(finalEffect2Snapshot.equipment.totals.subStat, undefined, 'last effect2 subStatBoost should not become fixed subStat');
assertEqual(finalEffect2Snapshot.panel.calc.mainStatBoost, 0, 'fixed effect1 mainStat should not enter panel mainStatBoost');
assertEqual(finalEffect2Snapshot.panel.calc.subStatBoost, 0.35, 'last effect2 subStatBoost should enter panel subStatBoost');
assertEqual(finalEffect2Snapshot.panel.display.mainStatFinal, 28, 'fixed effect1 mainStat should raise the displayed main stat');
assertEqual(finalEffect2Snapshot.panel.display.subStatFinal, 27, 'last effect2 subStatBoost should scale the displayed sub stat');

const missingEffect2Snapshot = buildEquipmentSnapshot([
  effect1MainStat(12),
  effect3SubStat(0.25),
]);

assertEqual(missingEffect2Snapshot.equipment.totals.mainStat, 12, 'effect1 mainStatBoost should be fixed when effect3 is the last existing effect');
assertEqual(missingEffect2Snapshot.equipment.totals.subStatBoost, 0.25, 'effect3 subStatBoost should remain a percentage when effect2 is absent');
assertEqual(missingEffect2Snapshot.equipment.totals.subStat, undefined, 'effect3 subStatBoost should not become fixed subStat');
assertEqual(missingEffect2Snapshot.panel.calc.mainStatBoost, 0, 'missing effect2 should not change effect1 fixed-main semantics');
assertEqual(missingEffect2Snapshot.panel.calc.subStatBoost, 0.25, 'effect3 should supply the panel subStatBoost when it is last');
assertEqual(missingEffect2Snapshot.panel.display.mainStatFinal, 22, 'effect1 fixed mainStat should be reflected with a missing middle effect');
assertEqual(missingEffect2Snapshot.panel.display.subStatFinal, 25, 'effect3 percentage subStatBoost should be reflected with a missing middle effect');

const finalNormalDamageSnapshot = buildEquipmentSnapshot([
  effect1MainStat(14),
  effect2SubStat(7),
  effect3PhysicalDamage(0.2),
]);

assertEqual(finalNormalDamageSnapshot.equipment.totals.mainStat, 14, 'non-final effect1 mainStatBoost should become fixed mainStat');
assertEqual(finalNormalDamageSnapshot.equipment.totals.subStat, 7, 'non-final effect2 subStatBoost should become fixed subStat');
assertEqual(finalNormalDamageSnapshot.equipment.totals.mainStatBoost, undefined, 'non-final effect1 should not contribute mainStatBoost');
assertEqual(finalNormalDamageSnapshot.equipment.totals.subStatBoost, undefined, 'non-final effect2 should not contribute subStatBoost');
assertEqual(finalNormalDamageSnapshot.equipment.totals.physicalDmgBonus, 0.2, 'last normal damage effect should remain its damage total');
assertEqual(finalNormalDamageSnapshot.panel.calc.mainStatBoost, 0, 'fixed mainStat should not scale the panel main stat');
assertEqual(finalNormalDamageSnapshot.panel.calc.subStatBoost, 0, 'fixed subStat should not scale the panel sub stat');
assertEqual(finalNormalDamageSnapshot.panel.calc.damageBonus.physicalDmgBonus, 0.2, 'last normal damage effect should reach panel damage calculation');
assertEqual(finalNormalDamageSnapshot.panel.display.mainStatFinal, 24, 'fixed mainStat should be reflected in the displayed main stat');
assertEqual(finalNormalDamageSnapshot.panel.display.subStatFinal, 27, 'fixed subStat should be reflected in the displayed sub stat');
assertEqual(finalNormalDamageSnapshot.panel.display.damageBonus.physicalDmgBonus, 0.2, 'last normal damage effect should reach panel damage display');
