import assert from 'node:assert/strict';
import {
  buildBuffColumnGroups,
  buildBuffSheetColumns,
  buildBuffWorkbookView,
} from './buffDraftWorkbook';
import type { BuffSheetRow } from './buffDraftModel';

const columns = buildBuffSheetColumns();

assert.deepEqual(columns, [
  { key: 'name', title: '名称', width: 200, group: '索引' },
  { key: 'idText', title: 'ID', width: 110, group: '索引' },
  { key: 'level', title: '层级', width: 60, group: '索引', align: 'center' },
  { key: 'effectKind', title: '效果种类', width: 90, group: '效果区', align: 'center' },
  { key: 'typeLabel', title: '类型', width: 170, group: '效果区' },
  { key: 'valueText', title: '数值', width: 84, group: '效果区', align: 'right' },
  { key: 'categoryText', title: '分类', width: 92, group: '效果区', align: 'center' },
  { key: 'sourceName', title: '来源', width: 110, group: '文本区' },
  { key: 'condition', title: '条件', width: 180, group: '文本区' },
  { key: 'description', title: '描述', width: 240, group: '文本区' },
]);

assert.deepEqual(buildBuffColumnGroups(columns), [
  { group: '索引', width: 370, count: 3 },
  { group: '效果区', width: 436, count: 4 },
  { group: '文本区', width: 530, count: 3 },
]);

const sourceRows: BuffSheetRow[] = [
  {
    kind: 'group',
    key: 'group-test-buff',
    title: '测试 Buff 组',
    summary: '1 个自定义项',
    searchText: 'group search',
  },
  {
    kind: 'item',
    key: 'item-item-7',
    itemKey: 'item-7',
    title: '测试项',
    idText: 'custom-item-id',
    summary: '1 个效果',
    description: '测试项描述',
    effectCount: 1,
    searchText: 'item search',
  },
  {
    kind: 'effect',
    key: 'effect-item-7-buff-9',
    itemKey: 'item-7',
    effectKey: 'buff-9',
    title: '测试效果',
    idText: 'custom-effect-id',
    effectKind: '常规修改',
    typeLabel: '攻击力 · flatAtk',
    valueText: '123',
    categoryText: '可计层/3',
    sourceName: '测试来源',
    condition: '满足测试条件',
    description: '测试效果描述',
    searchText: 'effect search',
  },
];

const workbookRows = buildBuffWorkbookView(sourceRows, columns);
assert.equal(workbookRows.length, 5);
assert.deepEqual(workbookRows.map((row) => [row.rowNumber, row.kind, row.cells.length]), [
  [1, 'group', 3],
  [2, 'header', 10],
  [3, 'character', 1],
  [4, 'button', 1],
  [5, 'data', 10],
]);

assert.deepEqual(workbookRows[0].cells.map((cell) => ({
  address: cell.address,
  value: cell.value,
  width: cell.width,
  colSpan: cell.colSpan,
  align: cell.align,
  columnKey: cell.columnKey,
})), [
  { address: 'A1', value: '索引', width: 370, colSpan: 3, align: 'center', columnKey: 'name' },
  { address: 'D1', value: '效果区', width: 436, colSpan: 4, align: 'center', columnKey: 'effectKind' },
  { address: 'H1', value: '文本区', width: 530, colSpan: 3, align: 'center', columnKey: 'sourceName' },
]);

assert.deepEqual(workbookRows[1].cells.map((cell) => [cell.address, cell.value, cell.align]), [
  ['A2', '名称', 'left'],
  ['B2', 'ID', 'left'],
  ['C2', '层级', 'center'],
  ['D2', '效果种类', 'center'],
  ['E2', '类型', 'left'],
  ['F2', '数值', 'right'],
  ['G2', '分类', 'center'],
  ['H2', '来源', 'left'],
  ['I2', '条件', 'left'],
  ['J2', '描述', 'left'],
]);

assert.deepEqual(workbookRows[2].cells[0], {
  key: '3:1',
  address: 'A3',
  value: '测试 Buff 组 · 1 个自定义项',
  width: 1336,
  colSpan: 10,
  rowSpan: 1,
  align: 'left',
  kind: 'character',
  sourceRowKey: 'group-test-buff',
  columnKey: 'name',
});
assert.equal(workbookRows[2].sourceRow, sourceRows[0]);

assert.deepEqual(workbookRows[3].cells[0], {
  key: '4:1',
  address: 'A4',
  value: '测试项 · 1 个效果 · 测试项描述',
  width: 1336,
  colSpan: 10,
  rowSpan: 1,
  align: 'left',
  kind: 'button',
  sourceRowKey: 'item-item-7',
  columnKey: 'name',
});
assert.equal(workbookRows[3].sourceRow, sourceRows[1]);

assert.deepEqual(workbookRows[4].cells.map((cell) => ({
  address: cell.address,
  value: cell.value,
  width: cell.width,
  align: cell.align,
  sourceRowKey: cell.sourceRowKey,
  columnKey: cell.columnKey,
})), [
  { address: 'A5', value: '测试效果', width: 200, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'name' },
  { address: 'B5', value: 'custom-effect-id', width: 110, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'idText' },
  { address: 'C5', value: '效果', width: 60, align: 'center', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'level' },
  { address: 'D5', value: '常规修改', width: 90, align: 'center', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'effectKind' },
  { address: 'E5', value: '攻击力 · flatAtk', width: 170, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'typeLabel' },
  { address: 'F5', value: '123', width: 84, align: 'right', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'valueText' },
  { address: 'G5', value: '可计层/3', width: 92, align: 'center', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'categoryText' },
  { address: 'H5', value: '测试来源', width: 110, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'sourceName' },
  { address: 'I5', value: '满足测试条件', width: 180, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'condition' },
  { address: 'J5', value: '测试效果描述', width: 240, align: 'left', sourceRowKey: 'effect-item-7-buff-9', columnKey: 'description' },
]);
assert.equal(workbookRows[4].sourceRow, sourceRows[2]);

console.log('Buff workbook projection characterization contract: PASS');
