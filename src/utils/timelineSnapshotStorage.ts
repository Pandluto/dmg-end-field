import { STORAGE_KEYS } from '../constants/storage-keys';
import type { TimelineData } from '../types';
import type {
  AnomalyStateSnapshot,
  BuffList,
  CharacterComputedCache,
  CharacterDisplayCache,
  CharacterInputConfig,
  OperatorConfigPageCache,
  SkillButtonTable,
} from '../types/storage';
import {
  getCharacterComputedMap,
  getCharacterDisplayCacheMap,
  getCharacterInputMap,
  getOperatorConfigPageCache,
  safeSessionStorage,
  setCharacterComputedMap,
  setCharacterDisplayCacheMap,
  setCharacterInputMap,
  setOperatorConfigPageCache,
} from './storage';
import {
  getAnomalyStateSnapshotArchive,
  setAnomalyStateSnapshotArchive,
} from '../core/services/anomalyStateSnapshotStorage';
import {
  normalizeStoredBuffList,
  normalizeStoredOperatorConfigPageCache,
} from '../core/services/buffStorageNormalization';

export interface TimelineSnapshotPayload {
  selectedCharacters: string[];
  timelineData: TimelineData;
  skillButtonTable: SkillButtonTable;
  allBuffList: BuffList;
  anomalyStateSnapshots: AnomalyStateSnapshot[];
  characterInputMap: Record<string, CharacterInputConfig>;
  characterComputedMap: Record<string, CharacterComputedCache>;
  characterDisplayCacheMap: Record<string, CharacterDisplayCache>;
  operatorConfigPageCache: OperatorConfigPageCache;
}

export interface TimelineSnapshotSummary {
  characterCount: number;
  buttonCount: number;
  buffCount: number;
}

export interface TimelineSnapshotEntry {
  id: string;
  createdAt: number;
  label: string;
  summary: TimelineSnapshotSummary;
  payload: TimelineSnapshotPayload;
}

export interface TimelineShareFile {
  type: 'timeline-share.v1';
  exportedAt: number;
  label: string;
  payload: TimelineSnapshotPayload;
}

export interface TimelineBundleV2 {
  type: 'dmg.timeline-bundle.v2';
  schemaVersion: 2;
  manifest: { exportedAt: number; scope: 'snapshot' | 'branch' | 'document'; timelineId: string; label: string; payloadHash: string };
  document: { id: string; label: string };
  payloads: TimelineSnapshotPayload[];
  snapshots: Array<{ id: string; label: string; createdAt: number; payloadIndex: number }>;
  workNodes?: Array<{
    id: string; parentNodeId?: string; branchId: string; label: string; status: string; approvalPolicy: string;
    riskFlags: unknown[]; logs: unknown[]; createdAt: number; updatedAt: number;
    basePayloadIndex: number; workingPayloadIndex: number;
  }>;
}

