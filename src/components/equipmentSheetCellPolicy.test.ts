import assert from 'node:assert/strict';
import { getEquipmentSheetCellPolicy } from './equipmentSheetCellPolicy';
import { COLUMNS, type EquipmentRow } from './equipmentSheetWorkbook';

type RowKind = EquipmentRow['kind'];
type ColumnKey = (typeof COLUMNS)[number]['key'];

const expected = {
  set: {
    name: ['text', true],
    effectKey: ['text', true],
    description: ['image-search-select', true],
  },
  threePieceBuffHeader: {},
  threePieceBuff: {
    name: ['text', true],
    field: ['select', false],
    valueText: ['number', true],
    description: ['text', true],
  },
  equipment: {
    name: ['text', true],
    field: ['select', false],
    description: ['image-search-select', true],
  },
  fixedStat: {
    name: ['text', true],
    effectKey: ['select', false],
    description: ['text', true],
  },
  effect: {
    name: ['text', true],
    field: ['select', false],
    effectKey: ['search-select', true],
  },
  effectLevels: {},
} satisfies Record<RowKind, Partial<Record<ColumnKey, readonly [string, boolean]>>>;

for (const rowKind of Object.keys(expected) as RowKind[]) {
  for (const { key: columnKey } of COLUMNS) {
    const policy = getEquipmentSheetCellPolicy(rowKind, columnKey);
    const expectedPolicy = expected[rowKind][columnKey];
    if (!expectedPolicy) {
      assert.deepEqual(policy, {
        editable: false,
        clearable: false,
        control: 'readonly',
      }, `${rowKind}.${columnKey} must stay read-only`);
      continue;
    }
    assert.deepEqual(policy, {
      editable: true,
      clearable: expectedPolicy[1],
      control: expectedPolicy[0],
    }, `${rowKind}.${columnKey} policy drifted`);
  }
}

console.log('Equipment sheet cell edit/clear/control policy contract: PASS');
