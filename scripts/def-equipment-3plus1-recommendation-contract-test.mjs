import assert from 'node:assert/strict';
import { createDefEquipment3Plus1RecommendationService } from './def-core/equipment-3plus1-recommendation.mjs';

const effect = (effectId, label, typeKey) => ({ effectId, label, typeKey, unit: 'percent', value: 0.2 });
const item = (equipmentId, name, part, effects) => ({ equipmentId, name, part, effects });
const tide = {
  gearSetId: 'tide', name: '潮涌',
  threePieceBuffs: { bonus: effect('tide-three', '全技能', 'allSkillDmgBonus') },
  equipments: {
    armor: item('tide-armor', '潮涌护甲', '护甲', { ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'), strength: effect('strength', '力量', 'strengthBoost') }),
    glove: item('tide-glove', '潮涌护手', '护手', { ice: effect('ice', '寒冷', 'iceDmgBonus'), strength: effect('strength', '力量', 'strengthBoost') }),
    accessory: item('tide-accessory', '潮涌供氧栓', '配件', { strength: effect('strength', '力量', 'strengthBoost'), will: effect('will', '意志', 'willBoost') }),
    accessory2: item('tide-accessory-2', '潮涌切割炬', '配件', { ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'), will: effect('will', '意志', 'willBoost') }),
  },
};
const frost = {
  gearSetId: 'frost', name: '寒流',
  threePieceBuffs: { bonus: effect('frost-three', '全技能', 'allSkillDmgBonus') },
  equipments: {
    armor: item('frost-armor', '寒流护甲', '护甲', { ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'), strength: effect('strength', '力量', 'strengthBoost') }),
    glove: item('frost-glove', '寒流护手', '护手', { ice: effect('ice', '寒冷', 'iceDmgBonus'), strength: effect('strength', '力量', 'strengthBoost') }),
    accessory: item('frost-accessory', '寒流供氧栓', '配件', { strength: effect('strength', '力量', 'strengthBoost'), will: effect('will', '意志', 'willBoost') }),
    accessory2: item('frost-accessory-2', '寒流切割炬', '配件', { ultimate: effect('ultimate', '终结技', 'ultimateDmgBonus'), will: effect('will', '意志', 'willBoost') }),
  },
};
const library = { gearSets: { tide, frost } };
const operators = {
  bieli: {
    id: 'bieli', name: '别礼', element: 'ice', profession: '突击', mainStat: '力量', subStat: '意志',
    skills: { q: { displayName: '临终别礼', buttonType: 'Q', hitMeta: { one: { levels: { M3: 8 } } } } },
  },
  alpha: { id: 'alpha', name: '雷电', element: 'ice', profession: '突击', mainStat: '力量', subStat: '意志', skills: { q: { displayName: '雷击', buttonType: 'Q', hitMeta: { one: { levels: { M3: 8 } } } } } },
  beta: { id: 'beta', name: '雷鸣', element: 'ice', profession: '突击', mainStat: '力量', subStat: '意志', skills: { q: { displayName: '雷鸣', buttonType: 'Q', hitMeta: { one: { levels: { M3: 8 } } } } } },
};
const frozenSource = structuredClone(library);
const ports = {
  async readOperatorCatalog() { return structuredClone(operators); },
  async loadGuideReferences() { return []; },
  async readGuideSection() { throw new Error('no guide should be read for this fixture'); },
  async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [], bundleHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }; },
  async readEquipmentLibrarySource() { return { library: structuredClone(library), storageKey: 'test-equipment' }; },
  async readGearSetAliasIndex() { return new Map([['潮涌', 'tide'], ['寒流', 'frost']]); },
};
const service = createDefEquipment3Plus1RecommendationService(ports);
const invoke = (input) => service.recommend({ sessionId: 'service-contract-session', turnId: 'turn-1', input });

const ready = await invoke({ operatorQuery: '别礼', setQuery: '潮涌套', shortlistLimit: 2 });
assert.equal(ready.contract, 'DefEquipmentThreePlusOneRecommendationV1');
assert.equal(ready.state, 'READY', JSON.stringify(ready));
assert.equal(ready.result.selectedSet.id, 'tide');
assert.equal(ready.result.plans[0].items.map((entry) => entry.slot).join(','), 'armor,glove,accessory1,accessory2');
assert.match(ready.requestDigest, /^sha256:[0-9a-f]{64}$/);
assert.match(ready.result.planDigest, /^sha256:[0-9a-f]{64}$/);
assert.equal(ready.result.catalogEvidence.exhaustive, true);
assert.deepEqual(library, frozenSource, 'the service must not mutate a trusted source object');

const correction = await invoke({ operatorQuery: '别礼', setQuery: '潮涌', priorPlanDigest: ready.result.planDigest, constraints: { duplicateAccessoryPolicy: 'forbid' } });
assert.equal(correction.state, 'READY', JSON.stringify(correction));
assert.equal(correction.supersedesPlanDigest, ready.result.planDigest);
assert.notEqual(correction.result.planDigest, ready.result.planDigest, 'a correction recomputes its plan digest');
assert.notEqual(correction.result.plans[0].items[2].stableId, correction.result.plans[0].items[3].stableId, 'forbid prevents duplicate compatible accessories');

const partialComparison = await invoke({ operatorQuery: '别礼', setQuery: '潮涌', constraints: { compareEquipmentQueries: [{ query: '不存在装备' }] } });
assert.equal(partialComparison.state, 'READY', JSON.stringify(partialComparison));
assert.equal(partialComparison.completeness, 'partial');
assert.equal(partialComparison.result.comparisons[0].decision, 'unresolved');

const operatorAmbiguity = await invoke({ operatorQuery: '雷', setQuery: '潮涌' });
assert.equal(operatorAmbiguity.state, 'NEEDS_INPUT');
assert.equal(operatorAmbiguity.nextQuestion.field, 'operatorQuery');

const unresolved = await invoke({ operatorQuery: '别礼', setQuery: '潮涌', constraints: { requiredEquipmentQueries: ['不存在装备'] } });
assert.equal(unresolved.state, 'UNRESOLVED');
assert.equal(unresolved.result, null);

const conflict = await invoke({ operatorQuery: '别礼', setQuery: '潮涌', constraints: { requiredEquipmentQueries: ['潮涌护甲'], excludedEquipmentQueries: ['tide-armor'] } });
assert.equal(conflict.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
assert.equal(conflict.failureStage, 'resolve-constraints');
assert.equal(conflict.status, 400);

const malformed = await invoke({ operatorQuery: '别礼', unknown: true });
assert.equal(malformed.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
assert.equal(malformed.failureStage, 'validate-input');

console.log(JSON.stringify({ ok: true, checks: ['ready', 'correction', 'comparison', 'needs-input', 'unresolved', 'constraint-error', 'strict-schema', 'readonly-source'] }));
