export const BUFF_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  atkPercentBoost: '攻击力百分比',
  atk: '固定攻击力',
  flatAtk: '固定攻击力',
  mainStat: '主能力固定值',
  subStat: '副能力固定值',
  mainStatBoost: '主能力提升',
  subStatBoost: '副能力提升',
  allStatBoost: '全属性提升',
  strengthBoost: '力量提升',
  agilityBoost: '敏捷提升',
  intelligenceBoost: '智识提升',
  willBoost: '意志提升',
  hp: '生命',
  hpPercent: '生命百分比',
  critRateBoost: '暴击率',
  critDmgBonusBoost: '暴击伤害',
  physicalDmgBonus: '物理伤害加成',
  magicDmgBonus: '法术伤害加成',
  fireDmgBonus: '灼热伤害加成',
  electricDmgBonus: '电磁伤害加成',
  iceDmgBonus: '寒冷伤害加成',
  natureDmgBonus: '自然伤害加成',
  allElementDmgBonus: '全元素伤害加成',
  allDmgBonus: '全伤害加成',
  skillDmgBonus: '战技伤害加成',
  chainSkillDmgBonus: '连携技伤害加成',
  ultimateDmgBonus: '终结技伤害加成',
  normalAttackDmgBonus: '普攻伤害加成',
  dotDmgBonus: '持续伤害加成',
  allSkillDmgBonus: '全技能伤害加成',
  imbalanceDmgBonus: '失衡伤害加成',
  physicalFragile: '物理易伤',
  fireFragile: '灼热易伤',
  electricFragile: '电磁易伤',
  iceFragile: '寒冷易伤',
  natureFragile: '自然易伤',
  magicFragile: '法术易伤',
  physicalVulnerability: '物理脆弱',
  fireVulnerability: '灼热脆弱',
  electricVulnerability: '电磁脆弱',
  iceVulnerability: '寒冷脆弱',
  natureVulnerability: '自然脆弱',
  magicVulnerability: '法术脆弱',
  physicalAmplify: '物理增幅',
  magicAmplify: '法术增幅',
  fireAmplify: '灼热增幅',
  electricAmplify: '电磁增幅',
  iceAmplify: '寒冷增幅',
  natureAmplify: '自然增幅',
  allCorrosion: '全属性降抗',
  physicalCorrosion: '物理降抗',
  magicCorrosion: '法术降抗',
  fireCorrosion: '灼热降抗',
  electricCorrosion: '电磁降抗',
  iceCorrosion: '寒冷降抗',
  natureCorrosion: '自然降抗',
  allResistanceIgnore: '无视全部抗性',
  physicalResistanceIgnore: '无视物理抗性',
  magicResistanceIgnore: '无视法术抗性',
  fireResistanceIgnore: '无视灼热抗性',
  electricResistanceIgnore: '无视电磁抗性',
  iceResistanceIgnore: '无视寒冷抗性',
  natureResistanceIgnore: '无视自然抗性',
  comboDamageBonus: '连击伤害加成',
  multiplierBonus: '倍率加算',
  multiplierMultiplier: '倍率乘算',
  sourceSkillBoost: '源石技艺强度',
  ultimateChargeEfficiency: '终结技充能效率',
  healingBonus: '治疗效率',
  receivedHealingBonus: '受治疗效率',
  chainCooldownReduction: '连携技冷却缩减',
  imbalanceEfficiency: '失衡效率',
  damageReduction: '伤害减免',
  fireNatureDmgBonus: '灼热和自然伤害',
  iceElectricDmgBonus: '寒冷和电磁伤害',
});

export interface BuffTypeLabelOptions {
  emptyLabel?: string;
  overrides?: Readonly<Record<string, string>>;
}

export function getBuffTypeLabel(
  typeKey: string | null | undefined,
  options: BuffTypeLabelOptions = {},
): string {
  const normalizedTypeKey = typeKey?.trim() ?? '';
  if (!normalizedTypeKey) return options.emptyLabel ?? '';
  return options.overrides?.[normalizedTypeKey]
    ?? BUFF_TYPE_LABELS[normalizedTypeKey]
    ?? normalizedTypeKey;
}

export function getBuffTypeDisplayLabel(
  typeKey: string | null | undefined,
  options: BuffTypeLabelOptions = {},
): string {
  const normalizedTypeKey = typeKey?.trim() ?? '';
  if (!normalizedTypeKey) return options.emptyLabel ?? '';
  return `${getBuffTypeLabel(normalizedTypeKey, options)} · ${normalizedTypeKey}`;
}
