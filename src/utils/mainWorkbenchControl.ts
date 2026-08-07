import type { Character, SkillButtonType } from '../types';
import type { DamageReportSnapshot } from '../core/services/damageReportService';
import type {
  SkillButtonBuff,
  SkillButtonPanelConfig,
} from '../types/storage';
import type { TimelineWorkNodePatchOperation } from '../agentKernel/timelineWorktree/patchDsl';
import type { AiTimelineNodeReviewProjection } from '../agentKernel/timelineWorktree/nodeReview';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
import { browserAgentRuntime } from '../platform/agent/browserAgentRuntime';
import {
  discoverGearTopologies,
  getAgentBuildGuide,
  getCompatibleWeapons,
  getGearTopologyFacts,
  getSkillFact,
  planGearTopology,
  queryAgentProductCatalog,
  readAgentProductCatalogInput,
  type AgentCatalogDomain,
  type AgentProductCatalogStorage,
} from '../core/services/agentProductCatalogService';
export const MAIN_WORKBENCH_COMMAND_QUEUE_KEY = 'def.main-workbench.command-queue.v1';
export const MAIN_WORKBENCH_RESULT_LOG_KEY = 'def.main-workbench.result-log.v1';
export const MAIN_WORKBENCH_SNAPSHOT_KEY = 'def.main-workbench.snapshot.v1';
export const MAIN_WORKBENCH_CONTROL_EVENT = 'def-main-workbench-control';
export type MainWorkbenchCommandStatus = 'pending' | 'running' | 'done' | 'error';

export type AgentProductCatalogAction =
  | 'query'
  | 'compatibleWeapons'
  | 'gearTopologyFacts'
  | 'gearTopologyPlan'
  | 'discoverGearTopologies'
  | 'skillFact'
  | 'buildGuide';

export type AgentProductCatalogCommand =
  | {
      op: 'queryAgentProductCatalog';
      action: 'query';
      domain: AgentCatalogDomain;
      query?: string;
      limit?: number;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'compatibleWeapons';
      operatorQuery: string;
      weaponQuery?: string;
      limit?: number;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'gearTopologyFacts';
      setQuery: string;
      allowDuplicateCompatibleAccessories?: boolean;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'gearTopologyPlan';
      setQuery: string;
      limit?: number;
      allowDuplicateCompatibleAccessories?: boolean;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'discoverGearTopologies';
      limit?: number;
      combinationsPerSet?: number;
      allowDuplicateCompatibleAccessories?: boolean;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'skillFact';
      operatorQuery: string;
      skillQuery: string;
      hitQuery?: string;
    }
  | {
      op: 'queryAgentProductCatalog';
      action: 'buildGuide';
      operatorQuery: string;
    };

