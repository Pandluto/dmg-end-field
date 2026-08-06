import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultAppPath = path.join(projectRoot, 'release', 'mac-arm64', '终末地伤害工作台.app');
const appPath = path.resolve(process.argv[2] || defaultAppPath);
const unpackedAgentRoot = path.join(
  appPath,
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'dist',
  'agent',
);
const hostEntry = path.join(unpackedAgentRoot, 'host-entry.cjs');
const engineRoot = path.join(unpackedAgentRoot, 'engine', 'opencode');
assert.equal(fs.statSync(hostEntry).isFile(), true, `缺少 packaged Agent Host：${hostEntry}`);
assert.equal(fs.statSync(engineRoot).isDirectory(), true, `缺少 packaged OpenCode Engine：${engineRoot}`);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-packaged-agent-smoke-'));
const readyFile = path.join(temporaryRoot, 'ready.json');
const engineStoreRoot = path.join(temporaryRoot, 'engine-store');
const missingProfilePath = path.join(temporaryRoot, 'missing-provider-profile.json');
const hostToken = randomBytes(32).toString('base64url');
const child = spawn(process.execPath, [hostEntry], {
  cwd: path.dirname(hostEntry),
  env: {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    TMPDIR: process.env.TMPDIR,
    DEF_AGENT_HOST_TOKEN: hostToken,
    DEF_AGENT_BROWSER_ORIGIN: 'http://127.0.0.1:31457',
    DEF_AGENT_READY_FILE: readyFile,
    DEF_AGENT_ENGINE_ROOT: engineRoot,
    DEF_AGENT_ENGINE_STORE_ROOT: engineStoreRoot,
    DEF_AGENT_ENGINE_PROFILE_PATH: missingProfilePath,
    DEF_AGENT_ENGINE_DEFAULT_PROFILE_REF: 'default',
    DEF_AGENT_PARENT_PID: String(process.pid),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let outputBytes = 0;
child.stdout.on('data', (chunk) => { outputBytes += chunk.length; });
child.stderr.on('data', (chunk) => { outputBytes += chunk.length; });

try {
  const manifest = await waitForReadyManifest(readyFile, child, 20_000);
  assert.equal(manifest.service, 'def-agent-host');
  assert.equal(manifest.protocolVersion, 2);
  assert.equal(manifest.runtimeSchemaVersion, 1);
  assert.equal(manifest.host, '127.0.0.1');
  assert.equal(manifest.pid, child.pid);
  assert.equal(Number.isSafeInteger(manifest.port) && manifest.port > 0, true);

  const origin = `http://127.0.0.1:${manifest.port}`;
  const healthResponse = await fetch(`${origin}/internal/health`, {
    headers: { 'x-dmg-agent-host-token': hostToken },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.service, 'def-agent-host');
  assert.equal(health.state, 'ready');
  assert.deepEqual(health.engine, {
    kind: 'opencode',
    state: 'unavailable',
    reason: 'OpenCode provider profile is not configured',
  });
  assert.doesNotMatch(JSON.stringify({ manifest, health }), /hostToken|bridge|authorization|apiKey/iu);

  const shutdownResponse = await fetch(`${origin}/internal/shutdown`, {
    method: 'POST',
    headers: { 'x-dmg-agent-host-token': hostToken },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(shutdownResponse.status, 202);
  assert.deepEqual(await shutdownResponse.json(), { stopping: true });
  await waitForExit(child, 10_000);
  assert.equal(fs.existsSync(path.join(engineStoreRoot, 'process.json')), false);
  assert.equal(outputBytes <= 64 * 1024, true, 'Packaged Agent Host produced excessive startup output');

  console.log(JSON.stringify({
    result: 'packaged Agent Host smoke passed',
    appPath,
    engine: health.engine,
    pid: manifest.pid,
  }, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000).catch(() => undefined);
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

async function waitForReadyManifest(filePath, processHandle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error('Packaged Agent Host exited before writing ready.json');
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Packaged Agent Host did not become ready within ${timeoutMs}ms`);
}

async function waitForExit(processHandle, timeoutMs) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => processHandle.once('exit', resolve)),
    new Promise((_resolve, reject) => setTimeout(
      () => reject(new Error(`Packaged Agent Host did not exit within ${timeoutMs}ms`)),
      timeoutMs,
    )),
  ]);
}
