/**
 * Buff 计算模块
 * 纯计算层，不依赖 React、DOM、Storage
 * 负责 Buff 汇总、元素加成、技能加成、脆弱/易伤计算
 */

import { HitResistanceInput, SkillButtonBuff } from '../../types/storage';

/**
 * Buff 汇总计算结果
 * 用于伤害计算，所有值为原始小数（0.32 表示 32%）
 */
export interface BuffCalculationResult {
  // 攻击力乘区
  atkPercentBoost: number;   // 总攻击力百分比提升
  flatAtk: number;           // 总固定攻击力
  mainStat: number;           // 总主属性固定提升
  subStat: number;            // 总副属性固定提升
  mainStatBoost: number;      // 总主属性提升
  subStatBoost: number;       // 总副属性提升
  allStatBoost: number;       // 总全属性提升
  strengthBoost: number;      // 总力量提升
  agilityBoost: number;       // 总敏捷提升
  intelligenceBoost: number;  // 总智识提升
  willBoost: number;          // 总意志提升

  // 伤害加成区
  physicalDmgBonus: number;   // 总物理伤害加成
  magicDmgBonus: number;      // 总法术伤害加成
  fireDmgBonus: number;       // 总灼热伤害加成
  electricDmgBonus: number;   // 总电磁伤害加成
  iceDmgBonus: number;        // 总寒冷伤害加成
  natureDmgBonus: number;      // 总自然伤害加成
  allDmgBonus: number;         // 总全伤害加成
  allElementDmgBonus: number; // 总全元素伤害加成
  skillDmgBonus: number;      // 总战技伤害加成
  chainSkillDmgBonus: number; // 总连携技伤害加成
  ultimateDmgBonus: number;   // 总终结技伤害加成
  normalAttackDmgBonus: number; // 总普攻伤害加成
  dotDmgBonus: number; // 总持续伤害加成
  allSkillDmgBonus: number; // 总所有技能伤害加成
  
  // 暴击区
  critRateBoost: number;     // 总暴击率提升
  critDmgBonusBoost: number;  // 总暴击伤害提升

  // 易伤区（Fragile）
  physicalFragile: number;   // 总物伤易伤
  fireFragile: number;        // 总灼热易伤
  electricFragile: number;   // 总电磁易伤
  iceFragile: number;        // 总寒冷易伤
  natureFragile: number;      // 总自然易伤
  magicFragile: number;      // 总法术易伤

  // 脆弱区（Vulnerability）
  physicalVulnerability: number;   // 总物理脆弱
  fireVulnerability: number;        // 总灼热脆弱
  electricVulnerability: number;   // 总电磁脆弱
  iceVulnerability: number;        // 总寒冷脆弱
  natureVulnerability: number;      // 总自然脆弱
  magicVulnerability: number;     // 总法术脆弱

  // 增幅区（Amplify）
  physicalAmplify: number;        // 总物理增幅
  magicAmplify: number;           // 总法术增幅
  fireAmplify: number;            // 总灼热增幅
  electricAmplify: number;        // 总电磁增幅
  iceAmplify: number;             // 总寒冷增幅
  natureAmplify: number;          // 总自然增幅

  // 抗性区（点数，进入公式时 /100）
  allCorrosion: number;
  physicalCorrosion: number;
  magicCorrosion: number;
  fireCorrosion: number;
  electricCorrosion: number;
  iceCorrosion: number;
  natureCorrosion: number;
  allResistanceIgnore: number;
  physicalResistanceIgnore: number;
  magicResistanceIgnore: number;
  fireResistanceIgnore: number;
  electricResistanceIgnore: number;
  iceResistanceIgnore: number;
  natureResistanceIgnore: number;

  // 连击区（独立区域）
  comboDamageBonus: number;        // 总连击增伤
  imbalanceDamageBonus: number;    // 总失衡增伤

  // 伤害倍率区
  multiplierBonus: number;       // 总伤害倍率提升（加法）
  multiplierMultiplier: number;   // 总伤害倍率乘倍（乘法，初始为 1）

  // 其他
  sourceSkillBoost: number;   // 总源石技艺强度提升
}

/**
 * 元素类型标签映射
 * 用于显示元素名称
 */
