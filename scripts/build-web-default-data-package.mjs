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
for (const imagePath of availableImages) {
  const fileName = path.posix.basename(imagePath);
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  if (!imagePathByStem.has(stem) || imagePath.includes('/img-equipment/icon_cn/')) {
    imagePathByStem.set(stem, imagePath);
  }
}

let normalizedImageUrlCount = 0;

function normalizeLegacyImageUrl(value) {
  if (typeof value !== 'string') return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (!['127.0.0.1:31457', 'localhost:31457'].includes(url.host)) return value;

  const relative = decodeURIComponent(url.pathname)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^user-images\//, '');
  const candidate = relative.startsWith('assets/')
    ? relative
    : relative.startsWith('img-equipment/icon_cn/')
      ? `assets/images/${relative}`
      : relative.startsWith('img-equipment/')
        ? `assets/images/img-equipment/icon_cn/${relative.slice('img-equipment/'.length)}`
        : `assets/images/${relative.replace(/^images\//, '')}`;
  const fileName = path.posix.basename(candidate);
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  const normalized = availableImages.has(candidate)
    ? candidate
    : imagePathByStem.get(stem)
      || imagePathByStem.get(stem.replace(/·[壹贰叁肆伍陆柒捌玖拾]型$/, ''));
  if (!normalized) {
    throw new Error(`图片包中不存在默认数据引用：${candidate}`);
  }
  normalizedImageUrlCount += 1;
  return normalized;
}

function normalizeWebValues(value) {
  if (Array.isArray(value)) return value.map(normalizeWebValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeWebValues(child)]),
    );
  }
  return normalizeLegacyImageUrl(value);
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
  + `${Object.keys(local).length} storage keys, ${normalizedImageUrlCount} image URLs normalized.`,
);
