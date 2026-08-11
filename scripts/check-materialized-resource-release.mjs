import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');

function read(relativePath) {
  return fs.readFileSync(path.join(publicRoot, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath).toString('utf8'));
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function verifyDescriptor(descriptor, label) {
  const bytes = read(descriptor.path);
  if (bytes.byteLength !== descriptor.size || hash(bytes) !== descriptor.sha256) {
    throw new Error(`${label}校验失败：${descriptor.path}`);
  }
  return bytes;
}

const channel = readJson('resources/stable.json');
if (channel.type !== 'dmg.resource-channel.v1' || channel.channel !== 'stable') {
  throw new Error('resources/stable.json 格式无效。');
}
const deployment = JSON.parse(verifyDescriptor(channel.releaseManifest, '资源版本清单'));
if (
  deployment.type !== 'dmg.resource-deployment.v1'
  || deployment.releaseVersion !== channel.releaseVersion
) {
  throw new Error('资源通道与版本清单不一致。');
}
const dataManifestBytes = verifyDescriptor(deployment.delivery.dataManifest, '数据清单');
const imageManifestBytes = verifyDescriptor(deployment.delivery.imageManifest, '图片清单');
if (!read('web-data-manifest.json').equals(dataManifestBytes)) {
  throw new Error('根数据清单不是当前稳定版别名。');
}
if (!read('web-image-manifest.json').equals(imageManifestBytes)) {
  throw new Error('根图片清单不是当前稳定版别名。');
}
const dataManifest = JSON.parse(dataManifestBytes);
const imageManifest = JSON.parse(imageManifestBytes);
if (
  dataManifest.releaseVersion !== channel.releaseVersion
  || imageManifest.releaseVersion !== channel.releaseVersion
) {
  throw new Error('数据与图片没有绑定到同一个稳定资源版本。');
}
for (const entry of dataManifest.files) {
  const bytes = verifyDescriptor({ ...entry, path: entry.downloadPath || entry.path }, '标准数据');
  if (!read(entry.path).equals(bytes)) throw new Error(`标准数据别名不一致：${entry.path}`);
}
for (const part of imageManifest.archive.parts || []) verifyDescriptor(part, '图片分片');

console.log(
  `MATERIALIZED_RESOURCE_OK version=${channel.releaseVersion} `
  + `data=${dataManifest.version} images=${imageManifest.version}`,
);
