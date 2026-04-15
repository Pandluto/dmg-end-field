/**
 * 终末地 DPS 计算器
 * 基于真实伤害公式实现
 */

// ============ 类型定义 ============

// 元素类型
export type ElementType = 'physical' | 'fire' | 'ice' | 'electric' | 'ether' | 'void';

// 伤害类型
export type DamageType = 'physical' | 'magic';

// 异常等级
export type AbnormalLevel = 1 | 2 | 3 | 4;

// 敌人抗性等级
export type EnemyResistRank = 'D' | 'C' | 'B';

// 异常类型
export type AbnormalType =
  // 法术异常
  | 'conductivity'  // 导电
  | 'corrosion'     // 腐蚀
  | 'burning'       // 燃烧
  | 'freeze'        // 冻结
  | 'shatterIce'    // 碎冰
  | 'magicBurst'    // 法术爆发
  // 物理异常
  | 'knockdown'     // 倒地
  | 'launch'        // 击飞
  | 'shatterArmor'  // 碎甲
  | 'slam';         // 猛击

// ============ 数据结构 ============

// 主属性类型
export type MainStatType = '力量' | '敏捷' | '智识' | '意志';

// 武器数据
export interface Weapon {
  name?: string;
  baseAtk: number;          // 武器基础攻击力
  atkPercent?: number;      // 武器攻击力百分比
  critRate?: number;        // 武器暴击率
  critDmg?: number;         // 武器暴击伤害
  dmgBonus?: number;        // 武器增伤
  memoryStrength?: number;   // 武器源石技艺强度
  mainStat?: number;        // 武器主属性值
  mainStatType?: MainStatType; // 武器主属性类型
  subStat?: number;         // 武器副属性值
}

// 珠子（基质）编码
// 例如: "663" 表示敏捷提升·大:6级, 攻击提升·大:6级, 附术·长愿:3级
export type MatrixCode = string;

// 珠子信息
export interface MatrixInfo {
  name: string;
  start: MatrixCode;
  max: MatrixCode;
  note: string;
}

// 武器技能等级范围（某阶段）
export interface SkillLevelRange {
  baseLevel: number;   // 武器提供的基础等级
  maxLevel: number;    // 该阶段上限等级
}

// 武器技能数据
export interface WeaponSkill {
  name: string;
  statType: 'agility' | 'atkPercent' | 'memoryStrength';
  phases: Record<string, SkillLevelRange>;  // 阶段 -> 等级范围
  levels: Record<string, {               // 等级 -> 效果
    value?: number;
    memoryStrength?: number;
    physicalDmgBonus?: number;
    description?: string;
  }>;
}

// 升阶段信息
export interface PhaseInfo {
  requirement: number;  // 等级需求
}

// 武器完整数据（从JSON导入）
export interface WeaponData {
  name: string;
  nameEn: string;
  rarity: number;
  type: string;
  description: string;
  remark?: string;
  attackGrowth: Record<string, number>;  // 1-90级攻击力
  phases: Record<string, PhaseInfo>;    // 0-4阶段
  matrix?: MatrixInfo;                    // 珠子信息
  skills: {
    agilityBoost: WeaponSkill;  // 敏捷提升·大
    atkBoost: WeaponSkill;      // 攻击提升·大
    longWish: WeaponSkill;      // 附术·长愿
  };
}

// 装备数据（圣遗物类）
export interface Equipment {
  name?: string;
  mainStat: number;        // 主词条数值
  subStat: number;         // 副词条数值总和
  critRate?: number;       // 暴击率
  critDmg?: number;        // 暴击伤害
  dmgBonus?: number;       // 增伤
  memoryStrength?: number; // 源石技艺强度
}

// 角色输入（包含可选的武器和装备）
export interface CharacterInput {
  name: string;
  level: number;           // 角色等级 (1-90)
  baseAtk: number;        // 角色基础攻击力
  mainStat: number;       // 角色主属性值
  subStat: number;        // 角色副属性值
  critRate: number;       // 暴击率 (0-1)
  critDmg: number;        // 暴击伤害 (1.5 = 150%)
  dmgBonus: number;       // 增伤区 (0.3 = 30%)
  element: ElementType;   // 元素类型
  memoryStrength: number; // 源石技艺强度
  weapon?: Weapon;        // 可选武器
  equipment?: Equipment;   // 可选装备
}

