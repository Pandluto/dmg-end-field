import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BusinessHarnessRegistry } = require('./registry.cjs');
const { HarnessTransactionRuntime } = require('./runtime.cjs');
const { readRuntimeBridge } = require('./bridge.cjs');

const toolTargets = [
  { id: 'def.harness.route', nativeBinding: 'def_harness_route' },
  { id: 'def.read', nativeBinding: 'def_read' },
  { id: 'def.preview', nativeBinding: 'def_preview' },
  { id: 'def.apply', nativeBinding: 'def_apply' },
  { id: 'def.verify', nativeBinding: 'def_verify' },
];

function writeSelection(root, version = 'v1') {
  const business = path.join(root, 'selection');
  const revision = path.join(business, 'revisions', version);
  fs.mkdirSync(revision, { recursive: true });
  fs.writeFileSync(path.join(business, 'definition.json'), JSON.stringify({
    schemaVersion: 1,
    businessId: 'selection',
    summary: 'selection',
    operations: ['replace'],
    toolCeiling: ['def.read', 'def.preview', 'def.apply', 'def.verify'],
    writeScope: ['selection.members'],
    completion: { verification: 'visible' },
    downstream: { calculation: 'recompute' },
  }, null, 2));
  fs.writeFileSync(path.join(revision, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    businessId: 'selection',
    version,
    writeScope: ['selection.members'],
    operations: {
      replace: {
        entryPhase: 'context',
        phases: [
          {
            id: 'context',
            kind: 'context',
            tools: ['def.read'],
            writes: [],
            instructions: 'Read selection.',
            transitions: { onSuccess: 'proposal', onFailure: 'failed' },
          },
          {
            id: 'proposal',
            kind: 'proposal',
            tools: ['def.preview'],
            writes: [],
            instructions: 'Create proposal.',
            transitions: { onSuccess: 'awaiting-confirmation', onFailure: 'failed' },
          },
          {
            id: 'awaiting-confirmation',
            kind: 'awaiting-confirmation',
            tools: [],
            writes: [],
            instructions: 'Wait.',
            transitions: { onConfirm: 'apply', onReject: 'failed' },
            terminalState: 'awaiting-confirmation',
          },
          {
            id: 'apply',
            kind: 'mutation',
            tools: ['def.apply'],
            writes: ['selection.members'],
            instructions: 'Apply.',
            transitions: { onSuccess: 'verify', onFailure: 'failed' },
          },
          {
            id: 'verify',
            kind: 'verification',
            tools: ['def.verify'],
            writes: [],
            instructions: 'Verify.',
            transitions: { onSuccess: 'done', onFailure: 'failed' },
          },
          {
            id: 'done',
            kind: 'response',
            tools: [],
            writes: [],
            instructions: 'Done.',
            terminalState: 'completed',
          },
          {
            id: 'failed',
            kind: 'response',
            tools: [],
            writes: [],
            instructions: 'Report failure.',
            terminalState: 'aborted',
          },
        ],
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(revision, 'instructions.md'), '# Selection\nUse exact typed facts.\n');
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-harness-runtime-'));
  const businessRoot = path.join(root, 'business');
  const sessionDirectory = path.join(root, 'session');
  const revisionStatePath = path.join(root, 'revisions.json');
  fs.mkdirSync(sessionDirectory, { recursive: true });
  writeSelection(businessRoot);
  const registry = new BusinessHarnessRegistry({
    businessRoot,
    statePath: revisionStatePath,
    toolIds: toolTargets.map((target) => target.id),
  });
  await registry.register('selection', 'v1');
  await registry.activate('selection');
  return {
    sessionDirectory,
    runtime: new HarnessTransactionRuntime({
      sessionDirectory,
      businessRoot,
      revisionStatePath,
      toolTargets,
    }),
    context: {
      sessionId: 'session-a',
      timelineId: 'timeline-a',
      checkoutId: 'node-a',
      checkoutType: 'work-node',
      schemeVersion: 'scheme-a',
    },
  };
}

test('reprojects Tools after route and each Tool result', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '换成别礼', turnId: 'turn-a' });
  assert.deepEqual(readRuntimeBridge(sessionDirectory).allowedToolBindings, ['def_harness_route']);

  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-a',
    callId: 'route-call',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: {
      metadata: {
        route: {
          kind: 'new-business',
          businessId: 'selection',
          operation: 'replace',
          target: '别礼',
          requestedEffect: '换成别礼',
        },
      },
    },
  });
  let bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.mode, 'business');
  assert.equal(bridge.phase, 'context');
  assert.deepEqual(bridge.allowedToolBindings, ['def_read']);
  assert.throws(() => runtime.assertTool({
    sessionId: 'session-a',
    turnId: 'turn-a',
    toolBinding: 'def_apply',
    canonicalToolId: 'def.apply',
  }), { code: 'HARNESS_TOOL_PHASE_DENIED' });

  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-a',
    callId: 'read-call',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: JSON.stringify({ ok: true }), metadata: {} },
  });
  bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.phase, 'proposal');
  assert.deepEqual(bridge.allowedToolBindings, ['def_preview']);

  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-a',
    callId: 'preview-call',
    toolBinding: 'def_preview',
    canonicalToolId: 'def.preview',
    output: {
      output: JSON.stringify({ ok: true }),
      metadata: { proposal: { id: 'proposal-a', token: 'proposal-token-a' } },
    },
  });
  bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.phase, 'awaiting-confirmation');
  assert.deepEqual(bridge.allowedToolBindings, []);
  assert.equal(runtime.transactions.get(bridge.transactionId).status, 'awaiting-confirmation');
});

