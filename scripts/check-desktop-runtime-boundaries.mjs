import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'preload.cjs'), 'utf8');
const dataBuilderSource = fs.readFileSync(
  path.join(repositoryRoot, 'scripts', 'build-desktop-data-release.mjs'),
  'utf8',
);

const forbiddenRuntimeFiles = [
  'electron/data-management-service.cjs',
  'electron/timeline-repository.cjs',
  'electron/ai-timeline-work-node-store.cjs',
  'electron/sidecar-runtime.cjs',
  'electron/workbench-renderer-transport.cjs',
  'scripts/ai-cli-rest-server.mjs',
  'scripts/legacy-fill-service.mjs',
];
for (const relativePath of forbiddenRuntimeFiles) {
  assert.equal(
    fs.existsSync(path.join(repositoryRoot, relativePath)),
    false,
    `桌面分支不应包含旧运行时：${relativePath}`,
  );
}

for (const [label, source] of [
  ['electron/main.cjs', mainSource],
  ['electron/preload.cjs', preloadSource],
  ['scripts/build-desktop-data-release.mjs', dataBuilderSource],
]) {
  for (const forbidden of [
    /node:sqlite/,
    /better-sqlite3/,
    /data-management-service/,
    /timeline-repository/,
    /ai-timeline-work-node-store/,
    /17321|17322|17323/,
  ]) {
    assert.equal(forbidden.test(source), false, `${label} 命中禁用运行时：${forbidden}`);
  }
}

const runtimeDependencies = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.optionalDependencies || {}),
};
for (const dependency of ['better-sqlite3', 'sqlite3', 'electron-updater', '@modelcontextprotocol/sdk']) {
  assert.equal(dependency in runtimeDependencies, false, `不应打包运行时依赖：${dependency}`);
}

const packagedFiles = packageJson.build?.files || [];
for (const forbidden of [
  'agent/**',
  'src/**',
  'electron/data-management-service.cjs',
  'scripts/ai-cli-rest-server.mjs',
]) {
  assert.equal(packagedFiles.includes(forbidden), false, `打包清单包含禁用范围：${forbidden}`);
}
for (const required of [
  'dist/**',
  '!dist/sw.js',
  '!node_modules/**',
  'electron/**',
  'scripts/build-image-release-manifest.mjs',
  'scripts/build-desktop-data-release.mjs',
]) {
  assert.ok(packagedFiles.includes(required), `打包清单缺少：${required}`);
}

const handledChannels = [...mainSource.matchAll(/ipcMain\.handle\('([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(handledChannels, [
  'desktop:build-data-release',
  'desktop:build-image-release',
  'desktop:get-app-info',
  'desktop:get-capabilities',
  'desktop:get-settings',
  'desktop:pick-data-release-source',
  'desktop:pick-image-release-source',
  'desktop:pick-release-output',
  'desktop:quit',
  'desktop:reveal-path',
  'desktop:set-scale',
]);
assert.match(mainSource, /contextIsolation:\s*true/);
assert.match(mainSource, /nodeIntegration:\s*false/);
assert.match(mainSource, /sandbox:\s*true/);
assert.match(mainSource, /storages:\s*\['serviceworkers'\]/);
assert.doesNotMatch(mainSource, /clearCache\s*\(/);
assert.match(mainSource, /source:\s*releaseSelections\.imageSource/);
assert.match(mainSource, /source:\s*releaseSelections\.dataSource/);
assert.match(mainSource, /generatedReleaseDirectories\.has\(targetPath\)/);
assert.doesNotMatch(mainSource, /buildImageReleasePackage\(payload/);
assert.doesNotMatch(mainSource, /buildDesktopDataRelease\(payload/);

const preloadChannels = [...preloadSource.matchAll(/invoke\('([^']+)'/g)]
  .map((match) => match[1]);
assert.ok(preloadChannels.every((channel) => handledChannels.includes(channel)));

console.log('Desktop runtime boundary check passed.');
console.log(`- IPC handlers: ${handledChannels.length}`);
console.log('- Node SQLite, AI, MCP, sidecars, and legacy data services are absent');
