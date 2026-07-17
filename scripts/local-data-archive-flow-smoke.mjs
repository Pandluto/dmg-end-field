import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDataManagementService } = require('../electron/data-management-service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-local-data-archive-flow-'));
try {
  const localDataDirectory = path.join(root, 'localdata');
  const shareDataDirectory = path.join(root, 'sharedata');
  const service = createDataManagementService({
    runtimeDataRoot: path.join(root, 'runtime'),
    localDataDirectory,
    shareDataDirectory,
  });
  service.ensureUserDatabase();

  const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [] };
  const dataPackage = {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'flow-package',
    name: 'Flow package',
    storage: { local: { 'def.operator-editor.smoke': { level: 90 } }, session: {} },
    timelineArchives: [{
      type: 'dmg.timeline-archive.v1',
      archiveVersion: 1,
      source: 'shared',
      archiveId: 'flow-shared-archive',
      label: 'Flow shared archive',
      createdAt: '2026-07-17T00:00:00.000Z',
      payload,
    }],
  };
  const imported = service.importDataPackageTimelineArchives({ dataPackage });
  assert.equal(imported.imported.length, 1);
  assert.equal(service.listTimelineArchives({ source: 'shared' }).length, 1);

  const legacyReferenceArchive = {
    type: 'dmg.timeline-archive.v1',
    archiveVersion: 1,
    source: 'reference',
    archiveId: 'legacy-reference-archive',
    label: 'Legacy reference archive',
    createdAt: '2026-07-17T00:00:00.000Z',
    payload,
  };
  fs.mkdirSync(service.paths.referenceArchiveOutboxDirectory, { recursive: true });
  fs.writeFileSync(path.join(service.paths.referenceArchiveOutboxDirectory, 'legacy-reference-archive.json'), `${JSON.stringify(legacyReferenceArchive)}\n`, 'utf8');
  fs.mkdirSync(path.join(service.paths.referenceArchiveVersionsDirectory, 'legacy-release', 'archives'), { recursive: true });
  fs.writeFileSync(path.join(service.paths.referenceArchiveVersionsDirectory, 'legacy-release', 'archives', 'installed-reference-archive.json'), `${JSON.stringify({ ...legacyReferenceArchive, archiveId: 'installed-reference-archive' })}\n`, 'utf8');
  const migratedLegacyLibraries = service.migrateLegacySharedArchiveLibraries();
  assert.equal(migratedLegacyLibraries.some((entry) => entry.error), false);
  assert.equal(service.listTimelineArchives({ source: 'shared' }).length, 3, 'old outbox and installed reference archives must migrate to Shared Archive');

  const converted = service.convertTimelineArchiveToWorkspace({
    source: 'shared',
    archiveId: 'flow-shared-archive',
    updatedAt: 100,
  });
  assert.equal(converted.totalNodeCount, 1, 'conversion must create the SQLite import root');
  assert.equal(service.listSqliteWorkspaces()[0]?.document.id, converted.document.id);

  fs.mkdirSync(localDataDirectory, { recursive: true });
  const targetPath = path.join(localDataDirectory, 'flow-package.json');
  fs.writeFileSync(targetPath, `${JSON.stringify(dataPackage, null, 2)}\n`, 'utf8');
  const written = service.writeSharedTimelineArchivesToDataPackage({ dataPackagePath: targetPath });
  assert.equal(written.archiveCount, 3);
  const rewritten = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  assert.deepEqual(rewritten.storage.local['def.operator-editor.smoke'], { level: 90 }, 'writing archive part must not mutate data part');
  assert.equal(rewritten.timelineArchives[0].source, 'shared');

  const dataOnlyPackage = {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'data-only',
    name: 'Data only',
    storage: { local: { 'def.operator-editor.smoke': { level: 1 } }, session: {} },
  };
  assert.deepEqual(service.importDataPackageTimelineArchives({ dataPackage: dataOnlyPackage }), { imported: [], reused: [] }, 'data-only package must not create a blank shared archive');

  const oldPackage = {
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'legacy-timeline-package',
    name: 'Legacy timeline package',
    storage: {
      local: {},
      session: {
        'def.timeline.data.v1': JSON.stringify(payload.timelineData),
        'def.skill-button.v1': JSON.stringify(payload.skillButtonTable),
      },
    },
  };
  assert.equal(service.importDataPackageTimelineArchives({ dataPackage: oldPackage }).imported.length, 1, 'legacy timeline fields must import only through Apply Data');
  console.log('Local Data archive flow smoke passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
