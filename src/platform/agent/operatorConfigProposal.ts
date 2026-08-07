import type { JsonValue } from '../../../agent/core/contracts/json.ts';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { TimelinePayloadDiff } from '../../agentKernel/timelineWorktree/types';

/**
 * The value returned to the Agent is deliberately smaller than the complete
 * operator calculator cache.  It describes the user-facing configuration and
 * excludes derived attack/stat caches, which are recomputed from the candidate
 * Work Node when the proposal is applied.
 */
export type OperatorConfigFinalConfig = {
  characterId: string;
  characterName: string;
  weapon: {
    id: string;
    name: string;
    level: string | number | null;
    potential: string | number | null;
    skillLevels: {
      skill1: string | number | null;
      skill2: string | number | null;
      skill3: string | number | null;
    };
  };
  equipment: Array<{
    slotKey: string;
    equipmentId: string;
    name: string;
    effects: Array<{
      effectId: string;
      label: string;
      level: string | number | null;
      value: number | null;
    }>;
  }>;
  operatorSkillLevels: Record<string, string | number | null>;
};

export type TimelinePreservationCheck = {
  path: string;
  pass: boolean;
  beforeDigest: string;
  afterDigest: string;
};

export type TimelinePreservation = {
  pass: boolean;
  preservedPaths: string[];
  changedPaths: string[];
  beforeDigest: string;
  afterDigest: string;
  checks: TimelinePreservationCheck[];
};