export type MainWorkbenchCommand =
  | AgentProductCatalogCommand
  | {
      op: 'selectCharacters';
      characterIds?: string[];
      characterNames?: string[];
      nodeTitle?: string;
      nodeDescription?: string;
      approval?: {
        mode: 'manual';
        approvedBy: 'user';
        rationale?: string;
      };
      /** @deprecated Selection workspace policy decides whether a fresh SQLite is required. */
      resetTimeline?: boolean;
      openCanvas?: boolean;
    }
  | {
      op: 'openView';
      view: 'selection' | 'canvas';
    }
  | {
      op: 'clearTimeline';
    }
  | {
      op: 'openWorkbenchPage';
      page:
        | 'home'
        | 'selection'
        | 'canvas'
        | 'operatorConfig'
        | 'weaponSheet'
        | 'equipmentSheet'
        | 'damageReportPpt';
      characterId?: string;
      characterName?: string;
    }
  | {
      op: 'addSkillButton';
      buttonId?: string;
      characterId?: string;
      characterName?: string;
      skillType?: SkillButtonType;
      runtimeSkillId?: string;
      skillDisplayName?: string;
      staffIndex?: number;
      nodeIndex?: number;
      select?: boolean;
    }
  | {
      op: 'removeSkillButton';
      buttonId?: string;
      characterId?: string;
      characterName?: string;
      skillType?: SkillButtonType;
      nodeIndex?: number;
      latest?: boolean;
    }
  | {
      op: 'addBuff';
      buttonId?: string;
      characterId?: string;
      characterName?: string;
      skillType?: SkillButtonType;
      nodeIndex?: number;
      buff: Omit<SkillButtonBuff, 'id'> & { id?: string };
      select?: boolean;
    }
  | {
      op: 'addBuffToButtons';
      buttonIds: string[];
      buff: Omit<SkillButtonBuff, 'id'> & { id?: string };
      skipDuplicates?: boolean;
    }
  | {
      op: 'removeBuff';
      buttonId?: string;
      characterId?: string;
      characterName?: string;
      skillType?: SkillButtonType;
      nodeIndex?: number;
      buffId?: string;
      name?: string;
      displayName?: string;
      buffDisplayName?: string;
      latest?: boolean;
      count?: number;
      all?: boolean;
    }
  | {
      op: 'setTargetResistance';
      buttonId: string;
      targetResistance: Record<string, number>;
    }
  | {
      op: 'calculateDamage';
      buttonId?: string;
    }
  | {
      op: 'saveTimelineSnapshot';
      label?: string;
    }
  | {
      op: 'restoreTimelineSnapshot';
      snapshotId?: string;
      label?: string;
      latest?: boolean;
      reload?: boolean;
    }
  | {
      op: 'listTimelineSnapshots';
    }
  | {
      op: 'createAiTimelineWorkNodeFromCurrent';
      timelineId?: string;
      branchId?: string;
      parentNodeId?: string | null;
      label?: string;
      description?: string;
      approvalPolicy?: 'auto-low-risk' | 'ask-on-risk' | 'manual';
    }
  | {
      op: 'diffAiTimelineWorkNode';
      nodeId: string;
    }
  | {
      /** Read the browser SQLite Work Node index without touching checkout. */
      op: 'listAiTimelineWorkNodes';
      timelineId?: string;
    }
  | {
      /** Read one browser SQLite Work Node. This command never hydrates Canvas. */
      op: 'readAiTimelineWorkNode';
      nodeId: string;
      includePayload?: boolean;
    }
  | {
      /** Validate a Work Node and optionally repair only its status to ready. */
      op: 'validateAiTimelineWorkNode';
      nodeId: string;
      repairStatus?: boolean;
    }
  | {
      /** Delete a Work Node subtree through the browser repository constraint. */
      op: 'deleteAiTimelineWorkNode';
      nodeId: string;
    }
  | {
      op: 'patchAiTimelineWorkNode';
      nodeId: string;
      patch: TimelineWorkNodePatchOperation[];
      dryRun?: boolean;
    }
  | {
      op: 'patchAndValidateAiTimelineWorkNode';
      nodeId?: string;
      timelineId?: string;
      branchId?: string;
      label?: string;
      description?: string;
      parentNodeId?: string | null;
      approvalPolicy?: 'auto-low-risk' | 'ask-on-risk' | 'manual';
      patch: TimelineWorkNodePatchOperation[];
      dryRun?: boolean;
      checkout?: false;
    }
  | {
      /**
       * Agent-only composite used after one exact DEF approval. It creates or
       * updates an isolated Work Node, validates it, then performs the manual
       * checkout in the same foreground renderer command.
       */
      op: 'applyApprovedWorkNodePatch';
      patch: TimelineWorkNodePatchOperation[];
      label?: string;
      description?: string;
    }
  | {
      op: 'checkoutAiTimelineWorkNode';
      nodeId: string;
      commitId?: string;
      reload?: boolean;
      approval?: {
        mode?: 'auto' | 'manual';
        approvedBy?: 'ai' | 'user' | 'system';
        rationale?: string;
      };
    }
  | {
      op: 'restoreAiTimelineWorkNodeBase';
      nodeId: string;
      reload?: boolean;
      approval?: {
        mode?: 'manual';
        approvedBy?: 'ai' | 'user' | 'system';
        rationale?: string;
      };
    }
  | {
      op: 'refreshOperatorConfig';
    }
  | {
      op: 'setOperatorWeapon';
      characterId?: string;
      characterName?: string;
      weaponName: string;
      level?: number | string;
      potential?: string;
      skillLevels?: {
        skill1?: number;
        skill2?: number;
        skill3?: number;
      };
    }
  | {
      op: 'setOperatorEquipment';
      characterId?: string;
      characterName?: string;
      slotKey?: 'armor' | 'accessory2' | 'accessory1' | 'glove';
      part?: '护甲' | '护手' | '配件';
      equipmentId?: string;
      equipmentName?: string;
      gearSetId?: string;
      gearSetName?: string;
      fillSlots?: boolean;
      entryLevel?: number | string;
      entryLevels?: Array<number | string> | Record<string, number | string>;
      equipments?: Array<{
        slotKey?: 'armor' | 'accessory2' | 'accessory1' | 'glove';
        part?: '护甲' | '护手' | '配件';
        equipmentId?: string;
        equipmentName?: string;
        gearSetId?: string;
        gearSetName?: string;
        entryLevel?: number | string;
        entryLevels?: Array<number | string> | Record<string, number | string>;
      }>;
    }
  | {
      // Persists weapon plus four-piece loadout as one checkout revision.
      op: 'setOperatorConfig';
      characterId?: string;
      characterName?: string;
      weaponName?: string;
      weaponLevel?: number | string;
      weaponSkillLevels?: {
        skill1?: number;
        skill2?: number;
        skill3?: number;
      };
      level?: number | string;
      potential?: string;
      skillLevels?: {
        skill1?: number;
        skill2?: number;
        skill3?: number;
      };
      operatorSkillLevels?: {
        A?: 'L9' | 'M3';
        B?: 'L9' | 'M3';
        E?: 'L9' | 'M3';
        Q?: 'L9' | 'M3';
      };
      slotKey?: 'armor' | 'accessory2' | 'accessory1' | 'glove';
      part?: '护甲' | '护手' | '配件';
      equipmentId?: string;
      equipmentName?: string;
      gearSetId?: string;
      gearSetName?: string;
      fillSlots?: boolean;
      entryLevel?: number | string;
      entryLevels?: Array<number | string> | Record<string, number | string>;
      equipmentEntryLevel?: number | string;
      equipmentEntryLevels?: Array<number | string> | Record<string, number | string>;
      equipments?: Array<{
        slotKey?: 'armor' | 'accessory2' | 'accessory1' | 'glove';
        part?: '护甲' | '护手' | '配件';
        equipmentId?: string;
        equipmentName?: string;
        gearSetId?: string;
        gearSetName?: string;
        entryLevel?: number | string;
        entryLevels?: Array<number | string> | Record<string, number | string>;
      }>;
    }
  | {
      // Pure renderer-side resolution. This command must not touch the live
      // mirror: the REST bridge turns its resulting payload into an isolated
      // child Work Node for native approval.
      op: 'previewOperatorConfig';
      request: Extract<MainWorkbenchCommand, { op: 'setOperatorConfig' }>;
    }
  | {
      /**
       * Resolve one configuration request and persist only an isolated manual
       * Work Node. The current checkout and renderer cache remain untouched.
       */
      op: 'prepareOperatorConfigProposal';
      request: Extract<MainWorkbenchCommand, { op: 'setOperatorConfig' }>;
      label: string;
      description: string;
    }
  | {
      // Applies the already reviewed child node only if the original checkout
      // still has the same revision. Commit/checkout bookkeeping happens in
      // the bridge after this renderer acknowledgement.
      op: 'applyPreparedOperatorConfig';
      parentNodeId: string;
      parentRevision: number;
      nodeId: string;
      nodeRevision: number;
    }
  | {
      /**
       * Atomically apply a prepared operator-config Work Node after the
       * BrowserAgentRuntime has verified the signed approval capability.
       */
      op: 'applyPreparedOperatorConfigProposal';
      parentNodeId: string;
      parentRevision: number;
      nodeId: string;
      nodeRevision: number;
      proposalDigest: string;
      finalConfig: Record<string, unknown>;
      approval: {
        mode: 'manual';
        approvedBy: 'user';
        rationale?: string;
      };
    }
  | {
      // Runs only after the bridge has marked this reviewed child commit as
      // checkout-applied. It synchronizes the renderer session to that same
      // child and never changes configuration values.
      op: 'finalizePreparedOperatorConfig';
      nodeId: string;
      commitId: string;
    }
  | {
      // Internal reconciliation only. Restores the exact parent payload after
      // an atomic candidate failed after touching the live Workbench.
      op: 'restoreAtomicTeamParent';
      parentNodeId: string;
      parentRevision: number;
      expectedTimelineId: string;
      expectedCheckoutNodeId: string;
      candidateNodeId: string;
      candidateRevision: number;
    }
  | {
      op: 'refreshSnapshot';
    };

