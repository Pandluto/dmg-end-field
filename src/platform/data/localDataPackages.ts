import { LOCAL_LIBRARY_CHANGED_EVENT } from '../../constants/events';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import {
  importLegacyTimelineArchive,
  exportLegacyTimelineArchives,
  type LegacyTimelineArchive,
} from '../timeline/browserTimelineStore';
import {
  canonicalizeWebImageReferences,
  exportWebImageAssets,
  importWebImageAssets,
  type PortableWebImageAsset,
} from '../resources/webImageLibrary';
import { webDatabase, type SqlPrimitive } from '../database/webDatabase';
import { readInstalledResourcePackageFile } from '../resources/resourcePackage';
import {
  persistentLocalStorage,
  flushPersistentStorage,
} from '../storage/persistentStorage';

export type LocalDataScope = 'local' | 'share';
export type LocalDataSection =
  | 'operators'
  | 'weapons'
  | 'equipments'
  | 'buffs'
  | 'timeline'
  | 'runtime'
  | 'all';

export type LocalDataArchive = {
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
  timelineArchives?: LegacyTimelineArchive[];
  imageAssets?: PortableWebImageAsset[];
  dataVersion?: string;
  source?: unknown;
};

export type LocalDataLibraryCounts = {
  operators: number;
  weapons: number;
  equipmentSets: number;
  equipments: number;
  buffGroups: number;
  buffItems: number;
};

export type LocalDataPackageSummary = {
  scope: LocalDataScope;
  packageId: string;
  name: string;
  description: string;
  sourceName: string;
  dataVersion: string;
  createdAt: string;
  updatedAt: number;
  byteSize: number;
  timelineArchiveCount: number;
  imageAssetCount: number;
  imageAssetBytes: number;
  counts: LocalDataLibraryCounts;
  active: boolean;
};

export type LocalDataApplyResult = {
  package: LocalDataPackageSummary;
  backup: LocalDataPackageSummary | null;
  writtenKeys: number;
  removedKeys: number;
  importedTimelineArchives: number;
  reusedTimelineArchives: number;
  importedImageAssets: number;
  importedImageBytes: number;
  counts: LocalDataLibraryCounts;
};

type PackageRow = Record<string, SqlPrimitive> & {
  storage_scope: string;
  package_id: string;
  name: string;
  description: string | null;
  archive_json: string;
  content_hash: string;
  source_name: string | null;
  data_version: string | null;
  created_at: string;
  updated_at: number;
  byte_size: number;
};

const DEFAULT_DATA_ARCHIVE_PATH = 'data/default-local-data.json';
const DEFAULT_DATA_ARCHIVE_ID_PREFIX = 'web-lts-official-';
const ACTIVE_DATA_PACKAGE_META_KEY = 'active_local_data_package';
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

const LOCAL_PREFIXES_BY_SECTION: Record<
  Exclude<LocalDataSection, 'all' | 'timeline' | 'runtime'>,
  string[]
> = {
  operators: ['def.operator-editor.'],
  weapons: ['def.weapon-sheet.'],
  equipments: ['def.equipment-sheet.'],
  buffs: ['def.buff-editor.', 'def.buff-sheet.'],
};

const INDEPENDENT_SECTIONS = Object.keys(LOCAL_PREFIXES_BY_SECTION) as Array<
  keyof typeof LOCAL_PREFIXES_BY_SECTION
>;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return recordValue(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  if (typeof value === 'string') {
    try {
      return arrayValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeSections(value: unknown): LocalDataSection[] {
  const allowed = new Set<LocalDataSection>([
    'operators',
    'weapons',
    'equipments',
    'buffs',
    'timeline',
    'runtime',
    'all',
  ]);
  const sections = Array.isArray(value)
    ? value.filter((section): section is LocalDataSection => allowed.has(section as LocalDataSection))
    : [];
  return sections.length > 0 ? [...new Set(sections)] : ['all'];
}

function normalizePortableImageAssets(value: unknown): PortableWebImageAsset[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('数据包 imageAssets 必须是数组。');
  }
  const assets = value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`数据包第 ${index + 1} 张图片无效。`);
    }
    const candidate = item as Partial<PortableWebImageAsset>;
    if (
      typeof candidate.relativePath !== 'string'
      || typeof candidate.mimeType !== 'string'
      || !Number.isSafeInteger(candidate.sizeBytes)
      || Number(candidate.sizeBytes) < 0
      || !Number.isFinite(candidate.updatedAt)
      || typeof candidate.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(candidate.sha256)
      || typeof candidate.contentBase64 !== 'string'
    ) {
      throw new Error(`数据包第 ${index + 1} 张图片字段无效。`);
    }
    return {
      relativePath: candidate.relativePath,
      mimeType: candidate.mimeType,
      sizeBytes: Number(candidate.sizeBytes),
      updatedAt: Number(candidate.updatedAt),
      sha256: candidate.sha256.toLowerCase(),
      contentBase64: candidate.contentBase64,
    };
  });
  return assets.length > 0 ? assets : undefined;
}

