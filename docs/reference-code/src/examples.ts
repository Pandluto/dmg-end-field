/**
 * 终末地 DPS 计算器 - 示例配置
 */

import {
  Character,
  Skill,
  Enemy,
  CombatState,
  calculateTeamDPS,
  formatReport,
  calculateAbnormalDamage,
  AbnormalLevel
} from './calculator';

// ============ 角色配置 ============

const character: Character = {
  name: '佩丽卡',
  level: 90,
  baseAtk: 1000,
  atkPercent: 0.5,       // 50%攻击加成
  flatAtk: 100,          // 固定攻击力
  mainStat: 200,         // 主属性200点
  subStat: 100,          // 副属性100点
  critRate: 0.25,        // 25%暴击率
  critDmg: 1.5,          // 150%暴击伤害
  dmgBonus: 0.3,         // 30%增伤
  element: 'electric',
  memoryStrength: 93     // 源石技艺强度
};

// ============ 技能配置 ============

const skills: Skill[] = [
  {
    name: '普通攻击',
    multiplier: 1.0,
    cooldown: 2.0,
    castTime: 0.5,
    hits: 3,
    damageType: 'magic',
    element: 'electric'
  },
  {
    name: '战技',
    multiplier: 3.5,
    cooldown: 8.0,
    castTime: 1.0,
    hits: 1,
    damageType: 'magic',
    element: 'electric'
  }
];

// ============ 敌人配置 ============

const enemy: Enemy = {
  name: 'B级测试敌人',
  resistRank: 'B',        // 50抗性
  elementalResistance: {
    electric: -20         // 雷弱 -20
  },
  isImbalance: true,      // 失衡状态
  fragile: 0.15           // 15%脆弱
};

// ============ 战斗状态配置 ============

const combat: CombatState = {
  amplify: 0.2,           // 20%增幅
  combo: 0.1,             // 10%连击增伤
  续航: 1,
  corrosion: {
    enabled: true,
    level: 3,             // 3级腐蚀
    duration: 10          // 已持续10秒(已叠满)
  },
  conductivity: {
    enabled: true,
    level: 2              // 2级导电(法术易伤)
  },
  shatter: {
    enabled: false,
    level: 1
  },
  resistancePen: 20       // 20点抗性穿透
};

// ============ 运行计算 ============

function runCalculation() {
  // 技能DPS计算
  const result = calculateTeamDPS([character], [skills], enemy, combat, 30);
  console.log(formatReport(result, [character.name]));

  // 异常伤害计算示例
  console.log('\n=== 异常伤害测试 ===');

  const abnormalLevel: AbnormalLevel = 3;

  // 导电异常伤害
  const conductDamage = calculateAbnormalDamage({
    character,
    abnormalType: 'conductivity',
    level: abnormalLevel,
    enemy,
    combat
  });
  console.log(`导电(3级)伤害: ${conductDamage.toFixed(1)}`);

  // 碎冰异常伤害
  const shatterIceDamage = calculateAbnormalDamage({
    character,
    abnormalType: 'shatterIce',
    level: abnormalLevel,
    enemy,
    combat
  });
  console.log(`碎冰(3级)伤害: ${shatterIceDamage.toFixed(1)}`);

  // 法术爆发伤害
  const burstDamage = calculateAbnormalDamage({
    character,
    abnormalType: 'magicBurst',
    level: 1,
    enemy,
    combat
  });
  console.log(`法术爆发伤害: ${burstDamage.toFixed(1)}`);
}

runCalculation();
