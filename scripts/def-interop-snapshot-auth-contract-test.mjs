import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const {
  createDefCodexInteropProtocol,
  readExactCheckoutPayload,
  resolveCanonicalWorkbenchTimelineId,
} = require('../agent/runtime/def-codex-interop.cjs');
const {
  WORKBENCH_RENDERER_CAPABILITY_HEADER,
  WORKBENCH_RENDERER_CAPABILITY_QUERY,
  buildProtectedWorkbenchNativeHeaders,
  buildRendererCapabilityUrl,
  buildWorkbenchUpstreamSearch,
  createWorkbenchRendererCapability,
  isAllowedWorkbenchRendererTransport,
  isAuthorizedWorkbenchNativeRequest,
  isAuthorizedWorkbenchRendererRequest,
  isProtectedWorkbenchRendererLocalDataPath,
} = require('../electron/workbench-renderer-transport.cjs');
const nativeToken = 'interop-native-snapshot-token';
assert.equal(resolveCanonicalWorkbenchTimelineId({
  timelineId: 'formal-a',
  activeTimelineId: 'formal-a',
  checkout: { timelineId: 'formal-a' },
}, { binding: { timelineId: 'formal-a' }, axisContext: { checkout: { timelineId: 'formal-a' } } }), 'formal-a');
assert.equal(resolveCanonicalWorkbenchTimelineId({
  timelineId: 'formal-a',
  activeTimelineId: 'formal-b',
}, null), '', 'Harness clone-current must fail closed when projection identities disagree');
assert.deepEqual(readExactCheckoutPayload({
  checkoutRef: { targetType: 'work-node', targetId: 'node-b' },
  workNodes: [
    { id: 'node-a', workingPayload: { marker: 'wrong-first-node' } },
    { id: 'node-b', workingPayload: { marker: 'exact-checkout' } },
  ],
}), { marker: 'exact-checkout' });
assert.deepEqual(readExactCheckoutPayload({
  checkoutRef: { targetType: 'snapshot', targetId: 'snapshot-a' },
  snapshots: [{ id: 'snapshot-a', payload: { marker: 'snapshot-checkout' } }],
}), { marker: 'snapshot-checkout' });
assert.equal(readExactCheckoutPayload({
  checkoutRef: { targetType: 'work-node', targetId: 'missing' },
  workNodes: [{ id: 'node-a', workingPayload: { marker: 'must-not-fallback' } }],
}), null);
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
const rendererTransportSource = fs.readFileSync(new URL('../electron/workbench-renderer-transport.cjs', import.meta.url), 'utf8');
const rendererSource = fs.readFileSync(new URL('../src/utils/mainWorkbenchControl.ts', import.meta.url), 'utf8');
const rendererCapabilitySource = fs.readFileSync(new URL('../src/utils/workbenchRendererCapability.ts', import.meta.url), 'utf8');
const workNodeClientSource = fs.readFileSync(new URL('../src/agentKernel/timelineWorktree/localNodeClient.ts', import.meta.url), 'utf8');
const timelineClientSource = fs.readFileSync(new URL('../src/agentKernel/timelineRepository/localTimelineClient.ts', import.meta.url), 'utf8');
assert(rendererSource.includes("MAIN_WORKBENCH_REST_BASE_URL = 'http://127.0.0.1:31457'"),
  'browser renderer transport must enter through Electron main, never call raw REST directly');
const proxySource = mainSource.slice(
  mainSource.indexOf('async function proxyMainWorkbenchRendererTransport'),
  mainSource.indexOf('function tryServeUserImageByRequestPath'),
);
assert(proxySource.includes("'x-def-internal-token': defInternalGovernanceToken"),
  'Electron renderer proxy must attach the native REST capability');
assert(proxySource.includes('isAuthorizedWorkbenchRendererRequest'),
  'Electron renderer proxy must require the per-launch renderer capability');
assert(rendererTransportSource.includes("'POST /api/main-workbench/snapshot'"));
assert(rendererTransportSource.includes("'GET /api/main-workbench/commands/events'"));
assert(!proxySource.includes('checkout-projection'), 'native checkout assertion must not be exposed to browser renderers');
assert(!mainSource.includes('installDefRawTransportHeader'),
  'Electron must not grant raw REST authority to every defaultSession renderer');
assert(mainSource.includes('buildInteropNativeHeaders'),
  'Interop fixture creation and cleanup must carry native authority into protected local-data routes');
assert(mainSource.includes("const shellUrl = getShellUrl({ includeRendererCapability: true });"),
  'Desktop Shell must launch with the per-launch renderer capability for protected local-data transport');

