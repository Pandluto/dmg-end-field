const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createTimelineRepository } = require('./timeline-repository.cjs');

const DATA_RELEASE_MANIFEST_TYPE = 'dmg.data-release-manifest.v1';
const CATALOG_PACKAGE_MANIFEST_TYPE = 'dmg.catalog-package.v1';
const CATALOG_SCHEMA_VERSION = 1;
const USER_SCHEMA_VERSION = 2;
const WORKSPACE_STATE_ID = 'current-workspace';
const LEGACY_TIMELINE_SNAPSHOT_ARCHIVE_KEY = 'def.timeline.snapshot-archive.v1';
const WORKSPACE_STORAGE_KEYS = {
  selectedCharacters: 'def.selected-characters.v1',
  timelineData: 'def.timeline.data.v1',
  skillButtonTable: 'def.skill-button.v1',
  allBuffList: 'def.all-buff-list.v1',
  anomalyStateSnapshots: 'def.anomaly-state-snapshot-archive.v1',
  characterInputMap: 'def.operator-config.character-input-map.v3',
  characterComputedMap: 'def.operator-runtime.character-computed-map.v3',
  characterDisplayCacheMap: 'def.operator-ui.character-display-cache.v3',
  operatorConfigPageCache: 'def.operator-config.page-cache.v1',
  activeCharacter: 'def.operator-config.active-character.v1',
  selectedSkillButton: 'def.selected-skill-button',
};
const REQUIRED_CATALOG_TABLES = [
  'catalog_meta',
  'operators',
  'weapons',
  'equipments',
  'buff_definitions',
  'preloaded_timeline_payloads',
  'preloaded_timeline_templates',
];
const DEFAULT_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

function dataManagementError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function hashBufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function compareVersionNumberish(left, right) {
  const parse = (value) => String(value || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

function sanitizeVersion(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const safe = normalized.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') {
    throw dataManagementError('invalid-catalog-version', '数据版本无效。');
  }
  return safe;
}

function assertPackageFileName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip$/i.test(value)) {
    throw dataManagementError('invalid-data-release-package-name', '数据发布包文件名无效。');
  }
  return value;
}

function assertSha256(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw dataManagementError('invalid-data-release-sha256', `${field} 必须是 SHA-256。`);
  }
  return value.toLowerCase();
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function transaction(db, run) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = run();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function catalogPayloadHash(payload) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(payload)).digest('hex')}`;
}

function normalizeCatalogItems(items, type) {
  if (!Array.isArray(items)) throw dataManagementError('invalid-catalog-items', `${type} 必须是数组。`);
  const seen = new Set();
  return items.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw dataManagementError('invalid-catalog-item-id', `${type} 缺少稳定业务 ID。`);
    }
    const id = entry.id.trim();
    if (seen.has(id)) throw dataManagementError('duplicate-catalog-item-id', `${type} 有重复 ID：${id}`);
    seen.add(id);
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
    return { id, name, payload: entry.payload === undefined ? entry : entry.payload };
  });
}

function createCatalogDatabase({ databasePath, dataVersion, generatedAt = new Date().toISOString(), operators = [], weapons = [], equipments = [], buffs = [], templates = [] }) {
  if (!databasePath) throw dataManagementError('missing-catalog-path', 'catalog.sqlite 路径缺失。');
  const safeVersion = sanitizeVersion(dataVersion);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  if (fs.existsSync(databasePath)) {
    throw dataManagementError('catalog-database-already-exists', `拒绝覆盖已存在的 catalog：${databasePath}`);
  }
  const db = new DatabaseSync(databasePath);
  try {
    // Catalog files are immutable release artifacts.  Keep all committed bytes
    // in the single SQLite file so a ZIP never omits a WAL sidecar.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    db.exec(`
      CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE operators (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL) STRICT;
      CREATE TABLE weapons (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL) STRICT;
      CREATE TABLE equipments (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL) STRICT;
      CREATE TABLE buff_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL) STRICT;
      CREATE TABLE preloaded_timeline_payloads (content_hash TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE preloaded_timeline_templates (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        payload_hash TEXT NOT NULL REFERENCES preloaded_timeline_payloads(content_hash) ON DELETE RESTRICT,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX preloaded_timeline_templates_created_idx ON preloaded_timeline_templates(created_at DESC);
    `);
    const writeItems = (table, items, type) => {
      const statement = db.prepare(`INSERT INTO ${table} (id, name, payload, payload_hash) VALUES (?, ?, ?, ?)`);
      for (const item of normalizeCatalogItems(items, type)) {
        statement.run(item.id, item.name, JSON.stringify(item.payload), catalogPayloadHash(item.payload));
      }
    };
    transaction(db, () => {
      writeItems('operators', operators, 'operators');
      writeItems('weapons', weapons, 'weapons');
      writeItems('equipments', equipments, 'equipments');
      writeItems('buff_definitions', buffs, 'buffs');
      const templateIds = new Set();
      for (const template of templates) {
        if (!template || typeof template.id !== 'string' || !template.id.trim() || template.payload === undefined) {
          throw dataManagementError('invalid-preloaded-template', '预载排轴模板缺少 id 或 payload。');
        }
        const id = template.id.trim();
        if (templateIds.has(id)) throw dataManagementError('duplicate-preloaded-template', `预载排轴模板重复：${id}`);
        templateIds.add(id);
        const payloadHash = catalogPayloadHash(template.payload);
        db.prepare('INSERT INTO preloaded_timeline_payloads (content_hash, payload) VALUES (?, ?)')
          .run(payloadHash, JSON.stringify(template.payload));
        db.prepare(`
          INSERT INTO preloaded_timeline_templates (id, label, payload_hash, description, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          id,
          typeof template.label === 'string' && template.label.trim() ? template.label.trim() : id,
          payloadHash,
          typeof template.description === 'string' ? template.description : '',
          Number.isFinite(Number(template.createdAt)) ? Number(template.createdAt) : Date.now(),
        );
      }
      const meta = db.prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?)');
      meta.run('schema_version', String(CATALOG_SCHEMA_VERSION));
      meta.run('data_version', safeVersion);
      meta.run('generated_at', generatedAt);
    });
  } finally {
    db.close();
  }
  return validateCatalogDatabase({ databasePath, expectedDataVersion: safeVersion });
}

