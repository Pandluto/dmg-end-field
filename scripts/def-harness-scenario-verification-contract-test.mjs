import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyScenarioVerification,
  evaluateScenarioVerification,
  validateScenarioVerificationConfiguration,
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

function completedToolWithStructuredInputOutput(tool, input, output) {
  callSequence += 1;
  return {
    tool,
    callId: `${tool}-${callSequence}`,
    state: { status: 'completed', input, output: JSON.stringify(output) },
  };
}

const gameKnowledgeSearchTool = 'def_data_game_knowledge';
const gameKnowledgeSectionTool = 'def_data_game_knowledge_section';
const sourceOnlyReferenceId = '【萌新推荐】弭弗x陈千语x埃特拉x阿列什 低配高伤&无脑循环打法教学.md';
const sourceOnlySectionId = 'h2-三-装备养成推荐';

function completedGameKnowledgeSearch({
  query = 'four-person guide',
  referenceId = sourceOnlyReferenceId,
  requiredSectionId = sourceOnlySectionId,
} = {}) {
  return completedToolWithStructuredInputOutput(gameKnowledgeSearchTool, { query, limit: 3 }, {
    protocolVersion: 1,
    contract: 'DefGameKnowledgeReferenceSearchV1',
    candidates: [{
      referenceId,
      recommendedSection: { sectionId: 'h1-overview' },
      exactReadPolicy: { requiredSectionId },
    }],
  });
}

function completedGameKnowledgeSection({
  referenceId = sourceOnlyReferenceId,
  sectionId = sourceOnlySectionId,
  outputReferenceId = referenceId,
  outputSectionId = sectionId,
} = {}) {
  return completedToolWithStructuredInputOutput(gameKnowledgeSectionTool, { referenceId, sectionId }, {
    protocolVersion: 1,
    contract: 'DefGameKnowledgeSectionReadV1',
    referenceId: outputReferenceId,
    section: { sectionId: outputSectionId },
  });
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

const sourceOnlyGuide = readScenario('skill-reference-readable-v1.json');
assert.equal(sourceOnlyGuide.version, 3, 'source-only guide scenario advances when the expected-reference contract changes');
assert.deepEqual(sourceOnlyGuide.turns.map((turn) => turn.userText), [
  '请查《弭弗x陈千语x埃特拉x阿列什 低配高伤&无脑循环打法教学》这篇四人配队攻略；只按原文告诉我依据和明确写到的配装，不要查询当前阵容或改动任何配置。',
], 'source-only guide scenario remains a focused four-person guide request');
assert.ok(!sourceOnlyGuide.turns[0].userText.includes('glossary'), 'source-only guide scenario has no mixed glossary intent');
assert.deepEqual(sourceOnlyGuide.verification.requiredTools, [gameKnowledgeSearchTool, gameKnowledgeSectionTool]);
assert.deepEqual(sourceOnlyGuide.verification.requiredToolsByTurn, {
  1: [gameKnowledgeSearchTool, gameKnowledgeSectionTool],
});
assert.deepEqual(sourceOnlyGuide.verification.onlyToolsByTurn, {
  1: [gameKnowledgeSearchTool, gameKnowledgeSectionTool],
});
assert.deepEqual(sourceOnlyGuide.verification.orderedToolsByTurn, {
  1: [gameKnowledgeSearchTool, gameKnowledgeSectionTool],
});
assert.deepEqual(sourceOnlyGuide.verification.requiredExactSectionReadByTurn, {
  1: {
    searchTool: gameKnowledgeSearchTool,
    sectionTool: gameKnowledgeSectionTool,
    expectedReferenceId: sourceOnlyReferenceId,
  },
});
assert.deepEqual(sourceOnlyGuide.verification.maxRepeatedToolCalls, {
  [gameKnowledgeSearchTool]: 1,
  [gameKnowledgeSectionTool]: 1,
});

const sourceOnlyGuideWithoutExpectedReference = structuredClone(sourceOnlyGuide);
delete sourceOnlyGuideWithoutExpectedReference.verification.requiredExactSectionReadByTurn[1].expectedReferenceId;
const missingExpectedReference = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedGameKnowledgeSearch(), completedGameKnowledgeSection()]),
]), sourceOnlyGuideWithoutExpectedReference);
assert.ok(failureCodes(missingExpectedReference).has('verification-config-invalid'), 'exact-section declarations fail closed without expectedReferenceId');

