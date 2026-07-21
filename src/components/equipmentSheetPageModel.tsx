import type { BuffEffectKind } from '../core/domain/buff';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import {
  COLUMNS,
  LEVEL_KEYS,
  applyFixedStatPresetForPart,
  drawerEffectToEquipmentBuff,
  equipmentBuffToDrawer,
  getEffectEntries,
  getEquipmentBuffBusinessType,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  getGearSets,
  getSortedEquipments,
  normalizeCategory,
  normalizeNumber,
  normalizePart,
  updateLibraryEquipment,
  updateLibrarySet,
  type EquipmentContextMenuAction,
  type EquipmentEffect,
  type EquipmentFixedStat,
  type EquipmentFixedTypeKey,
  type EquipmentLevelKey,
  type EquipmentLibrary,
  type EquipmentRow,
  type EquipmentSheetColumn,
  type EquipmentUnit,
  type EquipmentWorkbookRow,
} from './equipmentSheetDataModel';

export * from './equipmentSheetDataModel';

export function applyCellValueToLibrary(
  library: EquipmentLibrary,
  row: EquipmentRow,
  columnKey: EquipmentSheetColumn['key'],
  rawValue: string,
) {
  if (row.kind === 'set') {
    return updateLibrarySet(library, row.gearSetId, (gearSet) => ({
      ...gearSet,
      name: columnKey === 'name' ? rawValue : gearSet.name,
      gearSetId: gearSet.gearSetId,
      buffId: columnKey === 'effectKey' ? rawValue : gearSet.buffId,
      imgUrl: columnKey === 'description' ? rawValue : gearSet.imgUrl,
    }));
  }
  if (row.kind === 'equipment') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const nextPart = columnKey === 'field' ? normalizePart(rawValue) : equipment.part;
      return {
        ...equipment,
        name: columnKey === 'name' ? rawValue : equipment.name,
        part: nextPart,
        imgUrl: columnKey === 'description' ? rawValue : equipment.imgUrl,
      };
    });
  }
  if (row.kind === 'threePieceBuff') {
    return updateLibrarySet(library, row.gearSetId, (gearSet) => {
      const current = gearSet.threePieceBuffs?.[row.effectId] || {
        effectId: row.effectId,
        name: '新建效果',
        category: '' as 'positive' | 'passive' | 'condition' | '',
        typeKey: '',
        value: 0,
        unit: 'percent' as EquipmentUnit,
        raw: '',
      };
      if (columnKey === 'field') {
        const nextEffect = buffModel.applyBuffBusinessType(
          equipmentBuffToDrawer(current),
          buffModel.OPERATOR_BUFF_BUSINESS_TYPES.includes(rawValue as buffModel.OperatorBuffBusinessType)
            ? rawValue as buffModel.OperatorBuffBusinessType
            : 'passive',
          row.effectId,
        );
        return {
          ...gearSet,
          threePieceBuffs: {
            ...(gearSet.threePieceBuffs || {}),
            [row.effectId]: drawerEffectToEquipmentBuff(nextEffect),
          },
        };
      }
      const nextEffectKind: BuffEffectKind = current.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
      return {
        ...gearSet,
        threePieceBuffs: {
          ...(gearSet.threePieceBuffs || {}),
          [row.effectId]: {
            ...current,
            name: columnKey === 'name' ? rawValue : current.name,
            category: current.category,
            typeKey: nextEffectKind === 'extraHit' ? '' : columnKey === 'effectKey' ? rawValue : current.typeKey,
            value: nextEffectKind === 'extraHit' ? 0 : columnKey === 'valueText' ? normalizeNumber(rawValue, current.value) : current.value,
            raw: columnKey === 'description' ? rawValue : current.raw,
            effectKind: nextEffectKind,
            ...(nextEffectKind === 'extraHit'
              ? {
                  extraHitConfig: normalizeExtraHitConfig({
                    ...current.extraHitConfig,
                    ...(columnKey === 'effectKey' ? { damageType: rawValue } : {}),
                    ...(columnKey === 'valueText' ? { baseMultiplier: normalizeNumber(rawValue, current.extraHitConfig?.baseMultiplier) } : {}),
                  }, `${row.effectId}-extra-hit`),
                }
              : { extraHitConfig: undefined }),
          },
        },
      };
    });
  }
  if (row.kind === 'fixedStat') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const nextTypeKey = columnKey === 'effectKey' && ['defense', 'hp', 'flatAtk'].includes(rawValue)
        ? rawValue as EquipmentFixedTypeKey
        : equipment.fixedStat?.typeKey || 'defense';
      const nextFixedStat: EquipmentFixedStat = {
        label: columnKey === 'name' ? rawValue : equipment.fixedStat?.label || '防御力',
        typeKey: nextTypeKey,
        value: equipment.fixedStat?.value || 0,
        unit: equipment.fixedStat?.unit || 'flat',
        raw: columnKey === 'description' ? rawValue : equipment.fixedStat?.raw,
      };
      return {
        ...equipment,
        fixedStat: nextTypeKey === 'defense'
          ? applyFixedStatPresetForPart(nextFixedStat, equipment.part)
          : nextFixedStat,
      };
    });
  }
  if (row.kind === 'effect') {
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const effect = equipment.effects[row.effectId];
      if (!effect) return equipment;
      const nextCategory = columnKey === 'field' ? normalizeCategory(rawValue === '能力值' ? 'ability' : rawValue) : effect.category;
      const nextTypeKey = columnKey === 'effectKey' ? rawValue : effect.typeKey;
      const availableTypeKeys = getEquipmentEffectTypeOptions(equipment.part, row.effectId, nextCategory, getEquipmentEffectShape(equipment));
      const normalizedTypeKey = nextTypeKey && availableTypeKeys.includes(nextTypeKey) ? nextTypeKey : '';
      const nextEffect: EquipmentEffect = {
        ...effect,
        label: columnKey === 'name' ? rawValue : effect.label,
        category: nextCategory,
        typeKey: normalizedTypeKey,
        unit: effect.unit,
        raw: columnKey === 'description' ? rawValue : effect.raw,
        levels: normalizedTypeKey ? effect.levels : {},
      };
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [row.effectId]: nextEffect,
        },
      };
    });
  }
  if (row.kind === 'effectLevels') {
    const levelMatch = rawValue.match(/^([0-3]):(.*)$/s);
    const levelKey = levelMatch?.[1] as EquipmentLevelKey;
    if (!LEVEL_KEYS.includes(levelKey)) return library;
    const levelValue = levelMatch?.[2] ?? '';
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => {
      const effect = equipment.effects[row.effectId];
      if (!effect) return equipment;
      const nextLevels = { ...effect.levels };
      const trimmedLevelValue = levelValue.trim();
      if (!trimmedLevelValue || columnKey !== 'valueText') {
        delete nextLevels[levelKey];
      } else {
        const parsedValue = normalizeNumber(trimmedLevelValue, NaN);
        if (!Number.isFinite(parsedValue)) {
          return equipment;
        }
        nextLevels[levelKey] = parsedValue;
      }
      return {
        ...equipment,
        effects: {
          ...equipment.effects,
          [row.effectId]: {
            ...effect,
            levels: nextLevels,
          },
        },
      };
    });
  }
  return library;
}

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
  collapsedThreePieceBuffIds: Record<string, boolean>
): EquipmentRow[] {
  return rows.filter((row) => {
    if (row.kind === 'set') {
      return true;
    }
    if (collapsedGearSetIds[row.gearSetId] !== false) {
      return false;
    }
    if (row.kind === 'threePieceBuff') {
      return collapsedThreePieceBuffIds[row.gearSetId] !== true;
    }
    if (row.kind === 'threePieceBuffHeader') {
      return true;
    }
    if (row.kind === 'equipment') {
      return true;
    }
    const equipmentKey = `${row.gearSetId}:${row.equipmentId}`;
    if (collapsedEquipmentIds[equipmentKey] !== false) {
      return false;
    }
    if (row.kind === 'fixedStat' || row.kind === 'effect') {
      return true;
    }
    const effectKey = `${row.gearSetId}:${row.equipmentId}:${row.effectId}`;
    return collapsedEffectIds[effectKey] === false;
  });
}

