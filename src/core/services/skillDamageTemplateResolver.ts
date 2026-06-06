import type { HitSkillType, SkillButton as SkillButtonType } from '../../types';
import type { ResolvedHitTemplate, ResolvedSkillDamageTemplate } from '../calculators/skillDamage.types';
import { getCharacterInput, getRuntimeOperatorTemplateById } from '../../utils/storage';

type LeveledHit = {
  multiplier: number;
  levels?: Record<string, number>;
};

function resolveSkillLevelMode(button: SkillButtonType): string {
  return getCharacterInput(button.characterId)?.skillLevels?.[button.skillType] ?? 'M3';
}

function resolveHitMultiplier(hit: LeveledHit, levelKey: string): number {
  return hit.levels?.[levelKey] ?? hit.multiplier;
}

function normalizeHits(
  button: SkillButtonType,
  runtimeSkillId: string,
  displayName: string,
  hits: Array<{
    key: string;
    displayName: string;
    multiplier: number;
    levels?: Record<string, number>;
    element: SkillButtonType['element'];
    skillType: HitSkillType;
  }>,
  levelKey = resolveSkillLevelMode(button)
): ResolvedSkillDamageTemplate {
  return {
    characterId: button.characterId,
    characterName: button.characterName,
    runtimeSkillId,
    displayName,
    buttonType: button.skillType,
    hits: hits.map((hit): ResolvedHitTemplate => ({
      key: hit.key,
      displayName: hit.displayName,
      multiplier: resolveHitMultiplier(hit, levelKey),
      element: (hit.element ?? button.element ?? 'physical') as ResolvedHitTemplate['element'],
      skillType: hit.skillType,
    })),
  };
}

export function resolveSkillDamageTemplate(
  button: SkillButtonType
): ResolvedSkillDamageTemplate | null {
  const runtimeSkillId = button.runtimeSkillId ?? `${button.characterId}-${button.skillType}`;
  const displayName = button.skillDisplayName ?? button.skillType;

  const template = getRuntimeOperatorTemplateById(button.characterId);
  if (template) {
    let runtimeSkill = template.skills.find((skill) => skill.id === button.runtimeSkillId);

    if (!runtimeSkill) {
      if (button.runtimeSkillId) {
        console.warn(
          `[resolveSkillDamageTemplate] runtimeSkillId 未命中，fallback 到 buttonType:\n` +
          `  button.id=${button.id}\n` +
          `  characterId=${button.characterId}\n` +
          `  runtimeSkillId=${button.runtimeSkillId}\n` +
          `  skillType=${button.skillType}\n` +
          `  template.skills=[${template.skills.map(skill => skill.id).join(', ')}]`
        );
      }
      runtimeSkill = template.skills.find((skill) => skill.buttonType === button.skillType);
    }

    if (runtimeSkill) {
      return normalizeHits(
        button,
        runtimeSkill.id,
        runtimeSkill.displayName || displayName,
        runtimeSkill.hits.map((hit) => ({
          key: hit.key,
          displayName: hit.displayName,
          multiplier: hit.multiplier,
          levels: hit.levels,
          element: hit.element,
          skillType: hit.skillType,
        }))
      );
    }
  }

  if (button.customHits && button.customHits.length > 0) {
    return normalizeHits(button, runtimeSkillId, displayName, button.customHits);
  }

  console.warn(
    `[resolveSkillDamageTemplate] 未能解析技能模板:\n` +
    `  button.id=${button.id}\n` +
    `  characterId=${button.characterId}\n` +
    `  runtimeSkillId=${button.runtimeSkillId ?? 'N/A'}\n` +
    `  skillType=${button.skillType}`
  );
  return null;
}