const sourceOnlyGuidePass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedGameKnowledgeSearch(), completedGameKnowledgeSection()]),
]), sourceOnlyGuide);
assert.equal(sourceOnlyGuidePass.status, 'PASS', 'one search followed by its exact section read passes');

const sourceOnlyGuideRepeated = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    ...Array.from({ length: 5 }, () => completedGameKnowledgeSearch()),
    completedGameKnowledgeSection(),
    completedGameKnowledgeSection(),
  ]),
]), sourceOnlyGuide);
assert.equal(sourceOnlyGuideRepeated.status, 'FAIL', 'five searches plus two section reads must fail');
assert.ok(failureCodes(sourceOnlyGuideRepeated).has('max-repeated-tool-calls-exceeded'));

const sourceOnlyGuideWrongInput = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedGameKnowledgeSearch(),
    completedGameKnowledgeSection({ sectionId: 'h1-overview' }),
  ]),
]), sourceOnlyGuide);
assert.ok(failureCodes(sourceOnlyGuideWrongInput).has('required-exact-section-read-missing'), 'section input must use the search candidate exactReadPolicy.requiredSectionId');

const sourceOnlyGuideWrongOutput = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedGameKnowledgeSearch(),
    completedGameKnowledgeSection({ outputSectionId: 'h1-overview' }),
  ]),
]), sourceOnlyGuide);
assert.ok(failureCodes(sourceOnlyGuideWrongOutput).has('required-exact-section-read-missing'), 'section output must confirm the exact searched reference and section');

const unrelatedReferenceId = '【YZ配队攻略】弭弗x陈千语x黎风x骏卫 新传统物理队 输出手法教学&装备养成推荐.md';
const unrelatedSectionId = 'h1-yz配队攻略-弭弗x陈千语x黎风x骏卫-新传统物理队-输出手法教学-装备养成推荐';
const sourceOnlyGuideUnrelatedExactRead = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedGameKnowledgeSearch({
      query: '弭弗 陈千语 黎风 骏卫 传统物理队',
      referenceId: unrelatedReferenceId,
      requiredSectionId: unrelatedSectionId,
    }),
    completedGameKnowledgeSection({ referenceId: unrelatedReferenceId, sectionId: unrelatedSectionId }),
  ]),
]), sourceOnlyGuide);
assert.equal(sourceOnlyGuideUnrelatedExactRead.status, 'FAIL', 'an unrelated query and internally valid exact read cannot satisfy the named source request');
assert.ok(failureCodes(sourceOnlyGuideUnrelatedExactRead).has('required-exact-section-read-missing'));

const equipmentCatalogScenario = readScenario('equipment-full-catalog-asr-v1.json');
const equipmentQueries = ['拓荒护甲·壹型', '长息蓄电核', '拓荒增量供氧栓一型', '长息护手一型'];
const weaponCatalogResult = {
  contract: 'DefWeaponResolutionV2',
  query: '骑士精神',
  ambiguity: false,
  candidates: [{
    id: 'weapon.6beca86909e7732dc7d83b56',
    name: '骑士精神',
    matchMethod: 'exact',
    confidence: 1,
  }],
};
const equipmentBatchResult = {
  contract: 'DefEquipmentBatchResolutionV2',
  queryCount: 4,
  results: [
    {
      query: '拓荒护甲壹型', ambiguity: false,
      candidates: [{ equipmentId: 'equipment-g-5-3', name: '拓荒护甲·壹型', matchMethod: 'exact', confidence: 1 }],
    },
    {
      query: '长息蓄电核', ambiguity: false,
      candidates: [{ equipmentId: 'equipment-g-1-0-7', name: '长息蓄电核', matchMethod: 'exact', confidence: 1 }],
    },
    {
      query: '拓荒增量供氧栓一型', ambiguity: false,
      candidates: [{ equipmentId: 'equipment-g-6-1', name: '拓荒增量供氧栓·壹型', matchMethod: 'phonetic', confidence: 0.96 }],
    },
    {
      query: '长息护手一型', ambiguity: false,
      candidates: [{ equipmentId: 'equipment-g-1-0-6', name: '长息护手·壹型', matchMethod: 'phonetic', confidence: 0.96 }],
    },
  ],
};
const completedWeaponCatalog = (query = '骑士精神', output = weaponCatalogResult) => (
  completedToolWithStructuredInputOutput('def_data_weapon', { query }, output)
);
const completedEquipmentBatch = (queries = equipmentQueries, output = equipmentBatchResult) => (
  completedToolWithStructuredInputOutput('def_data_equipment', { queries }, output)
);

