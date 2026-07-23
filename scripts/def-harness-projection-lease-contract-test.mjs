import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHarnessProjectionLeaseStore } from './def-core/harness-projection-lease.mjs';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');
const { deleteNativeSessionById } = require('../agent/server/def-agent-server.cjs');

let clock = 1_000;
const store = createHarnessProjectionLeaseStore({ now: () => clock, randomBytes: () => Buffer.alloc(32, 7), activeLimit: 2 });
const commitments = {
  sourceTimelineId: 'source', sourceCheckoutTargetType: 'work-node', sourceCheckoutTargetId: 'source-node', sourceCheckoutUpdatedAt: 10,
  sourcePayloadHash: 'source-payload', sourceRevision: 10, sourceProjectionHash: 'source-projection',
  fixtureTimelineId: 'fixture', fixtureNodeId: 'fixture-node', fixtureCheckoutUpdatedAt: 11, fixturePayloadHash: 'fixture-payload', fixtureRevision: 11,
};
assert.equal(store.provision({ mode: 'typo', commitments }).ok, false, 'unknown projection modes must not downgrade to fixture mode');
const provision = store.provision({ mode: 'hidden-fixture', commitments });
assert.equal(provision.ok, true);
const provisionAssertion = store.assertProvision({ token: provision.token, mode: 'hidden-fixture', timelineId: 'fixture', boundNodeId: 'fixture-node' });
assert.equal(provisionAssertion.ok, true, 'first-bind provision assertion must not consume a valid lease');
assert.equal(Object.hasOwn(provisionAssertion, 'token'), false, 'provision assertion must never echo its bearer token');
assert.equal(Object.hasOwn(provisionAssertion, 'projection'), false, 'provision assertion must never expose private projection state');
assert.equal(store.assertProvision({ token: provision.token, mode: 'active-current-readonly', timelineId: 'fixture', boundNodeId: 'fixture-node' }).ok, false,
  'a provision assertion must require its exact mode');
assert.equal(store.assertProvision({ token: provision.token, mode: 'hidden-fixture', timelineId: 'source', boundNodeId: 'fixture-node' }).ok, false,
  'a provision assertion must require its exact timeline');
assert.equal(store.assertProvision({ token: provision.token, mode: 'hidden-fixture', timelineId: 'fixture', boundNodeId: 'source-node' }).ok, false,
  'a provision assertion must require its exact Work Node');
const identity = { sessionId: 'fixture-session', axisBindingId: 'fixture-axis', timelineId: 'fixture', boundNodeId: 'fixture-node', harnessCommitment: 'sealed-harness', agentReleaseCommitment: 'sealed-release' };
assert.equal(store.activate({ token: provision.token, session: { ...identity, boundNodeId: '' } }).code, 'harness-activation-node-mismatch', 'missing node identity must not match a fixture lease');
assert.equal(store.activate({ token: provision.token, session: identity }).ok, true);
assert.equal(store.activate({ token: provision.token, session: identity }).code, 'harness-provision-invalid-or-consumed', 'provision token is one-shot');
assert.equal(store.resolve({ ...identity, harnessCommitment: '', agentReleaseCommitment: '' }).ok, true);
assert.equal(store.resolve({ ...identity, boundNodeId: '' }).ok, false, 'runtime lease lookup must retain exact bound node identity');
assert.equal(store.revoke(identity.sessionId).status, 'revoked');
assert.equal(store.resolve(identity).ok, false, 'revoke must fail closed before cleanup continues');
const cancelStore = createHarnessProjectionLeaseStore({ now: () => clock, randomBytes: () => Buffer.alloc(32, 8) });
const cancelledLease = cancelStore.provision({ mode: 'hidden-fixture', commitments });
assert.equal(cancelStore.cancel({ token: cancelledLease.token }).status, 'cancelled');
assert.equal(cancelStore.activate({ token: cancelledLease.token, session: identity }).code, 'harness-provision-invalid-or-consumed',
  'a cancelled provision cannot be activated later');
assert.equal(cancelStore.cancel({ token: cancelledLease.token }).code, 'harness-provision-invalid-or-consumed',
  'cancel is one-shot just like activation');
assert.equal(cancelStore.assertProvision({ token: cancelledLease.token, mode: 'hidden-fixture', timelineId: 'fixture', boundNodeId: 'fixture-node' }).ok, false,
  'cancelled provisions cannot be asserted for a first bind');
const expiringStore = createHarnessProjectionLeaseStore({ now: () => clock, randomBytes: () => Buffer.alloc(32, 9) });
const expiringProvision = expiringStore.provision({ mode: 'hidden-fixture', commitments, ttlMs: 1 });
clock += 2;
assert.equal(expiringStore.assertProvision({ token: expiringProvision.token, mode: 'hidden-fixture', timelineId: 'fixture', boundNodeId: 'fixture-node' }).code, 'harness-provision-expired',
  'expired provisions cannot be asserted for a first bind');
