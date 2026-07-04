import { Character, SandboxSkill, SkillMultiplier, SkillType } from '../../types';
import type { OperatorDraft, RuntimeOperatorTemplate } from '../templates/operatorTemplate';
import {
  buildRuntimeOperatorTemplateFromDraft,
  buildRuntimeTemplatesFromDraftMap,
  normalizeOperatorDraft,
} from './operatorTemplateAdapter';
import { normalizeAssetUrl } from '../../utils/assetResolver';

const LOCAL_OPERATOR_LIBRARY_KEY = 'def.operator-editor.library.v1';

// ============================================================================
// 本地角色库读取（返回 Draft Map）
// ============================================================================

/**
 * 从 localStorage 加载本地角色草稿 Map
 * @returns Record<characterId, OperatorDraft>
 */
export function loadLocalOperatorDraftMap(): Record<string, OperatorDraft> {
  if (typeof window === 'undefined') {
    return {};
  }

  const raw = window.localStorage.getItem(LOCAL_OPERATOR_LIBRARY_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
    return Object.fromEntries(
      Object.entries(parsed).map(([draftId, draft]) => [draftId, normalizeOperatorDraft(draft)])
    );
  } catch (error) {
    console.warn('Failed to parse local operator library:', error);
    return {};
  }
}

// ============================================================================
// 运行时模板读取
// ============================================================================

/**
 * 加载本地角色运行时模板列表
 * @returns RuntimeOperatorTemplate[]
 */
export function loadLocalOperatorTemplates(): RuntimeOperatorTemplate[] {
  const draftMap = loadLocalOperatorDraftMap();
  return buildRuntimeTemplatesFromDraftMap(draftMap);
}

/**
 * 根据 ID 加载单个本地角色运行时模板
 * @param characterId - 角色 ID
 * @returns RuntimeOperatorTemplate | null
 */
export function loadLocalOperatorTemplateById(
  characterId: string
): RuntimeOperatorTemplate | null {
  const draftMap = loadLocalOperatorDraftMap();
  const draft = draftMap[characterId];
  if (!draft) return null;
  return buildRuntimeOperatorTemplateFromDraft(draft);
}

// ============================================================================
// 旧版兼容：转换为 Character（过渡函数）
// ============================================================================

function toSkillMultiplier(hitMeta: Record<string, { multiplier: number; levels?: Record<string, number> }>, levelKey = 'M3'): SkillMultiplier {
  const multipliers: SkillMultiplier = {};
  Object.entries(hitMeta).forEach(([hitKey, hit]) => {
    multipliers[hitKey] = hit.levels?.[levelKey] ?? hit.multiplier;
  });
  return multipliers;
}

function createFallbackSkill(skillType: SkillType) {
  return {
    name: skillType,
    type: skillType,
    description: '',
    multipliers: {
      M3: {
        hit1: 0,
      },
    },
  };
}

function buildCharacterAttributes(template: RuntimeOperatorTemplate): Character['attributes'] {
  if (!template.attributeLevels) {
    return {
      level1: { ...template.attributes },
      level90: { ...template.attributes },
    };
  }

  const levels = template.attributeLevels;
  return {
    level1: {
      strength: levels.strength.level1,
      agility: levels.agility.level1,
      intelligence: levels.intelligence.level1,
      will: levels.will.level1,
      atk: levels.atk.level1,
      hp: levels.hp.level1,
    },
    level20: {
      strength: levels.strength.level20,
      agility: levels.agility.level20,
      intelligence: levels.intelligence.level20,
      will: levels.will.level20,
      atk: levels.atk.level20,
      hp: levels.hp.level20,
    },
    level40: {
      strength: levels.strength.level40,
      agility: levels.agility.level40,
      intelligence: levels.intelligence.level40,
      will: levels.will.level40,
      atk: levels.atk.level40,
      hp: levels.hp.level40,
    },
    level60: {
      strength: levels.strength.level60,
      agility: levels.agility.level60,
      intelligence: levels.intelligence.level60,
      will: levels.will.level60,
      atk: levels.atk.level60,
      hp: levels.hp.level60,
    },
    level80: {
      strength: levels.strength.level80,
      agility: levels.agility.level80,
      intelligence: levels.intelligence.level80,
      will: levels.will.level80,
      atk: levels.atk.level80,
      hp: levels.hp.level80,
    },
    level90: {
      strength: levels.strength.level90,
      agility: levels.agility.level90,
      intelligence: levels.intelligence.level90,
      will: levels.will.level90,
      atk: levels.atk.level90,
      hp: levels.hp.level90,
    },
  };
}

