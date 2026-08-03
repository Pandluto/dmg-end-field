import type { BuffSheetRow } from './buffDraftModel';

export interface BuffSheetColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
}

interface BuffWorkbookMergeInfo {
  master: boolean;
  colSpan: number;
  rowSpan: number;
  hidden: boolean;
}

export interface BuffWorkbookCellView {
  key: string;
  address: string;
  value: string;
  width: number;
  colSpan: number;
  rowSpan: number;
  align: 'left' | 'right' | 'center';
  kind: 'group' | 'header' | 'character' | 'button' | 'data';
  sourceRowKey?: string;
  columnKey?: string;
}

export interface BuffWorkbookRowView {
  key: string;
  rowNumber: number;
  kind: BuffWorkbookCellView['kind'];
  cells: BuffWorkbookCellView[];
  sourceRow?: BuffSheetRow;
}

export type BuffWorkbookSelection = {
  address: string;
  value: string;
  sourceRowKey?: string;
  columnKey?: string;
};

export function buildBuffSheetColumns(): BuffSheetColumn[] {
  return [
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
  ];
}

export function buildBuffColumnGroups(columns: BuffSheetColumn[]): Array<{ group: string; width: number; count: number }> {
  const groups: Array<{ group: string; width: number; count: number }> = [];
  columns.forEach((column) => {
    const existing = groups[groups.length - 1];
    if (existing && existing.group === column.group) {
      existing.width += column.width;
      existing.count += 1;
      return;
    }
    groups.push({ group: column.group, width: column.width, count: 1 });
  });
  return groups;
}

function registerBuffMerge(
  mergeMap: Record<string, BuffWorkbookMergeInfo>,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number,
): void {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      mergeMap[`${row}:${col}`] = {
        master: row === rowStart && col === colStart,
        colSpan: colEnd - colStart + 1,
        rowSpan: rowEnd - rowStart + 1,
        hidden: !(row === rowStart && col === colStart),
      };
    }
  }
}

function mapBuffWorkbookAlignment(value: BuffSheetColumn['align'] | undefined): BuffWorkbookCellView['align'] {
  if (value === 'right') {
    return 'right';
  }
  if (value === 'center') {
    return 'center';
  }
  return 'left';
}

function getBuffWorkbookCellAddress(row: number, column: number): string {
  let currentColumn = column;
  let columnLabel = '';

  while (currentColumn > 0) {
    const remainder = (currentColumn - 1) % 26;
    columnLabel = String.fromCharCode(65 + remainder) + columnLabel;
    currentColumn = Math.floor((currentColumn - 1) / 26);
  }

  return `${columnLabel}${row}`;
}

export function buildBuffWorkbookView(rows: BuffSheetRow[], columns: BuffSheetColumn[]): BuffWorkbookRowView[] {
  const mergeMap: Record<string, BuffWorkbookMergeInfo> = {};
  const cellValues: Record<string, string> = {};
  const cellAlignments: Record<string, BuffWorkbookCellView['align']> = {};
  const rowKinds: Record<number, BuffWorkbookCellView['kind']> = {};
  const sheetRowsByWorksheetRow: Record<number, BuffSheetRow> = {};
  const columnGroups = buildBuffColumnGroups(columns);

  const setCell = (row: number, column: number, value: string, align?: BuffSheetColumn['align']): void => {
    const key = `${row}:${column}`;
    cellValues[key] = value;
    cellAlignments[key] = mapBuffWorkbookAlignment(align);
  };

  let currentColumn = 1;
  columnGroups.forEach((group) => {
    const startColumn = currentColumn;
    const endColumn = startColumn + group.count - 1;
    if (group.count > 1) {
      registerBuffMerge(mergeMap, 1, startColumn, 1, endColumn);
    }
    setCell(1, startColumn, group.group, 'center');
    currentColumn = endColumn + 1;
  });
  rowKinds[1] = 'group';

  columns.forEach((column, index) => {
    setCell(2, index + 1, column.title, column.align);
  });
  rowKinds[2] = 'header';

  let excelRowIndex = 3;
  rows.forEach((row) => {
    if (row.kind === 'group') {
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      setCell(excelRowIndex, 1, `${row.title} · ${row.summary}`);
      rowKinds[excelRowIndex] = 'character';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    if (row.kind === 'item') {
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      setCell(excelRowIndex, 1, `${row.title} · ${row.summary} · ${row.description}`);
      rowKinds[excelRowIndex] = 'button';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    const values: Record<string, string> = {
      name: row.title,
      idText: row.idText,
      level: '效果',
      effectKind: row.effectKind,
      typeLabel: row.typeLabel,
      valueText: row.valueText,
      categoryText: row.categoryText,
      sourceName: row.sourceName,
      condition: row.condition,
      description: row.description,
    };

    columns.forEach((column, index) => {
      setCell(excelRowIndex, index + 1, values[column.key] ?? '', column.align);
    });
    rowKinds[excelRowIndex] = 'data';
    sheetRowsByWorksheetRow[excelRowIndex] = row;
    excelRowIndex += 1;
  });

  const result: BuffWorkbookRowView[] = [];
  for (let rowIndex = 1; rowIndex < excelRowIndex; rowIndex += 1) {
    const rowKind = rowKinds[rowIndex] ?? 'data';
    const cells: BuffWorkbookCellView[] = [];

    for (let colIndex = 1; colIndex <= columns.length; colIndex += 1) {
      const mergeInfo = mergeMap[`${rowIndex}:${colIndex}`];
      if (mergeInfo?.hidden) {
        continue;
      }
      const width = mergeInfo?.master
        ? columns.slice(colIndex - 1, colIndex - 1 + (mergeInfo.colSpan || 1)).reduce((sum, column) => sum + column.width, 0)
        : columns[colIndex - 1]?.width ?? 60;
      cells.push({
        key: `${rowIndex}:${colIndex}`,
        address: getBuffWorkbookCellAddress(rowIndex, colIndex),
        value: cellValues[`${rowIndex}:${colIndex}`] ?? '',
        width,
        colSpan: mergeInfo?.colSpan ?? 1,
        rowSpan: mergeInfo?.rowSpan ?? 1,
        align: cellAlignments[`${rowIndex}:${colIndex}`] ?? 'left',
        kind: rowKind,
        sourceRowKey: sheetRowsByWorksheetRow[rowIndex]?.key,
        columnKey: columns[colIndex - 1]?.key,
      });
    }

    result.push({
      key: `row-${rowIndex}`,
      rowNumber: rowIndex,
      kind: rowKind,
      cells,
      sourceRow: sheetRowsByWorksheetRow[rowIndex],
    });
  }

  return result;
}
