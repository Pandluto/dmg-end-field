import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'preload.cjs'), 'utf8');
const legacyFillRuntimeSource = fs.readFileSync(
  path.join(repositoryRoot, 'electron', 'legacy-fill-runtime.cjs'),
  'utf8',
);
const shellDocumentSource = fs.readFileSync(
  path.join(repositoryRoot, 'electron', 'shell', 'index.html'),
  'utf8',
);
const appSource = fs.readFileSync(path.join(repositoryRoot, 'src', 'App.tsx'), 'utf8');
const appShellSource = fs.readFileSync(
  path.join(repositoryRoot, 'src', 'components', 'WebApp', 'AppShell.tsx'),
  'utf8',
);
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
    /17321|17322/,
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
assert.deepEqual(packageJson.build?.asarUnpack, ['dist/legacy-fill/**']);
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
  'desktop:get-mcp-state',
  'desktop:get-settings',
  'desktop:open-browser',
  'desktop:open-mcp-fill',
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
assert.doesNotMatch(mainSource, /clearCache\s*\(/);
assert.match(mainSource, /loadFile\(SHELL_DOCUMENT_PATH\)/);
assert.match(mainSource, /shell\.openExternal\(buildBrowserUrl\(/);
assert.doesNotMatch(mainSource, /loadURL\(.*(?:DESKTOP_ORIGIN|browserOrigin|windowUrl)/);
assert.match(shellDocumentSource, /工作台在系统浏览器中运行/);
assert.match(shellDocumentSource, /打开 MCP 填表/);
assert.match(appSource, /APP_ROUTE_PATHS\.mcpFill/);
assert.doesNotMatch(appShellSource, /mcp-fill|MCP 填表/i, 'normal Web navigation keeps the MCP route hidden');
assert.match(shellDocumentSource, /GitHub Release 产物/);
assert.match(mainSource, /createLegacyFillRuntime/);
assert.match(mainSource, /utilityProcess\.fork/);
assert.match(mainSource, /app\.asar\.unpacked/);
assert.match(legacyFillRuntimeSource, /SERVICE_PORT = 17323/);
assert.match(legacyFillRuntimeSource, /dist', 'legacy-fill', 'service\.mjs/);
assert.match(legacyFillRuntimeSource, /legacy-fill\.sqlite3/);
assert.doesNotMatch(legacyFillRuntimeSource, /def\.(?:operator|buff|weapon|equipment)|timeline-repository|data-management-service/);
assert.doesNotMatch(legacyFillRuntimeSource, /17321|17322/);
assert.doesNotMatch(legacyFillRuntimeSource, /ELECTRON_RUN_AS_NODE|node:child_process/);
assert.match(legacyFillRuntimeSource, /key\.startsWith\('OPENCODE_'\)/);
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
console.log('- Electron renders only the independent Shell; the Slim app opens in the system browser');
console.log('- Browser SQLite remains the only business store; MCP uses an isolated proposal/audit database');
console.log('- DEF/OpenCode, old REST ports, sidecars, and legacy business data services remain absent');
