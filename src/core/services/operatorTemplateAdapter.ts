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
import { normalizeAssetUrl } from '../../utils/assetResolver';
import { normalizeExtraHitConfig } from './buffExtraHit';
import { normalizeStoredBuffDefinition } from './buffStorageNormalization';
import { normalizeBuffMultiplier } from '../domain/buffMultiplier';
import type {
  OperatorDraft,
  OperatorDraftSkill,
  OperatorDraftHit,
  OperatorDraftAttributeLevels,
  OperatorDraftBuffs,
  OperatorDraftBuffEffect,
  OperatorBuffDerivedSource,
  OperatorAttributeLevelKey,
  OperatorAttributeKey,
  RuntimeOperatorTemplate,
  RuntimeOperatorTemplateSkill,
  RuntimeOperatorTemplateHit,
} from '../templates/operatorTemplate';

const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const satisfies readonly OperatorAttributeLevelKey[];
const ATTRIBUTE_KEYS = ['strength', 'agility', 'intelligence', 'will', 'atk', 'hp'] as const satisfies readonly OperatorAttributeKey[];
const OPERATOR_BUFF_GROUP_KEYS = ['talent', 'potential', 'skill'] as const;
const OPERATOR_BUFF_DERIVED_SOURCE_KEYS = ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] as const;

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
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
    levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, 0])),
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
    attributes: createDefaultAttributeLevels(),
    skills: {
      'skill-1': createDefaultSkill('A', 'skill-1'),
    },
    buffs: createDefaultBuffs(),
  };
}

function createDefaultBuffs(): OperatorDraftBuffs {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function createDefaultAttributeLevels(value = 0): OperatorDraftAttributeLevels {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => [
      attributeKey,
      Object.fromEntries(ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, value])),
    ])
  ) as OperatorDraftAttributeLevels;
}

function normalizeAttributeLevels(rawAttributes: unknown): OperatorDraftAttributeLevels {
  const source = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes as Record<string, unknown> : {};
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => {
      const rawValue = source[attributeKey];
      const legacyValue = typeof rawValue === 'number' ? rawValue : 0;
      const levelSource = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : {};
      return [
        attributeKey,
        Object.fromEntries(
          ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [
            levelKey,
            typeof levelSource[levelKey] === 'number' ? levelSource[levelKey] : legacyValue,
          ])
        ),
      ];
    })
  ) as OperatorDraftAttributeLevels;
}

function normalizeBuffEffect(effectKey: string, rawEffect: unknown): OperatorDraftBuffEffect {
  const rawSource = rawEffect && typeof rawEffect === 'object' ? rawEffect as Record<string, unknown> : {};
  const source = normalizeStoredBuffDefinition(rawSource);
  const effectKind = source.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const rawCategory = typeof source.category === 'string' ? source.category : '';
  const normalizedCategory = rawCategory === 'condition'
    ? 'condition'
    : rawCategory === 'countable'
      ? 'countable'
      : 'passive';
  const multiplier = effectKind === 'modifier'
    ? normalizeBuffMultiplier(source.multiplier)
    : undefined;
  const category = effectKind === 'extraHit' && normalizedCategory !== 'countable'
    ? 'passive'
    : multiplier
      ? 'condition'
      : normalizedCategory;
  const rawValue = source.value;
  const valueMode = effectKind === 'extraHit' || category === 'countable' ? 'fixed' : source.valueMode === 'derived' ? 'derived' : 'fixed';
  const rawDerivedValue = source.derivedValue && typeof source.derivedValue === 'object'
    ? source.derivedValue as Record<string, unknown>
    : {};
  const rawDerivedSource = typeof rawDerivedValue.source === 'string' ? rawDerivedValue.source : '';
  const derivedSource: OperatorBuffDerivedSource | null = OPERATOR_BUFF_DERIVED_SOURCE_KEYS.some((sourceKey) => sourceKey === rawDerivedSource)
    ? rawDerivedSource as OperatorBuffDerivedSource
    : null;
  const rawPerPointValue = rawDerivedValue.perPointValue ?? rawDerivedValue.scale;
  return {
    schemaVersion: 2,
    effectId: String(source.effectId || effectKey),
    name: String(source.name || effectKey),
    type: effectKind === 'extraHit' ? '' : String(source.type || ''),
    category,
    ...(typeof rawValue === 'number' && Number.isFinite(rawValue) ? { value: rawValue } : {}),
    ...(category === 'countable' && typeof source.maxStacks === 'number' && Number.isFinite(source.maxStacks) ? { maxStacks: Math.max(1, Math.floor(source.maxStacks)) } : {}),
    ...(multiplier ? { multiplier } : {}),
    ...(typeof source.unit === 'string' && source.unit ? { unit: source.unit } : {}),
    valueMode,
    ...(valueMode === 'derived' && derivedSource && typeof rawPerPointValue === 'number' && Number.isFinite(rawPerPointValue)
      ? { derivedValue: { source: derivedSource, perPointValue: rawPerPointValue } }
      : {}),
    ...(typeof source.description === 'string' && source.description ? { description: source.description } : {}),
    ...(typeof source.raw === 'string' && source.raw ? { raw: source.raw } : {}),
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(source.extraHitConfig, `${effectKey}-extra-hit`) }
      : {}),
  };
}

