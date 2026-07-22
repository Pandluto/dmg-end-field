import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNativeSessionAdmissionGate } = require('../agent/server/native-session-admission.cjs');

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
assert.match(serverSource, /sendNativeInteropPrompt[\s\S]*nativeSessionAdmission\.admit\(/,
  'interop prompts must acquire that same admission before prompt_async');
assert.match(serverSource, /releaseSession\(sessionID, 'native-abort'\)/,
  'a confirmed native abort must release the admission');

console.log('DEF native session admission contract: PASS (shared single-flight rejects cross-turn overlap and releases only on terminal evidence)');
