import { ImportedOperatorDraft } from '../../components/operatorDraftReference';
import { Character, SkillMultiplier, SkillType } from '../../types';

const LOCAL_OPERATOR_LIBRARY_KEY = 'ddd.operator-editor.library.v1';

type SkillDraft = ImportedOperatorDraft['skills'][string];

function toSkillMultiplier(skill: SkillDraft): SkillMultiplier {
  const multipliers: SkillMultiplier = {};
  Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
    multipliers[hitKey] = hit.multiplier;
  });
  return multipliers;
}

function createEmptySkill(skillType: SkillType) {
  return {
    name: skillType,
    type: skillType,
    description: '',
    multipliers: {
      hit1: 0,
    },
  };
}

function getFirstSkillByType(draft: ImportedOperatorDraft, buttonType: SkillType) {
  return Object.values(draft.skills).find((skill) => skill.buttonType === buttonType) ?? null;
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
    profession: draft.profession as Character['profession'],
    element: draft.element as Character['element'],
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
            multipliers: {
              M3: toSkillMultiplier(normalAttack),
            },
          }
        : createEmptySkill('A'),
      skill: skill
        ? {
            name: skill.displayName,
            type: 'B',
            multipliers: {
              M3: toSkillMultiplier(skill),
            },
          }
        : createEmptySkill('B'),
      chainSkill: chainSkill
        ? {
            name: chainSkill.displayName,
            type: 'E',
            multipliers: {
              M3: toSkillMultiplier(chainSkill),
            },
          }
        : createEmptySkill('E'),
      ultimate: ultimate
        ? {
            name: ultimate.displayName,
            type: 'Q',
            multipliers: {
              M3: toSkillMultiplier(ultimate),
            },
          }
        : createEmptySkill('Q'),
    },
    avatarUrl: draft.avatarUrl,
    skillIconMap: buildSkillIconMap(draft),
    librarySource: 'local',
  };
}

export function loadLocalOperatorCharacters() {
  if (typeof window === 'undefined') {
    return [] as Character[];
  }

  const raw = window.localStorage.getItem(LOCAL_OPERATOR_LIBRARY_KEY);
  if (!raw) {
    return [] as Character[];
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ImportedOperatorDraft>;
    return Object.values(parsed).map(adaptImportedDraftToCharacter);
  } catch (error) {
    console.warn('Failed to parse local operator library:', error);
    return [] as Character[];
  }
}
