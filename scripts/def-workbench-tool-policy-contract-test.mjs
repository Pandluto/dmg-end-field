import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEF_TOOL_DEFINITION_BASE } from '../agent/runtime/def-tools/definitions.mjs';
import {
  createDefToolRegistry,
  DEF_PROJECTION_ACCESS,
  DEF_WORKSPACE_SCOPE,
  resolveDefToolAccessPolicy,
} from '../agent/runtime/def-tools/registry.mjs';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const { createCatalogDatabase } = require('../electron/data-management-service.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-tool-policy-'));
const port = 18700 + Math.floor(Math.random() * 300);
const databasePath = path.join(root, 'timeline.sqlite');
const builtinCatalogPath = path.join(root, 'catalog.sqlite');
const internalToken = 'tool-policy-contract-native-host';
const repository = createTimelineRepository({ databasePath });
createCatalogDatabase({ databasePath: builtinCatalogPath, dataVersion: 'tool-policy-contract-v2' });

const emptyPayload = {
  selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [],
  characterInputMap: {}, operatorConfigPageCache: {},
};

function fixturePayload(sentinel) {
  return {
    ...emptyPayload,
    selectedCharacters: [`operator-${sentinel}`],
    timelineData: {
      staffLines: [{
        staffIndex: 0,
        characterName: `Operator ${sentinel} ONLY`,
        occupiedNodes: [0],
        buttons: [{ id: `button-${sentinel}`, characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, skillType: 'A', staffIndex: 0, nodeIndex: 0, selectedBuff: [`buff-${sentinel}`] }],
      }],
    },
    skillButtonTable: {
      [`button-${sentinel}`]: { id: `button-${sentinel}`, characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, skillType: 'A', staffIndex: 0, nodeIndex: 0, selectedBuff: [`buff-${sentinel}`] },
    },
    allBuffList: [{ id: `buff-${sentinel}`, name: `Buff ${sentinel} ONLY` }],
    operatorConfigPageCache: {
      [`operator-${sentinel}`]: {
        weapon: { id: `weapon-${sentinel}`, name: `Weapon ${sentinel} ONLY`, config: { level: 90, potential: '0潜' } },
        equipment: { pieces: [{ slotKey: 'armor', equipmentId: `equipment-${sentinel}`, name: `Equipment ${sentinel} ONLY` }] },
      },
    },
  };
}

function seedTimeline(timelineId, nodeId, sentinel) {
  const payload = fixturePayload(sentinel);
  repository.ensureDocument({ id: timelineId, label: `${sentinel} document` });
  repository.importWorkNode({
    id: nodeId, timelineId, branchId: `${timelineId}-main`, label: `${sentinel} node`,
    status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload,
    contentRevision: sentinel === 'A' ? 101 : 202,
  });
  repository.setCheckoutRef({ timelineId, targetType: 'work-node', targetId: nodeId, updatedAt: Date.now() });
}

seedTimeline('formal-a', 'node-a-only', 'A');
seedTimeline('formal-b', 'node-b-only', 'B');
const invalidTimelinePayload = fixturePayload('A');
invalidTimelinePayload.timelineData.staffLines[0].buttons = [{ id: 'button-invalid', nodeIndex: 0, skillKey: 'operator-A-B' }];
invalidTimelinePayload.timelineData.staffLines[0].occupiedNodes = [0];
invalidTimelinePayload.skillButtonTable = { 'button-invalid': { id: 'button-invalid', nodeIndex: 0, skillKey: 'operator-A-B', selectedBuff: [] } };
repository.importWorkNode({
  id: 'node-invalid-timeline', timelineId: 'formal-a', parentNodeId: 'node-a-only', branchId: 'invalid-timeline', label: 'Invalid timeline node',
  status: 'ready', approvalPolicy: 'manual', basePayload: fixturePayload('A'), workingPayload: invalidTimelinePayload,
  contentRevision: 303,
});
repository.ensureDocument({ id: 'temporary-a', label: 'Temporary A', isTemporary: true });
repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-a' });
repository.ensureDocument({ id: 'missing-formal', label: 'Soon stale' });
repository.upsertSessionAxisBinding({ id: 'axis-stale', timelineId: 'missing-formal', host: 'workbench', opencodeSessionId: 'session-stale' });
repository.deleteDocument('missing-formal');
repository.upsertSessionAxisBinding({ id: 'axis-owner', timelineId: 'formal-a', host: 'workbench', opencodeSessionId: 'session-owner' });

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath,
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DATA_MANAGEMENT_BUILTIN_CATALOG_PATH: builtinCatalogPath,
    DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: internalToken,
  },
  stdio: 'ignore',
});

