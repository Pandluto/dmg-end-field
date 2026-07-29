import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(
  repositoryRoot,
  'data',
  'sharedata',
  'share-20260718-003031-7-18.json',
);
const outputPath = path.join(repositoryRoot, 'public', 'data', 'default-local-data.json');
const imageManifestPath = path.join(repositoryRoot, 'public', 'web-image-manifest.json');

const sectionPrefixes = {
  operators: ['def.operator-editor.'],
  weapons: ['def.weapon-sheet.'],
  equipments: ['def.equipment-sheet.'],
  buffs: ['def.buff-editor.', 'def.buff-sheet.'],
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

  let candidates = [];
  if (normalized.startsWith('assets/images/')) return normalized;
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

const local = normalizeWebValues(Object.fromEntries(
  Object.entries(source.storage.local)
    .filter(([key]) => isIndependentLibraryKey(key)),
));

const operatorCount = countRecord(local['def.operator-editor.library.v1']);
const weaponCount = countRecord(local['def.weapon-sheet.library.v1']);
if (operatorCount < 30 || weaponCount < 75) {
  throw new Error(
    `默认 Web 数据源不完整：干员 ${operatorCount}，武器 ${weaponCount}`,
  );
}
const normalizedImageReferences = collectImageReferences(local);
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
  description: '从 7-18 Share Data 提取的干员、武器、装备与 Buff 本地库；不包含私人排轴或会话。',
  createdAt: source.createdAt || source.exportedAt,
  exportedAt: source.exportedAt || source.createdAt,
  sections: ['operators', 'weapons', 'equipments', 'buffs'],
  storage: {
    local,
    session: {},
  },
  source: {
    archiveId: source.id,
    fileName: path.basename(sourcePath),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(archive)}\n`);
console.log(
  `Web default data package: ${operatorCount} operators, ${weaponCount} weapons, `
  + `${Object.keys(local).length} storage keys, ${normalizedImageUrlCount} image URLs normalized, `
  + `${new Set(normalizedImageReferences).size} unique image files verified.`,
);
