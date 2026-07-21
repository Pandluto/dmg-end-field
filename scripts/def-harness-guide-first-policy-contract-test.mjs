import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(project, relativePath), 'utf8');

const adapter = read('agent/runtime/def-opencode-adapter/index.cjs');
const skill = read('agent/runtime/def/skills/timeline-workbench/SKILL.md');
const defTools = read('agent/runtime/def-tools/opencode/def.js');
const blackbox = read('docs/testing/def-agent-blackbox.md');
const harnessRoots = [
  'agent/harness/baseline/stable-v0',
  'agent/harness/examples/candidate-v1',
];

for (const source of [adapter, skill]) {
  assert.match(source, /GUIDE_FOUND/);
  assert.match(source, /PARTIAL_GUIDE_FOUND/);
  assert.match(source, /GUIDE_NOT_FOUND/);
  assert.match(source, /def_data_operator_build_guide/);
  assert.match(source, /def_data_operator_build_profile/);
  assert.match(source, /def_data_equipment_3plus1_plan/);
  assert.match(source, /bounded operator-specific build section|bounded build section/i);
  assert.match(source, /priorities explicitly (?:stated|present)|server-compiled `?plannerProfile`?/i);
  assert.match(source, /plannerProfileCapability/);
  assert.match(source, /(?:pass|pair)[\s\S]{0,40}unchanged|unchanged authorized profile/i);
  assert.match(source, /catalog.*verif|catalog.*must verify|catalog.*verifies/i);
  assert.match(source, /internal solver|internal solver constraint/i);
  assert.match(source, /at most two/);
  assert.match(source, /at least three target-set memberships/);
  assert.match(source, /four-piece target-set combination is legal/i);
  assert.match(source, /specific operator/i);
  assert.match(source, /Pure catalog facts/i);
  assert.match(source, /do not require guide discovery/i);
  assert.match(source, /discard[\s\S]{0,120}(?:proposalToken|proposal token)/i);
  assert.match(source, /(?:never|must not) reuse/i);
  assert.doesNotMatch(source, /invalidates? (?:the affected conclusion and )?(?:any prior|the old) proposal token/i);
  assert.doesNotMatch(source, /Generic equipment.*must not trigger game-knowledge search/);
  assert.doesNotMatch(source, /First enumerate all returned AVAILABLE topologies/);
  assert.doesNotMatch(source, /3\+1 means exactly three target-set memberships/i);
}

for (const root of harnessRoots) {
  const routing = read(`${root}/routing.md`);
  const tools = read(`${root}/tool-guidance.md`);
  const workflow = read(`${root}/workflow.md`);
  const response = read(`${root}/response-policy.md`);
  const contract = read(`${root}/agent-contract.md`);
  const combined = [routing, tools, workflow, response, contract].join('\n');

  for (const state of ['GUIDE_FOUND', 'PARTIAL_GUIDE_FOUND', 'GUIDE_NOT_FOUND']) {
    assert.match(combined, new RegExp(state));
  }
  assert.match(routing, /begins with `def_data_operator_build_guide`/);
  assert.match(routing, /specific operator/i);
  assert.match(routing, /Pure catalog facts/i);
  assert.match(routing, /do not require guide discovery/i);
  assert.match(tools, /once only when[\s\S]{0,160}specific operator/i);
  assert.match(tools, /comparisons unrelated to operator fit do not require this guide step/i);
  assert.match(tools, /exact fallback token/);
  assert.match(workflow, /authorized profile\/capability pair unchanged/);
  assert.match(tools, /plannerProfileCapability/);
  assert.match(tools, /Do not transcribe, add, remove, or reorder profile fields/);
  assert.match(workflow, /def_data_equipment_3plus1_plan/);
  assert.match(workflow, /Pure catalog facts[\s\S]{0,140}without a mandatory guide step/i);
  assert.match(workflow, /Agent must discard any old proposal token and must not reuse it/i);
  assert.match(contract, /duplicate accessories when typed policy permits them/);
  assert.match(contract, /at least three slots belong to the named target set/);
  assert.match(contract, /Four target-set memberships remain legal/);
  assert.match(response, /at most two genuinely close alternatives/);
  assert.match(response, /READY_WITH_TRADEOFFS[\s\S]{0,160}unordered/i);
  assert.match(response, /never label candidates first\/second/i);
  assert.match(response, /discard any prior proposal token, and never reuse it/i);
  assert.match(response, /Never answer by simply asserting or restating the old plan/);
  assert.doesNotMatch(combined, /invalidates? (?:the affected conclusion and )?(?:any prior|the old) proposal token/i);
  assert.doesNotMatch(combined, /A named guide is the only route/);
  assert.doesNotMatch(combined, /state the viable slot topologies/);
  assert.doesNotMatch(combined, /exactly three slots belong to the named target set/);
}