function validateCatalogDatabase({ databasePath, expectedSha256, expectedDataVersion, expectedSchemaVersion = CATALOG_SCHEMA_VERSION }) {
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw dataManagementError('catalog-database-not-found', 'catalog.sqlite 不存在。');
  }
  const actualSha256 = hashFileSha256(databasePath);
  if (expectedSha256 && actualSha256 !== assertSha256(expectedSha256, 'catalog.sha256')) {
    throw dataManagementError('catalog-sha256-mismatch', 'catalog.sqlite 哈希校验失败。', { expected: expectedSha256, actual: actualSha256 });
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') throw dataManagementError('catalog-integrity-check-failed', 'catalog.sqlite 完整性校验失败。', { integrity });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missingTables = REQUIRED_CATALOG_TABLES.filter((table) => !tables.has(table));
    if (missingTables.length) throw dataManagementError('catalog-schema-missing-table', 'catalog.sqlite 缺少必要表。', { missingTables });
    const readMeta = (key) => db.prepare('SELECT value FROM catalog_meta WHERE key = ?').get(key)?.value || null;
    const schemaVersion = Number(readMeta('schema_version'));
    const dataVersion = readMeta('data_version');
    if (schemaVersion !== expectedSchemaVersion) {
      throw dataManagementError('catalog-schema-version-mismatch', 'catalog schema 版本不兼容。', { expected: expectedSchemaVersion, actual: schemaVersion });
    }
    if (expectedDataVersion && dataVersion !== expectedDataVersion) {
      throw dataManagementError('catalog-data-version-mismatch', 'catalog 数据版本不匹配。', { expected: expectedDataVersion, actual: dataVersion });
    }
    return {
      databasePath,
      sha256: actualSha256,
      schemaVersion,
      dataVersion,
      generatedAt: readMeta('generated_at'),
      counts: {
        operators: Number(db.prepare('SELECT COUNT(*) AS count FROM operators').get().count),
        weapons: Number(db.prepare('SELECT COUNT(*) AS count FROM weapons').get().count),
        equipments: Number(db.prepare('SELECT COUNT(*) AS count FROM equipments').get().count),
        buffs: Number(db.prepare('SELECT COUNT(*) AS count FROM buff_definitions').get().count),
        preloadedTimelineTemplates: Number(db.prepare('SELECT COUNT(*) AS count FROM preloaded_timeline_templates').get().count),
      },
    };
  } finally {
    db.close();
  }
}

function canonicalManifestPayload(manifest) {
  const { signature, ...unsignedManifest } = manifest || {};
  return Buffer.from(stableJson(unsignedManifest));
}

function signDataReleaseManifest(manifest, privateKey, keyId = 'default') {
  if (!privateKey) throw dataManagementError('missing-data-release-private-key', '发布签名私钥缺失。');
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      keyId,
      value: crypto.sign(null, canonicalManifestPayload(manifest), privateKey).toString('base64'),
    },
  };
}

function verifyDataReleaseManifestSignature(manifest, publicKey) {
  const signature = manifest?.signature;
  if (!signature || signature.algorithm !== 'ed25519' || typeof signature.value !== 'string') {
    throw dataManagementError('missing-data-release-signature', '数据发布清单缺少 Ed25519 签名。');
  }
  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(signature.value, 'base64');
  } catch {
    throw dataManagementError('invalid-data-release-signature', '数据发布清单签名格式无效。');
  }
  if (!crypto.verify(null, canonicalManifestPayload(manifest), publicKey, signatureBuffer)) {
    throw dataManagementError('invalid-data-release-signature', '数据发布清单签名校验失败。');
  }
  return { keyId: typeof signature.keyId === 'string' ? signature.keyId : '' };
}

function validateDataReleaseManifest(manifest, { shellVersion, publicKey, requireSignature = Boolean(publicKey) } = {}) {
  if (!manifest || typeof manifest !== 'object' || manifest.type !== DATA_RELEASE_MANIFEST_TYPE || manifest.manifestVersion !== 1) {
    throw dataManagementError('invalid-data-release-manifest', '数据发布清单类型或版本无效。');
  }
  const dataVersion = sanitizeVersion(manifest.dataVersion);
  if (typeof manifest.releaseTag !== 'string' || !manifest.releaseTag.trim()) {
    throw dataManagementError('invalid-data-release-manifest', '数据发布清单缺少 releaseTag。');
  }
  if (!Number.isInteger(manifest.catalogSchemaVersion) || manifest.catalogSchemaVersion < 1) {
    throw dataManagementError('invalid-data-release-manifest', '数据发布清单 catalogSchemaVersion 无效。');
  }
  const packageInfo = manifest.package;
  if (!packageInfo || typeof packageInfo !== 'object') throw dataManagementError('invalid-data-release-manifest', '数据发布清单缺少 package。');
  assertPackageFileName(packageInfo.fileName);
  assertSha256(packageInfo.sha256, 'package.sha256');
  if (!Number.isSafeInteger(packageInfo.sizeBytes) || packageInfo.sizeBytes <= 0 || packageInfo.sizeBytes > DEFAULT_MAX_PACKAGE_BYTES) {
    throw dataManagementError('invalid-data-release-package-size', '数据发布包大小无效或超过限制。');
  }
  const catalog = manifest.catalog;
  if (!catalog || typeof catalog !== 'object') throw dataManagementError('invalid-data-release-manifest', '数据发布清单缺少 catalog。');
  assertSha256(catalog.sha256, 'catalog.sha256');
  for (const field of ['operators', 'weapons', 'equipments', 'buffs', 'preloadedTimelineTemplates']) {
    if (!Number.isSafeInteger(catalog[field]) || catalog[field] < 0) {
      throw dataManagementError('invalid-data-release-manifest', `catalog.${field} 无效。`);
    }
  }
  if (shellVersion && manifest.minShellVersion && compareVersionNumberish(shellVersion, manifest.minShellVersion) < 0) {
    throw dataManagementError('data-release-shell-version-incompatible', `当前 Shell ${shellVersion} 不满足最低版本 ${manifest.minShellVersion}。`);
  }
  const signatureInfo = requireSignature ? verifyDataReleaseManifestSignature(manifest, publicKey) : null;
  return { ...manifest, dataVersion, signatureInfo };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
  if (result.error || result.status !== 0) {
    throw dataManagementError('data-release-archive-command-failed', `${command} 执行失败。`, {
      command,
      args,
      error: result.error?.message || result.stderr || result.stdout || `exit ${result.status}`,
    });
  }
  return result.stdout;
}

