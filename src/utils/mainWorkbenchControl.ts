import type { Character, SkillButtonType } from '../types';
import type { DamageReportSnapshot } from '../core/services/damageReportService';
import type { SkillButtonBuff } from '../types/storage';
import type { TimelineWorkNodePatchOperation } from '../agentKernel/timelineWorktree/patchDsl';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
export const MAIN_WORKBENCH_COMMAND_QUEUE_KEY = 'def.main-workbench.command-queue.v1';
export const MAIN_WORKBENCH_RESULT_LOG_KEY = 'def.main-workbench.result-log.v1';
export const MAIN_WORKBENCH_SNAPSHOT_KEY = 'def.main-workbench.snapshot.v1';
export const MAIN_WORKBENCH_CONTROL_EVENT = 'def-main-workbench-control';
export type MainWorkbenchCommandStatus = 'pending' | 'running' | 'done' | 'error';

export type MainWorkbenchCommand =
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
    selectedBuffs?: Array<{
      id: string;
      name?: string;
      displayName?: string;
      sourceName?: string;
      level?: string;
      type?: string;
      value?: number;
      description?: string;
      source?: string;
      condition?: string;
      category?: string;
      effectKind?: string;
    }>;
  }>;
  damageReport?: Pick<DamageReportSnapshot, 'generatedAt' | 'totalExpected' | 'totalNonCrit' | 'buttonCount' | 'buttons'>;
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
  writeMainWorkbenchCommandQueue([...readMainWorkbenchCommandQueue(), ...entries]);
  emitControlEvent();
  return entries;
}

export function getPendingMainWorkbenchCommands(
  supportedOps: MainWorkbenchCommand['op'][],
): QueuedMainWorkbenchCommand[] {
  const supported = new Set(supportedOps);
  return readMainWorkbenchCommandQueue().filter((entry) =>
    entry.status === 'pending' && supported.has(entry.command.op)
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

export function readMainWorkbenchSnapshot(): MainWorkbenchSnapshot | null {
  return readJsonStorage<MainWorkbenchSnapshot | null>(MAIN_WORKBENCH_SNAPSHOT_KEY, null);
}

export function writeMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): void {
  writeJsonStorage(MAIN_WORKBENCH_SNAPSHOT_KEY, snapshot);
}

export type MainWorkbenchTransport = {
  pullCommands?: () => Promise<void> | void;
  pushCommandResult?: (entry: QueuedMainWorkbenchCommand) => Promise<void> | void;
  pushSnapshot?: (snapshot: MainWorkbenchSnapshot) => Promise<void> | void;
};

const LOCAL_MAIN_WORKBENCH_TRANSPORT: Readonly<MainWorkbenchTransport> = Object.freeze({});
let activeMainWorkbenchTransport: MainWorkbenchTransport = LOCAL_MAIN_WORKBENCH_TRANSPORT;

export function installMainWorkbenchTransport(transport: MainWorkbenchTransport): () => void {
  if (!transport || typeof transport !== 'object') {
    throw new TypeError('Main Workbench transport must be an object.');
  }
  const previous = activeMainWorkbenchTransport;
  const installed = Object.freeze({ ...transport });
  activeMainWorkbenchTransport = installed;
  return () => {
    if (activeMainWorkbenchTransport === installed) activeMainWorkbenchTransport = previous;
  };
}

export async function pullRemoteMainWorkbenchCommands(): Promise<void> {
  await activeMainWorkbenchTransport.pullCommands?.();
}

export async function pushMainWorkbenchCommandResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
  await activeMainWorkbenchTransport.pushCommandResult?.(entry);
}

export async function pushMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): Promise<void> {
  await activeMainWorkbenchTransport.pushSnapshot?.(snapshot);
}
