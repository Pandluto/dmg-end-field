import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');

function writeJson(response, status, payload) {
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

function boundedResponse(delayMs, options, body) {
  const timeoutMs = Number(options.timeoutMs ?? 1000);
  return new Promise((resolve, reject) => {
    const responseTimer = setTimeout(() => {
      clearTimeout(timeoutTimer);
      resolve(body);
    }, delayMs);
    const timeoutTimer = setTimeout(() => {
      clearTimeout(responseTimer);
      reject(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

let transcriptDelayMs = 0;
let questionsDelayMs = 0;
const observationCalls = [];
const protocol = createDefCodexInteropProtocol({
  profile: 'development',
  baseUrl: 'http://127.0.0.1:0',
  sidecarUrl: 'http://sidecar.invalid',
  snapshotUrl: 'http://snapshot.invalid',
  nativeInteropObservationTimeoutMs: 1500,
  observerMaxAttempts: 1,
  observerPollMs: 60000,
  writeJson,
  writeSse() {},
  writeSseHeaders() {},
  async fetchJson(url, options = {}) {
    if (url.includes('interop-transcript')) {
      observationCalls.push({ route: 'transcript', options: { ...options } });
      return boundedResponse(transcriptDelayMs, options, { status: 200, body: { ok: true, messages: [] } });
    }
    if (url.includes('interop-questions')) {
      observationCalls.push({ route: 'questions', options: { ...options } });
      return boundedResponse(questionsDelayMs, options, { status: 200, body: { ok: true, questions: [] } });
    }
    if (url.endsWith('/health')) return { status: 200, body: { ok: true } };
    return { status: 200, body: { ok: true, snapshot: { checkout: { id: 'node-a' } } } };
  },
  async postJson(url, body) {
    if (url.endsWith('/interop-prompt')) {
      return { status: 202, body: { ok: true, providerVisibleMessages: [{ role: 'user', text: body.rawUserText }] } };
    }
    return { status: 200, body: { ok: true } };
  },
});

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  if (!(await protocol.handle(request, response, requestUrl, readBody))) writeJson(response, 404, { ok: false });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const authorization = await (await fetch(`${baseUrl}/def-agent/interop/v1/authorize`, { method: 'POST' })).json();
  const headers = { authorization: `Bearer ${authorization.token}`, 'content-type': 'application/json' };
  await fetch(`${baseUrl}/def-agent/interop/v1/ui/consumer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: 'workbench', sessionId: 'native-slow-transcript', consumerId: 'slow-transcript-ui', renderSecret: 'slow-transcript-secret' }),
  });
  const accepted = await fetch(`${baseUrl}/def-agent/interop/v1/turns`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rawUserText: '看看当前记录', clientTurnId: 'slow-transcript-turn', ingressMode: 'pure-blackbox' }),
  });
  assert.equal(accepted.status, 202);

  transcriptDelayMs = 1100;
  const transcriptStartedAt = Date.now();
  const transcript = await fetch(`${baseUrl}/def-agent/interop/v1/sessions/native-slow-transcript/transcript`, { headers });
  assert.equal(transcript.status, 200, 'a native transcript slower than the one-second generic GET budget remains readable');
  assert(Date.now() - transcriptStartedAt >= 1000, 'the contract exercised a transcript response slower than one second');
  assert.equal((await transcript.json()).ok, true);
  const successfulTranscriptCall = observationCalls.at(-1);
  assert.deepEqual(successfulTranscriptCall, {
    route: 'transcript',
    options: { timeoutMs: 1500, retries: 0 },
  }, 'native transcript observation gets a route-local, non-retrying timeout budget');

  questionsDelayMs = 1100;
  const questions = await fetch(`${baseUrl}/def-agent/interop/v1/sessions/native-slow-transcript/questions`, { headers });
  assert.equal(questions.status, 200, 'the companion native question observation shares the bounded budget');
  assert.equal((await questions.json()).ok, true);
  assert.deepEqual(observationCalls.at(-1), {
    route: 'questions',
    options: { timeoutMs: 1500, retries: 0 },
  });

  const callsBeforeTimeout = observationCalls.length;
  transcriptDelayMs = 1600;
  const timedOutTranscript = await fetch(`${baseUrl}/def-agent/interop/v1/sessions/native-slow-transcript/transcript`, { headers });
  assert.equal(timedOutTranscript.status, 502, 'the transcript observation has a finite upper bound');
  assert.equal((await timedOutTranscript.json()).error.code, 'native-transcript-observation-unavailable',
    'a timed-out transcript fails closed instead of returning a fabricated partial record');
  assert.equal(observationCalls.length, callsBeforeTimeout + 1,
    'the long observation does not multiply into hidden retries');

  const electronMainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const persistedRouteStart = electronMainSource.indexOf("requestUrl.pathname === '/def-agent/chat/persisted-sessions'");
  const persistedRouteEnd = electronMainSource.indexOf("requestUrl.pathname === '/def-agent/native-sessions/cleanup'", persistedRouteStart);
  const persistedRouteSource = electronMainSource.slice(persistedRouteStart, persistedRouteEnd);
  assert.match(electronMainSource, /async function fetchJsonUrl\(url, options = \{\}\) \{[\s\S]*?timeoutMs: options\.timeoutMs \?\? 1000/,
    'ordinary Electron GETs retain their one-second default budget');
  assert.match(electronMainSource, /const PERSISTED_DEF_SESSION_LIST_TIMEOUT_MS = 30000/,
    'persisted-session discovery retains its separately documented allowance');
  assert.match(persistedRouteSource, /timeoutMs: PERSISTED_DEF_SESSION_LIST_TIMEOUT_MS,[\s\S]*?retries: 0/,
    'persisted-session discovery remains the only Shell GET route with its own non-retrying budget');
  const runtimeSource = fs.readFileSync(new URL('../agent/runtime/def-codex-interop.cjs', import.meta.url), 'utf8');
  assert.match(runtimeSource, /const NATIVE_INTEROP_OBSERVATION_TIMEOUT_MS = 30000/,
    'production native observation still has an explicit upper bound');

  console.log('DEF Interop transcript timeout contract: PASS (slow native observations are bounded and route-scoped)');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
