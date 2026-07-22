import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyScenarioVerification,
  evaluateScenarioVerification,
} from './def-harness-native-runner.mjs';

const project = path.resolve(import.meta.dirname, '..');
const readScenario = (file) => JSON.parse(fs.readFileSync(path.join(project, 'agent/harness/scenarios', file), 'utf8'));
const recommendTool = 'def_data_equipment_3plus1_recommend';
const legacyThreePlusOneTools = [
  'def_data_operator_build_guide',
  'def_data_operator_build_profile',
  'def_data_native_catalog_materialize',
  'def_data_equipment_set_fit_shortlist',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
];
let callSequence = 0;

function completedTool(tool = recommendTool, resultState = 'READY') {
  callSequence += 1;
  return {
    tool,
    callId: `${tool}-${callSequence}`,
    state: { status: 'completed', output: JSON.stringify({ output: JSON.stringify({ state: resultState }) }) },
  };
}

function syntheticTurn(index, toolEvents, assistantText = '给出新的证据化建议。') {
  const assistantId = `assistant-${index}`;
  return {
    toolEvents,
    assistantMessageIds: [assistantId],
    transcript: { messages: [{ info: { id: assistantId, role: 'assistant' }, parts: [{ type: 'text', text: assistantText }] }] },
  };
}

function syntheticRun(turns, { changedState = false } = {}) {
  return {
    status: 'EXECUTED',
    scenarioId: 'synthetic-composite-3plus1-verification',
    scenarioVersion: 1,
    turns,
    stateBefore: { value: { state: { checkout: { id: 'node-a', revision: 3 }, selected: ['bieli'] } } },
    stateAfter: { value: { state: changedState
      ? { checkout: { id: 'node-b', revision: 4 }, selected: ['bieli'] }
      : { selected: ['bieli'], checkout: { revision: 3, id: 'node-a' } } } },
  };
}

function failureCodes(result) {
  return new Set(result.failures.map((failure) => failure.code));
}

const oneTurnScenario = {
  id: 'synthetic-composite-3plus1-verification',
  version: 1,
  verification: {
    requiredTools: [recommendTool],
    requiredToolsByTurn: { 1: [recommendTool] },
    orderedToolsByTurn: { 1: [recommendTool] },
    forbiddenTools: legacyThreePlusOneTools,
    maxRepeatedToolCalls: { [recommendTool]: 1 },
    forbiddenAssistantText: ['已经应用'],
    mustKeepState: true,
  },
};

const pass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'READY')]),
]), oneTurnScenario);
assert.equal(pass.status, 'PASS');
assert.equal(pass.observed.completedToolCounts[recommendTool], 1);
const applied = applyScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'NEEDS_INPUT')]),
]), oneTurnScenario);
assert.equal(applied.status, 'EXECUTED');

const repeated = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(), completedTool()]),
]), oneTurnScenario);
assert.ok(failureCodes(repeated).has('max-repeated-tool-calls-exceeded'));

const legacyRoute = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool('def_data_equipment_3plus1_plan'), completedTool()]),
]), oneTurnScenario);
assert.ok(failureCodes(legacyRoute).has('forbidden-tool-called'));

const stateChanged = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool()]),
], { changedState: true }), oneTurnScenario);
assert.ok(failureCodes(stateChanged).has('product-state-changed'));

const correctionScenario = structuredClone(oneTurnScenario);
correctionScenario.verification.requiredToolsByTurn = { 1: [recommendTool], 2: [recommendTool] };
correctionScenario.verification.orderedToolsByTurn = { 1: [recommendTool], 2: [recommendTool] };
correctionScenario.verification.maxRepeatedToolCalls = { [recommendTool]: 2 };
const correctionPass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'READY')]),
  syntheticTurn(2, [completedTool(recommendTool, 'READY')]),
]), correctionScenario);
assert.equal(correctionPass.status, 'PASS');
const correctionSkippedReplan = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'READY')]),
  syntheticTurn(2, []),
]), correctionScenario);
assert.ok(failureCodes(correctionSkippedReplan).has('required-turn-tool-missing'));

const expectations = [
  ['equipment-3plus1-topology-v1.json', 1],
  ['equipment-3plus1-set-selection-v1.json', 1],
  ['operator-config-correction-review-v1.json', 2],
  ['equipment-3plus1-unresolved-v1.json', 1],
];
for (const [file, turnCount] of expectations) {
  const scenario = readScenario(file);
  assert.deepEqual(scenario.verification.requiredTools, [recommendTool], `${file} has only the composite requirement`);
  assert.equal(scenario.verification.maxRepeatedToolCalls[recommendTool], turnCount, `${file} permits exactly one composite call per turn`);
  assert.equal(scenario.verification.conditionalTools, undefined, `${file} has no guide/profile branch`);
  for (let turn = 1; turn <= turnCount; turn += 1) {
    assert.deepEqual(scenario.verification.requiredToolsByTurn[String(turn)], [recommendTool], `${file} requires composite recommendation in turn ${turn}`);
    assert.deepEqual(scenario.verification.orderedToolsByTurn[String(turn)], [recommendTool], `${file} has no multi-tool order in turn ${turn}`);
  }
  for (const tool of legacyThreePlusOneTools) {
    assert.ok(scenario.verification.forbiddenTools.includes(tool), `${file} forbids legacy ${tool}`);
  }
  assert.equal(scenario.verification.mustKeepState, true, `${file} stays read-only`);
}

const unresolved = readScenario('equipment-3plus1-unresolved-v1.json');
assert.match(unresolved.turns[0].userText, /未收录/);
assert.ok(unresolved.verification.forbiddenAssistantText.includes('已经应用'));

const userCorrection = readScenario('user-correction-replan-v1.json');
assert.equal(userCorrection.id, 'user-correction-replan-v1');
assert.ok(!JSON.stringify(userCorrection).includes(recommendTool), 'non-3+1 user-correction scenario remains outside this migration');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'one-composite-call-per-turn',
    'legacy-3plus1-route-forbidden',
    'read-only-state-preservation',
    'correction-second-turn-fresh-composite-recommendation',
    'topology-and-set-scenarios-migrated',
    'unresolved-composite-scenario-present',
    'user-correction-replan-unchanged-scope',
  ],
}));