const ttlStore = createHarnessProjectionLeaseStore({ now: () => clock, activeLimit: 1 });
const ttlProvision = ttlStore.provision({ mode: 'hidden-fixture', commitments });
const ttlIdentity = { ...identity, sessionId: 'ttl-session', axisBindingId: 'ttl-axis' };
assert.equal(ttlStore.activate({ token: ttlProvision.token, session: ttlIdentity }).ok, true);
const concurrentProvision = ttlStore.provision({ mode: 'hidden-fixture', commitments });
assert.equal(ttlStore.activate({ token: concurrentProvision.token, session: { ...ttlIdentity, sessionId: 'parallel-session', axisBindingId: 'parallel-axis' } }).code, 'harness-active-limit', 'concurrent active leases obey the server-side limit');
clock += 5 * 60_000 + 1;
assert.equal(ttlStore.resolve(ttlIdentity).ok, false, 'expired leases must fail closed without a renewal path');
const restartStore = createHarnessProjectionLeaseStore();
assert.equal(restartStore.resolve(identity).ok, false, 'a sidecar restart must forget active Harness leases');
const nativeDeleteStore = createHarnessProjectionLeaseStore({ now: () => clock, activeLimit: 4 });
function activateNativeDeleteLease(index) {
  const provisioned = nativeDeleteStore.provision({ mode: 'hidden-fixture', commitments });
  const session = { ...identity, sessionId: `native-delete-${index}`, axisBindingId: `native-delete-axis-${index}` };
  assert.equal(nativeDeleteStore.activate({ token: provisioned.token, session }).ok, true);
  return session;
}
const nativeDeleteSessions = [1, 2, 3, 4].map(activateNativeDeleteLease);
const fifthBeforeDelete = nativeDeleteStore.provision({ mode: 'hidden-fixture', commitments });
const fifthNativeDeleteSession = { ...identity, sessionId: 'native-delete-5', axisBindingId: 'native-delete-axis-5' };
assert.equal(nativeDeleteStore.activate({ token: fifthBeforeDelete.token, session: fifthNativeDeleteSession }).code, 'harness-active-limit');
const ordinaryDeleteOrder = [];
const ordinaryDelete = await deleteNativeSessionById(nativeDeleteSessions[0].sessionId, {
  bindingResolver: (sessionID) => (sessionID === nativeDeleteSessions[0].sessionId
    ? { sessionID, host: 'workbench', directory: 'C:\\def-contract\\native-delete-1' }
    : null),
  revokeHarnessProjection: async (sessionID, reason) => {
    ordinaryDeleteOrder.push('revoke');
    return nativeDeleteStore.revoke(sessionID, reason);
  },
  runtime: { serverUrl: 'http://fake-opencode.invalid' },
  fetchImpl: async () => ({ ok: true, status: 200 }),
  rejectQuestions: async () => undefined,
  deleteQuestionRecords: () => undefined,
  removeAxisBinding: async () => { ordinaryDeleteOrder.push('axis-binding-delete'); },
  removeDirectory: () => { ordinaryDeleteOrder.push('directory-delete'); },
  admissionGate: { releaseSession: () => { ordinaryDeleteOrder.push('admission-release'); } },
});
assert.equal(ordinaryDelete.status, 'deleted');
assert.deepEqual(ordinaryDeleteOrder, ['revoke', 'axis-binding-delete', 'directory-delete', 'admission-release'],
  'ordinary deletion must revoke the Harness lease before native binding cleanup');
assert.equal(nativeDeleteStore.resolve(nativeDeleteSessions[0]).ok, false, 'ordinary native session deletion must make its Harness lease immediately unavailable');
assert.equal(nativeDeleteStore.revoke(nativeDeleteSessions[0].sessionId, 'repeat-native-session-delete').status, 'already-revoked',
  'a repeated delete cleanup remains idempotent without reactivating the lease');
assert.equal(nativeDeleteStore.activate({ token: fifthBeforeDelete.token, session: fifthNativeDeleteSession }).ok, true,
  'revoking before normal native deletion must release a concurrency slot for the next Harness lease');