const baseUrl = `http://127.0.0.1:${port}`;

async function waitForReady() {
  for (let index = 0; index < 300; index += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for tool-policy contract server.');
}

async function request(pathname, { method = 'GET', body, internal = false } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(internal ? { 'x-def-internal-token': internalToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function generic(tool, input = {}, sessionId = '') {
  return request('/api/def-tools/call', { method: 'POST', body: { tool, input, ...(sessionId ? { sessionId } : {}) } });
}

async function legacy(tool, input = {}, sessionId = '') {
  return request(`/api/def-tools/${encodeURIComponent(tool)}/call`, { method: 'POST', body: { input, ...(sessionId ? { sessionId } : {}) } });
}

async function mirror(timelineId, sentinel) {
  const checkout = repository.getCheckoutRef(timelineId);
  const response = await request('/api/main-workbench/snapshot', {
    method: 'POST',
    internal: true,
    body: {
      source: 'app',
      activeTimelineId: timelineId,
      timelineId,
      checkout,
      selectedCharacters: [{ id: `operator-${sentinel}`, name: `Operator ${sentinel} ONLY` }],
      skillCatalog: [{
        characterId: `operator-${sentinel}`,
        characterName: `Operator ${sentinel} ONLY`,
        skillId: `skill-${sentinel}`,
        skillType: 'A',
        skillDisplayName: `Trusted Skill ${sentinel} ONLY`,
        source: 'contract-runtime-template',
      }],
      skillButtons: [{ id: `button-${sentinel}`, characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, skillType: 'A', staffIndex: 0, lineIndex: 0, nodeIndex: 0, selectedBuffIds: [`buff-${sentinel}`], selectedBuffs: [{ id: `buff-${sentinel}`, name: `Buff ${sentinel} ONLY` }] }],
      operatorConfigs: [{ characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, weapon: { id: `weapon-${sentinel}`, name: `Weapon ${sentinel} ONLY`, level: 90, potential: '0潜' }, equipment: [{ slotKey: 'armor', equipmentId: `equipment-${sentinel}`, name: `Equipment ${sentinel} ONLY`, effects: [] }] }],
      selectedTeamLoadouts: [{ characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, weapon: { name: `Weapon ${sentinel} ONLY` }, equipment: [{ name: `Equipment ${sentinel} ONLY` }] }],
      damageReport: {
        generatedAt: 1,
        totalExpected: sentinel === 'A' ? 111111 : 999999,
        totalNonCrit: sentinel === 'A' ? 101010 : 909090,
        buttonCount: 1,
        buttons: [{ buttonId: `button-${sentinel}`, totalExpected: sentinel === 'A' ? 111111 : 999999, marker: `Damage ${sentinel} ONLY` }],
      },
      updatedAt: Date.now(),
    },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.snapshot;
}

function currentRegistryTools() {
  return createDefToolRegistry(DEF_TOOL_DEFINITION_BASE).filter((tool) =>
    tool.workspaceScope === DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT
    || tool.workspaceScope === DEF_WORKSPACE_SCOPE.WORKNODE_TREE);
}

function strictBindingTools() {
  return currentRegistryTools().filter((tool) => tool.projectionAccess !== DEF_PROJECTION_ACCESS.MIXED_CURRENT_PUBLIC);
}

function treeState() {
  return ['formal-a', 'formal-b'].flatMap((timelineId) => repository.listWorkNodes(timelineId))
    .map((node) => `${node.timelineId}:${node.id}:${node.contentRevision}`).sort();
}

try {
  await waitForReady();

  // Native context attachment may authenticate and await the Canvas projection,
  // but it must never replace that full runtime projection with checkout-shaped
  // placeholder data.
  const fullCanvasProjection = await mirror('formal-a', 'A');
  const hydratedProjection = await request('/api/main-workbench/checkout-projection', {
    method: 'POST', internal: true,
    body: {
      sessionBindingId: 'axis-a', sessionID: 'session-a', timelineId: 'formal-a',
      waitMs: 0,
    },
  });
  assert.equal(hydratedProjection.status, 200, JSON.stringify(hydratedProjection.body));
  assert.deepEqual(hydratedProjection.body.snapshot, fullCanvasProjection,
    'native context attachment must return the exact Canvas snapshot without rewriting it');
  assert.equal(hydratedProjection.body.snapshot.skillButtons[0].selectedBuffs[0].name, 'Buff A ONLY');
  assert.equal(hydratedProjection.body.snapshot.operatorConfigs[0].weapon.name, 'Weapon A ONLY');
  assert.equal(hydratedProjection.body.snapshot.damageReport.totalExpected, 111111);
  assert.equal(hydratedProjection.body.snapshot.skillCatalog?.[0]?.skillId, 'skill-A',
    `native context attachment must retain the trusted selected-operator skill catalog: ${JSON.stringify(hydratedProjection.body.snapshot)}`);
  const afterAttach = await request('/api/main-workbench/snapshot', { internal: true });
  const { axisContext: _axisContext, ...persistedAfterAttach } = afterAttach.body.snapshot;
  assert.deepEqual(persistedAfterAttach, fullCanvasProjection,
    'native context attachment must leave the canonical mirror byte-for-byte equivalent');
  const hydratedRead = await generic('def.character.resolve', { query: 'Operator A ONLY' }, 'session-a');
  assert.equal(hydratedRead.status, 200, JSON.stringify(hydratedRead.body));
  assert(JSON.stringify(hydratedRead.body).includes('Operator A ONLY'));
  const hydratedDamage = await generic('def.workbench.damage_report', {}, 'session-a');
  assert.equal(hydratedDamage.status, 200, JSON.stringify(hydratedDamage.body));
  assert.equal(hydratedDamage.body.result.damageReport.totalExpected, 111111);
  const trustedSkills = await generic('def.skill.resolve', { query: 'Operator A ONLY' }, 'session-a');
  assert.equal(trustedSkills.status, 200, JSON.stringify(trustedSkills.body));
  assert.equal(trustedSkills.body.result.candidates.some((candidate) => candidate.skillId === 'skill-A'), true,
    `selected operator skills must be resolvable even when they have not been placed on the timeline: ${JSON.stringify(trustedSkills.body)}`);

  const rejectedInvalidCheckout = await generic('def.worknode.checkout_and_verify', {
    nodeId: 'node-invalid-timeline', expectedRevision: 303, expectedWorkingHash: 'not-needed-for-invalid-shape',
  }, 'session-a');
  assert.equal(rejectedInvalidCheckout.status, 200, JSON.stringify(rejectedInvalidCheckout.body));
  assert.equal(rejectedInvalidCheckout.body.result.ok, false);
  assert.equal(rejectedInvalidCheckout.body.result.code, 'worknode-use-hash-conflict');
  const invalidNode = repository.getWorkNode('node-invalid-timeline');
  const rejectedInvalidShape = await generic('def.worknode.checkout_and_verify', {
    nodeId: 'node-invalid-timeline', expectedRevision: 303,
    expectedWorkingHash: (await import('../agent/runtime/def-node-workspace/codec.mjs')).hashDefNodeValue(invalidNode.workingPayload),
  }, 'session-a');
  assert.equal(rejectedInvalidShape.status, 200, JSON.stringify(rejectedInvalidShape.body));
  assert.equal(rejectedInvalidShape.body.result.ok, false);
  assert.equal(rejectedInvalidShape.body.result.code, 'worknode-visible-payload-invalid');
  assert.equal(repository.getCheckoutRef('formal-a').targetId, 'node-a-only', 'invalid button identity must not touch checkout');

  const unreviewedOperatorConfig = await generic('def.operator.config.prepare', {
    __defTurnId: 'unreviewed-operator-config-attempt',
  }, 'session-a');
  assert.equal(unreviewedOperatorConfig.status, 409, JSON.stringify(unreviewedOperatorConfig.body));
  assert.equal(unreviewedOperatorConfig.body.result.code, 'operator-config-explicit-review-required');
  assert.equal(repository.getCheckoutRef('formal-a').targetId, 'node-a-only', 'an unreviewed operator configuration must not create a branch or touch checkout');

  const nativeServerSource = fs.readFileSync(path.join(process.cwd(), 'agent/server/def-agent-server.cjs'), 'utf8');
  const contextRoute = nativeServerSource.slice(
    nativeServerSource.indexOf("requestUrl.pathname === '/api/native/context'"),
    nativeServerSource.indexOf("requestUrl.pathname === '/api/chat'"),
  );
  assert(contextRoute.includes('await awaitNativeWorkbenchCheckoutProjection(binding);'),
    'native context attach must await the authenticated Canvas projection before accepting the attachment');
  assert(contextRoute.indexOf('await awaitNativeWorkbenchCheckoutProjection(binding);')
    < contextRoute.indexOf('writeNativeWorkbenchContext(body.directory, body.sessionID, body.context);'),
  );
  assert.equal((nativeServerSource.match(/await cleanupFailedNativeSessionCreate\(session\);/g) || []).length, 1,
    'create cleanup must have exactly one call site');
  const createRoute = nativeServerSource.slice(
    nativeServerSource.indexOf("requestUrl.pathname === '/api/native/session'"),
    nativeServerSource.indexOf('const nativeSessionRecovery ='),
  );
  assert(createRoute.includes('session = await createNativeHostSession('));
  assert(createRoute.includes('const axisContext = await syncNativeWorkbenchAxisBinding(binding);'));
  assert(createRoute.includes('await cleanupFailedNativeSessionCreate(session);'));
  const cleanupHelper = nativeServerSource.slice(
    nativeServerSource.indexOf('async function cleanupFailedNativeSessionCreate(session)'),
    nativeServerSource.indexOf('const server = http.createServer'),
  );
  assert(cleanupHelper.includes('readNativeSessionBinding(session.directory, session.sessionID'));
  assert(cleanupHelper.includes('removeNativeWorkbenchAxisBinding(binding)'));
  assert(cleanupHelper.includes("fs.rmSync(session.directory, { recursive: true, force: true })"));
  assert(!cleanupHelper.includes('recoverNativeHostSession'));

  const registry = createDefToolRegistry(DEF_TOOL_DEFINITION_BASE);
  assert(registry.length > 50);
  for (const tool of registry) {
    assert(Object.values(DEF_WORKSPACE_SCOPE).includes(tool.workspaceScope), tool.name);
    assert(Object.values(DEF_PROJECTION_ACCESS).includes(tool.projectionAccess), tool.name);
    assert(Array.isArray(tool.allowedHosts), tool.name);
    assert.equal(typeof tool.requiresCheckout, 'boolean', tool.name);
    assert.equal(typeof tool.internalOnly, 'boolean', tool.name);
  }
  for (const name of ['def.operator.config.prepare', 'def.operator.config.apply_prepared', 'def.operator.config.discard_prepared', 'def.team.loadout.plan.apply.prepare', 'def.team.loadout.plan.apply.discard']) {
    const policy = resolveDefToolAccessPolicy(name, { name, riskLevel: 'read' });
    assert.equal(policy.workspaceScope, DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT, name);
    assert.equal(policy.projectionAccess, DEF_PROJECTION_ACCESS.CURRENT_WRITE, name);
    assert.equal(policy.requiresCheckout, true, name);
  }

  const routeMap = await request('/api/def-tools/route-map');
  assert.equal(routeMap.status, 200, JSON.stringify(routeMap.body));
  const routed = routeMap.body.result.families.flatMap((family) => family.legacyTools);
  assert(!routed.some((tool) => tool.internalOnly || tool.id.includes('bind_session_axis') || tool.id.includes('assert_session_axis')));
  assert(routed.every((tool) => tool.workspaceScope && tool.projectionAccess && Array.isArray(tool.allowedHosts)));

  const deniedInternal = await generic('def.workbench.assert_timeline_admission', { timelineId: 'formal-a' });
  assert.equal(deniedInternal.status, 403, JSON.stringify(deniedInternal.body));
  assert.equal(deniedInternal.body.error.code, 'denied-internal-governance');
  const deniedTemporary = await request('/api/def-tools/call', {
    method: 'POST', internal: true,
    body: { tool: 'def.workbench.assert_timeline_admission', input: { timelineId: 'temporary-a' } },
  });
  assert.equal(deniedTemporary.status, 409, JSON.stringify(deniedTemporary.body));
  assert.equal(deniedTemporary.body.error.code, 'blocked-temporary-workspace');
  const hiddenInternal = await request('/api/def-tools/describe?name=def.workbench.bind_session_axis');
  assert.equal(hiddenInternal.status, 404, JSON.stringify(hiddenInternal.body));

  const crossUnbind = await request('/api/def-tools/call', {
    method: 'POST', internal: true,
    body: { tool: 'def.workbench.unbind_session_axis', input: { sessionBindingId: 'axis-owner', sessionID: 'session-a' } },
  });
  assert.equal(crossUnbind.status, 409, JSON.stringify(crossUnbind.body));
  assert(repository.getSessionAxisBinding('axis-owner'));

  await mirror('formal-a', 'A');
  const readA = await generic('def.character.resolve', { query: 'Operator A ONLY' }, 'session-a');
  assert.equal(readA.status, 200, JSON.stringify(readA.body));
  assert(JSON.stringify(readA.body).includes('Operator A ONLY'));
  const nodesA = await generic('def.worknode.list', {}, 'session-a');
  assert.equal(nodesA.status, 200, JSON.stringify(nodesA.body));
  assert(JSON.stringify(nodesA.body).includes('node-a-only'));
  assert(!JSON.stringify(nodesA.body).includes('node-b-only'));

  const forgedTreeBefore = treeState();
  const forgedQueueBefore = await request('/api/main-workbench/commands', { internal: true });
  await mirror('formal-a', 'B');
  const forgedSameTimeline = await generic('def.character.resolve', {}, 'session-a');
  assert.equal(forgedSameTimeline.status, 409, JSON.stringify(forgedSameTimeline.body));
  assert.equal(forgedSameTimeline.body.error.code, 'blocked-session-mismatch');
  assert.deepEqual(treeState(), forgedTreeBefore);
  assert.deepEqual((await request('/api/main-workbench/commands', { internal: true })).body, forgedQueueBefore.body);
  await mirror('formal-a', 'A');

  const productGateQueueBefore = await request('/api/main-workbench/commands', { internal: true });
  const unavailableWeaponPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { name: 'active-catalog-only-weapon' },
  }, 'session-a');
  assert.equal(unavailableWeaponPreview.status, 409, JSON.stringify(unavailableWeaponPreview.body));
  assert.equal(unavailableWeaponPreview.body.result?.code, 'operator-config-weapon-library-unavailable', JSON.stringify(unavailableWeaponPreview.body));
  const unavailableEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    equipment: { equipmentId: 'active-catalog-only-equipment', slotKey: 'armor' },
  }, 'session-a');
  assert.equal(unavailableEquipmentPreview.status, 409, JSON.stringify(unavailableEquipmentPreview.body));
  assert.equal(unavailableEquipmentPreview.body.result?.code, 'operator-config-equipment-library-unavailable', JSON.stringify(unavailableEquipmentPreview.body));
  assert.deepEqual((await request('/api/main-workbench/commands', { internal: true })).body, productGateQueueBefore.body, 'catalog-to-product boundary must block before enqueueing a renderer preview');

  const publicCalls = [
    ['def.operator.catalog.search', { query: '' }],
    ['def.weapon.resolve', { query: '' }],
    ['def.knowledge.game.search', { query: '伤害' }],
    ['def.buff.resolve', { query: '' }],
    ['def.equipment.resolve', { query: '' }],
    ['def.gear.resolve', { query: '' }],
  ];
  for (const [tool, input] of publicCalls) {
    const response = await generic(tool, input);
    assert.equal(response.status, 200, `${tool}: ${JSON.stringify(response.body)}`);
    const serialized = JSON.stringify(response.body);
    assert(!serialized.includes('Operator A ONLY') && !serialized.includes('Equipment A ONLY') && !serialized.includes('Damage A ONLY'), tool);
    if (['def.buff.resolve', 'def.equipment.resolve', 'def.gear.resolve'].includes(tool)) {
      assert.equal(response.body.result.scope, 'public-catalog', tool);
      assert(response.body.result.candidates.every((candidate) => candidate.scope === 'public-catalog'), tool);
    }
  }

  const treeBefore = treeState();
  const queueBefore = await request('/api/main-workbench/commands', { internal: true });
  const deniedDirectQueue = await request('/api/main-workbench/commands/enqueue', {
    method: 'POST', body: { command: { op: 'refreshSnapshot' }, sessionId: 'session-a' },
  });
  assert.equal(deniedDirectQueue.status, 403, JSON.stringify(deniedDirectQueue.body));
  assert.equal(deniedDirectQueue.body.error.code, 'denied-internal-transport');
  const snapshotBefore = await request('/api/main-workbench/snapshot', { internal: true });
  await mirror('formal-b', 'B');
  const mismatchSnapshot = await request('/api/main-workbench/snapshot', { internal: true });
  const catalogOnlyAcrossMismatch = await generic('def.equipment.resolve', { query: '', catalogOnly: true }, 'session-a');
  assert.equal(catalogOnlyAcrossMismatch.status, 200, JSON.stringify(catalogOnlyAcrossMismatch.body));
  assert.equal(catalogOnlyAcrossMismatch.body.result.scope, 'public-catalog');
  assert(catalogOnlyAcrossMismatch.body.result.candidates.every((candidate) => candidate.scope === 'public-catalog'));
  const tools = currentRegistryTools();
  for (const tool of tools) {
    const input = tool.workspaceScope === DEF_WORKSPACE_SCOPE.WORKNODE_TREE ? { nodeId: 'node-a-only' } : {};
    const typedResult = await generic(tool.name, input, 'session-a');
    const legacyResult = await legacy(tool.name, input, 'session-a');
    assert.equal(typedResult.status, 409, `${tool.name} generic: ${JSON.stringify(typedResult.body)}`);
    assert.equal(typedResult.body.error.code, 'blocked-session-mismatch', tool.name);
    assert.equal(legacyResult.status, typedResult.status, tool.name);
    assert.equal(legacyResult.body.error.code, typedResult.body.error.code, tool.name);
    assert(!JSON.stringify(typedResult.body).includes('Operator B ONLY'), tool.name);
  }
  assert.deepEqual(treeState(), treeBefore);
  const queueAfter = await request('/api/main-workbench/commands', { internal: true });
  assert.deepEqual(queueAfter.body, queueBefore.body, 'current gate rejection must not enqueue commands');
  const snapshotAfter = await request('/api/main-workbench/snapshot', { internal: true });
  assert.deepEqual(snapshotAfter.body, mismatchSnapshot.body, 'current gate rejection must not mutate the snapshot mirror');
  assert.notDeepEqual(snapshotBefore.body, snapshotAfter.body, 'A/B fixture must actually differ');

  for (const tool of strictBindingTools()) {
    const unbound = await generic(tool.name, {}, '');
    assert.equal(unbound.status, 403, `${tool.name}: ${JSON.stringify(unbound.body)}`);
    assert.equal(unbound.body.error.code, 'blocked-binding', tool.name);
  }
  for (const [sessionId, expectedCode] of [['session-stale', 'blocked-binding-stale']]) {
    const response = await generic('def.character.resolve', {}, sessionId);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, expectedCode);
  }

  console.log(`DEF Workbench metadata/current-tool policy contract: PASS (${tools.length} current/tree tools)`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  repository.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
