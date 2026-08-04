import {
  BUFF_TYPE_OPTIONS,
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  EQUIPMENT_PARTS,
  getEquipmentBuffBusinessType,
  getEquipmentBuffTypeDisplayLabel,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  LEVEL_KEYS,
  type EquipmentLibrary,
} from './equipmentSheetModel';
import { applyCellValueToLibrary } from './equipmentSheetEditing';
import { getEquipmentSheetCellPolicy } from './equipmentSheetCellPolicy';
import type { EquipmentRow, EquipmentSheetColumn } from './equipmentSheetWorkbook';

export interface EquipmentWorkbookSelection {
  address: string;
  sourceRowKey: string;
  columnKey: EquipmentSheetColumn['key'];
  value?: string;
}

export interface EquipmentFormulaBinding {
  key: string;
  value: string;
  inputMode: 'text' | 'number';
  readOnly?: boolean;
  control?: 'input' | 'select' | 'search-select' | 'image-search-select';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  apply: (baseLibrary: EquipmentLibrary, rawInput: string) => EquipmentLibrary;
}

const FIXED_STAT_OPTIONS = [
  { value: 'defense', label: '防御力 · defense' },
  { value: 'hp', label: '生命 · hp' },
  { value: 'flatAtk', label: '固定攻击力 · flatAtk' },
];

const EFFECT_CATEGORY_OPTIONS = [
  { value: 'ability', label: '能力值' },
  { value: 'buff', label: 'Buff类型' },
];

function applyRowValue(
  baseLibrary: EquipmentLibrary,
  row: EquipmentRow,
  columnKey: EquipmentSheetColumn['key'],
  rawInput: string,
) {
  return applyCellValueToLibrary(baseLibrary, row, columnKey, rawInput);
}

function buildReadOnlyBinding(
  row: EquipmentRow,
  columnKey: EquipmentSheetColumn['key'],
  value: string,
): EquipmentFormulaBinding {
  return {
    key: `${row.key}:${columnKey}:readonly`,
    value,
    inputMode: 'text',
    readOnly: true,
    apply: (baseLibrary) => baseLibrary,
  };
}