export const ELEMENT_LABELS: Record<string, string> = {
  ice: '寒冷',
  fire: '灼热',
  electric: '电磁',
  physical: '物理',
  nature: '自然',
  magic: '法术',
};

/**
 * 从 Buff 列表汇总计算各区加成
 * @param buffs - 已选 Buff 列表
 * @returns Buff 汇总计算结果
 */
function normalizeBuffCategory(category: unknown): 'condition' | 'countable' | 'passive' {
  if (category === 'countable' || category === 'passive' || category === 'condition') return category;
  if (category === 'positive') return 'passive';
  return 'condition';
}

function normalizeMaxStacks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function getBuffEffectiveValue(buff: SkillButtonBuff, stackCounts: Record<string, number> = {}): number {
  const baseValue = typeof buff.value === 'number' && Number.isFinite(buff.value) ? buff.value : 0;
  if (normalizeBuffCategory(buff.category) !== 'countable') {
    return baseValue;
  }
  const maxStacks = normalizeMaxStacks(buff.maxStacks);
  const rawStackCount = stackCounts[buff.id];
  const stackCount = typeof rawStackCount === 'number' && Number.isFinite(rawStackCount)
    ? Math.min(Math.max(Math.floor(rawStackCount), 0), maxStacks)
    : maxStacks;
  return baseValue * stackCount;
}

