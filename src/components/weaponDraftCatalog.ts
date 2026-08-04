export type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';

export const SKILL_KEYS: WeaponSkillKey[] = ['skill1', 'skill2', 'skill3'];
export const LEVEL_KEYS = Array.from({ length: 9 }, (_, index) => String(index + 1));
export const ATTACK_GROWTH_MILESTONE_KEYS = ['1', '10', '20', '30', '40', '50', '60', '70', '80', '90'] as const;
export const SKILL1_OPTIONS = ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升', '副能力提升'] as const;
export const SKILL2_OPTIONS = ['攻击提升', '生命提升', '物理伤害提升', '灼热伤害提升', '电磁伤害提升', '寒冷伤害提升', '自然伤害提升', '暴击率提升', '源石技艺提升', '终结技充能效率提升', '法术伤害提升', '治疗效率提升'] as const;

export const SKILL1_BUFF_TYPE_MAP: Record<string, string> = {
  敏捷提升: 'agilityBoost',
  力量提升: 'strengthBoost',
  意志提升: 'willBoost',
  智识提升: 'intelligenceBoost',
  主能力提升: 'mainStatBoost',
  副能力提升: 'subStatBoost',
};

export const SKILL2_BUFF_TYPE_MAP: Record<string, string> = {
  攻击提升: 'atkPercentBoost',
  生命提升: 'hp',
  物理伤害提升: 'physicalDmgBonus',
  灼热伤害提升: 'fireDmgBonus',
  电磁伤害提升: 'electricDmgBonus',
  寒冷伤害提升: 'iceDmgBonus',
  自然伤害提升: 'natureDmgBonus',
  暴击率提升: 'critRateBoost',
  源石技艺提升: 'sourceSkillBoost',
  终结技充能效率提升: 'ultimateChargeEfficiency',
  法术伤害提升: 'magicDmgBonus',
  治疗效率提升: 'healingBonus',
};