assert.match(defTools, /Required first evidence step only when judging[\s\S]{0,180}specific operator/i);
assert.match(defTools, /Pure catalog facts[\s\S]{0,180}do not require this tool/i);
assert.match(defTools, /plannerProfileCapability/);
assert.match(defTools, /Agent must discard it, never reuse it, and compute a fresh preview/i);
assert.doesNotMatch(defTools, /invalidates? the token/i);

const threePlusOneScenario = JSON.parse(read('agent/harness/scenarios/equipment-3plus1-topology-v1.json'));
assert.ok(threePlusOneScenario.verification.requiredTools.includes('def_data_operator_build_guide'));
assert.ok(!threePlusOneScenario.verification.requiredTools.includes('def_data_operator_build_profile'));
assert.ok(threePlusOneScenario.verification.requiredTools.includes('def_data_equipment_3plus1_plan'));
assert.ok(threePlusOneScenario.verification.forbiddenTools.includes('def_data_game_knowledge'));
assert.ok(threePlusOneScenario.verification.forbiddenTools.includes('def_data_game_knowledge_section'));
assert.ok(threePlusOneScenario.verification.forbiddenTools.includes('def_data_operator'));
assert.ok(threePlusOneScenario.verification.forbiddenTools.includes('def_data_skill'));
assert.equal(threePlusOneScenario.verification.maxRepeatedToolCalls.def_data_operator_build_guide, 1);
assert.equal(threePlusOneScenario.verification.maxRepeatedToolCalls.def_data_operator_build_profile, 1);
assert.equal(threePlusOneScenario.verification.maxRepeatedToolCalls.def_data_equipment_3plus1_plan, 1);
assert.deepEqual(threePlusOneScenario.verification.requiredToolsByTurn['1'], [
  'def_data_operator_build_guide',
  'def_data_native_catalog_materialize',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
]);
assert.deepEqual(threePlusOneScenario.verification.orderedToolsByTurn['1'], threePlusOneScenario.verification.requiredToolsByTurn['1']);

const setSelectionScenario = JSON.parse(read('agent/harness/scenarios/equipment-3plus1-set-selection-v1.json'));
assert.deepEqual(setSelectionScenario.verification.requiredToolsByTurn['1'], [
  'def_data_operator_build_guide',
  'def_data_native_catalog_materialize',
  'def_data_equipment_set_fit_shortlist',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
]);
assert.deepEqual(setSelectionScenario.verification.orderedToolsByTurn['1'], setSelectionScenario.verification.requiredToolsByTurn['1']);
assert.ok(setSelectionScenario.verification.forbiddenTools.includes('def_data_equipment'));
assert.equal(setSelectionScenario.verification.maxRepeatedToolCalls.def_data_equipment_set_fit_shortlist, 1);

const correctionScenario = JSON.parse(read('agent/harness/scenarios/operator-config-correction-review-v1.json'));
assert.ok(correctionScenario.verification.requiredTools.includes('def_data_operator_build_guide'));
assert.ok(!correctionScenario.verification.requiredTools.includes('def_data_operator_build_profile'));
assert.ok(correctionScenario.verification.requiredTools.includes('def_data_equipment_3plus1_plan'));
assert.ok(correctionScenario.verification.forbiddenTools.includes('def_data_game_knowledge'));
assert.ok(correctionScenario.verification.forbiddenTools.includes('def_data_operator'));
assert.ok(correctionScenario.verification.forbiddenTools.includes('def_data_skill'));
assert.ok(correctionScenario.verification.forbiddenTools.includes('def_operator_config_patch'));
assert.ok(correctionScenario.verification.forbiddenAssistantText.includes('仍然使用原方案'));
assert.deepEqual(correctionScenario.verification.requiredToolsByTurn['2'], [
  'def_data_operator_build_guide',
  'def_data_equipment_3plus1_plan',
]);
assert.deepEqual(correctionScenario.verification.orderedToolsByTurn['2'], correctionScenario.verification.requiredToolsByTurn['2']);

