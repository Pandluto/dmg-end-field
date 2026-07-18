import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

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
console.log('DEF Interop snapshot auth contract: PASS (main-process snapshot fetch carries native token)');
