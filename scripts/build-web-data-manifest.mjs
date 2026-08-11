import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(repositoryRoot, 'public');
const dataRoot = path.join(publicRoot, 'data');
const outputPath = path.join(publicRoot, 'web-data-manifest.json');
const defaultArchivePath = path.join(dataRoot, 'default-local-data.json');
const imageManifestPath = path.join(publicRoot, 'web-image-manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function storedRecord(value) {
  if (typeof value === 'string') {
    try {
      return storedRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const defaultArchive = readJson(defaultArchivePath);
const imageManifest = readJson(imageManifestPath);
const local = storedRecord(defaultArchive.storage?.local);
const files = [defaultArchivePath].map((absolutePath) => {
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: path.relative(publicRoot, absolutePath).split(path.sep).join('/'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
});
const defaultArchiveHash = files[0].sha256;
const sourceDate = String(defaultArchive.exportedAt || defaultArchive.createdAt || '')
  .slice(0, 10)
  .replace(/-/g, '') || 'undated';
const summary = {
  operators: Object.keys(storedRecord(local['def.operator-editor.library.v1'])).length,
  weapons: Object.keys(storedRecord(local['def.weapon-sheet.library.v1'])).length,
  images: Array.isArray(imageManifest.files) ? imageManifest.files.length : 0,
};

if (summary.operators === 0 || summary.weapons === 0 || summary.images === 0) {
  throw new Error(`Web data summary is incomplete: ${JSON.stringify(summary)}`);
}

const comparableManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-core-data',
  version: `${sourceDate}.${defaultArchiveHash.slice(0, 8)}`,
  summary,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
};

let generatedAt = new Date().toISOString();
try {
  const previous = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const { generatedAt: previousGeneratedAt, ...previousComparable } = previous;
  if (JSON.stringify(previousComparable) === JSON.stringify(comparableManifest)) {
    generatedAt = previousGeneratedAt;
  }
} catch {
  // A missing or invalid previous manifest represents a new package build.
}

const manifest = {
  ...comparableManifest,
  generatedAt,
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Web data manifest: ${files.length} files, ${manifest.totalBytes} bytes.`);
