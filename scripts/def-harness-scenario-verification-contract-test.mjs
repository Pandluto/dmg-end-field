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
const recommendationContract = 'DefEquipmentThreePlusOneRecommendationV1';
const legacyThreePlusOneTools = [
  'def_data_operator_build_guide',
  'def_data_operator_build_profile',
  'def_data_native_catalog_materialize',
  'def_data_equipment_set_fit_shortlist',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
];
const forbiddenCompositeFallbackTools = [
  ...legacyThreePlusOneTools,
  'def_data_game_knowledge',
  'def_data_game_knowledge_section',
  'def_data_operator',
  'def_data_skill',
  'def_data_equipment',
  'def_data_loadout_candidates',
  'def_operator_config_preview',
  'def_operator_config_patch',
  'def_node_use',
];
let callSequence = 0;

function completedTool(tool = recommendTool, resultState = 'READY', contract = recommendationContract) {
  callSequence += 1;
  return {
    tool,
    callId: `${tool}-${callSequence}`,
    state: { status: 'completed', output: JSON.stringify({ output: JSON.stringify({ contract, state: resultState }) }) },
  };
}

function syntheticTurnWithAssistantTexts(index, toolEvents, assistantTexts) {
  const messages = assistantTexts.map((assistantText, messageIndex) => {
    const assistantId = `assistant-${index}-${messageIndex + 1}`;
    return { info: { id: assistantId, role: 'assistant' }, parts: [{ type: 'text', text: assistantText }] };
  });
  return {
    toolEvents,
    assistantMessageIds: messages.map((message) => message.info.id),
    transcript: { messages },
  };
}

function syntheticTurn(index, toolEvents, assistantText = '给出新的证据化建议。') {
  return syntheticTurnWithAssistantTexts(index, toolEvents, [assistantText]);
}

function syntheticTurnWithAssistantParts(index, toolEvents, parts) {
  const assistantId = `assistant-${index}-parts`;
  return {
    toolEvents,
    assistantMessageIds: [assistantId],
    transcript: { messages: [{ info: { id: assistantId, role: 'assistant' }, parts }] },
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
    onlyToolsByTurn: { 1: [recommendTool] },
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

const rogueRoute = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(), completedTool('def_data_damage')]),
]), oneTurnScenario);
assert.ok(failureCodes(rogueRoute).has('turn-tool-not-allowed'));

const stateChanged = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool()]),
], { changedState: true }), oneTurnScenario);
assert.ok(failureCodes(stateChanged).has('product-state-changed'));

const correctionScenario = structuredClone(oneTurnScenario);
correctionScenario.verification.requiredToolsByTurn = { 1: [recommendTool], 2: [recommendTool] };
correctionScenario.verification.onlyToolsByTurn = { 1: [recommendTool], 2: [recommendTool] };
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
  ['equipment-3plus1-topology-v1.json', 2, 1, ['为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。']],
  ['equipment-3plus1-set-selection-v1.json', 2, 1, ['为汤汤挑一套 3+1 装备，优先适配她的输出机制，不指定套装。']],
  ['operator-config-correction-review-v1.json', 2, 2, ['给别礼规划一套 3 潮涌+1，先给我确认方案，不要应用。', '配件二为什么不用第二个悬河供氧栓？']],
  ['equipment-3plus1-unresolved-v1.json', 6, 1, ['为别礼配 3 潮涌+1；如果资料不能证明寒冷伤害会触发潮涌第二段，就明确说不能证明。']],
];
for (const [file, version, turnCount, prompts] of expectations) {
  const scenario = readScenario(file);
  assert.equal(scenario.version, version, `${file} advances when its verification contract changes`);
  assert.deepEqual(scenario.turns.map((turn) => turn.userText), prompts, `${file} preserves the W6 natural-language case`);
  assert.deepEqual(scenario.verification.requiredTools, [recommendTool], `${file} has only the composite requirement`);
  assert.equal(scenario.verification.maxRepeatedToolCalls[recommendTool], turnCount, `${file} permits exactly one composite call per turn`);
  assert.equal(scenario.verification.conditionalTools, undefined, `${file} has no guide/profile branch`);
  for (let turn = 1; turn <= turnCount; turn += 1) {
    assert.deepEqual(scenario.verification.requiredToolsByTurn[String(turn)], [recommendTool], `${file} requires composite recommendation in turn ${turn}`);
    assert.deepEqual(scenario.verification.onlyToolsByTurn[String(turn)], [recommendTool], `${file} rejects every non-composite tool in turn ${turn}`);
    assert.deepEqual(scenario.verification.orderedToolsByTurn[String(turn)], [recommendTool], `${file} has no multi-tool order in turn ${turn}`);
  }
  for (const tool of forbiddenCompositeFallbackTools) {
    assert.ok(scenario.verification.forbiddenTools.includes(tool), `${file} forbids legacy ${tool}`);
  }
  assert.equal(scenario.verification.mustKeepState, true, `${file} stays read-only`);
}

