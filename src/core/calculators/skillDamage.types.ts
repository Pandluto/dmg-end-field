import type { SkillType, ElementType } from '../../types';
import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';

export interface ResolvedHitTemplate {
  key: string;
  displayName: string;
  multiplier: number;
  element: ElementType;
  skillType: SkillType;
}

export interface ResolvedSkillDamageTemplate {
  characterId: string;
  characterName: string;
  runtimeSkillId: string;
  displayName: string;
  buttonType: SkillType;
  hits: ResolvedHitTemplate[];
}

export interface SkillDamagePanel {
  atk: number;
  critRate: number;
  critDmg: number;
}

export interface SkillDamageCalcInputV2 {
  buttonId: string;
  characterId: string;
  runtimeSkillId: string;
  template: ResolvedSkillDamageTemplate;
  buffs: SkillButtonBuff[];
  panel: SkillDamagePanel;
  damageBonus: DamageBonusSnapshot;
}

export interface DamageBreakdown {
  base: number;
  afterCrit: number;
  afterBonus: number;
  afterDefense: number;
  afterAmplify: number;
  afterFragile: number;
  afterVulnerability: number;
  final: number;
}

export interface MultiplierAdjustment {
  base: number;
  afterBonus: number;
  afterMultiply: number;
}

export interface DamageZones {
  elementBonus: number;
  skillBonus: number;
  allDamageBonus: number;
  damageBonusRate: number;
  amplifyRate: number;
  fragileRate: number;
  vulnerabilityRate: number;
  comboDamageBonus: number;
  defenseZone: number;
}

export interface HitCalcResult {
  hit: ResolvedHitTemplate;
  appliedBuffs: SkillButtonBuff[];
  zones: DamageZones;
  multiplier: MultiplierAdjustment;
  nonCrit: DamageBreakdown;
  crit: DamageBreakdown;
  expected: DamageBreakdown;
}

export interface SkillDamageCalcResultV2 {
  hits: HitCalcResult[];
  summary: {
    totalExpected: number;
    totalCrit: number;
    totalNonCrit: number;
  };
}

export interface HitCardViewModel {
  key: string;
  displayName: string;
  multiplierText: string;
  expectedText: string;
  critText: string;
  nonCritText: string;
  buffCountText: string;
  isSelected: boolean;
}

export interface HitDetailViewModel {
  title: string;
  elementText: string;
  multiplierText: string;
  expectedText: string;
  critText: string;
  nonCritText: string;
  appliedBuffTags: string[];
  showNoBuff: boolean;
}

export interface FormulaViewModel {
  title: string;
  panelLines: string[];
  zoneSections: Array<{
    title: string;
    lines: string[];
    totalText: string;
  }>;
  buffTags: string[];
  showNoBuff: boolean;
}

export interface SkillDamageModalViewModel {
  header: {
    displayName: string;
    buttonType: SkillType;
    hitCount: number;
    fullText: string;
  };
  summary: {
    totalExpectedText: string;
    totalCritText: string;
    totalNonCritText: string;
  };
  hitCards: HitCardViewModel[];
  activeHitDetail: HitDetailViewModel | null;
  activeHitFormula: FormulaViewModel | null;
}
