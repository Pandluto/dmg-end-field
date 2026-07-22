import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Ajv from 'ajv';
import {
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA,
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA,
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA,
  DEF_TOOL_DEFINITION_BASE,
} from '../agent/runtime/def-tools/definitions.mjs';
import {
  createDefToolRegistry,
  DEF_NATIVE_TARGETS,
  DEF_WORKSPACE_SCOPE,
} from '../agent/runtime/def-tools/registry.mjs';
import { hashDefStableValue } from './def-core/stable-json.mjs';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-equipment-3plus1-registration-'));
const port = 19700 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const internalToken = 'equipment-3plus1-registration-contract';
const nowStoragePath = path.join(root, 'now-storage.json');
const timelineRepositoryPath = path.join(root, 'timeline.sqlite3');
const workNodeDatabasePath = path.join(root, 'nodes.sqlite3');
const governancePath = path.join(root, 'governance.json');
const sessionId = 'equipment-3plus1-registration-session';
const readonlyTimelineId = 'equipment-3plus1-readonly-timeline';

const effect = (effectId, label, typeKey) => ({ effectId, label, typeKey, unit: 'percent', value: 0.2 });
const item = (equipmentId, name, part, effects) => ({
  equipmentId,
  name,
  part,
  fixedStat: { label: '防御力', typeKey: 'defense', value: 42, unit: 'flat' },
  effects,
});

const tide = {
  gearSetId: 'tide',
  name: '潮涌',
  threePieceBuffs: { bonus: effect('tide-three', '全技能', 'allSkillDmgBonus') },
  equipments: {
    armor: item('tide-armor', '潮涌护甲', '护甲', {
      ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'),
      strength: effect('strength', '力量', 'strengthBoost'),
    }),
    glove: item('tide-glove', '潮涌护手', '护手', {
      ice: effect('ice', '寒冷', 'iceDmgBonus'),
      strength: effect('strength', '力量', 'strengthBoost'),
    }),
    accessory: item('tide-accessory', '潮涌供氧栓', '配件', {
      strength: effect('strength', '力量', 'strengthBoost'),
      will: effect('will', '意志', 'willBoost'),
    }),
    accessory2: item('tide-accessory-2', '潮涌切割炬', '配件', {
      ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'),
      will: effect('will', '意志', 'willBoost'),
    }),
  },
};

const frost = {
  gearSetId: 'frost',
  name: '寒流',
  threePieceBuffs: { bonus: effect('frost-three', '全技能', 'allSkillDmgBonus') },
  equipments: {
    armor: item('frost-armor', '寒流护甲', '护甲', {
      ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'),
      strength: effect('strength', '力量', 'strengthBoost'),
    }),
    glove: item('frost-glove', '寒流护手', '护手', {
      ice: effect('ice', '寒冷', 'iceDmgBonus'),
      strength: effect('strength', '力量', 'strengthBoost'),
    }),
    accessory: item('frost-accessory', '寒流供氧栓', '配件', {
      strength: effect('strength', '力量', 'strengthBoost'),
      will: effect('will', '意志', 'willBoost'),
    }),
    accessory2: item('frost-accessory-2', '寒流切割炬', '配件', {
      ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'),
      will: effect('will', '意志', 'willBoost'),
    }),
  },
};

const operator = (id, name) => ({
  id,
  name,
  element: 'ice',
  profession: '突击',
  mainStat: '力量',
  subStat: '意志',
  skills: {
    q: {
      displayName: `${name}终结技`,
      buttonType: 'Q',
      hitMeta: { one: { levels: { M3: 8 } } },
    },
  },
});