// 最终角色属性（计算后）
export interface Character {
  name: string;
  level: number;             // 角色等级 (1-90)
  baseAtk: number;           // 基础攻击力
  atkPercent: number;        // 额外攻击力百分比加成，不含主副属性换算
  flatAtk: number;           // 固定攻击力
  mainStat: number;          // 主属性值
  subStat: number;           // 副属性值
  critRate: number;          // 暴击率 (0-1)
  critDmg: number;           // 暴击伤害 (1.5 = 150%)
  dmgBonus: number;          // 增伤区 (0.3 = 30%)
  element: ElementType;      // 元素类型
  memoryStrength: number;    // 源石技艺强度
}

// 技能定义
export interface Skill {
  name: string;
  multiplier: number;        // 技能倍率
  cooldown: number;          // 冷却时间(秒)
  castTime: number;          // 施放时间(秒)
  hits: number;              // 命中次数
  damageType: DamageType;    // 伤害类型: 物理/法术
  element?: ElementType;     // 技能元素类型(默认使用角色元素)
}

// 腐蚀状态
export interface CorrosionState {
  enabled: boolean;
  level: AbnormalLevel;
  duration: number;          // 已持续时间(秒)
  memoryStrength?: number;   // 可覆盖角色的源石技艺强度
}

// 导电状态 (法术易伤)
export interface ConductivityState {
  enabled: boolean;
  level: AbnormalLevel;
  memoryStrength?: number;
}

// 碎甲状态 (物理易伤)
export interface ShatterState {
  enabled: boolean;
  level: AbnormalLevel;
  memoryStrength?: number;
}

// 敌人状态
export interface Enemy {
  name: string;
  resistRank: EnemyResistRank;           // 抗性等级 D/C/B
  elementalResistance: Partial<Record<ElementType, number>>; // 额外元素抗性
  isImbalance: boolean;                  // 是否处于失衡状态
  fragile: number;                       // 脆弱值 (0.2 = 20%脆弱)
}

// 战斗状态 (所有增益/减益)
export interface CombatState {
  // 增益乘区
  amplify: number;           // 增幅区 (0.2 = 20%增幅)
  combo: number;             // 连击区 (0.15 = 15%连击增伤)
 续航: number;              // 续航倍率 (通常为1)

  // 异常状态
  corrosion: CorrosionState;
  conductivity: ConductivityState;
  shatter: ShatterState;

  // 抗性穿透
  resistancePen: number;     // 抗性穿透值
}

// DPS结果
export interface DPSResult {
  totalDPS: number;
  cycleTime: number;
  characterDPS: {
    name: string;
    dps: number;
    percentage: number;
  }[];
}

// ============ 常量数据 ============

// 敌人抗性等级对应数值
export const ENEMY_RESISTANCE: Record<EnemyResistRank, number> = {
  D: 0,
  C: 20,
  B: 50
};

// 腐蚀数值表
export const CORROSION_DATA: Record<AbnormalLevel, {
  initial: number;    // 初始减抗
  perSecond: number;  // 每秒减抗
  max: number;        // 最大减抗
}> = {
  1: { initial: 3.6, perSecond: 0.84, max: 12 },
  2: { initial: 4.8, perSecond: 1.12, max: 16 },
  3: { initial: 6.0, perSecond: 1.40, max: 20 },
  4: { initial: 7.2, perSecond: 1.68, max: 24 }
};

// 导电/碎甲数值表
export const VULNERABILITY_DATA: Record<AbnormalLevel, {
  value: number;      // 易伤数值 (0.12 = 12%)
  duration: number;   // 持续时间(秒)
}> = {
  1: { value: 0.12, duration: 12 },
  2: { value: 0.16, duration: 18 },
  3: { value: 0.20, duration: 24 },
  4: { value: 0.24, duration: 30 }
};

