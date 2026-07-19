import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fill-service-'));
const databasePath = path.join(tempRoot, 'legacy-fill.sqlite3');
const registryPath = path.join(tempRoot, 'registry.json');
const port = 19000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const token = 'legacy-fill-service-smoke-host-token';
let child;

function start() {
  child = spawn(process.execPath, ['scripts/legacy-fill-service.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      ELECTRON_RUN_AS_NODE: '1',
      LEGACY_FILL_SERVICE_PORT: String(port),
      LEGACY_FILL_HOST_TOKEN: token,
      LEGACY_FILL_DATABASE_PATH: databasePath,
      LEGACY_FILL_REGISTRY_PATH: registryPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return child;
}

async function request(method, pathname, body, authorized = false) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(authorized ? { 'x-legacy-fill-host-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForHealth(expectedPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const result = await request('GET', '/health');
      if (result.status === 200 && result.body.pid === expectedPid) return result.body;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('legacy fill service health timeout');
}

const snapshot = {
  contract: 'LegacyFillSnapshotV1',
  snapshotId: 'host-snapshot-fixture',
  publishedAt: '2026-07-19T00:00:00.000Z',
  domains: Object.fromEntries(['buff', 'weapon', 'operator', 'equipment'].map((domain) => [domain, {
    domain, schemaVersion: 1, revision: 1, contentHash: `sha256:${domain}`, current: null, library: {},
  }])),
};

try {
  start();
  let health = await waitForHealth(child.pid);
  assert.equal(health.service, 'legacy-fill-service');
  assert.equal(health.port, port);
  assert.equal(health.snapshotReady, false);
  assert.deepEqual(health.mcp, { enabled: false });
  assert.equal((await request('POST', '/internal/snapshots/publish', snapshot)).status, 403);
  const published = await request('POST', '/internal/snapshots/publish', snapshot, true);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(Object.keys(published.body.receipt.domains).length, 4);
  health = (await request('GET', '/health')).body;
  assert.equal(health.snapshotReady, true);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(registry.pid, child.pid);
  assert.equal(registry.port, port);
  assert.equal(registry.databasePath, databasePath);

  const shutdown = await request('POST', '/internal/shutdown', {}, true);
  assert.equal(shutdown.status, 202);
  await once(child, 'exit');
  assert.equal(fs.existsSync(registryPath), false);
  assert.equal(fs.existsSync(databasePath), true);

  start();
  health = await waitForHealth(child.pid);
  assert.equal(health.snapshotReady, true, 'snapshot state survives restart');
  assert.equal(health.snapshots.buff.revision, 1);
  await request('POST', '/internal/shutdown', {}, true);
  await once(child, 'exit');

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.build.files.includes('scripts/legacy-fill-service.mjs'), true);
  assert.equal(packageJson.build.files.some((entry) => String(entry).includes('agent填表数据工具')), false);
  const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
  const serviceSpawnBlock = mainSource.slice(mainSource.indexOf('function buildLegacyFillServiceEnv'), mainSource.indexOf('async function startDefAgent'));
  assert.match(serviceSpawnBlock, /key\.startsWith\('DEF_'\)/);
  assert.doesNotMatch(serviceSpawnBlock, /DEF_INTERNAL_GOVERNANCE_TOKEN:/);
  process.stdout.write('[legacy-fill-service-smoke] passed\n');
} finally {
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => undefined);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
