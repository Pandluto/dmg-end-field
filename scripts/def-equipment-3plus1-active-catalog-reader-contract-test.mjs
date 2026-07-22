import assert from 'node:assert/strict';
import { createDefEquipment3Plus1ActiveCatalogReaders } from './def-core/equipment-3plus1-active-catalog-reader.mjs';
import { createDefEquipment3Plus1RecommendationService } from './def-core/equipment-3plus1-recommendation.mjs';

const effect = (effectId, typeKey) => ({ effectId, label: effectId, typeKey, unit: 'percent', value: 0.2 });
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
  threePieceBuffs: { bonus: effect('tide-three', 'allSkillDmgBonus') },
  equipments: {
    armor: item('tide-armor', '潮涌护甲', '护甲', { ultimate: effect('ultimate', 'ultimateDmgBonus'), strength: effect('strength', 'strengthBoost') }),
    glove: item('tide-glove', '潮涌护手', '护手', { ice: effect('ice', 'iceDmgBonus'), strength: effect('strength', 'strengthBoost') }),
    accessory: item('tide-accessory', '潮涌供哀杖', '配件', { strength: effect('strength', 'strengthBoost'), will: effect('will', 'willBoost') }),
    accessory2: item('tide-accessory-2', '潮涌切割器', '配件', { ultimate: effect('ultimate', 'ultimateDmgBonus'), will: effect('will', 'willBoost') }),
  },
};
const bieli = {
  name: '别礼',
  element: 'ice',
  profession: '突击',
  mainStat: '力量',
  subStat: '意志',
  skills: {
    q: { displayName: '别礼终结技', buttonType: 'Q', hitMeta: { one: { levels: { M3: 8 } } } },
  },
};

let reads = 0;
const readers = createDefEquipment3Plus1ActiveCatalogReaders({
  getDataManagementService() {
    return {
      readActiveGameCatalog() {
        reads += 1;
        return {
          source: 'active',
          dataVersion: 'catalog-test-v1',
          catalogSha256: `sha256:${'0'.repeat(64)}`,
          databasePath: '/private/catalog.sqlite',
          operators: { bieli },
          weapons: {},
          equipmentLibrary: { gearSets: { tide } },
        };
      },
    };
  },
});

const operators = readers.readOperatorCatalog();
const equipmentSource = readers.readEquipmentLibrarySource();
assert.equal(reads, 1, 'operator and equipment readers must capture one active catalog per recommendation composition');
assert.equal(operators.bieli.name, '别礼');
assert.equal(equipmentSource.library.gearSets.tide.name, '潮涌');
assert.equal(equipmentSource.storageKey, 'catalog:catalog-test-v1');
assert.equal(equipmentSource.capturedAt, 0);
assert.equal('databasePath' in equipmentSource, false, 'database locations are never exposed through recommendation ports');

const service = createDefEquipment3Plus1RecommendationService({
  ...readers,
  async loadGuideReferences() { return []; },
  async readGuideSection() { throw new Error('guide section should not be read without a guide reference'); },
  async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [] }; },
  async readGearSetAliasIndex() { return new Map(); },
});
const result = await service.recommend({
  sessionId: 'catalog-reader-session',
  turnId: 'catalog-reader-turn',
  input: { operatorQuery: 'bieli', setQuery: 'tide' },
});
assert.equal(result.contract, 'DefEquipmentThreePlusOneRecommendationV1');
assert.equal(result.state, 'READY', JSON.stringify(result));
assert.equal(result.result.operator.name, '别礼');
assert.equal(result.result.selectedSet.name, '潮涌');
assert.equal(result.sourceRefs.some((entry) => entry.id === 'catalog:catalog-test-v1'), true);

console.log(JSON.stringify({
  ok: true,
  checks: ['active-game-catalog-only', 'catalog-capture-consistency', 'bieli-tide-without-now-storage'],
}));