export function calculateBuffTotals(buffs: SkillButtonBuff[], stackCounts: Record<string, number> = {}): BuffCalculationResult {
  // 初始化结果，所有值默认为 0（乘法类初始为 1）
  const result: BuffCalculationResult = {
    atkPercentBoost: 0,
    flatAtk: 0,
    mainStat: 0,
    subStat: 0,
    mainStatBoost: 0,
    subStatBoost: 0,
    allStatBoost: 0,
    strengthBoost: 0,
    agilityBoost: 0,
    intelligenceBoost: 0,
    willBoost: 0,
    physicalDmgBonus: 0,
    magicDmgBonus: 0,
    fireDmgBonus: 0,
    electricDmgBonus: 0,
    iceDmgBonus: 0,
    natureDmgBonus: 0,
    allDmgBonus: 0,
    allElementDmgBonus: 0,
    skillDmgBonus: 0,
    chainSkillDmgBonus: 0,
    ultimateDmgBonus: 0,
    normalAttackDmgBonus: 0,
    dotDmgBonus: 0,
    allSkillDmgBonus: 0,
    critRateBoost: 0,
    critDmgBonusBoost: 0,
    // 易伤区
    physicalFragile: 0,
    fireFragile: 0,
    electricFragile: 0,
    iceFragile: 0,
    natureFragile: 0,
    magicFragile: 0,
    // 脆弱区
    physicalVulnerability: 0,
    fireVulnerability: 0,
    electricVulnerability: 0,
    iceVulnerability: 0,
    natureVulnerability: 0,
    magicVulnerability: 0,
    // 增幅区
    physicalAmplify: 0,
    magicAmplify: 0,
    fireAmplify: 0,
    electricAmplify: 0,
    iceAmplify: 0,
    natureAmplify: 0,
    allCorrosion: 0,
    physicalCorrosion: 0,
    magicCorrosion: 0,
    fireCorrosion: 0,
    electricCorrosion: 0,
    iceCorrosion: 0,
    natureCorrosion: 0,
    allResistanceIgnore: 0,
    physicalResistanceIgnore: 0,
    magicResistanceIgnore: 0,
    fireResistanceIgnore: 0,
    electricResistanceIgnore: 0,
    iceResistanceIgnore: 0,
    natureResistanceIgnore: 0,
    // 连击区
    comboDamageBonus: 0,
    imbalanceDamageBonus: 0,
    // 伤害倍率区
    multiplierBonus: 0,
    multiplierMultiplier: 1,  // 乘法初始为 1
    sourceSkillBoost: 0,
  };

  buffs.forEach(buff => {
    if (buff.multiplier) return;
    if (buff.type && buff.value !== undefined) {
      const v = getBuffEffectiveValue(buff, stackCounts);
      switch (buff.type) {
        case 'atkPercentBoost': result.atkPercentBoost += v; break;
        case 'flatAtk': result.flatAtk += v; break;
        case 'mainStat': result.mainStat += v; break;
        case 'subStat': result.subStat += v; break;
        case 'mainStatBoost': result.mainStatBoost += v; break;
        case 'subStatBoost': result.subStatBoost += v; break;
        case 'allStatBoost': result.allStatBoost += v; break;
        case 'strengthBoost': result.strengthBoost += v; break;
        case 'agilityBoost': result.agilityBoost += v; break;
        case 'intelligenceBoost': result.intelligenceBoost += v; break;
        case 'willBoost': result.willBoost += v; break;
        case 'physicalDmgBonus': result.physicalDmgBonus += v; break;
        case 'magicDmgBonus': result.magicDmgBonus += v; break;
        case 'fireDmgBonus': result.fireDmgBonus += v; break;
        case 'electricDmgBonus': result.electricDmgBonus += v; break;
        case 'iceDmgBonus': result.iceDmgBonus += v; break;
        case 'natureDmgBonus': result.natureDmgBonus += v; break;
        case 'allDmgBonus': result.allDmgBonus += v; break;
        case 'allElementDmgBonus': result.magicDmgBonus += v; break;
        case 'skillDmgBonus': result.skillDmgBonus += v; break;
        case 'chainSkillDmgBonus': result.chainSkillDmgBonus += v; break;
        case 'ultimateDmgBonus': result.ultimateDmgBonus += v; break;
        case 'normalAttackDmgBonus': result.normalAttackDmgBonus += v; break;
        case 'dotDmgBonus': result.dotDmgBonus += v; break;
        case 'allSkillDmgBonus': result.allSkillDmgBonus += v; break;
        case 'critRateBoost': result.critRateBoost += v; break;
        case 'critDmgBonusBoost': result.critDmgBonusBoost += v; break;
        case 'physicalFragile': result.physicalFragile += v; break;
        case 'fireFragile': result.fireFragile += v; break;
        case 'electricFragile': result.electricFragile += v; break;
        case 'iceFragile': result.iceFragile += v; break;
        case 'natureFragile': result.natureFragile += v; break;
        case 'magicFragile': result.magicFragile += v; break;
        case 'physicalVulnerability': result.physicalVulnerability += v; break;
        case 'fireVulnerability': result.fireVulnerability += v; break;
        case 'electricVulnerability': result.electricVulnerability += v; break;
        case 'iceVulnerability': result.iceVulnerability += v; break;
        case 'natureVulnerability': result.natureVulnerability += v; break;
        case 'magicVulnerability': result.magicVulnerability += v; break;
        case 'physicalAmplify': result.physicalAmplify += v; break;
        case 'magicAmplify': result.magicAmplify += v; break;
        case 'fireAmplify': result.fireAmplify += v; break;
        case 'electricAmplify': result.electricAmplify += v; break;
        case 'iceAmplify': result.iceAmplify += v; break;
        case 'natureAmplify': result.natureAmplify += v; break;
        case 'allCorrosion': result.allCorrosion += v; break;
        case 'physicalCorrosion': result.physicalCorrosion += v; break;
        case 'magicCorrosion': result.magicCorrosion += v; break;
        case 'fireCorrosion': result.fireCorrosion += v; break;
        case 'electricCorrosion': result.electricCorrosion += v; break;
        case 'iceCorrosion': result.iceCorrosion += v; break;
        case 'natureCorrosion': result.natureCorrosion += v; break;
        case 'allResistanceIgnore': result.allResistanceIgnore += v; break;
        case 'physicalResistanceIgnore': result.physicalResistanceIgnore += v; break;
        case 'magicResistanceIgnore': result.magicResistanceIgnore += v; break;
        case 'fireResistanceIgnore': result.fireResistanceIgnore += v; break;
        case 'electricResistanceIgnore': result.electricResistanceIgnore += v; break;
        case 'iceResistanceIgnore': result.iceResistanceIgnore += v; break;
        case 'natureResistanceIgnore': result.natureResistanceIgnore += v; break;
        case 'comboDamageBonus': result.comboDamageBonus += v; break;
        case 'imbalanceDmgBonus': result.imbalanceDamageBonus += v; break;
        case 'multiplierBonus': result.multiplierBonus += v; break;
        case 'multiplierMultiplier': result.multiplierMultiplier *= v || 1; break;
        case 'sourceSkillBoost': result.sourceSkillBoost += v; break;
      }
    }
  });

  return result;
}

