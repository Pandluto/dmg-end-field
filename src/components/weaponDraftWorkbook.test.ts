import assert from 'node:assert/strict';
import {
  buildWeaponSheetColumns,
  buildWeaponWorkbookRows,
  columnIndexToLabel,
} from './WeaponDraftPage';
import { buildWeaponSheetRows, normalizeWeaponDraft } from './weaponDraftModel';

const columns = buildWeaponSheetColumns();
assert.deepEqual(columns, [
  { key: 'name', title: '名称', width: 220 },
  { key: 'idText', title: 'ID', width: 120 },
  { key: 'slot', title: '字段', width: 220, align: 'center' },
  { key: 'level', title: '等级', width: 72, align: 'center' },
  { key: 'effectKey', title: '效果键', width: 180 },
  { key: 'valueText', title: '数值', width: 110, align: 'right' },
  { key: 'description', title: '描述', width: 420 },
]);

assert.equal(columnIndexToLabel(0), 'A');
assert.equal(columnIndexToLabel(25), 'Z');
assert.equal(columnIndexToLabel(26), 'AA');
assert.equal(columnIndexToLabel(701), 'ZZ');

const draft = normalizeWeaponDraft({
  id: 'weapon-workbook',
  name: '测试武器',
  rarity: 6,
  type: '单手剑',
  description: '工作簿投影',
  imgUrl: '/images/Test%20Weapon.png',
  attackGrowth: { 1: 100, 90: 278 },
  skills: {
    skill1: {
      statType: '敏捷提升',
      levels: { 1: { value: 10 } },
    },
    skill2: {
      statType: '攻击提升',
      levels: { 1: { value: 12 } },
    },
    skill3: {
      levels: { 1: { value: 1 } },
      effects: {
        fixed: {
          name: '固定增伤',
          type: 'physicalDmgBonus',
          category: 'passive',
          levels: { 1: 10, 9: 90 },
        },
        extra: {
          name: '额外伤害',
          type: '',
          category: 'countable',
          effectKind: 'extraHit',
          extraHitConfig: {
            key: 'extra-hit',
            damageType: 'fire',
            skillType: 'E',
            baseMultiplier: 2.5,
            imbalanceValue: 10,
            cooldownSeconds: 5,
            trigger: 'physicalAbnormal',
          },
          levels: { 1: 2.5, 9: 4.5 },
        },
      },
    },
  },
});

const sheetRows = buildWeaponSheetRows(draft);
const sourceSnapshot = structuredClone(sheetRows);
const workbookRows = buildWeaponWorkbookRows(draft, sheetRows, columns);

assert.equal(workbookRows.length, 15);
assert.deepEqual(workbookRows[0].cells.map((cell) => cell.address), [
  'A1',
  'B1',
  'C1',
  'D1',
  'E1',
  'F1',
  'G1',
]);
assert.deepEqual(workbookRows[0].cells.map((cell) => cell.value), [
  '测试武器',
  'weapon-workbook',
  '/images/Test Weapon.png',
  '-',
  '-',
  '6★',
  '工作簿投影',
]);
assert.deepEqual(workbookRows[0].cells.map((cell) => cell.align), [
  'left',
  'left',
  'center',
  'center',
  'left',
  'right',
  'left',
]);
assert.deepEqual(workbookRows[0].cells.map((cell) => cell.width), [220, 120, 220, 72, 180, 110, 420]);
assert.ok(workbookRows[0].cells.every((cell) => cell.sourceRowKey === 'weapon-weapon-workbook'));

const rowsByKey = Object.fromEntries(workbookRows.map((row) => [row.key, row]));
assert.equal(rowsByKey['effect-skill1-value'].cells[4].value, '敏捷提升');
assert.equal(rowsByKey['effect-skill3-value'].cells[4].value, 'value');
assert.equal(
  rowsByKey['effect-skill3-effect-fixed'].cells[4].value,
  '物理伤害加成 · physicalDmgBonus',
);
assert.equal(rowsByKey['effect-skill3-effect-fixed'].cells[4].address, 'E12');
assert.equal(rowsByKey['effect-skill3-effect-extra'].cells[4].value, 'fire / E');
assert.equal(rowsByKey['effect-skill3-effect-extra'].cells[4].address, 'E14');
assert.equal(rowsByKey['effect-levels-skill3-effect-extra'].rowNumber, 15);
assert.deepEqual(sheetRows, sourceSnapshot, 'workbook projection must not mutate sheet rows');

console.log('Weapon workbook projection characterization contract: PASS');
