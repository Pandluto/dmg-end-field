import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = String(process.env.DEF_INTEROP_URL || 'http://127.0.0.1:31457').replace(/\/$/, '');
const runtimeRoot = path.resolve(process.cwd(), '.runtime/def-harness');

function error(code, message, detail = {}) { return Object.assign(new Error(message), { code, detail }); }
function writeRun(run) {
  const directory = path.join(runtimeRoot, 'runs', run.runId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'native-run.json'), `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
}
async function request(method, pathname, body, token = '') {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw error(payload?.error?.code || `HTTP_${response.status}`, payload?.error?.message || payload?.error || `Interop request failed: ${response.status}`, { status: response.status, payload });
  return payload;
}
async function authorize() { return (await request('POST', '/def-agent/interop/v1/authorize')).token; }
async function observeEvents(sessionId, cursor, token, milliseconds = 900) {
  const response = await fetch(`${baseUrl}/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/events?cursor=${encodeURIComponent(cursor || 0)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw error('ERROR_PROTOCOL', 'Could not subscribe to native turn events.', { status: response.status });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let raw = '';
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())));
    const chunk = await Promise.race([reader.read(), timeout]);
    if (!chunk || chunk.done) break;
    raw += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  const events = []; let event = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) { try { events.push({ source: 'interop', event, ...JSON.parse(line.slice(5).trim()) }); } catch {} }
  }
  return events;
}
function terminal(turn) { return ['completed', 'stopped', 'timeout', 'provider-error', 'bridge-error', 'max-step'].includes(turn?.status); }
function redactPublic(value) { return JSON.parse(JSON.stringify(value, (key, item) => /authorization|token|secret|evaluator/i.test(key) ? '[redacted]' : item)); }
function textOf(message) { return (message?.parts || []).filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n'); }
function protocolFacts(messages, prompt) {
  const user = messages.find((message) => message?.info?.role === 'user' && textOf(message) === prompt) || null;
  const nativeUserMessageId = user?.info?.id || null;
  const replies = nativeUserMessageId
    ? messages.filter((message) => message?.info?.role === 'assistant' && message?.info?.parentID === nativeUserMessageId)
    : [];
  const toolEvents = replies.flatMap((message) => (message.parts || [])
    .filter((part) => part?.type === 'tool')
    .map((part) => ({ source: 'interop', messageId: message.info?.id || null, callId: part.callID || null, tool: part.tool || null, state: part.state || null })));
  return { nativeUserMessageId, assistantMessageIds: replies.map((message) => message.info?.id).filter(Boolean), toolEvents };
}

export async function runNativeScenario({ scenario, harnessSelector = 'stable', cleanup = true, timeoutMs = 90000 } = {}) {
  if (!scenario?.id || !Array.isArray(scenario.turns) || !scenario.turns.length) throw error('HARNESS_SCENARIO_INVALID', 'Native Scenario requires a scenario id and user turns.');
  const runId = `native-harness-run-${crypto.randomUUID()}`;
  const startedAt = Date.now(); let token = ''; let runner = null;
  const run = { kind: 'DefHarnessNativeScenarioRunV1', runId, scenarioId: scenario.id, scenarioVersion: Number(scenario.version || 1), selector: harnessSelector, createdAt: startedAt, sources: ['harness'], status: 'INCOMPLETE', turns: [], events: [], questions: [], cleanup: { requested: cleanup, completed: false } };
  try {
    const status = await request('GET', '/def-agent/interop/v1/status');
    run.readiness = { source: 'interop', status };
    if (!status.agent?.ready) throw error('BLOCKED_ENVIRONMENT', 'DEF sidecar is not ready.');
    if (scenario.requiresSnapshot === true && status.workbench?.snapshotAvailable !== true) {
      throw error('BLOCKED_ENVIRONMENT', 'This Scenario requires an available Workbench snapshot.', { code: 'snapshot-unavailable' });
    }
    token = await authorize();
    const before = await request('GET', '/def-agent/interop/v1/state', undefined, token);
    run.stateBefore = { source: 'snapshot', value: before };
    runner = (await request('POST', '/def-agent/interop/v1/harness/sessions', { harnessSelector, fixtureMode: scenario.fixtureMode || 'empty' }, token)).runner;
    run.fixture = { source: 'harness', fixtureId: runner.fixtureId, timelineId: runner.timelineId, mode: runner.fixtureMode, boundNodeId: runner.boundNodeId };
    run.session = { source: 'sidecar', sessionId: runner.sessionId, harnessBinding: runner.harnessBinding };
    let cursor = '0'; let first = true;
    for (const userTurn of scenario.turns) {
      const clientTurnId = `harness-${crypto.randomUUID()}`;
      const pathname = first
        ? '/def-agent/interop/v1/turns'
        : `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/turns`;
      const accepted = await request('POST', pathname, { protocolVersion: 1, sessionId: runner.sessionId, rawUserText: userTurn.userText, clientTurnId, ingressMode: 'pure-blackbox', harnessSelector }, token);
      const turn = { source: 'interop', accepted: accepted.turn, prompt: userTurn.userText, startedAt: Date.now(), eventCursorBefore: accepted.turn.eventCursor || cursor };
      cursor = accepted.turn.eventCursor || cursor;
      const deadline = Date.now() + timeoutMs;
      let transcript;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        transcript = await request('GET', `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/transcript`, undefined, token);
        const observed = transcript.turns?.find((item) => item.turnId === accepted.turn.turnId);
        if (terminal(observed)) { turn.terminal = { source: 'interop', ...observed }; break; }
      }
      turn.completedAt = Date.now();
      turn.transcript = { source: 'interop', messages: transcript?.transcript || [] };
      Object.assign(turn, protocolFacts(turn.transcript.messages, userTurn.userText));
      const events = await observeEvents(runner.sessionId, cursor, token);
      run.events.push(...events);
      cursor = events.at(-1)?.cursor || cursor;
      turn.eventCursorAfter = cursor;
      if (!turn.terminal) turn.terminal = { status: 'timeout', source: 'harness' };
      run.turns.push(turn); first = false;
      if (!terminal(turn.terminal)) break;
    }
    run.questions = { source: 'interop', value: await request('GET', `/def-agent/interop/v1/sessions/${encodeURIComponent(runner.sessionId)}/questions`, undefined, token) };
    run.stateAfter = { source: 'snapshot', value: await request('GET', '/def-agent/interop/v1/state', undefined, token) };
    const missing = run.turns.some((turn) => !turn.terminal || !turn.transcript?.messages?.length || !turn.accepted?.harness || !turn.nativeUserMessageId || !turn.assistantMessageIds?.length);
    const failure = run.turns.find((turn) => turn.terminal?.status !== 'completed');
    run.status = missing || failure?.terminal?.status === 'timeout' ? 'INCOMPLETE'
      : failure?.terminal?.status === 'provider-error' || failure?.terminal?.status === 'bridge-error' || failure?.terminal?.status === 'max-step' ? 'ERROR_PROTOCOL'
        : failure ? 'INCOMPLETE' : 'EXECUTED';
  } catch (caught) {
    run.error = { source: 'harness', code: caught.code || 'ERROR_PROTOCOL', message: caught.message, detail: redactPublic(caught.detail || {}) };
    run.status = caught.code === 'BLOCKED_ENVIRONMENT' ? 'BLOCKED_ENVIRONMENT' : 'ERROR_PROTOCOL';
  } finally {
    if (runner && cleanup && token) {
      try { run.cleanup.response = await request('DELETE', `/def-agent/interop/v1/harness/sessions/${encodeURIComponent(runner.sessionId)}`, undefined, token); run.cleanup.completed = true; } catch (caught) { run.cleanup.error = { code: caught.code || 'cleanup-failed', message: caught.message }; }
    }
    run.completedAt = Date.now(); writeRun(redactPublic(run));
  }
  return run;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const file = process.argv[2];
  const selector = process.argv[3] || 'stable';
  if (!file) throw new Error('Usage: def-harness-native-runner <scenario.json> [selector]');
  const scenario = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  process.stdout.write(`${JSON.stringify(await runNativeScenario({ scenario, harnessSelector: selector }), null, 2)}\n`);
}
