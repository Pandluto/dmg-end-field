import type { BuffExtraHitDamageType, BuffExtraHitSkillType, BuffExtraHitTrigger } from '../core/domain/buff';
import { BUFF_EXTRA_HIT_RULE, BUFF_MODIFIER_TYPE_IDS } from './buffFillCatalog';

export interface JsonSchemaObject {
  [key: string]: unknown;
}

export interface BuffFillAiEffect {
  displayName: string;
  name: string;
  level: string;
  source: string;
  sourceName: string;
  description: string;
  condition: string;
  effectKind: 'modifier' | 'extraHit';
  type: string;
  value: number;
  evidenceText: string;
  confidence: number;
  extraHitConfig?: {
    key: string;
    damageType: BuffExtraHitDamageType;
    skillType: BuffExtraHitSkillType;
    baseMultiplier: number;
    imbalanceValue: number;
    cooldownSeconds: number;
    trigger: BuffExtraHitTrigger;
  };
}

export interface BuffFillAiItem {
  name: string;
  sourceName: string;
  description: string;
  effects: BuffFillAiEffect[];
}

export interface BuffFillAiDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: BuffFillAiItem[];
}

export function createBuffFillAiDraftSchema(): JsonSchemaObject {
  const baseEffectProperties = {
    displayName: { type: 'string' },
    name: { type: 'string' },
    level: { type: 'string' },
    source: { type: 'string' },
    sourceName: { type: 'string' },
    description: { type: 'string' },
    condition: { type: 'string' },
    evidenceText: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  } satisfies Record<string, unknown>;

  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'sourceName', 'source', 'description', 'items'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      sourceName: { type: 'string' },
      source: { type: 'string' },
      description: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'sourceName', 'description', 'effects'],
          properties: {
            name: { type: 'string' },
            sourceName: { type: 'string' },
            description: { type: 'string' },
            effects: {
              type: 'array',
              items: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'displayName',
                      'name',
                      'level',
                      'source',
                      'sourceName',
                      'description',
                      'condition',
                      'effectKind',
                      'type',
                      'value',
                      'evidenceText',
                      'confidence',
                    ],
                    properties: {
                      ...baseEffectProperties,
                      effectKind: { type: 'string', enum: ['modifier'] },
                      type: { type: 'string', enum: BUFF_MODIFIER_TYPE_IDS },
                      value: { type: 'number' },
                    },
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'displayName',
                      'name',
                      'level',
                      'source',
                      'sourceName',
                      'description',
                      'condition',
                      'effectKind',
                      'type',
                      'value',
                      'evidenceText',
                      'confidence',
                      'extraHitConfig',
                    ],
                    properties: {
                      ...baseEffectProperties,
                      effectKind: { type: 'string', enum: ['extraHit'] },
                      type: { type: 'string', enum: [''] },
                      value: { type: 'number', enum: [0] },
                      extraHitConfig: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['key', 'damageType', 'skillType', 'baseMultiplier', 'imbalanceValue', 'cooldownSeconds', 'trigger'],
                        properties: {
                          key: { type: 'string' },
                          damageType: { type: 'string', enum: BUFF_EXTRA_HIT_RULE.allowedDamageTypes },
                          skillType: { type: 'string', enum: ['', 'A', 'B', 'E', 'Q', 'Dot'] },
                          baseMultiplier: { type: 'number' },
                          imbalanceValue: { type: 'number' },
                          cooldownSeconds: { type: 'number' },
                          trigger: { type: 'string', enum: [BUFF_EXTRA_HIT_RULE.trigger] },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

export function createOpenAiResponseFormatPayload() {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'buff_fill_ai_draft',
      strict: true,
      schema: createBuffFillAiDraftSchema(),
    },
  };
}
