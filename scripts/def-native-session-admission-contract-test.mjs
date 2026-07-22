import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createNativeSessionAdmissionGate,
  evaluateNativeSessionAdmissionObservation,
} = require('../agent/server/native-session-admission.cjs');

// Keep this as a complete vendor-route inventory rather than a hand-picked
// list of regressions. Adding a session POST route makes this contract fail
// until its turn semantics are deliberately classified.
const VENDOR_SESSION_POST_AUDIT = Object.freeze([
  { vendorAction: 'create', proxyAction: null, handlerAction: 'create', kind: 'new-session' },
  { vendorAction: 'fork', proxyAction: null, handlerAction: 'fork', kind: 'session-copy' },
  { vendorAction: 'abort', proxyAction: null, handlerAction: 'abort', kind: 'turn-control' },
  { vendorAction: 'init', proxyAction: 'init', handlerAction: 'init', source: 'proxy-init', kind: 'sync-turn' },
  { vendorAction: 'share', proxyAction: null, handlerAction: 'share', kind: 'metadata' },
  { vendorAction: 'summarize', proxyAction: 'summarize', handlerAction: 'summarize', source: 'proxy-summarize', kind: 'sync-turn' },
  { vendorAction: 'prompt', proxyAction: 'message', handlerAction: 'prompt', source: 'ui', kind: 'sync-turn' },
  { vendorAction: 'promptAsync', proxyAction: 'prompt_async', handlerAction: 'promptAsync', source: 'proxy-prompt-async', kind: 'async-turn' },
  { vendorAction: 'command', proxyAction: 'command', handlerAction: 'command', source: 'proxy-command', kind: 'sync-turn' },
  { vendorAction: 'shell', proxyAction: 'shell', handlerAction: 'shell', source: 'proxy-shell', kind: 'sync-turn' },
  { vendorAction: 'revert', proxyAction: null, handlerAction: 'revert', kind: 'history-control' },
  { vendorAction: 'unrevert', proxyAction: null, handlerAction: 'unrevert', kind: 'history-control' },
  { vendorAction: 'permissionRespond', proxyAction: null, handlerAction: 'permissionRespond', kind: 'turn-control' },
]);
const TURN_INGRESSES = VENDOR_SESSION_POST_AUDIT.filter((entry) => entry.proxyAction);

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

for (const ingress of [...TURN_INGRESSES, { proxyAction: 'interop', source: 'interop', kind: 'async-turn' }]) {
  const nativeIngressGate = createNativeSessionAdmissionGate({ now: () => 1500 });
  const accepted = nativeIngressGate.admit({ sessionID: 'native-ingress', source: ingress.source });
  assert.equal(accepted.kind, 'accepted');
  for (const contender of [...TURN_INGRESSES, { proxyAction: 'interop', source: 'interop', kind: 'async-turn' }]) {
    if (contender.source === ingress.source) continue;
    assert.throws(
      () => nativeIngressGate.admit({ sessionID: 'native-ingress', source: contender.source }),
      /native-session-turn-in-progress/,
      `a ${contender.proxyAction} turn cannot overlap an admitted ${ingress.proxyAction} turn`,
    );
  }
  assert.equal(nativeIngressGate.release(accepted.entry, `${ingress.proxyAction}-terminal`), true);
}

const rejectedShellGate = createNativeSessionAdmissionGate({ now: () => 1600 });
const rejectedShell = rejectedShellGate.admit({ sessionID: 'native-ingress-failure', source: 'proxy-shell' });
assert.equal(rejectedShellGate.release(rejectedShell.entry, 'submission-failed'), true,
  'an explicitly rejected shell submission releases rather than poisoning the session');

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
  'each native-turn ingress must acquire the shared admission before proxying');
const sessionActionMatcherLine = proxySource.split('\n').find((line) => line.includes('const sessionActionMatch')) || '';
for (const action of [...TURN_INGRESSES.map((entry) => entry.proxyAction), 'abort']) {
  assert.match(sessionActionMatcherLine, new RegExp(`(?:\\(|\\|)${action}(?:\\||\\))`),
    `the proxy route matcher must recognize the audited ${action} session action`);
}
for (const ingress of TURN_INGRESSES) {
  assert.match(proxySource, new RegExp(`${ingress.proxyAction}: '${ingress.source}'`),
    `${ingress.proxyAction} must have an auditable admission source`);
}
assert.match(proxySource, /if \(binding && sessionAction !== 'abort'\)/,
  'every bound turn ingress must capture admission before forwarding; abort remains unchanged');