// 失衡易伤
export const IMBALANCE_BONUS = 0.30; // 30%

// 防御减免 (当前版本固定)
export const DEFENSE_REDUCTION = 0.5;

// 异常伤害倍率表
export const ABNORMAL_MULTIPLIER: Record<AbnormalType, (level: AbnormalLevel) => number> = {
  // 法术异常
  conductivity: (level) => 0.80 * (1 + level),      // 导电: 80% × (1 + 等级)
  corrosion: (level) => 0.80 * (1 + level),         // 腐蚀: 80% × (1 + 等级)
  burning: (level) => 0.80 * (1 + level),           // 燃烧初始: 80% × (1 + 等级)
  freeze: (level) => 0.80 * (1 + level),            // 冻结: 80% × (1 + 等级)
  shatterIce: (level) => 1.20 * (1 + level),        // 碎冰: 120% × (1 + 等级)
  magicBurst: () => 1.60,                           // 法术爆发: 固定160%
  // 物理异常
  knockdown: () => 1.20,                            // 倒地: 固定120%
  launch: () => 1.20,                               // 击飞: 固定120%
  shatterArmor: (level) => 0.50 * (1 + level),      // 碎甲: 50% × (1 + 等级)
  slam: (level) => 1.50 * (1 + level),              // 猛击: 150% × (1 + 等级)
};

// 燃烧持续伤害倍率
export const BURNING_DOT_MULTIPLIER = (level: AbnormalLevel) => 0.12 * (1 + level);

// 异常持续时间表 (秒)
export const ABNORMAL_DURATION: Record<AbnormalType, (level: AbnormalLevel) => number> = {
  conductivity: (level) => [0, 12, 18, 24, 30][level],
  corrosion: () => 15,
  burning: () => 10,
  freeze: (level) => [0, 6, 7, 8, 9][level],
  shatterIce: () => 0,  // 即时
  magicBurst: () => 0,  // 即时
  knockdown: () => 0,   // 即时
  launch: () => 0,      // 即时
  shatterArmor: (level) => [0, 12, 18, 24, 30][level],
  slam: () => 0,        // 即时
};

// ============ 核心计算函数 ============

/**
 * 计算源石技艺强度加成系数 (用于碎甲/导电/腐蚀效果增强)
 */
export function calculateMemoryCoefficient(memoryStrength: number): number {
  if (memoryStrength <= 0) return 0;
  return (2 * memoryStrength) / (memoryStrength + 300);
}

/**
 * 计算源石技艺强度区 (用于异常伤害)
 * 公式: 1 + 源石技艺强度 / 100
 */
export function calculateMemoryStrengthZone(memoryStrength: number): number {
  return 1 + memoryStrength / 100;
}

/**
 * 从角色输入构建最终角色属性
 * 合并角色、武器、装备的所有属性
 */
export function buildCharacter(input: CharacterInput): Character {
  const weapon = input.weapon;
  const equip = input.equipment;

  // 计算攻击力
  const baseAtk = input.baseAtk + (weapon?.baseAtk || 0);
  const flatAtk = (equip?.mainStat || 0) + (equip?.subStat || 0);

  // 主副属性通过 calculateFinalAtk 统一折算，避免重复计入
  const atkPercent = weapon?.atkPercent || 0;

  // 暴击属性
  const critRate = Math.min(1, (input.critRate || 0) + (weapon?.critRate || 0) + (equip?.critRate || 0));
  const critDmg = (input.critDmg || 0.5) + (weapon?.critDmg || 0) + (equip?.critDmg || 0);

  // 增伤
  const dmgBonus = (input.dmgBonus || 0) + (weapon?.dmgBonus || 0) + (equip?.dmgBonus || 0);

  // 源石技艺强度
  const memoryStrength = (input.memoryStrength || 0) + (weapon?.memoryStrength || 0) + (equip?.memoryStrength || 0);

  return {
    name: input.name,
    level: input.level,
    baseAtk,
    atkPercent,
    flatAtk,
    mainStat: input.mainStat + (weapon?.mainStat || 0),
    subStat: input.subStat + (weapon?.subStat || 0),
    critRate,
    critDmg,
    dmgBonus,
    element: input.element,
    memoryStrength
  };
}


