import {
  getBuffTypeDisplayLabel,
  getEffectBuffType,
  type WeaponDraft,
  type WeaponSheetRow,
} from './weaponDraftModel';

export interface WeaponSheetColumn {
  key: 'name' | 'idText' | 'slot' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface WeaponWorkbookCell {
  key: string;
  address: string;
  value: string;
  columnKey: WeaponSheetColumn['key'];
  width: number;
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

export interface WeaponWorkbookRow {
  key: string;
  rowNumber: number;
  kind: WeaponSheetRow['kind'];
  sourceRow: WeaponSheetRow;
  cells: WeaponWorkbookCell[];
}

export function buildWeaponSheetColumns(): WeaponSheetColumn[] {
  return [
    { key: 'name', title: '名称', width: 220 },
    { key: 'idText', title: 'ID', width: 120 },
    { key: 'slot', title: '字段', width: 220, align: 'center' },
    { key: 'level', title: '等级', width: 72, align: 'center' },
    { key: 'effectKey', title: '效果键', width: 180 },
    { key: 'valueText', title: '数值', width: 110, align: 'right' },
    { key: 'description', title: '描述', width: 420 },
  ];
}

export function columnIndexToLabel(index: number) {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function buildWeaponWorkbookRows(
  draft: WeaponDraft,
  rows: WeaponSheetRow[],
  columns: WeaponSheetColumn[],
): WeaponWorkbookRow[] {
  return rows.map((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: columns.map((column, columnIndex) => {
      const cellValue = (() => {
        switch (column.key) {
          case 'name':
            return row.title;
          case 'idText':
            return row.idText;
          case 'slot':
            return row.slot;
          case 'level':
            return row.level;
          case 'effectKey':
            if (row.kind === 'effect' && row.skillKey === 'skill3' && row.bucket !== 'value') {
              if (draft.skills[row.skillKey].effects[row.sourceEffectKey]?.effectKind === 'extraHit') {
                return row.effectKey;
              }
              return getBuffTypeDisplayLabel(
                getEffectBuffType(row.skillKey, draft.skills[row.skillKey], row.sourceEffectKey),
              );
            }
            return row.effectKey;
          case 'valueText':
            return row.valueText;
          case 'description':
            return row.description;
          default:
            return '';
        }
      })();
      return {
        key: `${row.key}-${column.key}`,
        address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
        value: cellValue,
        columnKey: column.key,
        width: column.width,
        align: column.align ?? 'left',
        sourceRowKey: row.key,
      };
    }),
  }));
}