// Exercise the wire boundary separately from REST: a scenario-policy error is
// not an environmental block, and must preserve its established Harness run
// outcome vocabulary at the runner boundary.
const interop = createDefCodexInteropProtocol({
  profile: 'development', baseUrl: 'http://127.0.0.1:31457', sidecarUrl: 'http://127.0.0.1:17322',
  snapshotUrl: 'http://127.0.0.1:17321/api/main-workbench/snapshot', snapshotHeaders: { 'x-def-internal-token': 'test' }, auditFile: '',
  fetchJson: async () => ({ status: 200, body: { ok: true } }),
  postJson: async (url) => url.includes('/harness-projection/provision')
    ? { status: 400, body: { ok: false, error: { code: 'ERROR_SCENARIO', message: 'non-read-only onlyTools' } } }
    : { status: 500, body: { ok: false } },
  writeJson(response, status, body) { response.status = status; response.body = body; }, writeSse() {}, writeSseHeaders() {},
});
async function interopCall(protocol, method, pathname, body = {}, token = '') {
  const request = new EventEmitter();
  request.method = method; request.url = pathname; request.socket = { remoteAddress: '127.0.0.1' };
  request.headers = { host: '127.0.0.1:31457', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = {};
  await protocol.handle(request, response, new URL(`http://127.0.0.1:31457${pathname}`), async () => body);
  return response;
}
const authorized = await interopCall(interop, 'POST', '/def-agent/interop/v1/authorize');
const ui = await interopCall(interop, 'POST', '/def-agent/interop/v1/ui/consumer', { host: 'workbench', sessionId: 'visible-source' });
assert.equal(ui.status, 200);
const badScenario = await interopCall(interop, 'POST', '/def-agent/interop/v1/harness/sessions', {
  harnessSelector: 'stable', fixtureMode: 'active-current-readonly', scenarioToolAllowlist: ['def_team_loadout_plan_apply'],
}, authorized.body.token);
assert.equal(badScenario.status, 400);
assert.equal(badScenario.body.error.code, 'ERROR_SCENARIO', 'Interop must preserve Scenario policy failures instead of reporting BLOCKED_ENVIRONMENT');
function createNativeCreateFailureInterop(nativeCreate, {
  cancel = { status: 200, body: { ok: true, status: 'cancelled' } },
  fixtureDelete = { status: 200, body: { ok: true } },
} = {}) {
  const calls = [];
  const protocol = createDefCodexInteropProtocol({
    profile: 'development', baseUrl: 'http://127.0.0.1:31457', sidecarUrl: 'http://127.0.0.1:17322',
    snapshotUrl: 'http://127.0.0.1:17321/api/main-workbench/snapshot', snapshotHeaders: { 'x-def-internal-token': 'test' }, auditFile: '',
    fetchJson: async () => ({ status: 200, body: { ok: true } }),
    postJson: async (url) => {
      calls.push(url);
      if (url.includes('/harness-projection/provision')) {
        return {
          status: 201,
          body: {
            ok: true,
            provisionToken: 'one-shot',
            fixture: { fixtureId: 'fixture-unit', timelineId: 'fixture-unit-timeline', boundNodeId: 'fixture-unit-node' },
            source: { timelineId: 'source', boundNodeId: 'source-node' },
          },
        };
      }
      if (url.includes('/harness-projection/cancel')) return cancel;
      if (url.includes('/harness-projection/delete-fixture')) return fixtureDelete;
      if (url.includes('/local-data/timeline-documents/') && url.endsWith('/delete')) return fixtureDelete;
      if (url === 'http://127.0.0.1:17322/api/native/session') return nativeCreate;
      return { status: 200, body: { ok: true } };
    },
    writeJson(response, status, body) { response.status = status; response.body = body; }, writeSse() {}, writeSseHeaders() {},
  });
  protocol.contractCalls = calls;
  return protocol;
}
async function createHarnessThroughInterop(nativeCreate, {
  fixtureMode = 'active-current-readonly',
  ...options
} = {}) {
  const protocol = createNativeCreateFailureInterop(nativeCreate, options);
  const auth = await interopCall(protocol, 'POST', '/def-agent/interop/v1/authorize');
  await interopCall(protocol, 'POST', '/def-agent/interop/v1/ui/consumer', { host: 'workbench', sessionId: 'visible-source' });
  const response = await interopCall(protocol, 'POST', '/def-agent/interop/v1/harness/sessions', {
    harnessSelector: 'stable', fixtureMode, scenarioToolAllowlist: ['def_operator_config_preview'],
  }, auth.body.token);
  return { protocol, response };
}
const { response: ownerMismatch } = await createHarnessThroughInterop({
  status: 409,
  body: { ok: false, error: { code: 'BLOCKED_ENVIRONMENT', message: 'owner mismatch before provider', status: 409 } },
});
assert.equal(ownerMismatch.status, 409);
assert.equal(ownerMismatch.body.error.code, 'BLOCKED_ENVIRONMENT', 'active owner/checkout mismatch must preserve the pre-provider environment block');
const { response: sealLoadMismatch } = await createHarnessThroughInterop({
  status: 500,
  body: { ok: false, error: { code: 'HARNESS_PROJECTION_SEAL_INVALID', message: 'sealed session mismatch', status: 500 } },
});
assert.equal(sealLoadMismatch.status, 502);
assert.equal(sealLoadMismatch.body.error.code, 'BLOCKED_HARNESS_LOAD', 'candidate seal/load failures remain Harness load failures');
assert.deepEqual(sealLoadMismatch.body.error.details, {
  upstream: {
    resource: 'native-session-create',
    upstreamStatus: 500,
    upstreamCode: 'HARNESS_PROJECTION_SEAL_INVALID',
    upstreamMessage: 'sealed session mismatch',
  },
  rollback: {
    attempted: true,
    projection: { attempted: true, status: 200, outcome: 'confirmed' },
    fixture: { attempted: false, outcome: 'not-required' },
    completed: true,
  },
}, 'authorized teacher ingress must retain a bounded, redacted sidecar cause and verifiable rollback evidence');
assert.equal(sealLoadMismatch.body.error.retryable, false, 'deterministic Harness seal failures are not retryable environment blocks');

const longSecret = `Bearer secret-bearer provisionToken=${'x'.repeat(380)} apiKey=api-key-secret password=password-secret Authorization: authorization-secret`;
const { response: coldBootstrap } = await createHarnessThroughInterop({
  status: 500,
  body: { ok: false, error: { details: { cause: { code: 'OPENCODE_REQUEST_TIMEOUT', message: longSecret } } } },
});
assert.equal(coldBootstrap.status, 503, 'known cold-bootstrap transport failure maps to retryable environment status');
assert.equal(coldBootstrap.body.error.code, 'BLOCKED_ENVIRONMENT');
assert.equal(coldBootstrap.body.error.retryable, true);
assert.equal(coldBootstrap.body.error.details.upstream.upstreamCode, 'OPENCODE_REQUEST_TIMEOUT', 'nested typed transport code is classified');
assert.doesNotMatch(coldBootstrap.body.error.details.upstream.upstreamMessage, /secret-bearer|api-key-secret|password-secret|authorization-secret|x{20}|\$1/i,
  'upstream diagnostic text redacts bearer, token, api-key, password, and authorization values without exposing replacement literals');
assert.match(coldBootstrap.body.error.details.upstream.upstreamMessage, /\[redacted\]/, 'upstream token values are replaced before returning diagnostics');

const { response: stringTransport } = await createHarnessThroughInterop({
  status: 500,
  body: { ok: false, error: 'OPENCODE_CONNECTION_CLOSED: bootstrap socket closed' },
});
assert.equal(stringTransport.status, 503, 'string-form typed transport failures remain environment blocks');
assert.equal(stringTransport.body.error.code, 'BLOCKED_ENVIRONMENT');

const { response: unknownFailure } = await createHarnessThroughInterop({
  status: 500,
  body: { ok: false, error: { code: 'SOME_NEW_UPSTREAM_FAILURE', message: `unknown upstream state ${'z'.repeat(380)}` } },
});
assert.equal(unknownFailure.status, 502);
assert.equal(unknownFailure.body.error.code, 'ERROR_PROTOCOL', 'unknown upstream codes must not be promoted to Harness-load blocks');
assert.equal(unknownFailure.body.error.retryable, false);
assert.equal(unknownFailure.body.error.details.upstream.upstreamMessage.length, 300, 'non-secret upstream diagnostics truncate at 300 characters');

for (const [deleteStatus, expectedOutcome, completed] of [
  [200, 'confirmed', true],
  [404, 'already-absent', true],
  [500, 'failed', false],
]) {
  const { protocol, response } = await createHarnessThroughInterop({
    status: 500,
    body: { ok: false, error: { code: 'HARNESS_HASH_MISMATCH', message: 'deterministic hash failure' } },
  }, {
    fixtureMode: 'clone-current',
    fixtureDelete: { status: deleteStatus, body: { ok: deleteStatus === 200 } },
  });
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, 'BLOCKED_HARNESS_LOAD');
  assert.equal(response.body.error.details.rollback.fixture.status, deleteStatus);
  assert.equal(response.body.error.details.rollback.fixture.outcome, expectedOutcome, `fixture delete ${deleteStatus} is recorded exactly`);
  assert.equal(response.body.error.details.rollback.completed, completed, `fixture delete ${deleteStatus} controls verified rollback completion`);
  assert.equal(protocol.contractCalls.some((url) => url.includes('/harness-projection/delete-fixture')), true,
    'hidden native-create failure uses the privileged Harness fixture cleanup route');
}
const { response: cancelUnavailable } = await createHarnessThroughInterop({
  status: 500,
  body: { ok: false, error: { code: 'HARNESS_HASH_MISMATCH', message: 'native failure after lease consumption' } },
}, {
  cancel: { status: 409, body: { ok: false, error: { code: 'harness-provision-invalid-or-consumed', message: 'already active or revoked' } } },
});
assert.equal(cancelUnavailable.body.error.details.rollback.projection.outcome, 'failed',
  'a consumed/activated provision is explicit failed cancellation evidence, never a fabricated cleanup success');