assert.equal(equipmentCatalogScenario.version, 2, 'catalog ASR scenario advances with exact structured verification');
assert.ok(equipmentCatalogScenario.turns[0].userText.includes('拓荒护甲·壹型'), 'catalog ASR scenario uses a real builtin canonical item');
assert.ok(!equipmentCatalogScenario.turns[0].userText.includes('长息轻护甲板'), 'catalog ASR scenario removes the non-authoritative missing item');
assert.deepEqual(equipmentCatalogScenario.verification.onlyToolsByTurn, {
  1: ['def_data_weapon', 'def_data_equipment'],
});
for (const tool of ['def_data_native_catalog_materialize', 'read', 'grep', 'glob', 'def_operator_config_patch', 'def_node_use']) {
  assert.ok(equipmentCatalogScenario.verification.forbiddenTools.includes(tool), `catalog ASR scenario forbids ${tool}`);
}

const equipmentBatchOnlyPass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedWeaponCatalog(), completedEquipmentBatch()]),
]), equipmentCatalogScenario);
assert.equal(equipmentBatchOnlyPass.status, 'PASS', 'one weapon lookup plus one exact equipment batch passes');

const equipmentBatchWithNativeReads = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedWeaponCatalog(),
    completedEquipmentBatch(),
    completedTool('def_data_native_catalog_materialize'),
    completedTool('read'),
  ]),
]), equipmentCatalogScenario);
assert.equal(equipmentBatchWithNativeReads.status, 'FAIL', 'batch plus native materialize/read fails');
assert.ok(failureCodes(equipmentBatchWithNativeReads).has('turn-tool-not-allowed'));
assert.ok(failureCodes(equipmentBatchWithNativeReads).has('forbidden-tool-called'));

const equipmentFragmentRetry = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedWeaponCatalog(),
    completedEquipmentBatch(),
    completedToolWithStructuredInputOutput('def_data_equipment', { query: '拓荒' }, {
      contract: 'DefEquipmentResolutionV2', query: '拓荒', ambiguity: true, candidates: [],
    }),
  ]),
]), equipmentCatalogScenario);
assert.equal(equipmentFragmentRetry.status, 'FAIL', 'a shorter-fragment retry fails even after a valid batch');
assert.ok(failureCodes(equipmentFragmentRetry).has('max-repeated-tool-calls-exceeded'));

const equipmentWrongInput = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [
    completedWeaponCatalog(),
    completedEquipmentBatch(['拓荒护甲', '长息蓄电核', '拓荒增量供氧栓一型', '长息护手一型']),
  ]),
]), equipmentCatalogScenario);
assert.equal(equipmentWrongInput.status, 'FAIL', 'a different batch query cannot pass using otherwise matching output');
assert.ok(failureCodes(equipmentWrongInput).has('required-turn-tool-input-assertions-missing'));

