import { STORAGE_KEYS } from '../constants/storage-keys';

const LOCAL_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';

const MANAGED_KEYS = new Set<string>([
  STORAGE_KEYS.SELECTED_CHARACTERS,
  STORAGE_KEYS.TIMELINE_DATA,
  STORAGE_KEYS.SKILL_BUTTON_TABLE,
  STORAGE_KEYS.ALL_BUFF_LIST,
  STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE,
  STORAGE_KEYS.CHARACTER_INPUT_MAP,
  STORAGE_KEYS.CHARACTER_COMPUTED_MAP,
  STORAGE_KEYS.CHARACTER_DISPLAY_CACHE,
  STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE,
  STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER,
  STORAGE_KEYS.SELECTED_SKILL_BUTTON,
]);

type WorkspaceValues = Record<string, string | null>;

type WorkspaceResponse = {
  ok: boolean;
  workspace?: { values: WorkspaceValues; updatedAt: number } | null;
  payload?: unknown;
  checkoutRef?: unknown;
  error?: string | { message?: string };
  code?: string;
};

const memory = new Map<string, string | null>();
let sqliteWorkspaceActive = false;
let persistTimer: number | null = null;
let persistChain: Promise<void> = Promise.resolve();

function desktopRuntime() {
  return typeof window !== 'undefined' ? window.desktopRuntime : undefined;
}

function readBrowserSessionValues(): WorkspaceValues {
  if (typeof window === 'undefined') return {};
  const values: WorkspaceValues = {};
  for (const key of MANAGED_KEYS) {
    try {
      const value = window.sessionStorage.getItem(key);
      if (value !== null) values[key] = value;
    } catch {
      // Browser storage is only a legacy import source. Failure must not
      // prevent the SQLite-backed renderer from starting.
    }
  }
  return values;
}

function currentValues(): WorkspaceValues {
  return Object.fromEntries([...memory.entries()]);
}

function errorMessage(result: WorkspaceResponse | null): string {
  if (!result?.error) return result?.code || '未知错误';
  return typeof result.error === 'string' ? result.error : (result.error.message || result.code || '未知错误');
}

async function fetchWorkspace(path: string, init?: RequestInit): Promise<WorkspaceResponse | null> {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null;
  try {
    const response = await window.fetch(`${LOCAL_BRIDGE_ORIGIN}${path}`, {
      cache: 'no-store',
      ...init,
    });
    return await response.json() as WorkspaceResponse;
  } catch {
    return null;
  }
}

async function readWorkspace(): Promise<WorkspaceResponse | null> {
  const runtime = desktopRuntime();
  if (runtime?.getUserWorkspaceState) return runtime.getUserWorkspaceState();
  return fetchWorkspace('/data-management/workspace');
}

async function writeWorkspace(values: WorkspaceValues): Promise<WorkspaceResponse | null> {
  const payload = { values, updatedAt: Date.now() };
  const runtime = desktopRuntime();
  if (runtime?.putUserWorkspaceState) return runtime.putUserWorkspaceState(payload);
  return fetchWorkspace('/data-management/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function enqueuePersist(): void {
  if (!sqliteWorkspaceActive) return;
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const values = currentValues();
    persistChain = persistChain
      .catch(() => undefined)
      .then(async () => {
        const result = await writeWorkspace(values);
        if (!result?.ok) throw new Error(`user.sqlite 工作副本写入失败：${errorMessage(result)}`);
      })
      .catch((error) => {
        console.error('[userWorkspaceBridge] user.sqlite 写入失败', error);
      });
  }, 80);
}

function hydrateMemory(values: WorkspaceValues): void {
  memory.clear();
  for (const [key, value] of Object.entries(values)) {
    if (MANAGED_KEYS.has(key) && (typeof value === 'string' || value === null)) memory.set(key, value);
  }
}

function buildLegacyBrowserArchive(values: WorkspaceValues): unknown | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawSnapshots = window.localStorage.getItem(STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE);
    if (!rawSnapshots) return null;
    const snapshots = JSON.parse(rawSnapshots);
    const snapshotItems = Array.isArray((snapshots as { snapshots?: unknown }).snapshots)
      ? (snapshots as { snapshots: Array<{ createdAt?: unknown }> }).snapshots
      : [];
    const latestCreatedAt = snapshotItems.reduce((latest, snapshot) => {
      const createdAt = Number(snapshot?.createdAt);
      return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest;
    }, 0);
    // Stable metadata is part of the archived bytes and therefore its migration
    // hash. Do not stamp the current boot time, otherwise one browser archive
    // would be imported repeatedly on every launch.
    const archivedAt = latestCreatedAt > 0 ? new Date(latestCreatedAt).toISOString() : '1970-01-01T00:00:00.000Z';
    return {
      type: 'def.localdata.archive.v1',
      schemaVersion: 1,
      id: 'browser-timeline-snapshot-archive',
      name: '浏览器排轴快照',
      createdAt: archivedAt,
      exportedAt: archivedAt,
      sections: ['timeline'],
      storage: {
        local: { [STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE]: snapshots },
        session: values,
      },
    };
  } catch {
    return null;
  }
}