assert.equal(cancelUnavailable.body.error.details.rollback.completed, false);

// Exercise runner cleanup through the Interop memory transport. Hidden
// fixtures are repository-internal, so a normal runner DELETE must use the
// privileged fixture route; empty fixtures remain on the ordinary route.
function createHarnessRunnerCleanupInterop({ fixtureMode, fixtureDeleteStatus = 200 } = {}) {
  const calls = [];
  let nextFixtureDeleteStatus = fixtureDeleteStatus;
  const protocol = createDefCodexInteropProtocol({
    profile: 'development', baseUrl: 'http://127.0.0.1:31457', sidecarUrl: 'http://127.0.0.1:17322',
    snapshotUrl: 'http://127.0.0.1:17321/api/main-workbench/snapshot', snapshotHeaders: { 'x-def-internal-token': 'test' }, auditFile: '',
    fetchJson: async () => ({ status: 200, body: { ok: true } }),
    postJson: async (url, body) => {
      calls.push({ url, body });
      if (url.includes('/harness-projection/provision')) {
        return {
          status: 201,
          body: {
            ok: true,
            provisionToken: 'runner-cleanup-provision',
            fixture: { fixtureId: 'runner-cleanup-fixture', timelineId: 'runner-cleanup-hidden-timeline', boundNodeId: 'runner-cleanup-node' },
            source: { timelineId: 'visible-source', boundNodeId: 'source-node' },
          },
        };
      }
      if (url === 'http://127.0.0.1:31457/local-data/timeline-documents') return { status: 201, body: { ok: true } };
      if (url === 'http://127.0.0.1:17322/api/native/session') {
        const sessionId = fixtureMode === 'empty' ? 'empty-runner-session' : 'hidden-runner-session';
        return { status: 201, body: { ok: true, session: { id: sessionId, directory: `C:\\def-contract\\${sessionId}` } } };
      }
      if (url.includes('/runner-cleanup')) return { status: 204, body: null };
      if (url.includes('/harness-projection/delete-fixture')
        || (url.includes('/local-data/timeline-documents/') && url.endsWith('/delete'))) {
        return { status: nextFixtureDeleteStatus, body: { ok: nextFixtureDeleteStatus >= 200 && nextFixtureDeleteStatus < 300 } };
      }
      return { status: 500, body: { ok: false, error: { code: 'unexpected-cleanup-route' } } };
    },
    writeJson(response, status, body) { response.status = status; response.body = body; }, writeSse() {}, writeSseHeaders() {},
  });
  return {
    protocol,
    calls,
    setFixtureDeleteStatus(status) { nextFixtureDeleteStatus = status; },
  };
}

