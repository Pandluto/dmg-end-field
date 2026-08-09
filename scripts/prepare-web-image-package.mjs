import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'public', 'web-image-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageDirectory = path.join(projectRoot, 'public', 'packages');
const cacheDirectory = path.join(projectRoot, '.runtime', 'web-image-packages');
const targetPath = path.join(cacheDirectory, manifest.archive.fileName);
const partialPath = `${targetPath}.partial`;
const partSize = 4 * 1024 * 1024;

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (!fs.existsSync(targetPath) || hashFile(targetPath) !== manifest.archive.sha256) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.rmSync(partialPath, { force: true });

  const legacyPath = path.join(projectRoot, 'public', manifest.archive.path);
  if (fs.existsSync(legacyPath) && hashFile(legacyPath) === manifest.archive.sha256) {
    fs.copyFileSync(legacyPath, targetPath);
  } else {
    const response = await fetch(manifest.archive.sourceUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`下载图片包失败：HTTP ${response.status}`);
    }

    const output = fs.createWriteStream(partialPath, { flags: 'wx' });
    await new Promise((resolve, reject) => {
      Readable.fromWeb(response.body).pipe(output).once('finish', resolve).once('error', reject);
    });

    const actualSize = fs.statSync(partialPath).size;
    if (actualSize !== manifest.archive.size) {
      fs.rmSync(partialPath, { force: true });
      throw new Error(`图片包体积不符：${actualSize} != ${manifest.archive.size}`);
    }
    const actualHash = hashFile(partialPath);
    if (actualHash !== manifest.archive.sha256) {
      fs.rmSync(partialPath, { force: true });
      throw new Error(`图片包 SHA-256 不符：${actualHash}`);
    }
    fs.renameSync(partialPath, targetPath);
  }
}

fs.mkdirSync(packageDirectory, { recursive: true });
for (const name of fs.readdirSync(packageDirectory)) {
  if (name.startsWith(`${manifest.archive.fileName}.part-`)) {
    fs.rmSync(path.join(packageDirectory, name), { force: true });
  }
}

const archive = fs.readFileSync(targetPath);
const parts = [];
for (let offset = 0, index = 0; offset < archive.length; offset += partSize, index += 1) {
  const bytes = archive.subarray(offset, Math.min(offset + partSize, archive.length));
  const fileName = `${manifest.archive.fileName}.part-${String(index + 1).padStart(3, '0')}`;
  const outputPath = path.join(packageDirectory, fileName);
  fs.writeFileSync(outputPath, bytes);
  parts.push({
    path: `packages/${fileName}`,
    fileName,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  });
}

manifest.archive.parts = parts;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// The desktop workspace still installs the verified archive into Cache
// Storage. The online-only mobile entry cannot depend on that PWA path, so the
// same verified archive also becomes ordinary version-addressed site assets.
const extracted = new Map(
  Object.entries(unzipSync(new Uint8Array(archive)))
    .map(([archivePath, bytes]) => [archivePath.replace(/\\/g, '/'), bytes]),
);
let extractedBytes = 0;
for (const entry of manifest.files) {
  const publicPath = String(entry.path || '').replace(/\\/g, '/');
  if (!publicPath.startsWith('assets/images/')) {
    throw new Error(`图片清单路径不在 assets/images：${publicPath}`);
  }
  const archivePath = publicPath.replace(/^assets\//, '');
  const bytes = extracted.get(archivePath);
  if (!bytes) throw new Error(`图片压缩包缺少文件：${publicPath}`);
  if (bytes.byteLength !== Number(entry.size)) {
    throw new Error(`图片体积不符：${publicPath}`);
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest !== entry.sha256) {
    throw new Error(`图片 SHA-256 不符：${publicPath}`);
  }
  const outputPath = path.resolve(projectRoot, 'public', publicPath);
  const imageRoot = path.resolve(projectRoot, 'public', 'assets', 'images');
  if (!outputPath.startsWith(`${imageRoot}${path.sep}`)) {
    throw new Error(`拒绝写入图片目录外路径：${publicPath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  extractedBytes += bytes.byteLength;
}

const legacyPath = path.join(projectRoot, 'public', manifest.archive.path);
if (legacyPath !== targetPath) fs.rmSync(legacyPath, { force: true });

console.log(
  `Web image package prepared: ${parts.length} parts, `
  + `${archive.byteLength} bytes (${parts.map((part) => part.size).join(' + ')}); `
  + `${manifest.files.length} online image files, ${extractedBytes} bytes.`,
);
