import type { BuffEffectKind } from '../core/domain/buff';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import {
  applyFixedStatPresetForPart,
  drawerEffectToEquipmentBuff,
  equipmentBuffToDrawer,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  LEVEL_KEYS,
  normalizeCategory,
  normalizeNumber,
  normalizePart,
  type EquipmentEffect,
  type EquipmentFixedStat,
  type EquipmentFixedTypeKey,
  type EquipmentGearSet,
  type EquipmentItem,
  type EquipmentLevelKey,
  type EquipmentLibrary,
  type EquipmentUnit,
} from './equipmentSheetModel';
import type { EquipmentRow, EquipmentSheetColumn } from './equipmentSheetWorkbook';

export function makeNextId(prefix: string, existingIds: string[]): string {
  let index = existingIds.length + 1;
  let candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  while (existingIds.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  }
  return candidate;
}

export function updateLibrarySet(
  library: EquipmentLibrary,
  gearSetId: string,
  updater: (set: EquipmentGearSet) => EquipmentGearSet,
): EquipmentLibrary {
  const target = library.gearSets[gearSetId];
  if (!target) return library;
  return {
    ...library,
    gearSets: {
      ...library.gearSets,
      [gearSetId]: updater(target),
    },
  };
}

export function updateLibraryEquipment(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
  updater: (equipment: EquipmentItem) => EquipmentItem,
): EquipmentLibrary {
  return updateLibrarySet(library, gearSetId, (gearSet) => {
    const equipment = gearSet.equipments[equipmentId];
    if (!equipment) return gearSet;
    return {
      ...gearSet,
      equipments: {
        ...gearSet.equipments,
        [equipmentId]: updater(equipment),
      },
    };
  });
}

export function applyCellValueToLibrary(
  library: EquipmentLibrary,
  row: EquipmentRow,
  columnKey: EquipmentSheetColumn['key'],
  rawValue: string,
): EquipmentLibrary {
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
    return updateLibraryEquipment(library, row.gearSetId, row.equipmentId, (equipment) => ({
      ...equipment,
      name: columnKey === 'name' ? rawValue : equipment.name,
      part: columnKey === 'field' ? normalizePart(rawValue) : equipment.part,
      imgUrl: columnKey === 'description' ? rawValue : equipment.imgUrl,
    }));
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
      const nextCategory = columnKey === 'field'
        ? normalizeCategory(rawValue === '能力值' ? 'ability' : rawValue)
        : effect.category;
      const nextTypeKey = columnKey === 'effectKey' ? rawValue : effect.typeKey;
      const availableTypeKeys = getEquipmentEffectTypeOptions(
        equipment.part,
        row.effectId,
        nextCategory,
        getEquipmentEffectShape(equipment),
      );
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
        if (!Number.isFinite(parsedValue)) return equipment;
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