const invalidStructuredAssertionScenario = structuredClone(equipmentCatalogScenario);
invalidStructuredAssertionScenario.verification.requiredToolInputAssertionsByTurn[1].def_data_weapon = [{
  path: 'query',
  unsupportedPredicate: '骑士精神',
}];
const invalidStructuredAssertionConfiguration = validateScenarioVerificationConfiguration(invalidStructuredAssertionScenario);
assert.equal(invalidStructuredAssertionConfiguration.status, 'ERROR_VERIFIER', 'invalid assertion schema is a verifier error');
assert.ok(failureCodes(invalidStructuredAssertionConfiguration).has('verification-config-invalid'));
const invalidStructuredAssertionEvaluation = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedWeaponCatalog(), completedEquipmentBatch()]),
]), invalidStructuredAssertionScenario);
assert.equal(invalidStructuredAssertionEvaluation.status, 'ERROR_VERIFIER');
const invalidStructuredAssertionApplied = applyScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedWeaponCatalog(), completedEquipmentBatch()]),
]), invalidStructuredAssertionScenario);
assert.equal(invalidStructuredAssertionApplied.status, 'ERROR_VERIFIER', 'invalid verifier config cannot be mislabeled as an Agent failure');

const nativeRunnerSource = fs.readFileSync(path.join(project, 'scripts/def-harness-native-runner.mjs'), 'utf8');
for (const scenarioId of ['equipment-full-catalog-asr-v1', 'operator-config-preview-v1']) {
  assert.ok(!nativeRunnerSource.includes(scenarioId), `generic structured assertions cannot special-case ${scenarioId}`);
}
const verifierConfigurationGate = nativeRunnerSource.indexOf('run.verifierConfiguration = validateScenarioVerificationConfiguration(scenario)');
const firstInteropReadinessRequest = nativeRunnerSource.indexOf("const status = await request('GET', '/def-agent/interop/v1/status')", verifierConfigurationGate);
assert.ok(
  verifierConfigurationGate >= 0 && firstInteropReadinessRequest > verifierConfigurationGate,
  'invalid verifier configuration is rejected before the first Interop/provider-side request',
);

const previewScenario = readScenario('operator-config-preview-v1.json');
const currentTeamResult = {
  contract: 'DefSelectedTeamLoadoutsV1',
  selectedCount: 1,
  complete: true,
  operators: [{
    characterId: 'operator.current-first',
    characterName: '当前首位',
    operatorSkillLevels: { A: 'M3', B: 'L9', E: 'M3', Q: 'L9' },
    weapon: {
      id: 'weapon.current',
      name: '当前武器',
      level: 80,
      potential: '满潜',
      skillLevels: { skill1: 8, skill2: 7, skill3: 8 },
    },
    equipment: [
      {
        slotKey: 'armor', equipmentId: 'equipment.current.armor', name: '当前护甲',
        effects: [{ effectId: 'armor.effect1', level: 1 }, { effectId: 'armor.effect2', level: 2 }],
      },
      {
        slotKey: 'glove', equipmentId: 'equipment.current.glove', name: '当前护手',
        effects: [
          { effectId: 'glove.effect1', level: 3 },
          { effectId: 'glove.effect2', level: 2 },
          { effectId: 'glove.effect3', level: 1 },
        ],
      },
    ],
  }],
};
const matchingPreviewInput = {
  nodeTitle: '现有配装预览',
  nodeDescription: '只读验证当前首位干员的现有武器和装备。',
  characterId: 'operator.current-first',
  characterName: '当前首位',
  weaponId: 'weapon.current',
  weaponName: '当前武器',
  weaponLevel: 80,
  weaponPotential: 'PMAX',
  weaponSkill1Level: 8,
  weaponSkill2Level: 7,
  weaponSkill3Level: 3,
  operatorSkillA: 'M3',
  operatorSkillB: 'L9',
  operatorSkillE: 'M3',
  operatorSkillQ: 'L9',
  equipments: [
    {
      slotKey: 'glove', equipmentId: 'equipment.current.glove', equipmentName: '当前护手',
      equipmentEntry1Level: 3, equipmentEntry2Level: 2, equipmentEntry3Level: 1,
    },
    {
      slotKey: 'armor', equipmentId: 'equipment.current.armor', equipmentName: '当前护甲',
      equipmentEntry1Level: 1, equipmentEntry2Level: 2,
    },
  ],
};
const previewResult = {
  ok: true,
  state: 'REVIEW_REQUIRED',
  proposalToken: 'proposal-token-1234567890',
  currentCheckoutTouched: false,
  finalConfig: {
    characterId: 'operator.current-first',
    characterName: '当前首位',
    operatorSkillLevels: { A: 'M3', B: 'L9', E: 'M3', Q: 'L9' },
    weapon: {
      id: 'weapon.current',
      name: '当前武器',
      level: 80,
      potential: '满潜',
      skillLevels: { skill1: 8, skill2: 7, skill3: 8 },
    },
    equipment: [
      {
        slotKey: 'armor', equipmentId: 'equipment.current.armor', name: '当前护甲',
        effects: [{ effectId: 'armor.effect1', level: 1 }, { effectId: 'armor.effect2', level: 2 }],
      },
      {
        slotKey: 'glove', equipmentId: 'equipment.current.glove', name: '当前护手',
        effects: [
          { effectId: 'glove.effect1', level: 3 },
          { effectId: 'glove.effect2', level: 2 },
          { effectId: 'glove.effect3', level: 1 },
        ],
      },
    ],
  },
};
const completedTeamLoadouts = (output = currentTeamResult) => completedToolWithStructuredInputOutput('def_data_team_loadouts', {}, output);
const completedPreview = (input = matchingPreviewInput, output = previewResult) => (
  completedToolWithStructuredInputOutput('def_operator_config_preview', input, output)
);

