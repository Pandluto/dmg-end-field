import type { BuffCategory, BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';

export const PERCENT_STYLE_TYPES = new Set<string>([
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'multiplierBonus',
]);

export const DISPLAY_PERCENT_TYPES = new Set<string>([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allElementDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'allSkillDmgBonus',
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
  'comboDamageBonus',
  'sourceSkillBoost',
]);

export const BUFF_CATEGORY_OPTIONS: BuffCategory[] = ['condition', 'countable', 'passive'];
export const BUFF_CATEGORY_LABELS: Record<BuffCategory, string> = {
  condition: '条件',
  countable: '计层',
  passive: '常驻',
};
export const DISPLAY_FLAT_TYPES = new Set<string>([
  'flatAtk',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
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
]);

export const BUFF_EFFECT_KIND_OPTIONS: BuffEffectKind[] = ['modifier', 'extraHit'];

export const DEFAULT_EXTRA_HIT_CONFIG: BuffExtraHitConfig = {
  key: 'dianjian',
  damageType: 'physical',
  skillType: '',
  baseMultiplier: 2.5,
  imbalanceValue: 10,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal',
};

export function normalizeExtraHitConfig(value?: Partial<BuffExtraHitConfig>): BuffExtraHitConfig {
  return {
    key: value?.key?.trim() || DEFAULT_EXTRA_HIT_CONFIG.key,
    damageType: value?.damageType || DEFAULT_EXTRA_HIT_CONFIG.damageType,
    skillType: value?.skillType ?? DEFAULT_EXTRA_HIT_CONFIG.skillType,
    baseMultiplier: Number(value?.baseMultiplier ?? DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier) || DEFAULT_EXTRA_HIT_CONFIG.baseMultiplier,
    imbalanceValue: Number(value?.imbalanceValue ?? DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue) || DEFAULT_EXTRA_HIT_CONFIG.imbalanceValue,
    cooldownSeconds: Number(value?.cooldownSeconds ?? DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds) || DEFAULT_EXTRA_HIT_CONFIG.cooldownSeconds,
    trigger: value?.trigger || DEFAULT_EXTRA_HIT_CONFIG.trigger,
  };
}

export function getEffectKindLabel(kind: BuffEffectKind | undefined) {
  return kind === 'extraHit' ? '额外伤害段' : '普通加成';
}
