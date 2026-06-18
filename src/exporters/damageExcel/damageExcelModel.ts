import type { SkillButtonBuff, SkillButtonTable } from '../../types/storage.ts';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator.ts';

export interface DamageExcelColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

export interface DamageExcelCharacterRow {
  kind: 'character';
  id: string;
  characterId: string;
  characterName: string;
  title: string;
  subtitle: string;
  meta: string;
}

export interface DamageExcelButtonRow {
  kind: 'button';
  id: string;
  buttonId: string;
  characterId: string;
  characterName: string;
  title: string;
  subtitle: string;
  meta: string;
}

export interface DamageExcelBuffContributionSnapshot {
  buffId: string;
  type: string;
  multiplier: boolean;
  rawValue: number;
  runtimeCoefficient: number;
  effectiveValue: number;
  multiplierCoefficient?: number;
}

export interface DamageExcelZoneCalculationSnapshot {
  additiveContributions: DamageExcelBuffContributionSnapshot[];
  multiplierContributions: DamageExcelBuffContributionSnapshot[];
  additiveTotal: number;
  multiplierProduct: number;
  finalValue: number;
}

export interface DamageExcelHitResultSnapshot {
  panel: {
    atk: number;
    critRate: number;
    critDmg: number;
  };
  multiplier: {
    base: number;
    afterBonus: number;
    afterMultiply: number;
  };
  zones: {
    damageBonus?: DamageExcelZoneCalculationSnapshot;
    amplify?: DamageExcelZoneCalculationSnapshot;
    fragile?: DamageExcelZoneCalculationSnapshot;
    vulnerability?: DamageExcelZoneCalculationSnapshot;
    skillMultiplier?: DamageExcelZoneCalculationSnapshot;
    damageBonusRate: number;
    defenseZone: number;
    resistanceZone: number;
    resistance?: {
      baseResistance: number;
      corrosion: number;
      resistanceIgnore: number;
      effectiveResistance: number;
      resistanceZone: number;
      formulaText: string;
    };
    amplifyRate: number;
    fragileRate: number;
    vulnerabilityRate: number;
    comboDamageBonus: number;
    imbalanceDamageBonus: number;
    elementBonus?: number;
    skillBonus?: number;
    allDamageBonus?: number;
  };
  buffContributions?: DamageExcelBuffContributionSnapshot[];
  nonCrit: {
    base?: number;
    final: number;
  };
  crit: {
    final: number;
  };
  expected: {
    final: number;
  };
}

export interface DamageExcelHitRow {
  kind: 'hit';
  id: string;
  characterId: string;
  buttonId: string;
  rowIndex: number;
  values: Record<string, string>;
  detail: {
    characterName: string;
    buttonName: string;
    hitLabel: string;
    hit: {
      key: string;
      displayName?: string;
      multiplier?: number;
      element?: string;
      skillType?: string;
    };
    hitResult: DamageExcelHitResultSnapshot;
  };
}

export type DamageExcelRow = DamageExcelCharacterRow | DamageExcelButtonRow | DamageExcelHitRow;

export interface BuildDamageExcelWorkbookInput {
  rows: DamageExcelRow[];
  columns: DamageExcelColumn[];
  allBuffList?: SkillButtonBuff[];
  skillButtonTable?: SkillButtonTable;
  operatorConfigPageCache?: Record<string, ConfigSnapshot>;
}

export interface DamageExcelHitRecord {
  row: DamageExcelHitRow;
  processRow: number;
  parameterRow: number;
}
