import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDataReleasePackage } from './build-data-release-package.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-release-builder-'));
try {
  const referenceArchiveDirectory = path.join(directory, 'reference-archive-outbox');
  fs.mkdirSync(referenceArchiveDirectory, { recursive: true });
  fs.writeFileSync(path.join(referenceArchiveDirectory, 'smoke-reference.json'), `${JSON.stringify({
    type: 'dmg.timeline-archive.v1',
    archiveVersion: 1,
    source: 'reference',
    archiveId: 'smoke-reference',
    label: 'Smoke reference archive',
    createdAt: new Date().toISOString(),
    payload: {
      selectedCharacters: [],
      timelineData: { staffLines: [] },
      allBuffList: [],
    },
  }, null, 2)}\n`, 'utf8');
  const result = buildDataReleasePackage({
    output: directory,
    referenceArchiveDirectory,
    dataVersion: 'data-release-smoke-v1',
    releaseTag: 'data-release-smoke-v1',
    minShellVersion: '1.8.2',
  });
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(result.mode, 'data-full');
  assert.equal(result.signed, false);
  assert.equal(manifest.type, 'dmg.data-release-manifest.v1');
  assert.equal(manifest.dataVersion, 'data-release-smoke-v1');
  assert.equal(manifest.catalog.operators, 19);
  assert.equal(manifest.catalog.weapons, 27);
  assert.equal(manifest.catalog.equipments, 135);
  assert.equal(manifest.catalog.buffs, 2350);
  assert.equal(manifest.referenceArchives.length, 1);
  assert.equal(manifest.referenceArchives[0].archiveId, 'smoke-reference');
  const zipList = spawnSync('unzip', ['-Z1', result.packagePaths[0]], { encoding: 'utf8' });
  assert.equal(zipList.status, 0, zipList.stderr);
  assert.deepEqual(zipList.stdout.trim().split(/\r?\n/).sort(), [
    'archives/',
    'archives/smoke-reference.json',
    'catalog.sqlite',
    'manifest.json',
  ]);
  console.log('Data release builder smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