export function buildEquipmentFormulaBinding(
  library: EquipmentLibrary,
  selectedWorkbookCell: EquipmentWorkbookSelection | null | undefined,
  selectedWorkbookSummary: EquipmentRow | null | undefined,
): EquipmentFormulaBinding | null {
  if (!selectedWorkbookSummary || !selectedWorkbookCell) {
    return null;
  }

  const row = selectedWorkbookSummary;
  const columnKey = selectedWorkbookCell.columnKey;

  if (row.kind === 'effectLevels') {
    const levelKey = selectedWorkbookCell.address.replace(/^Lv/, '');
    if (!LEVEL_KEYS.includes(levelKey as typeof LEVEL_KEYS[number])) {
      return null;
    }
    const effect = library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.effects[row.effectId];
    return {
      key: `${row.key}:${levelKey}`,
      value: effect?.levels[levelKey as typeof LEVEL_KEYS[number]] == null
        ? ''
        : String(effect.levels[levelKey as typeof LEVEL_KEYS[number]]),
      inputMode: 'number',
      placeholder: `Lv${levelKey}`,
      apply: (baseLibrary, rawInput) => applyRowValue(
        baseLibrary,
        row,
        columnKey,
        `${levelKey}:${rawInput}`,
      ),
    };
  }

  const cellPolicy = getEquipmentSheetCellPolicy(row.kind, columnKey);

  if (!cellPolicy.editable) {
    return buildReadOnlyBinding(row, columnKey, selectedWorkbookCellValue(row, selectedWorkbookCell, library));
  }

  if (cellPolicy.control === 'image-search-select' && (row.kind === 'set' || row.kind === 'equipment')) {
    const value = row.kind === 'set'
      ? library.gearSets[row.gearSetId]?.imgUrl ?? ''
      : library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.imgUrl ?? '';
    return {
      key: `${row.key}:imgUrl`,
      value,
      inputMode: 'text',
      control: 'image-search-select',
      placeholder: row.kind === 'set' ? '搜索套装配图' : '搜索装备配图',
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  if (cellPolicy.control === 'select' && row.kind === 'equipment' && columnKey === 'field') {
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCellValue(row, selectedWorkbookCell, library),
      inputMode: 'text',
      control: 'select',
      options: EQUIPMENT_PARTS.map((part) => ({ value: part, label: part })),
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  if (cellPolicy.control === 'select' && row.kind === 'threePieceBuff' && columnKey === 'field') {
    const selectedBuff = library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId];
    return {
      key: `${row.key}:${columnKey}`,
      value: getEquipmentBuffBusinessType(selectedBuff),
      inputMode: 'text',
      control: 'select',
      options: EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  if (cellPolicy.control === 'select' && row.kind === 'fixedStat' && columnKey === 'effectKey') {
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCellValue(row, selectedWorkbookCell, library),
      inputMode: 'text',
      control: 'select',
      options: FIXED_STAT_OPTIONS,
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  if (cellPolicy.control === 'select' && row.kind === 'effect' && columnKey === 'field') {
    return {
      key: `${row.key}:${columnKey}`,
      value: row.field === '能力值' ? 'ability' : 'buff',
      inputMode: 'text',
      control: 'select',
      options: EFFECT_CATEGORY_OPTIONS,
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  if (cellPolicy.control === 'search-select' && row.kind === 'effect') {
    const equipment = library.gearSets[row.gearSetId]?.equipments[row.equipmentId];
    const effect = equipment?.effects[row.effectId];
    const effectOptions = (equipment && effect
      ? getEquipmentEffectTypeOptions(
          equipment.part,
          row.effectId,
          effect.category,
          getEquipmentEffectShape(equipment),
        )
      : BUFF_TYPE_OPTIONS).map((typeKey) => ({
        value: typeKey,
        label: getEquipmentBuffTypeDisplayLabel(typeKey),
      }));
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCellValue(row, selectedWorkbookCell, library),
      inputMode: 'text',
      control: 'search-select',
      options: effectOptions,
      apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
    };
  }

  return {
    key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCellValue(row, selectedWorkbookCell, library),
    inputMode: cellPolicy.control === 'number' ? 'number' : 'text',
    apply: (baseLibrary, rawInput) => applyRowValue(baseLibrary, row, columnKey, rawInput),
  };
}

function selectedWorkbookCellValue(
  row: EquipmentRow,
  selectedWorkbookCell: EquipmentWorkbookSelection,
  library: EquipmentLibrary,
) {
  if (selectedWorkbookCell.value !== undefined) {
    return selectedWorkbookCell.value;
  }
  if (row.kind === 'set') {
    if (selectedWorkbookCell.columnKey === 'name') return row.title;
    if (selectedWorkbookCell.columnKey === 'idText') return row.idText;
    if (selectedWorkbookCell.columnKey === 'field') return row.field;
    if (selectedWorkbookCell.columnKey === 'level') return row.level;
    if (selectedWorkbookCell.columnKey === 'effectKey') return row.effectKey;
    if (selectedWorkbookCell.columnKey === 'valueText') return row.valueText;
    return row.description;
  }
  if (row.kind === 'equipment') {
    if (selectedWorkbookCell.columnKey === 'name') return row.title;
    if (selectedWorkbookCell.columnKey === 'idText') return row.idText;
    if (selectedWorkbookCell.columnKey === 'field') return row.field;
    if (selectedWorkbookCell.columnKey === 'level') return row.level;
    if (selectedWorkbookCell.columnKey === 'effectKey') return row.effectKey;
    if (selectedWorkbookCell.columnKey === 'valueText') return row.valueText;
    return row.description;
  }
  if (row.kind === 'threePieceBuffHeader') {
    return row[selectedWorkbookCell.columnKey === 'name' ? 'title' : selectedWorkbookCell.columnKey];
  }
  if (row.kind === 'threePieceBuff') {
    return row[selectedWorkbookCell.columnKey === 'name' ? 'title' : selectedWorkbookCell.columnKey];
  }
  if (row.kind === 'fixedStat' || row.kind === 'effect' || row.kind === 'effectLevels') {
    return row[selectedWorkbookCell.columnKey === 'name' ? 'title' : selectedWorkbookCell.columnKey];
  }
  return library.updatedAt ?? '';
}
