/**
 * 技能按钮伤害计算器 (Hit 主导版本)
 * 纯计算层，不依赖 React、DOM、Storage、事件
 * 负责 per-hit Buff 过滤、倍率计算、hit 计算、总伤害计算
 */

import { SkillButtonBuff } from '../../types/storage';
import { RuntimeOperatorTemplateHit } from '../templates/operatorTemplate';
import {
  BuffCalculationResult,
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateSkillDmgBonus,
  calculateFragileRate,
  calculateVulnerabilityRate,
  calculateAmplifyRate,
  ELEMENT_LABELS,
} from './buffCalculator';

export type { BuffCalculationResult };
export { ELEMENT_LABELS };

/**
 * 伤害拆解
 */
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

/**
 * 单段 hit 伤害计算结果
 */
export interface HitDamageResult {
  /** 对应的 hit 模板 */
  hit: RuntimeOperatorTemplateHit;
  /** 该 hit 命中的 Buff 列表 */
  appliedBuffs: SkillButtonBuff[];
  /** 该 hit 的 Buff 汇总结果 */
  buffTotals: BuffCalculationResult;
  /** 元素伤害加成 */
  elementDmgBonus: number;
  /** 技能伤害加成 */
  skillDmgBonus: number;
  /** 所有伤害加成 */
  allDmgBonus: number;
  /** 伤害加成区倍率 */
  damageBonusRate: number;
  /** 增幅区倍率 */
  amplifyRate: number;
  /** 脆弱区倍率 */
  fragileRate: number;
  /** 易伤区倍率 */
  vulnerabilityRate: number;
  /** 连击区倍率 */
  comboDamageBonus: number;
  /** 防御区倍率 */
  defenseZone: number;
  /** 非暴击伤害 */
  nonCrit: DamageBreakdown;
  /** 暴击伤害 */
  crit: DamageBreakdown;
  /** 期望伤害 */
  expected: DamageBreakdown;
}

/**
 * 技能按钮伤害计算输入 (Hit 主导)
 */
export interface SkillButtonDamageInput {
  /** Buff 列表 */
  buffList: SkillButtonBuff[];
  /** hit 列表（从运行时模板获取） */
  hits: RuntimeOperatorTemplateHit[];
  /** 面板数据 */
  panelData: {
    atk: number;
    critRate: number;
    critDmg: number;
    physicalDmgBonus: number;
    fireDmgBonus: number;
    electricDmgBonus: number;
    iceDmgBonus: number;
    natureDmgBonus: number;
    skillDmgBonus: number;
    chainSkillDmgBonus: number;
    ultimateDmgBonus: number;
    allSkillDmgBonus: number;
    allDmgBonus: number;
  };
  /** infoSnap 伤害加成数据 */
  infoSnap: Record<string, number>;
}

/**
 * 技能按钮伤害计算结果 (Hit 主导)
 */
export interface SkillButtonDamageResult {
  /** 每段 hit 的完整计算结果 */
  hits: HitDamageResult[];
  /** 汇总数据 */
  summary: {
    /** 总期望伤害 */
    totalExpected: number;
    /** 总暴击伤害 */
    totalCrit: number;
    /** 总非暴击伤害 */
    totalNonCrit: number;
  };
}

/**
 * 判断 Buff 是否作用于指定 hit
 * @param buff - Buff
 * @param hit - hit 模板
 * @returns 是否匹配
 */
export function doesBuffApplyToHit(
  buff: SkillButtonBuff,
  hit: RuntimeOperatorTemplateHit
): boolean {
  const target = buff.target;

  // 无 target 或 mode: 'all' 表示作用于所有 hit
  if (!target || target.mode === 'all') {
    return true;
  }

  switch (target.mode) {
    case 'damageKey':
      // 匹配 hit key，如 'hit2'
      return hit.key === target.key;
    case 'skillType':
      // 匹配 skillType，如 'A', 'B', 'E', 'Q'
      return hit.skillType === target.skillType;
    case 'element':
      // 匹配元素
      return hit.element === target.element;
    default:
      return true;
  }
}

/**
 * 过滤作用于指定 hit 的 Buff 列表
 * @param hit - hit 模板
 * @param buffList - 完整 Buff 列表
 * @returns 该 hit 命中的 Buff 列表
 */
export function filterBuffsForHit(
  hit: RuntimeOperatorTemplateHit,
  buffList: SkillButtonBuff[]
): SkillButtonBuff[] {
  return buffList.filter(buff => doesBuffApplyToHit(buff, hit));
}

/**
 * 计算单段 hit 伤害
 * @param panelAtk 面板攻击力
 * @param multiplierValue 倍率值
 * @param critMultiplier 暴击倍率
 * @param damageBonusRate 伤害加成区
 * @param defenseZone 防御区
 * @param amplifyRate 增幅区
 * @param fragileRate 脆弱区
 * @param vulnerabilityRate 易伤区
 * @param comboDamageBonus 连击区
 * @returns 伤害拆解
 */