const archive = {
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'equipment-3plus1-registration-contract',
  storage: {
    local: {
      'def.operator-editor.library.v1': {
        bieli: operator('bieli', '别礼'),
        thunder: operator('thunder', '雷电'),
        thunderclap: operator('thunderclap', '雷鸣'),
      },
      'def.equipment-sheet.library.v1': { updatedAt: 1, gearSets: { tide, frost } },
      'def.equipment-sheet.draft.v1': {},
      'def.weapon-sheet.library.v1': {},
    },
    session: {},
  },
};
fs.writeFileSync(nowStoragePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
const archiveBefore = fs.readFileSync(nowStoragePath, 'utf8');

const readonlyRepository = createTimelineRepository({ databasePath: timelineRepositoryPath });
readonlyRepository.ensureDocument({ id: readonlyTimelineId, label: '3+1 read-only contract' });
readonlyRepository.importWorkNode({
  id: 'equipment-3plus1-readonly-node',
  timelineId: readonlyTimelineId,
  branchId: 'main',
  label: 'Read-only baseline',
  status: 'ready',
  approvalPolicy: 'manual',
  basePayload: { selectedCharacters: [], timelineData: { staffLines: [] } },
  workingPayload: { selectedCharacters: [], timelineData: { staffLines: [] } },
});
readonlyRepository.setCheckoutRef({
  timelineId: readonlyTimelineId,
  targetType: 'work-node',
  targetId: 'equipment-3plus1-readonly-node',
  updatedAt: 1,
});
readonlyRepository.close();

let childStderr = '';
const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'runtime'),
    AI_CLI_NOW_STORAGE_PATH: nowStoragePath,
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: workNodeDatabasePath,
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: timelineRepositoryPath,
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_TOOL_GOVERNANCE_PATH: governancePath,
    DEF_INTERNAL_GOVERNANCE_TOKEN: internalToken,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', (chunk) => { childStderr += chunk.toString(); });
const childExited = new Promise((resolve) => {
  if (child.exitCode !== null) resolve(child.exitCode);
  else child.once('exit', resolve);
});

