import assert from 'node:assert/strict';
import {
  AGENT_PRODUCT_CATALOG_STORAGE_KEYS,
  buildAgentProductCatalog,
  discoverGearTopologies,
  getAgentBuildGuide,
  getCompatibleWeapons,
  getGearTopologyFacts,
  getSkillFact,
  normalizeAgentProductQuery,
  planGearTopology,
  queryAgentProductCatalog,
  readAgentProductCatalog,
  type AgentProductCatalogInput,
  type AgentProductCatalogStorage,
} from './agentProductCatalogService';

const operatorDraft = {
  id: 'operator-luoxi',
  name: '洛茜',
  avatarUrl: 'data:image/png;base64,large-image-must-not-leak',
  rarity: 6,
  profession: '近卫',
  weapon: '单手剑',
  element: 'physical',
  mainStat: '敏捷',
  subStat: '智识',
  level: 90,
  attributes: {
    strength: { level90: 10 },
    agility: { level90: 20 },
    intelligence: { level90: 8 },
    will: { level90: 6 },
    atk: { level90: 300 },
    hp: { level90: 5000 },
  },
  buffs: { talent: { effects: {} }, potential: { effects: {} }, skill: { effects: {} } },
  skills: {
    'skill-a': {
      displayName: '普通攻击',
      buttonType: 'A',
      iconUrl: 'data:image/png;base64,large-skill-image-must-not-leak',
      hitCount: 1,
      hitMeta: {
        hit1: {
          displayName: '第一击',
          element: 'physical',
          skillType: 'A',
          levels: { M3: 1.2 },
        },
      },
    },
    'skill-q': {
      displayName: '终结技',
      buttonType: 'Q',
      iconUrl: '',
      hitCount: 2,
      hitMeta: {
        hit1: {
          displayName: '第一段',
          element: 'physical',
          skillType: 'Q',
          levels: { M3: 4.2 },
        },
        hit2: {
          displayName: '第二段',
          element: 'physical',
          skillType: 'Q',
          levels: { M3: 2.1 },
        },
      },
    },
  },
};

const duplicateOperatorA = { ...operatorDraft, id: 'operator-duplicate-a', name: '重名干员' };
const duplicateOperatorB = { ...operatorDraft, id: 'operator-duplicate-b', name: '重名干员' };

const weaponLibrary = {
  'weapon-test-sword': {
    id: 'weapon-test-sword',
    name: '测试剑',
    rarity: 6,
    type: '单手剑',
    description: '这段描述不能进入 Agent 目录的大字段。'.repeat(20),
    imgUrl: 'data:image/png;base64,large-weapon-image-must-not-leak',
    attackGrowth: { '1': 10, '90': 100 },
    skills: {
      skill1: { name: '攻击力', statType: 'atk', levels: { '1': { value: 10, description: 'raw' } } },
      skill2: { name: '属性', statType: 'agility', levels: { '1': { value: 5, description: 'raw' } } },
      skill3: {
        name: '特效',
        statType: '',
        effects: {
          effect1: {
            name: '物理伤害',
            type: 'physicalDmgBonus',
            category: 'passive',
            unit: 'percent',
            levels: { '0': 0.1, '3': 0.2 },
          },
        },
      },
    },
  },
  'weapon-test-sword-2': {
    id: 'weapon-test-sword-2',
    name: '第二把测试剑',
    rarity: 5,
    type: '单手剑',
    attackGrowth: { '90': 80 },
    skills: {},
  },
  'weapon-test-greatsword': {
    id: 'weapon-test-greatsword',
    name: '测试重剑',
    rarity: 6,
    type: '双手剑',
    attackGrowth: { '90': 120 },
    skills: {},
  },
};

const equipmentLibrary = {
  schemaVersion: 2,
  gearSets: {
    'target-set': {
      schemaVersion: 2,
      gearSetId: 'target-set',
      name: '目标套装',
      imgUrl: 'data:image/png;base64,large-set-image-must-not-leak',
      threePieceBuffs: {
        effect1: {
          effectId: 'effect1',
          name: '目标三件套',
          typeKey: 'physicalDmgBonus',
          category: 'passive',
          value: 0.2,
          unit: 'percent',
        },
      },
      equipments: {
        armor: { equipmentId: 'target-armor', name: '目标护甲', part: '护甲', fixedStat: { label: '防御力', typeKey: 'defense', value: 56, unit: 'flat' }, effects: {} },
        glove: { equipmentId: 'target-glove', name: '目标护手', part: '护手', effects: {} },
        accessoryA: { equipmentId: 'target-accessory-a', name: '目标配件甲', part: '配件', effects: {} },
        accessoryB: { equipmentId: 'target-accessory-b', name: '目标配件乙', part: '配件', effects: {} },
      },
    },
    'off-set': {
      schemaVersion: 2,
      gearSetId: 'off-set',
      name: '异套',
      equipments: {
        accessory: { equipmentId: 'off-accessory', name: '异套配件', part: '配件', effects: {} },
      },
    },
  },
};

