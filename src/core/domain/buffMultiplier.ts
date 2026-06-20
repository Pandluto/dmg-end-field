import type { BuffCategory, BuffEffectKind, BuffMultiplier } from './buff';
import { isMultiplierSupportedBuffType } from './buffTypeRegistry';

export interface BuffMultiplierDefinitionLike {
  type?: string;
  category?: BuffCategory;
  effectKind?: BuffEffectKind;
  multiplier?: BuffMultiplier;
}

export function normalizeBuffMultiplier(value: unknown): BuffMultiplier | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const coefficient = (value as { coefficient?: unknown }).coefficient;
  return typeof coefficient === 'number' && Number.isFinite(coefficient) && coefficient > 0
    ? { coefficient }
    : undefined;
}

export function validateBuffMultiplierDefinition(buff: BuffMultiplierDefinitionLike): string[] {
  if (buff.multiplier === undefined) return [];

  const errors: string[] = [];
  if (!normalizeBuffMultiplier(buff.multiplier)) {
    errors.push('multiplier.coefficient 必须是有效正数');
  }
  if (buff.effectKind === 'extraHit') {
    errors.push('extraHit 不允许设置 multiplier');
  }
  if (buff.category === 'countable') {
    errors.push('multiplier 与 countable 不允许同时设置');
  }
  if (buff.category !== 'condition') {
    errors.push('multiplier 必须使用 category=condition');
  }
  if (!isMultiplierSupportedBuffType(buff.type)) {
    errors.push(`Buff type ${buff.type || '(empty)'} 不支持 multiplier`);
  }
  return errors;
}
