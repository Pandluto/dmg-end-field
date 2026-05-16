import type { BuffDraft } from '../types/buffFill';
import { BUFF_EXTRA_HIT_RULE, BUFF_MODIFIER_TYPE_IDS, type BuffModifierType } from './buffFillCatalog';
import type { BuffFillAiDraft } from './buffFillSchema';

export interface BuffFillValidationResult {
  ok: boolean;
  errors: string[];
}

const BUFF_MODIFIER_TYPE_SET = new Set<string>(BUFF_MODIFIER_TYPE_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidModifierEffect(effect: Record<string, unknown>) {
  return effect.effectKind === 'modifier' && typeof effect.type === 'string' && BUFF_MODIFIER_TYPE_SET.has(effect.type);
}

function isValidExtraHitEffect(effect: Record<string, unknown>) {
  return effect.effectKind === 'extraHit' && effect.type === '' && isRecord(effect.extraHitConfig);
}

function collectEffectText(effect: Record<string, unknown>) {
  return [
    effect.displayName,
    effect.name,
    effect.description,
    effect.condition,
    effect.evidenceText,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function hasTemplatePlaceholder(effect: Record<string, unknown>) {
  return /\{[^}]+\}/.test(collectEffectText(effect));
}

function shouldDropZeroValueModifier(effect: Record<string, unknown>) {
  if (effect.effectKind !== 'modifier') {
    return false;
  }
  const numericValue = typeof effect.value === 'number' ? effect.value : Number(effect.value);
  if (!Number.isFinite(numericValue) || numericValue !== 0) {
    return false;
  }
  return hasTemplatePlaceholder(effect);
}

function shouldUseMultiplierMultiplier(effect: Record<string, unknown>) {
  if (effect.effectKind !== 'modifier' || effect.type !== 'multiplierBonus') {
    return false;
  }
  const numericValue = typeof effect.value === 'number' ? effect.value : Number(effect.value);
  if (!Number.isFinite(numericValue) || numericValue <= 1) {
    return false;
  }
  const text = collectEffectText(effect);
  return /原本的\s*\d+(\.\d+)?倍/.test(text) || /提升至原本的\s*\d+(\.\d+)?倍/.test(text);
}

function normalizeSanitizedModifierEffect(effect: Record<string, unknown>) {
  if (shouldUseMultiplierMultiplier(effect)) {
    return {
      ...effect,
      type: 'multiplierMultiplier',
    };
  }
  return effect;
}

export function sanitizeBuffFillAiDraft(candidate: unknown): unknown {
  if (!isRecord(candidate) || !Array.isArray(candidate.items)) {
    return candidate;
  }

  const sanitizedItems = candidate.items.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.effects)) {
      return item;
    }

    const sanitizedEffects = item.effects.flatMap((effect) => {
      if (!isRecord(effect)) {
        return [];
      }
      if (isValidModifierEffect(effect)) {
        if (shouldDropZeroValueModifier(effect)) {
          return [];
        }
        return [normalizeSanitizedModifierEffect(effect)];
      }
      if (isValidExtraHitEffect(effect)) {
        return [effect];
      }
      return [];
    });

    return {
      ...item,
      effects: sanitizedEffects,
    };
  });

  return {
    ...candidate,
    items: sanitizedItems,
  };
}

