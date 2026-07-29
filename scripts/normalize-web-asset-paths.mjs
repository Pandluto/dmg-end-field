import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const equipmentPath = path.join(root, 'public', 'data', 'equipments', 'equipments.json');
const imageManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'public', 'web-image-manifest.json'), 'utf8'),
);
const availableImages = new Set(imageManifest.files.map((entry) => entry.path));
const imagePathByStem = new Map();
for (const entry of imageManifest.files) {
  const fileName = path.posix.basename(entry.path);
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  if (!imagePathByStem.has(stem) || entry.path.includes('/img-equipment/icon_cn/')) {
    imagePathByStem.set(stem, entry.path);
  }
}
const legacyPrefix = 'http://127.0.0.1:31457/user-images/';
let replacementCount = 0;

function normalizeValue(value) {
  if (typeof value !== 'string' || !value.startsWith(legacyPrefix)) return value;
  const relative = decodeURIComponent(value.slice(legacyPrefix.length)).replace(/\\/g, '/');
  const candidate = relative.startsWith('img-equipment/')
    ? `assets/images/img-equipment/icon_cn/${relative.slice('img-equipment/'.length)}`
    : `assets/images/${relative.replace(/^images\//, '')}`;
  const fileName = path.posix.basename(candidate);
  const stem = fileName.slice(0, -path.posix.extname(fileName).length);
  const normalized = availableImages.has(candidate)
    ? candidate
    : imagePathByStem.get(stem)
      || imagePathByStem.get(stem.replace(/·[壹贰叁肆伍陆柒捌玖拾]型$/, ''));
  if (!normalized) {
    throw new Error(`图片包中不存在规范化目标：${candidate}`);
  }
  replacementCount += 1;
  return normalized;
}

function visit(value) {
  if (Array.isArray(value)) return value.map(visit);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  }
  return normalizeValue(value);
}

const source = JSON.parse(fs.readFileSync(equipmentPath, 'utf8'));
const normalized = visit(source);
fs.writeFileSync(equipmentPath, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Normalized ${replacementCount} browser image paths in ${path.relative(root, equipmentPath)}.`);