/**
 * 将运行时模板转换为旧版 Character（兼容过渡）
 * @deprecated 建议逐步迁移到直接使用 RuntimeOperatorTemplate
 */
export function adaptRuntimeTemplateToLegacyCharacter(
  template: RuntimeOperatorTemplate
): Character {

  const normalAttack = template.skills.find((s) => s.buttonType === 'A');
  const skill = template.skills.find((s) => s.buttonType === 'B');
  const chainSkill = template.skills.find((s) => s.buttonType === 'E');
  const ultimate = template.skills.find((s) => s.buttonType === 'Q');

  // 构建 sandboxSkills（复用已有逻辑）
  const sandboxSkills: SandboxSkill[] = template.skills.map((skill) => ({
    id: skill.id,
    displayName: skill.displayName,
    buttonType: skill.buttonType,
    iconUrl: skill.iconUrl ? normalizeAssetUrl(skill.iconUrl) : undefined,
    hitCount: skill.hitCount,
    source: 'local',
    customHits: skill.hits.map((hit) => ({
      key: hit.key,
      displayName: hit.displayName,
      multiplier: hit.multiplier,
      levels: hit.levels,
      element: hit.element,
      skillType: hit.skillType,
    })),
  }));

  return {
    id: template.id,
    name: template.name,
    nameEn: template.name,
    rarity: template.rarity,
    profession: (template.profession || '未设置') as Character['profession'],
    weapon: template.weapon || '',
    element: template.element,
    mainStat: (template.mainStat || '力量') as Character['mainStat'],
    subStat: (template.subStat || '敏捷') as Character['subStat'],
    attributes: buildCharacterAttributes(template),
    skills: {
      normalAttack: normalAttack
        ? {
            name: normalAttack.displayName,
            type: 'A',
            description: '',
            multipliers: {
              M3: toSkillMultiplier(
                Object.fromEntries(
                  normalAttack.hits.map((h) => [h.key, { multiplier: h.multiplier }])
                )
              ),
            },
          }
        : createFallbackSkill('A'),
      skill: skill
        ? {
            name: skill.displayName,
            type: 'B',
            description: '',
            multipliers: {
              M3: toSkillMultiplier(
                Object.fromEntries(
                  skill.hits.map((h) => [h.key, { multiplier: h.multiplier }])
                )
              ),
            },
          }
        : createFallbackSkill('B'),
      chainSkill: chainSkill
        ? {
            name: chainSkill.displayName,
            type: 'E',
            description: '',
            multipliers: {
              M3: toSkillMultiplier(
                Object.fromEntries(
                  chainSkill.hits.map((h) => [h.key, { multiplier: h.multiplier }])
                )
              ),
            },
          }
        : createFallbackSkill('E'),
      ultimate: ultimate
        ? {
            name: ultimate.displayName,
            type: 'Q',
            description: '',
            multipliers: {
              M3: toSkillMultiplier(
                Object.fromEntries(
                  ultimate.hits.map((h) => [h.key, { multiplier: h.multiplier }])
                )
              ),
            },
          }
        : createFallbackSkill('Q'),
    },
    avatarUrl: template.avatarUrl ? normalizeAssetUrl(template.avatarUrl) : '',
    skillIconMap: Object.fromEntries(
      template.skills
        .filter((s) => s.iconUrl)
        .map((s) => [s.buttonType, normalizeAssetUrl(s.iconUrl)])
    ) as Character['skillIconMap'],
    librarySource: 'local',
    sandboxSkills,
    operatorBuffs: template.buffs,
  };
}

/**
 * 从本地角色库加载旧版 Character 列表（兼容过渡）
 * @deprecated 建议逐步迁移到 loadLocalOperatorTemplates()
 */
export function loadLocalOperatorCharacters(): Character[] {
  const templates = loadLocalOperatorTemplates();
  return templates.map(adaptRuntimeTemplateToLegacyCharacter);
}

/**
 * 从草稿直接转换为旧版 Character（兼容过渡）
 * @deprecated 建议逐步迁移到 buildRuntimeOperatorTemplateFromDraft()
 */
export function adaptImportedDraftToCharacter(draft: OperatorDraft): Character {
  const template = buildRuntimeOperatorTemplateFromDraft(draft);
  return adaptRuntimeTemplateToLegacyCharacter(template);
}
