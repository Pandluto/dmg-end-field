import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDefCodexInteropProtocol } = require('../agent/runtime/def-codex-interop.cjs');

function writeJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function writeSseHeaders(response) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
}

function writeSse(response, type, payload) {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

let promptCalls = 0;
let losePromptResponse = false;
let abortedMessages = [];
let questionRecords = [];
const protocol = createDefCodexInteropProtocol({
  profile: 'development',
  baseUrl: 'http://127.0.0.1:0',
  sidecarUrl: 'http://sidecar.invalid',
  snapshotUrl: 'http://snapshot.invalid',
  writeJson,
  writeSse,
  writeSseHeaders,
  async fetchJson(url) {
    if (url.endsWith('/health')) return { status: 200, body: { ok: true, service: 'fake-sidecar' } };
    if (url.includes('interop-transcript')) return { status: 200, body: { ok: true, messages: abortedMessages } };
    if (url.includes('interop-questions')) return { status: 200, body: { ok: true, questions: questionRecords } };
    return { status: 200, body: { ok: true, snapshot: { checkout: { id: 'node-a' }, revision: 7, selectedCharacters: [{ id: 'a', name: 'A' }] } } };
  },
  async postJson(url, body) {
    if (url.endsWith('/interop-prompt')) {
      promptCalls += 1;
      if (losePromptResponse) throw new Error('simulated bridge-to-sidecar response loss');
      if (body.rawUserText === '这个怎么样') {
        abortedMessages = [{
          info: { time: { completed: Date.now() } },
          parts: [{ type: 'tool', id: 'tool-a', callID: 'call-a', tool: 'def_workbench_context', state: { status: 'completed', input: { nodeId: 'node-a', token: 'must-not-leak' }, output: { revision: 7 } } }],
        }];
        questionRecords = [{ requestId: 'question-a', status: 'open', questions: [{ header: '选择范围', question: '要查看当前排轴还是草稿？', options: [{ label: '当前排轴', description: '只读' }, { label: '草稿', description: '不应用' }] }], createdAt: Date.now(), updatedAt: Date.now() }];
      }
      if (body.rawUserText === '再试一次') {
        abortedMessages = [{ info: { time: { completed: Date.now() }, error: 'Provider network timeout' }, parts: [] }];
        questionRecords = [];
      }
      return { status: 202, body: { ok: true, providerVisibleMessages: [{ role: 'user', text: body.rawUserText }] } };
    }
    if (url.endsWith('/interop-stop')) {
      abortedMessages = [{ info: { time: { completed: Date.now() }, error: 'MessageAbortedError: Aborted' }, parts: [] }];
      return { status: 200, body: { ok: true, reason: 'requested' } };
    }
    return { status: 200, body: { ok: true, reason: 'requested' } };
  },
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (!(await protocol.handle(request, response, url, readBody))) writeJson(response, 404, { ok: false });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const status = await (await fetch(`${base}/def-agent/interop/v1/status`)).json();
  assert.equal(status.protocolVersion, 1);
  assert.equal(status.workbench.uiConnected, false);

  const evilAuthorize = await fetch(`${base}/def-agent/interop/v1/authorize`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(evilAuthorize.status, 403);
  const publicState = await fetch(`${base}/def-agent/interop/v1/state`, { headers: { origin: 'https://evil.example' } });
  assert.equal(publicState.status, 403);

  const authorization = await (await fetch(`${base}/def-agent/interop/v1/authorize`, { method: 'POST' })).json();
  const headers = { authorization: `Bearer ${authorization.token}`, 'content-type': 'application/json' };
  const rejected = await fetch(`${base}/def-agent/interop/v1/turns`, { method: 'POST', headers, body: JSON.stringify({ rawUserText: '这个怎么样', clientTurnId: 'no-ui' }) });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error.code, 'ui-consumer-unavailable');

  const renderSecret = 'render-secret-a';
  await fetch(`${base}/def-agent/interop/v1/ui/consumer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: 'workbench', sessionId: 'native-a', consumerId: 'ui-a', renderSecret }) });
  const request = { rawUserText: '这个怎么样', clientTurnId: 'turn-a', ingressMode: 'pure-blackbox' };
  const first = await fetch(`${base}/def-agent/interop/v1/turns`, { method: 'POST', headers, body: JSON.stringify(request) });
  assert.equal(first.status, 202);
  const firstPayload = await first.json();
  assert.equal(firstPayload.turn.rawUserText, firstPayload.turn.providerVisibleUserText);
  assert.equal(promptCalls, 1);
  const retry = await (await fetch(`${base}/def-agent/interop/v1/turns`, { method: 'POST', headers, body: JSON.stringify(request) })).json();
  assert.equal(retry.idempotent, true);
  assert.equal(retry.turn.turnId, firstPayload.turn.turnId);
  assert.equal(promptCalls, 1);

  const evilClose = await fetch(`${base}/def-agent/interop/v1/ui/consumer/close`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ consumerId: 'ui-a', renderSecret, sessionId: 'native-a' }),
  });
  assert.equal(evilClose.status, 403);

  losePromptResponse = true;
  const uncertain = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns`, {
    method: 'POST', headers,
    body: JSON.stringify({ rawUserText: '请保留当前草稿', clientTurnId: 'turn-uncertain', ingressMode: 'pure-blackbox' }),
  })).json();
  const callsAfterUncertain = promptCalls;
  const uncertainRetry = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns`, {
    method: 'POST', headers,
    body: JSON.stringify({ rawUserText: '请保留当前草稿', clientTurnId: 'turn-uncertain', ingressMode: 'pure-blackbox' }),
  })).json();
  losePromptResponse = false;
  assert.equal(uncertain.turn.submissionState, 'unknown');
  assert.equal(uncertainRetry.idempotent, true);
  assert.equal(promptCalls, callsAfterUncertain);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const questions = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/questions`, { headers })).json();
  assert.equal(questions.questions[0].requestId, 'question-a');
  assert.equal(questions.questions[0].questions[0].options[1].label, '草稿');
  await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/questions`, { headers })).json();

  const failed = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns`, {
    method: 'POST', headers,
    body: JSON.stringify({ rawUserText: '再试一次', clientTurnId: 'turn-provider-error', ingressMode: 'pure-blackbox' }),
  })).json();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const failedTranscript = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/transcript`, { headers })).json();
  assert.equal(failedTranscript.turns.find((turn) => turn.turnId === failed.turn.turnId)?.status, 'provider-error');
  const failedStop = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns/${encodeURIComponent(failed.turn.turnId)}/stop`, {
    method: 'POST', headers,
  })).json();
  assert.equal(failedStop.status, 'already-provider-error');

  const stoppedStart = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns`, {
    method: 'POST', headers,
    body: JSON.stringify({ rawUserText: '请停止这个只读问候', clientTurnId: 'turn-stop', ingressMode: 'pure-blackbox' }),
  })).json();
  const stopped = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/turns/${encodeURIComponent(stoppedStart.turn.turnId)}/stop`, {
    method: 'POST', headers,
  })).json();
  assert.equal(stopped.status, 'stopped');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const stoppedTranscript = await (await fetch(`${base}/def-agent/interop/v1/sessions/native-a/transcript`, { headers })).json();
  assert.equal(stoppedTranscript.turns.find((turn) => turn.turnId === stoppedStart.turn.turnId)?.status, 'stopped');

  await fetch(`${base}/def-agent/interop/v1/ui/consumer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: 'workbench', sessionId: 'native-b', consumerId: 'ui-b', renderSecret: 'render-secret-b' }) });
  const activeConsumerTurn = await (await fetch(`${base}/def-agent/interop/v1/turns`, {
    method: 'POST', headers,
    body: JSON.stringify({ rawUserText: '看看当前会话', clientTurnId: 'turn-current-consumer', ingressMode: 'pure-blackbox' }),
  })).json();
  assert.equal(activeConsumerTurn.turn.sessionId, 'native-b');
  const stream = await fetch(`${base}/def-agent/interop/v1/sessions/native-a/events?cursor=9999`, { headers });
  const streamReader = stream.body.getReader();
  protocol.emit('completed', { testRunId: 'run-b', sessionId: 'native-b', turnId: 'turn-b', clientTurnId: 'turn-b' });
  const chunks = [];
  const cancelStream = setTimeout(() => { void streamReader.cancel(); }, 100);
  for (;;) {
    const { done, value } = await streamReader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }
  clearTimeout(cancelStream);
  assert.doesNotMatch(chunks.join(''), /native-b/);

  const replay = await fetch(`${base}/def-agent/interop/v1/sessions/native-a/events?cursor=0`, { headers });
  const replayReader = replay.body.getReader();
  let replayText = '';
  for (let index = 0; index < 8 && !replayText.includes('event: provider-error'); index += 1) {
    const { done, value } = await replayReader.read();
    if (done) break;
    replayText += new TextDecoder().decode(value);
  }
  await replayReader.cancel();
  assert.match(replayText, /event: ui-prompt-consumed/);
  assert.match(replayText, /\"uiEventId\":\"[0-9a-f-]{36}\"/);
  assert.match(replayText, /event: tool-result/);
  assert.match(replayText, /\"tool\":\"def_workbench_context\"/);
  assert.match(replayText, /\"token\":\"\[redacted\]\"/);
  assert.match(replayText, /event: permission/);
  assert.equal((replayText.match(/event: permission\n/g) || []).length, 1);
  assert.match(replayText, /event: provider-error/);

  const state = await (await fetch(`${base}/def-agent/interop/v1/state`, { headers })).json();
  assert.deepEqual(state.state.selectedOperators, [{ id: 'a', name: 'A' }]);
  assert.equal(Object.hasOwn(state.state, 'snapshot'), false);

  let releaseResponse;
  const release = createDefCodexInteropProtocol({
    profile: 'release', baseUrl: 'http://127.0.0.1:0', sidecarUrl: 'http://sidecar.invalid', snapshotUrl: 'http://snapshot.invalid',
    writeJson(_response, status, payload) { releaseResponse = { status, payload }; }, writeSse, writeSseHeaders,
    async fetchJson() { return { status: 200, body: { ok: true } }; }, async postJson() { throw new Error('release must not call sidecar'); },
  });
  await release.handle({ method: 'POST', headers: {} }, {}, new URL('http://127.0.0.1/def-agent/interop/v1/turns'), async () => ({ rawUserText: '看看这个', clientTurnId: 'release-denied' }));
  assert.equal(releaseResponse.status, 403);
  assert.equal(releaseResponse.payload.error.code, 'teacher-ingress-disabled');
  console.log('def-codex-interop-check: ok');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