export function normalizeLocalDataArchive(value: unknown): LocalDataArchive {
  if (
    !value
    || typeof value !== 'object'
    || (value as { type?: unknown }).type !== 'def.localdata.archive.v1'
  ) {
    throw new Error('数据包必须是 def.localdata.archive.v1。');
  }
  const candidate = value as Partial<LocalDataArchive>;
  if (!candidate.id?.trim() || !candidate.storage || typeof candidate.storage !== 'object') {
    throw new Error('数据包缺少 id 或 storage。');
  }
  const now = new Date().toISOString();
  const timelineArchives = candidate.timelineArchives === undefined
    ? undefined
    : candidate.timelineArchives;
  if (timelineArchives !== undefined && !Array.isArray(timelineArchives)) {
    throw new Error('数据包 timelineArchives 必须是数组。');
  }
  const imageAssets = normalizePortableImageAssets(candidate.imageAssets);
  return {
    ...cloneJson(candidate),
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: candidate.id.trim(),
    name: candidate.name?.trim() || candidate.id.trim(),
    description: candidate.description?.trim() || undefined,
    createdAt: candidate.createdAt || now,
    exportedAt: candidate.exportedAt || candidate.createdAt || now,
    sections: normalizeSections(candidate.sections),
    storage: {
      local: recordValue(candidate.storage.local),
      session: recordValue(candidate.storage.session),
    },
    ...(timelineArchives ? {
      timelineArchives: cloneJson(timelineArchives),
    } : {}),
    ...(imageAssets ? { imageAssets } : {}),
  };
}

function shouldIncludeLocalKey(key: string, sections: LocalDataSection[]): boolean {
  const targetSections = sections.includes('all') ? INDEPENDENT_SECTIONS : sections;
  return targetSections.some((section) => {
    if (!(section in LOCAL_PREFIXES_BY_SECTION)) return false;
    return LOCAL_PREFIXES_BY_SECTION[
      section as keyof typeof LOCAL_PREFIXES_BY_SECTION
    ].some((prefix) => key === prefix || key.startsWith(prefix));
  });
}

function independentLocalValues(
  values: Record<string, unknown>,
  sections: LocalDataSection[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => shouldIncludeLocalKey(key, sections)),
  );
}

export function summarizeLocalDataArchive(
  archive: Pick<LocalDataArchive, 'storage'>,
): LocalDataLibraryCounts {
  const local = archive.storage.local;
  const operators = recordValue(local['def.operator-editor.library.v1']);
  const weapons = recordValue(local['def.weapon-sheet.library.v1']);
  const equipmentLibrary = recordValue(local['def.equipment-sheet.library.v1']);
  const gearSets = recordValue(equipmentLibrary.gearSets);
  const buffGroups = recordValue(local['def.buff-editor.library.v1']);
  return {
    operators: Object.keys(operators).length,
    weapons: Object.keys(weapons).length,
    equipmentSets: Object.keys(gearSets).length,
    equipments: Object.values(gearSets).reduce<number>(
      (count, gearSet) => count + Object.keys(recordValue(recordValue(gearSet).equipments)).length,
      0,
    ),
    buffGroups: Object.keys(buffGroups).length,
    buffItems: Object.values(buffGroups).reduce<number>(
      (count, group) => count + Object.keys(recordValue(recordValue(group).items)).length,
      0,
    ),
  };
}

function activePackageKey(scope: LocalDataScope, packageId: string): string {
  return `${scope}:${packageId}`;
}

async function readActivePackageKey(): Promise<string> {
  const rows = await webDatabase.query<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [ACTIVE_DATA_PACKAGE_META_KEY],
  );
  return rows[0]?.value || '';
}

