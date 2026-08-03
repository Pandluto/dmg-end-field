import assert from 'node:assert/strict';
import {
  buildRows,
  buildWorkbookRows,
  COLUMNS,
  columnIndexToLabel,
  filterVisibleRows,
  formatEffectLevelsSummary,
  getWorkbookRowClassName,
  type EquipmentRow,
  type EquipmentWorkbookRow,
} from './equipmentSheetWorkbook';
import type {
  EquipmentEffect,
  EquipmentEffectId,
  EquipmentGearSet,
  EquipmentItem,
  EquipmentLibrary,
} from './equipmentSheetModel';

function makeEffect(effectId: EquipmentEffectId, overrides: Partial<EquipmentEffect> = {}): EquipmentEffect {
  return {
    effectId,
    label: `效果 ${effectId}`,
    typeKey: 'physicalDmgBonus',
    category: 'buff',
    levels: { '0': 0.1234, '1': 0.2345, '2': 0.3456, '3': 0.4567 },
    unit: 'percent',
    raw: '物理伤害：+12.34%/+23.45%/+34.56%/+45.67%',
    ...overrides,
  };
}

function makeEquipment(overrides: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    equipmentId: 'equipment-workbook',
    name: '主装备',
    part: '护甲',
    imgUrl: '/equipment.png',
    fixedStat: {
      label: '防御力',
      typeKey: 'defense',
      value: 999,
      unit: 'flat',
      raw: '防御力：+999',
    },
    effects: {
      effect1: makeEffect('effect1', { label: '百分比效果' }),
      effect2: makeEffect('effect2', {
        label: '固定效果',
        typeKey: 'strengthBoost',
        category: 'ability',
        unit: 'flat',
        levels: { '0': 10, '1': 20, '2': 30, '3': 40 },
        raw: '力量：+10/+20/+30/+40',
      }),
      effect3: makeEffect('effect3', { label: '第三效果', levels: {} }),
    },
    ...overrides,
  };
}

function makeWorkbookLibrary(overrides: Partial<EquipmentGearSet> = {}): EquipmentLibrary {
  return {
    updatedAt: '2026-08-03T00:00:00.000Z',
    gearSets: {
      'gear-set-workbook': {
        gearSetId: 'gear-set-workbook',
        name: '测试套装',
        buffId: 'buff-workbook',
        imgUrl: '/set.png',
        threePieceBuffs: {
          effect1: {
            effectId: 'three-piece-effect',
            name: '三件套增益',
            category: 'passive',
            typeKey: 'physicalDmgBonus',
            value: 0.12,
            unit: 'percent',
            raw: '物理伤害：+12%',
          },
        },
        equipments: {
          'equipment-workbook': makeEquipment(),
        },
        ...overrides,
      },
    },
  };
}

function projectRows(rows: EquipmentRow[]) {
  return rows.map(({ kind, key, valueText }) => ({ kind, key, valueText }));
}

const library = makeWorkbookLibrary();
const libraryBeforeRows = structuredClone(library);
const rows = buildRows(library);
assert.deepEqual(library, libraryBeforeRows, 'buildRows must not mutate the input library');
assert.deepEqual(projectRows(rows), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuffHeader', key: 'three-piece-buff-header-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuff', key: 'three-piece-buff-gear-set-workbook-effect1', valueText: '0.12' },
  { kind: 'equipment', key: 'equipment-gear-set-workbook-equipment-workbook', valueText: '' },
  { kind: 'fixedStat', key: 'fixed-gear-set-workbook-equipment-workbook', valueText: '999' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect1', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect1', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect3', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect3', valueText: '' },
]);

assert.equal(
  formatEffectLevelsSummary(makeEffect('effect1', {
    label: '百分比',
    levels: { '0': 0.1234, '1': undefined, '2': 1.2, '3': 0 },
  })),
  '百分比：+12.34% / - / +120% / +0%',
);
assert.equal(
  formatEffectLevelsSummary(makeEffect('effect1', {
    label: '固定',
    unit: 'flat',
    levels: { '0': 1, '1': 2.34567 },
  })),
  '固定：+1 / +2.3457 / - / -',
);
assert.equal(
  formatEffectLevelsSummary(makeEffect('effect1', { label: '缺失', levels: {} })),
  '缺失：- / - / - / -',
);