const rendererCapability = createWorkbenchRendererCapability();
assert.notEqual(rendererCapability, createWorkbenchRendererCapability(), 'renderer capability must rotate per process');
assert.equal(isAuthorizedWorkbenchNativeRequest({ headers: {} }, nativeToken), false);
assert.equal(isAuthorizedWorkbenchNativeRequest({
  headers: { 'x-def-internal-token': nativeToken },
}, nativeToken), true, 'main-process Interop callbacks need native authority for protected local-data routes');
assert.deepEqual(buildProtectedWorkbenchNativeHeaders(
  'http://127.0.0.1:31457/local-data/timeline-documents',
  'http://127.0.0.1:31457',
  nativeToken,
), { 'x-def-internal-token': nativeToken });
assert.deepEqual(buildProtectedWorkbenchNativeHeaders(
  'http://attacker.example/local-data/timeline-documents',
  'http://127.0.0.1:31457',
  nativeToken,
), {}, 'native capability must never leave the exact Electron bridge origin');
assert.deepEqual(buildProtectedWorkbenchNativeHeaders(
  'http://127.0.0.1:31457/health',
  'http://127.0.0.1:31457',
  nativeToken,
), {}, 'native capability must be limited to protected local-data routes');
const trustedOriginRequest = { headers: { origin: 'http://127.0.0.1:3030' } };
const snapshotUrl = new URL('http://127.0.0.1:31457/api/main-workbench/snapshot');
assert.equal(isAuthorizedWorkbenchRendererRequest(trustedOriginRequest, snapshotUrl, rendererCapability), false,
  'a spoofable loopback Origin is not sufficient authorization');
assert.equal(isAuthorizedWorkbenchRendererRequest({
  headers: { origin: 'http://127.0.0.1:3030', [WORKBENCH_RENDERER_CAPABILITY_HEADER]: 'wrong' },
}, snapshotUrl, rendererCapability), false);
assert.equal(isAuthorizedWorkbenchRendererRequest({
  headers: { origin: 'http://127.0.0.1:3030', [WORKBENCH_RENDERER_CAPABILITY_HEADER]: rendererCapability },
}, snapshotUrl, rendererCapability), true);
assert.equal(isAuthorizedWorkbenchRendererRequest({
  headers: { origin: 'https://attacker.example' },
}, new URL(buildRendererCapabilityUrl(snapshotUrl, rendererCapability)), rendererCapability), false,
  'a leaked capability must still be rejected outside the trusted renderer origin');
const eventUrl = new URL(buildRendererCapabilityUrl(
  'http://127.0.0.1:31457/api/main-workbench/commands/events?status=pending',
  rendererCapability,
));
assert.equal(eventUrl.searchParams.get(WORKBENCH_RENDERER_CAPABILITY_QUERY), rendererCapability);
assert.equal(isAuthorizedWorkbenchRendererRequest(trustedOriginRequest, eventUrl, rendererCapability), true,
  'EventSource may carry the same capability in its query because it cannot set headers');
assert.equal(buildWorkbenchUpstreamSearch(eventUrl), '?status=pending',
  'the renderer capability must never be forwarded to raw REST');
assert.equal(isAllowedWorkbenchRendererTransport('GET', '/api/ai-timeline-worknodes/node-a/diff'), true);
assert.equal(isAllowedWorkbenchRendererTransport('POST', '/api/ai-timeline-worknodes/node-a/commit'), true);
assert.equal(isAllowedWorkbenchRendererTransport('POST', '/api/ai-timeline-worknodes/node-a/unknown'), false);
assert.equal(isAllowedWorkbenchRendererTransport('POST', '/api/timeline-checkout-ref'), true);
assert.equal(isProtectedWorkbenchRendererLocalDataPath('/local-data/timeline-documents'), true);
assert.equal(isProtectedWorkbenchRendererLocalDataPath('/local-data/ai-timeline-worknodes/node-a'), true);
assert(rendererSource.includes('withWorkbenchRendererCapability(input, init.headers)'));
assert(rendererSource.includes('buildWorkbenchRendererEventUrl'));
assert(rendererCapabilitySource.includes('window.history.replaceState'), 'launch capability must be removed from the visible URL');
assert(rendererCapabilitySource.includes('isWorkbenchRendererBridgeUrl'),
  'renderer capability must be bound to the exact Electron bridge origin');
assert(workNodeClientSource.includes("const DEFAULT_REST_BASE_URL = DEFAULT_BRIDGE_BASE_URL"));
assert(workNodeClientSource.includes('withWorkbenchRendererCapability'));
assert(timelineClientSource.includes('const REST_BASE_URL = BRIDGE_BASE_URL'));
assert(timelineClientSource.includes('withWorkbenchRendererCapability'));
console.log('DEF Interop snapshot auth contract: PASS (Interop native token plus unforgeable renderer capability)');
