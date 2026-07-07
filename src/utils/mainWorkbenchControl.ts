import type { Character, SkillButtonType } from '../types';
import type { DamageReportSnapshot } from '../core/services/damageReportService';
import type { SkillButtonBuff } from '../types/storage';

export const MAIN_WORKBENCH_COMMAND_QUEUE_KEY = 'def.main-workbench.command-queue.v1';
export const MAIN_WORKBENCH_RESULT_LOG_KEY = 'def.main-workbench.result-log.v1';
export const MAIN_WORKBENCH_SNAPSHOT_KEY = 'def.main-workbench.snapshot.v1';
export const MAIN_WORKBENCH_CONTROL_EVENT = 'def-main-workbench-control';
export const MAIN_WORKBENCH_REST_BASE_URL = 'http://127.0.0.1:17321';

export type MainWorkbenchCommandStatus = 'pending' | 'running' | 'done' | 'error';

export type MainWorkbenchCommand =
  | {
      op: 'selectCharacters';
      characterIds?: string[];
      characterNames?: string[];
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
        | 'damageSheet'
        | 'damageReportPpt'
        | 'aiCli';
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
      op: 'removeBuff';
      buttonId?: string;
      characterId?: string;
      characterName?: string;
      skillType?: SkillButtonType;
      nodeIndex?: number;
      buffId?: string;
      name?: string;
      displayName?: string;
      latest?: boolean;
      count?: number;
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
      saveId?: string;
      branchId?: string;
      label?: string;
      approvalPolicy?: 'auto-low-risk' | 'ask-on-risk' | 'manual';
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
      op: 'refreshSnapshot';
    };

export interface QueuedMainWorkbenchCommand {
  id: string;
  command: MainWorkbenchCommand;
  status: MainWorkbenchCommandStatus;
  source: 'browser' | 'rest' | 'script' | string;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}

export interface MainWorkbenchSnapshot {
  schemaVersion: 1;
  updatedAt: number;
  source: 'app' | 'rest';
  currentView?: 'selection' | 'canvas';
  selectedCharacters: Array<Pick<Character, 'id' | 'name' | 'element' | 'profession' | 'librarySource'>>;
  skillButtons: Array<{
    id: string;
    characterId: string;
    characterName: string;
    skillType: SkillButtonType;
    runtimeSkillId?: string;
    skillDisplayName?: string;
    staffIndex: number;
    lineIndex: number;
    nodeIndex?: number;
    nodeNumber?: number;
    selectedBuffIds: string[];
    selectedBuffs?: Array<{
      id: string;
      name?: string;
      displayName?: string;
      sourceName?: string;
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
  }>;
  lastCommand?: {
    id: string;
    op: MainWorkbenchCommand['op'];
    status: MainWorkbenchCommandStatus;
    updatedAt: number;
    error?: string;
  };
}

declare global {
  interface Window {
    defMainWorkbench?: {
      enqueue: (command: MainWorkbenchCommand, source?: string) => QueuedMainWorkbenchCommand;
      enqueueMany: (commands: MainWorkbenchCommand[], source?: string) => QueuedMainWorkbenchCommand[];
      commands: () => QueuedMainWorkbenchCommand[];
      snapshot: () => MainWorkbenchSnapshot | null;
    };
  }
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[mainWorkbenchControl] 写入 localStorage 失败: ${key}`, error);
  }
}

function emitControlEvent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAIN_WORKBENCH_CONTROL_EVENT));
}

function generateCommandId(): string {
  return `mw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const entries = commands
    .filter((command) => command && typeof command.op === 'string')
    .map((command) => {
      const now = Date.now();
      return {
        id: generateCommandId(),
        command,
        status: 'pending' as const,
        source,
        createdAt: now,
        updatedAt: now,
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

export async function pullRemoteMainWorkbenchCommands(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  try {
    const response = await window.fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/commands?status=pending`, {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const payload = await response.json() as { commands?: QueuedMainWorkbenchCommand[] };
    if (!Array.isArray(payload.commands) || payload.commands.length === 0) return;

    const queue = readMainWorkbenchCommandQueue();
    const knownIds = new Set(queue.map((entry) => entry.id));
    const imported = payload.commands
      .map((entry) => normalizeQueuedCommand(entry, 'rest'))
      .filter((entry): entry is QueuedMainWorkbenchCommand => Boolean(entry))
      .filter((entry) => !knownIds.has(entry.id));
    if (imported.length === 0) return;
    writeMainWorkbenchCommandQueue([...queue, ...imported]);
    emitControlEvent();
  } catch {
    // REST bridge is optional; page-local control still works without it.
  }
}

export async function pushMainWorkbenchCommandResult(entry: QueuedMainWorkbenchCommand): Promise<void> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  try {
    await window.fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/commands/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        id: entry.id,
        status: entry.status,
        result: entry.result,
        error: entry.error,
      }),
    });
  } catch {
    // Best effort only; localStorage result log remains authoritative in the page.
  }
}

export async function pushMainWorkbenchSnapshot(snapshot: MainWorkbenchSnapshot): Promise<void> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  try {
    await window.fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ snapshot }),
    });
  } catch {
    // Optional REST mirror.
  }
}

export function installMainWorkbenchWindowApi(): void {
  if (typeof window === 'undefined') return;
  window.defMainWorkbench = {
    enqueue: (command, source = 'browser') => enqueueMainWorkbenchCommand(command, source),
    enqueueMany: (commands, source = 'browser') => enqueueMainWorkbenchCommands(commands, source),
    commands: readMainWorkbenchCommandQueue,
    snapshot: readMainWorkbenchSnapshot,
  };
}
