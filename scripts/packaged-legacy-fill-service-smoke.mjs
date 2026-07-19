import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');

function findSingle(directory, predicate, label) {
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
  if (matches.length !== 1) throw new Error(`Expected one ${label} in ${directory}, found ${matches.length}.`);
  return matches[0];
}

function resolvePackageLayout() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`Packaged legacy fill smoke is currently supported on darwin-arm64, received ${process.platform}-${process.arch}.`);
  }
  const app = findSingle(
    path.join(releaseRoot, 'mac-arm64'),
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
    'macOS app bundle',
  );
  return {
    executable: path.join(app, 'Contents', 'MacOS', path.basename(app, '.app')),
    resources: path.join(app, 'Contents', 'Resources'),
  };
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
const serviceScript = path.join(appAsar, 'scripts', 'legacy-fill-service.mjs');
const domainRuntime = path.join(appAsar, 'dist', 'legacy-fill', 'domain-runtime.mjs');
const strategyPath = path.join(appAsar, 'src', 'legacyFillService', 'resources', 'strategy-v1.json');
const goldenPath = path.join(appAsar, 'src', 'legacyFillService', 'resources', 'golden-v1.json');
for (const required of [layout.executable, appAsar]) {
  if (!fs.existsSync(required)) throw new Error(`Packaged legacy fill input is missing: ${required}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-packaged-legacy-fill-'));
const databasePath = path.join(tempRoot, 'legacy-fill.sqlite3');
const registryPath = path.join(tempRoot, 'registry.json');
const hostToken = 'packaged-legacy-fill-host-token';
const mcpToken = 'packaged-legacy-fill-mcp-token';
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(layout.executable, [serviceScript], {
  cwd: path.dirname(layout.executable),
  env: {
    PATH: process.env.PATH,
    ELECTRON_RUN_AS_NODE: '1',
    LEGACY_FILL_SERVICE_PORT: String(port),
    LEGACY_FILL_HOST_TOKEN: hostToken,
    LEGACY_FILL_MCP_CLIENTS_JSON: JSON.stringify({ [mcpToken]: 'codex:packaged-smoke' }),
    LEGACY_FILL_DATABASE_PATH: databasePath,
    LEGACY_FILL_REGISTRY_PATH: registryPath,
    LEGACY_FILL_DOMAIN_RUNTIME_PATH: domainRuntime,
    LEGACY_FILL_STRATEGY_PATH: strategyPath,
    LEGACY_FILL_GOLDEN_PATH: goldenPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.on('data', (chunk) => { output = appendLog(output, chunk); });
child.stderr.on('data', (chunk) => { output = appendLog(output, chunk); });

try {
  const deadline = Date.now() + 20_000;
  let health = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged legacy fill service exited early (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        health = await response.json();
        if (health?.domainRuntime?.ready) break;
      }
    } catch {
      // Startup is asynchronous; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!health?.ok || !health?.domainRuntime?.ready) {
    throw new Error(`Packaged legacy fill service did not become ready: ${JSON.stringify(health)}.\n${output}`);
  }
  if (health.service !== 'legacy-fill-service' || health.pid !== child.pid) throw new Error('Packaged legacy fill health identity mismatch.');
  if (health.database?.databasePath !== databasePath) throw new Error('Packaged legacy fill database escaped the smoke root.');
  if (health.mcp?.enabled !== true || health.mcp?.authenticatedClients !== 1) throw new Error('Packaged legacy fill MCP transport was not enabled.');
  const shutdown = await fetch(`${baseUrl}/internal/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-legacy-fill-host-token': hostToken },
    body: '{}',
  });
  if (shutdown.status !== 202) throw new Error(`Packaged legacy fill shutdown failed with ${shutdown.status}.`);
  await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  if (!fs.existsSync(databasePath) || fs.existsSync(registryPath)) throw new Error('Packaged legacy fill shutdown persistence contract failed.');
  console.log(`PACKAGED_LEGACY_FILL_OK platform=${process.platform}-${process.arch} port=${port}`);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