function assertSafeCatalogArchive(archivePath) {
  const entries = runChecked('unzip', ['-Z1', archivePath]).split(/\r?\n/).filter(Boolean);
  const expected = new Set(['catalog.sqlite', 'manifest.json']);
  if (entries.length !== expected.size || new Set(entries).size !== entries.length || entries.some((entry) => !expected.has(entry))) {
    throw dataManagementError('unsafe-data-release-archive', '数据发布包只能包含 catalog.sqlite 和 manifest.json。', { entries });
  }
}

function extractCatalogArchive(archivePath, destination) {
  assertSafeCatalogArchive(archivePath);
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    const escapedArchive = archivePath.replace(/'/g, "''");
    const escapedDestination = destination.replace(/'/g, "''");
    runChecked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
  } else {
    runChecked('unzip', ['-q', archivePath, '-d', destination]);
  }
}

function createDataReleasePackage({ catalogPath, outputDirectory, manifest: manifestInput, privateKey, keyId }) {
  const catalog = validateCatalogDatabase({ databasePath: catalogPath, expectedDataVersion: manifestInput?.dataVersion });
  const dataVersion = sanitizeVersion(manifestInput?.dataVersion);
  const outputDir = path.resolve(outputDirectory, dataVersion);
  if (fs.existsSync(outputDir)) throw dataManagementError('data-release-output-exists', `发布目录已存在：${outputDir}`);
  const packageFileName = `catalog-${dataVersion}.zip`;
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-catalog-${dataVersion}-`));
  try {
    fs.copyFileSync(catalogPath, path.join(temporaryDir, 'catalog.sqlite'));
    fs.writeFileSync(path.join(temporaryDir, 'manifest.json'), `${JSON.stringify({
      type: CATALOG_PACKAGE_MANIFEST_TYPE,
      schemaVersion: 1,
      dataVersion,
      catalog: { sha256: catalog.sha256, schemaVersion: catalog.schemaVersion },
    }, null, 2)}\n`, 'utf8');
    fs.mkdirSync(outputDir, { recursive: true });
    const packagePath = path.join(outputDir, packageFileName);
    runChecked('zip', ['-X', '-q', '-r', packagePath, '.'], { cwd: temporaryDir });
    const unsignedManifest = {
      type: DATA_RELEASE_MANIFEST_TYPE,
      manifestVersion: 1,
      releaseTag: manifestInput.releaseTag,
      dataVersion,
      generatedAt: manifestInput.generatedAt || new Date().toISOString(),
      minShellVersion: manifestInput.minShellVersion || '',
      catalogSchemaVersion: catalog.schemaVersion,
      package: { fileName: packageFileName, packagePath: packageFileName, sizeBytes: fs.statSync(packagePath).size, sha256: hashFileSha256(packagePath) },
      catalog: { sha256: catalog.sha256, ...catalog.counts },
    };
    const manifest = privateKey ? signDataReleaseManifest(unsignedManifest, privateKey, keyId) : unsignedManifest;
    validateDataReleaseManifest(manifest, { publicKey: privateKey ? crypto.createPublicKey(privateKey) : undefined });
    const manifestPath = path.join(outputDir, 'data-release-manifest.json');
    writeJsonAtomically(manifestPath, manifest);
    return { outputDir, packagePath, manifestPath, manifest };
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function createDataManagementService({ runtimeDataRoot, builtinCatalogPath, shellVersion = '', publicKey, requireSignature = Boolean(publicKey) }) {
  if (!runtimeDataRoot) throw dataManagementError('missing-runtime-data-root', '运行时数据根目录缺失。');
  const root = path.resolve(runtimeDataRoot);
  const paths = {
    root,
    catalogRoot: path.join(root, 'catalog'),
    builtinCatalogPath: builtinCatalogPath ? path.resolve(builtinCatalogPath) : path.join(root, 'catalog', 'builtin', 'catalog.sqlite'),
    versionsDirectory: path.join(root, 'catalog', 'versions'),
    activePath: path.join(root, 'catalog', 'active.json'),
    userDirectory: path.join(root, 'user'),
    userDatabasePath: path.join(root, 'user', 'user.sqlite'),
    backupDirectory: path.join(root, 'user', 'backups'),
    stagingDirectory: path.join(root, 'staging'),
  };

  function ensureLayout() {
    [paths.catalogRoot, path.dirname(paths.builtinCatalogPath), paths.versionsDirectory, paths.userDirectory, paths.backupDirectory, paths.stagingDirectory]
      .forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
    return paths;
  }

  function ensureUserDatabase() {
    ensureLayout();
    const timelineRepository = createTimelineRepository({ databasePath: paths.userDatabasePath });
    timelineRepository.close();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS user_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS user_operator_configs (
          operator_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS user_buffs (
          id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS user_workspace_state (
          id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS user_catalog_references (
          owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, catalog_type TEXT NOT NULL, catalog_id TEXT NOT NULL,
          catalog_version TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(owner_type, owner_id, catalog_type, catalog_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS legacy_migration_records (
          source_hash TEXT PRIMARY KEY, legacy_origin TEXT NOT NULL, source_name TEXT NOT NULL,
          status TEXT NOT NULL, details TEXT NOT NULL, migrated_at INTEGER NOT NULL
        ) STRICT;
      `);
      db.prepare(`INSERT INTO user_schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(String(USER_SCHEMA_VERSION));
    } finally {
      db.close();
    }
    return paths.userDatabasePath;
  }

  function getUserRecord(table, id) {
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      const row = db.prepare(`SELECT payload, updated_at FROM ${table} WHERE ${table === 'user_operator_configs' ? 'operator_id' : 'id'} = ?`).get(id);
      return row ? { id, payload: JSON.parse(row.payload), updatedAt: row.updated_at } : null;
    } finally {
      db.close();
    }
  }

  function putUserRecord(table, id, payload, updatedAt = Date.now()) {
    if (typeof id !== 'string' || !id.trim()) throw dataManagementError('invalid-user-record-id', '用户数据 ID 无效。');
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      const idColumn = table === 'user_operator_configs' ? 'operator_id' : 'id';
      db.prepare(`
        INSERT INTO ${table} (${idColumn}, payload, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(${idColumn}) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(id, JSON.stringify(payload), updatedAt);
      return { id, payload, updatedAt };
    } finally {
      db.close();
    }
  }

  function normalizeWorkspaceValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw dataManagementError('invalid-user-workspace-state', '用户工作副本必须是键值对象。');
    }
    const normalized = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof key !== 'string' || !key.startsWith('def.')) continue;
      if (value !== null && typeof value !== 'string') {
        throw dataManagementError('invalid-user-workspace-state', `用户工作副本 ${key} 必须是字符串或 null。`);
      }
      normalized[key] = value;
    }
    return normalized;
  }

  function parseWorkspaceJson(values, key, fallback) {
    const raw = values[key];
    if (typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function projectWorkspaceState(db, values, updatedAt) {
    const pageCache = parseWorkspaceJson(values, WORKSPACE_STORAGE_KEYS.operatorConfigPageCache, {});
    const characterInputMap = parseWorkspaceJson(values, WORKSPACE_STORAGE_KEYS.characterInputMap, {});
    const characterComputedMap = parseWorkspaceJson(values, WORKSPACE_STORAGE_KEYS.characterComputedMap, {});
    const characterDisplayMap = parseWorkspaceJson(values, WORKSPACE_STORAGE_KEYS.characterDisplayCacheMap, {});
    const operatorIds = new Set([
      ...Object.keys(pageCache && typeof pageCache === 'object' ? pageCache : {}),
      ...Object.keys(characterInputMap && typeof characterInputMap === 'object' ? characterInputMap : {}),
      ...Object.keys(characterComputedMap && typeof characterComputedMap === 'object' ? characterComputedMap : {}),
      ...Object.keys(characterDisplayMap && typeof characterDisplayMap === 'object' ? characterDisplayMap : {}),
    ]);
    const upsertOperator = db.prepare(`
      INSERT INTO user_operator_configs (operator_id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(operator_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `);
    for (const operatorId of operatorIds) {
      upsertOperator.run(operatorId, JSON.stringify({
        page: pageCache?.[operatorId] ?? null,
        input: characterInputMap?.[operatorId] ?? null,
        computed: characterComputedMap?.[operatorId] ?? null,
        display: characterDisplayMap?.[operatorId] ?? null,
      }), updatedAt);
    }

    const buffs = parseWorkspaceJson(values, WORKSPACE_STORAGE_KEYS.allBuffList, []);
    if (!Array.isArray(buffs)) return;
    const upsertBuff = db.prepare(`
      INSERT INTO user_buffs (id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `);
    for (const buff of buffs) {
      if (!buff || typeof buff !== 'object' || typeof buff.id !== 'string' || !buff.id.trim()) continue;
      upsertBuff.run(buff.id.trim(), JSON.stringify(buff), updatedAt);
    }
  }

  function putWorkspaceState(values, updatedAt = Date.now()) {
    const normalized = normalizeWorkspaceValues(values);
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      transaction(db, () => {
        db.prepare(`
          INSERT INTO user_workspace_state (id, payload, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `).run(WORKSPACE_STATE_ID, JSON.stringify({ schemaVersion: 1, values: normalized }), updatedAt);
        projectWorkspaceState(db, normalized, updatedAt);
      });
      return { values: normalized, updatedAt };
    } finally {
      db.close();
    }
  }

  function getWorkspaceState() {
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT payload, updated_at FROM user_workspace_state WHERE id = ?').get(WORKSPACE_STATE_ID);
      if (!row) return null;
      const parsed = JSON.parse(row.payload);
      return {
        values: normalizeWorkspaceValues(parsed?.values || {}),
        updatedAt: row.updated_at,
      };
    } finally {
      db.close();
    }
  }

  function workspaceValuesFromTimelinePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw dataManagementError('invalid-workspace-timeline-payload', '排轴恢复 payload 无效。');
    }
    const value = (key, fallback) => JSON.stringify(payload[key] === undefined ? fallback : payload[key]);
    return {
      [WORKSPACE_STORAGE_KEYS.selectedCharacters]: value('selectedCharacters', []),
      [WORKSPACE_STORAGE_KEYS.timelineData]: value('timelineData', { staffLines: [] }),
      [WORKSPACE_STORAGE_KEYS.skillButtonTable]: value('skillButtonTable', {}),
      [WORKSPACE_STORAGE_KEYS.allBuffList]: value('allBuffList', []),
      [WORKSPACE_STORAGE_KEYS.anomalyStateSnapshots]: JSON.stringify({
        version: 'v1',
        nextId: Array.isArray(payload.anomalyStateSnapshots)
          ? payload.anomalyStateSnapshots.reduce((maxId, item) => Math.max(maxId, Number(item?.id) || 0), 0) + 1
          : 1,
        snapshots: payload.anomalyStateSnapshots || [],
      }),
      [WORKSPACE_STORAGE_KEYS.characterInputMap]: value('characterInputMap', {}),
      [WORKSPACE_STORAGE_KEYS.characterComputedMap]: value('characterComputedMap', {}),
      [WORKSPACE_STORAGE_KEYS.characterDisplayCacheMap]: value('characterDisplayCacheMap', {}),
      [WORKSPACE_STORAGE_KEYS.operatorConfigPageCache]: value('operatorConfigPageCache', {}),
    };
  }

  function restoreWorkspaceSnapshot({ timelineId, snapshotId, updatedAt = Date.now() } = {}) {
    if (typeof timelineId !== 'string' || !timelineId.trim() || typeof snapshotId !== 'string' || !snapshotId.trim()) {
      throw dataManagementError('invalid-workspace-snapshot-restore', '恢复工作副本需要排轴文档和恢复点 ID。');
    }
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      return transaction(db, () => {
        const row = db.prepare(`
          SELECT snapshot.id, snapshot.timeline_id, payload.payload
          FROM timeline_snapshots AS snapshot
          JOIN timeline_payload_blobs AS payload ON payload.content_hash = snapshot.payload_hash
          WHERE snapshot.id = ? AND snapshot.timeline_id = ? AND snapshot.archived_at IS NULL
        `).get(snapshotId, timelineId);
        if (!row) throw dataManagementError('timeline-checkout-target-not-found', 'SQLite 中未找到要恢复的排轴快照。', { timelineId, snapshotId });
        const payload = JSON.parse(row.payload);
        const values = workspaceValuesFromTimelinePayload(payload);
        db.prepare(`
          INSERT INTO checkout_refs (timeline_id, target_type, target_id, updated_at)
          VALUES (?, 'snapshot', ?, ?)
          ON CONFLICT(timeline_id) DO UPDATE SET
            target_type = excluded.target_type,
            target_id = excluded.target_id,
            updated_at = excluded.updated_at
        `).run(timelineId, snapshotId, updatedAt);
        db.prepare(`
          INSERT INTO user_workspace_state (id, payload, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `).run(WORKSPACE_STATE_ID, JSON.stringify({ schemaVersion: 1, values }), updatedAt);
        projectWorkspaceState(db, values, updatedAt);
        db.prepare(`
          INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_type, subject_id, details, created_at)
          VALUES (?, ?, 'snapshot.restored', 'snapshot', ?, ?, ?)
        `).run(
          `workspace-restore-${snapshotId}-${updatedAt}-${crypto.randomBytes(4).toString('hex')}`,
          timelineId,
          snapshotId,
          JSON.stringify({ workspaceState: true }),
          updatedAt,
        );
        return {
          payload,
          workspace: { values, updatedAt },
          checkoutRef: { timelineId, targetType: 'snapshot', targetId: snapshotId, updatedAt },
        };
      });
    } finally {
      db.close();
    }
  }

  function resolveCatalog(version) {
    const safeVersion = sanitizeVersion(version);
    const directory = path.join(paths.versionsDirectory, safeVersion);
    return { version: safeVersion, directory, databasePath: path.join(directory, 'catalog.sqlite'), manifestPath: path.join(directory, 'data-release-manifest.json') };
  }

  function readActiveCatalog() {
    ensureLayout();
    const active = readJsonIfExists(paths.activePath);
    if (active?.dataVersion) {
      try {
        const installed = resolveCatalog(active.dataVersion);
        const manifest = readJsonIfExists(installed.manifestPath);
        if (manifest) {
          validateDataReleaseManifest(manifest, { shellVersion, publicKey, requireSignature });
          validateCatalogDatabase({ databasePath: installed.databasePath, expectedDataVersion: installed.version, expectedSha256: manifest.catalog.sha256, expectedSchemaVersion: manifest.catalogSchemaVersion });
          return { source: 'active', dataVersion: installed.version, databasePath: installed.databasePath, manifest, activatedAt: active.activatedAt || null };
        }
      } catch {
        // An invalid active pointer must never block the builtin catalog fallback.
      }
    }
    const builtin = validateCatalogDatabase({ databasePath: paths.builtinCatalogPath });
    return { source: 'builtin', dataVersion: builtin.dataVersion, databasePath: paths.builtinCatalogPath, manifest: null, activatedAt: null };
  }

  function activateVersion(dataVersion, manifestUrl = '') {
    ensureLayout();
    const installed = resolveCatalog(dataVersion);
    const manifest = readJsonIfExists(installed.manifestPath);
    validateDataReleaseManifest(manifest, { shellVersion, publicKey, requireSignature });
    validateCatalogDatabase({ databasePath: installed.databasePath, expectedDataVersion: installed.version, expectedSha256: manifest.catalog.sha256, expectedSchemaVersion: manifest.catalogSchemaVersion });
    writeJsonAtomically(paths.activePath, { dataVersion: installed.version, activatedAt: new Date().toISOString(), manifestUrl });
    return readActiveCatalog();
  }

  function installRelease({ manifest, archivePath, manifestUrl = '' }) {
    ensureLayout();
    const checkedManifest = validateDataReleaseManifest(manifest, { shellVersion, publicKey, requireSignature });
    if (!archivePath || !fs.existsSync(archivePath)) throw dataManagementError('data-release-package-not-found', '数据发布包不存在。');
    const archiveStats = fs.statSync(archivePath);
    if (!archiveStats.isFile() || archiveStats.size !== checkedManifest.package.sizeBytes || archiveStats.size > DEFAULT_MAX_PACKAGE_BYTES) {
      throw dataManagementError('data-release-package-size-mismatch', '数据发布包大小校验失败。');
    }
    if (hashFileSha256(archivePath) !== checkedManifest.package.sha256) {
      throw dataManagementError('data-release-package-sha256-mismatch', '数据发布包哈希校验失败。');
    }
    const target = resolveCatalog(checkedManifest.dataVersion);
    if (fs.existsSync(target.directory)) {
      const installedManifest = readJsonIfExists(target.manifestPath);
      if (installedManifest?.catalog?.sha256 === checkedManifest.catalog.sha256 && installedManifest?.package?.sha256 === checkedManifest.package.sha256) {
        return { installed: false, reused: true, active: activateVersion(checkedManifest.dataVersion, manifestUrl) };
      }
      throw dataManagementError('data-release-version-collision', `已安装的数据版本 ${checkedManifest.dataVersion} 与发布包内容不一致。`);
    }
    const staging = fs.mkdtempSync(path.join(paths.stagingDirectory, `${checkedManifest.dataVersion}-`));
    try {
      extractCatalogArchive(archivePath, staging);
      const packageManifest = readJsonIfExists(path.join(staging, 'manifest.json'));
      if (!packageManifest || packageManifest.type !== CATALOG_PACKAGE_MANIFEST_TYPE || packageManifest.dataVersion !== checkedManifest.dataVersion
        || packageManifest.catalog?.sha256 !== checkedManifest.catalog.sha256 || packageManifest.catalog?.schemaVersion !== checkedManifest.catalogSchemaVersion) {
        throw dataManagementError('data-release-inner-manifest-mismatch', '数据发布包内部 manifest 与外部清单不一致。');
      }
      validateCatalogDatabase({ databasePath: path.join(staging, 'catalog.sqlite'), expectedDataVersion: checkedManifest.dataVersion, expectedSha256: checkedManifest.catalog.sha256, expectedSchemaVersion: checkedManifest.catalogSchemaVersion });
      fs.rmSync(path.join(staging, 'manifest.json'), { force: true });
      writeJsonAtomically(path.join(staging, 'data-release-manifest.json'), manifest);
      fs.mkdirSync(path.dirname(target.directory), { recursive: true });
      fs.renameSync(staging, target.directory);
      return { installed: true, reused: false, active: activateVersion(checkedManifest.dataVersion, manifestUrl) };
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  function rollbackTo(dataVersion) {
    return activateVersion(dataVersion, 'manual-rollback');
  }

  function listPreloadedTemplates() {
    const catalog = readActiveCatalog();
    const db = new DatabaseSync(catalog.databasePath, { readOnly: true });
    try {
      return db.prepare(`
        SELECT id, label, description, created_at FROM preloaded_timeline_templates ORDER BY created_at DESC, id ASC
      `).all().map((row) => ({ id: row.id, label: row.label, description: row.description, createdAt: row.created_at, catalogVersion: catalog.dataVersion }));
    } finally {
      db.close();
    }
  }

  function getPreloadedTemplate(templateId) {
    const catalog = readActiveCatalog();
    const db = new DatabaseSync(catalog.databasePath, { readOnly: true });
    try {
      const row = db.prepare(`
        SELECT template.id, template.label, template.description, template.created_at, payload.payload
        FROM preloaded_timeline_templates AS template
        JOIN preloaded_timeline_payloads AS payload ON payload.content_hash = template.payload_hash
        WHERE template.id = ?
      `).get(templateId);
      if (!row) throw dataManagementError('preloaded-template-not-found', `预载排轴模板不存在：${templateId}`);
      return { id: row.id, label: row.label, description: row.description, createdAt: row.created_at, payload: JSON.parse(row.payload), catalogVersion: catalog.dataVersion };
    } finally {
      db.close();
    }
  }

  function clonePreloadedTemplate({ templateId, timelineId, documentLabel, snapshotId, snapshotLabel, createdAt } = {}) {
    if (typeof timelineId !== 'string' || !timelineId.trim() || typeof snapshotId !== 'string' || !snapshotId.trim()) {
      throw dataManagementError('invalid-preloaded-template-clone', '预载排轴克隆缺少用户文档或恢复点 ID。');
    }
    ensureUserDatabase();
    const template = getPreloadedTemplate(templateId);
    const repository = createTimelineRepository({ databasePath: paths.userDatabasePath });
    try {
      const result = repository.createDocumentFromTemplate({
        timelineId: timelineId.trim(),
        documentLabel: typeof documentLabel === 'string' && documentLabel.trim() ? documentLabel.trim() : template.label,
        snapshotId: snapshotId.trim(),
        snapshotLabel: typeof snapshotLabel === 'string' && snapshotLabel.trim() ? snapshotLabel.trim() : `${template.label}（初始恢复点）`,
        templateId: template.id,
        catalogVersion: template.catalogVersion,
        payload: template.payload,
        createdAt,
      });
      const db = new DatabaseSync(paths.userDatabasePath);
      try {
        db.prepare(`
          INSERT INTO user_catalog_references (owner_type, owner_id, catalog_type, catalog_id, catalog_version, created_at)
          VALUES ('timeline-document', ?, 'preloaded-template', ?, ?, ?)
          ON CONFLICT(owner_type, owner_id, catalog_type, catalog_id) DO UPDATE SET catalog_version = excluded.catalog_version
        `).run(result.document.id, template.id, template.catalogVersion, result.document.createdAt);
      } finally {
        db.close();
      }
      return { ...result, template: { id: template.id, catalogVersion: template.catalogVersion } };
    } finally {
      repository.close();
    }
  }

  function parseLegacyStorageValue(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function legacyArchivePayload(archive) {
    const session = asRecord(archive?.storage?.session);
    const local = asRecord(archive?.storage?.local);
    const read = (key, fallback) => parseLegacyStorageValue(session[key], fallback);
    const timelineData = read(WORKSPACE_STORAGE_KEYS.timelineData, { staffLines: [] });
    const selectedCharacters = read(WORKSPACE_STORAGE_KEYS.selectedCharacters, []);
    const skillButtonTable = read(WORKSPACE_STORAGE_KEYS.skillButtonTable, {});
    const allBuffList = read(WORKSPACE_STORAGE_KEYS.allBuffList, []);
    const anomalyArchive = read(WORKSPACE_STORAGE_KEYS.anomalyStateSnapshots, { version: 'v1', nextId: 1, snapshots: [] });
    return {
      selectedCharacters: Array.isArray(selectedCharacters) ? selectedCharacters : [],
      timelineData: timelineData && typeof timelineData === 'object' ? timelineData : { staffLines: [] },
      skillButtonTable: asRecord(skillButtonTable),
      allBuffList: Array.isArray(allBuffList) ? allBuffList : [],
      anomalyStateSnapshots: Array.isArray(anomalyArchive?.snapshots) ? anomalyArchive.snapshots : [],
      characterInputMap: asRecord(read(WORKSPACE_STORAGE_KEYS.characterInputMap, {})),
      characterComputedMap: asRecord(read(WORKSPACE_STORAGE_KEYS.characterComputedMap, {})),
      characterDisplayCacheMap: asRecord(read(WORKSPACE_STORAGE_KEYS.characterDisplayCacheMap, {})),
      operatorConfigPageCache: asRecord(read(WORKSPACE_STORAGE_KEYS.operatorConfigPageCache, {})),
      // This is intentionally retained in the immutable payload so old editor
      // data remains recoverable from user.sqlite even when it has no current
      // Timeline field. The original media is also backed up separately.
      legacyStorage: { local, session },
    };
  }

  function legacyArchiveSnapshots(archive, sourceHash) {
    const snapshots = [];
    const local = asRecord(archive?.storage?.local);
    const archiveValue = parseLegacyStorageValue(local[LEGACY_TIMELINE_SNAPSHOT_ARCHIVE_KEY], null);
    if (Array.isArray(archiveValue?.snapshots)) {
      archiveValue.snapshots.forEach((snapshot, index) => {
        if (!snapshot?.payload || typeof snapshot.payload !== 'object') return;
        snapshots.push({
          id: typeof snapshot.id === 'string' ? snapshot.id : `legacy-snapshot-${sourceHash.slice(0, 12)}-${index + 1}`,
          label: typeof snapshot.label === 'string' ? snapshot.label : `旧快照 ${index + 1}`,
          createdAt: Number.isFinite(Number(snapshot.createdAt)) ? Number(snapshot.createdAt) : Date.now(),
          payload: snapshot.payload,
        });
      });
    }

    const session = asRecord(archive?.storage?.session);
    const hasCurrentWorkspace = Object.values(WORKSPACE_STORAGE_KEYS).some((key) => Object.prototype.hasOwnProperty.call(session, key));
    if (hasCurrentWorkspace || snapshots.length === 0) {
      const createdAt = Date.parse(archive?.createdAt || archive?.exportedAt || '') || Date.now();
      snapshots.unshift({
        id: `legacy-current-${sourceHash.slice(0, 16)}`,
        label: typeof archive?.name === 'string' && archive.name.trim() ? `${archive.name.trim()}（当前态）` : '旧存档当前态',
        createdAt,
        payload: legacyArchivePayload(archive),
      });
    }
    return snapshots;
  }

  function writeLegacyMigrationRecord({ sourceHash, legacyOrigin, sourceName, status, details, migratedAt }) {
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      db.prepare(`
        INSERT INTO legacy_migration_records (source_hash, legacy_origin, source_name, status, details, migrated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_hash) DO UPDATE SET
          legacy_origin = excluded.legacy_origin,
          source_name = excluded.source_name,
          status = excluded.status,
          details = excluded.details,
          migrated_at = excluded.migrated_at
      `).run(sourceHash, legacyOrigin, sourceName, status, JSON.stringify(details), migratedAt);
    } finally {
      db.close();
    }
  }

  function getLegacyMigrationRecord(sourceHash) {
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT status, details, migrated_at FROM legacy_migration_records WHERE source_hash = ?').get(sourceHash);
      if (!row) return null;
      return { status: row.status, details: JSON.parse(row.details), migratedAt: row.migrated_at };
    } finally {
      db.close();
    }
  }

  function migrateLegacyArchiveSource(source) {
    ensureUserDatabase();
    const legacyOrigin = typeof source?.legacyOrigin === 'string' && source.legacyOrigin.trim() ? source.legacyOrigin.trim() : 'legacy-archive';
    const sourceName = typeof source?.sourceName === 'string' && source.sourceName.trim() ? source.sourceName.trim() : 'legacy-archive.json';
    let raw;
    try {
      raw = typeof source?.raw === 'string'
        ? source.raw
        : fs.readFileSync(source?.filePath, 'utf8');
    } catch (error) {
      return { migrated: false, skipped: false, sourceName, legacyOrigin, status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    const contentHash = hashBufferSha256(Buffer.from(raw));
    const sourceHash = `archive:${hashBufferSha256(Buffer.from(`${legacyOrigin}\u0000${sourceName}\u0000${contentHash}`))}`;
    const existing = getLegacyMigrationRecord(sourceHash);
    if (existing?.status === 'completed') {
      return { migrated: false, skipped: true, reason: 'already-migrated', sourceHash, sourceName, legacyOrigin, ...existing };
    }

    const safeSourceName = path.basename(sourceName).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'legacy-archive.json';
    const backupDirectory = path.join(paths.backupDirectory, `legacy-${contentHash.slice(0, 12)}`);
    const backupPath = path.join(backupDirectory, safeSourceName);
    const migratedAt = Date.now();
    try {
      fs.mkdirSync(backupDirectory, { recursive: true });
      if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, raw, 'utf8');
      const archive = JSON.parse(raw);
      if (!archive || archive.type !== 'def.localdata.archive.v1' || !archive.storage) {
        throw dataManagementError('invalid-legacy-archive', '旧存档不是有效的 def.localdata.archive.v1。');
      }
      const snapshots = legacyArchiveSnapshots(archive, contentHash);
      const timelineId = `legacy-${legacyOrigin.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'archive'}-${contentHash.slice(0, 16)}`;
      const repository = createTimelineRepository({ databasePath: paths.userDatabasePath });
      let result;
      try {
        result = repository.importLegacyArchive({
          timelineId,
          documentLabel: typeof archive.name === 'string' && archive.name.trim() ? archive.name.trim() : sourceName,
          snapshots,
          legacyOrigin,
          sourceHash: contentHash,
          createdAt: migratedAt,
        });
      } finally {
        repository.close();
      }
      const details = {
        contentHash,
        backupPath,
        documentId: result.document.id,
        snapshotCount: result.snapshots.length,
        originalPath: source.filePath ? path.resolve(source.filePath) : null,
      };
      writeLegacyMigrationRecord({ sourceHash, legacyOrigin, sourceName, status: 'completed', details, migratedAt });
      return { migrated: true, skipped: false, sourceHash, sourceName, legacyOrigin, migratedAt, ...details };
    } catch (error) {
      const details = {
        contentHash,
        backupPath,
        error: error instanceof Error ? error.message : String(error),
        originalPath: source.filePath ? path.resolve(source.filePath) : null,
      };
      writeLegacyMigrationRecord({ sourceHash, legacyOrigin, sourceName, status: 'failed', details, migratedAt });
      return { migrated: false, skipped: false, sourceHash, sourceName, legacyOrigin, status: 'failed', ...details };
    }
  }

  function migrateLegacyArchives({ sources = [] } = {}) {
    ensureUserDatabase();
    if (!Array.isArray(sources)) throw dataManagementError('invalid-legacy-archive-sources', '旧存档迁移源必须是数组。');
    return sources.map((source) => migrateLegacyArchiveSource(source));
  }

  function listLegacyMigrationRecords() {
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      return db.prepare(`
        SELECT source_hash, legacy_origin, source_name, status, details, migrated_at
        FROM legacy_migration_records ORDER BY migrated_at DESC, source_name ASC
      `).all().map((row) => ({
        sourceHash: row.source_hash,
        legacyOrigin: row.legacy_origin,
        sourceName: row.source_name,
        status: row.status,
        details: JSON.parse(row.details),
        migratedAt: row.migrated_at,
      }));
    } finally {
      db.close();
    }
  }

  function migrateLegacyTimelineRepository({ legacyDatabasePath, legacyOrigin = 'timeline-repository.sqlite3' } = {}) {
    ensureUserDatabase();
    if (!legacyDatabasePath || !fs.existsSync(legacyDatabasePath)) {
      return { migrated: false, skipped: true, reason: 'legacy-database-not-found' };
    }
    const sourcePath = path.resolve(legacyDatabasePath);
    const sourceHash = hashFileSha256(sourcePath);
    const targetDb = new DatabaseSync(paths.userDatabasePath);
    try {
      const existingRecord = targetDb.prepare(`
        SELECT status, details, migrated_at FROM legacy_migration_records WHERE source_hash = ?
      `).get(sourceHash);
      if (existingRecord?.status === 'completed') {
        return {
          migrated: false,
          skipped: true,
          reason: 'already-migrated',
          sourceHash,
          migratedAt: existingRecord.migrated_at,
          details: JSON.parse(existingRecord.details),
        };
      }
      const timelineCount = Number(targetDb.prepare('SELECT COUNT(*) AS count FROM timeline_documents').get().count);
      const operatorConfigCount = Number(targetDb.prepare('SELECT COUNT(*) AS count FROM user_operator_configs').get().count);
      const buffCount = Number(targetDb.prepare('SELECT COUNT(*) AS count FROM user_buffs').get().count);
      if (timelineCount || operatorConfigCount || buffCount) {
        throw dataManagementError(
          'legacy-timeline-migration-target-not-pristine',
          'user.sqlite 已有用户数据，拒绝覆盖式迁移旧 Timeline 数据库。',
          { timelineCount, operatorConfigCount, buffCount },
        );
      }
    } finally {
      targetDb.close();
    }

    const backupDirectory = path.join(paths.backupDirectory, `${Date.now()}-${sourceHash.slice(0, 12)}`);
    const sourceBaseName = path.basename(sourcePath);
    const backupPath = path.join(backupDirectory, sourceBaseName);
    const incomingPath = `${paths.userDatabasePath}.incoming-${crypto.randomBytes(6).toString('hex')}`;
    const sidecars = ['-wal', '-shm'];
    try {
      fs.mkdirSync(backupDirectory, { recursive: true });
      fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
      for (const suffix of sidecars) {
        if (fs.existsSync(`${sourcePath}${suffix}`)) fs.copyFileSync(`${sourcePath}${suffix}`, `${backupPath}${suffix}`, fs.constants.COPYFILE_EXCL);
      }
      fs.copyFileSync(backupPath, incomingPath, fs.constants.COPYFILE_EXCL);
      for (const suffix of sidecars) {
        if (fs.existsSync(`${backupPath}${suffix}`)) fs.copyFileSync(`${backupPath}${suffix}`, `${incomingPath}${suffix}`, fs.constants.COPYFILE_EXCL);
      }
      const incomingRepository = createTimelineRepository({ databasePath: incomingPath });
      const documentCount = incomingRepository.listDocuments().length;
      incomingRepository.close();
      fs.rmSync(paths.userDatabasePath, { force: true });
      for (const suffix of sidecars) fs.rmSync(`${paths.userDatabasePath}${suffix}`, { force: true });
      fs.renameSync(incomingPath, paths.userDatabasePath);
      for (const suffix of sidecars) {
        if (fs.existsSync(`${incomingPath}${suffix}`)) fs.renameSync(`${incomingPath}${suffix}`, `${paths.userDatabasePath}${suffix}`);
      }
      ensureUserDatabase();
      const migratedAt = Date.now();
      const details = { legacyDatabasePath: sourcePath, backupPath, documentCount };
      const db = new DatabaseSync(paths.userDatabasePath);
      try {
        db.prepare(`
          INSERT INTO legacy_migration_records (source_hash, legacy_origin, source_name, status, details, migrated_at)
          VALUES (?, ?, ?, 'completed', ?, ?)
          ON CONFLICT(source_hash) DO UPDATE SET status = excluded.status, details = excluded.details, migrated_at = excluded.migrated_at
        `).run(sourceHash, legacyOrigin, sourceBaseName, JSON.stringify(details), migratedAt);
      } finally {
        db.close();
      }
      return { migrated: true, skipped: false, sourceHash, migratedAt, ...details };
    } catch (error) {
      fs.rmSync(incomingPath, { force: true });
      for (const suffix of sidecars) fs.rmSync(`${incomingPath}${suffix}`, { force: true });
      throw error;
    }
  }

  return {
    paths,
    ensureLayout,
    ensureUserDatabase,
    getUserOperatorConfig: (operatorId) => getUserRecord('user_operator_configs', operatorId),
    putUserOperatorConfig: (operatorId, payload, updatedAt) => putUserRecord('user_operator_configs', operatorId, payload, updatedAt),
    getUserBuff: (id) => getUserRecord('user_buffs', id),
    putUserBuff: (id, payload, updatedAt) => putUserRecord('user_buffs', id, payload, updatedAt),
    getWorkspaceState,
    putWorkspaceState,
    restoreWorkspaceSnapshot,
    readActiveCatalog,
    activateVersion,
    installRelease,
    rollbackTo,
    listPreloadedTemplates,
    getPreloadedTemplate,
    clonePreloadedTemplate,
    migrateLegacyTimelineRepository,
    migrateLegacyArchives,
    listLegacyMigrationRecords,
  };
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  DATA_RELEASE_MANIFEST_TYPE,
  USER_SCHEMA_VERSION,
  createCatalogDatabase,
  validateCatalogDatabase,
  createDataReleasePackage,
  createDataManagementService,
  signDataReleaseManifest,
  validateDataReleaseManifest,
  verifyDataReleaseManifestSignature,
};
