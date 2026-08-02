import ExcelJS from 'exceljs';
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

function getBuffWorkbookCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((item) => item.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text;
  }
  return String(value);
}

function mapBuffWorkbookAlignment(value: ExcelJS.Alignment['horizontal'] | undefined): BuffWorkbookCellView['align'] {
  if (value === 'right') {
    return 'right';
  }
  if (value === 'center') {
    return 'center';
  }
  return 'left';
}

export function buildBuffWorkbookView(rows: BuffSheetRow[], columns: BuffSheetColumn[]): BuffWorkbookRowView[] {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet-Buff');
  const mergeMap: Record<string, BuffWorkbookMergeInfo> = {};
  const rowKinds: Record<number, BuffWorkbookCellView['kind']> = {};
  const sheetRowsByWorksheetRow: Record<number, BuffSheetRow> = {};
  const columnGroups = buildBuffColumnGroups(columns);

  let currentColumn = 1;
  columnGroups.forEach((group) => {
    const startColumn = currentColumn;
    const endColumn = startColumn + group.count - 1;
    if (group.count > 1) {
      worksheet.mergeCells(1, startColumn, 1, endColumn);
      registerBuffMerge(mergeMap, 1, startColumn, 1, endColumn);
    }
    const cell = worksheet.getCell(1, startColumn);
    cell.value = group.group;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true, color: { argb: 'FF185C37' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F7F4' },
    };
    currentColumn = endColumn + 1;
  });
  rowKinds[1] = 'group';
  worksheet.getRow(1).height = 22;

  columns.forEach((column, index) => {
    const cell = worksheet.getCell(2, index + 1);
    cell.value = column.title;
    cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
    cell.alignment = {
      horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
      vertical: 'middle',
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFDFDFD' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      left: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      right: { style: 'thin', color: { argb: 'FFD7D7D7' } },
    };
    worksheet.getColumn(index + 1).width = Math.max(3, column.width / 10);
  });
  rowKinds[2] = 'header';
  worksheet.getRow(2).height = 24;

  let excelRowIndex = 3;
  rows.forEach((row) => {
    if (row.kind === 'group') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = `${row.title} · ${row.summary}`;
      cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF4F1' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      };
      worksheet.getRow(excelRowIndex).height = 22;
      rowKinds[excelRowIndex] = 'character';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    if (row.kind === 'item') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerBuffMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = `${row.title} · ${row.summary} · ${row.description}`;
      cell.font = { bold: true, color: { argb: 'FF2B2F33' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF7F9F8' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE1E4E8' } },
      };
      worksheet.getRow(excelRowIndex).height = 20;
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
      const cell = worksheet.getCell(excelRowIndex, index + 1);
      cell.value = values[column.key] ?? '';
      cell.alignment = {
        horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
        vertical: 'middle',
      };
      cell.font = { size: 10, color: { argb: 'FF202124' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE8EAED' } },
        bottom: { style: 'thin', color: { argb: 'FFE8EAED' } },
        left: { style: 'thin', color: { argb: 'FFE8EAED' } },
        right: { style: 'thin', color: { argb: 'FFE8EAED' } },
      };
    });
    worksheet.getRow(excelRowIndex).height = 20;
    rowKinds[excelRowIndex] = 'data';
    sheetRowsByWorksheetRow[excelRowIndex] = row;
    excelRowIndex += 1;
  });

  const result: BuffWorkbookRowView[] = [];
  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const rowKind = rowKinds[rowIndex] ?? 'data';
    const cells: BuffWorkbookCellView[] = [];

    for (let colIndex = 1; colIndex <= columns.length; colIndex += 1) {
      const mergeInfo = mergeMap[`${rowIndex}:${colIndex}`];
      if (mergeInfo?.hidden) {
        continue;
      }
      const cell = worksheet.getCell(rowIndex, colIndex);
      const width = mergeInfo?.master
        ? columns.slice(colIndex - 1, colIndex - 1 + (mergeInfo.colSpan || 1)).reduce((sum, column) => sum + column.width, 0)
        : columns[colIndex - 1]?.width ?? 60;
      cells.push({
        key: `${rowIndex}:${colIndex}`,
        address: cell.address,
        value: getBuffWorkbookCellText(cell),
        width,
        colSpan: mergeInfo?.colSpan ?? 1,
        rowSpan: mergeInfo?.rowSpan ?? 1,
        align: mapBuffWorkbookAlignment(cell.alignment?.horizontal),
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
