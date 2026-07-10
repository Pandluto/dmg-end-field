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

export const TIMELINE_SNAPSHOT_LIMIT = 20;

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

function writeArchive(archive: TimelineSnapshotArchive): void {
  if (!canUseLocalStorage()) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE, JSON.stringify(archive));
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

export function saveTimelineSnapshot(customLabel?: string): TimelineSnapshotEntry | null {
  const entry = createTimelineSnapshotEntry(customLabel);
  if (!entry) return null;
  const archive = readArchive();
  archive.snapshots = [entry, ...archive.snapshots].slice(0, TIMELINE_SNAPSHOT_LIMIT);
  writeArchive(archive);
  return entry;
}

export function restoreTimelineSnapshot(snapshotId: string): boolean {
  const snapshot = readArchive().snapshots.find((entry) => entry.id === snapshotId);
  if (!snapshot) {
    return false;
  }

  applyTimelineSnapshotPayload(normalizeSnapshotPayload(snapshot.payload));
  return true;
}

export function deleteTimelineSnapshot(snapshotId: string): void {
  const archive = readArchive();
  archive.snapshots = archive.snapshots.filter((entry) => entry.id !== snapshotId);
  writeArchive(archive);
}
