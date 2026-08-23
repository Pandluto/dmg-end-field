import type { ResolvedHitTemplate } from '../calculators/skillDamage.types';
import { normalizeBuffMultiplier } from '../domain/buffMultiplier';
import type {
  SingleHitBuffTargetByBuffId,
  SkillButtonBuff,
} from '../../types/storage';

export type { SingleHitBuffTargetByBuffId } from '../../types/storage';

export function isSingleHitMultiplierBonusBuff(buff: SkillButtonBuff): boolean {
  return buff.effectKind !== 'extraHit'
    && buff.type === 'multiplierBonus'
    && !normalizeBuffMultiplier(buff.multiplier);
}

export function doesBuffApplyToResolvedHit(
  buff: SkillButtonBuff,
  hit: ResolvedHitTemplate,
): boolean {
  const target = buff.target;
  if (!target || target.mode === 'all') return true;
  switch (target.mode) {
    case 'damageKey':
      return target.key === hit.key;
    case 'skillType':
      return target.skillType === hit.skillType;
    case 'element':
      return target.element === hit.element;
    default:
      return true;
  }
}

export function resolveSingleHitMultiplierBonusTarget(
  buff: SkillButtonBuff,
  originalHits: ResolvedHitTemplate[],
  disabledBuffIdsByHitKey: Record<string, string[]> = {},
  explicitTargets: SingleHitBuffTargetByBuffId = {},
): string | null {
  if (!isSingleHitMultiplierBonusBuff(buff)) return null;

  if (Object.prototype.hasOwnProperty.call(explicitTargets, buff.id)) {
    const explicitTarget = explicitTargets[buff.id];
    return typeof explicitTarget === 'string' && explicitTarget.trim()
      ? explicitTarget
      : null;
  }

  const eligibleHits = originalHits.filter((hit) => doesBuffApplyToResolvedHit(buff, hit));
  if (eligibleHits.length === 0) return null;

  const hasLegacyOverride = eligibleHits.some((hit) => (
    disabledBuffIdsByHitKey[hit.key]?.includes(buff.id) ?? false
  ));
  if (!hasLegacyOverride) {
    return eligibleHits[eligibleHits.length - 1]?.key ?? null;
  }

  const enabledHits = eligibleHits.filter((hit) => (
    !(disabledBuffIdsByHitKey[hit.key]?.includes(buff.id) ?? false)
  ));
  return enabledHits[enabledHits.length - 1]?.key ?? null;
}

export function resolveSingleHitMultiplierBonusTargets(
  buffs: SkillButtonBuff[],
  originalHits: ResolvedHitTemplate[],
  disabledBuffIdsByHitKey: Record<string, string[]> = {},
  explicitTargets: SingleHitBuffTargetByBuffId = {},
): SingleHitBuffTargetByBuffId {
  return Object.fromEntries(
    buffs
      .filter(isSingleHitMultiplierBonusBuff)
      .map((buff) => [
        buff.id,
        resolveSingleHitMultiplierBonusTarget(
          buff,
          originalHits,
          disabledBuffIdsByHitKey,
          explicitTargets,
        ),
      ]),
  );
}