async function migrateBrowserArchive(values: WorkspaceValues): Promise<void> {
  const archive = buildLegacyBrowserArchive(values);
  if (!archive) return;
  const runtime = desktopRuntime();
  try {
    const result = runtime?.migrateBrowserLegacyArchive
      ? await runtime.migrateBrowserLegacyArchive({ archive })
      : await fetchWorkspace('/data-management/migrate-browser-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive }),
      });
    if (!result?.ok) console.warn('[userWorkspaceBridge] 浏览器旧快照迁移失败', errorMessage(result));
  } catch (error) {
    console.warn('[userWorkspaceBridge] 浏览器旧快照迁移失败', error);
  }
}

export async function bootstrapUserWorkspaceBridge(): Promise<{ active: boolean }> {
  const legacyValues = readBrowserSessionValues();
  const result = await readWorkspace();
  if (!result?.ok) {
    console.warn('[userWorkspaceBridge] 未连接 user.sqlite，继续使用旧浏览器兼容层', errorMessage(result));
    return { active: false };
  }

  sqliteWorkspaceActive = true;
  if (result.workspace?.values) {
    hydrateMemory(result.workspace.values);
  } else {
    hydrateMemory(legacyValues);
    if (Object.keys(legacyValues).length > 0) enqueuePersist();
  }
  await migrateBrowserArchive(legacyValues);
  return { active: true };
}

export function isUserWorkspaceBridgeActive(): boolean {
  return sqliteWorkspaceActive;
}

export function isUserWorkspaceManagedKey(key: string): boolean {
  return MANAGED_KEYS.has(key);
}

export function getUserWorkspaceManagedKeys(): string[] {
  return [...MANAGED_KEYS];
}

export function getUserWorkspaceStorageEntries(): Array<[string, string]> {
  if (!sqliteWorkspaceActive) return [];
  return [...memory.entries()]
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

export function getUserWorkspaceStorageItem(key: string): string | null | undefined {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return undefined;
  return memory.get(key) ?? null;
}

export function setUserWorkspaceStorageItem(key: string, value: string): boolean {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return false;
  memory.set(key, value);
  enqueuePersist();
  return true;
}

export function removeUserWorkspaceStorageItem(key: string): boolean {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return false;
  memory.set(key, null);
  enqueuePersist();
  return true;
}

function valuesFromTimelinePayload(payload: Record<string, unknown>): WorkspaceValues {
  const json = (key: string, fallback: unknown) => JSON.stringify(payload[key] === undefined ? fallback : payload[key]);
  const anomalies = Array.isArray(payload.anomalyStateSnapshots) ? payload.anomalyStateSnapshots : [];
  return {
    [STORAGE_KEYS.SELECTED_CHARACTERS]: json('selectedCharacters', []),
    [STORAGE_KEYS.TIMELINE_DATA]: json('timelineData', { staffLines: [] }),
    [STORAGE_KEYS.SKILL_BUTTON_TABLE]: json('skillButtonTable', {}),
    [STORAGE_KEYS.ALL_BUFF_LIST]: json('allBuffList', []),
    [STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE]: JSON.stringify({
      version: 'v1',
      nextId: anomalies.reduce((maxId, item) => Math.max(maxId, Number((item as { id?: unknown })?.id) || 0), 0) + 1,
      snapshots: anomalies,
    }),
    [STORAGE_KEYS.CHARACTER_INPUT_MAP]: json('characterInputMap', {}),
    [STORAGE_KEYS.CHARACTER_COMPUTED_MAP]: json('characterComputedMap', {}),
    [STORAGE_KEYS.CHARACTER_DISPLAY_CACHE]: json('characterDisplayCacheMap', {}),
    [STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE]: json('operatorConfigPageCache', {}),
  };
}

export async function restoreUserWorkspaceSnapshot(input: {
  timelineId: string;
  snapshotId: string;
  updatedAt?: number;
}): Promise<{ payload: unknown; checkoutRef: unknown }> {
  const runtime = desktopRuntime();
  const result = runtime?.restoreUserWorkspaceSnapshot
    ? await runtime.restoreUserWorkspaceSnapshot(input)
    : await fetchWorkspace('/data-management/workspace/restore-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  if (!result?.ok || !result.payload) throw new Error(`恢复 SQLite 工作副本失败：${errorMessage(result)}`);
  if (sqliteWorkspaceActive && result.payload && typeof result.payload === 'object') {
    hydrateMemory(valuesFromTimelinePayload(result.payload as Record<string, unknown>));
  }
  return { payload: result.payload, checkoutRef: result.checkoutRef };
}

export async function flushUserWorkspaceState(): Promise<void> {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
    const result = await writeWorkspace(currentValues());
    if (!result?.ok) throw new Error(`user.sqlite 工作副本写入失败：${errorMessage(result)}`);
  }
  await persistChain;
}