export function validateBuffFillAiDraft(candidate: unknown): BuffFillValidationResult {
  const errors: string[] = [];

  if (!isRecord(candidate)) {
    return { ok: false, errors: ['根节点必须是对象'] };
  }

  for (const field of ['id', 'name', 'sourceName', 'source', 'description']) {
    if (typeof candidate[field] !== 'string') {
      errors.push(`根字段 ${field} 必须是字符串`);
    }
  }

  if (!Array.isArray(candidate.items)) {
    errors.push('根字段 items 必须是数组');
    return { ok: false, errors };
  }

  candidate.items.forEach((item, itemIndex) => {
    const itemPath = `items[${itemIndex}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath} 必须是对象`);
      return;
    }

    for (const field of ['name', 'sourceName', 'description']) {
      if (typeof item[field] !== 'string') {
        errors.push(`${itemPath}.${field} 必须是字符串`);
      }
    }

    if (!Array.isArray(item.effects)) {
      errors.push(`${itemPath}.effects 必须是数组`);
      return;
    }

    item.effects.forEach((effect, effectIndex) => {
      const effectPath = `${itemPath}.effects[${effectIndex}]`;
      if (!isRecord(effect)) {
        errors.push(`${effectPath} 必须是对象`);
        return;
      }

      for (const field of ['displayName', 'name', 'level', 'source', 'sourceName', 'description', 'condition', 'evidenceText']) {
        if (typeof effect[field] !== 'string') {
          errors.push(`${effectPath}.${field} 必须是字符串`);
        }
      }

      if (typeof effect.confidence !== 'number' || Number.isNaN(effect.confidence)) {
        errors.push(`${effectPath}.confidence 必须是 number`);
      } else if (effect.confidence < 0 || effect.confidence > 1) {
        errors.push(`${effectPath}.confidence 必须在 0 到 1 之间`);
      }

      if (typeof effect.effectKind !== 'string' || !['modifier', 'extraHit'].includes(effect.effectKind)) {
        errors.push(`${effectPath}.effectKind 必须是 modifier 或 extraHit`);
        return;
      }

      if (typeof effect.value !== 'number' || Number.isNaN(effect.value)) {
        errors.push(`${effectPath}.value 必须是 number`);
      }

      if (effect.effectKind === 'modifier') {
        if (typeof effect.type !== 'string' || !BUFF_MODIFIER_TYPE_SET.has(effect.type)) {
          errors.push(`${effectPath}.type 不在允许的 modifier.type 白名单内`);
        }
        if (effect.extraHitConfig !== undefined) {
          errors.push(`${effectPath}.extraHitConfig 在 modifier 下不应存在`);
        }
      }

      if (effect.effectKind === 'extraHit') {
        if (effect.type !== '') {
          errors.push(`${effectPath}.type 在 extraHit 下必须为空字符串`);
        }
        if (effect.value !== 0) {
          errors.push(`${effectPath}.value 在 extraHit 下必须为 0`);
        }
        if (!isRecord(effect.extraHitConfig)) {
          errors.push(`${effectPath}.extraHitConfig 在 extraHit 下必须存在`);
          return;
        }

        if (effect.extraHitConfig.trigger !== BUFF_EXTRA_HIT_RULE.trigger) {
          errors.push(`${effectPath}.extraHitConfig.trigger 不合法`);
        }
        if (!BUFF_EXTRA_HIT_RULE.allowedDamageTypes.includes(String(effect.extraHitConfig.damageType) as never)) {
          errors.push(`${effectPath}.extraHitConfig.damageType 不合法`);
        }
        for (const field of ['key']) {
          if (typeof effect.extraHitConfig[field] !== 'string') {
            errors.push(`${effectPath}.extraHitConfig.${field} 必须是字符串`);
          }
        }
        for (const field of ['baseMultiplier', 'imbalanceValue', 'cooldownSeconds']) {
          if (typeof effect.extraHitConfig[field] !== 'number' || Number.isNaN(effect.extraHitConfig[field])) {
            errors.push(`${effectPath}.extraHitConfig.${field} 必须是 number`);
          }
        }

        const evidenceText = typeof effect.evidenceText === 'string' ? effect.evidenceText : '';
        const hasPositivePattern = BUFF_EXTRA_HIT_RULE.positivePatterns.some((pattern) => evidenceText.includes(pattern));
        if (!hasPositivePattern) {
          errors.push(`${effectPath}.evidenceText 缺少 extraHit 明确信号词`);
        }
      }
    });
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function convertBuffFillAiDraftToBuffDraft(candidate: BuffFillAiDraft): BuffDraft {
  const items = candidate.items.reduce<BuffDraft['items']>((acc, item, itemIndex) => {
    const itemKey = `item-${itemIndex + 1}`;
    const effects = item.effects.reduce<BuffDraft['items'][string]['effects']>((effectAcc, effect, effectIndex) => {
      const effectKey = `buff-${effectIndex + 1}`;
      effectAcc[effectKey] = {
        id: effectKey,
        displayName: effect.displayName,
        name: effect.name,
        level: effect.level,
        source: effect.source,
        sourceName: effect.sourceName,
        description: effect.description,
        condition: effect.condition,
        effectKind: effect.effectKind,
        type: effect.effectKind === 'extraHit' ? '' : effect.type as BuffModifierType,
        value: effect.effectKind === 'extraHit' ? 0 : effect.value,
        extraHitConfig: effect.effectKind === 'extraHit' ? effect.extraHitConfig : undefined,
      };
      return effectAcc;
    }, {});

    acc[itemKey] = {
      id: itemKey,
      name: item.name,
      sourceName: item.sourceName,
      description: item.description,
      effects,
    };
    return acc;
  }, {});

  return {
    id: candidate.id,
    name: candidate.name,
    sourceName: candidate.sourceName,
    source: candidate.source,
    description: candidate.description,
    items,
  };
}
