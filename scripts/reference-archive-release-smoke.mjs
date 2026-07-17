import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildReferenceArchiveReleasePackage } from './build-reference-archive-release.mjs';

const require = createRequire(import.meta.url);
const {
  TIMELINE_ARCHIVE_TYPE,
  createDataManagementService,
} = require('../electron/data-management-service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-reference-archive-'));
const runtimeDataRoot = path.join(root, 'runtime');
const sourceDirectory = path.join(root, 'reference-source');
const releaseDirectory = path.join(root, 'release');
fs.mkdirSync(sourceDirectory, { recursive: true });
fs.mkdirSync(releaseDirectory, { recursive: true });

function payload(id) {
  return {
    selectedCharacters: [{ id: `operator-${id}` }],
    timelineData: { staffLines: [{ buttons: [{ id: `button-${id}` }] }] },
    skillButtonTable: { [`button-${id}`]: { id: `button-${id}` } },
    allBuffList: [{ id: `buff-${id}`, name: `Buff ${id}` }],
  };
}

const referenceArchive = {
  type: TIMELINE_ARCHIVE_TYPE,
  archiveVersion: 1,
  source: 'reference',
  archiveId: 'reference-tree',
  label: '参考节点树存档',
  createdAt: '2026-07-17T00:00:00.000Z',
  payload: payload('current'),
  worktree: {
    nodeCount: 2,
    currentNodeId: 'node-current',
    nodes: [
      {
        id: 'node-root', branchId: 'main', label: '根节点', status: 'ready',
        basePayload: payload('base'), workingPayload: payload('root'), createdAt: 10, updatedAt: 11,
      },
      {
        id: 'node-current', parentNodeId: 'node-root', branchId: 'main', label: '当前节点', status: 'applied',
        basePayload: payload('root'), workingPayload: payload('current'), createdAt: 12, updatedAt: 13,
      },
    ],
  },
};
fs.writeFileSync(path.join(sourceDirectory, 'reference-tree.json'), JSON.stringify(referenceArchive), 'utf8');

const releaseBuild = buildReferenceArchiveReleasePackage({
  source: sourceDirectory,
  output: releaseDirectory,
  releaseId: 'v1.7.2',
  minShellVersion: '1.8.2',
  generatedAt: '2026-07-17T00:00:00.000Z',
});
const release = {
  packagePath: releaseBuild.packagePaths[0],
  manifest: JSON.parse(fs.readFileSync(releaseBuild.manifestPath, 'utf8')),
};
const service = createDataManagementService({ runtimeDataRoot, shellVersion: '1.8.2' });
service.ensureUserDatabase();

const installed = service.installReferenceArchiveRelease({ manifest: release.manifest, archivePath: release.packagePath });
assert.equal(installed.installed, true);
const references = service.listTimelineArchives({ source: 'reference' });
assert.equal(references.length, 1);
assert.equal(references[0].nodeCount, 2);
assert.equal(references[0].releaseId, 'v1.7.2');

const convertedReference = service.convertTimelineArchiveToWorkspace({
  source: 'reference', archiveId: 'reference-tree', updatedAt: 20,
});
assert.equal(convertedReference.importedNodeCount, 2);
assert.equal(convertedReference.totalNodeCount, 3, 'converted workspaces contain an import root plus all archived nodes');
assert.notEqual(convertedReference.checkoutRef.targetId, convertedReference.rootNodeId, 'the matching current node remains the checkout target');
assert.deepEqual(convertedReference.payload, payload('current'));
assert.equal(service.listSqliteWorkspaces().find((entry) => entry.document.id === convertedReference.document.id)?.nodeCount, 3);

const localExport = service.exportSqliteWorkspaceArchive({ timelineId: convertedReference.document.id, kind: 'local', label: '本地导出' });
assert.equal(localExport.outbox, false);
assert.equal(service.listTimelineArchives({ source: 'local' }).some((entry) => entry.archiveId === localExport.archive.archiveId), true);
const referenceExport = service.exportSqliteWorkspaceArchive({ timelineId: convertedReference.document.id, kind: 'reference' });
assert.equal(referenceExport.outbox, true);
assert.equal(fs.existsSync(referenceExport.filePath), true);
assert.equal(service.listTimelineArchives({ source: 'pending-reference' }).some((entry) => entry.archiveId === referenceExport.archive.archiveId), true);
const pendingToLocal = service.transferTimelineArchive({
  from: 'pending-reference', to: 'local', archiveId: referenceExport.archive.archiveId,
});
assert.equal(pendingToLocal.archive.library, 'local');
assert.equal(service.listTimelineArchives({ source: 'pending-reference' }).some((entry) => entry.archiveId === referenceExport.archive.archiveId), false);
assert.equal(service.listTimelineArchives({ source: 'local' }).some((entry) => entry.archiveId === referenceExport.archive.archiveId), true);
const localToPending = service.transferTimelineArchive({
  from: 'local', to: 'pending-reference', archiveId: referenceExport.archive.archiveId,
});
assert.equal(localToPending.archive.library, 'pending-reference');
assert.equal(service.deleteTimelineArchive({ library: 'pending-reference', archiveId: referenceExport.archive.archiveId }).deleted, true);
assert.equal(service.listTimelineArchives({ source: 'pending-reference' }).some((entry) => entry.archiveId === referenceExport.archive.archiveId), false);
assert.throws(() => service.deleteTimelineArchive({ library: 'reference', archiveId: 'reference-tree' }), {
  code: 'timeline-archive-library-readonly',
});

