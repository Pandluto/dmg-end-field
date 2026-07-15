import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');
const require = createRequire(import.meta.url);
const { buildNodeSidecarEnv } = require('../electron/sidecar-runtime.cjs');

function findSingle(directory, predicate, label) {
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${label} in ${directory}, found ${matches.length}.`);
  }
  return matches[0];
}

function findRuntimeBinary(directory) {
  if (!fs.existsSync(directory)) throw new Error(`Packaged OpenCode runtime directory is missing: ${directory}`);
  const pending = [directory];
  const matches = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      if (entry.isFile() && /^opencode-[\w.-]+(?:\.exe)?$/i.test(entry.name)) matches.push(candidate);
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one packaged OpenCode binary, found ${matches.length}.`);
  return matches[0];
}

function resolvePackageLayout() {
  if (process.platform === 'darwin') {
    if (process.arch !== 'arm64') throw new Error('macOS release smoke requires the arm64 GitHub runner used by the package target.');
    const app = findSingle(
      path.join(releaseRoot, 'mac-arm64'),
      (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
      'macOS app bundle',
    );
    const executableName = path.basename(app, '.app');
    return {
      executable: path.join(app, 'Contents', 'MacOS', executableName),
      resources: path.join(app, 'Contents', 'Resources'),
    };
  }
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') throw new Error('Windows release smoke requires an x64 runner.');
    const unpacked = path.join(releaseRoot, 'win-unpacked');
    return {
      executable: findSingle(unpacked, (entry) => entry.isFile() && entry.name.endsWith('.exe'), 'Windows app executable'),
      resources: path.join(unpacked, 'resources'),
    };
  }
  throw new Error(`Packaged sidecar smoke is unsupported on ${process.platform}-${process.arch}.`);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('Unable to reserve a loopback smoke port.');
  return port;
}

function appendLog(current, chunk) {
  return `${current}${String(chunk)}`.slice(-12000);
}

const layout = resolvePackageLayout();
const appAsar = path.join(layout.resources, 'app.asar');
const esbuildBinary = path.join(
  layout.resources,
  'app.asar.unpacked',
  'node_modules',
  '@esbuild',
  `${process.platform}-${process.arch}`,
  'bin',
  process.platform === 'win32' ? 'esbuild.exe' : 'esbuild',
);
const sidecarScript = path.join(appAsar, 'scripts', 'ai-cli-rest-server.mjs');
const opencodeBinary = findRuntimeBinary(path.join(layout.resources, 'app.asar.unpacked', 'agent', 'runtime', 'opencode-core', 'bin'));

for (const required of [layout.executable, appAsar, esbuildBinary, opencodeBinary]) {
  if (!fs.existsSync(required)) throw new Error(`Packaged sidecar input is missing: ${required}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-sidecar-smoke-'));
const localData = path.join(tempRoot, 'localdata');
const storage = path.join(tempRoot, 'storage');
const cache = path.join(tempRoot, 'vite-cache');
const scripts = path.join(tempRoot, 'scripts');
for (const directory of [localData, storage, cache, scripts]) fs.mkdirSync(directory, { recursive: true });

const port = await reservePort();
let output = '';
const sidecarEnv = buildNodeSidecarEnv({
  baseEnv: process.env,
  userDataPath: tempRoot,
  resourcesPath: layout.resources,
  packaged: true,
  extra: {
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_DIR: storage,
    AI_CLI_REST_VITE_CACHE_DIR: cache,
    AI_CLI_NOW_STORAGE_PATH: path.join(localData, 'now-storage.json'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(localData, 'ai-timeline-worknodes.sqlite3'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(localData, 'ai-timeline-worknodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: path.join(localData, 'timeline-repository.sqlite3'),
    DEF_TOOL_GOVERNANCE_PATH: path.join(localData, 'def-tool-governance.json'),
    DEF_AGENT_SCRIPT_DIR: scripts,
  },
});
const child = spawn(layout.executable, [sidecarScript], {
  cwd: path.dirname(layout.executable),
  env: sidecarEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.on('data', (chunk) => { output = appendLog(output, chunk); });
child.stderr.on('data', (chunk) => { output = appendLog(output, chunk); });

try {
  const deadline = Date.now() + 30000;
  let health = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged sidecar exited early (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // Startup is asynchronous; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!health?.ok) throw new Error(`Packaged sidecar did not become healthy.\n${output}`);
  if (!String(health.projectRoot || '').endsWith('app.asar')) throw new Error('Smoke did not execute from the packaged asar.');
  for (const [name, value] of Object.entries({ storageDir: health.storageDir, nowStoragePath: health.nowStoragePath, viteCacheDir: health.viteCacheDir })) {
    if (!path.resolve(String(value || '')).startsWith(path.resolve(tempRoot))) {
      throw new Error(`Packaged sidecar ${name} escaped the writable smoke root: ${value}`);
    }
  }
  if (sidecarEnv.ESBUILD_BINARY_PATH !== esbuildBinary) throw new Error('Electron sidecar environment resolved the wrong esbuild binary.');
  const opencode = spawnSync(opencodeBinary, ['--version'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (opencode.status !== 0) {
    throw new Error(`Packaged OpenCode runtime failed to start (${opencode.status ?? 'unknown'}).\n${opencode.stderr || ''}`);
  }
  console.log(`PACKAGED_SIDECAR_OK platform=${process.platform}-${process.arch} port=${port} opencode=${String(opencode.stdout || '').trim()}`);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