const input: AgentProductCatalogInput = {
  operators: {
    [operatorDraft.id]: operatorDraft,
    [duplicateOperatorA.id]: duplicateOperatorA,
    [duplicateOperatorB.id]: duplicateOperatorB,
  },
  weapons: weaponLibrary,
  equipment: equipmentLibrary,
};

class FixtureStorage implements AgentProductCatalogStorage {
  constructor(private readonly values: ReadonlyMap<string, string>) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

function createFixtureStorage(inputValue: AgentProductCatalogInput): AgentProductCatalogStorage {
  return new FixtureStorage(new Map([
    [AGENT_PRODUCT_CATALOG_STORAGE_KEYS.operatorLibrary, JSON.stringify(inputValue.operators)],
    [AGENT_PRODUCT_CATALOG_STORAGE_KEYS.weaponLibrary, JSON.stringify(inputValue.weapons)],
    [AGENT_PRODUCT_CATALOG_STORAGE_KEYS.equipmentLibrary, JSON.stringify(inputValue.equipment)],
  ]));
}

const catalog = buildAgentProductCatalog(input, { limit: 2 });

assert.equal(catalog.source, 'browser-sqlite-mirror');
assert.equal(catalog.operators.catalogCount, 3);
assert.equal(catalog.operators.truncated, true);
assert.equal(catalog.skills.catalogCount, 6);
assert.equal(catalog.weapons.catalogCount, 3);
assert.equal(catalog.equipment.catalogCount, 5);
assert.equal(catalog.gearSets.catalogCount, 2);
assert.equal(JSON.stringify(catalog).includes('imgUrl'), false, 'catalog must not expose image fields');
assert.equal(JSON.stringify(catalog).includes('data:image'), false, 'catalog must not expose image payloads');
assert.equal(JSON.stringify(catalog).includes('不能进入 Agent 目录'), false, 'catalog must not expose long descriptions');

assert.equal(normalizeAgentProductQuery(' 测-试  剑 '), '测试剑');
const exactWeapon = queryAgentProductCatalog(input, { domain: 'weapons', query: '测试剑' });
assert.equal(exactWeapon.matchMode, 'exact');
assert.equal(exactWeapon.queryCount, 1);
assert.equal(exactWeapon.results[0]?.id, 'weapon-test-sword');

const normalizedWeapon = queryAgentProductCatalog(input, { domain: 'weapons', query: ' 测 试-剑 ' });
assert.equal(normalizedWeapon.matchMode, 'normalized');
assert.equal(normalizedWeapon.results[0]?.id, 'weapon-test-sword');

const ambiguousOperator = queryAgentProductCatalog(input, { domain: 'operators', query: '重 名 干员' });
assert.equal(ambiguousOperator.matchMode, 'ambiguous');
assert.equal(ambiguousOperator.ambiguous, true);
assert.equal(ambiguousOperator.queryCount, 2);
assert.equal(ambiguousOperator.resultCount, 2);

const emptyQuery = queryAgentProductCatalog(input, { domain: 'weapons', query: '' });
assert.equal(emptyQuery.matchMode, 'all');
assert.equal(emptyQuery.queryCount, 3);
assert.equal(emptyQuery.exhaustive, true);

const compatibleWeapons = getCompatibleWeapons(input, { operatorQuery: '洛茜' });
assert.equal(compatibleWeapons.compatibility, 'deterministic-weapon-type-match');
assert.deepEqual(
  compatibleWeapons.compatibleWeapons.results.map((weapon) => weapon.id),
  ['weapon-test-sword', 'weapon-test-sword-2'],
);
assert.equal(compatibleWeapons.recommendation.status, 'evidenceUnavailable');
assert.equal('score' in (compatibleWeapons.compatibleWeapons.results[0] ?? {}), false);

const exactSkillFact = getSkillFact(input, {
  operatorQuery: '洛茜',
  skillQuery: '终结技',
  hitQuery: '第二段',
});
assert.equal(exactSkillFact.state, 'READY');
assert.equal(exactSkillFact.skill?.skillId, 'skill-q');
assert.equal(exactSkillFact.hit?.key, 'hit2');
assert.equal(exactSkillFact.hit?.multiplier, 2.1);
assert.equal(exactSkillFact.hit?.element, 'physical');

const wrongOperatorSkill = getSkillFact(input, {
  operatorQuery: '重名干员',
  skillQuery: '终结技',
});
assert.equal(wrongOperatorSkill.state, 'OPERATOR_UNRESOLVED');
assert.equal(wrongOperatorSkill.skill, null);

const missingSkillFact = getSkillFact(input, {
  operatorQuery: '洛茜',
  skillQuery: '不存在的技能',
});
assert.equal(missingSkillFact.state, 'SKILL_NOT_FOUND');
assert.equal(missingSkillFact.hit, null);

const missingHitFact = getSkillFact(input, {
  operatorQuery: '洛茜',
  skillQuery: '终结技',
  hitQuery: '第三段',
});
assert.equal(missingHitFact.state, 'HIT_NOT_FOUND');
assert.equal(missingHitFact.skill?.skillId, 'skill-q');

const guide = getAgentBuildGuide(input, '洛茜');
assert.equal(guide.evidence.status, 'evidenceUnavailable');
assert.equal(guide.evidence.legacyGuidePolicy, 'legacy-1.2-guide-not-treated-as-1.8-fact');

const topologyFacts = getGearTopologyFacts(input, { setQuery: '目标 套-装' });
assert.equal(topologyFacts.state, 'READY');
assert.equal(topologyFacts.hasValidThreePlusOne, true);
assert.equal(topologyFacts.targetSet?.name, '目标套装');
assert.equal(topologyFacts.targetSetPartCounts['护甲'], 1);
assert.equal(topologyFacts.offSetCandidatesBySlot.accessory1, 1);
assert.equal(topologyFacts.constructibleCombinationCount > 0, true);

const topologyPlan = planGearTopology(input, { setQuery: '目标套装', limit: 1 });
assert.equal(topologyPlan.state, 'READY');
assert.equal(topologyPlan.ranking, 'unranked-facts-only');
assert.equal(topologyPlan.combinations.resultCount, 1);
assert.equal(topologyPlan.combinations.queryCount, topologyFacts.constructibleCombinationCount);
const plannedCombination = topologyPlan.combinations.results[0];
assert.ok(plannedCombination);
const normalizedTargetSetId = topologyFacts.targetSet?.id;
assert.equal(plannedCombination.targetSetPieces, 3);
assert.equal(plannedCombination.offSetPieces, 1);
assert.equal(Object.values(plannedCombination.pieces).filter((piece) => piece.gearSetId === normalizedTargetSetId).length, 3);
assert.equal(Object.values(plannedCombination.pieces).filter((piece) => piece.gearSetId !== normalizedTargetSetId).length, 1);
assert.deepEqual(
  Object.entries(plannedCombination.pieces).map(([slotKey, piece]) => [slotKey, piece.part]),
  [['armor', '护甲'], ['glove', '护手'], ['accessory1', '配件'], ['accessory2', '配件']],
);
assert.equal(topologyPlan.recommendation.status, 'evidenceUnavailable');

const discoveredTopologies = discoverGearTopologies(input, {
  limit: 8,
  combinationsPerSet: 2,
});
assert.equal(discoveredTopologies.state, 'READY');
assert.equal(discoveredTopologies.evaluatedSetCount, 2);
assert.equal(discoveredTopologies.validSetCount, 1);
assert.equal(discoveredTopologies.candidateSets.results[0]?.id, topologyFacts.targetSet?.id);
assert.equal(discoveredTopologies.candidateSets.results[0]?.combinations.resultCount, 2);
assert.equal(discoveredTopologies.ranking, 'unranked-facts-only');
assert.equal(discoveredTopologies.recommendation.status, 'evidenceUnavailable');
assert.equal(JSON.stringify(discoveredTopologies).includes('score'), false);
assert.equal(JSON.stringify(discoveredTopologies).includes('rankValue'), false);

const noOffSetInput: AgentProductCatalogInput = { ...input, equipment: { gearSets: { 'target-set': equipmentLibrary.gearSets['target-set'] } } };
const noOffSetPlan = planGearTopology(noOffSetInput, { setQuery: '目标套装' });
assert.equal(noOffSetPlan.state, 'NO_VALID_3_PLUS_1');
assert.equal(noOffSetPlan.combinations.queryCount, 0);
const noOffSetDiscovery = discoverGearTopologies(noOffSetInput);
assert.equal(noOffSetDiscovery.state, 'NO_VALID_3_PLUS_1');
assert.equal(noOffSetDiscovery.candidateSets.resultCount, 0);

const storageCatalog = readAgentProductCatalog({ storage: createFixtureStorage(input), limit: 1 });
assert.equal(storageCatalog.operators.catalogCount, 3);
assert.equal(storageCatalog.weapons.results.length, 1);
assert.equal(storageCatalog.equipment.source, 'browser-sqlite-mirror');

const emptyStorage = readAgentProductCatalog({ storage: new FixtureStorage(new Map()) });
assert.equal(emptyStorage.catalogCount, 0);
assert.equal(emptyStorage.exhaustive, true);
assert.equal(emptyStorage.truncated, false);
assert.equal(emptyStorage.operators.results.length, 0);
assert.equal(getGearTopologyFacts({ equipment: {} }, { setQuery: '不存在' }).state, 'SET_NOT_FOUND');

console.log('Agent product catalog service contract: PASS');
