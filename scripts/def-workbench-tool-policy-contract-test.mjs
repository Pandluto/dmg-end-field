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
import { applyOperatorConfigWeaponIdentityToSnapshot } from '../src/core/services/operatorConfigWeaponIdentity.ts';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const { createCatalogDatabase } = require('../electron/data-management-service.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-workbench-tool-policy-'));
const port = 18700 + Math.floor(Math.random() * 300);
const databasePath = path.join(root, 'timeline.sqlite');
const builtinCatalogPath = path.join(root, 'catalog.sqlite');
const nowStoragePath = path.join(root, 'now-storage.json');
const internalToken = 'tool-policy-contract-native-host';
const repository = createTimelineRepository({ databasePath });

const localWeapon = { id: 'weapon-local', name: 'Weapon Local', type: 'test', skills: {} };
const activeOnlyWeapon = { id: 'weapon-active-only', name: 'Weapon Active Only', type: 'test', skills: {} };
const localSameNameWeapon = { id: 'weapon-local-same-name', name: 'Weapon Shared Name', type: 'test', skills: {} };
const activeSameNameWeapon = { id: 'weapon-active-same-name', name: 'Weapon Shared Name', type: 'test', skills: {} };
const localDifferentNameWeapon = { id: 'weapon-local-different-name', name: 'Weapon Local Different Name', type: 'test', skills: {} };
const localOnlyWeapon = { id: 'weapon-local-only', name: 'Weapon Local Only', type: 'test', skills: {} };
const collisionWeaponA = { id: 'weapon-collision-a', name: 'Weapon Collision', type: 'test', attackGrowth: { 90: 111 }, skills: {} };
const collisionWeaponB = { id: 'weapon-collision-b', name: 'Weapon Collision', type: 'test', attackGrowth: { 90: 222 }, skills: {} };
const duplicateIdWeapon = { id: 'weapon-duplicate-id', name: 'Weapon Duplicate Id', type: 'test', skills: {} };
const localEquipment = { equipmentId: 'equipment-local', name: 'Equipment Local', part: 'armor', effects: {} };
const activeOnlyEquipment = { equipmentId: 'equipment-active-only', name: 'Equipment Active Only', part: 'armor', effects: {} };
const localOnlyEquipment = { equipmentId: 'equipment-local-only', name: 'Equipment Local Only', part: 'armor', effects: {} };
const localSameNameEquipment = { equipmentId: 'equipment-local-same-name', name: 'Equipment Shared Name', part: 'armor', effects: {} };
const activeSameNameEquipment = { equipmentId: 'equipment-active-same-name', name: 'Equipment Shared Name', part: 'armor', effects: {} };
const completeSetPieces = {
  armor: { equipmentId: 'equipment-complete-armor', name: 'Complete Armor', part: '护甲', effects: {} },
  glove: { equipmentId: 'equipment-complete-glove', name: 'Complete Glove', part: '护手', effects: {} },
  accessoryA: { equipmentId: 'equipment-complete-accessory-a', name: 'Complete Accessory A', part: '配件', effects: {} },
  accessoryB: { equipmentId: 'equipment-complete-accessory-b', name: 'Complete Accessory B', part: '配件', effects: {} },
};
const completeGearSet = { gearSetId: 'gear-complete', name: 'Gear Complete', equipments: completeSetPieces };
const duplicateIdEquipment = { equipmentId: 'equipment-duplicate-id', name: 'Equipment Duplicate Id', part: 'armor', effects: {} };
const localEquipmentLibrary = {
  gearSets: {
    local: { gearSetId: 'gear-local', name: 'Gear Local', equipments: { [localEquipment.equipmentId]: localEquipment } },
    localOnly: { gearSetId: 'gear-local-only', name: 'Gear Local Only', equipments: { [localOnlyEquipment.equipmentId]: localOnlyEquipment } },
    localSameName: { gearSetId: 'gear-local-same-name', name: 'Gear Shared Local', equipments: { [localSameNameEquipment.equipmentId]: localSameNameEquipment } },
    complete: completeGearSet,
    duplicateA: { gearSetId: 'gear-duplicate-a', name: 'Gear Duplicate A', equipments: { first: duplicateIdEquipment } },
    duplicateB: { gearSetId: 'gear-duplicate-b', name: 'Gear Duplicate B', equipments: { second: duplicateIdEquipment } },
  },
};
const activeEquipmentLibrary = {
  gearSets: {
    local: { gearSetId: 'gear-local', name: 'Gear Local', equipments: { [localEquipment.equipmentId]: localEquipment } },
    activeOnly: { gearSetId: 'gear-active-only', name: 'Gear Active Only', equipments: { [activeOnlyEquipment.equipmentId]: activeOnlyEquipment } },
    activeSameName: { gearSetId: 'gear-active-same-name', name: 'Gear Shared Active', equipments: { [activeSameNameEquipment.equipmentId]: activeSameNameEquipment } },
    complete: completeGearSet,
    duplicate: { gearSetId: 'gear-duplicate-active', name: 'Gear Duplicate Active', equipments: { [duplicateIdEquipment.equipmentId]: duplicateIdEquipment } },
  },
};
const localWeaponLibrary = {
  [localWeapon.id]: localWeapon,
  [localSameNameWeapon.id]: localSameNameWeapon,
  [localDifferentNameWeapon.id]: localDifferentNameWeapon,
  [localOnlyWeapon.id]: localOnlyWeapon,
  [collisionWeaponA.id]: collisionWeaponA,
  [collisionWeaponB.id]: collisionWeaponB,
  duplicateA: duplicateIdWeapon,
  duplicateB: duplicateIdWeapon,
};

