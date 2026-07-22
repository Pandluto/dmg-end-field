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
    info: { id: 'assistant-tool-step', role: 'assistant', parentID: 'user-tools', finish: 'tool-calls', time: { completed: 2001 } },
    parts: [{ type: 'tool', state: { status: 'completed' } }, { type: 'text', text: 'intermediate tool summary' }],
  },
];
assert.equal(evaluateNativeSessionAdmissionObservation(toolTurn.entry, {
  statuses: { 'native-tools': { type: 'busy' } },
  messages: toolStepMessages,
  now: 2001,
  startTimeoutMs: 15000,
}), null);
assert.equal(toolStepGate.active('native-tools'), toolTurn.entry);
assert.throws(
  () => toolStepGate.admit({ sessionID: 'native-tools', idempotencyKey: 'native-tools:turn-b', source: 'interop' }),
  /native-session-turn-in-progress/,
  'the second turn remains rejected during a multi-step tool run',
);
assert.equal(evaluateNativeSessionAdmissionObservation(toolTurn.entry, {
  statuses: {},
  messages: toolStepMessages,
  now: 2002,
  startTimeoutMs: 15000,
}), null, 'a fast idle status plus a completed tool step is not terminal evidence');
assert.equal(toolStepGate.active('native-tools'), toolTurn.entry, 'the fast-failure observation must keep the gate');

const finalMessages = [...toolStepMessages, {
  info: { id: 'assistant-final', role: 'assistant', parentID: 'user-tools', finish: 'stop', time: { completed: 2003 } },
  parts: [{ type: 'text', text: 'done' }],
}];
assert.deepEqual(evaluateNativeSessionAdmissionObservation(toolTurn.entry, {
  statuses: {},
  messages: finalMessages,
  now: 2003,
  startTimeoutMs: 15000,
}), { terminal: true, reason: 'native-session-idle-after-final' });
assert.equal(toolStepGate.release(toolTurn.entry, 'native-session-idle-after-final'), true);
assert.equal(toolStepGate.admit({ sessionID: 'native-tools', idempotencyKey: 'native-tools:turn-b', source: 'interop' }).kind, 'accepted');

const transcriptOnlyGate = createNativeSessionAdmissionGate({ now: () => 4000 });
const transcriptOnly = transcriptOnlyGate.admit({ sessionID: 'native-transcript-only', source: 'interop' });
transcriptOnly.entry.baselineKnown = true;
transcriptOnly.entry.baselineMessageIds = new Set();
const transcriptToolStep = [
  { info: { id: 'user-transcript', role: 'user' } },
  { info: { id: 'assistant-transcript-tool', role: 'assistant', parentID: 'user-transcript', finish: 'tool-calls', time: { completed: 4001 } }, parts: [{ type: 'tool', state: { status: 'completed' } }, { type: 'text', text: 'intermediate tool summary' }] },
];
assert.equal(evaluateNativeSessionAdmissionObservation(transcriptOnly.entry, {
  statuses: null,
  messages: transcriptToolStep,
  now: 4001,
}), null, 'a status outage cannot release on a completed tool step alone');
assert.deepEqual(evaluateNativeSessionAdmissionObservation(transcriptOnly.entry, {
  statuses: null,
  messages: [...transcriptToolStep, { info: { id: 'assistant-transcript-final', role: 'assistant', parentID: 'user-transcript', finish: 'stop', time: { completed: 4002 } }, parts: [{ type: 'text', text: 'final' }] }],
  now: 4002,
}), { terminal: true, reason: 'native-assistant-final-transcript' }, 'a correlated final transcript can recover a missing status endpoint');

const errorOnlyGate = createNativeSessionAdmissionGate({ now: () => 5000 });
const errorOnly = errorOnlyGate.admit({ sessionID: 'native-error-only', source: 'interop' });
errorOnly.entry.baselineKnown = true;
errorOnly.entry.baselineMessageIds = new Set();
assert.deepEqual(evaluateNativeSessionAdmissionObservation(errorOnly.entry, {
  statuses: null,
  messages: [
    { info: { id: 'user-error', role: 'user' } },
    { info: { id: 'assistant-error', role: 'assistant', parentID: 'user-error', error: 'provider failed' }, parts: [] },
  ],
  now: 5001,
}), { terminal: true, reason: 'native-assistant-error-transcript' });

const lostObserverGate = createNativeSessionAdmissionGate({ now: () => 6000 });
const lostObserver = lostObserverGate.admit({ sessionID: 'native-lost-observer', source: 'interop' });
assert.equal(evaluateNativeSessionAdmissionObservation(lostObserver.entry, {
  statuses: null, messages: null, now: 6000,
}), null, 'a single lost observation is not completion evidence');
assert.equal(evaluateNativeSessionAdmissionObservation(lostObserver.entry, {
  statuses: null, messages: null, now: 999999,
}), null, 'a prolonged status/transcript outage remains acceptance-unknown until explicit abort/delete or evidence recovers');

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
  'a single idle observation is not enough to release a visible user turn',
);
assert.deepEqual(
  evaluateNativeSessionAdmissionObservation(unstarted.entry, {
    statuses: {},
    messages: [{ info: { id: 'user-visible', role: 'user' } }],
    now: 3000 + 30000,
    startTimeoutMs: 15000,
  }),
  { terminal: true, reason: 'native-prompt-not-started' },
  'a visible user with no busy state or assistant step releases only after status remains idle for the start timeout',
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
  'direct message and async prompt ingress must retain admission until native completion after a transport loss');
assert.match(proxySource, /await captureNativeSessionAdmissionBaseline\(admission, runtime, binding\)/,
  'both direct message and async prompt ingress capture a transcript baseline before transport');
assert.match(serverSource, /evaluateNativeSessionAdmissionObservation\(/,
  'the sidecar watcher must use the status-aware turn-terminal evaluator');
assert.match(serverSource, /retainNativePromptAdmissionForReconciliation/,
  'a prompt_async response loss must retain its admission for reconciliation');
assert.match(serverSource, /return result\('unknown'\)/,
  'the interop prompt surface must report acceptance-unknown instead of releasing on transport loss');
assert.match(serverSource, /sendNativeInteropPrompt[\s\S]*nativeSessionAdmission\.admit\(/,
  'interop prompts must acquire that same admission before prompt_async');
assert.match(serverSource, /releaseSession\(sessionID, 'native-abort'\)/,
  'a confirmed native abort must release the admission');

console.log('DEF native session admission contract: PASS (shared single-flight rejects cross-turn overlap and releases only on terminal evidence)');
