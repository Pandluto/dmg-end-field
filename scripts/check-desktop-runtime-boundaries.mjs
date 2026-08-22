import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const desktopFeatureFlags = require(path.join(repositoryRoot, 'electron', 'desktop-feature-flags.cjs'));
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(repositoryRoot, 'electron', 'preload.cjs'), 'utf8');
const legacyFillRuntimeSource = fs.readFileSync(
  path.join(repositoryRoot, 'electron', 'legacy-fill-runtime.cjs'),
  'utf8',
);
const agentRuntimeSource = fs.readFileSync(
  path.join(repositoryRoot, 'electron', 'agent-runtime.cjs'),
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
const desktopEntrySource = fs.readFileSync(
  path.join(repositoryRoot, 'src', 'desktop-entry.ts'),
  'utf8',
);
const desktopHostSource = fs.readFileSync(
  path.join(repositoryRoot, 'src', 'platform', 'desktop', 'desktopHostExtension.tsx'),
  'utf8',
);
const desktopWorkerSource = fs.readFileSync(
  path.join(repositoryRoot, 'public', 'sw-desktop.js'),
  'utf8',
);
const resourceProxySource = fs.readFileSync(
  path.join(repositoryRoot, 'electron', 'official-resource-proxy.cjs'),
  'utf8',
);
const indexSource = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
const tsconfigSource = fs.readFileSync(path.join(repositoryRoot, 'tsconfig.json'), 'utf8');
const viteSource = fs.readFileSync(path.join(repositoryRoot, 'vite.config.ts'), 'utf8');
const resourceBuilderSource = fs.readFileSync(
  path.join(repositoryRoot, 'scripts', 'resource-release-file-builder.mjs'),
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
  ['scripts/resource-release-file-builder.mjs', resourceBuilderSource],
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
assert.deepEqual(packageJson.build?.asarUnpack, ['dist/legacy-fill/**', 'dist/agent/**']);
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
]) {
  assert.ok(packagedFiles.includes(required), `打包清单缺少：${required}`);
}