async function waitForReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Registration contract server exited early (${child.exitCode}). ${childStderr}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for registration contract server. ${childStderr}`);
}

async function request(pathname, { method = 'GET', body, authenticated = false } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authenticated ? { 'x-def-internal-token': internalToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: await response.json() };
}

function call(tool, input, { authenticated = true, nativeSessionId = sessionId } = {}) {
  return request('/api/def-tools/call', {
    method: 'POST',
    authenticated,
    body: { tool, input, ...(nativeSessionId ? { sessionId: nativeSessionId } : {}) },
  });
}

function recommend(input, options) {
  return call('def.equipment.3plus1.recommend', input, options);
}

async function register(nativeSessionId = sessionId) {
  return call(
    'def.native_catalog.register_session',
    { sessionId: nativeSessionId, host: 'ai-cli' },
    { authenticated: true, nativeSessionId: '' },
  );
}

async function readReadOnlyState() {
  const [checkout, commands, governance] = await Promise.all([
    request(`/api/timeline-checkout-ref?timelineId=${encodeURIComponent(readonlyTimelineId)}`, { authenticated: true }),
    request('/api/main-workbench/commands', { authenticated: true }),
    request('/api/def-tools/governance', { authenticated: true }),
  ]);
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.payload));
  assert.equal(commands.response.status, 200, JSON.stringify(commands.payload));
  assert.equal(governance.response.status, 200, JSON.stringify(governance.payload));
  return {
    checkout: checkout.payload.checkoutRef,
    commands: commands.payload.commands,
    questions: governance.payload.questions,
    approvals: governance.payload.approvals,
    sourceArchive: JSON.parse(fs.readFileSync(nowStoragePath, 'utf8')),
  };
}

async function assertReadOnlyCall(label, execute) {
  const before = await readReadOnlyState();
  const beforeHash = hashDefStableValue(before);
  const result = await execute();
  const after = await readReadOnlyState();
  const afterHash = hashDefStableValue(after);
  const message = `${label} must preserve checkout, pending commands, questions, approvals, and trusted source state`;
  assert.deepEqual(after, before, message);
  assert.equal(afterHash, beforeHash, `${label} must preserve the logical product state hash`);
  return result;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateInput = ajv.compile(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA);
const validateOutput = ajv.compile(DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA);
const validateError = ajv.compile(DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA);

try {
  await waitForReady();

  const registry = createDefToolRegistry(DEF_TOOL_DEFINITION_BASE);
  const registeredTool = registry.find((entry) => entry.id === 'def.equipment.3plus1.recommend');
  assert(registeredTool, 'the recommendation route must exist in the production registry');
  assert.equal(registeredTool.workspaceScope, DEF_WORKSPACE_SCOPE.SESSION_PRIVATE);
  assert.equal(registeredTool.canonicalTarget, 'def.data.resource.equipment_3plus1_recommend');
  assert.equal(registeredTool.handler, 'executeDefTool:def.equipment.3plus1.recommend');
  assert.equal(registeredTool.schema, DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA);
  const nativeTarget = DEF_NATIVE_TARGETS.find((entry) => entry.id === registeredTool.canonicalTarget);
  assert.equal(nativeTarget?.nativeBinding, 'def_data_equipment_3plus1_recommend');

  const liveRouteMap = await request('/api/def-tools/route-map');
  assert.equal(liveRouteMap.response.status, 200, JSON.stringify(liveRouteMap.payload));
  const liveTools = liveRouteMap.payload.result.families.flatMap((family) => family.legacyTools);
  const liveTargets = liveRouteMap.payload.result.families.flatMap((family) => family.nativeTargets);
  const liveTool = liveTools.find((entry) => entry.id === registeredTool.id);
  assert.equal(liveTool?.canonicalTarget, registeredTool.canonicalTarget);
  assert.equal(liveTool?.handler, registeredTool.handler);
  assert.equal(liveTool?.workspaceScope, DEF_WORKSPACE_SCOPE.SESSION_PRIVATE);
  assert.equal(liveTargets.find((entry) => entry.id === registeredTool.canonicalTarget)?.nativeBinding, nativeTarget.nativeBinding);

  const unauthenticated = await assertReadOnlyCall('unauthenticated recommendation', () => (
    recommend({ operatorQuery: 'bieli', __defTurnId: 'turn-unauthenticated' }, { authenticated: false })
  ));
  assert.equal(unauthenticated.response.status, 403);
  assert.equal(unauthenticated.payload.error?.code, 'denied-native-catalog-session');

  const unregistered = await assertReadOnlyCall('unregistered recommendation', () => recommend(
    { operatorQuery: 'bieli', __defTurnId: 'turn-unregistered' },
    { nativeSessionId: 'unregistered-recommendation-session' },
  ));
  assert.equal(unregistered.response.status, 403);
  assert.equal(unregistered.payload.error?.code, 'denied-native-catalog-session');

  const registration = await register();
  assert.equal(registration.response.status, 200, JSON.stringify(registration.payload));
  assert.equal(registration.payload.result?.host, 'ai-cli');
  assert.equal(registration.payload.result?.sessionId, sessionId);
  const registeredBaselineState = await readReadOnlyState();

  const missingTurn = await assertReadOnlyCall('missing-turn recommendation', () => recommend({ operatorQuery: 'bieli' }));
  assert.equal(missingTurn.response.status, 403, JSON.stringify(missingTurn.payload));
  assert.equal(validateError(missingTurn.payload.error), true, JSON.stringify(validateError.errors));
  assert.equal(missingTurn.payload.error.failureStage, 'authorize-session');
  assert.equal(missingTurn.payload.error.nextAction, 'REPORT_AND_STOP');

  for (const invalidInput of [
    { operatorQuery: 'bieli', unknown: true, __defTurnId: 'turn-unknown-field' },
    { operatorQuery: 'x'.repeat(161), __defTurnId: 'turn-too-long' },
    {
      operatorQuery: 'bieli',
      __defTurnId: 'turn-too-many-constraints',
      constraints: {
        requiredEquipmentQueries: Array.from({ length: 4 }, (_, index) => `required-${index}`),
        excludedEquipmentQueries: Array.from({ length: 8 }, (_, index) => `excluded-${index}`),
        compareEquipmentQueries: Array.from({ length: 8 }, (_, index) => ({ query: `compare-${index}` })),
      },
    },
  ]) {
    const invalid = await assertReadOnlyCall(`invalid recommendation ${invalidInput.__defTurnId}`, () => recommend(invalidInput));
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload));
    assert.equal(validateError(invalid.payload.error), true, JSON.stringify(validateError.errors));
    assert.equal(invalid.payload.error.failureStage, 'validate-input');
    assert.equal(invalid.payload.error.nextAction, 'FIX_INPUT');
  }

  const needsInput = await assertReadOnlyCall('NEEDS_INPUT recommendation', () => (
    recommend({ operatorQuery: '雷', setQuery: 'tide', __defTurnId: 'turn-needs-input' })
  ));
  assert.equal(needsInput.response.status, 200, JSON.stringify(needsInput.payload));
  assert.equal(validateOutput(needsInput.payload.result), true, JSON.stringify(validateOutput.errors));
  assert.equal(needsInput.payload.result.state, 'NEEDS_INPUT', JSON.stringify(needsInput.payload.result));
  assert.equal(needsInput.payload.result.nextQuestion.field, 'operatorQuery');

  const unresolved = await assertReadOnlyCall('UNRESOLVED recommendation', () => (
    recommend({ operatorQuery: 'missing-operator', setQuery: 'tide', __defTurnId: 'turn-unresolved' })
  ));
  assert.equal(unresolved.response.status, 200, JSON.stringify(unresolved.payload));
  assert.equal(validateOutput(unresolved.payload.result), true, JSON.stringify(validateOutput.errors));
  assert.equal(unresolved.payload.result.state, 'UNRESOLVED');

  const conflict = await assertReadOnlyCall('constraint-conflict recommendation', () => recommend({
    operatorQuery: 'bieli',
    setQuery: 'tide',
    __defTurnId: 'turn-conflict',
    constraints: { requiredEquipmentQueries: ['潮涌护甲'], excludedEquipmentQueries: ['tide-armor'] },
  }));
  assert.equal(conflict.response.status, 400, JSON.stringify(conflict.payload));
  assert.equal(validateError(conflict.payload.error), true, JSON.stringify(validateError.errors));
  assert.equal(conflict.payload.error.failureStage, 'resolve-constraints');
  assert.equal(conflict.payload.error.nextAction, 'FIX_INPUT');

  const ready = await assertReadOnlyCall('READY recommendation', () => (
    recommend({ operatorQuery: 'bieli', setQuery: 'tide', shortlistLimit: 2, __defTurnId: 'turn-ready' })
  ));
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
  assert.equal(validateOutput(ready.payload.result), true, JSON.stringify(validateOutput.errors));
  assert.equal(ready.payload.result.state, 'READY', JSON.stringify(ready.payload.result));
  assert.equal(ready.payload.result.result.selectedSet.id, 'tide');

  process.env.DEF_REST_BASE_URL = baseUrl;
  process.env.DEF_INTERNAL_GOVERNANCE_TOKEN = internalToken;
  const { data_equipment_3plus1_recommend } = await import('../agent/runtime/def-tools/opencode/def.js');
  const normalizedWrapperInput = data_equipment_3plus1_recommend.inputSchema.parse({
    operatorQuery: '  ｂｉｅｌｉ  ',
    setQuery: '  ｔｉｄｅ  ',
    shortlistLimit: 1,
  });
  assert.deepEqual(normalizedWrapperInput, { operatorQuery: 'bieli', setQuery: 'tide', shortlistLimit: 1 });
  assert.equal(validateInput(normalizedWrapperInput), true, JSON.stringify(validateInput.errors));
  const wrapperReady = await assertReadOnlyCall('OpenCode wrapper READY recommendation', () => (
    data_equipment_3plus1_recommend.execute(
      { operatorQuery: '  ｂｉｅｌｉ  ', setQuery: '  ｔｉｄｅ  ', shortlistLimit: 1 },
      { sessionID: sessionId, messageID: 'turn-wrapper-ready' },
    )
  ));
  assert.equal(validateOutput(wrapperReady), true, JSON.stringify(validateOutput.errors));
  assert.equal(wrapperReady.state, 'READY', JSON.stringify(wrapperReady));

  const readOnlyStateAfter = await readReadOnlyState();
  assert.deepEqual(readOnlyStateAfter, registeredBaselineState, 'the recommendation batch must preserve the registered-session product baseline');
  assert.deepEqual(readOnlyStateAfter.commands, []);
  assert.deepEqual(readOnlyStateAfter.questions, []);
  assert.deepEqual(readOnlyStateAfter.approvals, []);
  assert.equal(fs.readFileSync(nowStoragePath, 'utf8'), archiveBefore, 'recommendation wiring must not mutate catalog or operator sources');

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'registry-route-target-and-native-binding',
      'live-route-map',
      'authenticated-registered-session-policy',
      'typed-error-http-mapping',
      'ready-needs-input-unresolved',
      'opencode-wrapper-to-real-dispatcher',
      'read-only-postcondition',
      'state-hash-checkout-pending-command-question-approval',
    ],
  }));
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([
    childExited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(root, { recursive: true, force: true });
}
