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
const {
  createCatalogDatabase,
  createDataManagementService,
  signDataReleaseManifest,
} = require('../electron/data-management-service.cjs');

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
          catalogSha256: '0'.repeat(64),
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
assert.equal(operators.bieli.id, 'bieli');
assert.equal(operators.bieli.catalogProvenance, 'active-game-catalog');
assert.equal(equipmentSource.library.gearSets.tide.name, '潮涌');
assert.equal(equipmentSource.storageKey, 'catalog:catalog-test-v1');
assert.equal(equipmentSource.capturedAt, 0);
assert.equal(equipmentSource.source.dataVersion, 'catalog-test-v1');
assert.equal(equipmentSource.source.catalogSha256, '0'.repeat(64));
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

// Typed rejections that can originate from readActiveGameCatalog() are
// expected boundary states, never profile-resolution failures. Cover each
// explicit family: selected-release pointer/payload, release-manifest
// signature/hash, and catalog database hash/schema.
for (const code of [
  'active-game-catalog-active-pointer-invalid',
  'active-game-catalog-active-manifest-missing',
  'active-game-catalog-payload-hash-mismatch',
  'invalid-data-release-signature',
  'invalid-data-release-sha256',
  'invalid-data-release-manifest',
  'catalog-sha256-mismatch',
  'catalog-schema-version-mismatch',
]) {
  const catalogError = new Error(`catalog reader refused: ${code}`);
  catalogError.code = code;
  catalogError.details = { fixture: code, expected: 'trusted-release', actual: 'rejected-release' };
  catalogError.retryable = true;
  catalogError.nextAction = 'RETRY_FRESH_TURN';
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
  assert.equal(boundaryFailure.retryable, false);
  assert.equal(boundaryFailure.nextAction, 'REPORT_AND_STOP');
  assert.deepEqual(boundaryFailure.details, catalogError.details);
}

// Classification is deliberately narrow. An untyped programming/driver
// exception must remain an internal 500 and must not leak arbitrary details.
const unknownCatalogError = new Error('sqlite driver panic');
unknownCatalogError.details = { internalPath: '/private/catalog.sqlite' };
const unknownReaders = createDefEquipment3Plus1ActiveCatalogReaders({
  getDataManagementService() {
    return {
      readActiveGameCatalog() {
        throw unknownCatalogError;
      },
    };
  },
});
const unknownRecommendation = createDefEquipment3Plus1RecommendationService({
  ...unknownReaders,
  async loadGuideReferences() { return []; },
  async readGuideSection() { throw new Error('guide read is unreachable when the active catalog is unavailable'); },
  async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [] }; },
  async readGearSetAliasIndex() { return new Map(); },
});
const unknownFailure = await unknownRecommendation.recommend({
  sessionId: 'unknown-catalog-failure',
  turnId: 'unknown-catalog-failure',
  input: { operatorQuery: 'bieli', setQuery: 'tide' },
});
assert.equal(unknownFailure.contract, 'DefEquipmentThreePlusOneRecommendationErrorV1');
assert.equal(unknownFailure.code, 'equipment-3plus1-internal-error');
assert.equal(unknownFailure.failureStage, 'resolve-profile');
assert.equal(unknownFailure.status, 500);
assert.equal(unknownFailure.retryable, false);
assert.equal(unknownFailure.nextAction, 'REPORT_AND_STOP');
assert.equal('details' in unknownFailure, false);