interface TimelineSnapshotArchive {
  version: 'v1';
  snapshots: TimelineSnapshotEntry[];
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readArchive(): TimelineSnapshotArchive {
  if (!canUseLocalStorage()) {
    return {
      version: 'v1',
      snapshots: [],
    };
  }

  const raw = window.localStorage.getItem(STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE);
  if (!raw) {
    return {
      version: 'v1',
      snapshots: [],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TimelineSnapshotArchive>;
    return {
      version: 'v1',
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return {
      version: 'v1',
      snapshots: [],
    };
  }
}

function readSessionJson<T>(key: string, fallback: T): T {
  const raw = safeSessionStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildSnapshotSummary(payload: TimelineSnapshotPayload): TimelineSnapshotSummary {
  const buttonCount = payload.timelineData.staffLines.reduce((count, staffLine) => {
    const buttons = Array.isArray(staffLine.buttons) ? staffLine.buttons.length : 0;
    return count + buttons;
  }, 0);

  return {
    characterCount: payload.selectedCharacters.length,
    buttonCount,
    buffCount: payload.allBuffList.length,
  };
}

function formatSnapshotLabel(createdAt: number): string {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeShareLabel(label?: string): string {
  const normalized = label?.trim();
  return normalized || '未命名';
}

function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidTimelineSnapshotPayload(value: unknown): value is TimelineSnapshotPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TimelineSnapshotPayload> & {
    timelineData?: { staffLines?: unknown };
  };

  return (
    Array.isArray(candidate.selectedCharacters) &&
    Array.isArray(candidate.allBuffList) &&
    Array.isArray(candidate.anomalyStateSnapshots) &&
    !!candidate.skillButtonTable &&
    typeof candidate.skillButtonTable === 'object' &&
    !!candidate.timelineData &&
    Array.isArray(candidate.timelineData.staffLines) &&
    (candidate.characterInputMap === undefined || typeof candidate.characterInputMap === 'object') &&
    (candidate.characterComputedMap === undefined || typeof candidate.characterComputedMap === 'object') &&
    (candidate.characterDisplayCacheMap === undefined || typeof candidate.characterDisplayCacheMap === 'object') &&
    (candidate.operatorConfigPageCache === undefined || typeof candidate.operatorConfigPageCache === 'object')
  );
}

function normalizeSnapshotPayload(payload: TimelineSnapshotPayload): TimelineSnapshotPayload {
  return {
    selectedCharacters: payload.selectedCharacters,
    timelineData: payload.timelineData,
    skillButtonTable: payload.skillButtonTable,
    allBuffList: normalizeStoredBuffList(payload.allBuffList),
    anomalyStateSnapshots: payload.anomalyStateSnapshots ?? [],
    characterInputMap: payload.characterInputMap ?? {},
    characterComputedMap: payload.characterComputedMap ?? {},
    characterDisplayCacheMap: payload.characterDisplayCacheMap ?? {},
    operatorConfigPageCache: normalizeStoredOperatorConfigPageCache(payload.operatorConfigPageCache),
  };
}

function readCurrentPayload(): TimelineSnapshotPayload | null {
  const selectedCharacters = readSessionJson<string[]>(STORAGE_KEYS.SELECTED_CHARACTERS, []);
  const timelineData = readSessionJson<TimelineData | null>(STORAGE_KEYS.TIMELINE_DATA, null);
  const skillButtonTable = readSessionJson<SkillButtonTable>(STORAGE_KEYS.SKILL_BUTTON_TABLE, {});
  const allBuffList = normalizeStoredBuffList(
    readSessionJson<BuffList>(STORAGE_KEYS.ALL_BUFF_LIST, [])
  );
  const anomalyStateSnapshots = getAnomalyStateSnapshotArchive().snapshots;
  const characterInputMap = getCharacterInputMap();
  const characterComputedMap = getCharacterComputedMap();
  const characterDisplayCacheMap = getCharacterDisplayCacheMap();
  const operatorConfigPageCache = getOperatorConfigPageCache();

  if (!timelineData || selectedCharacters.length === 0) {
    return null;
  }

  return {
    selectedCharacters,
    timelineData,
    skillButtonTable,
    allBuffList,
    anomalyStateSnapshots,
    characterInputMap,
    characterComputedMap,
    characterDisplayCacheMap,
    operatorConfigPageCache,
  };
}

export function getCurrentTimelineSnapshotPayload(): TimelineSnapshotPayload | null {
  return readCurrentPayload();
}

export function applyTimelineSnapshotPayload(payload: TimelineSnapshotPayload): void {
  const normalizedPayload = normalizeSnapshotPayload(payload);
  safeSessionStorage.setItem(
    STORAGE_KEYS.SELECTED_CHARACTERS,
    JSON.stringify(normalizedPayload.selectedCharacters)
  );
  safeSessionStorage.setItem(
    STORAGE_KEYS.TIMELINE_DATA,
    JSON.stringify(normalizedPayload.timelineData)
  );
  safeSessionStorage.setItem(
    STORAGE_KEYS.SKILL_BUTTON_TABLE,
    JSON.stringify(normalizedPayload.skillButtonTable)
  );
  safeSessionStorage.setItem(
    STORAGE_KEYS.ALL_BUFF_LIST,
    JSON.stringify(normalizedPayload.allBuffList)
  );
  setAnomalyStateSnapshotArchive({
    version: 'v1',
    nextId: normalizedPayload.anomalyStateSnapshots.reduce((maxId, snapshot) => Math.max(maxId, snapshot.id), 0) + 1,
    snapshots: normalizedPayload.anomalyStateSnapshots,
  });
  setCharacterInputMap(normalizedPayload.characterInputMap);
  setCharacterComputedMap(normalizedPayload.characterComputedMap);
  setCharacterDisplayCacheMap(normalizedPayload.characterDisplayCacheMap);
  setOperatorConfigPageCache(normalizedPayload.operatorConfigPageCache);
}

export function buildTimelineShareFile(customLabel?: string): TimelineShareFile | null {
  const payload = readCurrentPayload();
  if (!payload) {
    return null;
  }

  return {
    type: 'timeline-share.v1',
    exportedAt: Date.now(),
    label: normalizeShareLabel(customLabel),
    payload: normalizeSnapshotPayload(payload),
  };
}

type TimelineBundleWorkNodeInput = {
  id: string; parentNodeId?: string; branchId: string; label: string; status: string; approvalPolicy: string;
  riskFlags?: unknown[]; logs?: unknown[]; createdAt: number; updatedAt: number;
  basePayload: TimelineSnapshotPayload; workingPayload: TimelineSnapshotPayload;
};

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function buildTimelineBundleV2(input: {
  timelineId: string; label?: string; snapshot: TimelineSnapshotEntry;
  snapshots?: TimelineSnapshotEntry[]; workNodes?: TimelineBundleWorkNodeInput[];
  scope?: 'snapshot' | 'branch' | 'document';
}): Promise<TimelineBundleV2> {
  const sourceSnapshots = input.snapshots || [input.snapshot];
  if (!sourceSnapshots.length) throw new Error('Timeline bundle requires at least one snapshot.');
  const payloads: TimelineSnapshotPayload[] = [];
  const payloadIndex = new Map<string, number>();
  const addPayload = (payload: TimelineSnapshotPayload) => {
    const normalized = normalizeSnapshotPayload(payload);
    const key = JSON.stringify(normalized);
    const existing = payloadIndex.get(key);
    if (existing !== undefined) return existing;
    const index = payloads.length;
    payloads.push(normalized);
    payloadIndex.set(key, index);
    return index;
  };
  const snapshots = sourceSnapshots.map((snapshot) => ({
    id: snapshot.id, label: snapshot.label, createdAt: snapshot.createdAt, payloadIndex: addPayload(snapshot.payload),
  }));
  const workNodes = input.workNodes?.map((node) => ({
    id: node.id, ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}), branchId: node.branchId,
    label: node.label, status: node.status, approvalPolicy: node.approvalPolicy,
    riskFlags: node.riskFlags || [], logs: node.logs || [], createdAt: node.createdAt, updatedAt: node.updatedAt,
    basePayloadIndex: addPayload(node.basePayload), workingPayloadIndex: addPayload(node.workingPayload),
  }));
  return {
    type: 'dmg.timeline-bundle.v2',
    schemaVersion: 2,
    manifest: {
      exportedAt: Date.now(), scope: input.scope || (workNodes?.length ? 'document' : 'snapshot'), timelineId: input.timelineId,
      label: normalizeShareLabel(input.label || input.snapshot.label),
      payloadHash: await sha256({ payloads, snapshots, workNodes: workNodes || [] }),
    },
    document: { id: input.timelineId, label: normalizeShareLabel(input.label || '导入排轴') },
    payloads,
    snapshots,
    ...(workNodes?.length ? { workNodes } : {}),
  };
}

export async function parseTimelineBundleV2(rawText: string): Promise<TimelineBundleV2 | null> {
  try {
    const bundle = JSON.parse(rawText) as Partial<TimelineBundleV2>;
    if (bundle.type !== 'dmg.timeline-bundle.v2' || bundle.schemaVersion !== 2 || !['snapshot', 'branch', 'document'].includes(bundle.manifest?.scope || '')) return null;
    if (!bundle.document?.id || !bundle.manifest?.payloadHash || !Array.isArray(bundle.payloads) || !Array.isArray(bundle.snapshots)) return null;
    if (!bundle.payloads.every(isValidTimelineSnapshotPayload)) return null;
    if (!bundle.snapshots.every((item) => typeof item?.id === 'string' && typeof item.payloadIndex === 'number' && bundle.payloads![item.payloadIndex])) return null;
    if (!bundle.snapshots.every((item) => typeof item?.label === 'string' && typeof item.createdAt === 'number')) return null;
    const workNodes = Array.isArray(bundle.workNodes) ? bundle.workNodes : [];
    if (!workNodes.every((node) => typeof node?.id === 'string' && typeof node.branchId === 'string'
      && typeof node.basePayloadIndex === 'number' && bundle.payloads![node.basePayloadIndex]
      && typeof node.workingPayloadIndex === 'number' && bundle.payloads![node.workingPayloadIndex])) return null;
    const actualHash = await sha256({ payloads: bundle.payloads, snapshots: bundle.snapshots, workNodes });
    const legacyHash = await sha256(bundle.payloads);
    if (actualHash !== bundle.manifest.payloadHash && legacyHash !== bundle.manifest.payloadHash) return null;
    return bundle as TimelineBundleV2;
  } catch {
    return null;
  }
}

export function parseTimelineShareFile(rawText: string): TimelineShareFile | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<TimelineShareFile>;
    if (parsed.type !== 'timeline-share.v1') {
      return null;
    }
    if (!isValidTimelineSnapshotPayload(parsed.payload)) {
      return null;
    }

    return {
      type: 'timeline-share.v1',
      exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
      label: normalizeShareLabel(parsed.label),
      payload: normalizeSnapshotPayload(parsed.payload),
    };
  } catch {
    return null;
  }
}