test('a cached plugin runtime reloads transaction state written by the server runtime', async () => {
  const { sessionDirectory, runtime: serverRuntime, context } = await fixture();
  const pluginRuntime = new HarnessTransactionRuntime({
    sessionDirectory,
    businessRoot: serverRuntime.registry.businessRoot,
    revisionStatePath: serverRuntime.registry.controller.statePath,
    toolTargets,
  });
  await serverRuntime.prepareRoute({ context, userText: '换成别礼', turnId: 'turn-shared' });
  await serverRuntime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-shared',
    callId: 'route-shared',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'new-business',
      businessId: 'selection',
      operation: 'replace',
      target: '别礼',
      requestedEffect: '换成别礼',
    } } },
  });
  const transactionId = readRuntimeBridge(sessionDirectory).transactionId;
  assert.equal(pluginRuntime.transactions.get(transactionId), null);

  pluginRuntime.refreshFromDisk();
  assert.equal(pluginRuntime.transactions.get(transactionId).phase, 'context');
  await pluginRuntime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-shared',
    callId: 'read-shared',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: '{"ok":true}', metadata: {} },
  });

  assert.equal(serverRuntime.transactions.get(transactionId).phase, 'context');
  serverRuntime.refreshFromDisk();
  assert.equal(serverRuntime.transactions.get(transactionId).phase, 'proposal');
  assert.equal(readRuntimeBridge(sessionDirectory).phase, 'proposal');
});

test('clarification uses the native question and then returns to the route gate', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '处理一下', turnId: 'turn-clarify' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-clarify',
    callId: 'route-clarify',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'clarify',
      ambiguity: 'business',
      question: '你要换人还是改配装？',
      choices: ['换人', '改配装'],
    } } },
  });
  let bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.mode, 'clarify');
  assert.deepEqual(bridge.allowedToolBindings, ['question']);

  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-clarify',
    callId: 'question-clarify',
    toolBinding: 'question',
    canonicalToolId: '',
    output: { output: '换人', metadata: {} },
  });
  bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.mode, 'route');
  assert.deepEqual(bridge.allowedToolBindings, ['def_harness_route']);
});

test('moves failures through the declared failure exit', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '换成别礼', turnId: 'turn-failure' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-failure',
    callId: 'route-call',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'new-business',
      businessId: 'selection',
      operation: 'replace',
      target: '别礼',
      requestedEffect: '换成别礼',
    } } },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-failure',
    callId: 'read-call',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: 'typed-read-failed', metadata: { ok: false, state: 'error' } },
  });
  const bridge = readRuntimeBridge(sessionDirectory);
  assert.equal(bridge.mode, 'complete');
  assert.equal(bridge.phase, 'failed');
  assert.equal(runtime.transactions.get(bridge.transactionId).status, 'aborted');
});