/**
 * 计算等级系数区
 * - 其他伤害: 1
 * - 法术异常和法术爆发: 1 + (等级 - 1) / 196
 * - 物理异常: 1 + (等级 - 1) / 392
 */
export function calculateLevelCoefficient(
  characterLevel: number,
  abnormalType?: AbnormalType
): number {
  if (!abnormalType) return 1;

  const magicAbnormals: AbnormalType[] = [
    'conductivity', 'corrosion', 'burning', 'freeze',
    'shatterIce', 'magicBurst'
  ];
  const physicalAbnormals: AbnormalType[] = [
    'knockdown', 'launch', 'shatterArmor', 'slam'
  ];

  if (magicAbnormals.includes(abnormalType)) {
    return 1 + (characterLevel - 1) / 196;
  } else if (physicalAbnormals.includes(abnormalType)) {
    return 1 + (characterLevel - 1) / 392;
  }
  return 1;
}

/**
 * 计算最终攻击力
 */
export function calculateFinalAtk(character: Character): number {
  // 能力值加成独立乘区:
  // 攻击力 = [基础攻击 × (1 + 攻击力加成) + 固定攻击] × (1 + 能力值加成)
  const abilityBonus = character.mainStat * 0.005 + character.subStat * 0.002;
  return (character.baseAtk * (1 + character.atkPercent) + character.flatAtk) * (1 + abilityBonus);
}

/**
 * 计算暴击期望倍率
 */
export function calculateCritMultiplier(
  critRate: number,
  critDmg: number
): number {
  const effectiveCritRate = Math.min(1, Math.max(0, critRate));
  return 1 + effectiveCritRate * critDmg;
}

/**
 * 计算腐蚀减抗值
 */
export function calculateCorrosionResistReduction(
  corrosion: CorrosionState,
  memoryStrength: number
): number {
  if (!corrosion.enabled) return 0;

  const data = CORROSION_DATA[corrosion.level];
  const ms = corrosion.memoryStrength ?? memoryStrength;
  const coefficient = 1 + calculateMemoryCoefficient(ms);

  // 减抗(t) = min(初始减抗 + t × 每秒减抗, 减抗最大值)
  const rawReduction = Math.min(
    data.initial + corrosion.duration * data.perSecond,
    data.max
  );

  return rawReduction * coefficient;
}

/**
 * 计算导电易伤 (法术易伤)
 */
export function calculateConductivityVulnerability(
  conductivity: ConductivityState,
  memoryStrength: number
): number {
  if (!conductivity.enabled) return 0;

  const data = VULNERABILITY_DATA[conductivity.level];
  const ms = conductivity.memoryStrength ?? memoryStrength;
  const coefficient = 1 + calculateMemoryCoefficient(ms);

  return data.value * coefficient;
}

/**
 * 计算碎甲易伤 (物理易伤)
 */
export function calculateShatterVulnerability(
  shatter: ShatterState,
  memoryStrength: number
): number {
  if (!shatter.enabled) return 0;

  const data = VULNERABILITY_DATA[shatter.level];
  const ms = shatter.memoryStrength ?? memoryStrength;
  const coefficient = 1 + calculateMemoryCoefficient(ms);

  return data.value * coefficient;
}

/**
 * 计算易伤区
 * 物理伤害: 碎甲
 * 法术伤害: 导电
 */
export function calculateVulnerabilityZone(
  damageType: DamageType,
  combat: CombatState,
  memoryStrength: number
): number {
  if (damageType === 'physical') {
    return calculateShatterVulnerability(combat.shatter, memoryStrength);
  } else {
    return calculateConductivityVulnerability(combat.conductivity, memoryStrength);
  }
}

/**
 * 计算失衡区
 */