async function writeActivePackageKey(
  scope: LocalDataScope,
  packageId: string,
): Promise<void> {
  await webDatabase.execute(
    `
      INSERT INTO app_meta(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [ACTIVE_DATA_PACKAGE_META_KEY, activePackageKey(scope, packageId), Date.now()],
  );
}

function rowToArchive(row: PackageRow): LocalDataArchive {
  return normalizeLocalDataArchive(JSON.parse(String(row.archive_json)));
}

async function rowToSummary(
  row: PackageRow,
  activeKey?: string,
): Promise<LocalDataPackageSummary> {
  const archive = rowToArchive(row);
  const currentActiveKey = activeKey ?? await readActivePackageKey();
  return {
    scope: row.storage_scope === 'local' ? 'local' : 'share',
    packageId: String(row.package_id),
    name: String(row.name),
    description: String(row.description || ''),
    sourceName: String(row.source_name || ''),
    dataVersion: String(row.data_version || ''),
    createdAt: String(row.created_at),
    updatedAt: Number(row.updated_at),
    byteSize: Number(row.byte_size),
    timelineArchiveCount: archive.timelineArchives?.length || 0,
    imageAssetCount: archive.imageAssets?.length || 0,
    imageAssetBytes: (archive.imageAssets || []).reduce(
      (total, asset) => total + asset.sizeBytes,
      0,
    ),
    counts: summarizeLocalDataArchive(archive),
    active: currentActiveKey === activePackageKey(
      row.storage_scope === 'local' ? 'local' : 'share',
      String(row.package_id),
    ),
  };
}

export async function listLocalDataPackages(
  scope?: LocalDataScope,
): Promise<LocalDataPackageSummary[]> {
  const rows = scope
    ? await webDatabase.query<PackageRow>(
      'SELECT * FROM local_data_packages WHERE storage_scope = ? ORDER BY updated_at DESC',
      [scope],
    )
    : await webDatabase.query<PackageRow>(
      'SELECT * FROM local_data_packages ORDER BY updated_at DESC',
    );
  const activeKey = await readActivePackageKey();
  return Promise.all(rows.map((row) => rowToSummary(row, activeKey)));
}

export async function readLocalDataPackage(
  scope: LocalDataScope,
  packageId: string,
): Promise<LocalDataArchive> {
  const rows = await webDatabase.query<PackageRow>(
    'SELECT * FROM local_data_packages WHERE storage_scope = ? AND package_id = ?',
    [scope, packageId],
  );
  if (!rows[0]) throw new Error(`找不到数据包：${scope}:${packageId}`);
  return rowToArchive(rows[0]);
}

export async function saveLocalDataPackage(input: {
  scope: LocalDataScope;
  archive: unknown;
  sourceName?: string;
  replace?: boolean;
}): Promise<{ summary: LocalDataPackageSummary; reused: boolean }> {
  let archive = normalizeLocalDataArchive(input.archive);
  let contentHash = await sha256(stableJson(archive));
  let packageId = archive.id;
  const existing = await webDatabase.query<PackageRow>(
    'SELECT * FROM local_data_packages WHERE storage_scope = ? AND package_id = ?',
    [input.scope, packageId],
  );
  if (existing[0]?.content_hash === contentHash) {
    return { summary: await rowToSummary(existing[0]), reused: true };
  }
  if (existing[0] && !input.replace) {
    packageId = `${packageId}-${contentHash.slice(0, 10)}`;
    archive = { ...archive, id: packageId };
    contentHash = await sha256(stableJson(archive));
  }
  const archiveJson = JSON.stringify(archive);
  const updatedAt = Date.now();
  await webDatabase.execute(
    `
      INSERT INTO local_data_packages(
        storage_scope, package_id, name, description, archive_json,
        content_hash, source_name, data_version, created_at, updated_at, byte_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(storage_scope, package_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        archive_json = excluded.archive_json,
        content_hash = excluded.content_hash,
        source_name = excluded.source_name,
        data_version = excluded.data_version,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        byte_size = excluded.byte_size
    `,
    [
      input.scope,
      packageId,
      archive.name,
      archive.description || null,
      archiveJson,
      contentHash,
      input.sourceName || null,
      archive.dataVersion || null,
      archive.createdAt,
      updatedAt,
      new TextEncoder().encode(archiveJson).byteLength,
    ],
  );
  const rows = await webDatabase.query<PackageRow>(
    'SELECT * FROM local_data_packages WHERE storage_scope = ? AND package_id = ?',
    [input.scope, packageId],
  );
  return { summary: await rowToSummary(rows[0]), reused: false };
}

export async function deleteLocalDataPackage(
  scope: LocalDataScope,
  packageId: string,
): Promise<void> {
  const result = await webDatabase.execute(
    'DELETE FROM local_data_packages WHERE storage_scope = ? AND package_id = ?',
    [scope, packageId],
  );
  if (!result.changes) throw new Error('要删除的数据包不存在。');
}

export async function importLocalDataPackageFile(
  scope: LocalDataScope,
  file: File,
): Promise<{ summary: LocalDataPackageSummary; reused: boolean }> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('数据包超过 64 MB，已拒绝导入。');
  }
  const text = await file.text();
  const archive = normalizeLocalDataArchive(JSON.parse(text.replace(/^\uFEFF/, '')));
  return saveLocalDataPackage({
    scope,
    archive,
    sourceName: file.name,
  });
}

export async function fetchDefaultLocalDataArchive(): Promise<LocalDataArchive> {
  const { bytes, installed } = await readInstalledResourcePackageFile(DEFAULT_DATA_ARCHIVE_PATH);
  const archive = normalizeLocalDataArchive(JSON.parse(new TextDecoder().decode(bytes)));
  const versionId = `${DEFAULT_DATA_ARCHIVE_ID_PREFIX}${installed.version.replace(/[^A-Za-z0-9._-]/g, '-')}`;
  return {
    ...archive,
    id: versionId,
    name: `Web LTS 官方基础数据 · ${installed.version}`,
    description: '已下载到 Share Data；只有明确点击应用后才会替换当前资料。',
    dataVersion: installed.version,
  };
}

export async function ensureDefaultLocalDataPackage(
  options: { replace?: boolean } = {},
): Promise<LocalDataPackageSummary> {
  const archive = await fetchDefaultLocalDataArchive();
  if (!options.replace) {
    const existing = await listLocalDataPackages('share');
    const found = existing.find((item) => item.packageId === archive.id);
    if (found) return found;
  }
  return (
    await saveLocalDataPackage({
      scope: 'share',
      archive,
      sourceName: `${DEFAULT_DATA_ARCHIVE_PATH}@${archive.dataVersion || 'unknown'}`,
      replace: true,
    })
  ).summary;
}

function storageValue(
  values: Record<string, unknown>,
  key: string,
  fallback: unknown,
): unknown {
  const value = values[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function legacyWorkspacePayload(archive: LocalDataArchive): Record<string, unknown> {
  const session = archive.storage.session;
  const local = archive.storage.local;
  const anomalyArchive = recordValue(storageValue(
    session,
    STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE,
    {},
  ));
  return {
    selectedCharacters: arrayValue(storageValue(
      session,
      STORAGE_KEYS.SELECTED_CHARACTERS,
      [],
    )),
    timelineData: recordValue(storageValue(
      session,
      STORAGE_KEYS.TIMELINE_DATA,
      { staffLines: [] },
    )),
    skillButtonTable: recordValue(storageValue(
      session,
      STORAGE_KEYS.SKILL_BUTTON_TABLE,
      {},
    )),
    allBuffList: arrayValue(storageValue(
      session,
      STORAGE_KEYS.ALL_BUFF_LIST,
      [],
    )),
    anomalyStateSnapshots: arrayValue(anomalyArchive.snapshots),
    characterInputMap: recordValue(storageValue(
      session,
      STORAGE_KEYS.CHARACTER_INPUT_MAP,
      {},
    )),
    characterComputedMap: recordValue(storageValue(
      session,
      STORAGE_KEYS.CHARACTER_COMPUTED_MAP,
      {},
    )),
    characterDisplayCacheMap: recordValue(storageValue(
      session,
      STORAGE_KEYS.CHARACTER_DISPLAY_CACHE,
      {},
    )),
    operatorConfigPageCache: recordValue(storageValue(
      session,
      STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE,
      {},
    )),
    legacyStorage: { local, session },
  };
}

async function importArchiveTimelineContent(
  archive: LocalDataArchive,
): Promise<{ imported: number; reused: number }> {
  const candidates: LegacyTimelineArchive[] = [];
  for (const timelineArchive of archive.timelineArchives || []) {
    candidates.push({
      ...timelineArchive,
      source: 'shared',
    });
  }

  if (candidates.length === 0) {
    const snapshotArchive = recordValue(storageValue(
      archive.storage.local,
      STORAGE_KEYS.TIMELINE_SNAPSHOT_ARCHIVE,
      {},
    ));
    const snapshots = arrayValue(snapshotArchive.snapshots);
    const packageHash = await sha256(stableJson(archive));
    snapshots.forEach((value, index) => {
      const snapshot = recordValue(value);
      const payload = recordValue(snapshot.payload);
      if (Object.keys(payload).length === 0) return;
      candidates.push({
        type: 'dmg.timeline-archive.v1',
        archiveVersion: 1,
        source: 'shared',
        archiveId: `package-${packageHash.slice(0, 20)}-${index + 1}`,
        label: String(snapshot.label || `旧快照 ${index + 1}`),
        createdAt: new Date(Number(snapshot.createdAt) || Date.now()).toISOString(),
        payload: payload as unknown as LegacyTimelineArchive['payload'],
      });
    });

    const hasLegacyWorkspace = [
      STORAGE_KEYS.TIMELINE_DATA,
      STORAGE_KEYS.SKILL_BUTTON_TABLE,
      STORAGE_KEYS.SELECTED_CHARACTERS,
    ].some((key) => Object.prototype.hasOwnProperty.call(archive.storage.session, key));
    if (hasLegacyWorkspace) {
      candidates.unshift({
        type: 'dmg.timeline-archive.v1',
        archiveVersion: 1,
        source: 'shared',
        archiveId: `package-${packageHash.slice(0, 20)}-current`,
        label: `${archive.name}（当前态）`,
        createdAt: archive.createdAt,
        payload: legacyWorkspacePayload(archive) as unknown as LegacyTimelineArchive['payload'],
      });
    }
  }

  let imported = 0;
  let reused = 0;
  for (const timelineArchive of candidates) {
    const result = await importLegacyTimelineArchive(timelineArchive, 'shared');
    imported += result.imported ? 1 : 0;
    reused += result.reused ? 1 : 0;
  }
  return { imported, reused };
}

export function readAppliedLocalDataCounts(): LocalDataLibraryCounts {
  const local = Object.fromEntries(
    persistentLocalStorage.entries().map(([key, value]) => [key, parseStoredValue(value)]),
  );
  return summarizeLocalDataArchive({
    storage: { local, session: {} },
  });
}

export function hasAppliedIndependentLibraries(): boolean {
  const counts = readAppliedLocalDataCounts();
  return counts.operators > 0 && counts.weapons > 0;
}

export function hasAnyAppliedIndependentLibraries(): boolean {
  const counts = readAppliedLocalDataCounts();
  return Object.values(counts).some((count) => count > 0);
}

export async function createCurrentLocalDataArchive(input: {
  name?: string;
  description?: string;
} = {}): Promise<LocalDataArchive> {
  const now = new Date().toISOString();
  const local = Object.fromEntries(
    persistentLocalStorage.entries()
      .filter(([key]) => key.startsWith('def.'))
      .map(([key, value]) => [
        key,
        canonicalizeWebImageReferences(parseStoredValue(value)),
      ]),
  );
  const imageAssets = await exportWebImageAssets();
  return {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: `local-${now.replace(/\D/g, '').slice(0, 14)}`,
    name: input.name?.trim() || `本地数据 ${new Date().toLocaleString('zh-CN')}`,
    description: input.description?.trim() || undefined,
    createdAt: now,
    exportedAt: now,
    sections: ['all'],
    storage: { local, session: {} },
    timelineArchives: await exportLegacyTimelineArchives('shared'),
    ...(imageAssets.length > 0 ? { imageAssets } : {}),
  };
}

export async function saveCurrentLocalDataPackage(
  scope: LocalDataScope,
  input: { name?: string; description?: string } = {},
): Promise<LocalDataPackageSummary> {
  const archive = await createCurrentLocalDataArchive(input);
  return (
    await saveLocalDataPackage({
      scope,
      archive,
      sourceName: 'browser-current-data',
    })
  ).summary;
}

async function replaceIndependentLibraries(
  archive: LocalDataArchive,
): Promise<{ writtenKeys: number; removedKeys: number }> {
  const sections = normalizeSections(archive.sections);
  const nextValues = canonicalizeWebImageReferences(
    independentLocalValues(archive.storage.local, sections),
  );
  const previousValues = new Map<string, string>();
  const managedKeys = persistentLocalStorage.entries()
    .map(([key]) => key)
    .filter((key) => shouldIncludeLocalKey(key, sections));
  managedKeys.forEach((key) => {
    const previous = persistentLocalStorage.getItem(key);
    if (previous !== null) previousValues.set(key, previous);
    persistentLocalStorage.removeItem(key);
  });
  Object.entries(nextValues).forEach(([key, value]) => {
    persistentLocalStorage.setItem(key, stringifyStoredValue(value));
  });
  try {
    await flushPersistentStorage();
    const failedKeys = Object.entries(nextValues)
      .filter(([key, value]) => (
        persistentLocalStorage.getItem(key) !== stringifyStoredValue(value)
      ))
      .map(([key]) => key);
    if (failedKeys.length > 0) {
      throw new Error(`浏览器 SQLite 写入校验失败：${failedKeys.join(', ')}`);
    }
  } catch (error) {
    Object.keys(nextValues).forEach((key) => persistentLocalStorage.removeItem(key));
    previousValues.forEach((value, key) => persistentLocalStorage.setItem(key, value));
    await flushPersistentStorage().catch(() => undefined);
    throw error;
  }
  window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_CHANGED_EVENT));
  return {
    writtenKeys: Object.keys(nextValues).length,
    removedKeys: managedKeys.length,
  };
}

export async function normalizeAppliedLocalDataImagePaths(): Promise<{
  updatedKeys: number;
}> {
  const updates = persistentLocalStorage.entries()
    .filter(([key]) => shouldIncludeLocalKey(key, ['all']))
    .flatMap(([key, storedValue]) => {
      const current = parseStoredValue(storedValue);
      const normalized = canonicalizeWebImageReferences(current);
      const nextValue = stringifyStoredValue(normalized);
      return nextValue === storedValue ? [] : [[key, nextValue] as const];
    });
  if (updates.length === 0) return { updatedKeys: 0 };
  updates.forEach(([key, value]) => persistentLocalStorage.setItem(key, value));
  await flushPersistentStorage();
  window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_CHANGED_EVENT));
  return { updatedKeys: updates.length };
}

export async function applyLocalDataPackage(input: {
  scope: LocalDataScope;
  packageId: string;
  backup?: boolean;
}): Promise<LocalDataApplyResult> {
  const archive = await readLocalDataPackage(input.scope, input.packageId);
  let backup: LocalDataPackageSummary | null = null;
  if (input.backup !== false && persistentLocalStorage.entries().some(
    ([key]) => shouldIncludeLocalKey(key, ['all']),
  )) {
    backup = await saveCurrentLocalDataPackage('local', {
      name: `应用前备份 ${new Date().toLocaleString('zh-CN')}`,
      description: `应用 ${archive.name} 前自动保存`,
    });
  }
  const imageResult = await importWebImageAssets(archive.imageAssets || []);
  const timelineResult = await importArchiveTimelineContent(archive);
  const storageResult = await replaceIndependentLibraries(archive);
  await writeActivePackageKey(input.scope, input.packageId);
  const packages = await listLocalDataPackages(input.scope);
  const summary = packages.find((item) => item.packageId === input.packageId);
  if (!summary) throw new Error('数据已应用，但无法刷新数据包摘要。');
  return {
    package: summary,
    backup,
    writtenKeys: storageResult.writtenKeys,
    removedKeys: storageResult.removedKeys,
    importedTimelineArchives: timelineResult.imported,
    reusedTimelineArchives: timelineResult.reused,
    importedImageAssets: imageResult.imported,
    importedImageBytes: imageResult.totalBytes,
    counts: readAppliedLocalDataCounts(),
  };
}

export async function applyDefaultLocalDataPackage(input: {
  backup?: boolean;
  replacePackage?: boolean;
} = {}): Promise<LocalDataApplyResult> {
  const installed = await ensureDefaultLocalDataPackage({
    replace: input.replacePackage,
  });
  return applyLocalDataPackage({
    scope: 'share',
    packageId: installed.packageId,
    backup: input.backup,
  });
}
