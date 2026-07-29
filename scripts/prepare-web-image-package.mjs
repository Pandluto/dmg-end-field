import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'public', 'web-image-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const targetPath = path.join(projectRoot, 'public', manifest.archive.path);
const partialPath = `${targetPath}.partial`;

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (fs.existsSync(targetPath) && hashFile(targetPath) === manifest.archive.sha256) {
  console.log(`Web image package already prepared: ${targetPath}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.rmSync(partialPath, { force: true });

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
console.log(`Web image package prepared: ${targetPath} (${actualSize} bytes)`);
