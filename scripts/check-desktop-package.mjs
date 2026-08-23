import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  '/dist/legacy-fill/resources/strategy-v2.json',
  '/dist/legacy-fill/resources/golden-v1.json',
  '/dist/legacy-fill/resources/golden-v2.json',
  '/dist/agent/host-entry.cjs',
  '/dist/agent/engine/def-runtime/manifest.json',
  '/dist/agent/runtime-evidence/NOTICE.md',
  '/dist/agent/runtime-evidence/source-provenance.json',
  '/dist/agent/ui/index.html',
  '/dist/resource-release/builder.mjs',
  '/electron/agent-runtime.cjs',
  '/electron/desktop-feature-flags.cjs',
  '/electron/main.cjs',
  '/electron/legacy-fill-runtime.cjs',
  '/electron/preload.cjs',
  '/electron/static-host.cjs',
  '/electron/shell/index.html',
  '/electron/shell/shell.css',
  '/electron/shell/shell.js',
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
  '/dist/agent/engine/opencode',
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
  'dist/legacy-fill/resources/strategy-v2.json',
  'dist/legacy-fill/resources/golden-v1.json',
  'dist/legacy-fill/resources/golden-v2.json',
  'dist/agent/host-entry.cjs',
  'dist/agent/engine/def-runtime/manifest.json',
  'dist/agent/runtime-evidence/NOTICE.md',
  'dist/agent/runtime-evidence/source-provenance.json',
  'dist/agent/ui/index.html',
]) {
  const unpackedPath = path.join(unpackedRoot, required);
  assert.ok(fs.statSync(unpackedPath).isFile(), `桌面包缺少运行文件：${unpackedPath}`);
}

const nativeUiRoot = path.join(unpackedRoot, 'dist', 'agent', 'ui');
const nativeUiIndex = fs.readFileSync(path.join(nativeUiRoot, 'index.html'), 'utf8');
assert.match(nativeUiIndex, /<div id="root"(?:\s|>)/u, '桌面 Agent UI 缺少根节点');
for (const asset of [...nativeUiIndex.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/gu)]) {
  assert.equal(
    fs.statSync(path.join(nativeUiRoot, ...asset[1].split('/'))).isFile(),
    true,
    `桌面 Agent UI 缺少资源：${asset[1]}`,
  );
}

const engineRoot = path.join(unpackedRoot, 'dist', 'agent', 'engine', 'def-runtime');
const engineManifest = JSON.parse(fs.readFileSync(path.join(engineRoot, 'manifest.json'), 'utf8'));
assert.equal(engineManifest.schemaVersion, 1);
assert.equal(engineManifest.engineKind, 'def-runtime');
assert.equal(engineManifest.runtimeVersion, 'def-runtime-v1');
assert.equal(engineManifest.runtimeSchemaVersion, 1);
const agentBundlePath = path.join(unpackedRoot, 'dist', 'agent', 'host-entry.cjs');
assert.equal(sha256(agentBundlePath), engineManifest.hostBundleSha256, 'DEF Runtime Host 摘要不匹配');

const provenancePath = path.join(unpackedRoot, 'dist', 'agent', 'runtime-evidence', 'source-provenance.json');
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
assert.equal(typeof provenance, 'object', 'DEF Runtime 来源证明无效');
assert.equal(Array.isArray(provenance.sources), true, 'DEF Runtime 来源清单缺失');
assert.match(
  fs.readFileSync(path.join(unpackedRoot, 'dist', 'agent', 'runtime-evidence', 'NOTICE.md'), 'utf8'),
  /DEF Lightweight Agent Runtime/u,
  'DEF Runtime NOTICE 无效',
);
if (process.platform === 'darwin') {
  const signature = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(signature.status, 0, `macOS app 签名无效：${signature.stderr || signature.error || ''}`);
}

const agentBundleSource = fs.readFileSync(agentBundlePath, 'utf8');
for (const marker of [
  'DefHarnessRouteResultV1',
  'def.harness.route',
  'def.data.resource.team_loadouts',
  'def.data.resource.damage',
  'damage-report-v1',
]) {
  assert.ok(agentBundleSource.includes(marker), `桌面 Agent 包缺少 Phase 3 标记：${marker}`);
}
for (const forbidden of ['17321', '17322', 'better-sqlite3', 'node:sqlite']) {
  assert.equal(agentBundleSource.includes(forbidden), false, `桌面 Agent 包包含退役运行时：${forbidden}`);
}

console.log(JSON.stringify({
  result: 'desktop package boundary check passed',
  appPath,
  asarBytes: fs.statSync(asarPath).size,
  unpackedLegacyFillRoot: path.join(unpackedRoot, 'dist', 'legacy-fill'),
  unpackedAgentRoot: path.join(unpackedRoot, 'dist', 'agent'),
  packagedEntries: packagedFiles.length,
}, null, 2));

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
