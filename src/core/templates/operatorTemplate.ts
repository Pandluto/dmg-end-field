/**
 * 运行时干员模板类型定义
 *
 * 这是官方角色和本地角色的统一运行时模板层。
 * 不是新的真相源，而是从真相源派生的软件统一模型。
 *
 * 真相源：
 * - 官方角色：public/data/characters/*.json
 * - 本地角色：localStorage['ddd.operator-editor.library.v1']
 *
 * 运行时模板表：sessionStorage['ddd.operator-runtime.template-map.v1']
 */

import type { ElementType, SkillType, AbilityType } from '../../types';

/**
 * 运行时技能段（hit）模板
 */
export interface RuntimeOperatorTemplateHit {
  /** 段标识，如 hit1, hit2 */
  key: string;
  /** 显示名称 */
  displayName: string;
  /** 伤害倍率 */
  multiplier: number;
  /** 元素类型 */
  element: ElementType;
  /** 技能类型（A/B/E/Q） */
  skillType: SkillType;
}

/**
 * 运行时技能模板
 */
export interface RuntimeOperatorTemplateSkill {
  /** 技能唯一标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 按钮类型（A/B/E/Q） */
  buttonType: SkillType;
  /** 图标 URL */
  iconUrl?: string;
  /** 段数 */
  hitCount: number;
  /** 各段详情 */
  hits: RuntimeOperatorTemplateHit[];
}

/**
 * 运行时干员模板
 * 官方和本地角色的统一运行时结构
 */
export interface RuntimeOperatorTemplate {
  /** 干员唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 头像 URL */
  avatarUrl?: string;
  /** 稀有度 */
  rarity: number;
  /** 职业 */
  profession: string;
  /** 武器类型 */
  weapon: string;
  /** 元素类型 */
  element: ElementType;
  /** 主属性 */
  mainStat: AbilityType | '';
  /** 副属性 */
  subStat: AbilityType | '';
  /** 等级 */
  level: number;
  /** 属性值 */
  attributes: {
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    atk: number;
    hp: number;
  };
  /** 来源：official = 官方角色, local = 本地角色 */
  source: 'official' | 'local';
  /** 技能列表（支持多技能） */
  skills: RuntimeOperatorTemplateSkill[];
}

/**
 * 运行时模板表结构
 * Record<characterId, RuntimeOperatorTemplate>
 */
export type RuntimeOperatorTemplateMap = Record<string, RuntimeOperatorTemplate>;

/**
 * 编辑器草稿技能段（hit）
 * 用于 /draft 页面和本地角色库
 */
export interface OperatorDraftHit {
  multiplier: number;
  displayName: string;
  element: ElementType;
  skillType: SkillType;
}

/**
 * 编辑器草稿技能
 */
export interface OperatorDraftSkill {
  displayName: string;
  buttonType: SkillType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, OperatorDraftHit>;
}

/**
 * 编辑器草稿干员
 * 用于 /draft 页面和本地角色库
 */
export interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: {
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    atk: number;
    hp: number;
  };
  skills: Record<string, OperatorDraftSkill>;
}