const supportWeaponScenario = JSON.parse(read('agent/harness/scenarios/support-weapon-convention-v1.json'));
assert.deepEqual(supportWeaponScenario.verification.requiredToolsByTurn['1'], [
  'def_data_operator_build_guide',
  'def_data_combat_conventions',
  'def_data_operator_build_profile',
  'def_data_weapon_fit_plan',
]);
assert.deepEqual(supportWeaponScenario.verification.orderedToolsByTurn['1'], supportWeaponScenario.verification.requiredToolsByTurn['1']);
assert.ok(supportWeaponScenario.verification.forbiddenTools.includes('def_data_game_knowledge'));
assert.ok(supportWeaponScenario.verification.forbiddenTools.includes('def_data_weapon'));
assert.ok(supportWeaponScenario.verification.forbiddenTools.includes('def_data_loadout_candidates'));
assert.equal(supportWeaponScenario.verification.maxRepeatedToolCalls.def_data_combat_conventions, 1);
assert.equal(supportWeaponScenario.verification.maxRepeatedToolCalls.def_data_weapon_fit_plan, 1);

const damageWeaponScenario = JSON.parse(read('agent/harness/scenarios/damage-weapon-guide-direct-v1.json'));
assert.deepEqual(damageWeaponScenario.verification.requiredToolsByTurn['1'], [
  'def_data_operator_build_guide',
  'def_data_weapon_fit_plan',
]);
assert.ok(damageWeaponScenario.verification.forbiddenTools.includes('def_data_combat_conventions'));
assert.ok(damageWeaponScenario.verification.forbiddenTools.includes('def_data_loadout_candidates'));
assert.ok(damageWeaponScenario.verification.forbiddenTools.includes('def_data_skill'));
assert.equal(damageWeaponScenario.verification.maxRepeatedToolCalls.def_data_weapon_fit_plan, 1);

const skillHitScenario = JSON.parse(read('agent/harness/scenarios/skill-hit-facts-v1.json'));
assert.deepEqual(skillHitScenario.verification.requiredToolsByTurn['1'], ['def_data_skill']);
assert.ok(skillHitScenario.verification.forbiddenTools.includes('def_data_combat_conventions'));
assert.ok(skillHitScenario.verification.forbiddenTools.includes('def_data_game_knowledge'));
assert.equal(skillHitScenario.verification.maxRepeatedToolCalls.def_data_skill, 1);

for (const scenario of [threePlusOneScenario, correctionScenario]) {
  const fallbackRule = scenario.verification.conditionalTools.find((rule) => (
    rule.when?.tool === 'def_data_operator_build_guide'
    && Array.isArray(rule.when?.resultState)
    && rule.when.resultState.includes('PARTIAL_GUIDE_FOUND')
    && rule.when.resultState.includes('GUIDE_NOT_FOUND')
  ));
  const foundRule = scenario.verification.conditionalTools.find((rule) => (
    rule.when?.tool === 'def_data_operator_build_guide'
    && rule.when?.resultState === 'GUIDE_FOUND'
  ));
  assert.ok(fallbackRule?.require?.includes('def_data_operator_build_profile'));
  assert.ok(foundRule?.forbid?.includes('def_data_operator_build_profile'));
}

const blackboxThreePlusOne = blackbox.slice(blackbox.indexOf('## Read-only equipment 3+1 regression'));
const blackboxOrder = [
  'def_data_operator_build_guide',
  'def_data_operator_build_profile',
  'def_data_native_catalog_materialize',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
].map((tool) => blackboxThreePlusOne.indexOf(tool));
assert.ok(blackboxOrder.every((index) => index >= 0));
assert.deepEqual(blackboxOrder, [...blackboxOrder].sort((left, right) => left - right));
assert.match(blackboxThreePlusOne, /at least three target-set memberships/);
assert.match(blackboxThreePlusOne, /four-piece target-set plan is legal/);
assert.match(blackboxThreePlusOne, /off-set is selected only when it strictly improves/);
assert.match(blackboxThreePlusOne, /must not call legacy equipment\/weapon\/loadout-candidates/);

console.log(JSON.stringify({
  ok: true,
  checks: [
    'guide-first-three-state-policy',
    'operator-fit-only-guide-routing',
    'catalog-fact-guide-bypass',
    'agent-side-proposal-discard',
    'guide-strategy-catalog-facts',
    'attribute-first-internal-topology',
    'minimum-three-plan-tool',
    'bounded-shortlist',
    'correction-replan',
    'turn-scoped-required-tools',
    'turn-scoped-tool-order',
    'read-only-scenarios',
    'support-weapon-convention-route',
    'damage-weapon-direct-planner-route',
    'skill-hit-facts-route',
  ],
}));
