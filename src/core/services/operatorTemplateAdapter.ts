/**
 * 干员模板适配器
 *
 * 提供官方角色和本地角色的统一模板转换逻辑
 * 从真相源派生到 RuntimeOperatorTemplate
 */

import type {
  Character,
  ElementType,
  SkillType,
  SandboxSkill,
  SandboxSkillHit,
} from '../../types';
import type {
  OperatorDraft,
  OperatorDraftSkill,
  OperatorDraftHit,
  RuntimeOperatorTemplate,
  RuntimeOperatorTemplateSkill,
  RuntimeOperatorTemplateHit,
} from '../templates/operatorTemplate';

// ============================================================================
// 工具函数
// ============================================================================

function getSkillIndexFromKey(skillKey: string): number {
  const matched = skillKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function getHitIndexFromKey(hitKey: string): number {
  const matched = hitKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function createDefaultHit(hitKey = 'hit1'): OperatorDraftHit {
  const hitIndex = getHitIndexFromKey(hitKey);
  return {
    multiplier: 0,
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
  };
}

function createDefaultSkill(buttonType: SkillType = 'A', skillKey = 'skill-1'): OperatorDraftSkill {
  const skillIndex = getSkillIndexFromKey(skillKey);
  return {
    displayName: `新技能${skillIndex}`,
    buttonType,
    iconUrl: '',
    hitCount: 1,
    hitMeta: {
      hit1: createDefaultHit('hit1'),
    },
  };
}

function createDefaultDraft(): OperatorDraft {
  return {
    id: 'custom-operator-001',
    name: '新干员',
    avatarUrl: '',
    rarity: 6,
    profession: '',
    weapon: '',
    element: 'physical',
    mainStat: '',
    subStat: '',
    level: 90,
    attributes: {
      strength: 0,
      agility: 0,
      intelligence: 0,
      will: 0,
      atk: 0,
      hp: 0,
    },
    skills: {
      'skill-1': createDefaultSkill('A', 'skill-1'),
    },
  };
}

// ============================================================================
// Draft 归一化与解析
// ============================================================================

/**
 * 归一化草稿
 * 确保所有技能段都有显示名称，同步 hitCount
 */
export function normalizeOperatorDraft(draft: OperatorDraft): OperatorDraft {
  Object.entries(draft.skills).forEach(([skillKey, skill]) => {
    if (!skill.displayName?.trim()) {
      skill.displayName = createDefaultSkill(skill.buttonType, skillKey).displayName;
    }
    Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
      if (!hit.displayName?.trim()) {
        hit.displayName = createDefaultHit(hitKey).displayName;
      }
    });
    // 同步 hitCount
    skill.hitCount = Object.keys(skill.hitMeta).length;
  });
  return draft;
}

/**
 * 解析导入的草稿 JSON
 * @throws 如果 JSON 格式不正确
 */
export function parseOperatorDraft(rawText: string): OperatorDraft {
  const parsed = JSON.parse(rawText) as Partial<OperatorDraft>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name || !parsed.skills || typeof parsed.skills !== 'object') {
    throw new Error('JSON 缺少 id / name / skills');
  }
  return normalizeOperatorDraft(parsed as OperatorDraft);
}

// ============================================================================
// Draft -> RuntimeTemplate 转换
// ============================================================================

function sortHitEntries(
  left: [string, OperatorDraftHit],
  right: [string, OperatorDraftHit]
): number {
  const leftNumber = Number(left[0].replace(/\D/g, ''));
  const rightNumber = Number(right[0].replace(/\D/g, ''));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left[0].localeCompare(right[0]);
}

function buildRuntimeHitFromDraft(
  hitKey: string,
  hit: OperatorDraftHit
): RuntimeOperatorTemplateHit {
  return {
    key: hitKey,
    displayName: hit.displayName || hitKey,
    multiplier: hit.multiplier,
    element: hit.element,
    skillType: hit.skillType,
  };
}

function buildRuntimeSkillFromDraft(
  skillKey: string,
  skill: OperatorDraftSkill
): RuntimeOperatorTemplateSkill {
  const hits = Object.entries(skill.hitMeta)
    .sort(sortHitEntries)
    .map(([hitKey, hit]) => buildRuntimeHitFromDraft(hitKey, hit));

  return {
    id: skillKey,
    displayName: skill.displayName || skillKey,
    buttonType: skill.buttonType,
    iconUrl: skill.iconUrl || undefined,
    hitCount: hits.length > 0 ? hits.length : skill.hitCount,
    hits,
  };
}

/**
 * 从草稿构建运行时模板
 */
export function buildRuntimeOperatorTemplateFromDraft(
  draft: OperatorDraft
): RuntimeOperatorTemplate {
  const skills = Object.entries(draft.skills).map(([skillKey, skill]) =>
    buildRuntimeSkillFromDraft(skillKey, skill)
  );

  return {
    id: draft.id,
    name: draft.name,
    avatarUrl: draft.avatarUrl || undefined,
    rarity: draft.rarity,
    profession: draft.profession || '',
    weapon: draft.weapon || '',
    element: (draft.element || 'physical') as ElementType,
    mainStat: (draft.mainStat || '') as RuntimeOperatorTemplate['mainStat'],
    subStat: (draft.subStat || '') as RuntimeOperatorTemplate['subStat'],
    level: draft.level,
    attributes: { ...draft.attributes },
    source: 'local',
    skills,
  };
}