assert.match(proxySource, /scheduleNativeSessionAdmissionWatch\(/,
  'async ingress and every transport-unknown turn must retain admission until native completion is observed');
assert.match(proxySource, /await captureNativeSessionAdmissionBaseline\(admission, runtime, binding\)/,
  'every direct turn ingress captures a transcript baseline before transport');
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
assert.match(proxySource, /if \(!succeeded\) nativeSessionAdmission\.release\(admission, 'submission-failed'\)/,
  'a known non-2xx failure releases a turn reservation');
assert.match(proxySource, /if \(admission && !explicitRejection\) retainNativePromptAdmissionForReconciliation\(admission, runtime, binding\)/,
  'a response that becomes indeterminate after acceptance keeps every turn reservation for reconciliation');
assert.match(proxySource, /upstream\.on\('error',[\s\S]*retainNativePromptAdmissionForReconciliation\(admission, runtime, binding\)/,
  'a transport failure before a response remains acceptance-unknown and cannot release a turn admission');
assert.match(proxySource, /sessionAction === 'prompt_async'[\s\S]*else nativeSessionAdmission\.release\(admission, `native-\$\{sessionAction\}-terminal`\)/,
  'only the asynchronous vendor route waits for watcher evidence; completed synchronous responses are terminal');
assert.deepEqual(TURN_INGRESSES.filter((entry) => entry.kind === 'async-turn').map((entry) => entry.proxyAction), ['prompt_async'],
  'the completion policy must name the complete set of asynchronous native-turn ingress routes');

const vendorRoutes = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts', import.meta.url), 'utf8');
const vendorHandlers = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts', import.meta.url), 'utf8');
const vendorPrompt = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/session/prompt.ts', import.meta.url), 'utf8');
const vendorRunner = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/effect/runner.ts', import.meta.url), 'utf8');
const vendorPostActions = Array.from(vendorRoutes.matchAll(/HttpApiEndpoint\.post\("([^"\n]+)"/g), (match) => match[1]);
assert.deepEqual(vendorPostActions, VENDOR_SESSION_POST_AUDIT.map((entry) => entry.vendorAction),
  'every vendor session POST route must be classified before admission behavior can change');
function vendorHandlerBlock(action) {
  const marker = `const ${action} = Effect.fn("SessionHttpApi.${action}")`;
  const start = vendorHandlers.indexOf(marker);
  assert.notEqual(start, -1, `vendor handler ${action} must remain discoverable for the route audit`);
  const next = vendorHandlers.indexOf('\n    const ', start + marker.length);
  return vendorHandlers.slice(start, next === -1 ? vendorHandlers.length : next);
}
for (const entry of VENDOR_SESSION_POST_AUDIT.filter((item) => !item.proxyAction)) {
  assert.doesNotMatch(vendorHandlerBlock(entry.handlerAction), /promptSvc\.(?:prompt|command|shell|loop)|compactSvc\.create|createUserMessage/,
    `vendor ${entry.vendorAction} is classified as non-ingress and must not start a new native turn without updating this audit`);
}
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("init", SessionPaths\.init,[\s\S]*?payload: InitPayload,[\s\S]*?success: described\(Schema\.Boolean, "200"\)/,
  'vendor /init declares InitPayload and waits to return its Boolean result');
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("summarize", SessionPaths\.summarize,[\s\S]*?payload: SummarizePayload,[\s\S]*?success: described\(Schema\.Boolean, "Summarized session"\)/,
  'vendor /summarize declares SummarizePayload and waits to return its Boolean result');
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("prompt", SessionPaths\.prompt,[\s\S]*?payload: PromptPayload,[\s\S]*?success: described\(SessionV1\.WithParts, "Created message"\)/,
  'vendor /message declares PromptPayload and a completed WithParts response');
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("promptAsync", SessionPaths\.promptAsync,[\s\S]*?payload: PromptPayload,[\s\S]*?success: described\(HttpApiSchema\.NoContent, "Prompt accepted"\)/,
  'vendor /prompt_async is the one immediate-acceptance route');
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("command", SessionPaths\.command,[\s\S]*?payload: CommandPayload,[\s\S]*?success: described\(SessionV1\.WithParts, "Created message"\)/,
  'vendor /command declares CommandPayload and a completed WithParts response');
assert.match(vendorRoutes, /HttpApiEndpoint\.post\("shell", SessionPaths\.shell,[\s\S]*?payload: ShellPayload,[\s\S]*?success: described\(SessionV1\.WithParts, "Created message"\)/,
  'vendor /shell declares ShellPayload and a completed WithParts response');
assert.match(vendorHandlers, /const init[\s\S]*?promptSvc\s*\.command\([\s\S]*?\)\s*\.pipe\([\s\S]*?return true/,
  'vendor /init awaits promptSvc.command rather than acknowledging early');
assert.match(vendorHandlers, /const summarize[\s\S]*?compactSvc\.create\([\s\S]*?promptSvc\.loop\(\{ sessionID: ctx\.params\.sessionID \}\)[\s\S]*?return true/,
  'vendor /summarize first creates a compaction user message and then awaits the prompt loop');
assert.match(vendorHandlers, /const prompt[\s\S]*?const message = yield\* promptSvc\s*\.prompt\([\s\S]*?return HttpServerResponse\.stream/,
  'vendor /message awaits promptSvc.prompt before its stream closes');
assert.match(vendorHandlers, /const promptAsync[\s\S]*?promptSvc\.prompt\([\s\S]*?Effect\.forkIn\(scope, \{ startImmediately: true \}\)[\s\S]*?return HttpApiSchema\.NoContent\.make\(\)/,
  'vendor /prompt_async starts prompt work in the background and returns before terminal evidence exists');
assert.match(vendorHandlers, /const command[\s\S]*?return yield\* promptSvc\s*\.command\(\{ \.\.\.ctx\.payload, sessionID: ctx\.params\.sessionID \}\)/,
  'vendor /command awaits promptSvc.command rather than acknowledging early');
assert.match(vendorHandlers, /const shell[\s\S]*?return yield\* SessionError\.mapBusy\(promptSvc\.shell\(\{ \.\.\.ctx\.payload, sessionID: ctx\.params\.sessionID \}\)\)/,
  'vendor /shell awaits promptSvc.shell rather than acknowledging early');
assert.match(vendorPrompt, /const command[\s\S]*?const result = yield\* prompt\([\s\S]*?return result/,
  'vendor command resolves through the normal prompt loop before it returns');
assert.match(vendorPrompt, /const shell[\s\S]*?return yield\* state\.startShell\(/,
  'vendor shell resolves through SessionRunState.startShell');
assert.match(vendorRunner, /const exit = yield\* Fiber\.await\(fiber\)/,
  'vendor startShell waits for the shell fiber to finish before returning its result');

console.log('DEF native session admission contract: PASS (all audited turn ingress routes and interop share single-flight; unknown transport states remain reserved)');
