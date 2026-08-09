import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import type { SkillDamageCalcResultV2 } from '../core/calculators/skillDamage.types';
import type { EquipmentLibrary } from '../core/services/operatorEquipmentLibrary';
import type { Character, SkillType } from '../types';
import type { HitResistanceInput, SkillButtonBuff } from '../types/storage';
import type { WeaponDraft } from '../components/weaponDraftModel';

export const MOBILE_DRAFT_SCHEMA_VERSION = 1 as const;
export const MOBILE_INITIAL_SLOT_COUNT = 8;

export const MOBILE_PAGE_IDS = ['selection', 'config', 'timeline', 'report'] as const;
export type MobilePageId = (typeof MOBILE_PAGE_IDS)[number];

export const MOBILE_EQUIPMENT_SLOT_KEYS = ['armor', 'glove', 'accessory1', 'accessory2'] as const;
export type MobileEquipmentSlotKey = (typeof MOBILE_EQUIPMENT_SLOT_KEYS)[number];

export interface MobileEquipmentSelection {
  equipmentId: string;
  effectLevels: Partial<Record<'effect1' | 'effect2' | 'effect3', number>>;
}

export interface MobileOperatorConfig {
  characterId: string;
  level: number;
  potential: string;
  favorValue: number;
  mainStatFlatBonus: number;
  subStatFlatBonus: number;
  skillLevels: Record<'A' | 'B' | 'E' | 'Q' | 'Dot', string>;
  weapon: {
    weaponId: string;
    level: number;
    potential: string;
    skillLevels: Record<'skill1' | 'skill2' | 'skill3', number>;
  };
  equipment: Record<MobileEquipmentSlotKey, MobileEquipmentSelection>;
}

export interface MobileTimelineAction {
  id: string;
  operatorId: string;
  skillType: SkillType;
  runtimeSkillId: string;
  skillName: string;
  skillIconUrl?: string;
  buffs: SkillButtonBuff[];
  buffStackCounts: Record<string, number>;
  buffStackCountsByHitKey: Record<string, Record<string, number>>;
  globallyDisabledBuffIds: string[];
  disabledBuffIdsByHitKey: Record<string, string[]>;
  disabledHitKeys: string[];
  targetResistance: HitResistanceInput;
}

export interface MobileTimelineSlot {
  id: string;
  action: MobileTimelineAction | null;
}

export interface MobileDraft {
  schemaVersion: typeof MOBILE_DRAFT_SCHEMA_VERSION;
  selectedOperatorIds: string[];
  operatorConfigs: Record<string, MobileOperatorConfig>;
  slots: MobileTimelineSlot[];
  activePage: MobilePageId;
  activeOperatorId: string;
  updatedAt: number;
}

export interface MobileCatalog {
  dataVersion: string;
  imageVersion: string;
  generatedAt: string;
  characters: Character[];
  weapons: Record<string, WeaponDraft>;
  equipment: EquipmentLibrary;
  buffs: SkillButtonBuff[];
}

export interface MobileOperatorRuntime {
  config: MobileOperatorConfig;
  snapshot: ConfigSnapshot;
}

export interface MobileSlotCalculation {
  slotId: string;
  actionId: string;
  operatorId: string;
  operatorName: string;
  skillName: string;
  result: SkillDamageCalcResultV2;
}

export interface MobileDamageReportRow {
  id: string;
  label: string;
  expected: number;
  share: number;
}

export interface MobileDamageReport {
  totalExpected: number;
  totalCrit: number;
  totalNonCrit: number;
  slotCount: number;
  byOperator: MobileDamageReportRow[];
  bySkill: MobileDamageReportRow[];
}

export interface MobileRuntimeState {
  operatorSnapshots: Record<string, ConfigSnapshot>;
  slotCalculations: Record<string, MobileSlotCalculation>;
  report: MobileDamageReport;
}
