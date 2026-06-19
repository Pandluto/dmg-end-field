import type { SkillType, HitSkillType, ElementType } from '../../types';
import type { ResistanceZoneResult } from './buffCalculator';
import type { HitBuffZoneResults, ZoneCalculationResult } from './buffZoneCalculator';
import type { DamageBonusSnapshot, HitResistanceInput, SkillButtonBuff } from '../../types/storage';

export interface ResolvedHitTemplate {
  key: string;
  displayName: string;
  multiplier: number;
  element: ElementType;
  skillType: HitSkillType;
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
  strength?: number;
  agility?: number;
  intelligence?: number;
  will?: number;
  mainStatFinal?: number;
  subStatFinal?: number;
  mainStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
  subStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
  mainStatScale?: number;
  subStatScale?: number;
  allStatScale?: number;
}

export interface SkillDamageCalcInputV2 {
  buttonId: string;
  characterId: string;
  runtimeSkillId: string;
  template: ResolvedSkillDamageTemplate;
  buffs: SkillButtonBuff[];
  buffStackCounts?: Record<string, number>;
  buffStackCountsByHitKey?: Record<string, Record<string, number>>;
  panel: SkillDamagePanel;
  panelBase?: SkillDamagePanelBase;
  disabledBuffIdsByHitKey?: Record<string, string[]>;
  disabledHitKeys?: string[];
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
  damageBonus?: ZoneCalculationResult;
  amplify?: ZoneCalculationResult;
  fragile?: ZoneCalculationResult;
  vulnerability?: ZoneCalculationResult;
  skillMultiplier?: ZoneCalculationResult;
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
  isDisabled: boolean;
  appliedBuffs: SkillButtonBuff[];
  panel: SkillDamagePanel;
  zones: DamageZones;
  buffContributions?: HitBuffZoneResults['contributions'];
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
  isDisabled: boolean;
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
  isDisabled: boolean;
}

export interface AppliedBuffTagViewModel {
  id: string;
  label: string;
  displayLabel?: string;
  sourceName: string;
  type?: string;
  value?: number;
  effectiveValue?: number;
  runtimeCoefficient?: number;
  multiplierCoefficient?: number;
  isMultiplier?: boolean;
  stackCount?: number;
  maxStacks?: number;
  isCountable?: boolean;
}

export interface FormulaViewModel {
  title: string;
  panelLines: string[];
  buffTags: AppliedBuffTagViewModel[];
  showNoBuff: boolean;
  baseMultiplierText: string;
  multiplierFormulaText: string;
  formulaText: string;
  elementBonusText: string;
  skillBonusText: string;
  allDamageBonusText: string;
  damageBonusRateText: string;
  damageBonusFormulaText: string;
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
