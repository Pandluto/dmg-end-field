import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');

function resolvePackageLayout() {
  if (process.platform === 'darwin') {
    if (process.arch !== 'arm64') throw new Error('macOS release smoke requires the arm64 GitHub runner used by the package target.');
    const app = path.join(releaseRoot, 'mac-arm64', 'dmg-end-field.app');
    return {
      executable: path.join(app, 'Contents', 'MacOS', 'dmg-end-field'),
      resources: path.join(app, 'Contents', 'Resources'),
    };
  }
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') throw new Error('Windows release smoke requires an x64 runner.');
    return {
      executable: path.join(releaseRoot, 'win-unpacked', 'dmg-end-field.exe'),
      resources: path.join(releaseRoot, 'win-unpacked', 'resources'),
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

for (const required of [layout.executable, appAsar, esbuildBinary]) {
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
const child = spawn(layout.executable, [sidecarScript], {
  cwd: path.dirname(layout.executable),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ESBUILD_BINARY_PATH: esbuildBinary,
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
  console.log(`PACKAGED_SIDECAR_OK platform=${process.platform}-${process.arch} port=${port}`);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
