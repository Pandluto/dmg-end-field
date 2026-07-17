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

function validateStagedCatalog(filePath, manifest) {
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
  fs.mkdirSync(versionDirectory, { recursive: true });
  const catalogPath = path.join(versionDirectory, 'catalog.sqlite');
  assert.ok(!fs.existsSync(catalogPath), `version ${manifest.dataVersion} is already installed`);
  fs.renameSync(stagedCatalogPath, catalogPath);
  writeJsonAtomically(path.join(versionDirectory, 'manifest.json'), manifest);
  // This tiny file is the only mutable catalog selector. A catalog update never
  // moves, opens, or writes the user database.
  writeJsonAtomically(path.join(catalogRoot, 'active.json'), {
    dataVersion: manifest.dataVersion,
    activatedAt: new Date().toISOString(),
  });
  return catalogPath;
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
    CREATE TABLE timeline_documents (id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT;
    CREATE TABLE timeline_snapshots (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id),
      catalog_version TEXT NOT NULL,
      payload TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare('INSERT INTO user_operator_configs (id, operator_id, weapon_id, equipment_id) VALUES (?, ?, ?, ?)').run(
    'config.demo', 'operator.lanwanting', 'weapon.demo', 'equipment.demo',
  );
  db.prepare('INSERT INTO timeline_documents (id, label) VALUES (?, ?)').run('timeline.demo', '用户排轴');
  db.prepare('INSERT INTO timeline_snapshots (id, timeline_id, catalog_version, payload) VALUES (?, ?, ?, ?)').run(
    'snapshot.demo',
    'timeline.demo',
    catalogVersion,
    JSON.stringify({ selectedCharacters: ['operator.lanwanting'], selectedBuffIds: ['buff.demo'] }),
  );
  db.close();
}

try {
  const v1Staging = path.join(stagingRoot, 'catalog-v1.sqlite');
  createCatalog(v1Staging, { version: 'demo-v1', operatorAttack: 318 });
  const v1Manifest = {
    type: 'dmg.data-release-manifest.v1',
    manifestVersion: 1,
    dataVersion: 'demo-v1',
    catalogSha256: sha256(v1Staging),
  };
  const v1Catalog = activateFullCatalog({ stagedCatalogPath: v1Staging, manifest: v1Manifest });

  const userDatabasePath = path.join(userRoot, 'user.sqlite');
  createUserDatabase(userDatabasePath, v1Manifest.dataVersion);
  const userHashBeforeUpdate = sha256(userDatabasePath);
  assert.equal(readOperator(v1Catalog).attack, 318);

  const v2Staging = path.join(stagingRoot, 'catalog-v2.sqlite');
  createCatalog(v2Staging, { version: 'demo-v2', operatorAttack: 342 });
  const v2Manifest = {
    type: 'dmg.data-release-manifest.v1',
    manifestVersion: 1,
    dataVersion: 'demo-v2',
    catalogSha256: sha256(v2Staging),
  };
  const v2Catalog = activateFullCatalog({ stagedCatalogPath: v2Staging, manifest: v2Manifest });

  const active = readJson(path.join(catalogRoot, 'active.json'));
  const user = new DatabaseSync(userDatabasePath);
  const savedSnapshot = user.prepare('SELECT catalog_version FROM timeline_snapshots WHERE id = ?').get('snapshot.demo');
  user.close();

  assert.equal(active.dataVersion, 'demo-v2');
  assert.equal(readOperator(v2Catalog).attack, 342, 'new work uses the activated full catalog');
  assert.equal(readOperator(v1Catalog).attack, 318, 'saved snapshots can resolve their pinned catalog version');
  assert.equal(savedSnapshot.catalog_version, 'demo-v1');
  assert.equal(sha256(userDatabasePath), userHashBeforeUpdate, 'catalog replacement must not alter user.sqlite');

  console.log(JSON.stringify({
    ok: true,
    activeCatalogVersion: active.dataVersion,
    currentOperatorAttack: readOperator(v2Catalog).attack,
    snapshotCatalogVersion: savedSnapshot.catalog_version,
    snapshotOperatorAttack: readOperator(v1Catalog).attack,
    userDatabaseUnchanged: true,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
