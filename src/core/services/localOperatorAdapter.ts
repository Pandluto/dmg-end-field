import { Character, SandboxSkill, SandboxSkillHit, SkillMultiplier, SkillType } from '../../types';

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
  const iconMap: Partial<Record<SkillType, string>> = {};
  (['A', 'B', 'E', 'Q'] as const).forEach((skillType) => {
    const matchedSkill = getFirstSkillByType(draft, skillType);
    if (matchedSkill?.iconUrl) {
      iconMap[skillType] = matchedSkill.iconUrl;
    }
  });
  return iconMap;
}

function sortHitEntries(left: [string, ImportedHitMetaDraft], right: [string, ImportedHitMetaDraft]) {
  const leftNumber = Number(left[0].replace(/\D/g, ''));
  const rightNumber = Number(right[0].replace(/\D/g, ''));
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left[0].localeCompare(right[0]);
}

function buildSandboxSkills(draft: ImportedOperatorDraft): SandboxSkill[] {
  return Object.entries(draft.skills).map(([skillKey, skill]) => {
    const customHits: SandboxSkillHit[] = Object.entries(skill.hitMeta)
      .sort(sortHitEntries)
      .map(([hitKey, hit]) => ({
        key: hitKey,
        displayName: hit.displayName || hitKey,
        multiplier: hit.multiplier,
        element: hit.element,
        skillType: hit.skillType,
      }));

    return {
      id: skillKey,
      displayName: skill.displayName || skillKey,
      buttonType: skill.buttonType,
      iconUrl: skill.iconUrl || undefined,
      hitCount: customHits.length > 0 ? customHits.length : skill.hitCount,
      source: 'local',
      customHits,
    };
  });
}

export function adaptImportedDraftToCharacter(draft: ImportedOperatorDraft): Character {
  const normalAttack = getFirstSkillByType(draft, 'A');
  const skill = getFirstSkillByType(draft, 'B');
  const chainSkill = getFirstSkillByType(draft, 'E');
  const ultimate = getFirstSkillByType(draft, 'Q');
  const sandboxSkills = buildSandboxSkills(draft);

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
    sandboxSkills,
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
