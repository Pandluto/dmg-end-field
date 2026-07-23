import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { DEF_NATIVE_TARGETS } from '../def-tools/registry.mjs';

const require = createRequire(import.meta.url);
const { prepareWorkbenchTurn } = require('./index.cjs');
const { HarnessTransactionRuntime } = require('./runtime.cjs');
const { readNativeSessionBinding } = require('../def-opencode-adapter/index.cjs');

function turnFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-formal-manager-'));
  const sessionDirectory = path.join(root, 'session');
  fs.mkdirSync(sessionDirectory, { recursive: true });
  const checkout = { targetType: 'work-node', targetId: 'node-a', updatedAt: 10 };
  return {
    root,
    sessionDirectory,
    binding: {
      host: 'workbench',
      sessionID: `session-${path.basename(root)}`,
      directory: sessionDirectory,
      timelineId: 'timeline-a',
      axisBindingId: 'axis-a',
    },
    axisContext: {
      document: { id: 'timeline-a' },
      binding: { id: 'axis-a' },
      checkout,
      nodes: [{ id: 'node-a', label: '当前节点', updatedAt: 20 }],
      projection: { ready: true, converged: true },
    },
    checkoutState: { phase: 'stable', current: checkout, previous: null },
    workbenchContext: { id: 'node-a', label: '当前节点' },
    revisionStatePath: path.join(root, 'revisions.json'),
  };
}

async function prepare(userText) {
  const fixture = turnFixture();
  const prepared = await prepareWorkbenchTurn({
    ...fixture,
    userText,
    parts: [{ type: 'text', text: userText }],
    toolTargets: DEF_NATIVE_TARGETS,
  });
  return { fixture, prepared };
}

test('formal Workbench turn enters only the Manager route phase', async () => {
  const { prepared } = await prepare('给别礼换上潮涌套');
  assert.equal(prepared.trace.manager, 'def-harness-manager');
  assert.equal(prepared.trace.mode, 'route');
  assert.equal(prepared.transaction, null);
  assert.deepEqual(prepared.allowedTools.canonical, ['def.harness.route']);
  assert.deepEqual(prepared.allowedTools.nativeBindings, ['def_harness_route']);
  assert.match(prepared.system, /DEF WORKBENCH HOST FACTS/);
  assert.match(prepared.system, /schemeVersion/);
  assert.doesNotMatch(prepared.system, /GUIDE-FIRST|ROSTER SELECTION|Legacy REST tools|Harness package/);
});

test('deterministic narrow facts are real pinned business transactions', async () => {
  const { fixture, prepared } = await prepare('图腾下落-2层里的水龙卷算什么伤害');
  assert.equal(prepared.trace.mode, 'business');
  assert.equal(prepared.trace.businessId, 'calculation');
  assert.equal(prepared.trace.operation, 'skill_fact');
  assert.equal(prepared.trace.phase, 'read-skill-fact');
  assert.equal(prepared.transaction.harnessRevision.version, 'v1');
  assert.deepEqual(prepared.allowedTools.nativeBindings, ['def_data_skill']);
  const persisted = JSON.parse(fs.readFileSync(
    path.join(fixture.sessionDirectory, '.def-harness-manager', 'transactions.json'),
    'utf8',
  ));
  assert.equal(persisted.transactions[0].businessId, 'calculation');
  assert.equal(persisted.transactions[0].harnessRevision.version, 'v1');

  const runtime = new HarnessTransactionRuntime({
    sessionDirectory: fixture.sessionDirectory,
    revisionStatePath: fixture.revisionStatePath,
    toolTargets: DEF_NATIVE_TARGETS,
  });
  await runtime.afterTool({
    sessionId: fixture.binding.sessionID,
    turnId: '',
    callId: 'skill-fact-call',
    toolBinding: 'def_data_skill',
    canonicalToolId: 'def.data.resource.skill',
    output: {
      output: JSON.stringify({
        operator: { id: 'tangtang' },
        skill: { id: 'skill-Q-4', hits: [{ name: '3个水龙卷总倍率(含天赋)', skillType: 'B' }] },
        sourceRevision: 'operator-catalog-v1',
      }),
      metadata: { readOnly: true },
    },
  });
  const completed = runtime.transactions.get(prepared.transaction.transactionId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.evidenceRefs.length, 1);
  assert.equal(completed.evidenceRefs[0].source, 'def.data.resource.skill');
});

test('direct current-node question uses the timeline current operation only', async () => {
  const { prepared } = await prepare('当前节点是什么？');
  assert.equal(prepared.trace.businessId, 'timeline');
  assert.equal(prepared.trace.operation, 'current');
  assert.deepEqual(prepared.allowedTools.nativeBindings, ['def_workbench_current_node']);
});

test('legacy Session package fields are stripped during recovery', () => {
  const directory = path.join(
    os.tmpdir(),
    'dmg-end-field',
    'def-agent-workspace',
    'sessions',
    'workbench',
    `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(directory, { recursive: true });
  const resolvedDirectory = fs.realpathSync(directory);
  const sessionID = 'ses_legacy_harness_binding';
  fs.writeFileSync(path.join(resolvedDirectory, '.def-session.json'), `${JSON.stringify({
    schemaVersion: 4,
    sessionID,
    directory: resolvedDirectory,
    agent: 'def-workbench',
    skillId: 'workbench',
    host: 'workbench',
    timelineId: 'timeline-a',
    harnessBinding: { selector: 'stable', harness: { harnessId: 'legacy', version: '1.0.0', contentHash: 'hash' } },
    harnessWarning: 'legacy',
    createdAt: Date.now(),
  }, null, 2)}\n`);
  try {
    const binding = readNativeSessionBinding(resolvedDirectory, sessionID, {
      includeNodeRelation: false,
      syncWorkspaceFiles: false,
    });
    assert.equal(Object.hasOwn(binding, 'harnessBinding'), false);
    assert.equal(Object.hasOwn(binding, 'harnessWarning'), false);
    const migrated = JSON.parse(fs.readFileSync(path.join(resolvedDirectory, '.def-session.json'), 'utf8'));
    assert.equal(migrated.schemaVersion, 5);
    assert.equal(Object.hasOwn(migrated, 'harnessBinding'), false);
    assert.equal(Object.hasOwn(migrated, 'harnessWarning'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('formal sources have no legacy loader, global Skill, or selector ingress', () => {
  const manager = fs.readFileSync(new URL('./index.cjs', import.meta.url), 'utf8');
  const adapter = fs.readFileSync(new URL('../def-opencode-adapter/index.cjs', import.meta.url), 'utf8');
  const plugin = fs.readFileSync(new URL('../def-tools/opencode/plugin.js', import.meta.url), 'utf8');
  const view = fs.readFileSync(new URL('../../../src/components/def-opencode/DefOpenCodeView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(manager, /getNativeHarnessSystem|composeLegacyWorkbenchSystem|legacy-compatibility/);
  assert.doesNotMatch(
    adapter,
    /resolveNativeHarness|createSessionBinding|composeHarnessSystem|timeline-workbench|retired-workbench-legacy-prompt|Tree-bound execution/,
  );
  assert.doesNotMatch(view, /__defHarnessSelector|harnessSelector/);
  assert.match(plugin, /DEF_TOOL_LOCAL_CONTRACTS/);
  assert.match(plugin, /'tool\.definition'/);
  assert.match(plugin, /localContractDescription/);
});