type AbilityField = 'strength' | 'agility' | 'intelligence' | 'will';

export interface BuffPanelBase {
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
  mainStatRaw?: number;
  subStatRaw?: number;
  mainStatField?: AbilityField;
  subStatField?: AbilityField;
  mainStatScale?: number;
  subStatScale?: number;
  allStatScale?: number;
}

export interface AbilityStatCalculationTrace {
  field: AbilityField;
  panelValue: number;
  rawValue: number;
  directionalFlatBoost: number;
  baseStatScale: number;
  statBuffRate: number;
  statAdditiveRate: number;
  baseAllStatScale: number;
  allStatBuffRate: number;
  allStatAdditiveRate: number;
  directionalMultiplier: number;
  statMultiplier: number;
  allStatMultiplier: number;
  valueBeforeRounding: number;
  finalValue: number;
  attackCoefficient: number;
  attackBonus: number;
}

export interface BuffedPanelCalculationTrace {
  rawAtk: number;
  characterAtk: number;
  weaponAtk: number;
  weaponAtkRate: number;
  atkPercentBoost: number;
  flatAtk: number;
  fixedAtk: number;
  attackBaseAfterBuff: number;
  mainAbility?: AbilityStatCalculationTrace;
  subAbility?: AbilityStatCalculationTrace;
  fallbackAbilityBonus: number;
  abilityBonus: number;
  finalAtk: number;
  critRate: number;
  critDmg: number;
}

