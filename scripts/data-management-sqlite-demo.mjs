import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-data-management-demo-'));
const catalogRoot = path.join(root, 'catalog');
const stagingRoot = path.join(root, 'staging');
const userRoot = path.join(root, 'user');
const shellVersion = '1.8.2';
fs.mkdirSync(stagingRoot, { recursive: true });
fs.mkdirSync(userRoot, { recursive: true });

function sha256(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function runTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function compareVersions(left, right) {
  const toParts = (version) => version.split('.').map((part) => Number(part) || 0);
  const leftParts = toParts(left);
  const rightParts = toParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function createCatalog(filePath, { version, operatorAttack }) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE operators (id TEXT PRIMARY KEY, name TEXT NOT NULL, attack REAL NOT NULL) STRICT;
    CREATE TABLE weapons (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE equipments (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE buff_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE preloaded_timeline_templates (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      payload TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?)').run('data_version', version);
  db.prepare('INSERT INTO operators (id, name, attack) VALUES (?, ?, ?)').run('operator.lanwanting', '莱万汀', operatorAttack);
  db.prepare('INSERT INTO weapons (id, name) VALUES (?, ?)').run('weapon.demo', '演示武器');
  db.prepare('INSERT INTO equipments (id, name) VALUES (?, ?)').run('equipment.demo', '演示装备');
  db.prepare('INSERT INTO buff_definitions (id, name) VALUES (?, ?)').run('buff.demo', '演示 Buff');
  db.prepare('INSERT INTO preloaded_timeline_templates (id, label, payload) VALUES (?, ?, ?)').run(
    'template.demo',
    '预载演示排轴',
    JSON.stringify({ selectedCharacters: ['operator.lanwanting'], timelineData: { staffLines: [] } }),
  );
  db.close();
}

function createManifest(dataVersion, catalogPath, minShellVersion = '1.0.0') {
  return {
    type: 'dmg.data-release-manifest.v1',
    manifestVersion: 1,
    dataVersion,
    minShellVersion,
    catalogSha256: sha256(catalogPath),
  };
}

function validateStagedCatalog(filePath, manifest) {
  assert.equal(manifest.type, 'dmg.data-release-manifest.v1', 'manifest type must be explicit');
  assert.equal(manifest.manifestVersion, 1, 'manifest schema must be supported');
  assert.ok(compareVersions(shellVersion, manifest.minShellVersion) >= 0, 'Shell version is incompatible with this catalog');
  assert.equal(sha256(filePath), manifest.catalogSha256, 'staged catalog hash must match its manifest');
  const db = new DatabaseSync(filePath);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const version = db.prepare("SELECT value FROM catalog_meta WHERE key = 'data_version'").get()?.value;
  const requiredTables = ['operators', 'weapons', 'equipments', 'buff_definitions', 'preloaded_timeline_templates'];
  const presentTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  db.close();
  assert.equal(integrity, 'ok', 'staged catalog must pass SQLite integrity_check');
  assert.equal(version, manifest.dataVersion, 'catalog metadata must match its manifest version');
  requiredTables.forEach((table) => assert.ok(presentTables.has(table), `catalog must include ${table}`));
}

function activateFullCatalog({ stagedCatalogPath, manifest }) {
  validateStagedCatalog(stagedCatalogPath, manifest);
  const versionDirectory = path.join(catalogRoot, 'versions', manifest.dataVersion);
  const catalogPath = path.join(versionDirectory, 'catalog.sqlite');
  if (fs.existsSync(catalogPath)) {
    assert.equal(sha256(catalogPath), manifest.catalogSha256, 'an existing version must match the incoming manifest');
    fs.unlinkSync(stagedCatalogPath);
  } else {
    fs.mkdirSync(versionDirectory, { recursive: true });
    fs.renameSync(stagedCatalogPath, catalogPath);
    writeJsonAtomically(path.join(versionDirectory, 'manifest.json'), manifest);
  }
  // This pointer is the only mutable catalog selector. No catalog update opens
  // or writes the user database.
  writeJsonAtomically(path.join(catalogRoot, 'active.json'), {
    dataVersion: manifest.dataVersion,
    activatedAt: new Date().toISOString(),
  });
  return catalogPath;
}

function resolveCatalogForOfflineStartup() {
  const activePath = path.join(catalogRoot, 'active.json');
  if (fs.existsSync(activePath)) {
    const active = readJson(activePath);
    const versionPath = path.join(catalogRoot, 'versions', active.dataVersion, 'catalog.sqlite');
    if (fs.existsSync(versionPath)) return versionPath;
  }
  return path.join(catalogRoot, 'builtin', 'catalog.sqlite');
}

function readOperator(catalogPath) {
  const db = new DatabaseSync(catalogPath);
  const result = db.prepare('SELECT id, name, attack FROM operators WHERE id = ?').get('operator.lanwanting');
  db.close();
  return result;
}

function createUserDatabase(filePath, catalogVersion) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user_operator_configs (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      weapon_id TEXT NOT NULL,
      equipment_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE user_buffs (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
    CREATE TABLE timeline_documents (id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT;
    CREATE TABLE timeline_snapshots (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id),
      catalog_version TEXT NOT NULL,
      payload TEXT NOT NULL
    ) STRICT;
    CREATE TABLE checkout_refs (
      timeline_id TEXT PRIMARY KEY REFERENCES timeline_documents(id),
      target_snapshot_id TEXT NOT NULL REFERENCES timeline_snapshots(id)
    ) STRICT;
    CREATE TABLE timeline_audit_events (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id),
      event_type TEXT NOT NULL,
      subject_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE legacy_migration_records (
      source_path TEXT PRIMARY KEY,
      source_sha256 TEXT NOT NULL,
      imported_timeline_id TEXT NOT NULL REFERENCES timeline_documents(id)
    ) STRICT;
  `);
  db.prepare('INSERT INTO user_operator_configs (id, operator_id, weapon_id, equipment_id) VALUES (?, ?, ?, ?)').run(
    'config.demo', 'operator.lanwanting', 'weapon.demo', 'equipment.demo',
  );
  db.prepare('INSERT INTO user_buffs (id, name) VALUES (?, ?)').run('buff.user', '用户自定义 Buff');
  db.prepare('INSERT INTO timeline_documents (id, label) VALUES (?, ?)').run('timeline.demo', '用户排轴');
  db.prepare('INSERT INTO timeline_snapshots (id, timeline_id, catalog_version, payload) VALUES (?, ?, ?, ?)').run(
    'snapshot.demo',
    'timeline.demo',
    catalogVersion,
    JSON.stringify({ selectedCharacters: ['operator.lanwanting'], selectedBuffIds: ['buff.demo', 'buff.user'] }),
  );
  db.close();
}

function clonePreloadedTemplate({ catalogPath, userDatabasePath, catalogVersion }) {
  const catalog = new DatabaseSync(catalogPath);
  const template = catalog.prepare('SELECT id, label, payload FROM preloaded_timeline_templates WHERE id = ?').get('template.demo');
  catalog.close();
  assert.ok(template, 'preloaded template must exist in catalog');
  const user = new DatabaseSync(userDatabasePath);
  runTransaction(user, () => {
    user.prepare('INSERT INTO timeline_documents (id, label) VALUES (?, ?)').run('timeline.template-clone', template.label);
    user.prepare('INSERT INTO timeline_snapshots (id, timeline_id, catalog_version, payload) VALUES (?, ?, ?, ?)').run(
      'snapshot.template-clone', 'timeline.template-clone', catalogVersion, template.payload,
    );
    user.prepare('INSERT INTO checkout_refs (timeline_id, target_snapshot_id) VALUES (?, ?)').run(
      'timeline.template-clone', 'snapshot.template-clone',
    );
    user.prepare('INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_id) VALUES (?, ?, ?, ?)').run(
      'audit.template-clone', 'timeline.template-clone', 'template.cloned', template.id,
    );
  });
  user.close();
}

function restoreSnapshot(userDatabasePath, timelineId, snapshotId) {
  const user = new DatabaseSync(userDatabasePath);
  try {
    return runTransaction(user, () => {
      const snapshot = user.prepare('SELECT id FROM timeline_snapshots WHERE id = ? AND timeline_id = ?').get(snapshotId, timelineId);
      if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);
      user.prepare(`
        INSERT INTO checkout_refs (timeline_id, target_snapshot_id) VALUES (?, ?)
        ON CONFLICT(timeline_id) DO UPDATE SET target_snapshot_id = excluded.target_snapshot_id
      `).run(timelineId, snapshotId);
      user.prepare('INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_id) VALUES (?, ?, ?, ?)').run(
        `audit.restore.${snapshotId}`, timelineId, 'snapshot.restored', snapshotId,
      );
      return snapshot;
    });
  } finally {
    user.close();
  }
}

function migrateLegacyArchive({ userDatabasePath, legacyPath }) {
  const archive = readJson(legacyPath);
  const sourceHash = sha256(legacyPath);
  const user = new DatabaseSync(userDatabasePath);
  try {
    return runTransaction(user, () => {
      const prior = user.prepare('SELECT imported_timeline_id FROM legacy_migration_records WHERE source_path = ?').get(legacyPath);
      if (prior) return { imported: false, timelineId: prior.imported_timeline_id };
      user.prepare('INSERT INTO timeline_documents (id, label) VALUES (?, ?)').run(archive.timelineId, archive.label);
      user.prepare('INSERT INTO timeline_snapshots (id, timeline_id, catalog_version, payload) VALUES (?, ?, ?, ?)').run(
        archive.snapshotId, archive.timelineId, archive.catalogVersion, JSON.stringify(archive.payload),
      );
      user.prepare('INSERT INTO legacy_migration_records (source_path, source_sha256, imported_timeline_id) VALUES (?, ?, ?)').run(
        legacyPath, sourceHash, archive.timelineId,
      );
      return { imported: true, timelineId: archive.timelineId };
    });
  } finally {
    user.close();
  }
}

try {
  const v1Staging = path.join(stagingRoot, 'catalog-v1.sqlite');
  createCatalog(v1Staging, { version: 'demo-v1', operatorAttack: 318 });
  const v1Manifest = createManifest('demo-v1', v1Staging);
  const v1Catalog = activateFullCatalog({ stagedCatalogPath: v1Staging, manifest: v1Manifest });
  const builtinCatalog = path.join(catalogRoot, 'builtin', 'catalog.sqlite');
  fs.mkdirSync(path.dirname(builtinCatalog), { recursive: true });
  fs.copyFileSync(v1Catalog, builtinCatalog);

  const userDatabasePath = path.join(userRoot, 'user.sqlite');
  createUserDatabase(userDatabasePath, v1Manifest.dataVersion);
  clonePreloadedTemplate({ catalogPath: v1Catalog, userDatabasePath, catalogVersion: v1Manifest.dataVersion });
  restoreSnapshot(userDatabasePath, 'timeline.demo', 'snapshot.demo');
  const beforeFailedRestore = new DatabaseSync(userDatabasePath);
  const auditCountBeforeFailedRestore = beforeFailedRestore.prepare('SELECT COUNT(*) AS count FROM timeline_audit_events').get().count;
  beforeFailedRestore.close();
  assert.throws(() => restoreSnapshot(userDatabasePath, 'timeline.demo', 'snapshot.missing'), /Snapshot not found/);
  const afterFailedRestore = new DatabaseSync(userDatabasePath);
  assert.equal(afterFailedRestore.prepare('SELECT target_snapshot_id FROM checkout_refs WHERE timeline_id = ?').get('timeline.demo').target_snapshot_id, 'snapshot.demo');
  assert.equal(afterFailedRestore.prepare('SELECT COUNT(*) AS count FROM timeline_audit_events').get().count, auditCountBeforeFailedRestore);
  afterFailedRestore.close();

  const legacyArchivePath = path.join(root, 'legacy-local.json');
  writeJsonAtomically(legacyArchivePath, {
    timelineId: 'timeline.legacy', label: '旧本机存档', snapshotId: 'snapshot.legacy', catalogVersion: 'demo-v1',
    payload: { selectedCharacters: ['operator.lanwanting'], timelineData: { staffLines: [] } },
  });
  assert.deepEqual(migrateLegacyArchive({ userDatabasePath, legacyPath: legacyArchivePath }), { imported: true, timelineId: 'timeline.legacy' });
  assert.deepEqual(migrateLegacyArchive({ userDatabasePath, legacyPath: legacyArchivePath }), { imported: false, timelineId: 'timeline.legacy' });
  assert.ok(fs.existsSync(legacyArchivePath), 'migration must leave the original legacy archive intact');
  const userHashBeforeUpdate = sha256(userDatabasePath);

  const v2Staging = path.join(stagingRoot, 'catalog-v2.sqlite');
  createCatalog(v2Staging, { version: 'demo-v2', operatorAttack: 342 });
  const v2Manifest = createManifest('demo-v2', v2Staging);
  const v2Catalog = activateFullCatalog({ stagedCatalogPath: v2Staging, manifest: v2Manifest });
  const retryStaging = path.join(stagingRoot, 'catalog-v2-retry.sqlite');
  fs.copyFileSync(v2Catalog, retryStaging);
  activateFullCatalog({ stagedCatalogPath: retryStaging, manifest: v2Manifest });

  const failedHashStaging = path.join(stagingRoot, 'catalog-bad-hash.sqlite');
  createCatalog(failedHashStaging, { version: 'demo-v3', operatorAttack: 500 });
  const badHashManifest = { ...createManifest('demo-v3', failedHashStaging), catalogSha256: 'sha256:invalid' };
  assert.throws(() => activateFullCatalog({ stagedCatalogPath: failedHashStaging, manifest: badHashManifest }), /hash/);
  assert.ok(!fs.existsSync(path.join(catalogRoot, 'versions', 'demo-v3')), 'failed validation must not install a version');

  const incompatibleStaging = path.join(stagingRoot, 'catalog-incompatible.sqlite');
  createCatalog(incompatibleStaging, { version: 'demo-v4', operatorAttack: 600 });
  assert.throws(() => activateFullCatalog({
    stagedCatalogPath: incompatibleStaging,
    manifest: createManifest('demo-v4', incompatibleStaging, '9.0.0'),
  }), /incompatible/);

  const active = readJson(path.join(catalogRoot, 'active.json'));
  assert.equal(active.dataVersion, 'demo-v2', 'failed updates must preserve the last active catalog');
  const pointerPath = path.join(catalogRoot, 'active.json');
  const savedPointerPath = `${pointerPath}.offline-demo`;
  fs.renameSync(pointerPath, savedPointerPath);
  const offlineCatalog = resolveCatalogForOfflineStartup();
  const offlineFallbackAttack = readOperator(offlineCatalog).attack;
  assert.equal(offlineCatalog, builtinCatalog, 'offline startup must fall back to built-in catalog');
  assert.equal(offlineFallbackAttack, 318);
  fs.renameSync(savedPointerPath, pointerPath);

  const user = new DatabaseSync(userDatabasePath);
  const savedSnapshot = user.prepare('SELECT catalog_version FROM timeline_snapshots WHERE id = ?').get('snapshot.demo');
  const clonedTemplate = user.prepare('SELECT catalog_version FROM timeline_snapshots WHERE id = ?').get('snapshot.template-clone');
  const legacyCount = user.prepare('SELECT COUNT(*) AS count FROM timeline_documents WHERE id = ?').get('timeline.legacy').count;
  user.close();
  assert.equal(readOperator(v2Catalog).attack, 342, 'new work uses the activated full catalog');
  assert.equal(readOperator(v1Catalog).attack, 318, 'saved snapshots can resolve their pinned catalog version');
  assert.equal(savedSnapshot.catalog_version, 'demo-v1');
  assert.equal(clonedTemplate.catalog_version, 'demo-v1');
  assert.equal(legacyCount, 1, 're-running a legacy migration must not duplicate the document');
  assert.equal(sha256(userDatabasePath), userHashBeforeUpdate, 'catalog replacement must not alter user.sqlite');

  console.log(JSON.stringify({
    ok: true,
    activeCatalogVersion: active.dataVersion,
    currentOperatorAttack: readOperator(v2Catalog).attack,
    snapshotCatalogVersion: savedSnapshot.catalog_version,
    snapshotOperatorAttack: readOperator(v1Catalog).attack,
    offlineFallbackVersion: offlineFallbackAttack,
    failedUpdateRolledBack: true,
    idempotentReinstall: true,
    restoredCheckoutAndAuditAtomically: true,
    preloadedTemplateCloned: true,
    legacyMigrationIdempotent: true,
    userDatabaseUnchanged: true,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