const unresolved = readScenario('equipment-3plus1-unresolved-v1.json');
assert.ok(unresolved.verification.forbiddenAssistantText.includes('已经应用'));
assert.deepEqual(unresolved.verification.requiredToolResultsByTurn, {
  1: { [recommendTool]: { contract: recommendationContract, state: 'UNRESOLVED' } },
});
assert.deepEqual(unresolved.verification.requiredFinalAssistantClausesByTurn, {
  1: [{ allOf: ['不能证明', '寒冷伤害', '触发潮涌第二段'] }],
});
assert.deepEqual(unresolved.verification.forbiddenFinalAssistantClausesByTurn, {
  1: [{
    allOf: ['寒冷伤害', '触发潮涌第二段'],
    noneOf: ['不能证明', '无法证明', '未能证明'],
  }],
});
const unresolvedPass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '现有资料不能证明寒冷伤害会触发潮涌第二段。'),
]), unresolved);
assert.equal(unresolvedPass.status, 'PASS');
const unresolvedTypedReady = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'READY')], '现有资料不能证明寒冷伤害会触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedTypedReady).has('required-turn-typed-tool-result-missing'));
const unresolvedWrongContract = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED', 'SomeOtherContract')], '现有资料不能证明寒冷伤害会触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedWrongContract).has('required-turn-typed-tool-result-missing'));
const metadataForgery = completedTool(recommendTool, 'READY');
metadataForgery.state.metadata = { contract: recommendationContract, state: 'UNRESOLVED' };
const unresolvedMetadataForgery = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [metadataForgery], '现有资料不能证明寒冷伤害会触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedMetadataForgery).has('required-turn-typed-tool-result-missing'));
const unresolvedFinalMissing = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '这个结论缺少足够资料。'),
]), unresolved);
assert.ok(failureCodes(unresolvedFinalMissing).has('required-final-assistant-clause-missing'));
const unresolvedIntermediateOnly = evaluateScenarioVerification(syntheticRun([
  syntheticTurnWithAssistantTexts(1, [completedTool(recommendTool, 'UNRESOLVED')], [
    '现有资料不能证明寒冷伤害会触发潮涌第二段。',
    '最终结论：寒冷伤害会触发潮涌第二段。',
  ]),
]), unresolved);
assert.ok(failureCodes(unresolvedIntermediateOnly).has('required-final-assistant-clause-missing'));
assert.ok(failureCodes(unresolvedIntermediateOnly).has('forbidden-final-assistant-clause-present'));
const unresolvedScatteredWrongObject = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '寒冷伤害仍需核实；不能证明雷电伤害会触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedScatteredWrongObject).has('required-final-assistant-clause-missing'));
const unresolvedContradiction = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '现有资料不能证明寒冷伤害会触发潮涌第二段；但寒冷伤害能够触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedContradiction).has('forbidden-final-assistant-clause-present'));
const unresolvedModalFreeContradiction = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '现有资料不能证明寒冷伤害会触发潮涌第二段。寒冷伤害触发潮涌第二段。'),
]), unresolved);
assert.ok(failureCodes(unresolvedModalFreeContradiction).has('forbidden-final-assistant-clause-present'));
for (const punctuationSeparatedContradiction of [
  '虽然不能证明这一点：寒冷伤害会触发潮涌第二段。',
  '虽然不能证明这一点: 寒冷伤害可以触发潮涌第二段。',
  '虽然不能证明这一点—寒冷伤害能够触发潮涌第二段。',
  '虽然不能证明这一点——寒冷伤害会触发潮涌第二段。',
  '虽然不能证明这一点，寒冷伤害会触发潮涌第二段。',
  '虽然不能证明这一点, 寒冷伤害可以触发潮涌第二段。',
  '虽然不能证明这一点、寒冷伤害能够触发潮涌第二段。',
]) {
  const separatedContradiction = evaluateScenarioVerification(syntheticRun([
    syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], punctuationSeparatedContradiction),
  ]), unresolved);
  assert.ok(failureCodes(separatedContradiction).has('required-final-assistant-clause-missing'));
  assert.ok(failureCodes(separatedContradiction).has('forbidden-final-assistant-clause-present'));
}
const unresolvedParenthesized = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], '（现有资料不能证明寒冷伤害会触发潮涌第二段）'),
]), unresolved);
assert.equal(unresolvedParenthesized.status, 'PASS');
for (const modal of ['会', '可以', '能够']) {
  const positiveAssertion = evaluateScenarioVerification(syntheticRun([
    syntheticTurn(1, [completedTool(recommendTool, 'UNRESOLVED')], `寒冷伤害${modal}触发潮涌第二段。`),
  ]), unresolved);
  assert.ok(failureCodes(positiveAssertion).has('forbidden-final-assistant-clause-present'));
}
const ignoredCompliance = evaluateScenarioVerification(syntheticRun([
  syntheticTurnWithAssistantParts(1, [completedTool(recommendTool, 'UNRESOLVED')], [
    { type: 'text', text: '现有资料不能证明寒冷伤害会触发潮涌第二段。', ignored: true },
    { type: 'text', text: '寒冷伤害会触发潮涌第二段。' },
  ]),
]), unresolved);
assert.ok(failureCodes(ignoredCompliance).has('required-final-assistant-clause-missing'));
assert.ok(failureCodes(ignoredCompliance).has('forbidden-final-assistant-clause-present'));
const ignoredContradiction = evaluateScenarioVerification(syntheticRun([
  syntheticTurnWithAssistantParts(1, [completedTool(recommendTool, 'UNRESOLVED')], [
    { type: 'text', text: '现有资料不能证明寒冷伤害会触发潮涌第二段。' },
    { type: 'text', text: '寒冷伤害会触发潮涌第二段。', ignored: true },
  ]),
]), unresolved);
assert.equal(ignoredContradiction.status, 'PASS');

const userCorrection = readScenario('user-correction-replan-v1.json');
assert.equal(userCorrection.id, 'user-correction-replan-v1');
assert.ok(!JSON.stringify(userCorrection).includes(recommendTool), 'non-3+1 user-correction scenario remains outside this migration');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'one-composite-call-per-turn',
    'per-turn-exact-tool-allowlist',
    'legacy-3plus1-route-forbidden',
    'read-only-state-preservation',
    'correction-second-turn-fresh-composite-recommendation',
    'topology-and-set-scenarios-migrated',
    'unresolved-composite-scenario-present',
    'unresolved-typed-contract-state-and-final-visible-conclusion-required',
    'unresolved-unicode-clause-boundaries-enforced',
    'unresolved-structural-clause-rules-enforced',
    'final-visible-text-excludes-ignored-parts',
    'user-correction-replan-unchanged-scope',
  ],
}));
