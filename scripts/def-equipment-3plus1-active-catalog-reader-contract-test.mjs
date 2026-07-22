import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDefEquipment3Plus1ActiveCatalogReaders } from './def-core/equipment-3plus1-active-catalog-reader.mjs';
import { createDefEquipment3Plus1RecommendationService } from './def-core/equipment-3plus1-recommendation.mjs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const { createCatalogDatabase, createDataManagementService } = require('../electron/data-management-service.cjs');

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

// A typed active-catalog refusal is an expected boundary state, never a
// profile-resolution failure. Keep both pointer and schema errors stable at
// the composite service boundary; capability gets a real database fixture
// below because it depends on the schema-v1 release shape.
for (const code of [
  'active-game-catalog-active-pointer-invalid',
  'catalog-schema-version-mismatch',
]) {
  const catalogError = new Error(`catalog reader refused: ${code}`);
  catalogError.code = code;
  const failingReaders = createDefEquipment3Plus1ActiveCatalogReaders({
    getDataManagementService() {
      return {
        readActiveGameCatalog() {
          throw catalogError;
        },
      };
    },
  });
  const failingRecommendation = createDefEquipment3Plus1RecommendationService({
    ...failingReaders,
    async loadGuideReferences() { return []; },
    async readGuideSection() { throw new Error('guide read is unreachable when the active catalog is unavailable'); },
    async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [] }; },
    async readGearSetAliasIndex() { return new Map(); },
  });
  const boundaryFailure = await failingRecommendation.recommend({
    sessionId: `catalog-failure-${code}`,
    turnId: `catalog-failure-${code}`,
    input: { operatorQuery: 'bieli', setQuery: 'tide' },
  });
  assert.equal(boundaryFailure.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
  assert.equal(boundaryFailure.code, code);
  assert.equal(boundaryFailure.failureStage, 'capture-catalog');
  assert.equal(boundaryFailure.status, 409);
  assert.equal(boundaryFailure.nextAction, 'REPORT_AND_STOP');
}

// A real active schema-v1 release is valid for generic Data Management reads,
// but its missing equipment_sets capability must arrive at the composite Tool
// unchanged. The recommendation layer may not turn that safe refusal into an
// opaque internal 500.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-3plus1-active-v1-'));
try {
  const builtinCatalogPath = path.join(temporaryRoot, 'builtin.sqlite');
  const activeVersion = 'legacy-v1';
  const activeDirectory = path.join(temporaryRoot, 'runtime', 'catalog', 'versions', activeVersion);
  const activeCatalogPath = path.join(activeDirectory, 'catalog.sqlite');
  createCatalogDatabase({
    databasePath: builtinCatalogPath,
    dataVersion: 'builtin-v2',
    operators: [{ id: 'bieli', name: '别礼', payload: bieli }],
    equipments: Object.values(tide.equipments).map((equipment) => ({
      id: equipment.equipmentId,
      name: equipment.name,
      payload: { ...equipment, gearSetId: tide.gearSetId },
    })),
    equipmentSets: [{ id: tide.gearSetId, name: tide.name, payload: tide }],
  });
  fs.mkdirSync(activeDirectory, { recursive: true });
  fs.copyFileSync(builtinCatalogPath, activeCatalogPath);
  const legacyDb = new DatabaseSync(activeCatalogPath);
  legacyDb.exec("DROP TABLE equipment_sets; UPDATE catalog_meta SET value = '1' WHERE key = 'schema_version'; UPDATE catalog_meta SET value = 'legacy-v1' WHERE key = 'data_version';");
  legacyDb.close();
  const catalogSha256 = crypto.createHash('sha256').update(fs.readFileSync(activeCatalogPath)).digest('hex');
  fs.writeFileSync(path.join(activeDirectory, 'data-release-manifest.json'), JSON.stringify({
    type: 'dmg.data-release-manifest.v1',
    manifestVersion: 1,
    releaseTag: activeVersion,
    dataVersion: activeVersion,
    generatedAt: '2026-07-23T00:00:00.000Z',
    minShellVersion: '',
    catalogSchemaVersion: 1,
    package: { fileName: 'data-legacy-v1.zip', sizeBytes: 1, sha256: '0'.repeat(64) },
    catalog: {
      sha256: catalogSha256,
      operators: 1,
      weapons: 0,
      equipments: 4,
      buffs: 0,
      preloadedTimelineTemplates: 0,
    },
    referenceArchives: [],
  }), 'utf8');
  fs.writeFileSync(path.join(temporaryRoot, 'runtime', 'catalog', 'active.json'), JSON.stringify({ dataVersion: activeVersion }), 'utf8');

  const activeReaders = createDefEquipment3Plus1ActiveCatalogReaders({
    getDataManagementService() {
      return createDataManagementService({
        runtimeDataRoot: path.join(temporaryRoot, 'runtime'),
        builtinCatalogPath,
      });
    },
  });
  const activeRecommendation = createDefEquipment3Plus1RecommendationService({
    ...activeReaders,
    async loadGuideReferences() { return []; },
    async readGuideSection() { throw new Error('guide read is unreachable when the active catalog is unavailable'); },
    async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [] }; },
    async readGearSetAliasIndex() { return new Map(); },
  });
  const capabilityError = await activeRecommendation.recommend({
    sessionId: 'active-v1-session',
    turnId: 'active-v1-turn',
    input: { operatorQuery: 'bieli', setQuery: 'tide' },
  });
  assert.equal(capabilityError.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
  assert.equal(capabilityError.code, 'active-game-catalog-capability-unavailable');
  assert.equal(capabilityError.failureStage, 'capture-catalog');
  assert.equal(capabilityError.status, 409);
  assert.equal(capabilityError.nextAction, 'REPORT_AND_STOP');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'now-storage.json')), false);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  checks: ['active-game-catalog-only', 'catalog-capture-consistency', 'active-pointer-and-schema-errors-preserved', 'active-v1-capability-error-preserved', 'bieli-tide-without-now-storage'],
}));
