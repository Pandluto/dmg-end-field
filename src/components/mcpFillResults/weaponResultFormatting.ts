type WeaponSkillLevel = { value?: number };

const WEAPON_SKILL_STAT_ALIASES: Record<string, string> = {
  atkPercent: 'atkPercentBoost',
  critRate: 'critRateBoost',
  critDmg: 'critDmgBonusBoost',
  elementalDmgBonus: 'allDmgBonus',
  burnDmgBonus: 'fireDmgBonus',
  memoryStrength: 'sourceSkillBoost',
};

const WEAPON_SKILL_PERCENT_STATS = new Set([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'hpPercent',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'physicalFragile',
  'fireFragile',
  'electricFragile',
  'iceFragile',
  'natureFragile',
  'magicFragile',
  'physicalVulnerability',
  'fireVulnerability',
  'electricVulnerability',
  'iceVulnerability',
  'natureVulnerability',
  'magicVulnerability',
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'allCorrosion',
  'physicalCorrosion',
  'magicCorrosion',
  'fireCorrosion',
  'electricCorrosion',
  'iceCorrosion',
  'natureCorrosion',
  'allResistanceIgnore',
  'physicalResistanceIgnore',
  'magicResistanceIgnore',
  'fireResistanceIgnore',
  'electricResistanceIgnore',
  'iceResistanceIgnore',
  'natureResistanceIgnore',
  'comboDamageBonus',
  'multiplierBonus',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
]);

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function normalizeWeaponSkillStatType(statType: string) {
  const trimmed = statType.trim();
  return WEAPON_SKILL_STAT_ALIASES[trimmed] ?? trimmed;
}

function formatWeaponSkillValue(statType: string, value: number) {
  return WEAPON_SKILL_PERCENT_STATS.has(normalizeWeaponSkillStatType(statType))
    ? `${formatNumber(value * 100)}%`
    : formatNumber(value);
}

export function formatWeaponSkillValueRange(
  statType: string,
  levels: Record<string, WeaponSkillLevel> | undefined,
) {
  const entries = Object.entries(levels || {})
    .filter((entry): entry is [string, { value: number }] => typeof entry[1]?.value === 'number')
    .sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) return '';
  const [firstLevel, first] = entries[0];
  const [lastLevel, last] = entries[entries.length - 1];
  return firstLevel === lastLevel
    ? `Lv.${firstLevel} ${formatWeaponSkillValue(statType, first.value)}`
    : `Lv.${firstLevel} ${formatWeaponSkillValue(statType, first.value)} → Lv.${lastLevel} ${formatWeaponSkillValue(statType, last.value)}`;
}