// ============================================================================
// Official Character -> RuntimeTemplate 转换
// ============================================================================

/**
 * 从官方技能 multiplier 对象提取 hit 列表
 * 例如: { hit1: 100, hit2: 200, damage: 300 } -> [{key: 'hit1', multiplier: 100}, ...]
 */
function extractHitsFromMultiplier(
  multipliers: Record<string, number | undefined>,
  element: ElementType,
  skillType: SkillType
): RuntimeOperatorTemplateHit[] {
  const hits: RuntimeOperatorTemplateHit[] = [];

  // 提取所有 hitX 字段
  const hitEntries = Object.entries(multipliers)
    .filter(([key, value]) => /^hit\d+$/i.test(key) && typeof value === 'number')
    .sort(([a], [b]) => {
      const numA = Number(a.replace(/\D/g, ''));
      const numB = Number(b.replace(/\D/g, ''));
      return numA - numB;
    });

  if (hitEntries.length > 0) {
    hitEntries.forEach(([key, value], index) => {
      hits.push({
        key,
        displayName: `第${index + 1}击`,
        multiplier: value || 0,
        element,
        skillType,
      });
    });
  } else {
    // 如果没有 hitX 字段，使用 damage 字段作为单段
    const damage = multipliers.damage;
    if (typeof damage === 'number') {
      hits.push({
        key: 'hit1',
        displayName: '第1击',
        multiplier: damage,
        element,
        skillType,
      });
    }
  }

  return hits.length > 0 ? hits : [
    {
      key: 'hit1',
      displayName: '第1击',
      multiplier: 0,
      element,
      skillType,
    }
  ];
}

/**
 * 从官方角色构建运行时模板
 * 必须从官方 character.skills 构建，不依赖 sandboxSkills
 */
export function buildRuntimeOperatorTemplateFromOfficialCharacter(
  character: Character
): RuntimeOperatorTemplate {
  // 从官方四槽结构构建技能列表
  const officialSkillMap = {
    A: character.skills?.normalAttack,
    B: character.skills?.skill,
    E: character.skills?.chainSkill,
    Q: character.skills?.ultimate,
  } as const;

  const skills: RuntimeOperatorTemplateSkill[] = (['A', 'B', 'E', 'Q'] as const).map((skillType) => {
    const skill = officialSkillMap[skillType];
    const multipliers = skill?.multipliers?.M3 ?? skill?.multipliers?.['9'] ?? {};

    // 从 multiplier 提取完整的 hits 信息
    const hits = extractHitsFromMultiplier(
      multipliers,
      character.element || 'physical',
      skillType
    );

    return {
      id: `official-${skillType}`,
      displayName: skill?.name || skillType,
      buttonType: skillType,
      iconUrl: character.skillIconMap?.[skillType],
      hitCount: hits.length,
      hits,
    };
  });

  return {
    id: character.id,
    name: character.name,
    avatarUrl: character.avatarUrl,
    rarity: character.rarity,
    profession: character.profession || '',
    weapon: '', // 官方角色当前无武器字段
    element: character.element || 'physical',
    mainStat: character.mainStat || '',
    subStat: character.subStat || '',
    level: 90,
    attributes: {
      strength: character.attributes?.level90?.strength || 0,
      agility: character.attributes?.level90?.agility || 0,
      intelligence: character.attributes?.level90?.intelligence || 0,
      will: character.attributes?.level90?.will || 0,
      atk: character.attributes?.level90?.atk || 0,
      hp: character.attributes?.level90?.hp || 0,
    },
    source: 'official',
    skills,
  };
}

// ============================================================================
// 批量转换
// ============================================================================

/**
 * 批量从草稿构建运行时模板
 */
export function buildRuntimeTemplatesFromDraftMap(
  draftMap: Record<string, OperatorDraft>
): RuntimeOperatorTemplate[] {
  return Object.values(draftMap).map((draft) =>
    buildRuntimeOperatorTemplateFromDraft(draft)
  );
}

/**
 * 批量从官方角色构建运行时模板
 */
export function buildRuntimeTemplatesFromOfficialCharacters(
  characters: Character[]
): RuntimeOperatorTemplate[] {
  return characters.map((char) => buildRuntimeOperatorTemplateFromOfficialCharacter(char));
}

// ============================================================================
// RuntimeTemplate -> SandboxSkill 派生（UI 层消费）
// ============================================================================

/**
 * 从运行时模板构建沙盒技能列表
 * 沙盒层只是模板消费者，不再是模板来源
 */
export function buildSandboxSkillsFromRuntimeTemplate(
  template: RuntimeOperatorTemplate
): SandboxSkill[] {
  return template.skills.map((skill) => ({
    id: skill.id,
    displayName: skill.displayName,
    buttonType: skill.buttonType,
    iconUrl: skill.iconUrl,
    hitCount: skill.hitCount,
    source: template.source,
    customHits: skill.hits.map((hit): SandboxSkillHit => ({
      key: hit.key,
      displayName: hit.displayName,
      multiplier: hit.multiplier,
      element: hit.element,
      skillType: hit.skillType,
    })),
  }));
}

// ============================================================================
// 导出默认值创建函数（供 /draft 页面使用）
// ============================================================================

export {
  createDefaultDraft,
  createDefaultSkill,
  createDefaultHit,
  getSkillIndexFromKey,
  getHitIndexFromKey,
};