export function calculateBuffedPanelTrace(
  panelBase: BuffPanelBase,
  buffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {},
): BuffedPanelCalculationTrace {
  const totals = calculateBuffTotals(buffs, stackCounts);
  const currentAtkPercent = panelBase.weaponAtkPercent * 0.01;
  const rawAtk = panelBase.characterAtk + panelBase.weaponAtk;
  const fixedAtk = panelBase.baseAtk - rawAtk * (1 + currentAtkPercent);
  const nextBaseAtk = rawAtk * (1 + currentAtkPercent + totals.atkPercentBoost) + fixedAtk;

  const fallbackAbilityBonus = panelBase.abilityBonus * 0.01;
  let abilityBonus = fallbackAbilityBonus;
  let mainAbility: AbilityStatCalculationTrace | undefined;
  let subAbility: AbilityStatCalculationTrace | undefined;
  const mainField = panelBase.mainStatField;
  const subField = panelBase.subStatField;
  if (mainField && subField && typeof panelBase.mainStatFinal === 'number' && typeof panelBase.subStatFinal === 'number') {
    const flatBoosts: Record<AbilityField, number> = {
      strength: totals.strengthBoost,
      agility: totals.agilityBoost,
      intelligence: totals.intelligenceBoost,
      will: totals.willBoost,
    };
    flatBoosts[mainField] += totals.mainStat;
    flatBoosts[subField] += totals.subStat;
    const hasExactScaleMetadata = typeof panelBase.mainStatScale === 'number'
      && typeof panelBase.subStatScale === 'number'
      && typeof panelBase.allStatScale === 'number';
    const mainScale = panelBase.mainStatScale ?? 0;
    const subScale = panelBase.subStatScale ?? 0;
    const allScale = panelBase.allStatScale ?? 0;
    const mainBaseScale = (1 + mainScale) * (1 + allScale);
    const subBaseScale = (1 + subScale) * (1 + allScale);
    const rawMain = typeof panelBase.mainStatRaw === 'number'
      ? panelBase.mainStatRaw
      : hasExactScaleMetadata && mainBaseScale !== 0
      ? panelBase.mainStatFinal / mainBaseScale
      : panelBase.mainStatFinal;
    const rawSub = typeof panelBase.subStatRaw === 'number'
      ? panelBase.subStatRaw
      : hasExactScaleMetadata && subBaseScale !== 0
      ? panelBase.subStatFinal / subBaseScale
      : panelBase.subStatFinal;
    const abilityMultiplierProducts: Record<AbilityField, number> = {
      strength: 1,
      agility: 1,
      intelligence: 1,
      will: 1,
    };
    let mainStatMultiplierProduct = 1;
    let subStatMultiplierProduct = 1;
    let allStatMultiplierProduct = 1;
    buffs.forEach((buff) => {
      const coefficient = buff.multiplier?.coefficient;
      if (!buff.type || typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient <= 0) {
        return;
      }
      if (buff.type === 'mainStatBoost') mainStatMultiplierProduct *= coefficient;
      if (buff.type === 'subStatBoost') subStatMultiplierProduct *= coefficient;
      if (buff.type === 'allStatBoost') allStatMultiplierProduct *= coefficient;
      if (buff.type === 'strengthBoost') abilityMultiplierProducts.strength *= coefficient;
      if (buff.type === 'agilityBoost') abilityMultiplierProducts.agility *= coefficient;
      if (buff.type === 'intelligenceBoost') abilityMultiplierProducts.intelligence *= coefficient;
      if (buff.type === 'willBoost') abilityMultiplierProducts.will *= coefficient;
    });
    const nextMainBeforeRounding = (rawMain + flatBoosts[mainField])
      * (hasExactScaleMetadata ? 1 + mainScale + totals.mainStatBoost : 1 + totals.mainStatBoost)
      * (hasExactScaleMetadata ? 1 + allScale + totals.allStatBoost : 1 + totals.allStatBoost)
      * abilityMultiplierProducts[mainField]
      * mainStatMultiplierProduct
      * allStatMultiplierProduct;
    const nextSubBeforeRounding = (rawSub + flatBoosts[subField])
      * (hasExactScaleMetadata ? 1 + subScale + totals.subStatBoost : 1 + totals.subStatBoost)
      * (hasExactScaleMetadata ? 1 + allScale + totals.allStatBoost : 1 + totals.allStatBoost)
      * abilityMultiplierProducts[subField]
      * subStatMultiplierProduct
      * allStatMultiplierProduct;
    const nextMain = Math.round(nextMainBeforeRounding);
    const nextSub = Math.round(nextSubBeforeRounding);
    const mainAttackCoefficient = 0.005;
    const subAttackCoefficient = 0.002;
    mainAbility = {
      field: mainField,
      panelValue: panelBase.mainStatFinal,
      rawValue: rawMain,
      directionalFlatBoost: flatBoosts[mainField],
      baseStatScale: hasExactScaleMetadata ? mainScale : 0,
      statBuffRate: totals.mainStatBoost,
      statAdditiveRate: hasExactScaleMetadata ? mainScale + totals.mainStatBoost : totals.mainStatBoost,
      baseAllStatScale: hasExactScaleMetadata ? allScale : 0,
      allStatBuffRate: totals.allStatBoost,
      allStatAdditiveRate: hasExactScaleMetadata ? allScale + totals.allStatBoost : totals.allStatBoost,
      directionalMultiplier: abilityMultiplierProducts[mainField],
      statMultiplier: mainStatMultiplierProduct,
      allStatMultiplier: allStatMultiplierProduct,
      valueBeforeRounding: nextMainBeforeRounding,
      finalValue: nextMain,
      attackCoefficient: mainAttackCoefficient,
      attackBonus: nextMain * mainAttackCoefficient,
    };
    subAbility = {
      field: subField,
      panelValue: panelBase.subStatFinal,
      rawValue: rawSub,
      directionalFlatBoost: flatBoosts[subField],
      baseStatScale: hasExactScaleMetadata ? subScale : 0,
      statBuffRate: totals.subStatBoost,
      statAdditiveRate: hasExactScaleMetadata ? subScale + totals.subStatBoost : totals.subStatBoost,
      baseAllStatScale: hasExactScaleMetadata ? allScale : 0,
      allStatBuffRate: totals.allStatBoost,
      allStatAdditiveRate: hasExactScaleMetadata ? allScale + totals.allStatBoost : totals.allStatBoost,
      directionalMultiplier: abilityMultiplierProducts[subField],
      statMultiplier: subStatMultiplierProduct,
      allStatMultiplier: allStatMultiplierProduct,
      valueBeforeRounding: nextSubBeforeRounding,
      finalValue: nextSub,
      attackCoefficient: subAttackCoefficient,
      attackBonus: nextSub * subAttackCoefficient,
    };
    abilityBonus = mainAbility.attackBonus + subAbility.attackBonus;
  }

  return {
    rawAtk,
    characterAtk: panelBase.characterAtk,
    weaponAtk: panelBase.weaponAtk,
    weaponAtkRate: currentAtkPercent,
    atkPercentBoost: totals.atkPercentBoost,
    flatAtk: totals.flatAtk,
    fixedAtk,
    attackBaseAfterBuff: nextBaseAtk,
    mainAbility,
    subAbility,
    fallbackAbilityBonus,
    abilityBonus,
    finalAtk: nextBaseAtk * (1 + abilityBonus),
    critRate: (panelBase.critRate ?? 0.05) + totals.critRateBoost,
    critDmg: (panelBase.critDmg ?? 0.5) + totals.critDmgBonusBoost,
  };
}

