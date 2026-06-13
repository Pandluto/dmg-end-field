/**
 * Buff 领域类型定义
 * 区分候选 Buff 和已选 Buff 实体
 */

/**
 * 候选 Buff 类型
 * 用于 def.candidate-buff-list.v1，只包含展示和选择所需字段
 * 不要求稳定 id，不等同于 SkillButtonBuff
 */
export type BuffEffectKind = 'modifier' | 'extraHit';
export type BuffExtraHitTrigger = 'physicalAbnormal';
export type BuffExtraHitDamageType = 'physical' | 'magic' | 'fire' | 'electric' | 'ice' | 'nature';

export interface BuffExtraHitConfig {
  key: string;
  damageType: BuffExtraHitDamageType;
  baseMultiplier: number;
  imbalanceValue: number;
  cooldownSeconds: number;
  trigger: BuffExtraHitTrigger;
}

export interface CandidateBuff {
  displayName: string;  // Buff 显示名称，用于在 UI 中显示
  name: string;         // Buff 名称
  level: string;        // Buff 等级，用于在 UI 中显示
  value?: number;       // Buff 数值（可选）
  type?: string;        // Buff 类型（可选）
  source: string;       // Buff 来源（角色名或武器名）
  sourceName: string;   // Buff 来源名称，用于在 UI 中显示
  description: string;  // Buff 描述，用于在 UI 中显示
  condition?: string;   // Buff 触发条件（可选）
  category?: 'condition' | 'countable' | 'passive';
  maxStacks?: number;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
  origin?: 'local' | 'json' | 'operatorConfigSnapshot' | 'operatorStudio';
  ownerBuffDomain?: 'operator' | 'weapon' | 'equipment';
  ownerCharacterId?: string;
  ownerBuffGroup?: 'talent' | 'potential' | 'skill' | 'weaponSkill' | 'threePiece';
  valueMode?: 'fixed' | 'derived';
  derivedValue?: {
    source: 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
    perPointValue: number;
  };
}

/**
 * Buff JSON 文件结构接口
 */
export interface BuffData {
  buffs?: CandidateBuff[];
}

