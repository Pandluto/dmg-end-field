import type { SkillType, ElementType } from '../../types';
import type { ResistanceZoneResult } from './buffCalculator';
import type { DamageBonusSnapshot, HitResistanceInput, SkillButtonBuff } from '../../types/storage';

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

export interface SkillDamagePanelBase {
  baseAtk: number;
  characterAtk: number;
  weaponAtk: number;
  weaponAtkPercent: number;
  abilityBonus: number;
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
  panelBase?: SkillDamagePanelBase;
  disabledBuffIdsByHitKey?: Record<string, string[]>;
  damageBonus: DamageBonusSnapshot;
  targetResistance?: HitResistanceInput;
}

export interface DamageBreakdown {
  base: number;
  afterCrit: number;
  afterBonus: number;
  afterDefense: number;
  afterResistance: number;
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
  resistanceZone: number;
  resistance: ResistanceZoneResult;
  amplifyRate: number;
  fragileRate: number;
  vulnerabilityRate: number;
  comboDamageBonus: number;
  imbalanceDamageBonus: number;
  defenseZone: number;
}

export interface HitCalcResult {
  hit: ResolvedHitTemplate;
  appliedBuffs: SkillButtonBuff[];
  panel: SkillDamagePanel;
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
  appliedBuffTags: AppliedBuffTagViewModel[];
  showNoBuff: boolean;
}

export interface AppliedBuffTagViewModel {
  id: string;
  label: string;
  sourceName: string;
}

export interface FormulaViewModel {
  title: string;
  panelLines: string[];
  buffTags: string[];
  showNoBuff: boolean;
  baseMultiplierText: string;
  multiplierFormulaText: string;
  formulaText: string;
  elementBonusText: string;
  skillBonusText: string;
  allDamageBonusText: string;
  damageBonusRateText: string;
  resistanceEffectiveText: string;
  resistanceFormulaText: string;
  amplifyFormulaText: string;
  fragileFormulaText: string;
  vulnerabilityFormulaText: string;
  comboFormulaText: string;
  imbalanceFormulaText: string;
  defenseZoneText: string;
  nonCritFormulaText: string;
  expectedText: string;
  critText: string;
  nonCritText: string;
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