test('later confirmation resumes the same pinned proposal transaction', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '换成别礼', turnId: 'turn-preview' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'route-call',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'new-business',
      businessId: 'selection',
      operation: 'replace',
      target: '别礼',
      requestedEffect: '换成别礼',
    } } },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'read-call',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: '{"ok":true}', metadata: {} },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'preview-call',
    toolBinding: 'def_preview',
    canonicalToolId: 'def.preview',
    output: { output: '{"ok":true,"proposalToken":"proposal-token-a"}', metadata: {} },
  });
  const awaiting = readRuntimeBridge(sessionDirectory);
  const transactionId = awaiting.transactionId;
  const revision = runtime.transactions.get(transactionId).harnessRevision;

  await runtime.prepareRoute({ context, userText: '确认', turnId: 'turn-confirm' });
  const resumed = readRuntimeBridge(sessionDirectory);
  assert.equal(resumed.transactionId, transactionId);
  assert.equal(resumed.phase, 'apply');
  assert.deepEqual(resumed.allowedToolBindings, ['def_apply']);
  assert.deepEqual(runtime.transactions.get(transactionId).harnessRevision, revision);
  assert.equal(runtime.transactions.get(transactionId).proposal.token, 'proposal-token-a');
});

test('a correction supersedes the reviewed transaction and returns to route phase', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '换成别礼', turnId: 'turn-preview' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'route-call',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'new-business',
      businessId: 'selection',
      operation: 'replace',
      target: '别礼',
      requestedEffect: '换成别礼',
    } } },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'read-call',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: '{"ok":true}', metadata: {} },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-preview',
    callId: 'preview-call',
    toolBinding: 'def_preview',
    canonicalToolId: 'def.preview',
    output: { output: '{"ok":true,"proposalToken":"proposal-token-a"}', metadata: {} },
  });
  const transactionId = readRuntimeBridge(sessionDirectory).transactionId;

  await runtime.prepareRoute({ context, userText: '不对，改成赛希', turnId: 'turn-correct' });
  const reroute = readRuntimeBridge(sessionDirectory);
  assert.equal(runtime.transactions.get(transactionId).status, 'superseded');
  assert.equal(reroute.mode, 'route');
  assert.deepEqual(reroute.allowedToolBindings, ['def_harness_route']);
});

test('a cross-business plan starts the next pinned transaction with the new scheme', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  await runtime.prepareRoute({ context, userText: '先换成别礼，再换成赛希', turnId: 'turn-plan' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-plan',
    callId: 'route-call',
    toolBinding: 'def_harness_route',
    canonicalToolId: 'def.harness.route',
    output: { metadata: { route: {
      kind: 'cross-business',
      goal: '依次完成两项选择变更',
      steps: [
        { businessId: 'selection', operation: 'replace', target: '别礼', requestedEffect: '换成别礼' },
        { businessId: 'selection', operation: 'replace', target: '赛希', requestedEffect: '换成赛希' },
      ],
    } } },
  });
  const first = readRuntimeBridge(sessionDirectory);
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-plan',
    callId: 'read-first',
    toolBinding: 'def_read',
    canonicalToolId: 'def.read',
    output: { output: '{"ok":true}', metadata: {} },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-plan',
    callId: 'preview-first',
    toolBinding: 'def_preview',
    canonicalToolId: 'def.preview',
    output: { output: '{"ok":true,"proposalToken":"proposal-first"}', metadata: {} },
  });
  await runtime.prepareRoute({ context, userText: '确认', turnId: 'turn-confirm-first' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-confirm-first',
    callId: 'apply-first',
    toolBinding: 'def_apply',
    canonicalToolId: 'def.apply',
    output: {
      output: '{"ok":true}',
      metadata: { currentCheckoutTouched: true, schemeVersion: 'scheme-b' },
    },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-confirm-first',
    callId: 'verify-first',
    toolBinding: 'def_verify',
    canonicalToolId: 'def.verify',
    output: { output: '{"ok":true}', metadata: {} },
  });
  const second = readRuntimeBridge(sessionDirectory);
  assert.equal(second.mode, 'business');
  assert.equal(second.phase, 'context');
  assert.notEqual(second.transactionId, first.transactionId);
  assert.equal(second.context.schemeVersion, 'scheme-b');
  const plan = runtime.plans.get(runtime.transactions.get(second.transactionId).planId);
  assert.equal(plan.currentIndex, 1);
  assert.equal(plan.steps[1].inputSchemeVersion, 'scheme-b');
});