// Exercise the real Data Management verifier as well as the port-level code
// matrix above. These fixtures are fully local: no downloaded release or
// mutable product storage is involved.
const signedReleaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-3plus1-signed-release-'));
try {
  const dataVersion = 'signed-v2';
  const builtinCatalogPath = path.join(signedReleaseRoot, 'builtin.sqlite');
  const activeDirectory = path.join(signedReleaseRoot, 'runtime', 'catalog', 'versions', dataVersion);
  const activeCatalogPath = path.join(activeDirectory, 'catalog.sqlite');
  createCatalogDatabase({
    databasePath: builtinCatalogPath,
    dataVersion,
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
  const catalogSha256 = crypto.createHash('sha256').update(fs.readFileSync(activeCatalogPath)).digest('hex');
  const manifestPath = path.join(activeDirectory, 'data-release-manifest.json');
  const activePath = path.join(signedReleaseRoot, 'runtime', 'catalog', 'active.json');
  const manifest = {
    type: 'dmg.data-release-manifest.v1',
    manifestVersion: 1,
    releaseTag: dataVersion,
    dataVersion,
    generatedAt: '2026-07-23T00:00:00.000Z',
    minShellVersion: '',
    catalogSchemaVersion: 2,
    package: { fileName: 'data-signed-v2.zip', sizeBytes: 1, sha256: '0'.repeat(64) },
    catalog: {
      sha256: catalogSha256,
      operators: 1,
      weapons: 0,
      equipments: 4,
      equipmentSets: 1,
      buffs: 0,
      preloadedTimelineTemplates: 0,
    },
    referenceArchives: [],
    signature: { algorithm: 'ed25519', keyId: 'fixture', value: Buffer.alloc(64, 7).toString('base64') },
  };
  fs.writeFileSync(activePath, JSON.stringify({ dataVersion }), 'utf8');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const dataManagementService = createDataManagementService({
    runtimeDataRoot: path.join(signedReleaseRoot, 'runtime'),
    builtinCatalogPath,
    publicKey,
    requireSignature: true,
  });
  const recommendAgainstRealVerifier = async (fixtureId) => {
    const releaseReaders = createDefEquipment3Plus1ActiveCatalogReaders({ getDataManagementService: () => dataManagementService });
    const releaseRecommendation = createDefEquipment3Plus1RecommendationService({
      ...releaseReaders,
      async loadGuideReferences() { return []; },
      async readGuideSection() { throw new Error('guide read is unreachable when the active catalog is unavailable'); },
      async resolveCombatConventions() { return { ok: true, state: 'READY', rules: [] }; },
      async readGearSetAliasIndex() { return new Map(); },
    });
    return releaseRecommendation.recommend({
      sessionId: fixtureId,
      turnId: fixtureId,
      input: { operatorQuery: 'bieli', setQuery: 'tide' },
    });
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  const signatureFailure = await recommendAgainstRealVerifier('invalid-release-signature');
  assert.equal(signatureFailure.code, 'invalid-data-release-signature');
  assert.equal(signatureFailure.status, 409);
  assert.equal(signatureFailure.failureStage, 'capture-catalog');
  assert.equal(signatureFailure.retryable, false);
  assert.equal(signatureFailure.nextAction, 'REPORT_AND_STOP');

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, catalog: { ...manifest.catalog, sha256: 'invalid-hash' } }), 'utf8');
  const manifestHashFailure = await recommendAgainstRealVerifier('invalid-release-manifest-hash');
  assert.equal(manifestHashFailure.code, 'invalid-data-release-sha256');
  assert.equal(manifestHashFailure.status, 409);
  assert.equal(manifestHashFailure.failureStage, 'capture-catalog');

  const wrongCatalogSha256 = catalogSha256 === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
  const { signature: _invalidSignature, ...unsignedManifest } = manifest;
  const wrongCatalogHashManifest = signDataReleaseManifest({
    ...unsignedManifest,
    catalog: { ...unsignedManifest.catalog, sha256: wrongCatalogSha256 },
  }, privateKey, 'fixture');
  fs.writeFileSync(manifestPath, JSON.stringify(wrongCatalogHashManifest), 'utf8');
  const catalogHashFailure = await recommendAgainstRealVerifier('catalog-hash-mismatch');
  assert.equal(catalogHashFailure.code, 'catalog-sha256-mismatch');
  assert.equal(catalogHashFailure.status, 409);
  assert.equal(catalogHashFailure.failureStage, 'capture-catalog');
  assert.equal(catalogHashFailure.retryable, false);
  assert.equal(catalogHashFailure.nextAction, 'REPORT_AND_STOP');
  assert.equal(catalogHashFailure.details.expected, wrongCatalogSha256);
  assert.equal(catalogHashFailure.details.actual, catalogSha256);

  fs.writeFileSync(activePath, JSON.stringify({ dataVersion: '' }), 'utf8');
  const pointerFailure = await recommendAgainstRealVerifier('invalid-active-pointer');
  assert.equal(pointerFailure.code, 'active-game-catalog-active-pointer-invalid');
  assert.equal(pointerFailure.status, 409);
  assert.equal(pointerFailure.failureStage, 'capture-catalog');
} finally {
  fs.rmSync(signedReleaseRoot, { recursive: true, force: true });
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
  checks: ['active-game-catalog-only', 'catalog-capture-consistency', 'explicit-data-management-release-rejections', 'real-invalid-release-signature', 'real-release-manifest-hash-rejection', 'real-catalog-content-hash-mismatch', 'real-active-pointer-rejection', 'release-details-preserved', 'unknown-catalog-error-remains-500', 'active-v1-capability-error-preserved', 'bieli-tide-without-now-storage'],
}));
