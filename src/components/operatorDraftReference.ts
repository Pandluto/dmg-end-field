import { resolvePublicPath } from '../utils/assetResolver';

type HitSkillType = 'A' | 'B' | 'E' | 'Q';
type HitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
const ATTRIBUTE_KEYS = ['strength', 'agility', 'intelligence', 'will', 'atk', 'hp'] as const;
type SkillLevelKey = (typeof SKILL_LEVEL_KEYS)[number];
type AttributeLevelKey = (typeof ATTRIBUTE_LEVEL_KEYS)[number];
type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
type AttributeLevels = Record<AttributeKey, Record<AttributeLevelKey, number>>;
type OperatorBuffGroupKey = 'talent' | 'potential' | 'skill';
type OperatorBuffCategory = 'positive' | 'condition';
interface OperatorBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
}
type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;

interface HitMetaDraft {
  multiplier?: number;
  displayName: string;
  element: HitElement;
  skillType: HitSkillType;
  levels: Record<SkillLevelKey, number>;
}

interface SkillDraft {
  displayName: string;
  buttonType: HitSkillType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, HitMetaDraft>;
}

export interface ImportedOperatorDraft {
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
  attributes: AttributeLevels;
  skills: Record<string, SkillDraft>;
  buffs: OperatorBuffs;
}

interface ReferenceOperatorItem {
  name: string;
}

interface SourceCharacterSkill {
  name?: string;
  multipliers?: Record<string, Record<string, number>>;
}

interface SourceCharacterData {
  name: string;
  rarity?: number;
  profession?: string;
  weapon?: string;
  element?: string;
  mainStat?: string;
  subStat?: string;
  attributes?: {
    level1?: Record<AttributeKey, number>;
    level20?: Record<AttributeKey, number>;
    level40?: Record<AttributeKey, number>;
    level60?: Record<AttributeKey, number>;
    level80?: Record<AttributeKey, number>;
    level90?: Record<AttributeKey, number>;
  };
  skills?: {
    normalAttack?: SourceCharacterSkill;
    skill?: SourceCharacterSkill;
    chainSkill?: SourceCharacterSkill;
    ultimate?: SourceCharacterSkill;
  };
}

interface ImportDraftOptions {
  assetPathOptions: string[];
  avatarAssetOptions: string[];
}

const ELEMENT_OPTIONS = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;

function createDefaultHit(hitKey = 'hit1'): HitMetaDraft {
  const matched = hitKey.match(/(\d+)$/);
  const hitIndex = matched ? Number(matched[1]) : 1;
  return {
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
    levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, 0])) as Record<SkillLevelKey, number>,
  };
}

function createDefaultAttributeLevels(value = 0): AttributeLevels {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => [
      attributeKey,
      Object.fromEntries(ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, value])),
    ])
  ) as AttributeLevels;
}

