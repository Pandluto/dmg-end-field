import { Character, SkillMultiplier, SkillType } from '../../types';

const LOCAL_OPERATOR_LIBRARY_KEY = 'ddd.operator-editor.library.v1';

type ImportedHitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
type ImportedHitSkillType = 'A' | 'B' | 'E' | 'Q';

interface ImportedHitMetaDraft {
  multiplier: number;
  displayName: string;
  element: ImportedHitElement;
  skillType: ImportedHitSkillType;
}

interface ImportedSkillDraft {
  displayName: string;
  buttonType: ImportedHitSkillType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, ImportedHitMetaDraft>;
}

interface ImportedOperatorDraft {
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
  skills: Record<string, ImportedSkillDraft>;
}

type SkillDraft = ImportedSkillDraft;

function toSkillMultiplier(skill: SkillDraft): SkillMultiplier {
  const multipliers: SkillMultiplier = {};
  Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
    multipliers[hitKey] = hit.multiplier;
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

function getFirstSkillByType(draft: ImportedOperatorDraft, buttonType: SkillType) {
  for (const skillKey of Object.keys(draft.skills)) {
    const skill = draft.skills[skillKey];
    if (skill.buttonType === buttonType) {
      return skill;
    }
  }
  return null;
}

function buildSkillIconMap(draft: ImportedOperatorDraft) {
  const skillIconMap: Partial<Record<SkillType, string>> = {};
  (['A', 'B', 'E', 'Q'] as const).forEach((skillType) => {
    const skill = getFirstSkillByType(draft, skillType);
    if (skill?.iconUrl) {
      skillIconMap[skillType] = skill.iconUrl;
    }
  });
  return skillIconMap;
}

export function adaptImportedDraftToCharacter(draft: ImportedOperatorDraft): Character {
  const normalAttack = getFirstSkillByType(draft, 'A');
  const skill = getFirstSkillByType(draft, 'B');
  const chainSkill = getFirstSkillByType(draft, 'E');
  const ultimate = getFirstSkillByType(draft, 'Q');

  return {
    id: draft.id,
    name: draft.name,
    nameEn: draft.name,
    rarity: draft.rarity,
    profession: (draft.profession || '未设置') as Character['profession'],
    element: (draft.element || 'physical') as Character['element'],
    mainStat: (draft.mainStat || '力量') as Character['mainStat'],
    subStat: (draft.subStat || '敏捷') as Character['subStat'],
    attributes: {
      level1: { ...draft.attributes },
      level90: { ...draft.attributes },
    },
    skills: {
      normalAttack: normalAttack
        ? {
            name: normalAttack.displayName,
            type: 'A',
            description: '',
            multipliers: { M3: toSkillMultiplier(normalAttack) },
          }
        : createFallbackSkill('A'),
      skill: skill
        ? {
            name: skill.displayName,
            type: 'B',
            description: '',
            multipliers: { M3: toSkillMultiplier(skill) },
          }
        : createFallbackSkill('B'),
      chainSkill: chainSkill
        ? {
            name: chainSkill.displayName,
            type: 'E',
            description: '',
            multipliers: { M3: toSkillMultiplier(chainSkill) },
          }
        : createFallbackSkill('E'),
      ultimate: ultimate
        ? {
            name: ultimate.displayName,
            type: 'Q',
            description: '',
            multipliers: { M3: toSkillMultiplier(ultimate) },
          }
        : createFallbackSkill('Q'),
    },
    avatarUrl: draft.avatarUrl,
    skillIconMap: buildSkillIconMap(draft),
    librarySource: 'local',
  };
}

export function loadLocalOperatorCharacters(): Character[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(LOCAL_OPERATOR_LIBRARY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ImportedOperatorDraft>;
    return Object.keys(parsed).map((characterId) => adaptImportedDraftToCharacter(parsed[characterId]));
  } catch (error) {
    console.warn('Failed to parse local operator library:', error);
    return [];
  }
}