function normalizeOperatorDraftBuffs(rawBuffs: unknown): OperatorDraftBuffs {
  const source = rawBuffs && typeof rawBuffs === 'object' ? rawBuffs as Record<string, unknown> : {};
  return Object.fromEntries(
    OPERATOR_BUFF_GROUP_KEYS.map((groupKey) => {
      const rawGroup = source[groupKey] && typeof source[groupKey] === 'object' ? source[groupKey] as Record<string, unknown> : {};
      const rawEffects = rawGroup.effects && typeof rawGroup.effects === 'object' ? rawGroup.effects as Record<string, unknown> : {};
      return [
        groupKey,
        {
          effects: Object.fromEntries(
            Object.entries(rawEffects).map(([effectKey, rawEffect]) => [effectKey, normalizeBuffEffect(effectKey, rawEffect)])
          ),
        },
      ];
    })
  ) as OperatorDraftBuffs;
}

function levelToAttributeLevelKey(level: number): OperatorAttributeLevelKey {
  if (level >= 90) return 'level90';
  if (level >= 80) return 'level80';
  if (level >= 60) return 'level60';
  if (level >= 40) return 'level40';
  if (level >= 20) return 'level20';
  return 'level1';
}

function resolveAttributeSnapshot(attributes: OperatorDraftAttributeLevels, level: number) {
  const levelKey = levelToAttributeLevelKey(level);
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => [attributeKey, attributes[attributeKey]?.[levelKey] ?? attributes[attributeKey]?.level90 ?? 0])
  ) as RuntimeOperatorTemplate['attributes'];
}

// ============================================================================
// Draft 归一化与解析
// ============================================================================

/**
 * 归一化草稿
 * 确保所有技能段都有显示名称，同步 hitCount
 */