function createDefaultBuffs(): OperatorBuffs {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function createDefaultSkill(buttonType: HitSkillType = 'A', skillKey = 'skill-1'): SkillDraft {
  const matched = skillKey.match(/(\d+)$/);
  const skillIndex = matched ? Number(matched[1]) : 1;
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

function createDefaultDraft(): ImportedOperatorDraft {
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

function buildDefaultOperatorId(name: string) {
  return `custom-${name.replace(/\s+/g, '-').toLowerCase() || 'operator'}`;
}

function normalizeSourceSkillLevelKey(levelKey: string): SkillLevelKey | null {
  const normalized = levelKey.toUpperCase();
  if ((SKILL_LEVEL_KEYS as readonly string[]).includes(normalized)) {
    return normalized as SkillLevelKey;
  }
  if (/^\d+$/.test(levelKey)) {
    const numericLevel = Number(levelKey);
    if (numericLevel >= 1 && numericLevel <= 9) {
      return `L${numericLevel}` as SkillLevelKey;
    }
  }
  return null;
}

function resolveImportedMultiplierSets(skill?: SourceCharacterSkill): Partial<Record<SkillLevelKey, Record<string, number>>> {
  if (!skill?.multipliers) {
    return {};
  }
  const result: Partial<Record<SkillLevelKey, Record<string, number>>> = {};
  Object.entries(skill.multipliers).forEach(([levelKey, multiplierSet]) => {
    const normalizedKey = normalizeSourceSkillLevelKey(levelKey);
    if (normalizedKey) {
      result[normalizedKey] = multiplierSet;
    }
  });

  if (!result.M3) {
    result.M3 = skill.multipliers.M3 ?? skill.multipliers['9'] ?? Object.values(skill.multipliers)[0] ?? {};
  }
  return result;
}

function isImportedDamageKey(key: string) {
  return (
    /^hit\d+$/i.test(key) ||
    /^hit\d+damage$/i.test(key) ||
    /^ultimatehit\d+damage$/i.test(key) ||
    /^enhancedhit\d+$/i.test(key) ||
    /^slash\d+$/i.test(key) ||
    /(damage|execute|plunge|total)$/i.test(key)
  );
}

function sortImportedDamageEntries(entries: Array<[string, number]>) {
  return entries.sort(([leftKey], [rightKey]) => {
    const leftHitDamage = leftKey.match(/^hit(\d+)damage$/i);
    const rightHitDamage = rightKey.match(/^hit(\d+)damage$/i);
    if (leftHitDamage && rightHitDamage) {
      return Number(leftHitDamage[1]) - Number(rightHitDamage[1]);
    }
    if (leftHitDamage) return -1;
    if (rightHitDamage) return 1;

    const leftHit = leftKey.match(/^hit(\d+)$/i);
    const rightHit = rightKey.match(/^hit(\d+)$/i);
    if (leftHit && rightHit) {
      return Number(leftHit[1]) - Number(rightHit[1]);
    }
    if (leftHit) return -1;
    if (rightHit) return 1;
    return leftKey.localeCompare(rightKey, 'zh-Hans-CN');
  });
}

function toImportedHitDisplayName(sourceKey: string, hitIndex: number) {
  const matched = sourceKey.match(/^hit(\d+)$/i);
  if (matched) {
    return `第${matched[1]}击`;
  }
  const hitDamageMatched = sourceKey.match(/^hit(\d+)damage$/i);
  if (hitDamageMatched) {
    return `第${hitDamageMatched[1]}击`;
  }
  const ultimateHitMatched = sourceKey.match(/^ultimatehit(\d+)damage$/i);
  if (ultimateHitMatched) {
    return `终结技第${ultimateHitMatched[1]}击`;
  }
  const enhancedHitMatched = sourceKey.match(/^enhancedhit(\d+)$/i);
  if (enhancedHitMatched) {
    return `强化第${enhancedHitMatched[1]}击`;
  }
  const slashMatched = sourceKey.match(/^slash(\d+)$/i);
  if (slashMatched) {
    return `斩击${slashMatched[1]}`;
  }
  if (/^damage$/i.test(sourceKey)) {
    return '主伤害';
  }
  if (/^basedamage$/i.test(sourceKey)) {
    return '基础伤害';
  }
  if (/^extradamage$/i.test(sourceKey)) {
    return '额外伤害';
  }
  if (/^energydamage$/i.test(sourceKey)) {
    return '能量伤害';
  }
  if (/^explosiondamage$/i.test(sourceKey)) {
    return '爆炸伤害';
  }
  if (/^freezedamage$/i.test(sourceKey)) {
    return '冻结伤害';
  }
  if (/^normalattackdamage$/i.test(sourceKey)) {
    return '普攻伤害';
  }
  if (/^strongattackdamage$/i.test(sourceKey)) {
    return '重击伤害';
  }
  if (/^extraattackdamage$/i.test(sourceKey)) {
    return '追加攻击伤害';
  }
  if (/^perstackextradamage$/i.test(sourceKey)) {
    return '每层追加伤害';
  }
  if (/^damagevsnormal$/i.test(sourceKey)) {
    return '对常态目标伤害';
  }
  if (/^damagevsfrozen$/i.test(sourceKey)) {
    return '对冻结目标伤害';
  }
  if (/^shotdamage$/i.test(sourceKey)) {
    return '射击伤害';
  }
  if (/^tornadodamage$/i.test(sourceKey)) {
    return '龙卷伤害';
  }
  if (/^wavedamage$/i.test(sourceKey)) {
    return '波次伤害';
  }
  if (/^earlywavedamage$/i.test(sourceKey)) {
    return '提前波次伤害';
  }
  if (/^pulldamage$/i.test(sourceKey)) {
    return '牵引伤害';
  }
  if (/^crystaldamage$/i.test(sourceKey)) {
    return '晶体伤害';
  }
  if (/^initialexplosiondamage$/i.test(sourceKey)) {
    return '初始爆炸伤害';
  }
  if (/^dotpertickdamage$/i.test(sourceKey)) {
    return '持续伤害单跳';
  }
  if (/^dottotal$/i.test(sourceKey)) {
    return '持续伤害总计';
  }
  if (/^stabtotal$/i.test(sourceKey)) {
    return '突刺总计';
  }
  if (/^finisherdamage$/i.test(sourceKey)) {
    return '终结伤害';
  }
  if (/^phantomdamage$/i.test(sourceKey)) {
    return '幻影伤害';
  }
  if (/^spikedamage$/i.test(sourceKey)) {
    return '尖刺伤害';
  }
  if (/^slashbasedamage$/i.test(sourceKey)) {
    return '斩击基础伤害';
  }
  if (/^airslashdamage$/i.test(sourceKey)) {
    return '空斩伤害';
  }
  if (/^execute$/i.test(sourceKey)) {
    return '处决';
  }
  if (/^plunge$/i.test(sourceKey)) {
    return '下落';
  }
  return sourceKey || `第${hitIndex}击`;
}

function mapImportedHits(
  multiplierSets: Partial<Record<SkillLevelKey, Record<string, number>>>,
  element: string,
  skillType: HitSkillType,
  excludedKeys: string[] = []
) {
  const normalizedElement = ELEMENT_OPTIONS.includes(element as HitElement) ? (element as HitElement) : 'physical';
  const baseMultiplierSet = multiplierSets.M3 ?? multiplierSets.L9 ?? Object.values(multiplierSets)[0] ?? {};
  const entries = sortImportedDamageEntries(
    Object.entries(baseMultiplierSet).filter(
      ([key, value]) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        isImportedDamageKey(key) &&
        !excludedKeys.includes(key)
    )
  );

  if (!entries.length) {
    return {
      hitMeta: {
        hit1: {
          ...createDefaultHit('hit1'),
          element: normalizedElement,
          skillType,
        },
      },
      hitCount: 1,
    };
  }

  const hitMeta: Record<string, HitMetaDraft> = {};
  entries.forEach(([sourceKey, multiplier], index) => {
    const hitKey = `hit${index + 1}`;
    const levels = Object.fromEntries(
      SKILL_LEVEL_KEYS.map((levelKey) => [
        levelKey,
        typeof multiplierSets[levelKey]?.[sourceKey] === 'number' ? multiplierSets[levelKey][sourceKey] : multiplier,
      ])
    ) as Record<SkillLevelKey, number>;
    hitMeta[hitKey] = {
      levels,
      displayName: toImportedHitDisplayName(sourceKey, index + 1),
      element: normalizedElement,
      skillType,
    };
  });

  return {
    hitMeta,
    hitCount: Object.keys(hitMeta).length,
  };
}

function resolveImportedAvatarUrl(characterName: string, avatarAssetOptions: string[]) {
  const exact = `/assets/avatars/${characterName}/${characterName}.png`;
  return (
    avatarAssetOptions.find((option) => option === exact) ??
    avatarAssetOptions.find((option) => option.includes(`/assets/avatars/${characterName}/`)) ??
    ''
  );
}

function resolveImportedSkillIconUrl(characterName: string, buttonType: HitSkillType, assetPathOptions: string[]) {
  const suffixMap: Record<HitSkillType, string[]> = {
    A: ['普通攻击'],
    B: ['战技'],
    E: ['连携技'],
    Q: ['终结技'],
  };

  for (const suffix of suffixMap[buttonType]) {
    const candidate = suffix
      ? `/assets/avatars/${characterName}/${characterName}${suffix}.png`
      : `/assets/avatars/${characterName}/${characterName}.png`;
    if (assetPathOptions.includes(candidate)) {
      return candidate;
    }
  }

  return '';
}

function buildImportedSkill(
  sourceSkill: SourceCharacterSkill | undefined,
  skillKey: string,
  buttonType: HitSkillType,
  operatorName: string,
  operatorElement: string,
  assetPathOptions: string[]
) {
  const skill = createDefaultSkill(buttonType, skillKey);
  const { hitMeta, hitCount } = mapImportedHits(
    resolveImportedMultiplierSets(sourceSkill),
    operatorElement,
    buttonType
  );
  return {
    ...skill,
    displayName: sourceSkill?.name?.trim() || skill.displayName,
    iconUrl: resolveImportedSkillIconUrl(operatorName, buttonType, assetPathOptions),
    hitCount,
    hitMeta,
  };
}

function buildImportedAttributeLevels(sourceAttributes: SourceCharacterData['attributes'] | undefined): AttributeLevels {
  const fallbackLevel90 = sourceAttributes?.level90 ?? {} as Record<AttributeKey, number>;
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((attributeKey) => [
      attributeKey,
      Object.fromEntries(
        ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [
          levelKey,
          typeof sourceAttributes?.[levelKey]?.[attributeKey] === 'number'
            ? sourceAttributes[levelKey][attributeKey]
            : (typeof fallbackLevel90[attributeKey] === 'number' ? fallbackLevel90[attributeKey] : 0),
        ])
      ),
    ])
  ) as AttributeLevels;
}

function buildImportedDraft(source: SourceCharacterData, options: ImportDraftOptions): ImportedOperatorDraft {
  const fallback = createDefaultDraft();
  const operatorName = source.name?.trim() || fallback.name;
  const operatorElement = source.element || fallback.element;
  const skills: Record<string, SkillDraft> = {};
  let skillIndex = 1;

  const appendSkill = (skill: SkillDraft) => {
    skills[`skill-${skillIndex}`] = skill;
    skillIndex += 1;
  };

  appendSkill(
    buildImportedSkill(
      source.skills?.normalAttack,
      'skill-1',
      'A',
      operatorName,
      operatorElement,
      options.assetPathOptions
    )
  );

  appendSkill(buildImportedSkill(source.skills?.skill, `skill-${skillIndex}`, 'B', operatorName, operatorElement, options.assetPathOptions));
  appendSkill(buildImportedSkill(source.skills?.chainSkill, `skill-${skillIndex}`, 'E', operatorName, operatorElement, options.assetPathOptions));
  appendSkill(buildImportedSkill(source.skills?.ultimate, `skill-${skillIndex}`, 'Q', operatorName, operatorElement, options.assetPathOptions));

  return {
    id: buildDefaultOperatorId(operatorName),
    name: operatorName,
    avatarUrl: resolveImportedAvatarUrl(operatorName, options.avatarAssetOptions),
    rarity: source.rarity || fallback.rarity,
    profession: source.profession || '',
    weapon: source.weapon || '',
    element: operatorElement,
    mainStat: source.mainStat || '',
    subStat: source.subStat || '',
    level: 90,
    attributes: buildImportedAttributeLevels(source.attributes),
    skills,
    buffs: createDefaultBuffs(),
  };
}

export async function loadReferenceOperatorNames() {
  const response = await fetch(resolvePublicPath('data/characters/operators-list.json'));
  if (!response.ok) {
    throw new Error(`operators-list 加载失败: ${response.status}`);
  }
  const list = (await response.json()) as ReferenceOperatorItem[];
  return list.map((item) => item.name).filter(Boolean);
}

export async function loadReferenceOperatorDraft(selectedReferenceName: string, options: ImportDraftOptions) {
  const response = await fetch(resolvePublicPath(`data/characters/${selectedReferenceName}/${selectedReferenceName}.json`));
  if (!response.ok) {
    throw new Error(`参考干员加载失败: ${response.status}`);
  }
  const source = (await response.json()) as SourceCharacterData;
  return buildImportedDraft(source, options);
}
