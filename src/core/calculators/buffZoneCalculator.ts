import type { HitSkillType, ElementType } from '../../types';
import type { DamageBonusSnapshot, SkillButtonBuff } from '../../types/storage';
import type { SupportedBuffZone, BuffTypeMatchRule } from '../domain/buffTypeRegistry';
import { getBuffTypeRegistryEntry } from '../domain/buffTypeRegistry';
import { normalizeBuffMultiplier } from '../domain/buffMultiplier';

export interface ResolvedBuffInstanceValue {
  buffId: string;
  rawValue: number;
  runtimeCoefficient: number;
  effectiveValue: number;
}

export interface BuffContribution extends ResolvedBuffInstanceValue {
  type: string;
  zone: SupportedBuffZone;
  multiplier: boolean;
  multiplierCoefficient?: number;
}

export interface ZoneCalculationResult {
  additiveContributions: BuffContribution[];
  multiplierContributions: BuffContribution[];
  additiveTotal: number;
  multiplierProduct: number;
  finalValue: number;
}

export interface HitBuffZoneResults {
  damageBonus: ZoneCalculationResult;
  fragile: ZoneCalculationResult;
  vulnerability: ZoneCalculationResult;
  amplify: ZoneCalculationResult;
  skillMultiplier: ZoneCalculationResult;
  contributions: BuffContribution[];
}

export interface BuffHitContext {
  element: ElementType;
  skillType: HitSkillType;
}

function normalizeMaxStacks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function resolveBuffInstanceValue(
  buff: SkillButtonBuff,
  stackCounts: Record<string, number> = {}
): ResolvedBuffInstanceValue {
  const rawValue = typeof buff.value === 'number' && Number.isFinite(buff.value) ? buff.value : 0;
  const isCountable = buff.category === 'countable';
  const maxStacks = normalizeMaxStacks(buff.maxStacks);
  const storedCoefficient = stackCounts[buff.id];
  const runtimeCoefficient = isCountable
    ? (typeof storedCoefficient === 'number' && Number.isFinite(storedCoefficient)
      ? Math.min(Math.max(Math.floor(storedCoefficient), 0), maxStacks)
      : maxStacks)
    : 1;

  return {
    buffId: buff.id,
    rawValue,
    runtimeCoefficient,
    effectiveValue: rawValue * runtimeCoefficient,
  };
}

function matchesRule(rule: BuffTypeMatchRule, context: BuffHitContext): boolean {
  switch (rule.kind) {
    case 'all':
      return true;
    case 'physical':
      return context.element === 'physical';
    case 'magic':
      return context.element === 'fire'
        || context.element === 'electric'
        || context.element === 'ice'
        || context.element === 'nature';
    case 'element':
      return context.element === rule.element;
    case 'skillType':
      return context.skillType === rule.skillType;
    case 'skillTypes':
      return rule.skillTypes.includes(context.skillType);
  }
}

function toContribution(
  buff: SkillButtonBuff,
  context: BuffHitContext,
  stackCounts: Record<string, number>
): BuffContribution | null {
  if (buff.effectKind === 'extraHit' || !buff.type) return null;

  // 旧 multiplierMultiplier 只在兼容读取尚未执行时兜底。
  if (buff.type === 'multiplierMultiplier') {
    const coefficient = typeof buff.value === 'number' && Number.isFinite(buff.value) && buff.value > 0
      ? buff.value
      : 1;
    return {
      buffId: buff.id,
      type: 'multiplierBonus',
      zone: 'skillMultiplier',
      multiplier: true,
      rawValue: 0,
      runtimeCoefficient: 1,
      effectiveValue: coefficient,
      multiplierCoefficient: coefficient,
    };
  }

  const entry = getBuffTypeRegistryEntry(buff.type);
  if (!entry || !matchesRule(entry.match, context)) return null;

  const multiplier = normalizeBuffMultiplier(buff.multiplier);
  if (multiplier) {
    return {
      buffId: buff.id,
      type: buff.type,
      zone: entry.zone,
      multiplier: true,
      rawValue: 0,
      runtimeCoefficient: 1,
      effectiveValue: multiplier.coefficient,
      multiplierCoefficient: multiplier.coefficient,
    };
  }

  return {
    ...resolveBuffInstanceValue(buff, stackCounts),
    type: buff.type,
    zone: entry.zone,
    multiplier: false,
  };
}

function createZoneResult(
  zone: SupportedBuffZone,
  contributions: BuffContribution[],
  baseValue: number
): ZoneCalculationResult {
  const zoneContributions = contributions.filter((contribution) => contribution.zone === zone);
  const additiveContributions = zoneContributions.filter((contribution) => !contribution.multiplier);
  const multiplierContributions = zoneContributions.filter((contribution) => contribution.multiplier);
  const additiveTotal = additiveContributions.reduce((total, contribution) => total + contribution.effectiveValue, 0);
  const multiplierProduct = multiplierContributions.reduce(
    (product, contribution) => product * (contribution.multiplierCoefficient ?? 1),
    1
  );

  return {
    additiveContributions,
    multiplierContributions,
    additiveTotal,
    multiplierProduct,
    finalValue: multiplierProduct * (baseValue + additiveTotal),
  };
}

function readPanelDamageBonus(
  damageBonus: DamageBonusSnapshot,
  context: BuffHitContext
): number {
  const record = damageBonus as unknown as Record<string, number | undefined>;
  let total = record.allDmgBonus ?? 0;

  if (context.element === 'physical') {
    total += record.physicalDmgBonus ?? 0;
  } else {
    total += record.magicDmgBonus ?? 0;
    total += record[`${context.element}DmgBonus`] ?? 0;
    total += record.allElementDmgBonus ?? 0;
  }

  switch (context.skillType) {
    case 'A':
      total += record.normalAttackDmgBonus ?? 0;
      break;
    case 'Dot':
      total += record.dotDmgBonus ?? 0;
      break;
    case 'B':
      total += (record.skillDmgBonus ?? 0) + (record.allSkillDmgBonus ?? 0);
      break;
    case 'E':
      total += (record.chainSkillDmgBonus ?? 0) + (record.allSkillDmgBonus ?? 0);
      break;
    case 'Q':
      total += (record.ultimateDmgBonus ?? 0) + (record.allSkillDmgBonus ?? 0);
      break;
  }

  return total;
}

export function calculateHitBuffZones(input: {
  context: BuffHitContext;
  buffs: SkillButtonBuff[];
  stackCounts?: Record<string, number>;
  damageBonus: DamageBonusSnapshot;
  baseSkillMultiplier: number;
}): HitBuffZoneResults {
  const contributions = input.buffs
    .map((buff) => toContribution(buff, input.context, input.stackCounts ?? {}))
    .filter((contribution): contribution is BuffContribution => contribution !== null);

  return {
    damageBonus: createZoneResult('damageBonus', contributions, 1 + readPanelDamageBonus(input.damageBonus, input.context)),
    fragile: createZoneResult('fragile', contributions, 1),
    vulnerability: createZoneResult('vulnerability', contributions, 1),
    amplify: createZoneResult('amplify', contributions, 1),
    skillMultiplier: createZoneResult('skillMultiplier', contributions, input.baseSkillMultiplier),
    contributions,
  };
}
