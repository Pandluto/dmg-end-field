import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildBuiltinDataCatalog } from './build-data-catalog.mjs';

const require = createRequire(import.meta.url);
const { CATALOG_SCHEMA_VERSION, createDataManagementService, validateCatalogDatabase } = require('../electron/data-management-service.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-catalog-build-'));
const outputPath = path.join(directory, 'catalog.sqlite');

try {
  const result = buildBuiltinDataCatalog({ outputPath, dataVersion: 'catalog-smoke-v1' });
  const catalog = validateCatalogDatabase({ databasePath: outputPath, expectedDataVersion: 'catalog-smoke-v1' });
  assert.equal(result.databasePath, outputPath);
  assert.equal(catalog.schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.equal(catalog.counts.operators, 19);
  assert.equal(catalog.counts.weapons, 27);
  assert.equal(catalog.counts.equipments, 135);
  assert.equal(catalog.counts.equipmentSets, 16);
  assert.equal(catalog.counts.buffs, 2350);
  assert.equal(catalog.counts.preloadedTimelineTemplates, 0);

  const service = createDataManagementService({
    runtimeDataRoot: path.join(directory, 'runtime'),
    builtinCatalogPath: outputPath,
  });
  const gameCatalog = service.readActiveGameCatalog();
  assert.equal(gameCatalog.source, 'builtin');
  assert.equal(gameCatalog.dataVersion, 'catalog-smoke-v1');
  assert.equal(gameCatalog.catalogSha256, catalog.sha256);
  assert.equal(gameCatalog.databasePath, outputPath);
  assert.equal(gameCatalog.operators['operator.af71c8d9c628d1d48d990755']?.name, '别礼');
  assert.equal(gameCatalog.equipmentLibrary.gearSets['gear-set-chao-yong']?.name, '潮涌');
  assert.equal(gameCatalog.equipmentLibrary.gearSets['gear-set-chao-yong']?.threePieceBuffs?.buff1?.typeKey, 'allSkillDmgBonus');
  console.log('Data catalog build smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