export function calculateBuffedPanel(
  panelBase: BuffPanelBase,
  buffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {},
): { atk: number; critRate: number; critDmg: number } {
  const trace = calculateBuffedPanelTrace(panelBase, buffs, stackCounts);
  return {
    atk: trace.finalAtk,
    critRate: trace.critRate,
    critDmg: trace.critDmg,
  };
}

export interface ResistanceZoneResult {
  baseResistance: number;
  corrosion: number;
  resistanceIgnore: number;
  effectiveResistance: number;
  resistanceZone: number;
  formulaText: string;
}

function readResistanceValue(input: HitResistanceInput | undefined, key: keyof HitResistanceInput): number {
  return input?.[key] ?? 0;
}

function readBuffTotal(buffTotals: BuffCalculationResult, key: keyof BuffCalculationResult): number {
  return (buffTotals[key] || 0) as number;
}

/**
 * 根据命中元素计算抗性区。
 * 抗性、降抗、无视抗性内部单位均为“点”，每点对应 1%。
 */
export function calculateResistanceZone(
  characterElement: string | undefined,
  resistanceInput: HitResistanceInput | undefined,
  buffTotals: BuffCalculationResult
): ResistanceZoneResult {
  const element = characterElement || 'physical';
  let baseResistance = 0;
  let corrosion = 0;
  let resistanceIgnore = 0;

  const addCorrosion = (prefix: 'physical' | 'magic' | 'fire' | 'electric' | 'ice' | 'nature') => {
    corrosion += readBuffTotal(buffTotals, `${prefix}Corrosion` as keyof BuffCalculationResult);
  };
  const addIgnore = (prefix: 'physical' | 'magic' | 'fire' | 'electric' | 'ice' | 'nature') => {
    resistanceIgnore += readBuffTotal(buffTotals, `${prefix}ResistanceIgnore` as keyof BuffCalculationResult);
  };

  corrosion += readBuffTotal(buffTotals, 'allCorrosion');
  resistanceIgnore += readBuffTotal(buffTotals, 'allResistanceIgnore');
  if (element === 'physical') {
    baseResistance = readResistanceValue(resistanceInput, 'physicalResistance');
    addCorrosion('physical');
    addIgnore('physical');
  } else if (element === 'fire' || element === 'electric' || element === 'ice' || element === 'nature') {
    baseResistance = readResistanceValue(resistanceInput, `${element}Resistance` as keyof HitResistanceInput);
    addCorrosion('magic');
    addCorrosion(element);
    addIgnore('magic');
    addIgnore(element);
  } else {
    baseResistance = 0;
  }

  const effectiveResistance = baseResistance - corrosion;
  const resistanceZone = 1 - effectiveResistance / 100 + resistanceIgnore / 100;
  const formulaText = `1 - (${baseResistance.toFixed(1)} - ${corrosion.toFixed(1)}) / 100 + ${resistanceIgnore.toFixed(1)} / 100 = ${resistanceZone.toFixed(3)}`;

  return {
    baseResistance,
    corrosion,
    resistanceIgnore,
    effectiveResistance,
    resistanceZone,
    formulaText,
  };
}

/**
 * 根据干员元素属性和技能类型，计算伤害加成区
 * @param characterElement - 干员元素属性（如 'ice', 'physical'）
 * @param skillType - 技能类型（'A', 'B', 'E', 'Q'）
 * @param parsedDamageBonus - 从 infoSnapshot 解析的伤害加成
 * @param buffTotals - Buff 汇总结果
 * @returns 元素伤害加成值（小数）
 */