function singleEquipmentPreviewCase(equipmentId) {
  const teamEquipment = currentTeamResult.operators[0].equipment.find((equipment) => equipment.equipmentId === equipmentId);
  const inputEquipment = matchingPreviewInput.equipments.find((equipment) => equipment.equipmentId === equipmentId);
  const finalEquipment = previewResult.finalConfig.equipment.find((equipment) => equipment.equipmentId === equipmentId);
  return {
    team: {
      ...currentTeamResult,
      operators: [{ ...currentTeamResult.operators[0], equipment: [teamEquipment] }],
    },
    input: { ...matchingPreviewInput, equipments: [inputEquipment] },
    output: {
      ...previewResult,
      finalConfig: { ...previewResult.finalConfig, equipment: [finalEquipment] },
    },
  };
}

assert.equal(previewScenario.version, 2, 'operator preview scenario advances with structured preview verification');
assert.equal(previewScenario.fixtureMode, 'active-current-readonly', 'operator preview binds the W9 active current read-only fixture');
assert.deepEqual(previewScenario.verification.onlyToolsByTurn, {
  1: ['def_data_team_loadouts', 'def_operator_config_preview'],
});
assert.equal(previewScenario.verification.maxQuestionRequests, 0, 'operator preview forbids native approval/question requests');

const previewPass = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview()]),
]), previewScenario);
assert.equal(previewPass.status, 'PASS', 'mixed two-effect and three-effect pieces preserve every existing level');

const twoEffectPreview = singleEquipmentPreviewCase('equipment.current.armor');
assert.equal(evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(twoEffectPreview.team), completedPreview(twoEffectPreview.input, twoEffectPreview.output)]),
]), previewScenario).status, 'PASS', 'a two-effect piece may omit the nonexistent third effect on both sides');

const threeEffectPreview = singleEquipmentPreviewCase('equipment.current.glove');
assert.equal(evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(threeEffectPreview.team), completedPreview(threeEffectPreview.input, threeEffectPreview.output)]),
]), previewScenario).status, 'PASS', 'a three-effect piece locks all three existing levels');

const unsupportedPotentialResult = structuredClone(currentTeamResult);
unsupportedPotentialResult.operators[0].weapon.potential = '3潜';
const previewUnsupportedPotential = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(unsupportedPotentialResult), completedPreview({
    ...matchingPreviewInput,
    weaponPotential: '3潜',
  }, {
    ...previewResult,
    finalConfig: {
      ...previewResult.finalConfig,
      weapon: { ...previewResult.finalConfig.weapon, potential: '3潜' },
    },
  })]),
]), previewScenario);
assert.equal(previewUnsupportedPotential.status, 'FAIL', 'an unmapped source potential fails instead of passing through');
assert.ok(failureCodes(previewUnsupportedPotential).has('required-turn-tool-input-assertions-missing'));