createCatalogDatabase({
  databasePath: builtinCatalogPath,
  dataVersion: 'tool-policy-contract-v2',
  weapons: [localWeapon, activeOnlyWeapon, activeSameNameWeapon, localDifferentNameWeapon, collisionWeaponA, collisionWeaponB, duplicateIdWeapon]
    .map((weapon) => ({ id: weapon.id, name: weapon.name, payload: weapon })),
  equipments: Object.values(activeEquipmentLibrary.gearSets).flatMap((gearSet) => Object.values(gearSet.equipments).map((equipment) => ({
    id: equipment.equipmentId,
    name: equipment.name,
    payload: { ...equipment, gearSetId: gearSet.gearSetId },
  }))),
  equipmentSets: Object.values(activeEquipmentLibrary.gearSets)
    .map((gearSet) => ({ id: gearSet.gearSetId, name: gearSet.name, payload: gearSet })),
});

function writeProductArchive() {
  fs.writeFileSync(nowStoragePath, `${JSON.stringify({
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'tool-policy-product-library',
    exportedAt: new Date().toISOString(),
    storage: {
      local: {
        'def.weapon-sheet.library.v1': localWeaponLibrary,
        'def.equipment-sheet.library.v1': localEquipmentLibrary,
      },
      session: {},
    },
  }, null, 2)}\n`, 'utf8');
}

writeProductArchive();

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
    AI_CLI_NOW_STORAGE_PATH: nowStoragePath,
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

