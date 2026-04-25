/**
 * 技能按钮伤害计算器
 * 纯计算层，不依赖 React、DOM、Storage、事件
 * 负责 Buff 汇总、倍率计算、hit 计算、总伤害计算
 */

import { SkillButtonBuff } from '../../types/storage';
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
 * 技能按钮伤害计算输入
 */
export interface SkillButtonDamageInput {
  /** Buff 列表 */
  buffList: SkillButtonBuff[];
  /** 角色元素属性 */
  characterElement?: string;
  /** 技能类型 (A/B/E/Q) */
  skillType: string;
  /** 技能等级键 (9/M3) */
  levelKey: string;
  /** 技能伤害倍率数据 */
  damage: Record<string, number>;
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
 * 单段 hit 计算结果
 */
export interface HitResult {
  key: string;
  index: number;
  nonCrit: DamageBreakdown;
  crit: DamageBreakdown;
  expected: DamageBreakdown;
}

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
 * 技能按钮伤害计算结果
 */
export interface SkillButtonDamageResult {
  /** Buff 汇总结果 */
  buffTotals: BuffCalculationResult;
  /** 元素伤害加成 */
  elementDmgBonus: number;
  /** 技能伤害加成 */
  skillDmgBonus: number;
  /** 所有伤害加成 */
  allDmgBonus: number;
  /** 伤害加成区倍率 */
  damageBonusRate: number;
  /** 暴击率 */
  critRate: number;
  /** 暴击伤害 */
  critDmg: number;
  /** 暴击期望倍率 */
  critExpected: number;
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
  /** 每段 hit 计算结果 */
  hitResults: HitResult[];
  /** 总伤害（期望） */
  totalExpected: number;
  /** 总伤害（暴击） */
  totalCrit: number;
  /** 总伤害（非暴击） */
  totalNonCrit: number;
  /** 处理后的伤害倍率数据 */
  processedDamage: Record<string, number>;
  /** 是否为物理属性 */
  isPhysical: boolean;
}

/**
 * 计算单段 hit 伤害
 * @param panelAtk 面板攻击力
 * @param multiplierValue 倍率值
 * @param critMultiplier 暴击倍率
 * @param damageBonusRate 伤害加成区
 * @param defenseZone 防御区
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
 * 处理伤害倍率（先加后乘）
 * @param damage 原始伤害倍率数据
 * @param multiplierBonus 倍率加法加成
 * @param multiplierMultiplier 倍率乘法加成
 * @returns 处理后的伤害倍率
 */
function processDamageMultiplier(
  damage: Record<string, number>,
  multiplierBonus: number,
  multiplierMultiplier: number
): Record<string, number> {
  const processedDamage = { ...damage };
  const hitKeys = Object.keys(damage).filter(k =>
    !k.endsWith('Imbalance') && (
      k.startsWith('hit') ||
      k === 'damage' ||
      k === 'phantomDamage' ||
      k === 'spikeDamage' ||
      k === 'slashDamage' ||
      k === 'slashBaseDamage'
    )
  );

  if (hitKeys.length > 0) {
    const lastHitKey = hitKeys[hitKeys.length - 1];
    const originalHitValue = damage[lastHitKey];
    // 先加后乘
    const afterAdd = originalHitValue + multiplierBonus;
    const afterMultiply = afterAdd * multiplierMultiplier;
    processedDamage[lastHitKey] = afterMultiply;
  }

  return processedDamage;
}

/**
 * 计算技能按钮伤害
 * 主入口函数
 * @param input 计算输入
 * @returns 计算结果
 */
export function calculateSkillButtonDamage(
  input: SkillButtonDamageInput
): SkillButtonDamageResult {
  const {
    buffList,
    characterElement,
    skillType,
    panelData,
    infoSnap,
    damage,
  } = input;

  // 1. 计算 Buff 汇总
  const buffTotals = calculateBuffTotals(buffList);

  // 2. 计算元素伤害加成
  const elementDmgBonus = calculateElementDmgBonus(
    characterElement,
    infoSnap,
    buffTotals
  );

  // 3. 计算技能伤害加成
  const skillDmgBonus = calculateSkillDmgBonus(
    skillType,
    infoSnap,
    buffTotals
  );

  // 4. 计算所有伤害加成
  const allDmgBonus = infoSnap.allDmgBonus + buffTotals.allElementDmgBonus;

  // 5. 计算伤害加成区 = 1 + 元素 + 技能 + 所有伤害
  const damageBonusRate = 1 + elementDmgBonus + skillDmgBonus + allDmgBonus;

  // 6. 计算暴击期望
  const critRate = panelData.critRate + buffTotals.critRateBoost;
  const critDmg = panelData.critDmg + buffTotals.critDmgBonusBoost;
  const critExpected = 1 + critRate * critDmg;

  // 7. 计算增幅区
  const amplifyRate = calculateAmplifyRate(characterElement, buffTotals);

  // 8. 计算脆弱区
  const fragileRate = calculateVulnerabilityRate(characterElement, buffTotals);

  // 9. 计算易伤区
  const vulnerabilityRate = calculateFragileRate(characterElement, buffTotals);

  // 10. 连击区
  const comboDamageBonus = buffTotals.comboDamageBonus;

  // 10. 防御区
  const defenseZone = 0.5;

  // 11. 处理伤害倍率（先加后乘）
  const processedDamage = processDamageMultiplier(
    damage,
    buffTotals.multiplierBonus,
    buffTotals.multiplierMultiplier
  );

  // 12. 获取 hit 键列表
  const hitKeys = Object.keys(damage).filter(k =>
    !k.endsWith('Imbalance') && (
      k.startsWith('hit') ||
      k === 'damage' ||
      k === 'phantomDamage' ||
      k === 'spikeDamage' ||
      k === 'slashDamage' ||
      k === 'slashBaseDamage'
    )
  );

  // 13. 计算每段 hit
  const hitResults: HitResult[] = hitKeys.map((key, idx) => {
    const value = processedDamage[key];
    if (typeof value !== 'number') return null as unknown as HitResult;

    const nonCrit = calculateHitDamage(
      panelData.atk, value, 1, damageBonusRate,
      defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
    );
    const crit = calculateHitDamage(
      panelData.atk, value, 1 + critDmg, damageBonusRate,
      defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
    );
    const expected = calculateHitDamage(
      panelData.atk, value, critExpected, damageBonusRate,
      defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus
    );

    return { key, index: idx + 1, nonCrit, crit, expected };
  }).filter(Boolean) as HitResult[];

  // 14. 计算总伤害
  const totalExpected = hitResults.reduce((sum, r) => sum + r.expected.final, 0);
  const totalCrit = hitResults.reduce((sum, r) => sum + r.crit.final, 0);
  const totalNonCrit = hitResults.reduce((sum, r) => sum + r.nonCrit.final, 0);

  // 15. 判断是否为物理属性
  const isPhysical = characterElement === 'physical';

  return {
    buffTotals,
    elementDmgBonus,
    skillDmgBonus,
    allDmgBonus,
    damageBonusRate,
    critRate,
    critDmg,
    critExpected,
    amplifyRate,
    fragileRate,
    vulnerabilityRate,
    comboDamageBonus,
    defenseZone,
    hitResults,
    totalExpected,
    totalCrit,
    totalNonCrit,
    processedDamage,
    isPhysical,
  };
}
