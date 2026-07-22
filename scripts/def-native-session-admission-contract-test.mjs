import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createNativeSessionAdmissionGate,
  evaluateNativeSessionAdmissionObservation,
} = require('../agent/server/native-session-admission.cjs');

const gate = createNativeSessionAdmissionGate({ now: (() => { let value = 1000; return () => ++value; })() });
const first = gate.admit({ sessionID: 'native-a', idempotencyKey: 'native-a:turn-a', source: 'interop' });
assert.equal(first.kind, 'accepted');
assert.equal(gate.active('native-a'), first.entry);

const retry = gate.admit({ sessionID: 'native-a', idempotencyKey: 'native-a:turn-a', source: 'interop' });
assert.equal(retry.kind, 'idempotent', 'the same client turn must join its admitted operation');
assert.equal(retry.entry, first.entry);

assert.throws(
  () => gate.admit({ sessionID: 'native-a', idempotencyKey: 'native-a:turn-b', source: 'interop' }),
  (error) => error?.status === 409 && error?.code === 'NATIVE_SESSION_TURN_IN_PROGRESS',
  'a distinct turn must be rejected before it can reach OpenCode',
);
assert.throws(
  () => gate.admit({ sessionID: 'native-a', source: 'ui' }),
  /native-session-turn-in-progress/,
  'the UI route and interop route must share one native-session admission',
);

let observations = 0;
const terminal = await gate.watch(first.entry, async () => {
  observations += 1;
  return observations === 1 ? null : { terminal: true, reason: 'native-completed' };
}, { wait: async () => undefined });
assert.equal(terminal.reason, 'native-completed');
assert.equal(gate.active('native-a'), null, 'only an observed terminal state releases the session');

const second = gate.admit({ sessionID: 'native-a', idempotencyKey: 'native-a:turn-b', source: 'interop' });
assert.equal(second.kind, 'accepted', 'the next turn is admitted after the prior terminal state');
assert.equal(gate.release(second.entry, 'submission-failed'), true, 'a known failed submission must release its reservation');

const toolStepGate = createNativeSessionAdmissionGate({ now: () => 2000 });
const toolTurn = toolStepGate.admit({ sessionID: 'native-tools', idempotencyKey: 'native-tools:turn-a', source: 'interop' });
toolTurn.entry.baselineKnown = true;
toolTurn.entry.baselineMessageIds = new Set();
const toolStepMessages = [
  { info: { id: 'user-tools', role: 'user' } },
  {
    info: { id: 'assistant-tool-step', role: 'assistant', parentID: 'user-tools', time: { completed: 2001 } },
    parts: [{ type: 'tool', state: { status: 'completed' } }],
  },
];
let releaseNextObservation;
let firstObservationDone;
const firstObservation = new Promise((resolve) => { firstObservationDone = resolve; });
let toolObservationCount = 0;
const toolWatch = toolStepGate.watch(toolTurn.entry, async () => {
  toolObservationCount += 1;
  const observation = evaluateNativeSessionAdmissionObservation(toolTurn.entry, {
    statuses: toolObservationCount === 1 ? { 'native-tools': { type: 'busy' } } : {},
    messages: toolStepMessages,
    now: 2001 + toolObservationCount,
    startTimeoutMs: 15000,
  });
  if (toolObservationCount === 1) firstObservationDone();
  return observation;
}, { wait: () => new Promise((resolve) => { releaseNextObservation = resolve; }) });
await firstObservation;
assert.equal(toolStepGate.active('native-tools'), toolTurn.entry);
assert.throws(
  () => toolStepGate.admit({ sessionID: 'native-tools', idempotencyKey: 'native-tools:turn-b', source: 'interop' }),
  /native-session-turn-in-progress/,
  'the second turn remains rejected during a multi-step tool run',
);
releaseNextObservation();
const toolTerminal = await toolWatch;
assert.equal(toolTerminal?.terminal, true, 'idle session status is the authority that ends the multi-step user turn');
assert.equal(toolStepGate.active('native-tools'), null, 'the watcher releases only after the authoritative idle observation');
assert.equal(toolStepGate.admit({ sessionID: 'native-tools', idempotencyKey: 'native-tools:turn-b', source: 'interop' }).kind, 'accepted');

const unstartedGate = createNativeSessionAdmissionGate({ now: () => 3000 });
const unstarted = unstartedGate.admit({ sessionID: 'native-unstarted', source: 'interop' });
unstarted.entry.baselineKnown = true;
unstarted.entry.baselineMessageIds = new Set();
assert.equal(
  evaluateNativeSessionAdmissionObservation(unstarted.entry, {
    statuses: {},
    messages: [{ info: { id: 'user-visible', role: 'user' } }],
    now: 3000 + 15000,
    startTimeoutMs: 15000,
  }),
  null,
  'a visible user message without observed busy state must not be released by the start timeout',
);

const serverSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
const proxyStart = serverSource.indexOf('async function proxyOpenCodeRequest');
const proxyEnd = serverSource.indexOf('async function readNativeInteropTranscript', proxyStart);
const proxySource = serverSource.slice(proxyStart, proxyEnd);
assert(proxyStart >= 0 && proxyEnd > proxyStart, 'the native OpenCode proxy must remain present');
assert.match(serverSource, /createNativeSessionAdmissionGate/,
  'the sidecar must instantiate the shared native-session gate');
assert.match(proxySource, /nativeSessionAdmission\.admit\(/,
  'UI session messages must acquire the shared admission before proxying');
assert.match(proxySource, /scheduleNativeSessionAdmissionWatch\(/,
  'direct async prompt ingress must retain admission until native completion');
assert.match(serverSource, /evaluateNativeSessionAdmissionObservation\(/,
  'the sidecar watcher must use the status-aware turn-terminal evaluator');
assert.match(serverSource, /sendNativeInteropPrompt[\s\S]*nativeSessionAdmission\.admit\(/,
  'interop prompts must acquire that same admission before prompt_async');
assert.match(serverSource, /releaseSession\(sessionID, 'native-abort'\)/,
  'a confirmed native abort must release the admission');

console.log('DEF native session admission contract: PASS (shared single-flight rejects cross-turn overlap and releases only on terminal evidence)');
