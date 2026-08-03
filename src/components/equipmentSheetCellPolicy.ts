import type {
  EquipmentRow,
  EquipmentSheetColumn,
} from './equipmentSheetWorkbook';

export type EquipmentSheetCellControl =
  | 'readonly'
  | 'text'
  | 'number'
  | 'select'
  | 'search-select'
  | 'image-search-select';

export interface EquipmentSheetCellPolicy {
  editable: boolean;
  clearable: boolean;
  control: EquipmentSheetCellControl;
}

export interface EquipmentSheetCellPolicyContext {
  effectKind?: 'modifier' | 'extraHit';
}

type RowKind = EquipmentRow['kind'];
type ColumnKey = EquipmentSheetColumn['key'];

const EDIT_CONTROLS: Record<RowKind, Partial<Record<ColumnKey, EquipmentSheetCellControl>>> = {
  set: {
    name: 'text',
    effectKey: 'text',
    description: 'image-search-select',
  },
  threePieceBuffHeader: {},
  threePieceBuff: {
    name: 'text',
    field: 'select',
    effectKey: 'search-select',
    valueText: 'number',
    description: 'text',
  },
  equipment: {
    name: 'text',
    field: 'select',
    description: 'image-search-select',
  },
  fixedStat: {
    name: 'text',
    effectKey: 'select',
    description: 'text',
  },
  effect: {
    name: 'text',
    field: 'select',
    effectKey: 'search-select',
  },
  effectLevels: {},
};

const NOT_CLEARABLE = new Set<string>([
  'equipment.field',
  'effect.field',
  'fixedStat.effectKey',
  'threePieceBuff.field',
]);

export function getEquipmentSheetCellPolicy(
  rowKind: RowKind,
  columnKey: ColumnKey,
  context: EquipmentSheetCellPolicyContext = {},
): EquipmentSheetCellPolicy {
  if (
    rowKind === 'threePieceBuff'
    && columnKey === 'effectKey'
    && context.effectKind === 'extraHit'
  ) {
    return {
      editable: false,
      clearable: false,
      control: 'readonly',
    };
  }
  const control = EDIT_CONTROLS[rowKind][columnKey] ?? 'readonly';
  const editable = control !== 'readonly';
  return {
    editable,
    clearable: editable && !NOT_CLEARABLE.has(`${rowKind}.${columnKey}`),
    control,
  };
}
