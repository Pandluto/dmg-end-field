import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  normalizeStoredBuffList,
  normalizeStoredCandidateBuffList,
  normalizeStoredOperatorConfigPageCache,
  normalizeStoredRuntimeOperatorTemplateMap,
} from '../core/services/buffStorageNormalization';
import { isUserWorkspaceBridgeActive } from './userWorkspaceBridge';

type StorageAreaName = 'local' | 'session';
type LocalDataSection = 'operators' | 'weapons' | 'equipments' | 'buffs' | 'timeline' | 'runtime' | 'all';

interface LocalDataArchive {
  type: 'def.localdata.archive.v1';
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  exportedAt: string;
  sections: LocalDataSection[];
  storage: {
    local: Record<string, unknown>;
    session: Record<string, unknown>;
  };
}

interface LocalDataExportOptions {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  sections?: LocalDataSection[];
}

interface LocalDataImportOptions {
  sections?: LocalDataSection[];
  reload?: boolean;
}

const LOCAL_PREFIXES_BY_SECTION: Record<Exclude<LocalDataSection, 'all'>, string[]> = {
  operators: ['def.operator-editor.'],
  weapons: ['def.weapon-sheet.'],
  equipments: ['def.equipment-sheet.'],
  buffs: ['def.buff-editor.', 'def.buff-sheet.'],
  timeline: [STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE],
  runtime: [],
};

const SESSION_KEYS_BY_SECTION: Record<Exclude<LocalDataSection, 'all'>, string[]> = {
  operators: [
    STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER,
    STORAGE_KEYS.CHARACTER_INPUT_MAP,
    STORAGE_KEYS.SELECTED_CHARACTERS,
    STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE,
    STORAGE_KEYS.RUNTIME_OPERATOR_TEMPLATE_MAP,
    STORAGE_KEYS.CHARACTER_COMPUTED_MAP,
    STORAGE_KEYS.CHARACTER_DISPLAY_CACHE,
  ],
  weapons: [],
  equipments: [],
  buffs: [
    STORAGE_KEYS.ALL_BUFF_LIST,
    STORAGE_KEYS.CANDIDATE_BUFF_LIST,
    STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE,
  ],
  timeline: [
    STORAGE_KEYS.SELECTED_CHARACTERS,
    STORAGE_KEYS.SELECTED_SKILL_BUTTON,
    STORAGE_KEYS.TIMELINE_DATA,
    STORAGE_KEYS.SKILL_BUTTON_TABLE,
    STORAGE_KEYS.ALL_BUFF_LIST,
    STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE,
  ],
  runtime: [
    STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE,
    STORAGE_KEYS.RUNTIME_OPERATOR_TEMPLATE_MAP,
    STORAGE_KEYS.CHARACTER_COMPUTED_MAP,
    STORAGE_KEYS.CHARACTER_DISPLAY_CACHE,
  ],
};

const REQUIRED_CURRENT_SESSION_KEYS_BY_SECTION: Partial<Record<Exclude<LocalDataSection, 'all'>, string[]>> = {
  timeline: [
    STORAGE_KEYS.SELECTED_CHARACTERS,
    STORAGE_KEYS.TIMELINE_DATA,
    STORAGE_KEYS.SKILL_BUTTON_TABLE,
    STORAGE_KEYS.ALL_BUFF_LIST,
  ],
};

const LOCAL_DATA_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
const NOW_STORAGE_HANDLED_FORCE_AT_KEY = '__def.localdata.now-storage-handled-force-at.v1';
const NOW_STORAGE_SKIPPED_BACKUP_AT_KEY = '__def.localdata.now-storage-skipped-backup-at.v1';
const NOW_STORAGE_RELOAD_COUNT_KEY = '__def.localdata.now-storage-reload-count.v1';
const NOW_STORAGE_LAST_RELOAD_AT_KEY = '__def.localdata.now-storage-last-reload-at.v1';
const NOW_STORAGE_RELOAD_DEBOUNCE_MS = 5000;

