import type { BuffEffectKind } from '../core/domain/buff';
import { normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import {
  applyEffectValueCatalogForPart,
  applyFixedStatPresetForPart,
  DEFAULT_FIXED_STAT_BY_PART,
  drawerEffectToEquipmentBuff,
  EFFECT_IDS,
  equipmentBuffToDrawer,
  getEffectEntries,
  getEquipmentEffectShape,
  getEquipmentEffectTypeOptions,
  getGearSets,
  getSortedEquipments,
  LEVEL_KEYS,
  normalizeCategory,
  normalizeNumber,
  normalizePart,
  type EquipmentEffect,
  type EquipmentEffectId,
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

export interface EquipmentEditingResult {
  library: EquipmentLibrary;
  changed: boolean;
  gearSetId?: string;
  equipmentId?: string;
  effectId?: string;
  selectedRowKey?: string;
}

export type EquipmentDeleteTarget =
  | { kind: 'set'; gearSetId: string }
  | { kind: 'equipment'; gearSetId: string; equipmentId: string }
  | { kind: 'fixedStat'; gearSetId: string; equipmentId: string }
  | { kind: 'effect'; gearSetId: string; equipmentId: string; effectId: EquipmentEffectId }
  | { kind: 'threePieceBuff'; gearSetId: string; effectId: string };

function unchangedEditingResult(library: EquipmentLibrary): EquipmentEditingResult {
  return { library, changed: false };
}

function cloneEquipmentValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findNextThreePieceEffectId(current: Record<string, unknown>): string {
  let index = 1;
  while (current[`effect${index}`]) index += 1;
  return `effect${index}`;
}

export function createEquipmentGearSet(library: EquipmentLibrary): EquipmentEditingResult {
  const gearSetId = makeNextId('gear-set', Object.keys(library.gearSets));
  return {
    library: {
      ...library,
      gearSets: {
        ...library.gearSets,
        [gearSetId]: {
          gearSetId,
          name: '新建套装',
          buffId: '',
          imgUrl: '',
          threePieceBuffs: {},
          equipments: {},
        },
      },
    },
    changed: true,
    gearSetId,
    selectedRowKey: `set-${gearSetId}`,
  };
}

export function createEquipmentItem(library: EquipmentLibrary, gearSetId: string): EquipmentEditingResult {
  const gearSet = library.gearSets[gearSetId];
  if (!gearSet) return unchangedEditingResult(library);
  const equipmentId = makeNextId('equipment', Object.keys(gearSet.equipments));
  const nextLibrary = updateLibrarySet(library, gearSetId, (current) => ({
    ...current,
    equipments: {
      ...current.equipments,
      [equipmentId]: {
        equipmentId,
        name: '新建装备',
        part: '护甲',
        imgUrl: '',
        fixedStat: { ...DEFAULT_FIXED_STAT_BY_PART['护甲'] },
        effects: {},
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    equipmentId,
    selectedRowKey: `equipment-${gearSetId}-${equipmentId}`,
  };
}

export function createEquipmentEffect(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
): EquipmentEditingResult {
  const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
  const effectId = EFFECT_IDS.find((candidate) => !equipment?.effects[candidate]);
  if (!equipment || !effectId) return unchangedEditingResult(library);
  const nextLibrary = updateLibraryEquipment(library, gearSetId, equipmentId, (current) => ({
    ...current,
    effects: {
      ...current.effects,
      [effectId]: {
        effectId,
        label: '新建增益',
        typeKey: '',
        category: 'buff',
        unit: 'flat',
        levels: {},
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    equipmentId,
    effectId,
    selectedRowKey: `effect-${gearSetId}-${equipmentId}-${effectId}`,
  };
}

export function createEquipmentThreePieceEffect(
  library: EquipmentLibrary,
  gearSetId: string,
): EquipmentEditingResult {
  const gearSet = library.gearSets[gearSetId];
  if (!gearSet) return unchangedEditingResult(library);
  const effectId = findNextThreePieceEffectId(gearSet.threePieceBuffs || {});
  const nextLibrary = updateLibrarySet(library, gearSetId, (current) => ({
    ...current,
    threePieceBuffs: {
      ...(current.threePieceBuffs || {}),
      [effectId]: {
        effectId,
        name: '新建效果',
        category: '',
        typeKey: '',
        value: 0,
        unit: 'percent',
        raw: '',
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    effectId,
    selectedRowKey: `three-piece-buff-${gearSetId}-${effectId}`,
  };
}

export function duplicateEquipmentThreePieceEffect(
  library: EquipmentLibrary,
  gearSetId: string,
  sourceEffectId: string,
): EquipmentEditingResult {
  const gearSet = library.gearSets[gearSetId];
  const source = gearSet?.threePieceBuffs?.[sourceEffectId];
  if (!gearSet || !source) return unchangedEditingResult(library);
  const effectId = findNextThreePieceEffectId(gearSet.threePieceBuffs || {});
  const nextLibrary = updateLibrarySet(library, gearSetId, (current) => ({
    ...current,
    threePieceBuffs: {
      ...(current.threePieceBuffs || {}),
      [effectId]: {
        ...cloneEquipmentValue(source),
        effectId,
        name: `${source.name} 副本`,
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    effectId,
    selectedRowKey: `three-piece-buff-${gearSetId}-${effectId}`,
  };
}

export function duplicateEquipmentItem(
  library: EquipmentLibrary,
  gearSetId: string,
  sourceEquipmentId: string,
): EquipmentEditingResult {
  const gearSet = library.gearSets[gearSetId];
  const source = gearSet?.equipments[sourceEquipmentId];
  if (!gearSet || !source) return unchangedEditingResult(library);
  const equipmentId = makeNextId(`${sourceEquipmentId}-copy`, Object.keys(gearSet.equipments));
  const nextLibrary = updateLibrarySet(library, gearSetId, (current) => ({
    ...current,
    equipments: {
      ...current.equipments,
      [equipmentId]: {
        ...cloneEquipmentValue(source),
        equipmentId,
        name: `${source.name} 副本`,
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    equipmentId,
    selectedRowKey: `equipment-${gearSetId}-${equipmentId}`,
  };
}

export function duplicateEquipmentEffect(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
  sourceEffectId: EquipmentEffectId,
): EquipmentEditingResult {
  const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
  const source = equipment?.effects[sourceEffectId];
  const effectId = EFFECT_IDS.find((candidate) => !equipment?.effects[candidate]);
  if (!equipment || !source || !effectId) return unchangedEditingResult(library);
  const nextLibrary = updateLibraryEquipment(library, gearSetId, equipmentId, (current) => ({
    ...current,
    effects: {
      ...current.effects,
      [effectId]: {
        ...cloneEquipmentValue(source),
        effectId,
        label: `${source.label} 副本`,
      },
    },
  }));
  return {
    library: nextLibrary,
    changed: true,
    gearSetId,
    equipmentId,
    effectId,
    selectedRowKey: `effect-${gearSetId}-${equipmentId}-${effectId}`,
  };
}

export function addEquipmentFixedStat(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
): EquipmentEditingResult {
  const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
  if (!equipment || equipment.fixedStat) return unchangedEditingResult(library);
  return {
    library: updateLibraryEquipment(library, gearSetId, equipmentId, (current) => ({
      ...current,
      fixedStat: { ...DEFAULT_FIXED_STAT_BY_PART[current.part] },
    })),
    changed: true,
    gearSetId,
    equipmentId,
    selectedRowKey: `fixed-${gearSetId}-${equipmentId}`,
  };
}

export function deleteEquipmentNode(
  library: EquipmentLibrary,
  target: EquipmentDeleteTarget,
): EquipmentEditingResult {
  const gearSet = library.gearSets[target.gearSetId];
  if (!gearSet) return unchangedEditingResult(library);
  if (target.kind === 'set') {
    const gearSets = { ...library.gearSets };
    delete gearSets[target.gearSetId];
    return { library: { ...library, gearSets }, changed: true };
  }
  if (target.kind === 'equipment') {
    if (!gearSet.equipments[target.equipmentId]) return unchangedEditingResult(library);
    const equipments = { ...gearSet.equipments };
    delete equipments[target.equipmentId];
    return {
      library: updateLibrarySet(library, target.gearSetId, (current) => ({ ...current, equipments })),
      changed: true,
      gearSetId: target.gearSetId,
      selectedRowKey: `set-${target.gearSetId}`,
    };
  }
  if (target.kind === 'threePieceBuff') {
    if (!gearSet.threePieceBuffs?.[target.effectId]) return unchangedEditingResult(library);
    const threePieceBuffs = { ...gearSet.threePieceBuffs };
    delete threePieceBuffs[target.effectId];
    return {
      library: updateLibrarySet(library, target.gearSetId, (current) => ({ ...current, threePieceBuffs })),
      changed: true,
      gearSetId: target.gearSetId,
      selectedRowKey: `three-piece-buff-header-${target.gearSetId}`,
    };
  }
  const equipment = gearSet.equipments[target.equipmentId];
  if (!equipment) return unchangedEditingResult(library);
  if (target.kind === 'fixedStat') {
    if (!equipment.fixedStat) return unchangedEditingResult(library);
    const { fixedStat: _fixedStat, ...rest } = equipment;
    return {
      library: updateLibrarySet(library, target.gearSetId, (current) => ({
        ...current,
        equipments: { ...current.equipments, [target.equipmentId]: rest },
      })),
      changed: true,
      gearSetId: target.gearSetId,
      equipmentId: target.equipmentId,
      selectedRowKey: `equipment-${target.gearSetId}-${target.equipmentId}`,
    };
  }
  if (!equipment.effects[target.effectId]) return unchangedEditingResult(library);
  const effects = { ...equipment.effects };
  delete effects[target.effectId];
  return {
    library: updateLibraryEquipment(library, target.gearSetId, target.equipmentId, (current) => ({ ...current, effects })),
    changed: true,
    gearSetId: target.gearSetId,
    equipmentId: target.equipmentId,
    selectedRowKey: `equipment-${target.gearSetId}-${target.equipmentId}`,
  };
}

export function normalizeEquipmentLibraryOrder(library: EquipmentLibrary): EquipmentEditingResult {
  return {
    library: {
      ...library,
      gearSets: Object.fromEntries(
        getGearSets(library)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((gearSet) => [gearSet.gearSetId, {
            ...gearSet,
            equipments: Object.fromEntries(getSortedEquipments(gearSet).map((equipment) => [equipment.equipmentId, {
              ...equipment,
              effects: Object.fromEntries(getEffectEntries(equipment)),
            }])),
          }]),
      ),
    },
    changed: true,
  };
}

export function applyEquipmentEffectValueMapping(
  library: EquipmentLibrary,
  gearSetId: string,
  equipmentId: string,
  effectId: EquipmentEffectId,
): EquipmentEditingResult {
  const equipment = library.gearSets[gearSetId]?.equipments[equipmentId];
  const effect = equipment?.effects[effectId];
  if (!equipment || !effect) return unchangedEditingResult(library);
  const mappedEffect = applyEffectValueCatalogForPart(effect, equipment.part, getEquipmentEffectShape(equipment));
  if (mappedEffect === effect) return unchangedEditingResult(library);
  return {
    library: updateLibraryEquipment(library, gearSetId, equipmentId, (current) => ({
      ...current,
      effects: { ...current.effects, [effectId]: mappedEffect },
    })),
    changed: true,
    gearSetId,
    equipmentId,
    effectId,
    selectedRowKey: `effect-${gearSetId}-${equipmentId}-${effectId}`,
  };
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
