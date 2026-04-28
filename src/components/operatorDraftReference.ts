type HitSkillType = 'A' | 'B' | 'E' | 'Q';
type HitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';

interface HitMetaDraft {
  multiplier: number;
  displayName: string;
  element: HitElement;
  skillType: HitSkillType;
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
  attributes: {
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    atk: number;
    hp: number;
  };
  skills: Record<string, SkillDraft>;
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
    level90?: ImportedOperatorDraft['attributes'];
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
    multiplier: 0,
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
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

function buildDefaultOperatorId(name: string) {
  return `custom-${name.replace(/\s+/g, '-').toLowerCase() || 'operator'}`;
}

function resolveImportedMultiplierSet(skill?: SourceCharacterSkill) {
  if (!skill?.multipliers) {
    return {};
  }
  return skill.multipliers.M3 ?? skill.multipliers['9'] ?? Object.values(skill.multipliers)[0] ?? {};
}

function isImportedDamageKey(key: string) {
  return /^hit\d+$/i.test(key) || /(damage|execute|plunge|dot|wave|shot|tornado)/i.test(key);
}

function sortImportedDamageEntries(entries: Array<[string, number]>) {
  return entries.sort(([leftKey], [rightKey]) => {
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
  return sourceKey || `第${hitIndex}击`;
}

function mapImportedHits(
  multiplierSet: Record<string, number>,
  element: string,
  skillType: HitSkillType,
  excludedKeys: string[] = []
) {
  const normalizedElement = ELEMENT_OPTIONS.includes(element as HitElement) ? (element as HitElement) : 'physical';
  const entries = sortImportedDamageEntries(
    Object.entries(multiplierSet).filter(
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
    hitMeta[hitKey] = {
      multiplier,
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

function buildSingleImportedHitSkill(
  skillKey: string,
  buttonType: HitSkillType,
  displayName: string,
  multiplier: number,
  element: string,
  operatorName: string,
  assetPathOptions: string[]
) {
  const normalizedElement = ELEMENT_OPTIONS.includes(element as HitElement) ? (element as HitElement) : 'physical';
  return {
    ...createDefaultSkill(buttonType, skillKey),
    displayName,
    iconUrl: resolveImportedSkillIconUrl(operatorName, buttonType, assetPathOptions),
    hitCount: 1,
    hitMeta: {
      hit1: {
        multiplier,
        displayName,
        element: normalizedElement,
        skillType: buttonType,
      },
    },
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
  assetPathOptions: string[],
  excludedKeys: string[] = []
) {
  const skill = createDefaultSkill(buttonType, skillKey);
  const { hitMeta, hitCount } = mapImportedHits(
    resolveImportedMultiplierSet(sourceSkill),
    operatorElement,
    buttonType,
    excludedKeys
  );
  return {
    ...skill,
    displayName: sourceSkill?.name?.trim() || skill.displayName,
    iconUrl: resolveImportedSkillIconUrl(operatorName, buttonType, assetPathOptions),
    hitCount,
    hitMeta,
  };
}

function buildImportedDraft(source: SourceCharacterData, options: ImportDraftOptions): ImportedOperatorDraft {
  const fallback = createDefaultDraft();
  const operatorName = source.name?.trim() || fallback.name;
  const operatorElement = source.element || fallback.element;
  const normalAttackMultiplierSet = resolveImportedMultiplierSet(source.skills?.normalAttack);
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
      options.assetPathOptions,
      ['execute', 'plunge']
    )
  );

  if (typeof normalAttackMultiplierSet.execute === 'number') {
    appendSkill(
      buildSingleImportedHitSkill(
        `skill-${skillIndex}`,
        'A',
        `${source.skills?.normalAttack?.name?.trim() || '普通攻击'}-处决`,
        normalAttackMultiplierSet.execute,
        operatorElement,
        operatorName,
        options.assetPathOptions
      )
    );
  }

  if (typeof normalAttackMultiplierSet.plunge === 'number') {
    appendSkill(
      buildSingleImportedHitSkill(
        `skill-${skillIndex}`,
        'A',
        `${source.skills?.normalAttack?.name?.trim() || '普通攻击'}-下落`,
        normalAttackMultiplierSet.plunge,
        operatorElement,
        operatorName,
        options.assetPathOptions
      )
    );
  }

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
    attributes: source.attributes?.level90 || fallback.attributes,
    skills,
  };
}

export async function loadReferenceOperatorNames() {
  const response = await fetch('/data/characters/operators-list.json');
  if (!response.ok) {
    throw new Error(`operators-list 加载失败: ${response.status}`);
  }
  const list = (await response.json()) as ReferenceOperatorItem[];
  return list.map((item) => item.name).filter(Boolean);
}

export async function loadReferenceOperatorDraft(selectedReferenceName: string, options: ImportDraftOptions) {
  const response = await fetch(`/data/characters/${selectedReferenceName}/${selectedReferenceName}.json`);
  if (!response.ok) {
    throw new Error(`参考干员加载失败: ${response.status}`);
  }
  const source = (await response.json()) as SourceCharacterData;
  return buildImportedDraft(source, options);
}