export function columnIndexToLabel(index: number) {
  let dividend = index + 1;
  let label = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return label;
}

export function buildWorkbookRows(rows: EquipmentRow[]) {
  const getCellValue = (row: EquipmentRow, columnKey: EquipmentSheetColumn['key']) => {
    switch (columnKey) {
      case 'name':
        return row.title;
      case 'idText':
        return row.idText;
      case 'field':
        return row.field;
      case 'level':
        return row.level;
      case 'effectKey':
        return row.effectKey;
      case 'valueText':
        return row.valueText;
      case 'description':
        return row.description;
      default:
        return '';
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

export function getWorkbookRowClassName(row: EquipmentWorkbookRow) {
  if (row.kind === 'set') return 'damage-sheet-excel-row is-character weapon-sheet-row-weapon';
  if (row.kind === 'threePieceBuffHeader') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-header';
  if (row.kind === 'threePieceBuff') return 'damage-sheet-excel-row is-data equipment-sheet-row-three-piece-effect';
  if (row.kind === 'equipment') return 'damage-sheet-excel-row is-button weapon-sheet-row-skill';
  if (row.kind === 'fixedStat') return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  if (row.kind === 'effect') return 'damage-sheet-excel-row is-character weapon-sheet-row-effect';
  return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
}

export function renderMenuIcon(icon: EquipmentContextMenuAction['icon']) {
  switch (icon) {
    case 'new':
      return <path d="M8 3.25v9.5M3.25 8h9.5" />;
    case 'delete':
      return (
        <>
          <path d="M4.25 5.25h7.5" />
          <path d="M6.25 2.75h3.5" />
          <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
          <path d="M4.75 5.25l.5 7h5.5l.5-7" />
        </>
      );
    case 'collapse':
      return <path d="M4 8h8" />;
    case 'expand':
      return <path d="M8 4v8M4 8h8" />;
    case 'open':
    default:
      return <path d="M5.75 4.25h6v6M11.75 4.25L4.25 11.75" />;
  }
}

export function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
