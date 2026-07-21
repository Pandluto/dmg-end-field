import {
  BUFF_TYPE_LABELS,
  BUFF_TYPE_OPTIONS,
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  EQUIPMENT_PARTS,
  LEVEL_KEYS,
  getEquipmentBuffBusinessType,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  type EquipmentFormulaBinding,
  type EquipmentLibrary,
  type EquipmentLevelKey,
  type EquipmentSelection,
  type EquipmentSheetColumn,
  type EquipmentWorkbookCell,
  type EquipmentWorkbookRow,
} from './equipmentSheetPageModel';

export function buildEquipmentFormulaBinding(
  library: EquipmentLibrary,
  selectedCell: EquipmentSelection | null,
  selectedWorkbookCell: EquipmentWorkbookCell | null,
  selectedWorkbookRow: EquipmentWorkbookRow | null,
  updateCellValue: (row: EquipmentWorkbookRow['sourceRow'], columnKey: EquipmentSheetColumn['key'], value: string) => void,
): EquipmentFormulaBinding | null {
    if (!selectedWorkbookRow || !selectedWorkbookCell) {
      return null;
    }
    const row = selectedWorkbookRow.sourceRow;
    const columnKey = selectedWorkbookCell.columnKey;
    if (row.kind === 'effectLevels') {
      const levelKey = selectedCell?.address?.replace(/^Lv/, '') as EquipmentLevelKey;
      if (!LEVEL_KEYS.includes(levelKey)) {
        return null;
      }
      const effect = library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.effects[row.effectId];
      return {
        key: `${row.key}:${levelKey}`,
        value: effect?.levels[levelKey] == null ? '' : String(effect.levels[levelKey]),
        inputMode: 'number',
        placeholder: `Lv${levelKey}`,
        commit: (value) => updateCellValue(row, columnKey, `${levelKey}:${value}`),
      };
    }
    const editable =
      (row.kind === 'set' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'threePieceBuffHeader' && false)
      || (row.kind === 'threePieceBuff' && ['name', 'field', 'effectKey', 'valueText', 'description'].includes(columnKey))
      || (row.kind === 'equipment' && ['name', 'field', 'description'].includes(columnKey))
      || (row.kind === 'fixedStat' && ['name', 'effectKey', 'description'].includes(columnKey))
      || (row.kind === 'effect' && ['name', 'field', 'effectKey'].includes(columnKey));
    if (!editable) {
      return {
        key: `${row.key}:${columnKey}:readonly`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        readOnly: true,
        commit: () => undefined,
      };
    }
    if ((row.kind === 'set' || row.kind === 'equipment') && columnKey === 'description') {
      const value = row.kind === 'set'
        ? library.gearSets[row.gearSetId]?.imgUrl ?? ''
        : library.gearSets[row.gearSetId]?.equipments[row.equipmentId]?.imgUrl ?? '';
      return {
        key: `${row.key}:imgUrl`,
        value,
        inputMode: 'text',
        control: 'image-search-select',
        placeholder: row.kind === 'set' ? '搜索套装配图' : '搜索装备配图',
        commit: (nextValue) => updateCellValue(row, columnKey, nextValue),
      };
    }
    if (row.kind === 'equipment' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_PARTS.map((part) => ({ value: part, label: part })),
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'threePieceBuff' && columnKey === 'field') {
      const selectedBuff = library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId];
      return {
        key: `${row.key}:${columnKey}`,
        value: getEquipmentBuffBusinessType(selectedBuff),
        inputMode: 'text',
        control: 'select',
        options: EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'fixedStat' && columnKey === 'effectKey') {
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'defense', label: '防御力 · defense' },
          { value: 'hp', label: '生命 · hp' },
          { value: 'flatAtk', label: '固定攻击力 · flatAtk' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if (row.kind === 'effect' && columnKey === 'field') {
      return {
        key: `${row.key}:${columnKey}`,
        value: row.field === '能力值' ? 'ability' : 'buff',
        inputMode: 'text',
        control: 'select',
        options: [
          { value: 'ability', label: '能力值' },
          { value: 'buff', label: 'Buff类型' },
        ],
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    if ((row.kind === 'effect' || row.kind === 'threePieceBuff') && columnKey === 'effectKey') {
      if (row.kind === 'threePieceBuff' && library.gearSets[row.gearSetId]?.threePieceBuffs?.[row.effectId]?.effectKind === 'extraHit') {
        return {
          key: `${row.key}:${columnKey}:extra-hit-types`,
          value: selectedWorkbookCell.value,
          inputMode: 'text',
          readOnly: true,
          commit: () => undefined,
        };
      }
      const effectOptions = row.kind === 'effect'
        ? (() => {
            const equipment = library.gearSets[row.gearSetId]?.equipments[row.equipmentId];
            const effect = equipment?.effects[row.effectId];
            return equipment && effect
              ? getEquipmentEffectTypeOptions(equipment.part, row.effectId, effect.category, getEquipmentEffectShape(equipment)).map((typeKey) => ({
                  value: typeKey,
                  label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}`,
                }))
              : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
          })()
        : BUFF_TYPE_OPTIONS.map((typeKey) => ({ value: typeKey, label: `${BUFF_TYPE_LABELS[typeKey] || typeKey} · ${typeKey}` }));
      return {
        key: `${row.key}:${columnKey}`,
        value: selectedWorkbookCell.value,
        inputMode: 'text',
        control: 'search-select',
        options: effectOptions,
        commit: (value) => updateCellValue(row, columnKey, value),
      };
    }
    return {
      key: `${row.key}:${columnKey}`,
      value: selectedWorkbookCell.value,
      inputMode: columnKey === 'valueText' ? 'number' : 'text',
      commit: (value) => updateCellValue(row, columnKey, value),
    };

}