let isNowStorageBridgeStarted = false;
let scheduledNowStorageReloadTimer: number | null = null;

function getStorage(area: StorageAreaName): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function listStorageKeys(area: StorageAreaName): string[] {
  const storage = getStorage(area);
  if (!storage) return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys.sort();
}

function uniqueSections(sections: LocalDataSection[] | undefined): LocalDataSection[] {
  const source: LocalDataSection[] = sections && sections.length > 0 ? sections : ['all'];
  return Array.from(new Set(source));
}

function shouldIncludeLocalKey(key: string, sections: LocalDataSection[]): boolean {
  if (sections.includes('all')) {
    return key.startsWith('def.');
  }
  return sections.some((section) => {
    if (section === 'all') return true;
    return LOCAL_PREFIXES_BY_SECTION[section].some((prefix) => key === prefix || key.startsWith(prefix));
  });
}

function shouldIncludeSessionKey(key: string, sections: LocalDataSection[]): boolean {
  if (sections.includes('all')) {
    return key.startsWith('def.');
  }
  return sections.some((section) => section !== 'all' && SESSION_KEYS_BY_SECTION[section].includes(key));
}

function parseStoredValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyStoredValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

function normalizeImportedSessionValue(key: string, value: unknown): unknown {
  switch (key) {
    case STORAGE_KEYS.ALL_BUFF_LIST:
      return normalizeStoredBuffList(value);
    case STORAGE_KEYS.CANDIDATE_BUFF_LIST:
      return normalizeStoredCandidateBuffList(value);
    case STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE:
      return normalizeStoredOperatorConfigPageCache(value);
    case STORAGE_KEYS.RUNTIME_OPERATOR_TEMPLATE_MAP:
      return normalizeStoredRuntimeOperatorTemplateMap(value);
    default:
      return value;
  }
}

function collectStorage(area: StorageAreaName, sections: LocalDataSection[]): Record<string, unknown> {
  const storage = getStorage(area);
  if (!storage) return {};
  const shouldInclude = area === 'local' ? shouldIncludeLocalKey : shouldIncludeSessionKey;
  return Object.fromEntries(
    listStorageKeys(area)
      .filter((key) => shouldInclude(key, sections))
      .map((key) => [key, parseStoredValue(storage.getItem(key) ?? '')])
  );
}

function removeManagedKeys(area: StorageAreaName, sections: LocalDataSection[]): number {
  const storage = getStorage(area);
  if (!storage) return 0;
  const shouldInclude = area === 'local' ? shouldIncludeLocalKey : shouldIncludeSessionKey;
  const keys = listStorageKeys(area).filter((key) => shouldInclude(key, sections));
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}

function applyStorage(area: StorageAreaName, values: Record<string, unknown> | undefined): {
  writtenKeys: number;
  failedKeys: string[];
} {
  const storage = getStorage(area);
  if (!storage || !values) return { writtenKeys: 0, failedKeys: [] };
  const failedKeys: string[] = [];
  Object.entries(values).forEach(([key, value]) => {
    const normalizedValue = area === 'session'
      ? normalizeImportedSessionValue(key, value)
      : value;
    const serialized = stringifyStoredValue(normalizedValue);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) {
      failedKeys.push(key);
    }
  });
  return {
    writtenKeys: Object.keys(values).length,
    failedKeys,
  };
}

function filterStorageValues(
  area: StorageAreaName,
  values: Record<string, unknown> | undefined,
  sections: LocalDataSection[],
): Record<string, unknown> {
  if (!values) return {};
  const shouldInclude = area === 'local' ? shouldIncludeLocalKey : shouldIncludeSessionKey;
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => shouldInclude(key, sections))
  );
}

