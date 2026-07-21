import assert from 'node:assert/strict';
import {
  applyScenarioVerification,
  evaluateScenarioVerification,
} from './def-harness-native-runner.mjs';

const guideTool = 'def_data_operator_build_guide';
const profileTool = 'def_data_operator_build_profile';
const planTool = 'def_data_equipment_3plus1_plan';
let callSequence = 0;

const scenario = {
  id: 'synthetic-guide-first-verification',
  version: 1,
  verification: {
    requiredTools: [guideTool, planTool],
    requiredToolsByTurn: { 1: [guideTool, planTool] },
    orderedToolsByTurn: { 1: [guideTool, planTool] },
    forbiddenTools: ['def_data_game_knowledge'],
    maxRepeatedToolCalls: { [guideTool]: 1, [profileTool]: 1 },
    conditionalTools: [
      {
        when: { tool: guideTool, resultState: ['PARTIAL_GUIDE_FOUND', 'GUIDE_NOT_FOUND'] },
        require: [profileTool],
      },
      {
        when: { tool: guideTool, resultState: 'GUIDE_FOUND' },
        forbid: [profileTool],
      },
    ],
    forbiddenAssistantText: ['仍然使用原方案'],
    mustKeepState: true,
  },
};

function completedTool(tool, resultState, shape = 'nested-output') {
  const result = resultState ? { state: resultState } : {};
  const state = shape === 'metadata'
    ? { status: 'completed', metadata: result }
    : { status: 'completed', output: JSON.stringify({ title: tool, output: JSON.stringify(result) }) };
  callSequence += 1;
  return { tool, callId: `${tool}-${callSequence}`, state };
}

function failedTool(tool) {
  return { tool, callId: `${tool}-failed`, state: { status: 'error', error: 'synthetic failure' } };
}

function syntheticTurn(index, toolEvents, assistantText = '给出新的证据化方案。') {
  const assistantId = `assistant-${index}`;
  return {
    toolEvents,
    assistantMessageIds: [assistantId],
    transcript: {
      messages: [{
        info: { id: assistantId, role: 'assistant' },
        parts: [{ type: 'text', text: assistantText }],
      }],
    },
  };
}

function syntheticRun(turns, { changedState = false } = {}) {
  return {
    status: 'EXECUTED',
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    turns,
    stateBefore: { value: { state: { checkout: { id: 'node-a', revision: 3 }, selected: ['bieli'] } } },
    stateAfter: { value: { state: changedState
      ? { selected: ['bieli'], checkout: { id: 'node-b', revision: 4 } }
      : { selected: ['bieli'], checkout: { revision: 3, id: 'node-a' } } } },
  };
}

function failureCodes(result) {
  return new Set(result.failures.map((failure) => failure.code));
}

const fallbackPassRun = syntheticRun([
  syntheticTurn(1, [
    completedTool(guideTool, 'GUIDE_NOT_FOUND'),
    completedTool(profileTool, 'PROFILE_READY'),
    completedTool(planTool, 'READY'),
  ]),
]);
const fallbackPass = evaluateScenarioVerification(fallbackPassRun, scenario);
assert.equal(fallbackPass.status, 'PASS');
assert.equal(fallbackPass.ok, true);
assert.equal(fallbackPass.observed.completedToolCounts[profileTool], 1);
const fallbackApplied = applyScenarioVerification(fallbackPassRun, scenario);
assert.equal(fallbackApplied.status, 'EXECUTED');
assert.equal(fallbackApplied.verification.status, 'PASS');
assert.equal(fallbackPassRun.status, 'EXECUTED', 'the pure status helper must not mutate its input run');

const guideFoundPass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedTool(guideTool, 'GUIDE_FOUND', 'metadata'),
    completedTool(planTool, 'READY'),
  ]),
]), scenario);
assert.equal(guideFoundPass.status, 'PASS');
assert.equal(guideFoundPass.observed.attemptedToolCounts[profileTool], undefined);

const wrongOrder = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedTool(planTool, 'READY'),
    completedTool(guideTool, 'GUIDE_FOUND'),
  ]),
]), scenario);
assert.ok(failureCodes(wrongOrder).has('ordered-tool-sequence-violated'));

