import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createCatalogDatabase,
  createDataManagementService,
  createDataReleasePackage,
  signDataReleaseManifest,
} = require('../electron/data-management-service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-management-'));
const runtimeRoot = path.join(root, 'runtime-data');
const releaseRoot = path.join(root, 'releases');
const builtinCatalogPath = path.join(runtimeRoot, 'catalog', 'builtin', 'catalog.sqlite');
const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [] };

function catalogInput(version, attack) {
  return {
    databasePath: version === 'builtin-v1'
      ? builtinCatalogPath
      : path.join(root, `${version}.sqlite`),
    dataVersion: version,
    operators: [{ id: 'operator.last-rite', name: '别礼', payload: { id: 'operator.last-rite', attack } }],
    weapons: [{ id: 'weapon.glory-memory', name: '光荣记忆', payload: { id: 'weapon.glory-memory', attack } }],
    equipments: [{ id: 'equipment.demo', name: '演示装备', payload: { id: 'equipment.demo' } }],
    buffs: [{ id: 'buff.demo', name: '演示 Buff', payload: { id: 'buff.demo' } }],
    templates: [{ id: 'template.demo', label: '演示预载排轴', payload, createdAt: 1 }],
  };
}

const builtin = createCatalogDatabase(catalogInput('builtin-v1', 318));
assert.equal(builtin.counts.operators, 1);

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const service = createDataManagementService({ runtimeDataRoot: runtimeRoot, builtinCatalogPath, shellVersion: '1.8.2', publicKey });
service.ensureUserDatabase();
service.putUserOperatorConfig('operator.last-rite', { level: 90 }, 10);
service.putUserBuff('user-buff.demo', { name: '用户 Buff' }, 11);

assert.equal(service.readActiveCatalog().source, 'builtin');
assert.equal(service.readActiveCatalog().dataVersion, 'builtin-v1');
assert.deepEqual(service.getUserOperatorConfig('operator.last-rite')?.payload, { level: 90 });
assert.deepEqual(service.getUserBuff('user-buff.demo')?.payload, { name: '用户 Buff' });
const initialWorkspace = service.putWorkspaceState({
  'def.selected-characters.v1': JSON.stringify(['operator.last-rite']),
  'def.timeline.data.v1': JSON.stringify(payload.timelineData),
  'def.skill-button.v1': JSON.stringify({}),
  'def.all-buff-list.v1': JSON.stringify([{ id: 'user-buff.demo', name: '用户 Buff' }]),
  'def.operator-config.page-cache.v1': JSON.stringify({ 'operator.last-rite': { level: 90 } }),
}, 12);
assert.equal(initialWorkspace.updatedAt, 12);
assert.deepEqual(service.getWorkspaceState()?.values['def.selected-characters.v1'], JSON.stringify(['operator.last-rite']));

const legacyDatabasePath = path.join(root, 'legacy-timeline.sqlite3');
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const legacyRepository = createTimelineRepository({ databasePath: legacyDatabasePath });
legacyRepository.ensureDocument({ id: 'legacy-document', label: '旧排轴', createdAt: 12 });
legacyRepository.createOrReuseSnapshot({ id: 'legacy-snapshot', timelineId: 'legacy-document', label: '旧恢复点', payload, createdAt: 13 });
legacyRepository.setCheckoutRef({ timelineId: 'legacy-document', targetType: 'snapshot', targetId: 'legacy-snapshot', updatedAt: 14 });
legacyRepository.close();
assert.throws(() => service.migrateLegacyTimelineRepository({ legacyDatabasePath }), {
  code: 'legacy-timeline-migration-target-not-pristine',
});

