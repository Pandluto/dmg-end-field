export interface EquipmentConfig {
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  mainStatBoost: number;
  subStatBoost: number;
  allStatBoost: number;
  flatAtk: number;
  atkPercentBoost: number;
  critRateBoost: number;
  critDmgBonusBoost: number;
  defense: number;
  hp: number;
  physicalDmgBonus: number;
  fireDmgBonus: number;
  electricDmgBonus: number;
  iceDmgBonus: number;
  natureDmgBonus: number;
  magicDmgBonus: number;
  skillDmgBonus: number;
  chainSkillDmgBonus: number;
  ultimateDmgBonus: number;
  normalAttackDmgBonus: number;
  imbalanceDmgBonus: number;
  sourceSkillBoost: number;
  allSkillDmgBonus: number;
  allDmgBonus: number;
}

const EQUIPMENT_LABEL_TO_KEY: Record<string, keyof EquipmentConfig> = {
  '力量': 'strength',
  '敏捷': 'agility',
  '智识': 'intelligence',
  '意志': 'will',
  '主能力': 'mainStatBoost',
  '副能力': 'subStatBoost',
  '暴击率': 'critRateBoost',
  '暴击伤害': 'critDmgBonusBoost',
  '防御值': 'defense',
  '生命': 'hp',
  '物理伤害加成': 'physicalDmgBonus',
  '灼热伤害加成': 'fireDmgBonus',
  '电磁伤害加成': 'electricDmgBonus',
  '寒冷伤害加成': 'iceDmgBonus',
  '自然伤害加成': 'natureDmgBonus',
  '法术伤害加成': 'magicDmgBonus',
  '战技伤害加成': 'skillDmgBonus',
  '连携技伤害加成': 'chainSkillDmgBonus',
  '终结技伤害加成': 'ultimateDmgBonus',
  '普通攻击伤害加成': 'normalAttackDmgBonus',
  '对失衡目标伤害加成': 'imbalanceDmgBonus',
  '源石技艺强度': 'sourceSkillBoost',
};

const EQUIPMENT_PERCENT_FIELDS = new Set<keyof EquipmentConfig>([
  'mainStatBoost', 'subStatBoost', 'critRateBoost', 'critDmgBonusBoost',
  'physicalDmgBonus', 'fireDmgBonus', 'electricDmgBonus', 'iceDmgBonus',
  'natureDmgBonus', 'magicDmgBonus', 'skillDmgBonus', 'chainSkillDmgBonus',
  'ultimateDmgBonus', 'normalAttackDmgBonus', 'imbalanceDmgBonus',
]);

export function isPercentField(key: keyof EquipmentConfig): boolean {
  return EQUIPMENT_PERCENT_FIELDS.has(key);
}

export function parseEquipmentTextAndFill(
  text: string,
  onFill: (key: keyof EquipmentConfig, value: number) => void
): void {
  const cleanText = text.replace(/\|/g, '').replace(/。/g, ' ');

  for (const [label, key] of Object.entries(EQUIPMENT_LABEL_TO_KEY)) {
    const labelIndex = cleanText.indexOf(label);
    if (labelIndex === -1) continue;

    const afterLabel = cleanText.substring(labelIndex + label.length);

    const valueMatch = afterLabel.match(/^[\s\n]*([+-]?\d+(?:\.\d+)?)\s*%?/);

    if (valueMatch) {
      const rawValue = Number.parseFloat(valueMatch[1]);
      if (!Number.isNaN(rawValue)) {
        const isPercent = EQUIPMENT_PERCENT_FIELDS.has(key as keyof EquipmentConfig);
        const hasPercentSign = valueMatch[0].includes('%');
        let finalValue: number;
        if (hasPercentSign) {
          finalValue = rawValue;
        } else if (isPercent && rawValue >= 0 && rawValue <= 1) {
          finalValue = rawValue * 100;
        } else {
          finalValue = rawValue;
        }
        onFill(key as keyof EquipmentConfig, finalValue);
      }
    }
  }
}

export function buildEquipmentCopyText(equipment: Partial<Record<keyof EquipmentConfig, number>>): string {
  const lines: string[] = [];
  for (const [label, key] of Object.entries(EQUIPMENT_LABEL_TO_KEY)) {
    const value = equipment[key];
    if (value === undefined || value === 0) continue;
    const isPercent = EQUIPMENT_PERCENT_FIELDS.has(key as keyof EquipmentConfig);
    const displayValue = isPercent ? `${value * 100}%` : `${value}`;
    lines.push(`${label}: +${displayValue}`);
  }
  return lines.join('\n');
}