async function mirror(timelineId, sentinel, operatorConfigOverride = null) {
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
      operatorConfigs: [operatorConfigOverride || { characterId: `operator-${sentinel}`, characterName: `Operator ${sentinel} ONLY`, weapon: { id: `weapon-${sentinel}`, name: `Weapon ${sentinel} ONLY`, level: 90, potential: '0潜' }, equipment: [{ slotKey: 'armor', equipmentId: `equipment-${sentinel}`, name: `Equipment ${sentinel} ONLY`, effects: [] }] }],
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

async function waitForQueuedCommand(op) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const queue = await request('/api/main-workbench/commands', { internal: true });
    const command = queue.body.commands?.find((entry) => entry.command?.op === op && entry.status === 'pending');
    if (command) return command;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for queued ${op} command.`);
}

function persistLocalWeaponToCheckout() {
  const node = repository.getWorkNode('node-a-only');
  const workingPayload = structuredClone(node.workingPayload);
  workingPayload.operatorConfigPageCache['operator-A'].weapon = {
    ...workingPayload.operatorConfigPageCache['operator-A'].weapon,
    id: localWeapon.id,
    name: localWeapon.name,
  };
  repository.importWorkNode({
    ...node,
    workingPayload,
    contentRevision: node.contentRevision,
    updatedAt: node.updatedAt,
    migration: true,
  });
}

function preparePayloadForFinalConfig(parentPayload, finalConfig) {
  const preparedPayload = structuredClone(parentPayload);
  const current = preparedPayload.operatorConfigPageCache?.[finalConfig.characterId] || {};
  preparedPayload.operatorConfigPageCache = {
    ...(preparedPayload.operatorConfigPageCache || {}),
    [finalConfig.characterId]: {
      ...current,
      operator: {
        ...(current.operator || {}),
        name: finalConfig.characterName,
        skillConfig: finalConfig.operatorSkillLevels || {},
      },
      weapon: {
        ...(current.weapon || {}),
        id: finalConfig.weapon.id,
        name: finalConfig.weapon.name,
        config: {
          ...(current.weapon?.config || {}),
          level: finalConfig.weapon.level,
          potential: finalConfig.weapon.potential,
          skillLevels: finalConfig.weapon.skillLevels || {},
        },
      },
      equipment: {
        ...(current.equipment || {}),
        pieces: finalConfig.equipment.map((piece) => ({
          ...piece,
          effects: (piece.effects || []).map((effect) => ({ ...effect })),
        })),
      },
    },
  };
  return preparedPayload;
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
  const productGateTreeBefore = treeState();
  const productGateSnapshotBefore = await request('/api/main-workbench/snapshot', { internal: true });
  const unavailableWeaponPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: activeOnlyWeapon.id, name: activeOnlyWeapon.name },
  }, 'session-a');
  assert.equal(unavailableWeaponPreview.status, 409, JSON.stringify(unavailableWeaponPreview.body));
  assert.equal(unavailableWeaponPreview.body.result?.code, 'operator-config-weapon-library-unavailable', JSON.stringify(unavailableWeaponPreview.body));
  const unavailableEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    equipment: { equipmentId: activeOnlyEquipment.equipmentId, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(unavailableEquipmentPreview.status, 409, JSON.stringify(unavailableEquipmentPreview.body));
  assert.equal(unavailableEquipmentPreview.body.result?.code, 'operator-config-equipment-library-unavailable', JSON.stringify(unavailableEquipmentPreview.body));
  const unavailableDirectPatch = await generic('def.operator.config.patch', {
    characterId: 'operator-A',
    weapon: { id: activeOnlyWeapon.id, name: activeOnlyWeapon.name },
  }, 'session-a');
  assert.equal(unavailableDirectPatch.status, 409, JSON.stringify(unavailableDirectPatch.body));
  assert.equal(unavailableDirectPatch.body.result?.code, 'operator-config-weapon-library-unavailable', JSON.stringify(unavailableDirectPatch.body));
  const nameOnlyWeaponPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { name: localWeapon.name },
  }, 'session-a');
  assert.equal(nameOnlyWeaponPreview.status, 409, JSON.stringify(nameOnlyWeaponPreview.body));
  assert.equal(nameOnlyWeaponPreview.body.result?.code, 'operator-config-weapon-id-required', JSON.stringify(nameOnlyWeaponPreview.body));
  const sameNameDifferentIdPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: activeSameNameWeapon.id, name: activeSameNameWeapon.name },
  }, 'session-a');
  assert.equal(sameNameDifferentIdPreview.status, 409, JSON.stringify(sameNameDifferentIdPreview.body));
  assert.equal(sameNameDifferentIdPreview.body.result?.code, 'operator-config-weapon-library-unavailable', JSON.stringify(sameNameDifferentIdPreview.body));
  const forgedWeaponIdentityPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: localDifferentNameWeapon.id, name: localSameNameWeapon.name },
  }, 'session-a');
  assert.equal(forgedWeaponIdentityPreview.status, 409, JSON.stringify(forgedWeaponIdentityPreview.body));
  assert.equal(forgedWeaponIdentityPreview.body.result?.code, 'operator-config-weapon-identity-mismatch', JSON.stringify(forgedWeaponIdentityPreview.body));
  const localOnlyWeaponPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: localOnlyWeapon.id, name: localOnlyWeapon.name },
  }, 'session-a');
  assert.equal(localOnlyWeaponPreview.status, 409, JSON.stringify(localOnlyWeaponPreview.body));
  assert.equal(localOnlyWeaponPreview.body.result?.code, 'operator-config-weapon-active-unavailable');
  const duplicateIdWeaponPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', weapon: { id: duplicateIdWeapon.id, name: duplicateIdWeapon.name },
  }, 'session-a');
  assert.equal(duplicateIdWeaponPreview.status, 409, JSON.stringify(duplicateIdWeaponPreview.body));
  assert.equal(duplicateIdWeaponPreview.body.result?.code, 'operator-config-weapon-library-ambiguous');
  const nameOnlyEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', equipment: { equipmentName: localEquipment.name, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(nameOnlyEquipmentPreview.status, 409, JSON.stringify(nameOnlyEquipmentPreview.body));
  assert.equal(nameOnlyEquipmentPreview.body.result?.code, 'operator-config-equipment-id-required');
  const nameOnlyGearSetPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', gearSetName: 'Gear Local', fillSlots: true,
  }, 'session-a');
  assert.equal(nameOnlyGearSetPreview.status, 409, JSON.stringify(nameOnlyGearSetPreview.body));
  assert.equal(nameOnlyGearSetPreview.body.result?.code, 'operator-config-gear-set-id-required');
  const implicitGearSetFillPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', gearSetId: completeGearSet.gearSetId, gearSetName: completeGearSet.name,
  }, 'session-a');
  assert.equal(implicitGearSetFillPreview.status, 409, JSON.stringify(implicitGearSetFillPreview.body));
  assert.equal(implicitGearSetFillPreview.body.result?.code, 'operator-config-gear-set-fill-required');
  const localOnlyEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', equipment: { equipmentId: localOnlyEquipment.equipmentId, equipmentName: localOnlyEquipment.name, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(localOnlyEquipmentPreview.status, 409, JSON.stringify(localOnlyEquipmentPreview.body));
  assert.equal(localOnlyEquipmentPreview.body.result?.code, 'operator-config-equipment-active-unavailable');
  const duplicateIdEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', equipment: { equipmentId: duplicateIdEquipment.equipmentId, equipmentName: duplicateIdEquipment.name, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(duplicateIdEquipmentPreview.status, 409, JSON.stringify(duplicateIdEquipmentPreview.body));
  assert.equal(duplicateIdEquipmentPreview.body.result?.code, 'operator-config-equipment-library-ambiguous');
  const activeSameNameEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', equipment: { equipmentId: activeSameNameEquipment.equipmentId, equipmentName: activeSameNameEquipment.name, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(activeSameNameEquipmentPreview.status, 409, JSON.stringify(activeSameNameEquipmentPreview.body));
  assert.equal(activeSameNameEquipmentPreview.body.result?.code, 'operator-config-equipment-library-unavailable');
  const localSameNameEquipmentPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', equipment: { equipmentId: localSameNameEquipment.equipmentId, equipmentName: localSameNameEquipment.name, slotKey: 'armor' },
  }, 'session-a');
  assert.equal(localSameNameEquipmentPreview.status, 409, JSON.stringify(localSameNameEquipmentPreview.body));
  assert.equal(localSameNameEquipmentPreview.body.result?.code, 'operator-config-equipment-active-unavailable');
  assert.deepEqual((await request('/api/main-workbench/commands', { internal: true })).body, productGateQueueBefore.body, 'active-only, name-only, and same-name-different-id products must block before enqueueing');
  assert.deepEqual(treeState(), productGateTreeBefore, 'blocked products must not create a horizontal branch');
  assert.deepEqual(await request('/api/main-workbench/snapshot', { internal: true }), productGateSnapshotBefore, 'blocked products must not change the live Workbench mirror');

  const mismatchedRendererPreviewPending = generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: collisionWeaponA.id, name: collisionWeaponA.name },
    __defTurnId: 'mismatched-renderer-product-preview',
  }, 'session-a');
  const mismatchedPreviewCommand = await waitForQueuedCommand('previewOperatorConfig');
  const mismatchedPreviewParent = repository.getWorkNode('node-a-only');
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: mismatchedPreviewCommand.id,
      status: 'done',
      result: {
        parentNodeId: mismatchedPreviewParent.id,
        parentRevision: mismatchedPreviewParent.contentRevision,
        preparedPayload: structuredClone(mismatchedPreviewParent.workingPayload),
        finalConfig: {
          characterId: 'operator-A', characterName: 'Operator A ONLY',
          weapon: { id: collisionWeaponB.id, name: collisionWeaponB.name, level: 90, potential: '0潜', skillLevels: {} },
          equipment: [], operatorSkillLevels: {},
        },
      },
    },
  });
  const mismatchedRendererPreview = await mismatchedRendererPreviewPending;
  assert.equal(mismatchedRendererPreview.status, 409, JSON.stringify(mismatchedRendererPreview.body));
  assert.equal(mismatchedRendererPreview.body.result?.code, 'operator-config-preview-product-mismatch');
  assert.equal(Boolean(mismatchedRendererPreview.body.result?.proposalToken), false, 'a wrong renderer id must not mint a proposal');

  const payloadMismatchTreeBefore = treeState();
  const payloadMismatchPending = generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: collisionWeaponA.id, name: collisionWeaponA.name },
    __defTurnId: 'mismatched-renderer-payload-preview',
  }, 'session-a');
  const payloadMismatchCommand = await waitForQueuedCommand('previewOperatorConfig');
  const payloadMismatchFinalConfig = {
    characterId: 'operator-A', characterName: 'Operator A ONLY',
    weapon: { id: collisionWeaponA.id, name: collisionWeaponA.name, level: 90, potential: '0潜', skillLevels: {} },
    equipment: [], operatorSkillLevels: {},
  };
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: payloadMismatchCommand.id,
      status: 'done',
      result: {
        parentNodeId: mismatchedPreviewParent.id,
        parentRevision: mismatchedPreviewParent.contentRevision,
        preparedPayload: structuredClone(mismatchedPreviewParent.workingPayload),
        finalConfig: payloadMismatchFinalConfig,
      },
    },
  });
  const payloadMismatch = await payloadMismatchPending;
  assert.equal(payloadMismatch.status, 409, JSON.stringify(payloadMismatch.body));
  assert.equal(payloadMismatch.body.result?.code, 'operator-config-preview-payload-mismatch');
  assert.equal(Boolean(payloadMismatch.body.result?.proposalToken), false, 'a divergent prepared payload must not mint a proposal');
  assert.deepEqual(treeState(), payloadMismatchTreeBefore, 'a divergent prepared payload must block before branch creation');

  const validPreviewPending = generic('def.operator.config.preview', {
    characterId: 'operator-A',
    weapon: { id: localWeapon.id, name: localWeapon.name },
    __defTurnId: 'valid-local-product-preview',
  }, 'session-a');
  const previewCommand = await waitForQueuedCommand('previewOperatorConfig');
  assert.equal(previewCommand.command.request.weaponId, localWeapon.id, 'preview must preserve the stable weapon id after product gating');
  assert.equal(previewCommand.command.request.weaponName, localWeapon.name, 'preview must use the matching local canonical product name');
  const previewParent = repository.getWorkNode('node-a-only');
  const renderedWeapon = applyOperatorConfigWeaponIdentityToSnapshot(
    { weapon: { id: 'previous', name: 'Previous' } },
    localWeaponLibrary,
    { id: previewCommand.command.request.weaponId, name: previewCommand.command.request.weaponName },
  ).snapshot.weapon;
  const validPreviewFinalConfig = {
    characterId: 'operator-A',
    characterName: 'Operator A ONLY',
    weapon: { id: renderedWeapon.id, name: renderedWeapon.name, level: 90, potential: '0潜', skillLevels: {} },
    equipment: [],
    operatorSkillLevels: {},
  };
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: previewCommand.id,
      status: 'done',
      result: {
        parentNodeId: previewParent.id,
        parentRevision: previewParent.contentRevision,
        preparedPayload: preparePayloadForFinalConfig(previewParent.workingPayload, validPreviewFinalConfig),
        finalConfig: validPreviewFinalConfig,
      },
    },
  });
  const validPreview = await validPreviewPending;
  assert.equal(validPreview.status, 200, JSON.stringify(validPreview.body));
  assert.equal(validPreview.body.result.finalConfig.weapon.id, localWeapon.id);

  const validEquipmentPreviewPending = generic('def.operator.config.preview', {
    characterId: 'operator-A',
    equipment: { equipmentId: localEquipment.equipmentId, equipmentName: localEquipment.name, slotKey: 'armor' },
    __defTurnId: 'valid-active-local-equipment-preview',
  }, 'session-a');
  const equipmentPreviewCommand = await waitForQueuedCommand('previewOperatorConfig');
  assert.equal(equipmentPreviewCommand.command.request.equipments[0].equipmentId, localEquipment.equipmentId);
  assert.equal(equipmentPreviewCommand.command.request.equipments[0].equipmentName, localEquipment.name);
  const validEquipmentFinalConfig = {
    characterId: 'operator-A', characterName: 'Operator A ONLY',
    weapon: { id: 'weapon-A', name: 'Weapon A ONLY', level: 90, potential: '0潜', skillLevels: {} },
    equipment: [{ slotKey: 'armor', equipmentId: localEquipment.equipmentId, name: localEquipment.name, effects: [] }],
    operatorSkillLevels: {},
  };
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: equipmentPreviewCommand.id,
      status: 'done',
      result: {
        parentNodeId: previewParent.id,
        parentRevision: previewParent.contentRevision,
        preparedPayload: preparePayloadForFinalConfig(previewParent.workingPayload, validEquipmentFinalConfig),
        finalConfig: validEquipmentFinalConfig,
      },
    },
  });
  const validEquipmentPreview = await validEquipmentPreviewPending;
  assert.equal(validEquipmentPreview.status, 200, JSON.stringify(validEquipmentPreview.body));
  assert.equal(validEquipmentPreview.body.result.finalConfig.equipment[0].equipmentId, localEquipment.equipmentId);

  const validGearSetPreviewPending = generic('def.operator.config.preview', {
    characterId: 'operator-A', gearSetId: completeGearSet.gearSetId, gearSetName: completeGearSet.name, fillSlots: true,
    __defTurnId: 'valid-active-local-gear-set-preview',
  }, 'session-a');
  const gearSetPreviewCommand = await waitForQueuedCommand('previewOperatorConfig');
  assert.equal(gearSetPreviewCommand.command.request.gearSetId, completeGearSet.gearSetId);
  assert.equal(gearSetPreviewCommand.command.request.gearSetName, completeGearSet.name);
  assert.equal(gearSetPreviewCommand.command.request.fillSlots, true);
  assert.deepEqual(
    gearSetPreviewCommand.command.request.equipments.map((piece) => [piece.slotKey, piece.equipmentId]),
    [
      ['armor', completeSetPieces.armor.equipmentId],
      ['glove', completeSetPieces.glove.equipmentId],
      ['accessory1', completeSetPieces.accessoryA.equipmentId],
      ['accessory2', completeSetPieces.accessoryB.equipmentId],
    ],
    'set fill must be rewritten to four canonical active/local stable ids before enqueue',
  );
  const validGearSetFinalConfig = {
    characterId: 'operator-A', characterName: 'Operator A ONLY',
    weapon: { id: 'weapon-A', name: 'Weapon A ONLY', level: 90, potential: '0潜', skillLevels: {} },
    equipment: gearSetPreviewCommand.command.request.equipments.map((piece) => ({
      slotKey: piece.slotKey, equipmentId: piece.equipmentId, name: piece.equipmentName, effects: [],
    })),
    operatorSkillLevels: {},
  };
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: gearSetPreviewCommand.id,
      status: 'done',
      result: {
        parentNodeId: previewParent.id,
        parentRevision: previewParent.contentRevision,
        preparedPayload: preparePayloadForFinalConfig(previewParent.workingPayload, validGearSetFinalConfig),
        finalConfig: validGearSetFinalConfig,
      },
    },
  });
  const validGearSetPreview = await validGearSetPreviewPending;
  assert.equal(validGearSetPreview.status, 200, JSON.stringify(validGearSetPreview.body));
  assert.equal(validGearSetPreview.body.result.finalConfig.equipment.length, 4);

  const validPatchPending = generic('def.operator.config.patch', {
    characterId: 'operator-A',
    weapon: { id: localWeapon.id, name: localWeapon.name },
  }, 'session-a');
  const patchCommand = await waitForQueuedCommand('setOperatorWeapon');
  assert.equal(patchCommand.command.weaponId, localWeapon.id, 'direct legacy patch must preserve the stable weapon id after product gating');
  persistLocalWeaponToCheckout();
  await mirror('formal-a', 'A', {
    characterId: 'operator-A',
    characterName: 'Operator A ONLY',
    weapon: { id: localWeapon.id, name: localWeapon.name, level: 90, potential: '0潜' },
    equipment: [{ slotKey: 'armor', equipmentId: 'equipment-A', name: 'Equipment A ONLY', effects: [] }],
  });
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: patchCommand.id,
      status: 'done',
      result: {
        characterId: 'operator-A',
        characterName: 'Operator A ONLY',
        weapon: { id: localWeapon.id, name: localWeapon.name },
        persistence: { pass: true },
      },
    },
  });
  const validPatch = await validPatchPending;
  assert.equal(validPatch.status, 200, JSON.stringify(validPatch.body));
  assert.equal(validPatch.body.result.postcondition.pass, true);

  const wrongIdPatchPending = generic('def.operator.config.patch', {
    characterId: 'operator-A',
    weapon: { id: collisionWeaponA.id, name: collisionWeaponA.name },
    snapshotWaitMs: 0,
  }, 'session-a');
  const wrongIdPatchCommand = await waitForQueuedCommand('setOperatorWeapon');
  assert.equal(wrongIdPatchCommand.command.weaponId, collisionWeaponA.id);
  await mirror('formal-a', 'A', {
    characterId: 'operator-A', characterName: 'Operator A ONLY',
    weapon: { id: collisionWeaponB.id, name: collisionWeaponB.name, level: 90, potential: '0潜' },
    equipment: [{ slotKey: 'armor', equipmentId: 'equipment-A', name: 'Equipment A ONLY', effects: [] }],
  });
  await request('/api/main-workbench/commands/result', {
    method: 'POST', internal: true,
    body: {
      id: wrongIdPatchCommand.id,
      status: 'done',
      result: {
        characterId: 'operator-A', characterName: 'Operator A ONLY',
        weapon: { id: collisionWeaponB.id, name: collisionWeaponB.name },
        persistence: { pass: true },
      },
    },
  });
  const wrongIdPatch = await wrongIdPatchPending;
  assert.equal(wrongIdPatch.status, 409, JSON.stringify(wrongIdPatch.body));
  assert.equal(wrongIdPatch.body.result?.code, 'postcondition-failed');
  assert.equal(wrongIdPatch.body.result?.postcondition?.pass, false, 'direct verification must expect command.weaponId, not renderer result.weapon.id');
  await mirror('formal-a', 'A', {
    characterId: 'operator-A', characterName: 'Operator A ONLY',
    weapon: { id: localWeapon.id, name: localWeapon.name, level: 90, potential: '0潜' },
    equipment: [{ slotKey: 'armor', equipmentId: 'equipment-A', name: 'Equipment A ONLY', effects: [] }],
  });

  const invalidPointerQueueBefore = await request('/api/main-workbench/commands', { internal: true });
  const invalidPointerTreeBefore = treeState();
  const invalidPointerSnapshotBefore = await request('/api/main-workbench/snapshot', { internal: true });
  const activePointerPath = path.join(root, 'data', 'catalog', 'active.json');
  fs.mkdirSync(path.dirname(activePointerPath), { recursive: true });
  fs.writeFileSync(activePointerPath, '{}\n', 'utf8');
  const invalidPointerPreview = await generic('def.operator.config.preview', {
    characterId: 'operator-A', weapon: { id: localWeapon.id, name: localWeapon.name },
  }, 'session-a');
  assert.equal(invalidPointerPreview.status, 409, JSON.stringify(invalidPointerPreview.body));
  assert.equal(invalidPointerPreview.body.result?.code, 'active-game-catalog-active-pointer-invalid');
  assert.deepEqual((await request('/api/main-workbench/commands', { internal: true })).body, invalidPointerQueueBefore.body);
  assert.deepEqual(treeState(), invalidPointerTreeBefore);
  assert.deepEqual(await request('/api/main-workbench/snapshot', { internal: true }), invalidPointerSnapshotBefore);
  fs.rmSync(activePointerPath, { force: true });

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
