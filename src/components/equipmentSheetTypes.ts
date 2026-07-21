import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../core/domain/buff';
import type { OperatorBuffDerivedValue, OperatorBuffValueMode } from './operatorDraftBuffModel';

export type EquipmentPart = '护甲' | '护手' | '配件';
export type EquipmentEffectId = 'effect1' | 'effect2' | 'effect3';
export type EquipmentLevelKey = '0' | '1' | '2' | '3';
export type EquipmentFixedTypeKey = 'defense' | 'hp' | 'flatAtk';
export type EquipmentUnit = 'flat' | 'percent';
export type EquipmentEffectCategory = 'ability' | 'buff';

export interface EquipmentFixedStat {
  label: string;
  typeKey: EquipmentFixedTypeKey;
  value: number;
  unit: EquipmentUnit;
  raw?: string;
}

export interface EquipmentEffect {
  effectId: EquipmentEffectId;
  label: string;
  typeKey: string;
  category: EquipmentEffectCategory;
  levels: Partial<Record<EquipmentLevelKey, number>>;
  unit: EquipmentUnit;
  raw?: string;
}

export interface EquipmentThreePieceBuff {
  schemaVersion?: 2;
  effectId: string;
  name: string;
  category: 'positive' | 'passive' | 'condition' | 'countable' | '';
  typeKey: string;
  value: number;
  unit: EquipmentUnit;
  description?: string;
  raw?: string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
  maxStacks?: number;
  multiplier?: BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface EquipmentItem {
  equipmentId: string;
  name: string;
  part: EquipmentPart;
  imgUrl?: string;
  fixedStat?: EquipmentFixedStat;
  effects: Partial<Record<EquipmentEffectId, EquipmentEffect>>;
}

export interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  buffId?: string;
  imgUrl?: string;
  threePieceBuff?: EquipmentThreePieceBuff;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuff>;
  equipments: Record<string, EquipmentItem>;
}

export interface EquipmentLibrary {
  updatedAt?: string;
  migration?: {
    source?: string;
    migratedAt?: string;
    warnings?: string[];
    reviewRequired?: boolean;
  };
  gearSets: Record<string, EquipmentGearSet>;
}

export interface EquipmentValuePresetEffect {
  effectId?: string;
  label?: string;
  typeKey?: string;
  category?: EquipmentEffectCategory | string;
  unit?: EquipmentUnit | string;
  raw?: string;
  levels?: Partial<Record<EquipmentLevelKey, number>>;
}

export interface EquipmentValuePresetItem {
  fixedStat?: Partial<EquipmentFixedStat>;
  effects?: Record<string, EquipmentValuePresetEffect>;
}

export interface EquipmentValuePresetFile {
  gearSets?: Record<string, {
    equipments?: Record<string, EquipmentValuePresetItem>;
  }>;
}

export interface EquipmentValueCatalogEntry {
  label: string;
  typeKey: string;
  category: EquipmentEffectCategory;
  unit: EquipmentUnit;
  raw: string;
  levels: Partial<Record<EquipmentLevelKey, number>>;
  count: number;
}

export type EquipmentEffectShape = 'two-effects' | 'three-effects';

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

export type EquipmentSelection = {
  address: string;
  sourceRowKey: string;
  columnKey: EquipmentSheetColumn['key'];
};

export type EquipmentFormulaBinding = {
  key: string;
  value: string;
  inputMode: 'text' | 'number';
  readOnly?: boolean;
  control?: 'input' | 'select' | 'search-select' | 'image-search-select';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  commit: (rawValue: string) => void;
};

export interface EquipmentImageOption {
  key: string;
  fileName: string;
  baseName: string;
  relativePath: string;
  source: 'builtin' | 'user';
  displayUrl: string;
  searchText: string;
}

export type EquipmentExplorerNode =
  | { kind: 'set'; gearSetId: string }
  | { kind: 'threePieceBuffHeader'; gearSetId: string }
  | { kind: 'threePieceBuff'; gearSetId: string; effectId: string }
  | { kind: 'equipment'; gearSetId: string; equipmentId: string }
  | { kind: 'fixedStat'; gearSetId: string; equipmentId: string }
  | { kind: 'effect'; gearSetId: string; equipmentId: string; effectId: EquipmentEffectId };

export type EquipmentContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | EquipmentExplorerNode['kind'] | 'effectLevels';
  gearSetId?: string;
  equipmentId?: string;
  effectId?: string;
};

export type EquipmentContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};
