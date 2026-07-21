import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDataReleasePackage } from './build-data-release-package.mjs';

const require = createRequire(import.meta.url);
const { installLocalDataRelease } = require('../electron/data-management-service.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-release-builder-'));
try {
  const sourceDirectory = path.join(directory, 'localdata');
  const shareDirectory = path.join(directory, 'sharedata');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const sourcePath = path.join(sourceDirectory, 'smoke-data.json');
  const sourceData = {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'smoke-data',
    name: 'Smoke Local Data',
    createdAt: '2026-07-17T00:00:00.000Z',
    exportedAt: '2026-07-17T00:00:00.000Z',
    storage: {
      local: { 'def.operator-config.page-cache.v1': { 'operator.smoke': { level: 90 } } },
      session: { 'def.selected-characters.v1': JSON.stringify(['operator.smoke']) },
    },
    timelineArchives: [{
      type: 'dmg.timeline-archive.v1',
      archiveVersion: 1,
      source: 'shared',
      archiveId: 'smoke-timeline',
      label: 'Smoke Shared Archive',
      createdAt: '2026-07-17T00:00:00.000Z',
      payload: { selectedCharacters: [], timelineData: { staffLines: [] }, allBuffList: [] },
    }],
  };
  fs.writeFileSync(sourcePath, `${JSON.stringify(sourceData, null, 2)}\n`, 'utf8');

  const result = buildDataReleasePackage({
    source: sourcePath,
    sourceScope: 'local',
    output: directory,
    dataVersion: 'data-release-smoke-v1',
    releaseTag: 'data-release-smoke-v1',
    minShellVersion: '1.8.2',
  });
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(result.mode, 'local-data-full');
  assert.equal(result.signed, false);
  assert.equal(manifest.type, 'dmg.local-data-release-manifest.v1');
  assert.equal(manifest.dataVersion, 'data-release-smoke-v1');
  assert.equal(manifest.source.scope, 'local');
  assert.equal(manifest.source.id, 'smoke-data');
  const installed = installLocalDataRelease({
    manifest,
    archivePath: result.packagePaths[0],
    targetDirectory: shareDirectory,
    shellVersion: '1.8.2',
  });
  assert.equal(installed.installed, true);
  const installedData = JSON.parse(fs.readFileSync(installed.path, 'utf8'));
  assert.equal(installedData.id, 'smoke-data');
  assert.equal(installedData.timelineArchives[0].source, 'shared');
  assert.equal(JSON.parse(fs.readFileSync(path.join(shareDirectory, '.data-release-state.json'), 'utf8')).activeVersion, 'data-release-smoke-v1');
  assert.equal(installLocalDataRelease({
    manifest,
    archivePath: result.packagePaths[0],
    targetDirectory: shareDirectory,
    shellVersion: '1.8.2',
  }).reused, true);
  console.log('Local Data release builder smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
