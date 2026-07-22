import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');
const { requestNativeLoopbackJson } = require('../electron/native-loopback-transport.cjs');

function writeJson(response, status, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const value = predicate();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`condition did not become true within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

const behaviorQueues = new Map();
const upstreamRequests = [];

function behaviorKey(sessionId, resource) {
  return `${sessionId}:${resource}`;
}

function enqueueBehavior(sessionId, resource, behavior) {
  const key = behaviorKey(sessionId, resource);
  const queue = behaviorQueues.get(key) || [];
  queue.push(behavior);
  behaviorQueues.set(key, queue);
}

function requestCount(sessionId, resource) {
  return upstreamRequests.filter((entry) => entry.sessionId === sessionId && entry.resource === resource).length;
}

const sidecar = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const nativeMatch = /^\/api\/native\/session\/([^/]+)\/(interop-transcript|interop-questions|interop-prompt|interop-stop)$/.exec(requestUrl.pathname);
  if (nativeMatch) {
    const sessionId = decodeURIComponent(nativeMatch[1]);
    const resource = nativeMatch[2];
    const body = request.method === 'POST' ? await readBody(request) : {};
    upstreamRequests.push({ sessionId, resource, at: Date.now(), body });
    if (resource === 'interop-prompt') {
      writeJson(response, 202, {
        ok: true,
        nativeUserMessageId: `user-${sessionId}`,
        providerVisibleMessages: [{ role: 'user', text: body.rawUserText }],
      });
      return;
    }
    if (resource === 'interop-stop') {
      writeJson(response, 200, { ok: true, reason: 'requested' });
      return;
    }
    const key = behaviorKey(sessionId, resource);
    const behavior = behaviorQueues.get(key)?.shift() || {};
    const status = behavior.status || 200;
    const responseBody = behavior.body || (resource === 'interop-transcript'
      ? { ok: true, messages: [] }
      : { ok: true, questions: [] });
    setTimeout(() => writeJson(response, status, responseBody), behavior.delayMs || 0);
    return;
  }
  if (requestUrl.pathname === '/snapshot') {
    writeJson(response, 200, { ok: true, snapshot: { checkout: { id: 'node-a' }, revision: 1 } });
    return;
  }
  if (requestUrl.pathname === '/generic-slow' || requestUrl.pathname === '/persisted-slow') {
    setTimeout(() => writeJson(response, 200, { ok: true }), 1100);
    return;
  }
  writeJson(response, 200, { ok: true, service: 'contract-sidecar' });
});

await new Promise((resolve) => sidecar.listen(0, '127.0.0.1', resolve));
const sidecarBaseUrl = `http://127.0.0.1:${sidecar.address().port}`;

async function createProtocolHarness(name, options = {}) {
  const fetchCalls = [];
  const protocol = createDefCodexInteropProtocol({
    profile: 'development',
    baseUrl: 'http://127.0.0.1:0',
    sidecarUrl: sidecarBaseUrl,
    snapshotUrl: `${sidecarBaseUrl}/snapshot`,
    nativeInteropObservationTimeoutMs: options.observationTimeoutMs,
    nativeInteropObserverDeadlineMs: options.observerDeadlineMs,
    nativeInteropObserverMaxConsecutiveFailures: options.maxConsecutiveFailures,
    observerMaxAttempts: options.observerMaxAttempts,
    observerPollMs: options.observerPollMs ?? 60000,
    writeJson,
    writeSse() {},
    writeSseHeaders() {},
    async fetchJson(url, requestOptions = {}) {
      const effectiveOptions = {
        timeoutMs: requestOptions.timeoutMs ?? 1000,
        retries: requestOptions.retries ?? 1,
      };
      fetchCalls.push({ url, options: effectiveOptions });
      return requestNativeLoopbackJson(url, effectiveOptions);
    },
    async postJson(url, payload, requestOptions = {}) {
      return requestNativeLoopbackJson(url, {
        method: 'POST',
        json: payload,
        timeoutMs: requestOptions.timeoutMs ?? 1000,
        retries: requestOptions.retries ?? 0,
      });
    },
  });
  const bridge = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (!(await protocol.handle(request, response, requestUrl, readBody))) writeJson(response, 404, { ok: false });
    } catch (error) {
      writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${bridge.address().port}`;
  const authorization = await (await fetch(`${baseUrl}/def-agent/interop/v1/authorize`, { method: 'POST' })).json();
  const headers = { authorization: `Bearer ${authorization.token}`, 'content-type': 'application/json' };
  const sessionId = `native-${name}`;
  await fetch(`${baseUrl}/def-agent/interop/v1/ui/consumer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'workbench', sessionId, consumerId: `ui-${name}`, renderSecret: `secret-${name}` }),
  });
  return {
    baseUrl,
    bridge,
    fetchCalls,
    headers,
    protocol,
    sessionId,
    async startTurn(clientTurnId = `turn-${name}`) {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}/def-agent/interop/v1/turns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawUserText: `查看 ${name}`, clientTurnId, ingressMode: 'pure-blackbox' }),
      });
      return { response, body: await response.json(), elapsedMs: Date.now() - startedAt };
    },
    read(resource) {
      return fetch(`${baseUrl}/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/${resource}`, { headers });
    },
    close() {
      return new Promise((resolve) => bridge.close(resolve));
    },
  };
}

