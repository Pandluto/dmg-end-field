import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(
  repositoryRoot,
  'data',
  'sharedata',
  'share-20260809-030612-8-9.json',
);
const legacyTimelineSourcePath = path.join(
  repositoryRoot,
  'data',
  'sharedata',
  'share-20260718-003031-7-18.json',
);
const outputPath = path.join(repositoryRoot, 'public', 'data', 'default-local-data.json');
const imageManifestPath = path.join(repositoryRoot, 'public', 'web-image-manifest.json');

if (!fs.existsSync(sourcePath)) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `缺少默认 Web 数据源且没有可复用产物：${path.relative(repositoryRoot, sourcePath)}`,
    );
  }
  console.log(
    `Default Web data source is not present; reusing tracked ${path.relative(repositoryRoot, outputPath)}.`,
  );
  process.exit(0);
}

const sectionPrefixes = {
  operators: ['def.operator-editor.'],
  weapons: ['def.weapon-sheet.'],
  equipments: ['def.equipment-sheet.'],
  buffs: ['def.buff-editor.', 'def.buff-sheet.'],
};
const timelineSnapshotArchiveKey = 'def.timeline.snapshot-archive.v1';
const workspaceStorageKeys = {
  selectedCharacters: 'def.selected-characters.v1',
  timelineData: 'def.timeline.data.v1',
  skillButtonTable: 'def.skill-button.v1',
  allBuffList: 'def.all-buff-list.v1',
  anomalyStateSnapshots: 'def.anomaly-state-snapshot-archive.v1',
  characterInputMap: 'def.operator-config.character-input-map.v3',
  characterComputedMap: 'def.operator-runtime.character-computed-map.v3',
  characterDisplayCacheMap: 'def.operator-ui.character-display-cache.v3',
  operatorConfigPageCache: 'def.operator-config.page-cache.v1',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function isIndependentLibraryKey(key) {
  return Object.values(sectionPrefixes)
    .flat()
    .some((prefix) => key === prefix || key.startsWith(prefix));
}

function countRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function storedValue(record, key, fallback) {
  const value = record?.[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

const imageManifest = readJson(imageManifestPath);
const availableImages = new Set(
  Array.isArray(imageManifest.files)
    ? imageManifest.files.map((entry) => entry.path)
    : [],
);
const imagePathByStem = new Map();
const imagePathByFileName = new Map();
for (const imagePath of availableImages) {
  const fileName = path.posix.basename(imagePath);
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  const preferred = !imagePathByFileName.has(fileName)
    || imagePath.includes('/img-equipment/icon_cn/');
  if (preferred) {
    imagePathByFileName.set(fileName, imagePath);
    imagePathByStem.set(stem, imagePath);
  }
}

let normalizedImageUrlCount = 0;

function availableImagePath(candidates, fileName) {
  const exact = candidates.find((candidate) => availableImages.has(candidate));
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  return exact
    || imagePathByFileName.get(fileName)
    || imagePathByStem.get(stem)
    || imagePathByStem.get(stem.replace(/·[壹贰叁肆伍陆柒捌玖拾]型$/, ''));
}

function normalizeLegacyAvatarPath(normalized) {
  const parts = normalized.replace(/^assets\/avatars\//, '').split('/').filter(Boolean);
  const operatorName = parts.shift() || '';
  const fileName = parts.at(-1) || '';
  if (!operatorName || !fileName) return null;
  const avatarCandidate = `assets/images/img-operator/${fileName}`;
  const skillCandidate = `assets/images/img-operator/skiil-icon/${operatorName}/${parts.join('/')}`;
  const operatorDirectoryCandidate = `assets/images/img-operator/${operatorName}/${parts.join('/')}`;
  const isAvatar = parts.length === 1
    && fileName.slice(0, -path.posix.extname(fileName).length) === operatorName;
  return availableImagePath(
    isAvatar
      ? [avatarCandidate, operatorDirectoryCandidate, skillCandidate]
      : [skillCandidate, operatorDirectoryCandidate, avatarCandidate],
    fileName,
  );
}

function normalizeImagePath(value) {
  if (typeof value !== 'string') return value;
  let normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  try {
    const url = new URL(value);
    if (!['127.0.0.1:31457', 'localhost:31457'].includes(url.host)) {
      return value;
    }
    normalized = decodeURIComponent(url.pathname)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
  } catch {
    // Relative paths are normalized below.
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep malformed legacy escaping intact so the resolver can report it.
  }

  let candidates = [];
  if (normalized.startsWith('assets/images/')) {
    if (availableImages.has(normalized)) return normalized;
    const fileName = path.posix.basename(normalized);
    const mapped = availableImagePath([normalized], fileName);
    if (mapped) {
      normalizedImageUrlCount += 1;
      return mapped;
    }
    return normalized;
  }
  if (normalized.startsWith('assets/avatars/')) {
    const mapped = normalizeLegacyAvatarPath(normalized);
    if (!mapped) throw new Error(`图片包中不存在旧干员引用：${normalized}`);
    normalizedImageUrlCount += 1;
    return mapped;
  }
  if (normalized.startsWith('user-images/')) {
    const relative = normalized.slice('user-images/'.length);
    candidates = [
      relative.startsWith('img-equipment/icon_cn/')
        ? `assets/images/${relative}`
        : relative.startsWith('img-equipment/')
          ? `assets/images/img-equipment/icon_cn/${relative.slice('img-equipment/'.length)}`
          : `assets/images/${relative.replace(/^images\//, '')}`,
    ];
  } else if (
    normalized.startsWith('public/images/')
    || normalized.startsWith('images/character/')
    || normalized.startsWith('images/weapon/')
  ) {
    candidates = [];
  } else {
    return value;
  }
  const fileName = path.posix.basename(normalized);
  const mapped = availableImagePath(candidates, fileName);
  if (!mapped) {
    throw new Error(`图片包中不存在默认数据引用：${normalized}`);
  }
  normalizedImageUrlCount += 1;
  return mapped;
}

function normalizeWebValues(value) {
  if (Array.isArray(value)) return value.map(normalizeWebValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeWebValues(child)]),
    );
  }
  return normalizeImagePath(value);
}

function collectImageReferences(value, references = []) {
  if (Array.isArray(value)) {
    value.forEach((child) => collectImageReferences(child, references));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((child) => collectImageReferences(child, references));
  } else if (
    typeof value === 'string'
    && (
      value.startsWith('assets/images/')
      || value.startsWith('assets/avatars/')
      || value.startsWith('user-images/')
      || value.startsWith('public/images/')
      || value.startsWith('/public/images/')
      || value.includes(':31457/')
    )
  ) {
    references.push(value);
  }
  return references;
}

const source = readJson(sourcePath);
if (
  source?.type !== 'def.localdata.archive.v1'
  || !source.storage?.local
  || typeof source.storage.local !== 'object'
) {
  throw new Error(`默认 Web 数据源无效：${path.relative(repositoryRoot, sourcePath)}`);
}

const sourceLocal = source.storage.local;
const sourceSession = recordValue(source.storage.session);
const sourceHasTimelineData = Boolean(
  sourceLocal[timelineSnapshotArchiveKey]
  || Object.values(workspaceStorageKeys).some((key) => (
    Object.prototype.hasOwnProperty.call(sourceSession, key)
  )),
);
const timelineSource = sourceHasTimelineData || !fs.existsSync(legacyTimelineSourcePath)
  ? source
  : readJson(legacyTimelineSourcePath);
const timelineSourceLocal = recordValue(timelineSource.storage?.local);
const timelineSourceSession = recordValue(timelineSource.storage?.session);

const local = normalizeWebValues(Object.fromEntries(
  Object.entries(source.storage.local)
    .filter(([key]) => isIndependentLibraryKey(key)),
));
const sourceSnapshotArchive = recordValue(storedValue(
  timelineSourceLocal,
  timelineSnapshotArchiveKey,
  {},
));
const sourceSnapshots = arrayValue(sourceSnapshotArchive.snapshots);
const timelineArchives = sourceSnapshots.flatMap((value, index) => {
  const snapshot = recordValue(value);
  const payload = recordValue(snapshot.payload);
  if (Object.keys(payload).length === 0) return [];
  const createdAt = Number(snapshot.createdAt) || Date.parse(timelineSource.createdAt) || Date.now();
  return [{
    type: 'dmg.timeline-archive.v1',
    archiveVersion: 1,
    source: 'shared',
    archiveId: `web-lts-1.8-shared-${String(index + 1).padStart(2, '0')}`,
    label: String(snapshot.label || `共享排轴 ${index + 1}`),
    createdAt: new Date(createdAt).toISOString(),
    payload: normalizeWebValues(payload),
  }];
});
const session = timelineSourceSession;
const hasCurrentWorkspace = Object.values(workspaceStorageKeys).some((key) => (
  Object.prototype.hasOwnProperty.call(session, key)
));
if (hasCurrentWorkspace) {
  const anomalyArchive = recordValue(storedValue(
    session,
    workspaceStorageKeys.anomalyStateSnapshots,
    {},
  ));
  timelineArchives.unshift({
    type: 'dmg.timeline-archive.v1',
    archiveVersion: 1,
    source: 'shared',
    archiveId: 'web-lts-1.8-shared-current',
    label: 'Web LTS 1.8 基础数据（当前态）',
    createdAt: timelineSource.createdAt || timelineSource.exportedAt,
    payload: normalizeWebValues({
      selectedCharacters: arrayValue(storedValue(
        session,
        workspaceStorageKeys.selectedCharacters,
        [],
      )),
      timelineData: recordValue(storedValue(
        session,
        workspaceStorageKeys.timelineData,
        { staffLines: [] },
      )),
      skillButtonTable: recordValue(storedValue(
        session,
        workspaceStorageKeys.skillButtonTable,
        {},
      )),
      allBuffList: arrayValue(storedValue(
        session,
        workspaceStorageKeys.allBuffList,
        [],
      )),
      anomalyStateSnapshots: arrayValue(anomalyArchive.snapshots),
      characterInputMap: recordValue(storedValue(
        session,
        workspaceStorageKeys.characterInputMap,
        {},
      )),
      characterComputedMap: recordValue(storedValue(
        session,
        workspaceStorageKeys.characterComputedMap,
        {},
      )),
      characterDisplayCacheMap: recordValue(storedValue(
        session,
        workspaceStorageKeys.characterDisplayCacheMap,
        {},
      )),
      operatorConfigPageCache: recordValue(storedValue(
        session,
        workspaceStorageKeys.operatorConfigPageCache,
        {},
      )),
    }),
  });
}

const operatorCount = countRecord(local['def.operator-editor.library.v1']);
const weaponCount = countRecord(local['def.weapon-sheet.library.v1']);
if (operatorCount < 30 || weaponCount < 75) {
  throw new Error(
    `默认 Web 数据源不完整：干员 ${operatorCount}，武器 ${weaponCount}`,
  );
}
const normalizedImageReferences = collectImageReferences({ local, timelineArchives });
const invalidImageReferences = normalizedImageReferences.filter(
  (reference) => !reference.startsWith('assets/images/') || !availableImages.has(reference),
);
if (invalidImageReferences.length > 0) {
  throw new Error(
    `默认 Web 数据仍有 ${invalidImageReferences.length} 条无效图片引用：`
    + invalidImageReferences.slice(0, 5).join(', '),
  );
}

const archive = {
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'web-lts-1.8-default-data',
  name: 'Web LTS 1.8 基础数据',
  description: '从最新 Share Data 整理的干员、武器、装备、Buff 本地库，并保留共享排轴。',
  createdAt: source.createdAt || source.exportedAt,
  exportedAt: source.exportedAt || source.createdAt,
  sections: ['operators', 'weapons', 'equipments', 'buffs', 'timeline'],
  storage: {
    local,
    session: {},
  },
  timelineArchives,
  source: {
    archiveId: source.id,
    fileName: path.basename(sourcePath),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(archive)}\n`);
console.log(
  `Web default data package: ${operatorCount} operators, ${weaponCount} weapons, `
  + `${timelineArchives.length} shared timelines, ${Object.keys(local).length} storage keys, `
  + `${normalizedImageUrlCount} image URLs normalized, `
  + `${new Set(normalizedImageReferences).size} unique image files verified.`,
);
