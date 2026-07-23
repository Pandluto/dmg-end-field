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
            terminalState: 'awaiting-confirmation',
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
