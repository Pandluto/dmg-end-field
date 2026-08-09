import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(projectRoot, 'public', 'web-image-manifest.json');
const browserIndexPath = path.join(projectRoot, 'public', 'assets', 'images', '_manifest.json');
const defaultLocalManifest = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'dmg-end-field',
  'asset-releases',
  'versions',
  'v1.7.3',
  'assets-release-manifest.json',
);
const sourcePath = process.env.DMG_IMAGE_RELEASE_MANIFEST
  ? path.resolve(process.env.DMG_IMAGE_RELEASE_MANIFEST)
  : defaultLocalManifest;

if (!fs.existsSync(sourcePath)) {
  throw new Error(
    `找不到图片 release 清单：${sourcePath}\n`
    + '请通过 DMG_IMAGE_RELEASE_MANIFEST 指向 assets-release-manifest.json。',
  );
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
if (
  source.manifestVersion !== 1
  || source.delivery !== 'archive'
  || !Array.isArray(source.files)
  || !source.package?.fileName
  || !source.package.sha256
) {
  throw new Error('图片 release 清单格式无效。');
}

const releaseTag = String(source.releaseTag || source.assetVersion);
const manifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-image-pack',
  version: String(source.assetVersion),
  generatedAt: String(source.generatedAt),
  releaseTag,
  files: source.files.map((entry) => ({
    path: String(entry.relativePath),
    sha256: String(entry.sha256),
    size: Number(entry.sizeBytes),
  })),
  totalBytes: source.files.reduce((total, entry) => total + Number(entry.sizeBytes || 0), 0),
  archive: {
    path: `packages/${source.package.fileName}`,
    fileName: String(source.package.fileName),
    sha256: String(source.package.sha256),
    size: Number(source.package.sizeBytes),
    sourceUrl: `https://github.com/Pandluto/dmg-end-field/releases/latest/download/${encodeURIComponent(source.package.fileName)}`,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const updatedAt = Date.parse(manifest.generatedAt) || Date.now();
const browserIndex = manifest.files.map((entry) => {
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
fs.writeFileSync(browserIndexPath, `${JSON.stringify(browserIndex, null, 2)}\n`, 'utf8');
console.log(
  `Web image manifest: ${manifest.files.length} files, `
  + `${manifest.archive.size} archive bytes, ${manifest.totalBytes} extracted bytes.`,
);