const migrationRuntimeRoot = path.join(root, 'migration-runtime-data');
const migrationBuiltinPath = path.join(migrationRuntimeRoot, 'catalog', 'builtin', 'catalog.sqlite');
fs.mkdirSync(path.dirname(migrationBuiltinPath), { recursive: true });
fs.copyFileSync(builtinCatalogPath, migrationBuiltinPath);
const migrationService = createDataManagementService({ runtimeDataRoot: migrationRuntimeRoot, builtinCatalogPath: migrationBuiltinPath });
const migration = migrationService.migrateLegacyTimelineRepository({ legacyDatabasePath });
assert.equal(migration.migrated, true);
assert.equal(fs.existsSync(legacyDatabasePath), true, 'migration must preserve the original database');
const migratedRepository = createTimelineRepository({ databasePath: migrationService.paths.userDatabasePath });
assert.equal(migratedRepository.getDocument('legacy-document')?.label, '旧排轴');
assert.equal(migratedRepository.getCheckoutRef('legacy-document')?.targetId, 'legacy-snapshot');
migratedRepository.close();
assert.equal(migrationService.migrateLegacyTimelineRepository({ legacyDatabasePath }).reason, 'already-migrated');
const materializedLegacySnapshots = migrationService.materializeLegacyTimelineSnapshotsAsLocalArchives();
assert.equal(materializedLegacySnapshots.created, 1, 'legacy SQLite snapshots must become local archives without deleting their rows');
assert.equal(migrationService.listTimelineArchives({ source: 'local' })[0]?.label, '旧恢复点');
assert.equal(migrationService.materializeLegacyTimelineSnapshotsAsLocalArchives().reused, 1, 'legacy snapshot archive materialization must be idempotent');

const legacyArchivePath = path.join(root, 'legacy-share-archive.json');
fs.writeFileSync(legacyArchivePath, JSON.stringify({
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'share-archive',
  name: '旧共享排轴',
  createdAt: '2026-07-17T00:00:00.000Z',
  exportedAt: '2026-07-17T00:00:00.000Z',
  sections: ['timeline'],
  storage: {
    local: {
      'def.timeline.snapshot-archive.v1': {
        version: 'v1',
        snapshots: [{ id: 'legacy-browser-snapshot', label: '浏览器旧快照', createdAt: 15, payload }],
      },
    },
    session: {
      'def.selected-characters.v1': JSON.stringify([]),
      'def.timeline.data.v1': JSON.stringify(payload.timelineData),
      'def.skill-button.v1': JSON.stringify({}),
      'def.all-buff-list.v1': JSON.stringify([]),
    },
  },
}), 'utf8');
const archiveMigration = migrationService.migrateLegacyArchives({ sources: [{
  legacyOrigin: 'shared-archive',
  sourceName: 'legacy-share-archive.json',
  filePath: legacyArchivePath,
}] })[0];
assert.equal(archiveMigration.migrated, true);
assert.equal(fs.existsSync(legacyArchivePath), true, 'legacy archive must remain in place');
assert.equal(fs.existsSync(archiveMigration.backupPath), true, 'legacy archive must be backed up before import');
assert.equal(migrationService.migrateLegacyArchives({ sources: [{
  legacyOrigin: 'shared-archive',
  sourceName: 'legacy-share-archive.json',
  filePath: legacyArchivePath,
}] })[0].reason, 'already-migrated');
assert.equal(migrationService.listLegacyMigrationRecords().some((entry) => entry.sourceName === 'legacy-share-archive.json' && entry.status === 'completed'), true);

function buildRelease(version, attack) {
  const catalog = createCatalogDatabase(catalogInput(version, attack));
  return createDataReleasePackage({
    catalogPath: catalog.databasePath,
    outputDirectory: releaseRoot,
    manifest: { dataVersion: version, releaseTag: version, minShellVersion: '1.8.2' },
    privateKey,
    keyId: 'smoke-key',
  });
}

