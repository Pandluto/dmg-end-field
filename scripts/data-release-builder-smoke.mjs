import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDataReleasePackage } from './build-data-release-package.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-release-builder-'));
try {
  const result = buildDataReleasePackage({
    output: directory,
    dataVersion: 'data-release-smoke-v1',
    releaseTag: 'data-release-smoke-v1',
    minShellVersion: '1.8.2',
  });
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(result.mode, 'catalog-full');
  assert.equal(result.signed, false);
  assert.equal(manifest.type, 'dmg.data-release-manifest.v1');
  assert.equal(manifest.dataVersion, 'data-release-smoke-v1');
  assert.equal(manifest.catalog.operators, 19);
  assert.equal(manifest.catalog.weapons, 27);
  assert.equal(manifest.catalog.equipments, 135);
  assert.equal(manifest.catalog.buffs, 2350);
  const zipList = spawnSync('unzip', ['-Z1', result.packagePaths[0]], { encoding: 'utf8' });
  assert.equal(zipList.status, 0, zipList.stderr);
  assert.deepEqual(zipList.stdout.trim().split(/\r?\n/).sort(), ['catalog.sqlite', 'manifest.json']);
  console.log('Data release builder smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
