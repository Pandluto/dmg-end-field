import type { ConfigSnapshot } from '../calculators/operatorPanelCalculator';
import type { CandidateBuff } from '../domain/buff';
import { normalizeBuffMultiplier } from '../domain/buffMultiplier';
import type { RuntimeOperatorTemplateMap } from '../templates/operatorTemplate';
import type {
  BuffList,
  OperatorConfigPageCache,
  SkillButtonBuff,
} from '../../types/storage';

type BuffDefinitionRecord = Record<string, unknown> & {
  schemaVersion?: unknown;
  type?: unknown;
  value?: unknown;
  multiplier?: unknown;
  category?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeStoredBuffDefinition<T>(value: T): T {
  if (!isRecord(value)) return value;

  const source = value as BuffDefinitionRecord;
  const isLegacySkillMultiplier = source.type === 'multiplierMultiplier';
  const existingMultiplier = normalizeBuffMultiplier(source.multiplier);
  const legacyCoefficient = typeof source.value === 'number'
    && Number.isFinite(source.value)
    && source.value > 0
    ? source.value
    : undefined;
  const multiplier = existingMultiplier
    ?? (isLegacySkillMultiplier ? { coefficient: legacyCoefficient ?? 1 } : undefined);

  if (!isLegacySkillMultiplier && source.multiplier === undefined && source.schemaVersion === 2) {
    return value;
  }

  const normalized: BuffDefinitionRecord = {
    ...source,
    schemaVersion: 2,
    ...(isLegacySkillMultiplier ? { type: 'multiplierBonus' } : {}),
  };

  if (multiplier) {
    normalized.multiplier = multiplier;
    normalized.category = 'condition';
  } else {
    delete normalized.multiplier;
  }
  if (isLegacySkillMultiplier) {
    delete normalized.value;
  }

  return normalized as T;
}

export function normalizeStoredBuffList(value: unknown): BuffList {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((buff) => normalizeStoredBuffDefinition(buff as unknown as SkillButtonBuff));
}

export function normalizeStoredCandidateBuffList(value: unknown): CandidateBuff[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((buff) => normalizeStoredBuffDefinition(buff as unknown as CandidateBuff));
}

function normalizeOperatorBuffGroups(value: unknown): unknown {
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([groupKey, rawGroup]) => {
      if (!isRecord(rawGroup) || !isRecord(rawGroup.effects)) {
        return [groupKey, rawGroup];
      }
      return [
        groupKey,
        {
          ...rawGroup,
          effects: Object.fromEntries(
            Object.entries(rawGroup.effects).map(([effectKey, effect]) => [
              effectKey,
              normalizeStoredBuffDefinition(effect),
            ])
          ),
        },
      ];
    })
  );
}

function parsePotentialToCount(potential: unknown): number {
  if (typeof potential !== 'string') return 1;
  if (potential.trim() === '满潜') return 6;
  const numeric = Number.parseInt(potential, 10);
  if (Number.isNaN(numeric)) return 1;
  return Math.min(6, Math.max(1, numeric + 1));
}

export function normalizeStoredConfigSnapshot<T extends ConfigSnapshot>(snapshot: T): T {
  if (!isRecord(snapshot) || !isRecord(snapshot.operator)) return snapshot;

  const weapon = isRecord(snapshot.weapon) ? snapshot.weapon : undefined;
  const weaponConfig = weapon && isRecord(weapon.config) ? weapon.config : undefined;
  return {
    ...snapshot,
    operator: {
      ...snapshot.operator,
      potentialCount: parsePotentialToCount(snapshot.operator.potential),
      buffs: normalizeOperatorBuffGroups(snapshot.operator.buffs) as T['operator']['buffs'],
    },
    ...(weapon && weaponConfig ? {
      weapon: {
        ...weapon,
        config: {
          ...weaponConfig,
          potentialCount: parsePotentialToCount(weaponConfig.potential),
        },
      },
    } : {}),
  };
}

export function normalizeStoredOperatorConfigPageCache(value: unknown): OperatorConfigPageCache {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, snapshot]) => isRecord(snapshot))
      .map(([characterId, snapshot]) => [
        characterId,
        normalizeStoredConfigSnapshot(snapshot as unknown as ConfigSnapshot),
      ])
  ) as OperatorConfigPageCache;
}

export function normalizeStoredRuntimeOperatorTemplateMap(value: unknown): RuntimeOperatorTemplateMap {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .flatMap(([characterId, template]) => {
        if (!isRecord(template)) return [];
        return [[
          characterId,
          {
            ...template,
            buffs: normalizeOperatorBuffGroups(template.buffs),
          },
        ]];
      })
  ) as RuntimeOperatorTemplateMap;
}