const releaseV2 = buildRelease('data-v2', 342);
const installedV2 = service.installRelease({ manifest: releaseV2.manifest, archivePath: releaseV2.packagePath, manifestUrl: 'file://smoke/v2' });
assert.equal(installedV2.installed, true);
assert.equal(installedV2.active.dataVersion, 'data-v2');
assert.equal(service.listPreloadedTemplates()[0]?.id, 'template.demo');
assert.equal(service.getPreloadedTemplate('template.demo').catalogVersion, 'data-v2');
assert.equal(service.getPreloadedTemplate('template.demo').payload.timelineData.staffLines.length, 0);
const cloned = service.clonePreloadedTemplate({
  templateId: 'template.demo', timelineId: 'template-document', snapshotId: 'template-snapshot', createdAt: 20,
});
assert.equal(cloned.document.id, 'template-document');
assert.equal(cloned.checkoutRef.targetId, 'template-snapshot');
const clonedRepository = createTimelineRepository({ databasePath: service.paths.userDatabasePath });
assert.equal(clonedRepository.getCheckoutRef('template-document')?.targetId, 'template-snapshot');
assert.equal(clonedRepository.listAuditEvents('template-document').filter((event) => event.eventType === 'template.cloned').length, 1);
clonedRepository.close();
const restoredWorkspace = service.restoreWorkspaceSnapshot({
  timelineId: 'template-document',
  snapshotId: 'template-snapshot',
  updatedAt: 22,
});
assert.equal(restoredWorkspace.checkoutRef.targetId, 'template-snapshot');
assert.deepEqual(service.getWorkspaceState()?.values['def.selected-characters.v1'], JSON.stringify([]));
const restoredWorkspaceRepository = createTimelineRepository({ databasePath: service.paths.userDatabasePath });
assert.equal(restoredWorkspaceRepository.getCheckoutRef('template-document')?.targetId, 'template-snapshot');
assert.equal(restoredWorkspaceRepository.listAuditEvents('template-document').filter((event) => event.eventType === 'snapshot.restored').length, 1);
restoredWorkspaceRepository.close();
assert.throws(() => service.clonePreloadedTemplate({
  templateId: 'template.demo', timelineId: 'template-rollback', snapshotId: 'template-snapshot', createdAt: 21,
}), { code: 'timeline-snapshot-id-conflict' });
const rollbackRepository = createTimelineRepository({ databasePath: service.paths.userDatabasePath });
assert.equal(rollbackRepository.getDocument('template-rollback'), undefined, 'template clone failure must roll back its document');
rollbackRepository.close();

const userHashBefore = crypto.createHash('sha256').update(fs.readFileSync(service.paths.userDatabasePath)).digest('hex');
const userHashAfterV2 = crypto.createHash('sha256').update(fs.readFileSync(service.paths.userDatabasePath)).digest('hex');
assert.equal(userHashAfterV2, userHashBefore, 'catalog activation must not touch user.sqlite');

const releaseV3 = buildRelease('data-v3', 366);
const installedV3 = service.installRelease({ manifest: releaseV3.manifest, archivePath: releaseV3.packagePath });
assert.equal(installedV3.active.dataVersion, 'data-v3');
assert.equal(service.rollbackTo('data-v2').dataVersion, 'data-v2');
assert.equal(service.installRelease({ manifest: releaseV3.manifest, archivePath: releaseV3.packagePath }).reused, true);
assert.equal(service.readActiveCatalog().dataVersion, 'data-v3');

const badHashManifest = signDataReleaseManifest({
  ...releaseV3.manifest,
  dataVersion: 'data-v4',
  package: { ...releaseV3.manifest.package, sha256: '0'.repeat(64) },
}, privateKey, 'smoke-key');
assert.throws(() => service.installRelease({ manifest: badHashManifest, archivePath: releaseV3.packagePath }), {
  code: 'data-release-package-sha256-mismatch',
});
assert.equal(service.readActiveCatalog().dataVersion, 'data-v3');

const incompatibleManifest = signDataReleaseManifest({
  ...releaseV3.manifest,
  dataVersion: 'data-v5',
  minShellVersion: '9.0.0',
}, privateKey, 'smoke-key');
assert.throws(() => service.installRelease({ manifest: incompatibleManifest, archivePath: releaseV3.packagePath }), {
  code: 'data-release-shell-version-incompatible',
});
assert.equal(service.readActiveCatalog().dataVersion, 'data-v3');

const userHashAfter = crypto.createHash('sha256').update(fs.readFileSync(service.paths.userDatabasePath)).digest('hex');
assert.equal(userHashAfter, userHashBefore);
fs.rmSync(root, { recursive: true, force: true });
console.log('Data management service smoke passed.');