export interface AgentProductCatalogCommandResult {
  ok: true;
  readOnly: true;
  op: 'queryAgentProductCatalog';
  action: AgentProductCatalogAction;
  source: 'browser-sqlite-mirror';
  payload: unknown;
}

/**
 * Executes the browser facts command without crossing into a mutation path.
 * The renderer passes its persistent browser storage explicitly so this
 * command cannot accidentally fall back to legacy Node/REST data sources.
 */
export function executeAgentProductCatalogCommand(
  command: AgentProductCatalogCommand,
  storage: AgentProductCatalogStorage = persistentLocalStorage,
): AgentProductCatalogCommandResult {
  const input = readAgentProductCatalogInput(storage);
  let payload: unknown;
  switch (command.action) {
    case 'query':
      payload = queryAgentProductCatalog(input, {
        domain: command.domain,
        query: command.query,
        limit: command.limit,
      });
      break;
    case 'compatibleWeapons':
      payload = getCompatibleWeapons(input, {
        operatorQuery: command.operatorQuery,
        weaponQuery: command.weaponQuery,
        limit: command.limit,
      });
      break;
    case 'gearTopologyFacts':
      payload = getGearTopologyFacts(input, {
        setQuery: command.setQuery,
        allowDuplicateCompatibleAccessories: command.allowDuplicateCompatibleAccessories === true,
      });
      break;
    case 'gearTopologyPlan':
      payload = planGearTopology(input, {
        setQuery: command.setQuery,
        limit: command.limit,
        allowDuplicateCompatibleAccessories: command.allowDuplicateCompatibleAccessories === true,
      });
      break;
    case 'discoverGearTopologies':
      payload = discoverGearTopologies(input, {
        limit: command.limit,
        combinationsPerSet: command.combinationsPerSet,
        allowDuplicateCompatibleAccessories: command.allowDuplicateCompatibleAccessories === true,
      });
      break;
    case 'skillFact':
      payload = getSkillFact(input, {
        operatorQuery: command.operatorQuery,
        skillQuery: command.skillQuery,
        hitQuery: command.hitQuery,
      });
      break;
    case 'buildGuide':
      payload = getAgentBuildGuide(input, command.operatorQuery);
      break;
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported agent product catalog action: ${String(exhaustive)}`);
    }
  }
  return {
    ok: true,
    readOnly: true,
    op: 'queryAgentProductCatalog',
    action: command.action,
    source: 'browser-sqlite-mirror',
    payload,
  };
}

export interface QueuedMainWorkbenchCommand {
  id: string;
  command: MainWorkbenchCommand;
  status: MainWorkbenchCommandStatus;
  source: 'browser' | 'rest' | 'script' | string;
  createdAt: number;
  updatedAt: number;
  batchId?: string;
  batchIndex?: number;
  batchSize?: number;
  result?: unknown;
  error?: string;
}

/**
 * The browser-to-Agent boundary must contain facts, not renderer objects.
 * Every optional Buff field is represented explicitly as null so a missing
 * field cannot be mistaken for a value the model is allowed to infer.
 */
export interface MainWorkbenchBuffProjection {
  schemaVersion: 2 | null;
  id: string | null;
  name: string | null;
  displayName: string | null;
  sourceName: string | null;
  level: string | null;
  type: string | null;
  value: number | null;
  description: string | null;
  source: string | null;
  condition: string | null;
  category: string | null;
  effectKind: string | null;
  ownerBuffDomain: string | null;
  ownerCharacterId: string | null;
  ownerBuffGroup: string | null;
  maxStacks: number | null;
  refCount: number | null;
  multiplier: { coefficient: number | null } | null;
  target: {
    mode: string | null;
    key: string | null;
    skillType: string | null;
    element: string | null;
  } | null;
  valueMode: string | null;
  derivedValue: {
    source: string | null;
    perPointValue: number | null;
  } | null;
  extraHitConfig: {
    key: string | null;
    damageType: string | null;
    skillType: string | null;
    baseMultiplier: number | null;
    imbalanceValue: number | null;
    cooldownSeconds: number | null;
    trigger: string | null;
  } | null;
}

export interface MainWorkbenchButtonStateProjection {
  selectedBuffIds: string[];
  selectedBuffs: MainWorkbenchBuffProjection[];
  /** Effective current count per selected Buff, including default counts. */
  currentStackCounts: Record<string, number | null>;
  /** Whether a stack count was persisted or came from the product default rule. */
  currentStackCountSources: Record<string, 'persisted' | 'default-max-stacks' | 'default-one' | 'unavailable'>;
  globallyDisabledBuffIds: string[];
  manualDisabledBuffIdsBySegmentKey: Record<string, string[]>;
  manualBuffStackCountsBySegmentKey: Record<string, Record<string, number>>;
  manualDisabledHitKeys: string[];
  targetResistance: Record<string, number | null>;
}

const MAIN_WORKBENCH_RESISTANCE_KEYS = [
  'physicalResistance',
  'fireResistance',
  'electricResistance',
  'iceResistance',
  'natureResistance',
] as const;

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function projectTarget(target: SkillButtonBuff['target'] | null | undefined): MainWorkbenchBuffProjection['target'] {
  if (!target || typeof target !== 'object') return null;
  return {
    mode: stringOrNull(target.mode),
    key: 'key' in target ? stringOrNull(target.key) : null,
    skillType: 'skillType' in target ? stringOrNull(target.skillType) : null,
    element: 'element' in target ? stringOrNull(target.element) : null,
  };
}

/** Convert a runtime Buff entity into a JSON-safe, inference-free fact row. */
export function projectMainWorkbenchBuff(
  buff: SkillButtonBuff | null | undefined,
): MainWorkbenchBuffProjection {
  if (!buff) {
    return {
      schemaVersion: null,
      id: null,
      name: null,
      displayName: null,
      sourceName: null,
      level: null,
      type: null,
      value: null,
      description: null,
      source: null,
      condition: null,
      category: null,
      effectKind: null,
      ownerBuffDomain: null,
      ownerCharacterId: null,
      ownerBuffGroup: null,
      maxStacks: null,
      refCount: null,
      multiplier: null,
      target: null,
      valueMode: null,
      derivedValue: null,
      extraHitConfig: null,
    };
  }

  return {
    schemaVersion: buff.schemaVersion === 2 ? 2 : null,
    id: stringOrNull(buff.id),
    name: stringOrNull(buff.name),
    displayName: stringOrNull(buff.displayName),
    sourceName: stringOrNull(buff.sourceName),
    level: stringOrNull(buff.level),
    type: stringOrNull(buff.type),
    value: finiteNumberOrNull(buff.value),
    description: stringOrNull(buff.description),
    source: stringOrNull(buff.source),
    condition: stringOrNull(buff.condition),
    category: stringOrNull(buff.category),
    effectKind: stringOrNull(buff.effectKind),
    ownerBuffDomain: stringOrNull(buff.ownerBuffDomain),
    ownerCharacterId: stringOrNull(buff.ownerCharacterId),
    ownerBuffGroup: stringOrNull(buff.ownerBuffGroup),
    maxStacks: finiteNumberOrNull(buff.maxStacks),
    refCount: finiteNumberOrNull(buff.refCount),
    multiplier: buff.multiplier && typeof buff.multiplier === 'object'
      ? { coefficient: finiteNumberOrNull(buff.multiplier.coefficient) }
      : null,
    target: projectTarget(buff.target),
    valueMode: stringOrNull(buff.valueMode),
    derivedValue: buff.derivedValue && typeof buff.derivedValue === 'object'
      ? {
          source: stringOrNull(buff.derivedValue.source),
          perPointValue: finiteNumberOrNull(buff.derivedValue.perPointValue),
        }
      : null,
    extraHitConfig: buff.extraHitConfig && typeof buff.extraHitConfig === 'object'
      ? {
          key: stringOrNull(buff.extraHitConfig.key),
          damageType: stringOrNull(buff.extraHitConfig.damageType),
          skillType: stringOrNull(buff.extraHitConfig.skillType),
          baseMultiplier: finiteNumberOrNull(buff.extraHitConfig.baseMultiplier),
          imbalanceValue: finiteNumberOrNull(buff.extraHitConfig.imbalanceValue),
          cooldownSeconds: finiteNumberOrNull(buff.extraHitConfig.cooldownSeconds),
          trigger: stringOrNull(buff.extraHitConfig.trigger),
        }
      : null,
  };
}

function projectTargetResistance(value: unknown): Record<string, number | null> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const keys = new Set<string>([
    ...MAIN_WORKBENCH_RESISTANCE_KEYS,
    ...Object.keys(source),
  ]);
  return Object.fromEntries(
    [...keys]
      .sort()
      .map((key) => [key, finiteNumberOrNull(source[key])]),
  );
}

function projectStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function projectStringArrayMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([segmentKey]) => typeof segmentKey === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([segmentKey, buffIds]) => [segmentKey, projectStringArray(buffIds)]),
  );
}

function projectNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([buffId, count]) => [buffId, count as number]),
  );
}

function effectiveStackCount(
  buff: MainWorkbenchBuffProjection,
  rawCount: number | null,
): { value: number; source: 'persisted' | 'default-max-stacks' | 'default-one' } {
  const maxStacks = buff.category === 'countable' && buff.maxStacks !== null && buff.maxStacks > 0
    ? Math.floor(buff.maxStacks)
    : 1;
  if (rawCount !== null) {
    return {
      value: Math.min(maxStacks, Math.max(0, Math.floor(rawCount))),
      source: 'persisted',
    };
  }
  return buff.category === 'countable'
    ? { value: maxStacks, source: 'default-max-stacks' }
    : { value: 1, source: 'default-one' };
}

/**
 * Project all button-scoped Buff facts and controls in one JSON-safe shape.
 * `selectedBuffIds` remains authoritative even when an old snapshot references
 * a missing Buff entity; that missing entity is represented by an empty facts
 * list rather than silently being invented.
 */
export function projectMainWorkbenchButtonState(input: {
  selectedBuffIds?: readonly string[] | null;
  selectedBuffs?: readonly (SkillButtonBuff | null | undefined)[] | null;
  buffStackCounts?: Record<string, unknown> | null;
  panelConfig?: Partial<SkillButtonPanelConfig> | null;
  targetResistance?: unknown;
}): MainWorkbenchButtonStateProjection {
  const selectedBuffIds = projectStringArray(input.selectedBuffIds);
  const selectedBuffs = (input.selectedBuffs ?? [])
    .filter((buff): buff is SkillButtonBuff => Boolean(buff))
    .map(projectMainWorkbenchBuff);
  const factsById = new Map(
    selectedBuffs
      .filter((buff) => typeof buff.id === 'string')
      .map((buff) => [buff.id as string, buff]),
  );
  const rawStackCounts = projectNumberMap(input.buffStackCounts);
  const currentStackCounts: Record<string, number | null> = {};
  const currentStackCountSources: MainWorkbenchButtonStateProjection['currentStackCountSources'] = {};
  for (const buffId of selectedBuffIds) {
    const buff = factsById.get(buffId);
    if (!buff) {
      currentStackCounts[buffId] = rawStackCounts[buffId] ?? null;
      currentStackCountSources[buffId] = rawStackCounts[buffId] === undefined ? 'unavailable' : 'persisted';
      continue;
    }
    const resolved = effectiveStackCount(buff, rawStackCounts[buffId] ?? null);
    currentStackCounts[buffId] = resolved.value;
    currentStackCountSources[buffId] = resolved.source;
  }
  for (const [buffId, count] of Object.entries(rawStackCounts)) {
    if (!(buffId in currentStackCounts)) {
      currentStackCounts[buffId] = count;
      currentStackCountSources[buffId] = 'persisted';
    }
  }
  return {
    selectedBuffIds,
    selectedBuffs,
    currentStackCounts,
    currentStackCountSources,
    globallyDisabledBuffIds: projectStringArray(input.panelConfig?.globallyDisabledBuffIds),
    manualDisabledBuffIdsBySegmentKey: projectStringArrayMap(input.panelConfig?.manualDisabledBuffIdsBySegmentKey),
    manualBuffStackCountsBySegmentKey: Object.fromEntries(
      Object.entries(input.panelConfig?.manualBuffStackCountsBySegmentKey ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([segmentKey, counts]) => [segmentKey, projectNumberMap(counts)]),
    ),
    manualDisabledHitKeys: projectStringArray(input.panelConfig?.manualDisabledHitKeys),
    targetResistance: projectTargetResistance(input.targetResistance),
  };
}

export interface MainWorkbenchSnapshot {
  schemaVersion: 1;
  updatedAt: number;
  source: 'app' | 'rest';
  /** Immutable identity of the SQLite workspace that produced this projection. */
  timelineId?: string;
  /** Active Workbench identity; kept separate so the bridge can reject drift. */
  activeTimelineId?: string;
  /** Exact persisted checkout from which the Canvas runtime was hydrated. */
  checkout?: {
    targetType: 'snapshot' | 'work-node';
    targetId: string;
    updatedAt: number;
  } | null;
  currentView?: 'selection' | 'canvas';
  selectedCharacters: Array<Pick<Character, 'id' | 'name' | 'element' | 'profession' | 'librarySource'>>;
  /** Trusted runtime-template skills for the currently selected operators. */
  skillCatalog?: Array<{
    characterId: string;
    characterName: string;
    skillId: string;
    skillType: SkillButtonType;
    skillDisplayName: string;
    source?: string;
  }>;
  skillButtons: Array<{
    id: string;
    characterId: string;
    characterName: string;
    skillType: SkillButtonType;
    runtimeSkillId?: string;
    skillDisplayName?: string;
    staffIndex: number;
    lineIndex: number;
    /** Persistent character row used by TimelineSnapshotPayload. */
    persistenceStaffIndex: number;
    /** Persistent global slot: visual group * GRID_NODE_COUNT + local nodeIndex. */
    persistenceNodeIndex: number;
    nodeIndex?: number;
    nodeNumber?: number;
    selectedBuffIds: string[];
    selectedBuffs?: MainWorkbenchBuffProjection[];
    currentStackCounts?: Record<string, number | null>;
    currentStackCountSources?: MainWorkbenchButtonStateProjection['currentStackCountSources'];
    globallyDisabledBuffIds?: string[];
    manualDisabledBuffIdsBySegmentKey?: Record<string, string[]>;
    manualBuffStackCountsBySegmentKey?: Record<string, Record<string, number>>;
    manualDisabledHitKeys?: string[];
    targetResistance?: Record<string, number | null>;
  }>;
  /** Explicitly distinguishes a Canvas-generated report from selection-page carry/placeholder data. */
  damageReportStatus: 'ready' | 'placeholder';
  damageReport?: DamageReportSnapshot;
  operatorConfigs?: Array<{
    characterId: string;
    characterName: string;
    weapon?: {
      id: string;
      name: string;
      level: number | string;
      potential: string;
      skillLevels?: { skill1?: number; skill2?: number; skill3?: number };
      attack: number;
    };
    equipment: Array<{
      slotKey: string;
      equipmentId: string;
      name: string;
      part: string;
      effects: Array<{
        effectId: string;
        label: string;
        typeKey: string;
        level: number | string;
        value: number;
      }>;
    }>;
    setBuffs?: Array<{
      gearSetId: string;
      gearSetName: string;
      effectId: string;
      label: string;
      typeKey: string;
      value: number;
      category?: string;
      effectKind?: string;
    }>;
    operatorSkillLevels?: { A?: 'L9' | 'M3'; B?: 'L9' | 'M3'; E?: 'L9' | 'M3'; Q?: 'L9' | 'M3'; Dot?: 'L9' | 'M3' };
  }>;
  /** Current checkout Work Node review, projected from browser SQLite. */
  nodeReview?: AiTimelineNodeReviewProjection | null;
  lastCommand?: {
    id: string;
    op: MainWorkbenchCommand['op'];
    status: MainWorkbenchCommandStatus;
    updatedAt: number;
    error?: string;
  };
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined';
}

// The renderer command bridge must keep working when unrelated persisted app data
// changes. Browser SQLite is only a recovery mirror for this transient state;
// the in-page copy is authoritative after the first write.
const memoryJsonStorage = new Map<string, unknown>();
// Agent commands are deliberately granted renderer execution only by the
// current page load after BrowserAgentRuntime receives an execute delivery.
// Persisted agent-host queue entries from an earlier page/process therefore
// cannot be picked up and executed again after a reload.
const currentAgentExecutionIds = new Set<string>();

function readJsonStorage<T>(key: string, fallback: T): T {
  if (memoryJsonStorage.has(key)) {
    return memoryJsonStorage.get(key) as T;
  }
  if (!canUseLocalStorage()) return fallback;
  try {
    const raw = persistentLocalStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  memoryJsonStorage.set(key, value);
  if (!canUseLocalStorage()) return;
  try {
    persistentLocalStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[mainWorkbenchControl] 写入浏览器 SQLite 失败: ${key}`, error);
  }
}

function emitControlEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAIN_WORKBENCH_CONTROL_EVENT));
}

function generateCommandId(): string {
  return `mw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateBatchId(): string {
  return `mw-batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQueuedCommand(
  entry: Partial<QueuedMainWorkbenchCommand> & { command?: MainWorkbenchCommand },
  fallbackSource = 'browser',
): QueuedMainWorkbenchCommand | null {
  if (!entry.command || typeof entry.command !== 'object' || !('op' in entry.command)) {
    return null;
  }
  const now = Date.now();
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : generateCommandId(),
    command: entry.command,
    status: entry.status === 'running' || entry.status === 'done' || entry.status === 'error' ? entry.status : 'pending',
    source: typeof entry.source === 'string' && entry.source.trim() ? entry.source : fallbackSource,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
    batchId: typeof entry.batchId === 'string' && entry.batchId.trim() ? entry.batchId : undefined,
    batchIndex: typeof entry.batchIndex === 'number' ? entry.batchIndex : undefined,
    batchSize: typeof entry.batchSize === 'number' ? entry.batchSize : undefined,
    result: entry.result,
    error: typeof entry.error === 'string' ? entry.error : undefined,
  };
}

export function readMainWorkbenchCommandQueue(): QueuedMainWorkbenchCommand[] {
  const raw = readJsonStorage<unknown>(MAIN_WORKBENCH_COMMAND_QUEUE_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeQueuedCommand(entry as Partial<QueuedMainWorkbenchCommand>))
    .filter((entry): entry is QueuedMainWorkbenchCommand => Boolean(entry));
}

