import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAppPath = path.join(projectRoot, 'release', 'mac-arm64', '终末地伤害工作台.app');
const appPath = path.resolve(process.argv[2] || defaultAppPath);
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');

assert.ok(fs.existsSync(asarPath), `缺少桌面 app.asar：${asarPath}`);

const packagedFiles = listPackage(asarPath);
const packagedSet = new Set(packagedFiles);
for (const required of [
  '/dist/index.html',
  '/dist/sw-desktop.js',
  '/electron/main.cjs',
  '/electron/preload.cjs',
  '/electron/static-host.cjs',
  '/electron/shell/index.html',
  '/electron/shell/shell.css',
  '/electron/shell/shell.js',
  '/scripts/build-desktop-data-release.mjs',
  '/scripts/build-image-release-manifest.mjs',
  '/package.json',
]) {
  assert.ok(packagedSet.has(required), `桌面包缺少：${required}`);
}

for (const forbidden of [
  '/dist/sw.js',
  '/node_modules',
  '/agent',
  '/src',
  '/electron/data-management-service.cjs',
  '/electron/timeline-repository.cjs',
  '/electron/sidecar-runtime.cjs',
]) {
  assert.ok(
    !packagedFiles.some((file) => file === forbidden || file.startsWith(`${forbidden}/`)),
    `桌面包包含禁用范围：${forbidden}`,
  );
}

console.log(JSON.stringify({
  result: 'desktop package boundary check passed',
  appPath,
  asarBytes: fs.statSync(asarPath).size,
  packagedEntries: packagedFiles.length,
}, null, 2));
