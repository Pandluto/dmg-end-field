import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  RESOURCE_CHANNEL_TYPE,
  RESOURCE_DEPLOYMENT_TYPE,
  RESOURCE_RELEASE_SCHEMA_VERSION,
} from '../src/platform/resources/resourceReleaseCore.ts';
import { verifyResourceReleaseBundle } from '../src/platform/resources/resourceReleaseVerifier.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少值。`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function writeBytes(root, relativePath, bytes) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const outputPath = path.resolve(root, normalized);
  if (!outputPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`拒绝写入目标目录外：${relativePath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
}

function descriptor(relativePath, bytes) {
  return { path: relativePath, sha256: sha256(bytes), size: bytes.byteLength };
}

const args = parseArguments(process.argv.slice(2));
const bundlePath = path.resolve(args.get('bundle') || '');
const publicRoot = path.resolve(args.get('public') || path.join(repositoryRoot, 'public'));
if (!args.get('bundle') || !fs.statSync(bundlePath, { throwIfNoEntry: false })?.isFile()) {
  throw new Error('请通过 --bundle 指定资源发布 ZIP。');
}
if (publicRoot === path.parse(publicRoot).root || publicRoot === repositoryRoot) {
  throw new Error('拒绝把仓库根目录或文件系统根目录作为资源输出目录。');
}

const verified = await verifyResourceReleaseBundle(new Uint8Array(fs.readFileSync(bundlePath)));
const { manifest, dataBytes, imageArchiveBytes, imageFiles } = verified;
const releaseBase = `resources/releases/${manifest.releaseVersion}`;
const releaseRoot = path.join(publicRoot, 'resources', 'releases');
const imageRoot = path.join(publicRoot, 'assets', 'images');
const packageRoot = path.join(publicRoot, 'packages');

// These are generated resource-only directories. The app icon and other shell
// assets live outside them, so cleaning cannot touch user data or source files.
fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });
if (fs.existsSync(imageRoot)) {
  for (const entry of fs.readdirSync(imageRoot)) {
    fs.rmSync(path.join(imageRoot, entry), { recursive: true, force: true });
  }
}
fs.mkdirSync(imageRoot, { recursive: true });
if (fs.existsSync(packageRoot)) {
  for (const entry of fs.readdirSync(packageRoot)) {
    if (entry.includes('.part-') || entry.endsWith('.zip') || entry.endsWith('.partial')) {
      fs.rmSync(path.join(packageRoot, entry), { force: true });
    }
  }
}

const partSize = 4 * 1024 * 1024;
const parts = [];
for (let offset = 0, index = 0; offset < imageArchiveBytes.byteLength; offset += partSize, index += 1) {
  const bytes = imageArchiveBytes.slice(offset, Math.min(offset + partSize, imageArchiveBytes.byteLength));
  const fileName = `${manifest.images.archive.fileName}.part-${String(index + 1).padStart(3, '0')}`;
  const relativePath = `${releaseBase}/packages/${fileName}`;
  writeBytes(publicRoot, relativePath, bytes);
  parts.push({ ...descriptor(relativePath, bytes), fileName });
}

writeBytes(publicRoot, `${releaseBase}/data/default-local-data.json`, dataBytes);
writeBytes(publicRoot, 'data/default-local-data.json', dataBytes);
for (const entry of manifest.images.files) {
  const archivePath = entry.path.replace(/^assets\//, '');
  const bytes = imageFiles[archivePath];
  writeBytes(publicRoot, entry.path, bytes);
}

const dataManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-core-data',
  version: manifest.data.version,
  releaseVersion: manifest.releaseVersion,
  generatedAt: manifest.generatedAt,
  summary: manifest.data.summary,
  files: [{
    ...manifest.data.file,
    downloadPath: `${releaseBase}/data/default-local-data.json`,
  }],
  totalBytes: manifest.data.file.size,
};
const imageManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-image-pack',
  version: manifest.images.version,
  releaseVersion: manifest.releaseVersion,
  generatedAt: manifest.generatedAt,
  releaseTag: manifest.releaseVersion,
  publicBasePath: 'assets/images',
  files: manifest.images.files,
  totalBytes: manifest.images.totalBytes,
  archive: {
    path: `${releaseBase}/${manifest.images.archive.path}`,
    fileName: manifest.images.archive.fileName,
    sha256: manifest.images.archive.sha256,
    size: manifest.images.archive.size,
    parts,
  },
};
const dataManifestBytes = jsonBytes(dataManifest);
const imageManifestBytes = jsonBytes(imageManifest);
const dataManifestPath = `${releaseBase}/web-data-manifest.json`;
const imageManifestPath = `${releaseBase}/web-image-manifest.json`;
writeBytes(publicRoot, dataManifestPath, dataManifestBytes);
writeBytes(publicRoot, imageManifestPath, imageManifestBytes);
writeBytes(publicRoot, 'web-data-manifest.json', dataManifestBytes);
writeBytes(publicRoot, 'web-image-manifest.json', imageManifestBytes);

const deploymentManifest = {
  ...manifest,
  type: RESOURCE_DEPLOYMENT_TYPE,
  delivery: {
    dataManifest: descriptor(dataManifestPath, dataManifestBytes),
    imageManifest: descriptor(imageManifestPath, imageManifestBytes),
  },
};
const deploymentBytes = jsonBytes(deploymentManifest);
const deploymentPath = `${releaseBase}/resource-release-manifest.json`;
writeBytes(publicRoot, deploymentPath, deploymentBytes);
const channel = {
  type: RESOURCE_CHANNEL_TYPE,
  schemaVersion: RESOURCE_RELEASE_SCHEMA_VERSION,
  channel: 'stable',
  releaseVersion: manifest.releaseVersion,
  publishedAt: manifest.generatedAt,
  releaseManifest: descriptor(deploymentPath, deploymentBytes),
};
writeBytes(publicRoot, 'resources/stable.json', jsonBytes(channel));

const updatedAt = Date.parse(manifest.generatedAt) || 0;
const browserIndex = manifest.images.files.map((entry) => {
  const fileName = path.posix.basename(entry.path);
  const ext = path.posix.extname(fileName).toLowerCase();
  return {
    fileName,
    baseName: ext ? fileName.slice(0, -ext.length) : fileName,
    ext,
    relativePath: entry.path,
    sizeBytes: entry.size,
    updatedAt,
    writable: false,
    source: 'release',
    rootId: 'release',
    rootLabel: '官方图片包',
    rootPriority: -1,
  };
});
writeBytes(publicRoot, 'assets/images/_manifest.json', jsonBytes(browserIndex));

console.log(`RESOURCE_RELEASE_MATERIALIZED version=${manifest.releaseVersion}`);
console.log(
  `RESOURCE_RELEASE_DELIVERY data=${dataBytes.byteLength} images=${manifest.images.files.length} `
  + `archive=${imageArchiveBytes.byteLength} parts=${parts.length}`,
);