export function calculateImbalanceZone(enemy: Enemy): number {
  return enemy.isImbalance ? IMBALANCE_BONUS : 0;
}

/**
 * 计算抗性减免
 */
export function calculateResistanceReduction(
  enemy: Enemy,
  element: ElementType,
  resistancePen: number,
  corrosionReduction: number
): number {
  // 基础抗性
  const baseRes = ENEMY_RESISTANCE[enemy.resistRank];
  // 元素抗性
  const elementRes = enemy.elementalResistance[element] ?? 0;
  // 总抗性 = 基础抗性 + 元素抗性 - 抗性穿透 - 腐蚀减抗
  const totalRes = baseRes + elementRes - resistancePen - corrosionReduction;

  // 抗性减免 = 抗性 / (100 + 抗性)
  // 注意: 负抗性会增伤
  if (totalRes >= 0) {
    return totalRes / (100 + totalRes);
  } else {
    // 负抗性时，伤害增加
    // 公式: 伤害 = 原伤害 × (1 - 抗性减免)
    // 当抗性为负时，减免为负，即增伤
    return totalRes / 100; // 简化处理
  }
}

/**
 * 计算异常伤害
 * 异常伤害 = 基础伤害区 × 暴击区 × 伤害加成区 × 伤害减免区 × 易伤区 × 增幅区
 *          × 虚弱区 × 庇护区 × 脆弱区 × 防御区 × 失衡易伤区 × 抗性区
 *          × 特殊乘区 × 等级系数区 × 源石技艺强度区
 */
export interface AbnormalDamageParams {
  character: Character;
  abnormalType: AbnormalType;
  level: AbnormalLevel;
  enemy: Enemy;
  combat: CombatState;
  specialMultiplier?: number;  // 特殊乘区 (如潜能加成)
  weakZone?: number;           // 虚弱区 (默认0)
  shelterZone?: number;        // 庇护区 (默认0)
  canCrit?: boolean;           // 是否可暴击 (默认true)
}

export function calculateAbnormalDamage(params: AbnormalDamageParams): number {
  const {
    character,
    abnormalType,
    level,
    enemy,
    combat,
    specialMultiplier = 1,
    weakZone = 0,
    shelterZone = 0,
    canCrit = true
  } = params;

  // 1. 基础伤害区 = 攻击力 × 异常倍率
  const atk = calculateFinalAtk(character);
  const abnormalMultiplier = ABNORMAL_MULTIPLIER[abnormalType](level);
  const baseDamage = atk * abnormalMultiplier;

  // 2. 暴击区
  const critZone = canCrit
    ? calculateCritMultiplier(character.critRate, character.critDmg)
    : 1;

  // 3. 伤害加成区 (角色增伤)
  const dmgBonusZone = 1 + character.dmgBonus;

  // 4. 伤害减免区 (通常为1)
  const dmgReductionZone = 1;

  // 5. 易伤区 (根据异常类型判断物理/法术)
  const damageType = getAbnormalDamageType(abnormalType);
  const vulnerabilityZone = 1 + calculateVulnerabilityZone(damageType, combat, character.memoryStrength);

  // 6. 增幅区
  const amplifyZone = 1 + combat.amplify;

  // 7. 虚弱区
  const weakZoneValue = 1 + weakZone;

  // 8. 庇护区
  const shelterZoneValue = 1 + shelterZone;

  // 9. 脆弱区
  const fragileZone = 1 + enemy.fragile;

  // 10. 防御区
  const defenseZone = 1 / (1 + DEFENSE_REDUCTION);

  // 11. 失衡易伤区
  const imbalanceZone = 1 + calculateImbalanceZone(enemy);

  // 12. 抗性区
  const element = getAbnormalElement(abnormalType, character.element);
  const corrosionReduction = calculateCorrosionResistReduction(combat.corrosion, character.memoryStrength);
  const resistanceReduction = calculateResistanceReduction(
    enemy, element, combat.resistancePen, corrosionReduction
  );
  const resistanceZone = 1 - resistanceReduction;

  // 13. 特殊乘区
  const specialZone = specialMultiplier;

  // 14. 等级系数区
  const levelZone = calculateLevelCoefficient(character.level, abnormalType);

  // 15. 源石技艺强度区
  const memoryZone = calculateMemoryStrengthZone(character.memoryStrength);

  // 最终异常伤害
  const damage = baseDamage
    * critZone
    * dmgBonusZone
    * dmgReductionZone
    * vulnerabilityZone
    * amplifyZone
    * weakZoneValue
    * shelterZoneValue
    * fragileZone
    * defenseZone
    * imbalanceZone
    * resistanceZone
    * specialZone
    * levelZone
    * memoryZone;

  return damage;
}

