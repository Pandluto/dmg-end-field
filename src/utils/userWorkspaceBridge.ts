import { STORAGE_KEYS } from '../constants/storage-keys';
import { webDatabase } from '../platform/database/webDatabase';
import { persistentWorkspaceStorage } from '../platform/storage/persistentStorage';

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

let sqliteWorkspaceActive = false;

export async function bootstrapUserWorkspaceBridge(): Promise<{ active: boolean }> {
  if (!persistentWorkspaceStorage.isHydrated()) {
    await persistentWorkspaceStorage.hydrate();
  }
  sqliteWorkspaceActive = true;
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
  return persistentWorkspaceStorage.entries().filter(([key]) => MANAGED_KEYS.has(key));
}

export function getUserWorkspaceStorageItem(key: string): string | null | undefined {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return undefined;
  return persistentWorkspaceStorage.getItem(key);
}

export function setUserWorkspaceStorageItem(key: string, value: string): boolean {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return false;
  persistentWorkspaceStorage.setItem(key, value);
  return true;
}

export function removeUserWorkspaceStorageItem(key: string): boolean {
  if (!sqliteWorkspaceActive || !MANAGED_KEYS.has(key)) return false;
  persistentWorkspaceStorage.removeItem(key);
  return true;
}

export function valuesFromTimelinePayload(payload: Record<string, unknown>): Record<string, string> {
  const json = (key: string, fallback: unknown) =>
    JSON.stringify(payload[key] === undefined ? fallback : payload[key]);
  const anomalies = Array.isArray(payload.anomalyStateSnapshots) ? payload.anomalyStateSnapshots : [];
  return {
    [STORAGE_KEYS.SELECTED_CHARACTERS]: json('selectedCharacters', []),
    [STORAGE_KEYS.TIMELINE_DATA]: json('timelineData', { staffLines: [] }),
    [STORAGE_KEYS.SKILL_BUTTON_TABLE]: json('skillButtonTable', {}),
    [STORAGE_KEYS.ALL_BUFF_LIST]: json('allBuffList', []),
    [STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE]: JSON.stringify({
      version: 'v1',
      nextId: anomalies.reduce(
        (maxId, item) => Math.max(maxId, Number((item as { id?: unknown })?.id) || 0),
        0,
      ) + 1,
      snapshots: anomalies,
    }),
    [STORAGE_KEYS.CHARACTER_INPUT_MAP]: json('characterInputMap', {}),
    [STORAGE_KEYS.CHARACTER_COMPUTED_MAP]: json('characterComputedMap', {}),
    [STORAGE_KEYS.CHARACTER_DISPLAY_CACHE]: json('characterDisplayCacheMap', {}),
    [STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE]: json('operatorConfigPageCache', {}),
  };
}

export async function replaceUserWorkspaceWithTimelinePayload(
  payload: Record<string, unknown>,
  updatedAt = Date.now(),
): Promise<{ values: Record<string, string | null>; updatedAt: number }> {
  const values = valuesFromTimelinePayload(payload);
  for (const key of MANAGED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      persistentWorkspaceStorage.setItem(key, values[key]);
    } else {
      persistentWorkspaceStorage.removeItem(key);
    }
  }
  await persistentWorkspaceStorage.flush();
  return { values, updatedAt };
}

export async function restoreUserWorkspaceSnapshot(input: {
  timelineId: string;
  snapshotId: string;
  updatedAt?: number;
}): Promise<{ payload: unknown; checkoutRef: unknown }> {
  const rows = await webDatabase.query<{ payload_json: string }>(
    'SELECT payload_json FROM timeline_snapshots WHERE id = ? AND timeline_id = ? AND archived = 0',
    [input.snapshotId, input.timelineId],
  );
  const row = rows[0];
  if (!row) throw new Error('找不到需要恢复的排轴快照。');
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  await replaceUserWorkspaceWithTimelinePayload(payload, input.updatedAt);
  const checkoutRef = {
    timelineId: input.timelineId,
    targetType: 'snapshot',
    targetId: input.snapshotId,
    updatedAt: input.updatedAt ?? Date.now(),
  };
  await webDatabase.execute(
    `
      INSERT INTO timeline_checkout_refs(timeline_id, target_type, target_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(timeline_id) DO UPDATE SET
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        updated_at = excluded.updated_at
    `,
    [
      checkoutRef.timelineId,
      checkoutRef.targetType,
      checkoutRef.targetId,
      checkoutRef.updatedAt,
    ],
  );
  return { payload, checkoutRef };
}

export async function flushUserWorkspaceState(): Promise<void> {
  await persistentWorkspaceStorage.flush();
}
