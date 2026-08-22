import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';
import { inspectRuntimeCode } from './opencode-runtime-contract.mjs';
import { readOpenCodeUiLock, verifyOpenCodeUiTree } from './opencode-ui-contract.mjs';

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
  '/dist/agent/engine/opencode/manifest.json',
  '/dist/agent/engine/opencode/runtime-lock.json',
  '/dist/agent/engine/opencode/plugin.mjs',
  '/dist/agent/engine/opencode/LICENSE',
  '/dist/agent/engine/opencode/bin/darwin-arm64/opencode-1.17.11',
  '/dist/agent/ui/index.html',
  '/dist/agent/ui/def-opencode-ui.json',
  '/dist/resource-release/builder.mjs',
  '/electron/agent-runtime.cjs',
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
  'dist/agent/engine/opencode/manifest.json',
  'dist/agent/engine/opencode/runtime-lock.json',
  'dist/agent/engine/opencode/plugin.mjs',
  'dist/agent/engine/opencode/LICENSE',
  'dist/agent/engine/opencode/bin/darwin-arm64/opencode-1.17.11',
  'dist/agent/ui/index.html',
  'dist/agent/ui/def-opencode-ui.json',
]) {
  const unpackedPath = path.join(unpackedRoot, required);
  assert.ok(fs.statSync(unpackedPath).isFile(), `桌面包缺少可执行 MCP 运行文件：${unpackedPath}`);
}

const nativeUiRoot = path.join(unpackedRoot, 'dist', 'agent', 'ui');
verifyOpenCodeUiTree(nativeUiRoot, readOpenCodeUiLock().artifact);

const engineRoot = path.join(unpackedRoot, 'dist', 'agent', 'engine', 'opencode');
const engineManifest = JSON.parse(fs.readFileSync(path.join(engineRoot, 'manifest.json'), 'utf8'));
assert.equal(engineManifest.schemaVersion, 1);
assert.equal(engineManifest.name, 'def-opencode-engine-runtime');
assert.equal(engineManifest.engineKind, 'opencode');
assert.equal(engineManifest.upstreamVersion, '1.17.11');
assert.equal(engineManifest.runtimeVersion, '1.17.11-def.1');
assert.equal(engineManifest.storeSchemaVersion, 1);
assert.equal(engineManifest.target, 'darwin-arm64');
assert.equal(engineManifest.binaryVersion, '0.0.0--202608061828');
for (const [relativePath, bytes, digest, label] of [
  [engineManifest.plugin, undefined, engineManifest.pluginSha256, 'plugin'],
  [engineManifest.license, engineManifest.licenseBytes, engineManifest.licenseSha256, 'license'],
]) {
  const filePath = path.join(engineRoot, ...relativePath.split('/'));
  const info = fs.lstatSync(filePath);
  assert.equal(info.isFile(), true, `OpenCode ${label} 不是普通文件`);
  assert.equal(info.isSymbolicLink(), false, `OpenCode ${label} 不得是符号链接`);
  if (bytes !== undefined) assert.equal(info.size, bytes, `OpenCode ${label} 大小不匹配`);
  assert.equal(sha256(filePath), digest, `OpenCode ${label} 摘要不匹配`);
}
assert.notEqual(
  fs.statSync(path.join(engineRoot, ...engineManifest.binary.split('/'))).mode & 0o111,
  0,
  'OpenCode binary 不可执行',
);
const packagedBinaryPath = path.join(engineRoot, ...engineManifest.binary.split('/'));
const binaryInfo = fs.lstatSync(packagedBinaryPath);
assert.equal(binaryInfo.isFile(), true, 'OpenCode binary 不是普通文件');
assert.equal(binaryInfo.isSymbolicLink(), false, 'OpenCode binary 不得是符号链接');
const packagedCode = inspectRuntimeCode(packagedBinaryPath, engineManifest.target);
assert.equal(packagedCode.bytes, engineManifest.binaryCodeBytes, 'OpenCode binary code 大小不匹配');
assert.equal(packagedCode.sha256, engineManifest.binaryCodeSha256, 'OpenCode binary code 摘要不匹配');
if (process.platform === 'darwin') {
  const signature = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(signature.status, 0, `macOS app 签名无效：${signature.stderr || signature.error || ''}`);
}
const versionCheck = spawnSync(packagedBinaryPath, ['--version'], {
  encoding: 'utf8',
  timeout: 30_000,
  maxBuffer: 64 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(versionCheck.status, 0, 'OpenCode binary --version 执行失败');
assert.equal(versionCheck.stdout.replace(/\r\n/gu, '\n').replace(/\n+$/gu, ''), engineManifest.binaryVersion);
for (const forbidden of ['vendor', 'node_modules', 'packages', 'web', 'ui', 'bun']) {
  assert.equal(fs.existsSync(path.join(engineRoot, forbidden)), false, `OpenCode 包含多余目录：${forbidden}`);
}

const agentBundlePath = path.join(unpackedRoot, 'dist', 'agent', 'host-entry.cjs');
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