/**
 * 获取异常的伤害类型
 */
export function getAbnormalDamageType(abnormalType: AbnormalType): DamageType {
  const physicalTypes: AbnormalType[] = ['shatterIce', 'knockdown', 'launch', 'shatterArmor', 'slam'];
  return physicalTypes.includes(abnormalType) ? 'physical' : 'magic';
}

/**
 * 获取异常的元素类型
 */
export function getAbnormalElement(abnormalType: AbnormalType, characterElement: ElementType): ElementType {
  const elementMap: Partial<Record<AbnormalType, ElementType>> = {
    conductivity: 'electric',
    corrosion: 'ether',
    burning: 'fire',
    freeze: 'ice',
    shatterIce: 'physical',
    knockdown: 'physical',
    launch: 'physical',
    shatterArmor: 'physical',
    slam: 'physical',
  };
  return elementMap[abnormalType] ?? characterElement;
}

/**
 * 计算燃烧持续伤害 (每秒)
 */
export function calculateBurningDotDamage(
  character: Character,
  level: AbnormalLevel,
  enemy: Enemy,
  combat: CombatState
): number {
  const atk = calculateFinalAtk(character);
  const dotMultiplier = BURNING_DOT_MULTIPLIER(level);
  const baseDamage = atk * dotMultiplier;

  // 燃烧持续伤害的乘区计算
  const memoryZone = calculateMemoryStrengthZone(character.memoryStrength);
  const levelZone = calculateLevelCoefficient(character.level, 'burning');

  // 简化计算: 只计算主要乘区
  return baseDamage * levelZone * memoryZone;
}

/**
 * 计算最终伤害
 */
export function calculateDamage(
  character: Character,
  skill: Skill,
  enemy: Enemy,
  combat: CombatState
): number {
  // 1. 攻击力
  const atk = calculateFinalAtk(character);

  // 2. 暴击倍率
  const critMultiplier = calculateCritMultiplier(character.critRate, character.critDmg);

  // 3. 增伤区 (角色自身)
  const damageZone = 1 + character.dmgBonus;

  // 4. 易伤区 (根据伤害类型选择导电/碎甲)
  const vulnerabilityZone = 1 + calculateVulnerabilityZone(
    skill.damageType,
    combat,
    character.memoryStrength
  );

  // 5. 脆弱区
  const fragileZone = 1 + enemy.fragile;

  // 6. 增幅区
  const amplifyZone = 1 + combat.amplify;

  // 7. 失衡区
  const imbalanceZone = 1 + calculateImbalanceZone(enemy);

  // 8. 连击区
  const comboZone = 1 + combat.combo;

  // 9. 续航倍率
  const sustainZone = combat.续航 || 1;

  // 10. 防御减免
  const defenseDivisor = 1 + DEFENSE_REDUCTION;

  // 11. 抗性减免
  const corrosionReduction = calculateCorrosionResistReduction(
    combat.corrosion,
    character.memoryStrength
  );
  const resistanceReduction = calculateResistanceReduction(
    enemy,
    skill.element ?? character.element,
    combat.resistancePen,
    corrosionReduction
  );
  const resistanceMultiplier = 1 - resistanceReduction;

  // 最终伤害公式
  const damage = atk * skill.multiplier
    * damageZone
    * vulnerabilityZone
    * fragileZone
    * amplifyZone
    * imbalanceZone
    * comboZone
    * critMultiplier
    * sustainZone
    / defenseDivisor
    * resistanceMultiplier;

  return damage * skill.hits;
}

