import { LEVEL_KEYS, type WeaponSkillKey } from './weaponDraftCatalog';
import {
  buildWeaponEffectRowKey,
  cloneValue,
  type WeaponDraft,
  type WeaponEffectBucket,
  type WeaponEffectData,
  type WeaponSkillData,
} from './weaponDraftModel';

export interface WeaponDraftEditSnapshot {
  library: Readonly<Record<string, WeaponDraft>>;
  currentDraft?: WeaponDraft | null;
  activeDraftKey?: string | null;
}

export interface WeaponEffectEditResult {
  nextDraft: WeaponDraft;
  effectKey: string;
  focusRowKey: string;
}

export interface WeaponEffectDeleteResult {
  nextDraft: WeaponDraft;
  focusRowKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWeaponSkill(baseDraft: unknown, skillKey: WeaponSkillKey): WeaponSkillData | null {
  if (!isRecord(baseDraft) || !isRecord(baseDraft.skills)) {
    return null;
  }
  const skill = baseDraft.skills[skillKey];
  return isRecord(skill) ? skill as unknown as WeaponSkillData : null;
}

function getWeaponEffects(skill: WeaponSkillData): Record<string, WeaponEffectData> | null {
  return isRecord(skill.effects)
    ? skill.effects as unknown as Record<string, WeaponEffectData>
    : null;
}

function findFirstEffectKey(effects: Readonly<Record<string, WeaponEffectData>>): string {
  let effectIndex = 1;
  while (effects[`effect${effectIndex}`]) {
    effectIndex += 1;
  }
  return `effect${effectIndex}`;
}

function cloneDraftForEdit(baseDraft: WeaponDraft): WeaponDraft {
  return cloneValue(baseDraft);
}

function buildEmptyWeaponEffect(effectKey: string): WeaponEffectData {
  const levels: Record<string, number> = {};
  LEVEL_KEYS.forEach((levelKey) => {
    levels[levelKey] = 0;
  });
  return {
    schemaVersion: 2,
    effectId: effectKey,
    name: effectKey,
    type: '',
    category: 'condition',
    levels,
    valueMode: 'fixed',
    effectKind: 'modifier',
  };
}

export function resolveWeaponDraftForEdit(
  snapshot: WeaponDraftEditSnapshot,
  targetDraftKey: string,
): WeaponDraft | null {
  const activeDraft = snapshot.activeDraftKey === targetDraftKey && isRecord(snapshot.currentDraft)
    ? snapshot.currentDraft
    : null;
  const sourceDraft = activeDraft ?? snapshot.library[targetDraftKey];
  if (!isRecord(sourceDraft)) {
    return null;
  }
  return cloneValue(sourceDraft as unknown as WeaponDraft);
}

export function createWeaponEffect(
  baseDraft: WeaponDraft,
  skillKey: WeaponSkillKey,
): WeaponEffectEditResult | null {
  const skill = getWeaponSkill(baseDraft, skillKey);
  const effects = skill ? getWeaponEffects(skill) : null;
  if (!effects) {
    return null;
  }

  const effectKey = findFirstEffectKey(effects);
  const nextDraft = cloneDraftForEdit(baseDraft);
  const nextSkill = getWeaponSkill(nextDraft, skillKey);
  const nextEffects = nextSkill ? getWeaponEffects(nextSkill) : null;
  if (!nextEffects) {
    return null;
  }
  nextEffects[effectKey] = buildEmptyWeaponEffect(effectKey);

  return {
    nextDraft,
    effectKey,
    focusRowKey: buildWeaponEffectRowKey(skillKey, 'effect', effectKey),
  };
}

export function duplicateWeaponEffect(
  baseDraft: WeaponDraft,
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
): WeaponEffectEditResult | null {
  if (bucket === 'value') {
    return null;
  }

  const skill = getWeaponSkill(baseDraft, skillKey);
  const effects = skill ? getWeaponEffects(skill) : null;
  const sourceEffect = effects?.[effectKey];
  if (!effects || !isRecord(sourceEffect)) {
    return null;
  }

  const newEffectKey = findFirstEffectKey(effects);
  const nextDraft = cloneDraftForEdit(baseDraft);
  const nextSkill = getWeaponSkill(nextDraft, skillKey);
  const nextEffects = nextSkill ? getWeaponEffects(nextSkill) : null;
  if (!nextEffects) {
    return null;
  }
  nextEffects[newEffectKey] = cloneValue(sourceEffect as unknown as WeaponEffectData);

  return {
    nextDraft,
    effectKey: newEffectKey,
    focusRowKey: buildWeaponEffectRowKey(skillKey, 'effect', newEffectKey),
  };
}

export function deleteWeaponEffect(
  baseDraft: WeaponDraft,
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
): WeaponEffectDeleteResult | null {
  const skill = getWeaponSkill(baseDraft, skillKey);
  if (!skill) {
    return null;
  }

  if (bucket === 'value') {
    if (!isRecord(skill.levels)) {
      return null;
    }
    const nextDraft = cloneDraftForEdit(baseDraft);
    const nextSkill = getWeaponSkill(nextDraft, skillKey);
    if (!nextSkill || !isRecord(nextSkill.levels)) {
      return null;
    }
    LEVEL_KEYS.forEach((levelKey) => {
      const level = nextSkill.levels[levelKey];
      const description = isRecord(level) && typeof level.description === 'string'
        ? level.description
        : '';
      nextSkill.levels[levelKey] = {
        description,
        value: undefined,
      };
    });
    return {
      nextDraft,
      focusRowKey: `skill-${skillKey}`,
    };
  }

  const effects = getWeaponEffects(skill);
  if (!effects || !isRecord(effects[effectKey])) {
    return null;
  }
  const nextDraft = cloneDraftForEdit(baseDraft);
  const nextSkill = getWeaponSkill(nextDraft, skillKey);
  const nextEffects = nextSkill ? getWeaponEffects(nextSkill) : null;
  if (!nextEffects || !isRecord(nextEffects[effectKey])) {
    return null;
  }
  delete nextEffects[effectKey];
  return {
    nextDraft,
    focusRowKey: `skill-${skillKey}`,
  };
}