const correctionScenario = structuredClone(scenario);
correctionScenario.verification.requiredToolsByTurn = {
  1: [guideTool, planTool],
  2: [guideTool, planTool],
};
correctionScenario.verification.orderedToolsByTurn = {
  1: [guideTool, planTool],
  2: [guideTool, planTool],
};
correctionScenario.verification.maxRepeatedToolCalls = { [guideTool]: 2, [profileTool]: 2 };
const correctionSkippedReplan = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(guideTool, 'GUIDE_FOUND'), completedTool(planTool, 'READY')]),
  syntheticTurn(2, [completedTool(guideTool, 'GUIDE_FOUND')]),
]), correctionScenario);
assert.ok(failureCodes(correctionSkippedReplan).has('required-turn-tool-missing'));

const missingConditional = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(guideTool, 'PARTIAL_GUIDE_FOUND'), completedTool(planTool, 'PARTIAL')]),
]), scenario);
assert.ok(failureCodes(missingConditional).has('conditional-required-tool-missing'));

const wrongTurnFallback = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(guideTool, 'GUIDE_NOT_FOUND'), completedTool(planTool, 'READY')]),
  syntheticTurn(2, [completedTool(profileTool, 'PROFILE_READY')]),
]), scenario);
assert.ok(failureCodes(wrongTurnFallback).has('conditional-required-tool-missing'), 'same-turn fallback must not be satisfied by a later turn');

const forbiddenConditional = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedTool(guideTool, 'GUIDE_FOUND'),
    completedTool(profileTool, 'PROFILE_READY'),
    completedTool(planTool, 'READY'),
  ]),
]), scenario);
assert.ok(failureCodes(forbiddenConditional).has('conditional-forbidden-tool-called'));

const unreadableConditionalState = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(guideTool), completedTool(planTool, 'READY')]),
]), scenario);
assert.ok(failureCodes(unreadableConditionalState).has('conditional-tool-result-state-unavailable'));

const unavailableProductStateRun = syntheticRun([
  syntheticTurn(1, [completedTool(guideTool, 'GUIDE_FOUND'), completedTool(planTool, 'READY')]),
]);
unavailableProductStateRun.stateAfter.value.state = null;
const unavailableProductState = evaluateScenarioVerification(unavailableProductStateRun, scenario);
assert.ok(failureCodes(unavailableProductState).has('product-state-unavailable'));

const aggregateFailureRun = syntheticRun([
  syntheticTurn(1, [
    completedTool(guideTool, 'GUIDE_FOUND'),
    failedTool('def_data_game_knowledge'),
    failedTool(planTool),
  ], '仍然使用原方案'),
  syntheticTurn(2, [completedTool(guideTool, 'GUIDE_FOUND')]),
], { changedState: true });
const aggregateFailure = evaluateScenarioVerification(aggregateFailureRun, scenario);
const aggregateCodes = failureCodes(aggregateFailure);
assert.equal(aggregateFailure.status, 'FAIL');
assert.ok(aggregateCodes.has('required-tool-missing'));
assert.ok(aggregateCodes.has('forbidden-tool-called'));
assert.ok(aggregateCodes.has('max-repeated-tool-calls-exceeded'));
assert.ok(aggregateCodes.has('forbidden-assistant-text-present'));
assert.ok(aggregateCodes.has('product-state-changed'));
const failedApplied = applyScenarioVerification(aggregateFailureRun, scenario);
assert.equal(failedApplied.status, 'FAIL_AGENT');
assert.equal(failedApplied.verification.status, 'FAIL');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'required-completed-tool',
    'required-completed-tool-by-turn',
    'ordered-completed-tool-by-turn',
    'correction-turn-replan-required',
    'forbidden-attempted-tool',
    'maximum-tool-attempts',
    'forbidden-assistant-text',
    'canonical-state-preservation',
    'conditional-fallback-required-same-turn',
    'conditional-guide-found-profile-forbidden',
    'conditional-result-state-required',
    'state-observation-required',
    'verification-failure-affects-run-status',
  ],
}));
