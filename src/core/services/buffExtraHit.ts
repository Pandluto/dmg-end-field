import type { BuffExtraHitConfig, BuffExtraHitDamageType, BuffExtraHitSkillType, BuffExtraHitTrigger } from '../domain/buff';

export const EXTRA_HIT_DAMAGE_TYPES: BuffExtraHitDamageType[] = [
  'physical',
  'magic',
  'fire',
  'electric',
  'ice',
  'nature',
];

export const EXTRA_HIT_TRIGGERS: BuffExtraHitTrigger[] = ['physicalAbnormal'];
export const EXTRA_HIT_SKILL_TYPES: BuffExtraHitSkillType[] = ['', 'A', 'B', 'E', 'Q', 'Dot'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createDefaultExtraHitConfig(key = 'extra-hit'): BuffExtraHitConfig {
  return {
    key,
    damageType: 'physical',
    skillType: '',
    baseMultiplier: 1,
    imbalanceValue: 0,
    cooldownSeconds: 0,
    trigger: 'physicalAbnormal',
  };
}

export function normalizeExtraHitConfig(value: unknown, fallbackKey = 'extra-hit'): BuffExtraHitConfig {
  const raw = isRecord(value) ? value : {};
  const damageType = EXTRA_HIT_DAMAGE_TYPES.includes(raw.damageType as BuffExtraHitDamageType)
    ? raw.damageType as BuffExtraHitDamageType
    : 'physical';
  const trigger = EXTRA_HIT_TRIGGERS.includes(raw.trigger as BuffExtraHitTrigger)
    ? raw.trigger as BuffExtraHitTrigger
    : 'physicalAbnormal';
  const skillType = EXTRA_HIT_SKILL_TYPES.includes(raw.skillType as BuffExtraHitSkillType)
    ? raw.skillType as BuffExtraHitSkillType
    : '';
  return {
    key: typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : fallbackKey,
    damageType,
    skillType,
    baseMultiplier: typeof raw.baseMultiplier === 'number' && Number.isFinite(raw.baseMultiplier)
      ? Math.max(0, raw.baseMultiplier)
      : 1,
    imbalanceValue: typeof raw.imbalanceValue === 'number' && Number.isFinite(raw.imbalanceValue)
      ? Math.max(0, raw.imbalanceValue)
      : 0,
    cooldownSeconds: typeof raw.cooldownSeconds === 'number' && Number.isFinite(raw.cooldownSeconds)
      ? Math.max(0, raw.cooldownSeconds)
      : 0,
    trigger,
  };
}

export function validateExtraHitConfig(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be object`);
    return;
  }
  if (typeof value.key !== 'string' || !value.key.trim()) errors.push(`${path}.key must be non-empty string`);
  if (!EXTRA_HIT_DAMAGE_TYPES.includes(value.damageType as BuffExtraHitDamageType)) {
    errors.push(`${path}.damageType must be ${EXTRA_HIT_DAMAGE_TYPES.join('/')}`);
  }
  if (value.skillType !== undefined && !EXTRA_HIT_SKILL_TYPES.includes(value.skillType as BuffExtraHitSkillType)) {
    errors.push(`${path}.skillType must be empty/A/B/E/Q/Dot`);
  }
  if (typeof value.baseMultiplier !== 'number' || !Number.isFinite(value.baseMultiplier) || value.baseMultiplier < 0) {
    errors.push(`${path}.baseMultiplier must be non-negative number; 250% is 2.5`);
  }
  if (typeof value.imbalanceValue !== 'number' || !Number.isFinite(value.imbalanceValue) || value.imbalanceValue < 0) {
    errors.push(`${path}.imbalanceValue must be non-negative number`);
  }
  if (typeof value.cooldownSeconds !== 'number' || !Number.isFinite(value.cooldownSeconds) || value.cooldownSeconds < 0) {
    errors.push(`${path}.cooldownSeconds must be non-negative number`);
  }
  if (!EXTRA_HIT_TRIGGERS.includes(value.trigger as BuffExtraHitTrigger)) {
    errors.push(`${path}.trigger must be ${EXTRA_HIT_TRIGGERS.join('/')}`);
  }
}