const previewWrongPotentialMapping = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    weaponPotential: 'P0',
  })]),
]), previewScenario);
assert.equal(previewWrongPotentialMapping.status, 'FAIL', 'preview input maps the current renderer potential to the exact tool enum');
assert.ok(failureCodes(previewWrongPotentialMapping).has('required-turn-tool-input-assertions-missing'));

const previewWrongSkill3Base = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    weaponSkill3Level: 4,
  })]),
]), previewScenario);
assert.equal(previewWrongSkill3Base.status, 'FAIL', 'preview input maps the current effective skill 3 level back to its exact pre-potential base');
assert.ok(failureCodes(previewWrongSkill3Base).has('required-turn-tool-input-assertions-missing'));

const zeroPotentialTeamResult = structuredClone(currentTeamResult);
zeroPotentialTeamResult.operators[0].weapon.potential = '0潜';
zeroPotentialTeamResult.operators[0].weapon.skillLevels.skill3 = 4;
const zeroPotentialPreviewInput = { ...matchingPreviewInput, weaponPotential: 'P0', weaponSkill3Level: 4 };
const zeroPotentialPreviewResult = {
  ...previewResult,
  finalConfig: {
    ...previewResult.finalConfig,
    weapon: {
      ...previewResult.finalConfig.weapon,
      potential: '0潜',
      skillLevels: { ...previewResult.finalConfig.weapon.skillLevels, skill3: 4 },
    },
  },
};
assert.equal(evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(zeroPotentialTeamResult), completedPreview(zeroPotentialPreviewInput, zeroPotentialPreviewResult)]),
]), previewScenario).status, 'PASS', 'zero-potential input and effective skill 3 values use the declared closed mappings');

const previewWrongIdentity = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    weaponId: 'weapon.other',
  })]),
]), previewScenario);
assert.equal(previewWrongIdentity.status, 'FAIL', 'preview input must preserve the prior current weapon identity');
assert.ok(failureCodes(previewWrongIdentity).has('required-turn-tool-input-assertions-missing'));

const previewOmittedLevels = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    weaponLevel: undefined,
    weaponSkill1Level: undefined,
    operatorSkillA: undefined,
  })]),
]), previewScenario);
assert.equal(previewOmittedLevels.status, 'FAIL', 'preview input cannot silently default current weapon/operator levels');
assert.ok(failureCodes(previewOmittedLevels).has('required-turn-tool-input-assertions-missing'));

const previewOmittedEquipmentLevel = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    equipments: matchingPreviewInput.equipments.map((equipment, index) => (
      index === 0 ? { ...equipment, equipmentEntry2Level: undefined } : equipment
    )),
  })]),
]), previewScenario);
assert.equal(previewOmittedEquipmentLevel.status, 'FAIL', 'preview input cannot silently default an existing equipment effect level');
assert.ok(failureCodes(previewOmittedEquipmentLevel).has('required-turn-tool-input-assertions-missing'));

const previewInventedEquipmentLevel = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview({
    ...matchingPreviewInput,
    equipments: matchingPreviewInput.equipments.map((equipment, index) => (
      index === 1 ? { ...equipment, equipmentEntry3Level: 3 } : equipment
    )),
  })]),
]), previewScenario);
assert.equal(previewInventedEquipmentLevel.status, 'FAIL', 'preview input cannot invent a level for a nonexistent equipment effect');
assert.ok(failureCodes(previewInventedEquipmentLevel).has('required-turn-tool-input-assertions-missing'));

const previewFinalConfigDrift = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview(matchingPreviewInput, {
    ...previewResult,
    finalConfig: {
      ...previewResult.finalConfig,
      weapon: { ...previewResult.finalConfig.weapon, level: 90 },
    },
  })]),
]), previewScenario);
assert.equal(previewFinalConfigDrift.status, 'FAIL', 'renderer finalConfig must preserve the prior current loadout');
assert.ok(failureCodes(previewFinalConfigDrift).has('required-turn-tool-result-assertions-missing'));

