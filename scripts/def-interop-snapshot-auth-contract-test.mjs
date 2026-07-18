import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');
const nativeToken = 'interop-native-snapshot-token';
const calls = [];
const protocol = createDefCodexInteropProtocol({
  profile: 'development',
  baseUrl: 'http://127.0.0.1:31457',
  sidecarUrl: 'http://127.0.0.1:17322',
  snapshotUrl: 'http://127.0.0.1:17321/api/main-workbench/snapshot',
  snapshotHeaders: { 'x-def-internal-token': nativeToken },
  auditFile: '',
  bridgeVersion: 'contract-test',
  fetchJson: async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    if (url.includes('/main-workbench/snapshot')) {
      return { status: 200, body: { ok: true, snapshot: { timelineId: 'formal-a', activeTimelineId: 'formal-a', selectedCharacters: [], skillButtons: [] } } };
    }
    return { status: 200, body: { ok: true, service: 'def-agent-sidecar' } };
  },
  postJson: async () => ({ status: 200, body: { ok: true } }),
  writeJson(response, status, body) { response.status = status; response.body = body; },
  writeSse() {},
  writeSseHeaders() {},
});
const request = new EventEmitter();
request.method = 'GET';
request.url = '/def-agent/interop/v1/status';
request.headers = { host: '127.0.0.1:31457' };
request.socket = { remoteAddress: '127.0.0.1' };
const response = {};
assert.equal(await protocol.handle(request, response, new URL('http://127.0.0.1:31457/def-agent/interop/v1/status'), async () => ({})), true);
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.workbench.snapshotAvailable, true);
const snapshotCall = calls.find((call) => call.url.includes('/main-workbench/snapshot'));
assert.equal(snapshotCall?.headers?.['x-def-internal-token'], nativeToken);
const mainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const rendererSource = fs.readFileSync(new URL('../src/utils/mainWorkbenchControl.ts', import.meta.url), 'utf8');
assert(rendererSource.includes("MAIN_WORKBENCH_REST_BASE_URL = 'http://127.0.0.1:31457'"),
  'browser renderer transport must enter through Electron main, never call raw REST directly');
const proxySource = mainSource.slice(
  mainSource.indexOf('async function proxyMainWorkbenchRendererTransport'),
  mainSource.indexOf('function tryServeUserImageByRequestPath'),
);
assert(proxySource.includes("'x-def-internal-token': defInternalGovernanceToken"),
  'Electron renderer proxy must attach the native REST capability');
assert(proxySource.includes("'POST /api/main-workbench/snapshot'"));
assert(proxySource.includes("'GET /api/main-workbench/commands/events'"));
assert(!proxySource.includes('checkout-projection'), 'native checkout assertion must not be exposed to browser renderers');
console.log('DEF Interop snapshot auth contract: PASS (Interop and browser renderer proxy carry native token)');
