import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAppPath = path.join(projectRoot, 'release', 'mac-arm64', '终末地伤害工作台.app');
const appPath = path.resolve(process.argv[2] || defaultAppPath);
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
const unpackedRoot = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked');

assert.ok(fs.existsSync(asarPath), `缺少桌面 app.asar：${asarPath}`);

const packagedFiles = listPackage(asarPath);
const packagedSet = new Set(packagedFiles);
for (const required of [
  '/dist/index.html',
  '/dist/sw-desktop.js',
  '/dist/legacy-fill/service.mjs',
  '/dist/legacy-fill/stdio.mjs',
  '/dist/legacy-fill/domain-runtime.mjs',
  '/dist/legacy-fill/resources/strategy-v1.json',
  '/dist/legacy-fill/resources/golden-v1.json',
  '/dist/agent/host-entry.cjs',
  '/electron/agent-runtime.cjs',
  '/electron/main.cjs',
  '/electron/legacy-fill-runtime.cjs',
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

for (const required of [
  'dist/legacy-fill/service.mjs',
  'dist/legacy-fill/stdio.mjs',
  'dist/legacy-fill/domain-runtime.mjs',
  'dist/legacy-fill/resources/strategy-v1.json',
  'dist/legacy-fill/resources/golden-v1.json',
  'dist/agent/host-entry.cjs',
]) {
  const unpackedPath = path.join(unpackedRoot, required);
  assert.ok(fs.statSync(unpackedPath).isFile(), `桌面包缺少可执行 MCP 运行文件：${unpackedPath}`);
}

console.log(JSON.stringify({
  result: 'desktop package boundary check passed',
  appPath,
  asarBytes: fs.statSync(asarPath).size,
  unpackedLegacyFillRoot: path.join(unpackedRoot, 'dist', 'legacy-fill'),
  unpackedAgentRoot: path.join(unpackedRoot, 'dist', 'agent'),
  packagedEntries: packagedFiles.length,
}, null, 2));