export function writeMainWorkbenchCommandQueue(queue: QueuedMainWorkbenchCommand[]): void {
  writeJsonStorage(MAIN_WORKBENCH_COMMAND_QUEUE_KEY, queue);
}

export function enqueueMainWorkbenchCommand(
  command: MainWorkbenchCommand,
  source = 'browser',
  id?: string,
): QueuedMainWorkbenchCommand {
  const queue = readMainWorkbenchCommandQueue();
  const existing = id ? queue.find((entry) => entry.id === id) : null;
  if (existing) {
    if (source === 'agent-host') currentAgentExecutionIds.add(existing.id);
    return existing;
  }
  const now = Date.now();
  const entry: QueuedMainWorkbenchCommand = {
    id: id || generateCommandId(),
    command,
    status: 'pending',
    source,
    createdAt: now,
    updatedAt: now,
  };
  if (source === 'agent-host') currentAgentExecutionIds.add(entry.id);
  writeMainWorkbenchCommandQueue([...queue, entry]);
  emitControlEvent();
  return entry;
}

export function enqueueMainWorkbenchCommands(
  commands: MainWorkbenchCommand[],
  source = 'browser',
): QueuedMainWorkbenchCommand[] {
  const batchId = generateBatchId();
  const batchSize = commands.filter((command) => command && typeof command.op === 'string').length;
  const entries = commands
    .filter((command) => command && typeof command.op === 'string')
    .map((command, index) => {
      const now = Date.now();
      return {
        id: generateCommandId(),
        command,
        status: 'pending' as const,
        source,
        createdAt: now,
        updatedAt: now,
        batchId,
        batchIndex: index,
        batchSize,
      };
    });
  if (!entries.length) return [];
  if (source === 'agent-host') {
    for (const entry of entries) currentAgentExecutionIds.add(entry.id);
  }
  writeMainWorkbenchCommandQueue([...readMainWorkbenchCommandQueue(), ...entries]);
  emitControlEvent();
  return entries;
}

