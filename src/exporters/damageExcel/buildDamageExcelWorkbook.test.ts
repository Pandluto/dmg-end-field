import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { SkillButtonBuff } from '../../types/storage';
import { buildDamageExcelWorkbook } from './buildDamageExcelWorkbook';
import type {
  DamageExcelBuffContributionSnapshot,
  DamageExcelHitRow,
  DamageExcelZoneCalculationSnapshot,
} from './damageExcelModel';

function additiveContribution(
  buffId: string,
  type: string,
  value: number,
): DamageExcelBuffContributionSnapshot {
  return {
    buffId,
    type,
    multiplier: false,
    rawValue: value,
    runtimeCoefficient: 1,
    effectiveValue: value,
  };
}

function multiplierContribution(
  buffId: string,
  type: string,
  coefficient: number,
): DamageExcelBuffContributionSnapshot {
  return {
    buffId,
    type,
    multiplier: true,
    rawValue: 0,
    runtimeCoefficient: 1,
    effectiveValue: coefficient,
    multiplierCoefficient: coefficient,
  };
}

function structuredZone(
  baseValue: number,
  additive: DamageExcelBuffContributionSnapshot,
  multiplier: DamageExcelBuffContributionSnapshot,
): DamageExcelZoneCalculationSnapshot {
  return {
    additiveContributions: [additive],
    multiplierContributions: [multiplier],
    additiveTotal: additive.effectiveValue,
    multiplierProduct: multiplier.multiplierCoefficient ?? multiplier.effectiveValue,
    finalValue: baseValue + additive.effectiveValue * (multiplier.multiplierCoefficient ?? multiplier.effectiveValue),
  };
}

function buff(
  id: string,
  type: string,
  value?: number,
  coefficient?: number,
): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'workbook golden',
    source: 'test',
    type,
    value,
    multiplier: coefficient === undefined ? undefined : { coefficient },
    refCount: 1,
  };
}

const damageAdditive = additiveContribution('damage-additive', 'fireDmgBonus', 0.16);
const damageMultiplier = multiplierContribution('damage-multiplier', 'fireDmgBonus', 1.5);
const skillAdditive = additiveContribution('skill-additive', 'multiplierBonus', 0.4);
const skillMultiplier = multiplierContribution('skill-multiplier', 'multiplierBonus', 1.2);

const hitRow: DamageExcelHitRow = {
  kind: 'hit',
  id: 'hit-row',
  characterId: 'operator',
  buttonId: 'button',
  rowIndex: 0,
  values: {},
  detail: {
    characterName: '测试干员',
    buttonName: '测试技能',
    hitLabel: '第一段',
    hit: {
      key: 'hit-1',
      displayName: '第一段',
      multiplier: 3.3,
      element: 'fire',
      skillType: 'B',
    },
    hitResult: {
      panel: { atk: 1000, critRate: 0, critDmg: 0 },
      multiplier: { base: 3.3, afterBonus: 3.7, afterMultiply: 4.44 },
      zones: {
        damageBonus: structuredZone(1, damageAdditive, damageMultiplier),
        skillMultiplier: {
          additiveContributions: [skillAdditive],
          multiplierContributions: [skillMultiplier],
          additiveTotal: 0.4,
          multiplierProduct: 1.2,
          finalValue: 4.44,
        },
        damageBonusRate: 1.24,
        defenseZone: 1,
        resistanceZone: 1,
        amplifyRate: 0,
        fragileRate: 0,
        vulnerabilityRate: 0,
        comboDamageBonus: 0,
        imbalanceDamageBonus: 0,
        elementBonus: 0.16,
        skillBonus: 0,
        allDamageBonus: 0,
      },
      nonCrit: { base: 4440, final: 5505.6 },
      crit: { final: 5505.6 },
      expected: { final: 5505.6 },
    },
  },
};

const workbook = buildDamageExcelWorkbook({
  rows: [hitRow],
  columns: [],
  allBuffList: [
    buff('damage-additive', 'fireDmgBonus', 0.16),
    buff('damage-multiplier', 'fireDmgBonus', undefined, 1.5),
    buff('skill-additive', 'multiplierBonus', 0.4),
    buff('skill-multiplier', 'multiplierBonus', undefined, 1.2),
  ],
});

function assertFormulaCell(
  targetWorkbook: ExcelJS.Workbook,
  sheetName: string,
  address: string,
  expectedFormula: string,
  expectedResult: number,
): void {
  const sheet = targetWorkbook.getWorksheet(sheetName);
  assert.ok(sheet, `${sheetName} worksheet should exist`);
  const value = sheet.getCell(address).value;
  assert.ok(value && typeof value === 'object' && 'formula' in value, `${sheetName}!${address} should be a formula cell`);
  assert.equal(value.formula, expectedFormula, `${sheetName}!${address} formula`);
  assert.equal(value.result, expectedResult, `${sheetName}!${address} cached result`);
}

assertFormulaCell(
  workbook,
  '命中',
  'S2',
  `1+('Buff贡献'!H2)*PRODUCT('Buff贡献'!I3)`,
  1.24,
);
assertFormulaCell(workbook, '命中', 'K2', 'H2+I2', 3.7);
assertFormulaCell(workbook, '命中', 'L2', 'K2*J2', 4.44);

const serialized = await workbook.xlsx.writeBuffer();
const reloadedWorkbook = new ExcelJS.Workbook();
await reloadedWorkbook.xlsx.load(serialized);

assertFormulaCell(
  reloadedWorkbook,
  '命中',
  'S2',
  `1+('Buff贡献'!H2)*PRODUCT('Buff贡献'!I3)`,
  1.24,
);
assertFormulaCell(reloadedWorkbook, '命中', 'L2', 'K2*J2', 4.44);

console.log('Damage Excel structured zone formula round-trip contract: PASS');