const handledChannels = [...mainSource.matchAll(/ipcMain\.handle\('([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(handledChannels, [
  'desktop:build-resource-release',
  'desktop:get-agent-profile',
  'desktop:get-agent-state',
  'desktop:get-app-info',
  'desktop:get-capabilities',
  'desktop:get-mcp-state',
  'desktop:get-settings',
  'desktop:open-agent-mode',
  'desktop:open-browser',
  'desktop:open-mcp-fill',
  'desktop:pick-image-release-source',
  'desktop:pick-release-output',
  'desktop:pick-share-data-source',
  'desktop:quit',
  'desktop:reveal-path',
  'desktop:save-agent-profile',
  'desktop:set-scale',
  'desktop:test-agent-profile',
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
assert.deepEqual(desktopFeatureFlags, {
  agentEntry: false,
  resourcePackagerEntry: false,
});
assert.doesNotMatch(shellDocumentSource, /打开 AI 模式|Agent 模型|DEF Runtime Provider/);
assert.doesNotMatch(shellDocumentSource, /国内统一资源包|生成统一资源包|完整 Share Data JSON/);
assert.match(mainSource, /if \(desktopFeatureFlags\.agentEntry\)/);
assert.match(mainSource, /if \(desktopFeatureFlags\.resourcePackagerEntry\)/);
assert.match(mainSource, /--dmg-desktop-feature-agent-entry=/);
assert.match(mainSource, /--dmg-desktop-feature-resource-packager-entry=/);
assert.match(preloadSource, /readFeatureFlag\('agent-entry'\)/);
assert.match(preloadSource, /readFeatureFlag\('resource-packager-entry'\)/);
assert.match(preloadSource, /desktopFeatureFlags\.agentEntry \? \{/);
assert.match(preloadSource, /desktopFeatureFlags\.resourcePackagerEntry \? \{/);
assert.doesNotMatch(
  appSource,
  /mcp-fill|timeline\/ai|platform\/agent/i,
  'the inherited Slim App must not contain Desktop routes or Agent imports',
);
assert.doesNotMatch(appShellSource, /mcp-fill|MCP 填表/i, 'normal Web navigation keeps the MCP route hidden');
assert.doesNotMatch(appShellSource, /agentMode|AI 模式/i, 'normal Web navigation keeps the Agent route hidden');
assert.match(desktopEntrySource, /installDesktopHostExtension\(\)/);
assert.match(desktopEntrySource, /import\('\.\/main'\)/);
assert.match(desktopHostSource, /installAppHostExtension\(/);
assert.match(desktopHostSource, /installOfficialResourceTransport\(/);
assert.match(desktopHostSource, /fallbackToBundledOnUnavailable:\s*true/);
assert.match(desktopHostSource, /DESKTOP_MCP_FILL_PATH = '\/mcp-fill'/);
assert.match(desktopHostSource, /DESKTOP_AGENT_MODE_PATH = '\/timeline\/ai'/);
assert.match(indexSource, /\/src\/desktop-entry\.ts/);
assert.match(tsconfigSource, /"moduleSuffixes"\s*:\s*\["\.desktop", ""\]/);
assert.match(viteSource, /'\.desktop\.tsx'/);
assert.match(mainSource, /createLegacyFillRuntime/);
assert.match(mainSource, /createAgentRuntime/);
assert.match(mainSource, /utilityProcess\.fork/);
assert.match(mainSource, /app\.asar\.unpacked/);
assert.match(legacyFillRuntimeSource, /SERVICE_PORT = 17323/);
assert.match(legacyFillRuntimeSource, /dist', 'legacy-fill', 'service\.mjs/);
assert.match(legacyFillRuntimeSource, /legacy-fill\.sqlite3/);
assert.doesNotMatch(legacyFillRuntimeSource, /def\.(?:operator|buff|weapon|equipment)|timeline-repository|data-management-service/);
assert.doesNotMatch(legacyFillRuntimeSource, /17321|17322/);
assert.doesNotMatch(legacyFillRuntimeSource, /ELECTRON_RUN_AS_NODE|node:child_process/);
assert.match(legacyFillRuntimeSource, /key\.startsWith\('OPENCODE_'\)/);
assert.match(mainSource, /images:\s*releaseSelections\.imageSource/);
assert.match(mainSource, /shareData:\s*releaseSelections\.shareDataSource/);
assert.match(mainSource, /generatedReleaseDirectories\.has\(targetPath\)/);
assert.match(agentRuntimeSource, /dist', 'agent', 'host-entry\.cjs/);
assert.match(agentRuntimeSource, /DEF_AGENT_NATIVE_UI_ROOT/);
assert.match(agentRuntimeSource, /\/internal\/health/);
assert.match(agentRuntimeSource, /x-dmg-agent-host-token/);
assert.doesNotMatch(agentRuntimeSource, /node:sqlite|better-sqlite3|sqlite3|17321|17322|17323/);
assert.match(mainSource, /dist', 'resource-release', 'builder\.mjs/);
assert.match(mainSource, /builder\.buildResourceReleaseFromPaths/);
assert.match(mainSource, /createOfficialResourceProxyHandler/);
assert.match(mainSource, /await officialResourceProxyHandler\(request, response\)/);
assert.match(resourceProxySource, /UPSTREAM_ORIGIN = 'https:\/\/dmgendfield\.cloud'/);
assert.match(resourceProxySource, /MAX_CHANNEL_BYTES = 64 \* 1024/);
assert.match(resourceProxySource, /MAX_RESOURCE_BYTES = 64 \* 1024 \* 1024/);
assert.match(resourceProxySource, /AbortController/);
assert.doesNotMatch(resourceProxySource, /authorization|set-cookie/i);
assert.match(desktopWorkerSource, /url\.pathname\.startsWith\('\/agent-host\/'\)/);

const preloadChannels = [...preloadSource.matchAll(/invoke\('([^']+)'/g)]
  .map((match) => match[1]);
assert.ok(preloadChannels.every((channel) => handledChannels.includes(channel)));

console.log('Desktop runtime boundary check passed.');
console.log(`- IPC declarations retained behind boundaries: ${handledChannels.length}`);
console.log('- Electron renders only the independent Shell; the inherited Slim app opens through a Desktop host adapter');
console.log('- Domestic resources use a bounded loopback proxy with an explicit bundled fallback');
console.log('- Browser SQLite remains the only business store; MCP uses an isolated proposal/audit database');
console.log('- AI and Shell resource-packager entries are frozen at feature, preload, IPC, and UI boundaries; their implementation remains preserved');