/**
 * 计算角色技能循环DPS
 */
export function calculateCharacterCycleDPS(
  character: Character,
  skills: Skill[],
  enemy: Enemy,
  combat: CombatState,
  cycleTime: number
): number {
  let totalDamage = 0;

  for (const skill of skills) {
    const skillCycleTime = skill.cooldown + skill.castTime;
    const effectiveCycleTime = cycleTime > 0 ? cycleTime : skillCycleTime;
    const casts = Math.floor(effectiveCycleTime / skillCycleTime);
    const skillDamage = calculateDamage(character, skill, enemy, combat);
    totalDamage += skillDamage * Math.max(1, casts);
  }

  return totalDamage / cycleTime;
}

/**
 * 计算队伍总DPS
 */
export function calculateTeamDPS(
  team: Character[],
  skillSets: Skill[][],
  enemy: Enemy,
  combat?: CombatState,
  cycleTime?: number
): DPSResult;

/**
 * 计算队伍总DPS (接受CharacterInput)
 */
export function calculateTeamDPS(
  team: CharacterInput[],
  skillSets: Skill[][],
  enemy: Enemy,
  combat?: CombatState,
  cycleTime?: number
): DPSResult;

export function calculateTeamDPS(
  team: Character[] | CharacterInput[],
  skillSets: Skill[][],
  enemy: Enemy,
  combat: CombatState = {
    amplify: 0,
    combo: 0,
    续航: 1,
    corrosion: { enabled: false, level: 1, duration: 0 },
    conductivity: { enabled: false, level: 1 },
    shatter: { enabled: false, level: 1 },
    resistancePen: 0
  },
  cycleTime: number = 20
): DPSResult {
  if (team.length !== skillSets.length) {
    throw new Error('队伍角色数量与技能配置数量不匹配');
  }

  const characterDPS: DPSResult['characterDPS'] = [];
  let totalDPS = 0;

  for (let i = 0; i < team.length; i++) {
    // 如果是CharacterInput，转换为Character
    const char = 'atkPercent' in team[i] ? team[i] as Character : buildCharacter(team[i] as CharacterInput);
    const dps = calculateCharacterCycleDPS(char, skillSets[i], enemy, combat, cycleTime);
    characterDPS.push({
      name: char.name,
      dps: dps,
      percentage: 0
    });
    totalDPS += dps;
  }

  for (const char of characterDPS) {
    char.percentage = totalDPS > 0 ? (char.dps / totalDPS) * 100 : 0;
  }

  return {
    totalDPS,
    cycleTime,
    characterDPS
  };
}

/**
 * 格式化输出报告
 */
export function formatReport(result: DPSResult, teamNames: string[]): string {
  let report = '=== DPS计算报告 ===\n';
  report += `队伍: [${teamNames.join(', ')}]\n\n`;
  report += '角色DPS明细:\n';

  for (const char of result.characterDPS) {
    report += `- ${char.name}: ${char.dps.toFixed(1)} DPS (${char.percentage.toFixed(1)}%)\n`;
  }

  report += `\n队伍总DPS: ${result.totalDPS.toFixed(1)}\n`;
  report += `循环时间: ${result.cycleTime}秒\n`;

  return report;
}

/**
 * 创建默认战斗状态
 */
export function createDefaultCombatState(): CombatState {
  return {
    amplify: 0,
    combo: 0,
    续航: 1,
    corrosion: { enabled: false, level: 1, duration: 0 },
    conductivity: { enabled: false, level: 1 },
    shatter: { enabled: false, level: 1 },
    resistancePen: 0
  };
}

/**
 * 创建默认敌人
 */
export function createDefaultEnemy(rank: EnemyResistRank = 'C'): Enemy {
  return {
    name: `标准${rank}级敌人`,
    resistRank: rank,
    elementalResistance: {},
    isImbalance: false,
    fragile: 0
  };
}