const TIMELINE_PRESERVED_PATHS = [
  'selectedCharacters',
  'timelineData',
  'skillButtonTable',
  'allBuffList',
  'anomalyStateSnapshots',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is required for operator-config proposal digests.');
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestJson(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(stableJson(value))}`;
}

function configPrimitive(value: unknown): string | number | null {
  return value === null || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function operatorSkillLevels(value: unknown): Record<string, string | number | null> {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.keys(source)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, configPrimitive(source[key])]),
  );
}

function normalizeEquipment(value: unknown): OperatorConfigFinalConfig['equipment'] {
  const source = isRecord(value) ? value : {};
  const pieces = Array.isArray(source.pieces) ? source.pieces : [];
  return pieces
    .map((piece): OperatorConfigFinalConfig['equipment'][number] => {
      const item = isRecord(piece) ? piece : {};
      const effects = Array.isArray(item.effects) ? item.effects : [];
      return {
        slotKey: text(item.slotKey),
        equipmentId: text(item.equipmentId),
        name: text(item.name),
        effects: effects
          .map((effect) => {
            const entry = isRecord(effect) ? effect : {};
            const value = configPrimitive(entry.value);
            return {
              effectId: text(entry.effectId),
              label: text(entry.label),
              level: configPrimitive(entry.level),
              value: typeof value === 'number' ? value : null,
            };
          })
          .sort((left, right) => (
            left.effectId.localeCompare(right.effectId)
            || left.label.localeCompare(right.label)
            || stableJson(left).localeCompare(stableJson(right))
          )),
      };
    })
    .sort((left, right) => (
      left.slotKey.localeCompare(right.slotKey)
      || left.equipmentId.localeCompare(right.equipmentId)
      || stableJson(left).localeCompare(stableJson(right))
    ));
}

/** Rebuild the user-visible configuration from a persisted Timeline payload. */
export function buildOperatorConfigFinalConfig(
  payload: TimelineSnapshotPayload,
  characterId: string,
): OperatorConfigFinalConfig | null {
  const cache = isRecord(payload.operatorConfigPageCache)
    ? payload.operatorConfigPageCache[characterId]
    : undefined;
  if (!isRecord(cache)) return null;
  const cacheRecord = cache as Record<string, unknown>;
  const operator = isRecord(cacheRecord.operator) ? cacheRecord.operator : {};
  const weapon = isRecord(cacheRecord.weapon) ? cacheRecord.weapon : {};
  const weaponConfig = isRecord(weapon.config) ? weapon.config : {};
  const skillLevels = isRecord(weaponConfig.skillLevels) ? weaponConfig.skillLevels : {};
  return {
    characterId,
    characterName: text(operator.name) || characterId,
    weapon: {
      id: text(weapon.id),
      name: text(weapon.name),
      level: configPrimitive(weaponConfig.level),
      potential: configPrimitive(weaponConfig.potential),
      skillLevels: {
        skill1: configPrimitive(skillLevels.skill1),
        skill2: configPrimitive(skillLevels.skill2),
        skill3: configPrimitive(skillLevels.skill3),
      },
    },
    equipment: normalizeEquipment(cacheRecord.equipment),
    operatorSkillLevels: operatorSkillLevels(operator.skillConfig),
  };
}

/**
 * Normalizes an untrusted finalConfig into the exact comparison shape.  The
 * caller must still compare this result with buildOperatorConfigFinalConfig;
 * this function is not an authority for the candidate payload.
 */
export function normalizeOperatorConfigFinalConfig(value: unknown): OperatorConfigFinalConfig | null {
  if (!isRecord(value)) return null;
  const characterId = text(value.characterId);
  if (!characterId) return null;
  const weapon = isRecord(value.weapon) ? value.weapon : {};
  const weaponSkillLevels = isRecord(weapon.skillLevels) ? weapon.skillLevels : {};
  return {
    characterId,
    characterName: text(value.characterName) || characterId,
    weapon: {
      id: text(weapon.id),
      name: text(weapon.name),
      level: configPrimitive(weapon.level),
      potential: configPrimitive(weapon.potential),
      skillLevels: {
        skill1: configPrimitive(weaponSkillLevels.skill1),
        skill2: configPrimitive(weaponSkillLevels.skill2),
        skill3: configPrimitive(weaponSkillLevels.skill3),
      },
    },
    equipment: normalizeEquipment({ pieces: value.equipment }),
    operatorSkillLevels: operatorSkillLevels(value.operatorSkillLevels),
  };
}

export function equalOperatorConfigFinalConfig(left: unknown, right: unknown): boolean {
  return Boolean(left && right) && stableJson(left) === stableJson(right);
}

export async function buildTimelinePreservation(
  before: TimelineSnapshotPayload,
  after: TimelineSnapshotPayload,
): Promise<TimelinePreservation> {
  const checks = await Promise.all(TIMELINE_PRESERVED_PATHS.map(async (path) => {
    const beforeValue = before[path];
    const afterValue = after[path];
    const [beforeDigest, afterDigest] = await Promise.all([
      digestJson(beforeValue),
      digestJson(afterValue),
    ]);
    return {
      path,
      pass: beforeDigest === afterDigest,
      beforeDigest,
      afterDigest,
    } satisfies TimelinePreservationCheck;
  }));
  const [beforeDigest, afterDigest] = await Promise.all([
    digestJson(Object.fromEntries(TIMELINE_PRESERVED_PATHS.map((path) => [path, before[path]]))),
    digestJson(Object.fromEntries(TIMELINE_PRESERVED_PATHS.map((path) => [path, after[path]]))),
  ]);
  return {
    pass: checks.every((check) => check.pass),
    preservedPaths: checks.filter((check) => check.pass).map((check) => check.path),
    changedPaths: checks.filter((check) => !check.pass).map((check) => check.path),
    beforeDigest,
    afterDigest,
    checks,
  };
}

export async function buildOperatorConfigProposalDigest(input: {
  parentNodeId: string;
  parentRevision: number;
  nodeId: string;
  nodeRevision: number;
  finalConfig: OperatorConfigFinalConfig;
  diff: TimelinePayloadDiff;
  timelinePreservation: TimelinePreservation;
  workingPayload: TimelineSnapshotPayload;
}): Promise<string> {
  const workingPayloadDigest = await digestJson(input.workingPayload);
  return digestJson({
    schemaVersion: 1,
    parentNodeId: input.parentNodeId,
    parentRevision: input.parentRevision,
    nodeId: input.nodeId,
    nodeRevision: input.nodeRevision,
    finalConfig: input.finalConfig,
    diff: input.diff,
    timelinePreservation: input.timelinePreservation,
    workingPayloadDigest,
  });
}

/**
 * Runs the irreversible part of an atomic rollback in a fixed order.  The
 * Canvas supplies the browser-SQLite and renderer operations; keeping the
 * orchestration here makes the failure contract directly testable:
 * candidate audit data is marked rolled back only after the exact parent
 * payload and checkout have both been observed again.
 */
export async function rollbackOperatorConfigProposal(input: {
  restoreLiveParent: () => Promise<void>;
  restoreCheckout: () => Promise<void>;
  verifyParentRestored: () => Promise<boolean>;
  markCandidateRollback: () => Promise<void>;
}): Promise<void> {
  await input.restoreLiveParent();
  await input.restoreCheckout();
  if (!await input.verifyParentRestored()) {
    throw new Error('operator-config-parent-rollback-postcondition-failed');
  }
  await input.markCandidateRollback();
}

export function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(stableJson(value)) as JsonValue;
}
