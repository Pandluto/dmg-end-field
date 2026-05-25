import type { SkillButtonBuff, SkillButtonTable } from '../../types/storage.ts';

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
    damageBonusRate: number;
    defenseZone: number;
    amplifyRate: number;
    fragileRate: number;
    vulnerabilityRate: number;
    comboDamageBonus: number;
    imbalanceDamageBonus: number;
    elementBonus?: number;
    skillBonus?: number;
    allDamageBonus?: number;
  };
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

export interface DamageExcelStorageEntry {
  key: string;
  value: string;
}

export interface BuildDamageExcelWorkbookInput {
  rows: DamageExcelRow[];
  columns: DamageExcelColumn[];
  storageSnapshot?: DamageExcelStorageEntry[];
  allBuffList?: SkillButtonBuff[];
  skillButtonTable?: SkillButtonTable;
}

export interface DamageExcelHitRecord {
  row: DamageExcelHitRow;
  processRow: number;
  parameterRow: number;
}