export function calculateElementDmgBonus(
  characterElement: string | undefined,
  parsedDamageBonus: Record<string, number>,
  buffTotals: BuffCalculationResult
): number {
  const isPhysical = characterElement === 'physical';

  if (isPhysical) {
    return (parsedDamageBonus.physicalDmgBonus || 0)
      + (buffTotals.physicalDmgBonus || 0);
  } else {
    const elementKey = `${characterElement}DmgBonus`;
    const elementBonusFromBuff = (buffTotals[elementKey as keyof BuffCalculationResult] || 0) as number;
    const elementBonusFromPanel = (parsedDamageBonus[elementKey] || 0) as number;

    const elementBonus =
      elementBonusFromBuff +
      (buffTotals.magicDmgBonus || 0) +
      elementBonusFromPanel +
      (parsedDamageBonus.magicDmgBonus || 0) +
      (parsedDamageBonus.allElementDmgBonus || 0);

    return elementBonus;
  }
}

/**
 * 根据技能类型，计算技能伤害加成
 * @param skillType - 技能类型
 * @param parsedDamageBonus - 从 infoSnap 解析的伤害加成（面板基础值）
 * @param buffTotals - Buff 汇总结果
 * @returns 技能伤害加成值（小数）
 */
export function calculateSkillDmgBonus(
  skillType: string,
  parsedDamageBonus: Record<string, number>,
  buffTotals: BuffCalculationResult
): number {
  switch (skillType) {
    case 'A':
      return parsedDamageBonus.normalAttackDmgBonus + buffTotals.normalAttackDmgBonus;
    case 'Dot':
      return (parsedDamageBonus.dotDmgBonus || 0) + buffTotals.dotDmgBonus;
    case 'B':
      return parsedDamageBonus.skillDmgBonus + parsedDamageBonus.allSkillDmgBonus
             + buffTotals.skillDmgBonus + buffTotals.allSkillDmgBonus;
    case 'E':
      return parsedDamageBonus.chainSkillDmgBonus + parsedDamageBonus.allSkillDmgBonus
             + buffTotals.chainSkillDmgBonus + buffTotals.allSkillDmgBonus;
    case 'Q':
      return parsedDamageBonus.ultimateDmgBonus + parsedDamageBonus.allSkillDmgBonus
             + buffTotals.ultimateDmgBonus + buffTotals.allSkillDmgBonus;
    default:
      return 0;
  }
}

/**
 * 根据干员元素属性，计算脆弱区
 * @param characterElement - 干员元素属性（如 'physical', 'ice', 'fire'）
 * @param buffTotals - Buff 汇总结果
 * @returns 脆弱区值（小数）
 */
export function calculateVulnerabilityRate(
  characterElement: string | undefined,
  buffTotals: BuffCalculationResult
): number {
  const isPhysical = characterElement === 'physical';
  if (isPhysical) {
    return buffTotals.physicalVulnerability;
  } else {
    const elementKey = `${characterElement}Vulnerability`;
    const elementVulnerability = buffTotals[elementKey as keyof BuffCalculationResult] || 0;

    return elementVulnerability + buffTotals.magicVulnerability;
  }
}

/**
 * 根据干员元素属性，计算易伤区
 * @param characterElement - 干员元素属性（如 'physical', 'ice', 'fire'）
 * @param buffTotals - Buff 汇总结果
 * @returns 易伤区值（小数）
 */
export function calculateFragileRate(
  characterElement: string | undefined,
  buffTotals: BuffCalculationResult
): number {
  const isPhysical = characterElement === 'physical';
  if (isPhysical) {
    return buffTotals.physicalFragile;
  } else {
    const elementKey = `${characterElement}Fragile`;
    const elementFragile = buffTotals[elementKey as keyof BuffCalculationResult] || 0;

    return elementFragile + buffTotals.magicFragile;
  }
}

/**
 * 根据干员元素属性，计算增幅区
 * @param characterElement - 干员元素属性（如 'physical', 'ice', 'fire'）
 * @param buffTotals - Buff 汇总结果
 * @returns 增幅区值（小数）
 */
export function calculateAmplifyRate(
  characterElement: string | undefined,
  buffTotals: BuffCalculationResult
): number {
  const isPhysical = characterElement === 'physical';
  if (isPhysical) {
    return buffTotals.physicalAmplify;
  } else {
    const elementKey = `${characterElement}Amplify`;
    const elementAmplify = buffTotals[elementKey as keyof BuffCalculationResult] || 0;

    return elementAmplify + buffTotals.magicAmplify;
  }
}