const flatArchive = {
  type: TIMELINE_ARCHIVE_TYPE,
  archiveVersion: 1,
  source: 'local',
  archiveId: 'legacy-flat',
  label: '旧版扁平存档',
  createdAt: '2026-07-17T00:00:00.000Z',
  payload: payload('flat'),
};
fs.writeFileSync(path.join(service.paths.localArchiveDirectory, 'legacy-flat.json'), JSON.stringify(flatArchive), 'utf8');
const convertedFlat = service.convertTimelineArchiveToWorkspace({ source: 'local', archiveId: 'legacy-flat', updatedAt: 30 });
assert.equal(convertedFlat.importedNodeCount, 0);
assert.equal(convertedFlat.totalNodeCount, 1, 'a flat legacy archive creates only the new import root');
assert.equal(convertedFlat.checkoutRef.targetId, convertedFlat.rootNodeId);
service.applySqliteWorkspace({ timelineId: convertedFlat.document.id, updatedAt: 31 });
assert.equal(JSON.parse(service.getWorkspaceState().values['def.selected-characters.v1'])[0].id, 'operator-flat');
const deletedWorkspace = service.deleteSqliteWorkspace({ timelineId: convertedFlat.document.id });
assert.equal(deletedWorkspace.document.id, convertedFlat.document.id);
assert.equal(service.listSqliteWorkspaces().some((entry) => entry.document.id === convertedFlat.document.id), false);
assert.equal(service.listTimelineArchives({ source: 'local' }).some((entry) => entry.archiveId === 'legacy-flat'), true, 'deleting SQLite must not delete local archives');

const legacyBundle = {
  type: 'dmg.timeline-bundle.v2',
  schemaVersion: 2,
  manifest: { exportedAt: 32, scope: 'snapshot', timelineId: 'legacy-bundle', label: '旧 Bundle', payloadHash: 'legacy' },
  document: { id: 'legacy-bundle', label: '旧 Bundle' },
  payloads: [payload('bundle')],
  snapshots: [{ id: 'legacy-bundle-snapshot', label: '旧 Bundle 快照', createdAt: 32, payloadIndex: 0 }],
  checkoutRef: { targetType: 'snapshot', targetId: 'legacy-bundle-snapshot', updatedAt: 32 },
};
const importedBundle = service.importLegacyTimelineBundleArchive({ bundle: legacyBundle, sourceName: 'legacy-bundle.json' });
assert.equal(importedBundle.imported, true);
assert.equal(importedBundle.archive.nodeCount, 0);
const convertedBundle = service.convertTimelineArchiveToWorkspace({ source: 'local', archiveId: importedBundle.archive.archiveId, updatedAt: 33 });
assert.equal(convertedBundle.totalNodeCount, 1, 'a legacy Bundle becomes a local archive before the normal conversion path');

const malformedArchive = {
  ...flatArchive,
  archiveId: 'malformed-tree',
  label: '节点树损坏存档',
  worktree: { nodeCount: 2, nodes: [] },
};
fs.writeFileSync(path.join(service.paths.localArchiveDirectory, 'malformed-tree.json'), JSON.stringify(malformedArchive), 'utf8');
assert.equal(service.listTimelineArchives({ source: 'local' }).find((entry) => entry.archiveId === 'malformed-tree')?.worktreeDiagnostic?.code, 'timeline-archive-node-count-mismatch');
assert.throws(() => service.convertTimelineArchiveToWorkspace({ source: 'local', archiveId: 'malformed-tree', updatedAt: 40 }), {
  code: 'timeline-archive-node-count-mismatch',
});
const payloadOnly = service.convertTimelineArchiveToWorkspace({ source: 'local', archiveId: 'malformed-tree', payloadOnly: true, updatedAt: 41 });
assert.equal(payloadOnly.totalNodeCount, 1);
assert.equal(payloadOnly.compatibility[0].code, 'timeline-archive-node-count-mismatch');

fs.rmSync(root, { recursive: true, force: true });
console.log('Reference archive release smoke passed.');
