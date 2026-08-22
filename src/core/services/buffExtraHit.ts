import type {
  BuffExtraHitConfig,
  BuffExtraHitDamageType,
  BuffExtraHitFormulaMode,
  BuffExtraHitLevelCurve,
  BuffExtraHitSkillType,
  BuffExtraHitTrigger,
} from '../domain/buff';

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
export const EXTRA_HIT_FORMULA_MODES: BuffExtraHitFormulaMode[] = ['inherited', 'sourceSkill'];
export const EXTRA_HIT_LEVEL_CURVES: BuffExtraHitLevelCurve[] = ['physicalAnomaly', 'artsBurst'];
export const SPECIAL_DAMAGE_OPERATOR_LEVEL = 90;

export const EXTRA_HIT_FORMULA_MODE_LABELS: Record<BuffExtraHitFormulaMode, string> = {
  inherited: '普通继承段',
  sourceSkill: '源石技艺强度段',
};

export const EXTRA_HIT_LEVEL_CURVE_LABELS: Record<BuffExtraHitLevelCurve, string> = {
  physicalAnomaly: '物理异常系数',
  artsBurst: '碎冰 / 法术爆发系数',
};

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
    formulaMode: 'inherited',
    levelCurve: 'physicalAnomaly',
  };
}

export function normalizeExtraHitFormulaMode(value: unknown): BuffExtraHitFormulaMode {
  return value === 'sourceSkill' ? 'sourceSkill' : 'inherited';
}

export function normalizeExtraHitLevelCurve(value: unknown): BuffExtraHitLevelCurve {
  return value === 'artsBurst' ? 'artsBurst' : 'physicalAnomaly';
}

export function normalizeExtraHitCategory(value: unknown): 'condition' | 'countable' {
  return value === 'countable' ? 'countable' : 'condition';
}

export function formatExtraHitFormulaLabel(
  config: Pick<BuffExtraHitConfig, 'formulaMode' | 'levelCurve'>,
): string {
  const formulaMode = normalizeExtraHitFormulaMode(config.formulaMode);
  if (formulaMode === 'inherited') return EXTRA_HIT_FORMULA_MODE_LABELS.inherited;
  return `${EXTRA_HIT_FORMULA_MODE_LABELS.sourceSkill} · ${EXTRA_HIT_LEVEL_CURVE_LABELS[normalizeExtraHitLevelCurve(config.levelCurve)]}`;
}

export function resolveSpecialDamageLevelCoefficient(
  levelCurve: BuffExtraHitLevelCurve,
  operatorLevel = SPECIAL_DAMAGE_OPERATOR_LEVEL,
): number {
  const safeLevel = typeof operatorLevel === 'number' && Number.isFinite(operatorLevel)
    ? Math.max(1, operatorLevel)
    : SPECIAL_DAMAGE_OPERATOR_LEVEL;
  return levelCurve === 'artsBurst'
    ? 1 + (safeLevel - 1) / 196
    : 1 + (safeLevel - 1) / 392;
}

export interface ExtraHitBaseScaling {
  formulaMode: BuffExtraHitFormulaMode;
  levelCurve: BuffExtraHitLevelCurve;
  levelCoefficient: number;
  sourceSkill: number;
  sourceSkillZone: number;
  scaledBaseMultiplier: number;
}

export function resolveExtraHitBaseScaling(
  config: Pick<BuffExtraHitConfig, 'baseMultiplier' | 'formulaMode' | 'levelCurve'>,
  sourceSkill: number,
  operatorLevel = SPECIAL_DAMAGE_OPERATOR_LEVEL,
): ExtraHitBaseScaling {
  const formulaMode = normalizeExtraHitFormulaMode(config.formulaMode);
  const levelCurve = normalizeExtraHitLevelCurve(config.levelCurve);
  const safeSourceSkill = typeof sourceSkill === 'number' && Number.isFinite(sourceSkill) ? sourceSkill : 0;
  const levelCoefficient = formulaMode === 'sourceSkill'
    ? resolveSpecialDamageLevelCoefficient(levelCurve, operatorLevel)
    : 1;
  const sourceSkillZone = formulaMode === 'sourceSkill' ? 1 + safeSourceSkill / 100 : 1;
  return {
    formulaMode,
    levelCurve,
    levelCoefficient,
    sourceSkill: safeSourceSkill,
    sourceSkillZone,
    scaledBaseMultiplier: config.baseMultiplier * levelCoefficient * sourceSkillZone,
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
  const formulaMode = normalizeExtraHitFormulaMode(raw.formulaMode);
  const levelCurve = normalizeExtraHitLevelCurve(raw.levelCurve);
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
    formulaMode,
    levelCurve,
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
  if (value.formulaMode !== undefined && !EXTRA_HIT_FORMULA_MODES.includes(value.formulaMode as BuffExtraHitFormulaMode)) {
    errors.push(`${path}.formulaMode must be ${EXTRA_HIT_FORMULA_MODES.join('/')}`);
  }
  if (value.levelCurve !== undefined && !EXTRA_HIT_LEVEL_CURVES.includes(value.levelCurve as BuffExtraHitLevelCurve)) {
    errors.push(`${path}.levelCurve must be ${EXTRA_HIT_LEVEL_CURVES.join('/')}`);
  }
}