const harnesses = [];

try {
  const slow = await createProtocolHarness('slow', { observationTimeoutMs: 1500 });
  harnesses.push(slow);
  enqueueBehavior(slow.sessionId, 'interop-transcript', { delayMs: 1100 });
  const accepted = await slow.startTurn();
  assert.equal(accepted.response.status, 202);
  assert(accepted.elapsedMs >= 1000, 'the real HTTP baseline response was slower than the generic one-second GET budget');
  assert.deepEqual(slow.fetchCalls.find((call) => call.url.includes('interop-transcript'))?.options, {
    timeoutMs: 1500,
    retries: 0,
  }, 'baseline transcript observation uses the route-local budget with zero retries');

  enqueueBehavior(slow.sessionId, 'interop-transcript', { delayMs: 1100 });
  const directStartedAt = Date.now();
  const directTranscript = await slow.read('transcript');
  assert.equal(directTranscript.status, 200, 'a direct transcript slower than one second remains readable');
  assert(Date.now() - directStartedAt >= 1000);
  assert.equal((await directTranscript.json()).ok, true);

  enqueueBehavior(slow.sessionId, 'interop-questions', { delayMs: 1100 });
  const directQuestions = await slow.read('questions');
  assert.equal(directQuestions.status, 200, 'a direct questions read slower than one second remains readable');
  assert.equal((await directQuestions.json()).ok, true);

  let callsBefore = requestCount(slow.sessionId, 'interop-transcript');
  enqueueBehavior(slow.sessionId, 'interop-transcript', { delayMs: 1600 });
  const timedOutTranscript = await slow.read('transcript');
  assert.equal(timedOutTranscript.status, 502);
  const timedOutTranscriptBody = await timedOutTranscript.json();
  assert.equal(timedOutTranscriptBody.error.code, 'native-transcript-observation-unavailable');
  assert.equal(timedOutTranscriptBody.error.details.upstreamStatus, 0);
  assert.equal(Object.hasOwn(timedOutTranscriptBody, 'transcript'), false,
    'a timed-out transcript fails closed without a fabricated empty transcript');
  assert.equal(requestCount(slow.sessionId, 'interop-transcript'), callsBefore + 1,
    'the real transport made no hidden timeout retry');

  callsBefore = requestCount(slow.sessionId, 'interop-questions');
  enqueueBehavior(slow.sessionId, 'interop-questions', { delayMs: 1600 });
  const timedOutQuestions = await slow.read('questions');
  assert.equal(timedOutQuestions.status, 502);
  assert.equal((await timedOutQuestions.json()).error.code, 'native-question-observation-unavailable');
  assert.equal(requestCount(slow.sessionId, 'interop-questions'), callsBefore + 1,
    'question observation also uses zero transport retries');

  enqueueBehavior(slow.sessionId, 'interop-transcript', {
    status: 404,
    body: { ok: false, error: { code: 'NATIVE_SESSION_NOT_FOUND', message: 'native binding missing' }, messages: [{ id: 'must-not-leak' }] },
  });
  const missingTranscript = await slow.read('transcript');
  assert.equal(missingTranscript.status, 404, 'native transcript 404 remains a 404');
  const missingBody = await missingTranscript.json();
  assert.equal(missingBody.error.code, 'native-transcript-observation-unavailable');
  assert.deepEqual(missingBody.error.details, {
    resource: 'interop-transcript',
    upstreamStatus: 404,
    upstreamCode: 'NATIVE_SESSION_NOT_FOUND',
    upstreamMessage: 'native binding missing',
  });
  assert.equal(Object.hasOwn(missingBody, 'transcript'), false);

  enqueueBehavior(slow.sessionId, 'interop-transcript', {
    status: 503,
    body: { ok: false, error: { code: 'OPENCODE_UNAVAILABLE', message: 'runtime unavailable' }, messages: [] },
  });
  const unavailableTranscript = await slow.read('transcript');
  assert.equal(unavailableTranscript.status, 502, 'all other native transcript failures collapse to the fail-closed bridge status');
  const unavailableBody = await unavailableTranscript.json();
  assert.equal(unavailableBody.error.details.upstreamStatus, 503);
  assert.equal(unavailableBody.error.details.upstreamCode, 'OPENCODE_UNAVAILABLE');
  assert.equal(Object.hasOwn(unavailableBody, 'transcript'), false);

  callsBefore = requestCount(slow.sessionId, 'interop-transcript');
  enqueueBehavior(slow.sessionId, 'interop-transcript', { delayMs: 200 });
  const concurrentReads = await Promise.all([slow.read('transcript'), slow.read('transcript')]);
  assert.deepEqual(concurrentReads.map((response) => response.status), [200, 200]);
  assert.equal(requestCount(slow.sessionId, 'interop-transcript'), callsBefore + 1,
    'concurrent direct readers share one in-flight native observation');

  const baselineTimeout = await createProtocolHarness('baseline-timeout', { observationTimeoutMs: 120 });
  harnesses.push(baselineTimeout);
  enqueueBehavior(baselineTimeout.sessionId, 'interop-transcript', { delayMs: 250 });
  const baselineTimeoutStart = await baselineTimeout.startTurn();
  assert.equal(baselineTimeoutStart.response.status, 202,
    'an unavailable baseline remains unknown and does not resend or fabricate the native prompt');
  assert.equal(requestCount(baselineTimeout.sessionId, 'interop-transcript'), 1,
    'baseline timeout performs one bounded request with zero retries');
  assert.deepEqual(baselineTimeout.fetchCalls.find((call) => call.url.includes('interop-transcript'))?.options, {
    timeoutMs: 120,
    retries: 0,
  });

  const observerSlow = await createProtocolHarness('observer-slow', {
    observationTimeoutMs: 1500,
    observerDeadlineMs: 5000,
    observerMaxAttempts: 3,
    observerPollMs: 0,
  });
  harnesses.push(observerSlow);
  enqueueBehavior(observerSlow.sessionId, 'interop-transcript', {});
  enqueueBehavior(observerSlow.sessionId, 'interop-transcript', {
    delayMs: 1100,
    body: {
      ok: true,
      messages: [
        { info: { id: `user-${observerSlow.sessionId}`, role: 'user' }, parts: [{ type: 'text', text: '查看 observer-slow' }] },
        { info: { id: 'assistant-observer-slow', role: 'assistant', parentID: `user-${observerSlow.sessionId}`, finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: '完成' }] },
      ],
    },
  });
  enqueueBehavior(observerSlow.sessionId, 'interop-questions', {
    delayMs: 1100,
    body: { ok: true, questions: [{ requestId: 'question-slow', status: 'resolved', questions: [], answers: [], updatedAt: Date.now() }] },
  });
  await observerSlow.startTurn();
  await waitFor(() => observerSlow.protocol.audit.find((entry) => entry.action === 'turn.completed'), 2500);
  assert.equal(requestCount(observerSlow.sessionId, 'interop-transcript'), 2,
    'observer made one slow transcript read after the baseline');
  assert.equal(requestCount(observerSlow.sessionId, 'interop-questions'), 1,
    'observer made one paired slow question read');
  assert(observerSlow.fetchCalls.filter((call) => /interop-(?:transcript|questions)/.test(call.url))
    .every((call) => call.options.timeoutMs === 1500 && call.options.retries === 0));

  const observerFailure = await createProtocolHarness('observer-failure', {
    observationTimeoutMs: 100,
    observerDeadlineMs: 2000,
    maxConsecutiveFailures: 2,
    observerMaxAttempts: 10,
    observerPollMs: 0,
  });
  harnesses.push(observerFailure);
  enqueueBehavior(observerFailure.sessionId, 'interop-transcript', {});
  enqueueBehavior(observerFailure.sessionId, 'interop-transcript', { delayMs: 250 });
  enqueueBehavior(observerFailure.sessionId, 'interop-transcript', { delayMs: 250 });
  enqueueBehavior(observerFailure.sessionId, 'interop-questions', { delayMs: 250 });
  enqueueBehavior(observerFailure.sessionId, 'interop-questions', { delayMs: 250 });
  await observerFailure.startTurn();
  const failedObservation = await waitFor(
    () => observerFailure.protocol.audit.find((entry) => entry.result === 'native-turn-observation-unavailable'),
    1000,
  );
  assert.equal(failedObservation.action, 'turn.timeout');
  assert.equal(requestCount(observerFailure.sessionId, 'interop-transcript'), 3,
    'baseline plus exactly two consecutive failed observer reads reach a terminal state');
  assert.equal(requestCount(observerFailure.sessionId, 'interop-questions'), 2);

  const observerDeadline = await createProtocolHarness('observer-deadline', {
    observationTimeoutMs: 100,
    observerDeadlineMs: 250,
    observerMaxAttempts: 100,
    observerPollMs: 40,
  });
  harnesses.push(observerDeadline);
  const deadlineStartedAt = Date.now();
  await observerDeadline.startTurn();
  const deadlineAudit = await waitFor(
    () => observerDeadline.protocol.audit.find((entry) => entry.result === 'native-turn-observation-deadline'),
    1000,
  );
  assert(deadlineAudit.at - deadlineStartedAt <= 500,
    'the observer obeys an absolute end-to-end deadline rather than multiplying request timeouts by attempt count');

  const sharedDeadline = await createProtocolHarness('shared-deadline', {
    observationTimeoutMs: 500,
    observerDeadlineMs: 250,
    observerMaxAttempts: 100,
    observerPollMs: 100,
  });
  harnesses.push(sharedDeadline);
  await sharedDeadline.startTurn();
  enqueueBehavior(sharedDeadline.sessionId, 'interop-transcript', { delayMs: 400 });
  const longDirectRead = sharedDeadline.read('transcript');
  const sharedDeadlineStartedAt = Date.now();
  const sharedDeadlineAudit = await waitFor(
    () => sharedDeadline.protocol.audit.find((entry) => entry.result === 'native-turn-observation-deadline'),
    1000,
  );
  assert(sharedDeadlineAudit.at - sharedDeadlineStartedAt <= 400,
    'joining a longer direct-read flight cannot extend the observer beyond its own remaining deadline');
  assert.equal((await longDirectRead).status, 200);
  assert.equal(requestCount(sharedDeadline.sessionId, 'interop-transcript'), 2,
    'the baseline plus one shared upstream flight serve both observer and direct reader');

  const ordinaryStartedAt = Date.now();
  await assert.rejects(
    requestNativeLoopbackJson(`${sidecarBaseUrl}/generic-slow`, { timeoutMs: 1000, retries: 0 }),
    /request timeout after 1000ms/,
  );
  assert(Date.now() - ordinaryStartedAt < 2000, 'the ordinary GET behavior remains bounded near one second');
  const persisted = await requestNativeLoopbackJson(`${sidecarBaseUrl}/persisted-slow`, { timeoutMs: 30000, retries: 0 });
  assert.equal(persisted.status, 200, 'the persisted-session allowance admits the same legitimate 1.1 second response');

  const electronMainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const persistedRouteStart = electronMainSource.indexOf("requestUrl.pathname === '/def-agent/chat/persisted-sessions'");
  const persistedRouteEnd = electronMainSource.indexOf("requestUrl.pathname === '/def-agent/native-sessions/cleanup'", persistedRouteStart);
  const persistedRouteSource = electronMainSource.slice(persistedRouteStart, persistedRouteEnd);
  assert.match(electronMainSource, /async function fetchJsonUrl\(url, options = \{\}\) \{[\s\S]*?timeoutMs: options\.timeoutMs \?\? 1000/,
    'the real Electron ordinary-GET callback remains wired to the behaviorally checked one-second boundary');
  assert.match(electronMainSource, /const PERSISTED_DEF_SESSION_LIST_TIMEOUT_MS = 30000/);
  assert.match(persistedRouteSource, /timeoutMs: PERSISTED_DEF_SESSION_LIST_TIMEOUT_MS,[\s\S]*?retries: 0/,
    'persisted-session discovery retains its behaviorally checked non-retrying allowance');
  const runtimeSource = fs.readFileSync(new URL('../agent/runtime/def-codex-interop.cjs', import.meta.url), 'utf8');
  assert.match(runtimeSource, /const NATIVE_INTEROP_OBSERVATION_TIMEOUT_MS = 5000/);
  assert.match(runtimeSource, /const NATIVE_INTEROP_OBSERVER_DEADLINE_MS = 90000/);

  console.log('DEF Interop transcript timeout contract: PASS (real delayed transport, fail-closed errors, single-flight, and bounded observer)');
} finally {
  for (const harness of harnesses.reverse()) await harness.close();
  await new Promise((resolve) => sidecar.close(resolve));
}
