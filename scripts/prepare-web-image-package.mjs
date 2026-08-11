import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'public');
const manifestPath = path.join(publicRoot, 'web-image-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const resourceOrigin = (process.env.DMG_RESOURCE_ORIGIN || 'https://dmgendfield.online')
  .replace(/\/+$/, '');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function ensurePart(part) {
  const outputPath = path.join(publicRoot, part.path);
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null;
  if (existing && existing.byteLength === part.size && hash(existing) === part.sha256) {
    return existing;
  }
  const resourceUrl = new URL(part.path, `${resourceOrigin}/`).href;
  const response = await fetch(resourceUrl, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`服务器资源分片下载失败：${part.path}（HTTP ${response.status}）`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== part.size || hash(bytes) !== part.sha256) {
    throw new Error(`服务器资源分片校验失败：${part.path}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  return bytes;
}

if (!Array.isArray(manifest.archive?.parts) || manifest.archive.parts.length === 0) {
  throw new Error('图片清单没有服务器分片；请先 materialize-resource-release。');
}
const parts = [];
for (const part of manifest.archive.parts) parts.push(await ensurePart(part));
const archive = Buffer.concat(parts);
if (archive.byteLength !== manifest.archive.size || hash(archive) !== manifest.archive.sha256) {
  throw new Error('服务器图片压缩包校验失败。');
}

const extracted = unzipSync(new Uint8Array(archive));
let extractedBytes = 0;
for (const entry of manifest.files) {
  const archivePath = entry.path.replace(/^assets\//, '');
  const bytes = extracted[archivePath];
  if (!bytes || bytes.byteLength !== entry.size || hash(bytes) !== entry.sha256) {
    throw new Error(`服务器图片文件校验失败：${entry.path}`);
  }
  const outputPath = path.resolve(publicRoot, entry.path);
  const imageRoot = path.resolve(publicRoot, 'assets', 'images');
  if (!outputPath.startsWith(`${imageRoot}${path.sep}`)) {
    throw new Error(`拒绝写入图片目录外：${entry.path}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  extractedBytes += bytes.byteLength;
}

console.log(
  `Server resource package prepared: ${parts.length} parts, ${archive.byteLength} archive bytes; `
  + `${manifest.files.length} images, ${extractedBytes} extracted bytes.`,
);