const previewFinalSkill3Drift = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview(matchingPreviewInput, {
    ...previewResult,
    finalConfig: {
      ...previewResult.finalConfig,
      weapon: {
        ...previewResult.finalConfig.weapon,
        skillLevels: { ...previewResult.finalConfig.weapon.skillLevels, skill3: matchingPreviewInput.weaponSkill3Level },
      },
    },
  })]),
]), previewScenario);
assert.equal(previewFinalSkill3Drift.status, 'FAIL', 'renderer finalConfig must retain the effective skill 3 level, not the preview input base');
assert.ok(failureCodes(previewFinalSkill3Drift).has('required-turn-tool-result-assertions-missing'));

const previewFinalEffectIdentityDrift = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview(matchingPreviewInput, {
    ...previewResult,
    finalConfig: {
      ...previewResult.finalConfig,
      equipment: previewResult.finalConfig.equipment.map((equipment, index) => (
        index === 0 ? {
          ...equipment,
          effects: equipment.effects.map((effect, effectIndex) => (
            effectIndex === 0 ? { ...effect, effectId: 'effect.other' } : effect
          )),
        } : equipment
      )),
    },
  })]),
]), previewScenario);
assert.equal(previewFinalEffectIdentityDrift.status, 'FAIL', 'renderer finalConfig must preserve equipment effect identity with its level');
assert.ok(failureCodes(previewFinalEffectIdentityDrift).has('required-turn-tool-result-assertions-missing'));

const previewMissingToken = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview(matchingPreviewInput, {
    ...previewResult, proposalToken: undefined,
  })]),
]), previewScenario);
assert.equal(previewMissingToken.status, 'FAIL', 'preview without a proposal token fails');
assert.ok(failureCodes(previewMissingToken).has('required-turn-tool-result-assertions-missing'));

const previewWrongStatus = evaluateScenarioVerification(syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview(matchingPreviewInput, {
    ...previewResult, state: 'READY',
  })]),
]), previewScenario);
assert.equal(previewWrongStatus.status, 'FAIL', 'preview without REVIEW_REQUIRED status fails');
assert.ok(failureCodes(previewWrongStatus).has('required-turn-tool-result-assertions-missing'));

const previewWithApprovalQuestionRun = syntheticRun([
  syntheticTurn(1, [completedTeamLoadouts(), completedPreview()]),
]);
previewWithApprovalQuestionRun.questions = { value: { questions: [{ requestId: 'approval-1', status: 'open' }] } };
const previewWithApprovalQuestion = evaluateScenarioVerification(previewWithApprovalQuestionRun, previewScenario);
assert.equal(previewWithApprovalQuestion.status, 'FAIL', 'preview cannot request approval through a native question');
assert.ok(failureCodes(previewWithApprovalQuestion).has('max-question-requests-exceeded'));

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
    'source-only-guide-search-then-exact-section-read',
    'source-only-guide-expected-reference-required',
    'source-only-guide-repeated-search-and-section-calls-rejected',
    'source-only-guide-section-read-bound-to-search-exact-read-policy',
    'source-only-guide-unrelated-exact-reference-rejected',
    'catalog-one-weapon-plus-one-equipment-batch-only',
    'catalog-materialize-read-and-fragment-retries-rejected',
    'catalog-exact-input-and-structured-result-identity-enforced',
    'invalid-structured-assertion-schema-is-error-verifier',
    'invalid-verifier-schema-is-pre-provider',
    'structured-assertion-engine-has-no-scenario-id-special-cases',
    'operator-current-loadout-preview-cross-call-full-config-enforced',
    'operator-preview-review-token-status-and-no-approval-enforced',
    'topology-and-set-scenarios-migrated',
    'unresolved-composite-scenario-present',
    'unresolved-typed-contract-state-and-final-visible-conclusion-required',
    'unresolved-unicode-clause-boundaries-enforced',
    'unresolved-structural-clause-rules-enforced',
    'final-visible-text-excludes-ignored-parts',
    'user-correction-replan-unchanged-scope',
  ],
}));