export function normalizeOperatorDraft(draft: OperatorDraft): OperatorDraft {
  draft.attributes = normalizeAttributeLevels(draft.attributes);
  draft.buffs = normalizeOperatorDraftBuffs(draft.buffs);
  Object.entries(draft.skills).forEach(([skillKey, skill]) => {
    if (!skill.displayName?.trim()) {
      skill.displayName = createDefaultSkill(skill.buttonType, skillKey).displayName;
    }
    Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
      if (!hit.displayName?.trim()) {
        hit.displayName = createDefaultHit(hitKey).displayName;
      }
      const fallbackValue = typeof hit.multiplier === 'number' ? hit.multiplier : 0;
      hit.levels = Object.fromEntries(
        SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, typeof hit.levels?.[levelKey] === 'number' ? hit.levels[levelKey] : fallbackValue])
      );
      delete hit.multiplier;
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
    multiplier: hit.levels?.M3 ?? 0,
    levels: hit.levels,
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
    iconUrl: skill.iconUrl ? normalizeAssetUrl(skill.iconUrl) : undefined,
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
  const normalizedDraft = normalizeOperatorDraft(draft);
  const skills = Object.entries(normalizedDraft.skills).map(([skillKey, skill]) =>
    buildRuntimeSkillFromDraft(skillKey, skill)
  );

  return {
    id: normalizedDraft.id,
    name: normalizedDraft.name,
    avatarUrl: normalizedDraft.avatarUrl ? normalizeAssetUrl(normalizedDraft.avatarUrl) : undefined,
    rarity: normalizedDraft.rarity,
    profession: normalizedDraft.profession || '',
    weapon: normalizedDraft.weapon || '',
    element: (normalizedDraft.element || 'physical') as ElementType,
    mainStat: (normalizedDraft.mainStat || '') as RuntimeOperatorTemplate['mainStat'],
    subStat: (normalizedDraft.subStat || '') as RuntimeOperatorTemplate['subStat'],
    level: normalizedDraft.level,
    attributes: resolveAttributeSnapshot(normalizedDraft.attributes, normalizedDraft.level),
    attributeLevels: normalizedDraft.attributes,
    buffs: normalizedDraft.buffs,
    source: 'local',
    skills,
  };
}

// ============================================================================
// Official Character -> RuntimeTemplate 转换
// ============================================================================

/**
 * 单段伤害字段白名单
 * 用于识别非标准命名的单段伤害字段
 */
const SINGLE_HIT_DAMAGE_KEYS = ['damage', 'phantomDamage', 'spikeDamage', 'slashBaseDamage'];

/**
 * 从官方技能 multiplier 对象提取 hit 列表
 * 支持多种命名规则：
 * 1. hit1 / hit2 / hit3
 * 2. hit1Damage / hit2Damage / hit3Damage
 * 3. 单段白名单：damage / phantomDamage / spikeDamage / slashBaseDamage
 */
function extractHitsFromMultiplier(
  multipliers: Record<string, number | undefined>,
  element: ElementType,
  skillType: SkillType,
  characterName?: string
): RuntimeOperatorTemplateHit[] {
  const hits: RuntimeOperatorTemplateHit[] = [];

  // 1. 优先识别 hitXDamage 格式（如 hit1Damage, hit2Damage）
  const hitDamageEntries = Object.entries(multipliers)
    .filter(([key, value]) => /^hit\d+Damage$/i.test(key) && typeof value === 'number')
    .sort(([a], [b]) => {
      const numA = Number(a.replace(/\D/g, ''));
      const numB = Number(b.replace(/\D/g, ''));
      return numA - numB;
    });

  if (hitDamageEntries.length > 0) {
    hitDamageEntries.forEach(([key, value], index) => {
      hits.push({
        key: key.replace(/Damage$/i, ''), // 去掉 Damage 后缀作为 key
        displayName: `第${index + 1}击`,
        multiplier: value || 0,
        levels: { M3: value || 0 },
        element,
        skillType,
      });
    });
    return hits;
  }

  // 2. 识别 hitX 格式（如 hit1, hit2）
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
        levels: { M3: value || 0 },
        element,
        skillType,
      });
    });
    return hits;
  }

  // 3. 识别单段白名单字段
  for (const singleKey of SINGLE_HIT_DAMAGE_KEYS) {
    const value = multipliers[singleKey];
    if (typeof value === 'number') {
      hits.push({
        key: 'hit1',
        displayName: '第1击',
        multiplier: value,
        levels: { M3: value },
        element,
        skillType,
      });
      return hits;
    }
  }

  // 4. 未识别到任何有效 hit，打印警告并返回空
  console.warn(
    `[extractHitsFromMultiplier] 未识别到有效 hit 数据:`,
    `角色=${characterName || 'unknown'}`,
    `技能=${skillType}`,
    `multiplierKeys=${Object.keys(multipliers).join(',')}`
  );

  return [];
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
      skillType,
      character.name
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
      levels: hit.levels,
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