function calculateHitDamage(
  panelAtk: number,
  multiplierValue: number,
  critMultiplier: number,
  damageBonusRate: number,
  defenseZone: number,
  amplifyRate: number,
  fragileRate: number,
  vulnerabilityRate: number,
  comboDamageBonus: number
): DamageBreakdown {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critMultiplier;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterAmplify = afterDefense * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  const final = afterVulnerability * (1 + comboDamageBonus);
  return { base, afterCrit, afterBonus, afterDefense, afterAmplify, afterFragile, afterVulnerability, final };
}

/**
 * 应用倍率类 Buff 到 hit
 * 先加后乘
 * @param baseMultiplier 基础倍率
 * @param buffTotals Buff 汇总
 * @returns 最终倍率
 */
function applyMultiplierBuffToHit(
  baseMultiplier: number,
  buffTotals: BuffCalculationResult
): number {
  const afterAdd = baseMultiplier + buffTotals.multiplierBonus;
  const afterMultiply = afterAdd * buffTotals.multiplierMultiplier;
  return afterMultiply;
}

/**
 * 计算单段 hit 的完整伤害
 * @param hit - hit 模板
 * @param buffList - 完整 Buff 列表
 * @param panelData - 面板数据
 * @param infoSnap - infoSnap 数据
 * @returns hit 计算结果
 */
function calculateSingleHit(
  hit: RuntimeOperatorTemplateHit,
  buffList: SkillButtonBuff[],
  panelData: SkillButtonDamageInput['panelData'],
  infoSnap: Record<string, number>
): HitDamageResult {
  // 1. 过滤该 hit 命中的 Buff
  const appliedBuffs = filterBuffsForHit(hit, buffList);

  // 2. 计算该 hit 的 Buff 汇总
  const buffTotals = calculateBuffTotals(appliedBuffs);

  // 3. 计算元素伤害加成
  const elementDmgBonus = calculateElementDmgBonus(
    hit.element,
    infoSnap,
    buffTotals
  );

  // 4. 计算技能伤害加成
  const skillDmgBonus = calculateSkillDmgBonus(
    hit.skillType,
    infoSnap,
    buffTotals
  );

  // 5. 计算所有伤害加成
  const allDmgBonus = infoSnap.allDmgBonus + buffTotals.allElementDmgBonus;

  // 6. 计算伤害加成区
  const damageBonusRate = 1 + elementDmgBonus + skillDmgBonus + allDmgBonus;

  // 7. 计算暴击期望
  const critRate = panelData.critRate;
  const critDmg = panelData.critDmg;
  const critExpected = 1 + critRate * critDmg;

  // 8. 计算增幅区
  const amplifyRate = calculateAmplifyRate(hit.element, buffTotals);

  // 9. 计算脆弱区
  const fragileRate = calculateVulnerabilityRate(hit.element, buffTotals);

  // 10. 计算易伤区
  const vulnerabilityRate = calculateFragileRate(hit.element, buffTotals);

  // 11. 连击区
  const comboDamageBonus = buffTotals.comboDamageBonus;

  // 12. 防御区
  const defenseZone = 0.5;

  // 13. 应用倍率类 Buff（先加后乘）
  const finalMultiplier = applyMultiplierBuffToHit(hit.multiplier, buffTotals);

  // 14. 计算三种伤害
  const nonCrit = calculateHitDamage(
    panelData.atk, finalMultiplier, 1, damageBonusRate,
    defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
  );
  const crit = calculateHitDamage(
    panelData.atk, finalMultiplier, 1 + critDmg, damageBonusRate,
    defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
  );
  const expected = calculateHitDamage(
    panelData.atk, finalMultiplier, critExpected, damageBonusRate,
    defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
  );

  return {
    hit,
    appliedBuffs,
    buffTotals,
    elementDmgBonus,
    skillDmgBonus,
    allDmgBonus,
    damageBonusRate,
    amplifyRate,
    fragileRate,
    vulnerabilityRate,
    comboDamageBonus,
    defenseZone,
    nonCrit,
    crit,
    expected,
  };
}

/**
 * 计算技能按钮伤害 (Hit 主导)
 * 主入口函数
 * @param input 计算输入
 * @returns 计算结果
 */
export function calculateSkillButtonDamage(
  input: SkillButtonDamageInput
): SkillButtonDamageResult {
  const { buffList, hits, panelData, infoSnap } = input;

  // 计算每段 hit
  const hitResults: HitDamageResult[] = hits.map(hit =>
    calculateSingleHit(hit, buffList, panelData, infoSnap)
  );

  // 汇总总伤害
  const totalExpected = hitResults.reduce((sum, r) => sum + r.expected.final, 0);
  const totalCrit = hitResults.reduce((sum, r) => sum + r.crit.final, 0);
  const totalNonCrit = hitResults.reduce((sum, r) => sum + r.nonCrit.final, 0);

  return {
    hits: hitResults,
    summary: {
      totalExpected,
      totalCrit,
      totalNonCrit,
    },
  };
}