async function createHarnessRunnerForCleanup(transport, fixtureMode) {
  const auth = await interopCall(transport.protocol, 'POST', '/def-agent/interop/v1/authorize');
  if (fixtureMode !== 'empty') {
    const uiConsumer = await interopCall(transport.protocol, 'POST', '/def-agent/interop/v1/ui/consumer', { host: 'workbench', sessionId: 'visible-source' });
    assert.equal(uiConsumer.status, 200);
  }
  const created = await interopCall(transport.protocol, 'POST', '/def-agent/interop/v1/harness/sessions', {
    harnessSelector: 'stable', fixtureMode, scenarioToolAllowlist: ['def_operator_config_preview'],
  }, auth.body.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { token: auth.body.token, runner: created.body.runner };
}

const hiddenCleanupTransport = createHarnessRunnerCleanupInterop({ fixtureMode: 'clone-current' });
const hiddenCleanupRunner = await createHarnessRunnerForCleanup(hiddenCleanupTransport, 'clone-current');
const hiddenCleanup = await interopCall(hiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${hiddenCleanupRunner.runner.sessionId}`, {}, hiddenCleanupRunner.token);
assert.equal(hiddenCleanup.status, 200, JSON.stringify(hiddenCleanup.body));
assert.equal(hiddenCleanupTransport.calls.filter((call) => call.url.includes('/harness-projection/delete-fixture')).length, 1,
  'hidden fixture cleanup must use the authenticated fixture delete route exactly once');
assert.equal(hiddenCleanupTransport.calls.filter((call) => call.url.includes('/local-data/timeline-documents/') && call.url.endsWith('/delete')).length, 0,
  'hidden fixture cleanup must never fall back to the ordinary local-data delete route');
const hiddenCleanupRepeat = await interopCall(hiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${hiddenCleanupRunner.runner.sessionId}`, {}, hiddenCleanupRunner.token);
assert.equal(hiddenCleanupRepeat.status, 200);
assert.equal(hiddenCleanupRepeat.body.status, 'already-closed', 'only a previously removed runner is idempotently already closed');
assert.equal(hiddenCleanupTransport.calls.filter((call) => call.url.includes('/runner-cleanup')).length, 1,
  'a successful runner cleanup removes the runner map entry before repeat DELETE');

const failedHiddenCleanupTransport = createHarnessRunnerCleanupInterop({ fixtureMode: 'clone-current', fixtureDeleteStatus: 500 });
const failedHiddenCleanupRunner = await createHarnessRunnerForCleanup(failedHiddenCleanupTransport, 'clone-current');
const failedHiddenCleanup = await interopCall(failedHiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${failedHiddenCleanupRunner.runner.sessionId}`, {}, failedHiddenCleanupRunner.token);
assert.equal(failedHiddenCleanup.status, 502, 'a failed hidden fixture cleanup must retain the runner for retry');
assert.equal(failedHiddenCleanup.body.error.code, 'harness-fixture-cleanup-failed');
failedHiddenCleanupTransport.setFixtureDeleteStatus(200);
const retriedHiddenCleanup = await interopCall(failedHiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${failedHiddenCleanupRunner.runner.sessionId}`, {}, failedHiddenCleanupRunner.token);
assert.equal(retriedHiddenCleanup.status, 200, 'the retained runner can retry cleanup after a fixture-delete failure');

const absentHiddenCleanupTransport = createHarnessRunnerCleanupInterop({ fixtureMode: 'clone-current', fixtureDeleteStatus: 404 });
const absentHiddenCleanupRunner = await createHarnessRunnerForCleanup(absentHiddenCleanupTransport, 'clone-current');
const absentHiddenCleanup = await interopCall(absentHiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${absentHiddenCleanupRunner.runner.sessionId}`, {}, absentHiddenCleanupRunner.token);
assert.equal(absentHiddenCleanup.status, 502, 'a missing first-delete fixture is not fabricated as successful cleanup');
absentHiddenCleanupTransport.setFixtureDeleteStatus(200);
const retriedAbsentHiddenCleanup = await interopCall(absentHiddenCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${absentHiddenCleanupRunner.runner.sessionId}`, {}, absentHiddenCleanupRunner.token);
assert.equal(retriedAbsentHiddenCleanup.status, 200, 'a runner retained after a missing fixture response can be retried and closed');

const emptyCleanupTransport = createHarnessRunnerCleanupInterop({ fixtureMode: 'empty' });
const emptyCleanupRunner = await createHarnessRunnerForCleanup(emptyCleanupTransport, 'empty');
const emptyCleanup = await interopCall(emptyCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${emptyCleanupRunner.runner.sessionId}`, {}, emptyCleanupRunner.token);
assert.equal(emptyCleanup.status, 200, JSON.stringify(emptyCleanup.body));
assert.equal(emptyCleanupTransport.calls.filter((call) => call.url.includes('/harness-projection/delete-fixture')).length, 0,
  'empty fixtures do not use the privileged hidden-fixture route');
assert.equal(emptyCleanupTransport.calls.filter((call) => call.url.includes('/local-data/timeline-documents/') && call.url.endsWith('/delete')).length, 1,
  'empty fixtures preserve ordinary local-data cleanup');

const activeCurrentCleanupTransport = createHarnessRunnerCleanupInterop({ fixtureMode: 'active-current-readonly' });
const activeCurrentCleanupRunner = await createHarnessRunnerForCleanup(activeCurrentCleanupTransport, 'active-current-readonly');
const activeCurrentCleanup = await interopCall(activeCurrentCleanupTransport.protocol, 'DELETE', `/def-agent/interop/v1/harness/sessions/${activeCurrentCleanupRunner.runner.sessionId}`, {}, activeCurrentCleanupRunner.token);
assert.equal(activeCurrentCleanup.status, 200, JSON.stringify(activeCurrentCleanup.body));
assert.equal(activeCurrentCleanupTransport.calls.filter((call) => call.url.includes('/harness-projection/delete-fixture')
  || (call.url.includes('/local-data/timeline-documents/') && call.url.endsWith('/delete'))).length, 0,
  'active-current runners do not own or delete a fixture');

const runnerSource = fs.readFileSync(new URL('./def-harness-native-runner.mjs', import.meta.url), 'utf8');
assert(runnerSource.includes("caught.code === 'ERROR_SCENARIO' ? 'ERROR_VERIFIER'"),
  'runner must map Scenario configuration errors to the established ERROR_VERIFIER status while retaining error.code');
const nativeSessionServerSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
const nativeDeleteFunction = nativeSessionServerSource.slice(
  nativeSessionServerSource.indexOf('async function deleteNativeSessionById(sessionID, options = {})'),
  nativeSessionServerSource.indexOf('async function cleanupNativeAiCliSessions(input, options = {})'),
);
assert(
  nativeDeleteFunction.indexOf("await revokeProjection(sessionID, options.harnessProjectionRevokeReason || 'native-session-delete');")
    < nativeDeleteFunction.indexOf('await removeAxisBinding(binding);'),
  'the shared ordinary DELETE and bulk-cleanup primitive must revoke before deleting native bindings',
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-projection-'));
const port = 18700 + Math.floor(Math.random() * 300);
const token = 'projection-contract-native-token';
const databasePath = path.join(root, 'timeline.sqlite');
const repository = createTimelineRepository({ databasePath });
const payload = {
  selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [], characterInputMap: {}, operatorConfigPageCache: {},
};
repository.ensureDocument({ id: 'source', label: 'source' });
repository.importWorkNode({ id: 'source-node', timelineId: 'source', branchId: 'source-branch', label: 'source', status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload, contentRevision: 100 });
repository.setCheckoutRef({ timelineId: 'source', targetType: 'work-node', targetId: 'source-node', updatedAt: 100 });
repository.upsertSessionAxisBinding({ id: 'source-axis', timelineId: 'source', host: 'workbench', opencodeSessionId: 'source-session', boundNodeId: 'source-node' });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port), AI_CLI_REST_STORAGE_MODE: 'runtime', AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'), AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath, DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'), DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: token, DEF_HARNESS_PROJECTION_ENABLED: '1',
  },
  stdio: 'ignore',
});

async function waitReady() {
  for (let index = 0; index < 300; index += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('projection contract REST server did not start');
}
async function post(pathname, body, internal = true) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(internal ? { 'x-def-internal-token': token } : {}) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function get(pathname, internal = true) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: internal ? { 'x-def-internal-token': token } : {} });
  return { status: response.status, body: await response.json() };
}

try {
  await waitReady();
  const mirror = await post('/api/main-workbench/snapshot', {
    source: 'app', activeTimelineId: 'source', timelineId: 'source', checkout: repository.getCheckoutRef('source'),
    selectedCharacters: [], skillButtons: [], operatorConfigs: [], damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] }, updatedAt: 100,
  });
  assert.equal(mirror.status, 200);
  const rawDenied = await post('/api/main-workbench/harness-projection/provision', { mode: 'hidden-fixture', sourceSessionId: 'source-session' }, false);
  assert.equal(rawDenied.status, 403, 'raw loopback callers cannot provision');
  const unknown = await post('/api/main-workbench/harness-projection/provision', { mode: 'unknown', sourceSessionId: 'source-session' });
  assert.equal(unknown.status, 400);
  const fixtureProvision = await post('/api/main-workbench/harness-projection/provision', { mode: 'hidden-fixture', sourceSessionId: 'source-session' });
  assert.equal(fixtureProvision.status, 201, JSON.stringify(fixtureProvision.body));
  const fixture = fixtureProvision.body.fixture;
  assert(fixture?.timelineId && fixture?.boundNodeId);
  const fixtureAuthority = { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture' };
  assert.throws(() => repository.exportDocumentBundle(fixture.timelineId), (error) => error?.code === 'timeline-document-not-found',
    'ordinary repository export must not disclose a hidden fixture');
  const ordinaryFixtureAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission', input: { timelineId: fixture.timelineId },
  });
  assert.equal(ordinaryFixtureAdmission.status, 404, 'ordinary admission must not discover a hidden fixture');
  const ordinaryFixtureBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'ordinary-fixture-axis', sessionID: 'ordinary-fixture-session', host: 'workbench', timelineId: fixture.timelineId, boundNodeId: fixture.boundNodeId },
  });
  assert.equal(ordinaryFixtureBind.status, 409, 'ordinary binding must not attach to a hidden fixture');
  const fakeFixtureAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission',
    input: { timelineId: fixture.timelineId, harnessProjection: { provisionToken: 'fake-provision', mode: 'hidden-fixture' } },
  });
  assert.equal(fakeFixtureAdmission.status, 409, 'fake provision tokens must fail closed');
  const wrongModeFixtureAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission',
    input: { timelineId: fixture.timelineId, harnessProjection: { ...fixtureAuthority, mode: 'active-current-readonly' } },
  });
  assert.equal(wrongModeFixtureAdmission.status, 409, 'wrong provision modes must fail closed');
  const fixtureAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission', input: { timelineId: fixture.timelineId, harnessProjection: fixtureAuthority },
  });
  assert.equal(fixtureAdmission.status, 200, JSON.stringify(fixtureAdmission.body));
  const fixtureBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId, harnessProjection: fixtureAuthority },
  });
  assert.equal(fixtureBind.status, 200, JSON.stringify(fixtureBind.body));
  assert.equal(fixtureBind.body.result.binding.boundNodeId, fixture.boundNodeId, 'fixture first bind uses the lease commitment rather than caller-selected state');
  const fixtureUnactivatedBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(fixtureUnactivatedBind.status, 409, 'fixture continuation without an active lease must not self-elevate');
  const fixtureUnactivatedAssert = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(fixtureUnactivatedAssert.status, 409, 'fixture assertions without a token require an active lease');
  const cancelledProvision = await post('/api/main-workbench/harness-projection/provision', { mode: 'hidden-fixture', sourceSessionId: 'source-session' });
  assert.equal(cancelledProvision.status, 201);
  const cancelled = await post('/api/main-workbench/harness-projection/cancel', { provisionToken: cancelledProvision.body.provisionToken });
  assert.deepEqual(cancelled, { status: 200, body: { ok: true, protocolVersion: 1, status: 'cancelled' } },
    'cancel consumes a provision token without returning the capability');
  const cancelledReplay = await post('/api/main-workbench/harness-projection/cancel', { provisionToken: cancelledProvision.body.provisionToken });
  assert.equal(cancelledReplay.status, 409, 'cancelled provisions are one-shot and cannot be replayed');
  const cancelledAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission',
    input: {
      timelineId: cancelledProvision.body.fixture.timelineId,
      harnessProjection: { provisionToken: cancelledProvision.body.provisionToken, mode: 'hidden-fixture' },
    },
  });
  assert.equal(cancelledAdmission.status, 409, 'cancelled provision tokens cannot authorize hidden admission');
  const cancelledFixtureDelete = await post('/api/main-workbench/harness-projection/delete-fixture', { timelineId: cancelledProvision.body.fixture.timelineId });
  assert.equal(cancelledFixtureDelete.status, 200, 'authenticated Harness fixture cleanup uses the privileged repository operation');
  const cancelledFixtureRepeat = await post('/api/main-workbench/harness-projection/delete-fixture', { timelineId: cancelledProvision.body.fixture.timelineId });
  assert.equal(cancelledFixtureRepeat.status, 404, 'fixture cleanup reports an already-absent fixture for strict rollback evidence');
  const spoof = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session', harnessCommitment: 'forged', agentReleaseCommitment: 'forged' });
  assert.equal(spoof.status, 409, 'activation must require independently registered sealed identity');
  const registered = await post('/api/main-workbench/harness-projection/register-native', { sessionId: 'fixture-session', harnessCommitment: 'sealed-harness', agentReleaseCommitment: 'sealed-release' });
  assert.equal(registered.status, 201);
  const activated = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session' });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(Object.hasOwn(activated.body, 'provisionToken'), false, 'activation must not expose a bearer provision token');
  const fixtureContinuationBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(fixtureContinuationBind.status, 200, JSON.stringify(fixtureContinuationBind.body));
  const fixtureContinuationAssert = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(fixtureContinuationAssert.status, 200, 'fixture assertion without a token must use only its active lease');
  const consumedFixtureBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId, harnessProjection: fixtureAuthority },
  });
  assert.equal(consumedFixtureBind.status, 409, 'consumed provisions cannot be replayed for a bound fixture');
  const visibleBefore = JSON.stringify((await get('/api/main-workbench/snapshot')).body.snapshot);
  const fixtureCheckout = await post('/api/main-workbench/checkout-projection', {
    sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', timelineId: fixture.timelineId,
  });
  assert.equal(fixtureCheckout.status, 200, JSON.stringify(fixtureCheckout.body));
  assert.equal(fixtureCheckout.body.snapshot.source, 'harness-fixture', 'hidden checkout reads return the active fixture projection');
  assert.equal(JSON.stringify((await get('/api/main-workbench/snapshot')).body.snapshot), visibleBefore,
    'hidden checkout reads must not mutate the visible Canvas mirror');
  const snapshotRead = await post('/api/def-tools/call', { tool: 'def.workbench.snapshot', sessionId: 'fixture-session', input: { sessionBindingId: 'fixture-axis' } });
  assert.equal(snapshotRead.status, 200, JSON.stringify(snapshotRead.body));
  assert.equal(snapshotRead.body.result.snapshot.source, 'harness-fixture');
  const previewDenied = await post('/api/def-tools/call', { tool: 'def.operator.config.preview', sessionId: 'fixture-session', input: {} });
  assert.equal(previewDenied.status, 403, 'hidden fixture must deny Canvas preview/queue reads');
  const mutationDenied = await post('/api/def-tools/call', { tool: 'def.team.selection.apply', sessionId: 'fixture-session', input: {} });
  assert.equal(mutationDenied.status, 403, 'hidden fixture must deny mutations');
  const visibleAfter = JSON.stringify((await get('/api/main-workbench/snapshot')).body.snapshot);
  assert.equal(visibleAfter, visibleBefore, 'hidden fixture reads must not overwrite the visible Canvas mirror');
  const replay = await post('/api/main-workbench/harness-projection/activate', { provisionToken: fixtureProvision.body.provisionToken, mode: 'hidden-fixture', sessionId: 'fixture-session' });
  assert.equal(replay.status, 409, 'activated provision cannot replay');
  const revoked = await post('/api/main-workbench/harness-projection/revoke', { sessionId: 'fixture-session' });
  assert.equal(revoked.status, 200);
  const afterRevoke = await post('/api/def-tools/call', { tool: 'def.workbench.snapshot', sessionId: 'fixture-session', input: { sessionBindingId: 'fixture-axis' } });
  assert.equal(afterRevoke.status, 409, 'revoked fixture lease must fail closed');
  const afterRevokeBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(afterRevokeBind.status, 409, 'revoked fixture leases cannot continue binding');
  const afterRevokeAssert = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_session_axis',
    input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', host: 'workbench', timelineId: fixture.timelineId },
  });
  assert.equal(afterRevokeAssert.status, 409, 'revoked fixture leases cannot continue assertions');
  const afterRevokeCheckout = await post('/api/main-workbench/checkout-projection', {
    sessionBindingId: 'fixture-axis', sessionID: 'fixture-session', timelineId: fixture.timelineId,
  });
  assert.equal(afterRevokeCheckout.status, 409, 'hidden checkout reads fail after lease revocation');
  const wrongFixtureCleanup = await post('/api/def-tools/call', {
    tool: 'def.workbench.unbind_session_axis', input: { sessionBindingId: 'fixture-axis', sessionID: 'wrong-fixture-session' },
  });
  assert.equal(wrongFixtureCleanup.status, 409, 'fixture cleanup requires the exact owning session');
  const fixtureCleanup = await post('/api/def-tools/call', {
    tool: 'def.workbench.unbind_session_axis', input: { sessionBindingId: 'fixture-axis', sessionID: 'fixture-session' },
  });
  assert.equal(fixtureCleanup.status, 200, JSON.stringify(fixtureCleanup.body));
  assert.equal(repository.getHarnessFixtureSessionAxisBinding('fixture-axis'), undefined, 'fixture cleanup deletes only the special binding');

  const nonRead = await post('/api/main-workbench/harness-projection/provision', {
    mode: 'active-current-readonly', sourceSessionId: 'source-session', allowedTools: ['def_team_loadout_plan_apply'],
  });
  assert.equal(nonRead.status, 400, 'active scenario policy rejects native bindings that are not read-only');
  const activeProvision = await post('/api/main-workbench/harness-projection/provision', {
    mode: 'active-current-readonly', sourceSessionId: 'source-session', allowedTools: ['def_operator_config_preview'],
  });
  assert.equal(activeProvision.status, 201, JSON.stringify(activeProvision.body));
  const activeAuthority = { provisionToken: activeProvision.body.provisionToken, mode: 'active-current-readonly' };
  const activeAdmission = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_timeline_admission', input: { timelineId: 'source', harnessProjection: activeAuthority },
  });
  assert.equal(activeAdmission.status, 200, JSON.stringify(activeAdmission.body));
  const activeBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'active-axis', sessionID: 'active-session', host: 'workbench', timelineId: 'source', harnessProjection: activeAuthority },
  });
  assert.equal(activeBind.status, 200, JSON.stringify(activeBind.body));
  assert.equal(activeBind.body.result.binding.boundNodeId, 'source-node', 'active-current provision pins its formal binding to the committed current node');
  const activeAssert = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_session_axis',
    input: { sessionBindingId: 'active-axis', sessionID: 'active-session', host: 'workbench', timelineId: 'source', harnessProjection: activeAuthority },
  });
  assert.equal(activeAssert.status, 200, JSON.stringify(activeAssert.body));
  await post('/api/main-workbench/harness-projection/register-native', { sessionId: 'active-session', harnessCommitment: 'active-harness', agentReleaseCommitment: 'active-release' });
  const active = await post('/api/main-workbench/harness-projection/activate', { provisionToken: activeProvision.body.provisionToken, mode: 'active-current-readonly', sessionId: 'active-session' });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  const activeContinuationBind = await post('/api/def-tools/call', {
    tool: 'def.workbench.bind_session_axis',
    input: { sessionBindingId: 'active-axis', sessionID: 'active-session', host: 'workbench', timelineId: 'source' },
  });
  assert.equal(activeContinuationBind.status, 200, 'active-current continuation without a token remains the ordinary formal binding path');
  const activeContinuationAssert = await post('/api/def-tools/call', {
    tool: 'def.workbench.assert_session_axis',
    input: { sessionBindingId: 'active-axis', sessionID: 'active-session', host: 'workbench', timelineId: 'source' },
  });
  assert.equal(activeContinuationAssert.status, 200, 'active-current assertions without a token remain the ordinary formal binding path');
  const activePreview = await post('/api/def-tools/call', { tool: 'def.operator.config.preview', sessionId: 'active-session', input: {} });
  assert.notEqual(activePreview.status, 403, 'real visible Canvas policy allows its explicit read-only preview tool');
  const activeWrite = await post('/api/def-tools/call', { tool: 'def.team.selection.apply', sessionId: 'active-session', input: {} });
  assert.equal(activeWrite.status, 403, 'active current policy rejects all writes even when normal current gate passes');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  // DatabaseSync can retain a Windows handle briefly after the child exits.
  // This is test-only hygiene; never turn an otherwise successful contract
  // into a failure because the OS delayed releasing a temporary SQLite file.
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); } catch {}
}

// This boundary test deliberately fails before Interop can return a runner.
// The native runner must preserve Interop's actual rollback artifact instead
// of skipping cleanup evidence because `runner` is still null.
const runnerArtifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-runner-artifact-'));
const nativeCreateRollback = {
  attempted: true,
  projection: { attempted: true, status: 200, outcome: 'confirmed' },
  fixture: { attempted: true, status: 404, outcome: 'already-absent' },
  completed: true,
};
let unexpectedRunnerDelete = 0;
const runnerServer = http.createServer((request, response) => {
  const write = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.method === 'GET' && request.url === '/def-agent/interop/v1/status') {
    write(200, { ok: true, agent: { ready: true }, workbench: { snapshotAvailable: true } }); return;
  }
  if (request.method === 'POST' && request.url === '/def-agent/interop/v1/authorize') {
    write(201, { ok: true, token: 'runner-contract-token' }); return;
  }
  if (request.method === 'GET' && request.url === '/def-agent/interop/v1/state') {
    write(200, { ok: true, state: {} }); return;
  }
  if (request.method === 'POST' && request.url === '/def-agent/interop/v1/harness/sessions') {
    write(503, {
      ok: false,
      error: {
        code: 'BLOCKED_ENVIRONMENT',
        message: 'cold bootstrap',
        details: { rollback: nativeCreateRollback },
      },
    }); return;
  }
  if (request.method === 'DELETE' && request.url.startsWith('/def-agent/interop/v1/harness/sessions/')) {
    unexpectedRunnerDelete += 1;
  }
  write(404, { ok: false, error: { code: 'unexpected-runner-request', message: request.url } });
});
const runnerOriginalCwd = process.cwd();
const runnerOriginalUrl = process.env.DEF_INTEROP_URL;
try {
  await new Promise((resolve) => runnerServer.listen(0, '127.0.0.1', resolve));
  process.env.DEF_INTEROP_URL = `http://127.0.0.1:${runnerServer.address().port}`;
  process.chdir(runnerArtifactRoot);
  const { runNativeScenario } = await import(`${new URL('./def-harness-native-runner.mjs', import.meta.url).href}?native-create-artifact=${Date.now()}`);
  const run = await runNativeScenario({
    scenario: { id: 'native-create-artifact', version: 1, turns: [{ userText: 'verify pre-runner cleanup evidence' }] },
    cleanup: true,
  });
  assert.equal(run.status, 'BLOCKED_ENVIRONMENT');
  assert.equal(run.cleanup.source, 'interop-native-create');
  assert.equal(run.cleanup.completed, true);
  assert.deepEqual(run.cleanup.artifact, nativeCreateRollback, 'pre-runner failure records the real Interop cleanup artifact');
  assert.equal(unexpectedRunnerDelete, 0, 'no runner DELETE is fabricated before a runner is assigned');
  const artifact = JSON.parse(fs.readFileSync(path.join(runnerArtifactRoot, '.runtime', 'def-harness', 'runs', run.runId, 'native-run.json'), 'utf8'));
  assert.deepEqual(artifact.cleanup.artifact, nativeCreateRollback, 'persisted native-run artifact keeps the pre-runner cleanup evidence');
} finally {
  process.chdir(runnerOriginalCwd);
  if (runnerOriginalUrl === undefined) delete process.env.DEF_INTEROP_URL;
  else process.env.DEF_INTEROP_URL = runnerOriginalUrl;
  await new Promise((resolve) => runnerServer.close(resolve));
  try { fs.rmSync(runnerArtifactRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); } catch {}
}

process.stdout.write('[def-harness-projection-lease-contract-test] passed\n');