export function getPendingMainWorkbenchCommands(
  supportedOps: MainWorkbenchCommand['op'][],
): QueuedMainWorkbenchCommand[] {
  const supported = new Set(supportedOps);
  return readMainWorkbenchCommandQueue().filter((entry) =>
    entry.status === 'pending'
      && supported.has(entry.command.op)
      && (entry.source !== 'agent-host' || currentAgentExecutionIds.has(entry.id))
  );
}

export function patchMainWorkbenchCommand(
  commandId: string,
  patch: Partial<Pick<QueuedMainWorkbenchCommand, 'status' | 'result' | 'error'>>,
): QueuedMainWorkbenchCommand | null {
  const queue = readMainWorkbenchCommandQueue();
  let patched: QueuedMainWorkbenchCommand | null = null;
  const nextQueue = queue.map((entry) => {
    if (entry.id !== commandId) return entry;
    patched = {
      ...entry,
      ...patch,
      updatedAt: Date.now(),
    };
    return patched;
  });
  writeMainWorkbenchCommandQueue(nextQueue);
  if (patched) {
    appendMainWorkbenchResult(patched);
    emitControlEvent();
  }
  return patched;
}

export function appendMainWorkbenchResult(entry: QueuedMainWorkbenchCommand): void {
  const current = readJsonStorage<QueuedMainWorkbenchCommand[]>(MAIN_WORKBENCH_RESULT_LOG_KEY, []);
  const next = [entry, ...(Array.isArray(current) ? current.filter((item) => item.id !== entry.id) : [])].slice(0, 50);
  writeJsonStorage(MAIN_WORKBENCH_RESULT_LOG_KEY, next);
}