function validateCurrentStorageCoverage(
  archive: LocalDataArchive,
  sections: LocalDataSection[],
  sessionValues: Record<string, unknown>,
): void {
  const targetSections: Exclude<LocalDataSection, 'all'>[] = sections.includes('all')
    ? ['operators', 'weapons', 'equipments', 'buffs', 'timeline', 'runtime']
    : sections.filter((section): section is Exclude<LocalDataSection, 'all'> => section !== 'all');
  const missingSections = targetSections.filter((section) => {
    const requiredKeys = REQUIRED_CURRENT_SESSION_KEYS_BY_SECTION[section];
    const hasCurrentSession = requiredKeys?.length && requiredKeys.some((key) => key in sessionValues);
    const hasTimelineSnapshotArchive =
      section === 'timeline' &&
      STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE in (archive.storage?.local || {});
    return requiredKeys?.length && !hasCurrentSession && !hasTimelineSnapshotArchive;
  });
  if (missingSections.length === 0) {
    return;
  }
  const archiveSessionKeys = Object.keys(archive.storage?.session || {});
  throw new Error(
    `存档缺少当前态 sessionStorage，不能完成同步替换：${missingSections.join(' / ')}。` +
    `当前存档 session key：${archiveSessionKeys.join(', ') || '无'}`
  );
}

function formatArchiveId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function buildArchive(options: LocalDataExportOptions = {}): LocalDataArchive {
  const exportedAt = new Date().toISOString();
  const sections = uniqueSections(options.sections);
  const id = options.id?.trim() || `localdata-${formatArchiveId()}`;
  return {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id,
    name: options.name?.trim() || id,
    description: options.description?.trim() || undefined,
    createdAt: options.createdAt || exportedAt,
    exportedAt,
    sections,
    storage: {
      local: collectStorage('local', sections),
      session: collectStorage('session', sections),
    },
  };
}

function applyArchive(archive: LocalDataArchive, options: LocalDataImportOptions = {}) {
  const sections = uniqueSections(options.sections ?? archive.sections);
  const localValues = filterStorageValues('local', archive.storage?.local, sections);
  const sessionValues = filterStorageValues('session', archive.storage?.session, sections);
  validateCurrentStorageCoverage(archive, sections, sessionValues);
  const removedLocalKeys = removeManagedKeys('local', sections);
  const removedSessionKeys = removeManagedKeys('session', sections);
  const localResult = applyStorage('local', localValues);
  const sessionResult = applyStorage('session', sessionValues);
  const failedKeys = [...localResult.failedKeys, ...sessionResult.failedKeys];
  if (failedKeys.length > 0) {
    throw new Error(`Web storage 写入校验失败：${failedKeys.join(', ')}`);
  }
  const touchedKeys =
    removedLocalKeys +
    removedSessionKeys +
    localResult.writtenKeys +
    sessionResult.writtenKeys;
  if (touchedKeys === 0) {
    throw new Error('存档和所选分组没有可替换的 Web storage key');
  }
  return {
    ok: true,
    sections,
    localKeys: localResult.writtenKeys,
    sessionKeys: sessionResult.writtenKeys,
    removedLocalKeys,
    removedSessionKeys,
  };
}

function makeStableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(makeStableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${makeStableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function makeArchiveContentSignature(archive: LocalDataArchive): string {
  return makeStableJson({
    type: archive.type,
    schemaVersion: archive.schemaVersion,
    sections: archive.sections,
    storage: archive.storage,
  });
}

async function fetchBridgeJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return null;
  }
  try {
    const response = await window.fetch(`${LOCAL_DATA_BRIDGE_ORIGIN}${path}`, {
      cache: 'no-store',
      ...init,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
}

function getHandledNowStorageForceAt(): string | null {
  try {
    return window.sessionStorage.getItem(NOW_STORAGE_HANDLED_FORCE_AT_KEY);
  } catch {
    return null;
  }
}

function setHandledNowStorageForceAt(updatedAt: string): void {
  try {
    window.sessionStorage.setItem(NOW_STORAGE_HANDLED_FORCE_AT_KEY, updatedAt);
  } catch {
    // Best-effort guard; forceApply is still cleared by the bridge.
  }
}

function getSkippedNowStorageBackupAt(): string | null {
  try {
    return window.sessionStorage.getItem(NOW_STORAGE_SKIPPED_BACKUP_AT_KEY);
  } catch {
    return null;
  }
}

function setSkippedNowStorageBackupAt(updatedAt: string): void {
  try {
    window.sessionStorage.setItem(NOW_STORAGE_SKIPPED_BACKUP_AT_KEY, updatedAt);
  } catch {
    // Best-effort guard; skipping backup is only to protect the imported snapshot.
  }
}

function getNowStorageReloadCount(syncKey: string): number {
  try {
    const raw = window.sessionStorage.getItem(NOW_STORAGE_RELOAD_COUNT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { syncKey?: string; count?: number };
    return parsed.syncKey === syncKey && typeof parsed.count === 'number' ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function setNowStorageReloadCount(syncKey: string, count: number): void {
  try {
    window.sessionStorage.setItem(NOW_STORAGE_RELOAD_COUNT_KEY, JSON.stringify({ syncKey, count }));
  } catch {
    // Best-effort guard; forceApply is still cleared before reload.
  }
}

function getLastNowStorageReloadAt(): number {
  try {
    const raw = window.sessionStorage.getItem(NOW_STORAGE_LAST_RELOAD_AT_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function setLastNowStorageReloadAt(timestamp: number): void {
  try {
    window.sessionStorage.setItem(NOW_STORAGE_LAST_RELOAD_AT_KEY, String(timestamp));
  } catch {
    // Best effort only.
  }
}

function scheduleNowStorageReload(reason: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (scheduledNowStorageReloadTimer !== null) {
    console.log('[localDataBridge] now-storage reload debounced', {
      reason,
      mode: 'already-scheduled',
      debounceMs: NOW_STORAGE_RELOAD_DEBOUNCE_MS,
    });
    return;
  }

  const now = Date.now();
  const elapsed = now - getLastNowStorageReloadAt();
  if (elapsed >= 0 && elapsed < NOW_STORAGE_RELOAD_DEBOUNCE_MS) {
    console.log('[localDataBridge] now-storage reload debounced', {
      reason,
      mode: 'cooldown',
      elapsed,
      debounceMs: NOW_STORAGE_RELOAD_DEBOUNCE_MS,
    });
    return;
  }

  console.log('[localDataBridge] now-storage reload scheduled', {
    reason,
    debounceMs: NOW_STORAGE_RELOAD_DEBOUNCE_MS,
  });
  scheduledNowStorageReloadTimer = window.setTimeout(() => {
    scheduledNowStorageReloadTimer = null;
    setLastNowStorageReloadAt(Date.now());
    window.location.reload();
  }, NOW_STORAGE_RELOAD_DEBOUNCE_MS);
}

function scheduleImmediateReload(reason: string): void {
  console.log('[localDataBridge] now-storage reload scheduled', {
    reason,
    mode: 'bootstrap',
  });
  window.setTimeout(() => window.location.reload(), 0);
}

async function saveCurrentStorageToNowStorage(): Promise<void> {
  const archive = buildArchive({
    id: 'now-storage',
    name: 'now-storage',
    sections: ['all'],
  });
  await fetchBridgeJson('/local-data/now-storage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(archive),
  });
}

async function setNowStorageForceApply(forceApply: boolean): Promise<void> {
  const result = await fetchBridgeJson<{ ok: boolean; state?: { forceApply: boolean; updatedAt: string | null } }>('/local-data/now-storage-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ forceApply }),
  });
  if (!result?.ok) {
    throw new Error(`now-storage forceApply 写入失败：${forceApply}`);
  }
}

async function syncNowStorageFromLocalBridge(options: { reloadMode?: 'scheduled' | 'immediate' } = {}): Promise<boolean> {
  const result = await fetchBridgeJson<{
    ok: boolean;
    error?: string;
    state?: { forceApply: boolean; updatedAt: string | null };
    archive?: LocalDataArchive | null;
  }>('/local-data/now-storage');

  if (!result?.ok) {
    console.log('[localDataBridge] now-storage startup', {
      ok: false,
      action: 'skip',
      reason: 'bridge-read-failed',
    });
    return false;
  }

  console.log('[localDataBridge] now-storage startup', {
    ok: true,
    forceApply: Boolean(result.state?.forceApply),
    stateUpdatedAt: result.state?.updatedAt ?? null,
    hasArchive: Boolean(result.archive),
  });

  if (!result.state?.forceApply) {
    const stateUpdatedAt = result.state?.updatedAt || null;
    if (
      stateUpdatedAt &&
      getHandledNowStorageForceAt() === stateUpdatedAt &&
      getSkippedNowStorageBackupAt() !== stateUpdatedAt
    ) {
      setSkippedNowStorageBackupAt(stateUpdatedAt);
      console.log('[localDataBridge] now-storage backup skipped', {
        action: 'skip-backup',
        forceApply: false,
        reason: 'first-load-after-force-apply',
        stateUpdatedAt,
      });
      return false;
    }
    console.log('[localDataBridge] now-storage action', {
      action: 'save-browser-to-now-storage',
      forceApply: false,
      stateUpdatedAt,
    });
    await saveCurrentStorageToNowStorage();
    return false;
  }

  console.log('[localDataBridge] now-storage action', {
    action: 'apply-now-storage-to-browser',
    forceApply: true,
    stateUpdatedAt: result.state.updatedAt,
  });

  const forceUpdatedAt = result.state.updatedAt || 'unknown';
  const handledForceAt = getHandledNowStorageForceAt();
  if (!result.archive) {
    setHandledNowStorageForceAt(forceUpdatedAt);
    await setNowStorageForceApply(false);
    return false;
  }

  const marker = makeArchiveContentSignature(result.archive);
  const syncKey = `${forceUpdatedAt}:${marker}`;
  const reloadCount = getNowStorageReloadCount(syncKey);
  console.log('[localDataBridge] now-storage apply check', {
    forceApply: result.state.forceApply,
    stateUpdatedAt: forceUpdatedAt,
    handledForceAt,
    reloadCount,
  });
  if (handledForceAt === forceUpdatedAt) {
    console.log('[localDataBridge] now-storage forceApply skipped', {
      reason: 'handled-updatedAt',
      forceUpdatedAt,
    });
    await setNowStorageForceApply(false).catch(() => undefined);
    return false;
  }

  try {
    applyArchive(result.archive, { sections: result.archive.sections, reload: false });
    setHandledNowStorageForceAt(forceUpdatedAt);
    await setNowStorageForceApply(false).catch(() => undefined);
    if (reloadCount >= 1) {
      console.log('[localDataBridge] now-storage reload skipped', {
        reason: 'reload-count-limit',
        syncKey,
        reloadCount,
      });
      return false;
    }
    setNowStorageReloadCount(syncKey, reloadCount + 1);
    console.log('[localDataBridge] now-storage reload scheduled', {
      syncKey,
      nextReloadCount: reloadCount + 1,
    });
    if (options.reloadMode === 'immediate') {
      scheduleImmediateReload('forceApply');
    } else {
      scheduleNowStorageReload('forceApply');
    }
    return true;
  } catch (error) {
    console.warn(
      '[localDataBridge] now-storage 同步失败',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export async function bootstrapLocalDataBridge(): Promise<{ shouldRender: boolean }> {
  if (typeof window === 'undefined') {
    return { shouldRender: true };
  }
  if (isUserWorkspaceBridgeActive()) {
    // SQLite is the current-workspace source of truth. Keep now-storage only
    // for one-way legacy migration; it must not mirror every browser start.
    return { shouldRender: true };
  }
  if (window.desktopRuntime) {
    return { shouldRender: true };
  }
  if (isNowStorageBridgeStarted) {
    return { shouldRender: true };
  }

  isNowStorageBridgeStarted = true;
  try {
    const reloadScheduled = await syncNowStorageFromLocalBridge({ reloadMode: 'immediate' });
    return { shouldRender: !reloadScheduled };
  } catch (error) {
    console.warn('[localDataBridge] now-storage bootstrap 失败', error);
    return { shouldRender: true };
  }
}