const rowsBeforeFilter = structuredClone(rows);
assert.deepEqual(projectRows(filterVisibleRows(rows, {}, {}, {}, {})), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
]);
assert.deepEqual(projectRows(filterVisibleRows(rows, { 'gear-set-workbook': false }, {}, {}, {})), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuffHeader', key: 'three-piece-buff-header-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuff', key: 'three-piece-buff-gear-set-workbook-effect1', valueText: '0.12' },
  { kind: 'equipment', key: 'equipment-gear-set-workbook-equipment-workbook', valueText: '' },
]);
assert.deepEqual(projectRows(filterVisibleRows(
  rows,
  { 'gear-set-workbook': false },
  { 'gear-set-workbook:equipment-workbook': false },
  {},
  {},
)), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuffHeader', key: 'three-piece-buff-header-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuff', key: 'three-piece-buff-gear-set-workbook-effect1', valueText: '0.12' },
  { kind: 'equipment', key: 'equipment-gear-set-workbook-equipment-workbook', valueText: '' },
  { kind: 'fixedStat', key: 'fixed-gear-set-workbook-equipment-workbook', valueText: '999' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect1', valueText: '%' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect3', valueText: '%' },
]);
assert.deepEqual(projectRows(filterVisibleRows(
  rows,
  { 'gear-set-workbook': false },
  { 'gear-set-workbook:equipment-workbook': false },
  {
    'gear-set-workbook:equipment-workbook:effect1': false,
    'gear-set-workbook:equipment-workbook:effect2': false,
    'gear-set-workbook:equipment-workbook:effect3': false,
  },
  {},
)), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuffHeader', key: 'three-piece-buff-header-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuff', key: 'three-piece-buff-gear-set-workbook-effect1', valueText: '0.12' },
  { kind: 'equipment', key: 'equipment-gear-set-workbook-equipment-workbook', valueText: '' },
  { kind: 'fixedStat', key: 'fixed-gear-set-workbook-equipment-workbook', valueText: '999' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect1', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect1', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect3', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect3', valueText: '' },
]);
assert.deepEqual(projectRows(filterVisibleRows(
  rows,
  { 'gear-set-workbook': false },
  { 'gear-set-workbook:equipment-workbook': false },
  {
    'gear-set-workbook:equipment-workbook:effect1': false,
    'gear-set-workbook:equipment-workbook:effect2': false,
    'gear-set-workbook:equipment-workbook:effect3': false,
  },
  { 'gear-set-workbook': true },
)), [
  { kind: 'set', key: 'set-gear-set-workbook', valueText: '' },
  { kind: 'threePieceBuffHeader', key: 'three-piece-buff-header-gear-set-workbook', valueText: '' },
  { kind: 'equipment', key: 'equipment-gear-set-workbook-equipment-workbook', valueText: '' },
  { kind: 'fixedStat', key: 'fixed-gear-set-workbook-equipment-workbook', valueText: '999' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect1', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect1', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect2', valueText: '' },
  { kind: 'effect', key: 'effect-gear-set-workbook-equipment-workbook-effect3', valueText: '%' },
  { kind: 'effectLevels', key: 'levels-gear-set-workbook-equipment-workbook-effect3', valueText: '' },
]);
assert.deepEqual(rows, rowsBeforeFilter, 'filterVisibleRows must not mutate the input rows');

assert.deepEqual(COLUMNS.map((column) => ({
  key: column.key,
  title: column.title,
  width: column.width,
  align: column.align ?? 'left',
})), [
  { key: 'name', title: '名称', width: 220, align: 'left' },
  { key: 'idText', title: 'ID', width: 150, align: 'left' },
  { key: 'field', title: '字段', width: 180, align: 'center' },
  { key: 'level', title: '等级', width: 72, align: 'center' },
  { key: 'effectKey', title: '效果键', width: 180, align: 'left' },
  { key: 'valueText', title: '数值', width: 120, align: 'right' },
  { key: 'description', title: '描述', width: 420, align: 'left' },
]);
assert.equal(columnIndexToLabel(0), 'A');
assert.equal(columnIndexToLabel(6), 'G');
assert.equal(columnIndexToLabel(25), 'Z');
assert.equal(columnIndexToLabel(26), 'AA');
assert.equal(columnIndexToLabel(701), 'ZZ');

const rowsBeforeWorkbook = structuredClone(rows);
const workbookRows: EquipmentWorkbookRow[] = buildWorkbookRows(rows);
assert.deepEqual(library, libraryBeforeRows, 'workbook projection must not mutate the input library');
assert.deepEqual(rows, rowsBeforeWorkbook, 'workbook projection must not mutate the input rows');
assert.equal(workbookRows.length, rows.length);
assert.deepEqual(workbookRows.map(({ rowNumber, key, kind, sourceRow }) => ({
  rowNumber,
  key,
  kind,
  sourceRowKey: sourceRow.key,
})), rows.map((row, index) => ({
  rowNumber: index + 1,
  key: row.key,
  kind: row.kind,
  sourceRowKey: row.key,
})));
assert.deepEqual(workbookRows[0].cells.map(({ address, value, width, align, sourceRowKey }) => ({
  address,
  value,
  width,
  align,
  sourceRowKey,
})), [
  { address: 'A1', value: '测试套装', width: 220, align: 'left', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'B1', value: 'gear-set-workbook', width: 150, align: 'left', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'C1', value: '套装', width: 180, align: 'center', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'D1', value: '-', width: 72, align: 'center', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'E1', value: 'buff-workbook', width: 180, align: 'left', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'F1', value: '', width: 120, align: 'right', sourceRowKey: 'set-gear-set-workbook' },
  { address: 'G1', value: '/set.png', width: 420, align: 'left', sourceRowKey: 'set-gear-set-workbook' },
]);
const effectWorkbookRow = workbookRows.find((row) => row.kind === 'effect' && row.sourceRow.effectId === 'effect1');
assert.ok(effectWorkbookRow);
const threePieceWorkbookRow = workbookRows.find((row) => row.kind === 'threePieceBuff');
assert.ok(threePieceWorkbookRow);
assert.equal(
  threePieceWorkbookRow.cells.find((cell) => cell.columnKey === 'effectKey')?.value,
  '物理伤害加成 · physicalDmgBonus',
);
assert.deepEqual(effectWorkbookRow.cells.map(({ address, value, width, align, sourceRowKey }) => ({
  address,
  value,
  width,
  align,
  sourceRowKey,
})), [
  { address: 'A6', value: '百分比效果', width: 220, align: 'left', sourceRowKey: effectWorkbookRow.key },
  { address: 'B6', value: 'effect1', width: 150, align: 'left', sourceRowKey: effectWorkbookRow.key },
  { address: 'C6', value: 'Buff类型', width: 180, align: 'center', sourceRowKey: effectWorkbookRow.key },
  { address: 'D6', value: 'Lv0~Lv3', width: 72, align: 'center', sourceRowKey: effectWorkbookRow.key },
  { address: 'E6', value: 'physicalDmgBonus', width: 180, align: 'left', sourceRowKey: effectWorkbookRow.key },
  { address: 'F6', value: '%', width: 120, align: 'right', sourceRowKey: effectWorkbookRow.key },
  { address: 'G6', value: '百分比效果：+12.34% / +23.45% / +34.56% / +45.67%', width: 420, align: 'left', sourceRowKey: effectWorkbookRow.key },
]);
const workbookClassByKind = Object.fromEntries(workbookRows.map((row) => [row.kind, getWorkbookRowClassName(row)]));
assert.deepEqual(workbookClassByKind, {
  set: 'damage-sheet-excel-row is-character weapon-sheet-row-weapon',
  threePieceBuffHeader: 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-header',
  threePieceBuff: 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-effect',
  equipment: 'damage-sheet-excel-row is-button weapon-sheet-row-skill',
  fixedStat: 'damage-sheet-excel-row is-data weapon-sheet-row-growth',
  effect: 'damage-sheet-excel-row is-character weapon-sheet-row-effect',
  effectLevels: 'damage-sheet-excel-row is-data weapon-sheet-row-level',
});

console.log('Equipment sheet workbook characterization contract: PASS');