export function buildTimelineShareFileName(label: string, exportedAt: number): string {
  const normalizedLabel = sanitizeFileNamePart(normalizeShareLabel(label)) || '未命名';
  return `${normalizedLabel}-${formatSnapshotLabel(exportedAt).replace(/:/g, '-')}.json`;
}

export function listTimelineSnapshots(): TimelineSnapshotEntry[] {
  return [...readArchive().snapshots]
    .map((snapshot) => ({
      ...snapshot,
      payload: normalizeSnapshotPayload(snapshot.payload),
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** Removes the pre-Spec-5 browser archive only after its caller has migrated it. */
export function clearLegacyTimelineSnapshotArchive(): void {
  if (!canUseLocalStorage()) return;
  window.localStorage.removeItem(STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE);
}

export function createTimelineSnapshotEntry(customLabel?: string): TimelineSnapshotEntry | null {
  const payload = readCurrentPayload();
  if (!payload) {
    return null;
  }

  const createdAt = Date.now();
  const normalizedLabel = customLabel?.trim();
  const entry: TimelineSnapshotEntry = {
    id: `timeline-snapshot-${createdAt}`,
    createdAt,
    label: normalizedLabel || formatSnapshotLabel(createdAt),
    summary: buildSnapshotSummary(payload),
    payload: normalizeSnapshotPayload(payload),
  };

  return entry;
}
