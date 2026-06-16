import type { HitSkillType, SkillButton as SkillButtonType } from '../../types';
import type { ResolvedHitTemplate, ResolvedSkillDamageTemplate } from '../calculators/skillDamage.types';
import type { RuntimeOperatorTemplateSkill } from '../templates/operatorTemplate';
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

function isTypedRuntimeSkillId(runtimeSkillId: string | undefined): boolean {
  return /^skill-[ABEQ]-\d+$/.test(runtimeSkillId ?? '') || /^official-[ABEQ]$/.test(runtimeSkillId ?? '');
}

function logLegacyRuntimeSkillAdaptation(
  button: SkillButtonType,
  legacyRuntimeSkillId: string,
  resolvedSkill: RuntimeOperatorTemplateSkill,
  strategy: 'legacy-index' | 'same-type-fallback'
): void {
  console.log('[resolveSkillDamageTemplate] 触发旧技能ID适配:', {
    buttonId: button.id,
    characterId: button.characterId,
    skillType: button.skillType,
    legacyRuntimeSkillId,
    resolvedRuntimeSkillId: resolvedSkill.id,
    strategy,
  });
}

function resolveLegacyRuntimeSkill(
  button: SkillButtonType,
  skills: RuntimeOperatorTemplateSkill[]
): RuntimeOperatorTemplateSkill | null {
  const runtimeSkillId = button.runtimeSkillId;
  if (!runtimeSkillId || isTypedRuntimeSkillId(runtimeSkillId)) {
    return null;
  }

  const legacyIndexMatch = runtimeSkillId.match(/^skill-(\d+)$/);
  if (legacyIndexMatch) {
    const legacyIndex = Number(legacyIndexMatch[1]);
    const sameTypeSkills = skills.filter((skill) => skill.buttonType === button.skillType);
    const candidate = Number.isInteger(legacyIndex) && legacyIndex > 0 ? sameTypeSkills[legacyIndex - 1] : undefined;
    if (candidate) {
      logLegacyRuntimeSkillAdaptation(button, runtimeSkillId, candidate, 'legacy-index');
      return candidate;
    }
  }

  const sameTypeSkills = skills.filter((skill) => skill.buttonType === button.skillType);
  if (sameTypeSkills.length === 1) {
    logLegacyRuntimeSkillAdaptation(button, runtimeSkillId, sameTypeSkills[0], 'same-type-fallback');
    return sameTypeSkills[0];
  }

  return null;
}

export function resolveRuntimeTemplateSkill(
  button: SkillButtonType
): RuntimeOperatorTemplateSkill | null {
  const template = getRuntimeOperatorTemplateById(button.characterId);
  if (!template) {
    return null;
  }

  let runtimeSkill = template.skills.find((skill) => skill.id === button.runtimeSkillId);

  if (!runtimeSkill) {
    const legacyRuntimeSkill = resolveLegacyRuntimeSkill(button, template.skills);
    if (legacyRuntimeSkill) {
      runtimeSkill = legacyRuntimeSkill;
    } else if (button.runtimeSkillId) {
      console.warn(
        `[resolveSkillDamageTemplate] runtimeSkillId 未命中，fallback 到 buttonType:\n` +
        `  button.id=${button.id}\n` +
        `  characterId=${button.characterId}\n` +
        `  runtimeSkillId=${button.runtimeSkillId}\n` +
        `  skillType=${button.skillType}\n` +
        `  template.skills=[${template.skills.map(skill => skill.id).join(', ')}]`
      );
    }
    if (!runtimeSkill) {
      runtimeSkill = template.skills.find((skill) => skill.buttonType === button.skillType);
    }
  }

  return runtimeSkill ?? null;
}

export function resolveSkillDamageTemplate(
  button: SkillButtonType
): ResolvedSkillDamageTemplate | null {
  const runtimeSkillId = button.runtimeSkillId ?? `${button.characterId}-${button.skillType}`;
  const displayName = button.skillDisplayName ?? button.skillType;

  const runtimeSkill = resolveRuntimeTemplateSkill(button);
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
