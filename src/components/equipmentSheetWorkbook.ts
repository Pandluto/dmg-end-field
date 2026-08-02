import {
  getEffectEntries,
  getEquipmentBuffBusinessType,
  getGearSets,
  getSortedEquipments,
  LEVEL_KEYS,
  type EquipmentEffect,
  type EquipmentEffectId,
  type EquipmentLibrary,
} from './equipmentSheetModel';

export type EquipmentRow =
  | {
      kind: 'set';
      key: string;
      gearSetId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'equipment';
      key: string;
      gearSetId: string;
      equipmentId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'threePieceBuffHeader';
      key: string;
      gearSetId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'threePieceBuff';
      key: string;
      gearSetId: string;
      effectId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'fixedStat';
      key: string;
      gearSetId: string;
      equipmentId: string;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'effect';
      key: string;
      gearSetId: string;
      equipmentId: string;
      effectId: EquipmentEffectId;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    }
  | {
      kind: 'effectLevels';
      key: string;
      gearSetId: string;
      equipmentId: string;
      effectId: EquipmentEffectId;
      title: string;
      idText: string;
      field: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
    };

export interface EquipmentSheetColumn {
  key: 'name' | 'idText' | 'field' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface EquipmentWorkbookCell {
  key: string;
  address: string;
  value: string;
  width: number;
  columnKey: EquipmentSheetColumn['key'];
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

export interface EquipmentWorkbookRow {
  key: string;
  rowNumber: number;
  kind: EquipmentRow['kind'];
  sourceRow: EquipmentRow;
  cells: EquipmentWorkbookCell[];
}

export const COLUMNS: EquipmentSheetColumn[] = [
  { key: 'name', title: '名称', width: 220 },
  { key: 'idText', title: 'ID', width: 150 },
  { key: 'field', title: '字段', width: 180, align: 'center' },
  { key: 'level', title: '等级', width: 72, align: 'center' },
  { key: 'effectKey', title: '效果键', width: 180 },
  { key: 'valueText', title: '数值', width: 120, align: 'right' },
  { key: 'description', title: '描述', width: 420 },
];

export function formatEffectLevelsSummary(effect: EquipmentEffect): string {
  const suffix = effect.unit === 'percent' ? '%' : '';
  const values = LEVEL_KEYS.map((levelKey) => {
    const value = effect.levels[levelKey];
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    const displayValue = effect.unit === 'percent' ? value * 100 : value;
    return `+${Number(displayValue.toFixed(4))}${suffix}`;
  });
  return `${effect.label}：${values.join(' / ')}`;
}

export function buildRows(library: EquipmentLibrary): EquipmentRow[] {
  return getGearSets(library).flatMap((gearSet) => {
    const setRow: EquipmentRow = {
      kind: 'set',
      key: `set-${gearSet.gearSetId}`,
      gearSetId: gearSet.gearSetId,
      title: gearSet.name,
      idText: gearSet.gearSetId,
      field: '套装',
      level: '-',
      effectKey: gearSet.buffId || 'buffId 未填写',
      valueText: '',
      description: gearSet.imgUrl || '',
    };
    const threePieceBuffRows: EquipmentRow[] = [{
      kind: 'threePieceBuffHeader',
      key: `three-piece-buff-header-${gearSet.gearSetId}`,
      gearSetId: gearSet.gearSetId,
      title: '三件套效果：',
      idText: '',
      field: '',
      level: '',
      effectKey: '',
      valueText: '',
      description: '',
    }];
    Object.entries(gearSet.threePieceBuffs || {}).forEach(([effectId, threePieceBuff]) => {
      threePieceBuffRows.push({
        kind: 'threePieceBuff',
        key: `three-piece-buff-${gearSet.gearSetId}-${effectId}`,
        gearSetId: gearSet.gearSetId,
        effectId,
        title: threePieceBuff.name || '新建效果',
        idText: threePieceBuff.effectId || effectId,
        field: getEquipmentBuffBusinessType(threePieceBuff),
        level: '3件',
        effectKey: threePieceBuff.effectKind === 'extraHit'
          ? `${threePieceBuff.extraHitConfig?.damageType || 'physical'} / ${threePieceBuff.extraHitConfig?.skillType || '空'}`
          : threePieceBuff.typeKey,
        valueText: String(threePieceBuff.effectKind === 'extraHit' ? threePieceBuff.extraHitConfig?.baseMultiplier ?? 1 : threePieceBuff.value),
        description: threePieceBuff.raw || '',
      });
    });
    const equipmentRows = getSortedEquipments(gearSet).flatMap((equipment) => {
      const rows: EquipmentRow[] = [{
        kind: 'equipment',
        key: `equipment-${gearSet.gearSetId}-${equipment.equipmentId}`,
        gearSetId: gearSet.gearSetId,
        equipmentId: equipment.equipmentId,
        title: equipment.name,
        idText: equipment.equipmentId,
        field: equipment.part,
        level: '-',
        effectKey: '',
        valueText: '',
        description: equipment.imgUrl || '',
      }];
      if (equipment.fixedStat) {
        rows.push({
          kind: 'fixedStat',
          key: `fixed-${gearSet.gearSetId}-${equipment.equipmentId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          title: equipment.fixedStat.label,
          idText: equipment.fixedStat.typeKey,
          field: '固定',
          level: '-',
          effectKey: equipment.fixedStat.typeKey,
          valueText: `${equipment.fixedStat.value}${equipment.fixedStat.unit === 'percent' ? '%' : ''}`,
          description: equipment.fixedStat.raw || '',
        });
      }
      getEffectEntries(equipment).forEach(([effectId, effect]) => {
        rows.push({
          kind: 'effect',
          key: `effect-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          effectId,
          title: effect.label,
          idText: effectId,
          field: effect.category === 'ability' ? '能力值' : 'Buff类型',
          level: 'Lv0~Lv3',
          effectKey: effect.typeKey,
          valueText: effect.unit === 'percent' ? '%' : '',
          description: formatEffectLevelsSummary(effect),
        });
        rows.push({
          kind: 'effectLevels',
          key: `levels-${gearSet.gearSetId}-${equipment.equipmentId}-${effectId}`,
          gearSetId: gearSet.gearSetId,
          equipmentId: equipment.equipmentId,
          effectId,
          title: `${effect.label} 等级数值`,
          idText: effectId,
          field: '等级数值',
          level: 'Lv0~Lv3',
          effectKey: effect.typeKey,
          valueText: '',
          description: '',
        });
      });
      return rows;
    });
    return [setRow, ...threePieceBuffRows, ...equipmentRows];
  });
}

export function filterVisibleRows(
  rows: EquipmentRow[],
  collapsedGearSetIds: Record<string, boolean>,
  collapsedEquipmentIds: Record<string, boolean>,
  collapsedEffectIds: Record<string, boolean>,
  collapsedThreePieceBuffIds: Record<string, boolean>,
): EquipmentRow[] {
  return rows.filter((row) => {
    if (row.kind === 'set') return true;
    if (collapsedGearSetIds[row.gearSetId] !== false) return false;
    if (row.kind === 'threePieceBuff') return collapsedThreePieceBuffIds[row.gearSetId] !== true;
    if (row.kind === 'threePieceBuffHeader' || row.kind === 'equipment') return true;
    const equipmentKey = `${row.gearSetId}:${row.equipmentId}`;
    if (collapsedEquipmentIds[equipmentKey] !== false) return false;
    if (row.kind === 'fixedStat' || row.kind === 'effect') return true;
    const effectKey = `${row.gearSetId}:${row.equipmentId}:${row.effectId}`;
    return collapsedEffectIds[effectKey] === false;
  });
}

export function columnIndexToLabel(index: number): string {
  let dividend = index + 1;
  let label = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return label;
}

export function buildWorkbookRows(rows: EquipmentRow[]): EquipmentWorkbookRow[] {
  const getCellValue = (row: EquipmentRow, columnKey: EquipmentSheetColumn['key']) => {
    switch (columnKey) {
      case 'name': return row.title;
      case 'idText': return row.idText;
      case 'field': return row.field;
      case 'level': return row.level;
      case 'effectKey': return row.effectKey;
      case 'valueText': return row.valueText;
      case 'description': return row.description;
      default: return '';
    }
  };

  return rows.map<EquipmentWorkbookRow>((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: COLUMNS.map((column, columnIndex) => ({
      key: `${row.key}-${column.key}`,
      address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
      value: String(getCellValue(row, column.key)),
      width: column.width,
      columnKey: column.key,
      align: column.align ?? 'left',
      sourceRowKey: row.key,
    })),
  }));
}

export function getWorkbookRowClassName(row: EquipmentWorkbookRow): string {
  if (row.kind === 'set') return 'damage-sheet-excel-row is-character weapon-sheet-row-weapon';
  if (row.kind === 'threePieceBuffHeader') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-header';
  if (row.kind === 'threePieceBuff') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-effect';
  if (row.kind === 'equipment') return 'damage-sheet-excel-row is-button weapon-sheet-row-skill';
  if (row.kind === 'fixedStat') return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  if (row.kind === 'effect') return 'damage-sheet-excel-row is-character weapon-sheet-row-effect';
  return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
}