test('a real mutation without a resulting scheme version fails closed', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  const revision = await runtime.registry.resolveActive('selection');
  const transaction = runtime.transactions.create({
    context,
    businessId: 'selection',
    operation: 'replace',
    harnessRevision: revision,
    target: '别礼',
    phase: 'apply',
  });
  await runtime.projectTransaction(transaction.transactionId, { turnId: 'turn-no-scheme' });
  await assert.rejects(runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-no-scheme',
    callId: 'apply-no-scheme',
    toolBinding: 'def_apply',
    canonicalToolId: 'def.apply',
    output: { output: '{"ok":true}', metadata: { currentCheckoutTouched: true } },
  }), { code: 'HARNESS_MUTATION_SCHEME_VERSION_REQUIRED' });
  assert.equal(runtime.transactions.get(transaction.transactionId).status, 'stale');
  assert.equal(readRuntimeBridge(sessionDirectory).phase, 'apply');
});

test('an intentional temporary-workspace detach completes the step and stops its plan', async () => {
  const { sessionDirectory, runtime, context } = await fixture();
  const revision = await runtime.registry.resolveActive('selection');
  const plan = runtime.plans.create({
    sessionId: context.sessionId,
    timelineId: context.timelineId,
    checkoutId: context.checkoutId,
    goal: '全队替换后继续配装',
    schemeVersion: context.schemeVersion,
    steps: [
      { businessId: 'selection', operation: 'replace', requestedEffect: '全队替换' },
      { businessId: 'selection', operation: 'replace', requestedEffect: '后续操作' },
    ],
  });
  const transaction = runtime.transactions.create({
    context,
    businessId: 'selection',
    operation: 'replace',
    harnessRevision: revision,
    target: '全新四人队',
    phase: 'apply',
    planId: plan.planId,
    planStepIndex: 0,
  });
  runtime.plans.bindCurrentTransaction(plan.planId, transaction.transactionId, context.schemeVersion);
  await runtime.projectTransaction(transaction.transactionId, { turnId: 'turn-detached' });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-detached',
    callId: 'apply-detached',
    toolBinding: 'def_apply',
    canonicalToolId: 'def.apply',
    output: {
      output: '{"ok":true,"transition":"new-temporary-workspace"}',
      metadata: { currentCheckoutTouched: true, sessionDetached: true },
    },
  });
  await runtime.afterTool({
    sessionId: 'session-a',
    turnId: 'turn-detached',
    callId: 'verify-detached',
    toolBinding: 'def_verify',
    canonicalToolId: 'def.verify',
    output: { output: '{"ok":true}', metadata: {} },
  });
  assert.equal(runtime.transactions.get(transaction.transactionId).status, 'completed');
  assert.equal(runtime.plans.get(plan.planId).status, 'stopped');
  assert.equal(readRuntimeBridge(sessionDirectory).mode, 'complete');
});

test('OpenCode request preparation and DEF plugin share the phase bridge', () => {
  const requestSource = fs.readFileSync(new URL('../../vendor/opencode/packages/opencode/src/session/llm/request.ts', import.meta.url), 'utf8');
  const pluginContractSource = fs.readFileSync(new URL('../../vendor/opencode/packages/plugin/src/index.ts', import.meta.url), 'utf8');
  const defPluginSource = fs.readFileSync(new URL('../def-tools/opencode/plugin.js', import.meta.url), 'utf8');
  assert.match(pluginContractSource, /experimental\.chat\.tools\.transform/);
  assert(requestSource.indexOf('const tools = resolveTools(input)') < requestSource.indexOf('"experimental.chat.tools.transform"'));
  assert.match(requestSource, /directory: instance\.directory/);
  assert.match(defPluginSource, /'experimental\.chat\.tools\.transform'/);
  assert.match(defPluginSource, /'tool\.execute\.before'/);
  assert.match(defPluginSource, /assertHarnessToolBefore/);
  assert.match(defPluginSource, /'tool\.execute\.after'/);
  assert.match(defPluginSource, /advanceHarnessToolAfter/);
});