export function readMainWorkbenchResultLog(): QueuedMainWorkbenchCommand[] {
  const raw = readJsonStorage<unknown>(MAIN_WORKBENCH_RESULT_LOG_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeQueuedCommand(entry as Partial<QueuedMainWorkbenchCommand>))
    .filter((entry): entry is QueuedMainWorkbenchCommand => Boolean(entry));
}

export function readMainWorkbenchSnapshot(): MainWorkbenchSnapshot | null {
  return readJsonStorage<MainWorkbenchSnapshot | null>(MAIN_WORKBENCH_SNAPSHOT_KEY, null);
}

export function writeMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): void {
  writeJsonStorage(MAIN_WORKBENCH_SNAPSHOT_KEY, snapshot);
}

export async function pullRemoteMainWorkbenchCommands(): Promise<void> {
  const recoveredResults = new Map(
    readMainWorkbenchResultLog().map((entry) => [entry.id, entry] as const),
  );
  await browserAgentRuntime.pullRemoteCommands(
    (command, id) => {
      enqueueMainWorkbenchCommand(command, 'agent-host', id);
    },
    (commandId) => recoveredResults.get(commandId) ?? null,
  );
}

export async function pushMainWorkbenchCommandResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
  await browserAgentRuntime.pushCommandResult(entry);
}

export async function pushMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): Promise<void> {
  await browserAgentRuntime.publishMainWorkbenchSnapshot(snapshot);
}
