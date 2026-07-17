import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildBuiltinDataCatalog } from './build-data-catalog.mjs';

const require = createRequire(import.meta.url);
const { validateCatalogDatabase } = require('../electron/data-management-service.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-catalog-build-'));
const outputPath = path.join(directory, 'catalog.sqlite');

try {
  const result = buildBuiltinDataCatalog({ outputPath, dataVersion: 'catalog-smoke-v1' });
  const catalog = validateCatalogDatabase({ databasePath: outputPath, expectedDataVersion: 'catalog-smoke-v1' });
  assert.equal(result.databasePath, outputPath);
  assert.equal(catalog.counts.operators, 19);
  assert.equal(catalog.counts.weapons, 27);
  assert.equal(catalog.counts.equipments, 135);
  assert.equal(catalog.counts.buffs, 2350);
  assert.equal(catalog.counts.preloadedTimelineTemplates, 0);
  console.log('Data catalog build smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
