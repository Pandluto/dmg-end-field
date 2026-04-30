import type { SkillButton as SkillButtonType } from '../../types';
import type { ResolvedHitTemplate, ResolvedSkillDamageTemplate } from '../calculators/skillDamage.types';
import { getRuntimeOperatorTemplateById } from '../../utils/storage';

function normalizeHits(
  button: SkillButtonType,
  runtimeSkillId: string,
  displayName: string,
  hits: Array<{
    key: string;
    displayName: string;
    multiplier: number;
    element: SkillButtonType['element'];
    skillType: SkillButtonType['skillType'];
  }>
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
      multiplier: hit.multiplier,
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
