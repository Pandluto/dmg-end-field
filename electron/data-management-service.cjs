const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createTimelineRepository } = require('./timeline-repository.cjs');

const DATA_RELEASE_MANIFEST_TYPE = 'dmg.data-release-manifest.v1';
const LOCAL_DATA_RELEASE_MANIFEST_TYPE = 'dmg.local-data-release-manifest.v1';
const LOCAL_DATA_RELEASE_PACKAGE_MANIFEST_TYPE = 'dmg.local-data-release-package.v1';
const CATALOG_PACKAGE_MANIFEST_TYPE = 'dmg.catalog-package.v1';
const TIMELINE_ARCHIVE_TYPE = 'dmg.timeline-archive.v1';
const REFERENCE_ARCHIVE_RELEASE_MANIFEST_TYPE = 'dmg.reference-archive-release-manifest.v1';
const REFERENCE_ARCHIVE_PACKAGE_MANIFEST_TYPE = 'dmg.reference-archive-package.v1';
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
const WORK_NODE_STATUS_VALUES = new Set(['draft', 'validated', 'blocked', 'applied', 'archived', 'open', 'ready', 'committed', 'abandoned']);

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

function hashTimelinePayload(payload) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeArchiveId(value, fallback = 'archive') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return safe || fallback;
}

function summarizeTimelinePayload(payload) {
  const lines = Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [];
  return {
    characterCount: Array.isArray(payload?.selectedCharacters) ? payload.selectedCharacters.length : 0,
    buttonCount: lines.reduce((count, line) => count + (Array.isArray(line?.buttons) ? line.buttons.length : 0), 0),
    buffCount: Array.isArray(payload?.allBuffList) ? payload.allBuffList.length : 0,
  };
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function normalizeArchiveWorktree(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes)) {
    throw dataManagementError('invalid-timeline-archive-worktree', '排轴存档节点树格式无效。');
  }
  if (!Number.isSafeInteger(value.nodeCount) || value.nodeCount < 0 || value.nodeCount !== value.nodes.length) {
    throw dataManagementError('timeline-archive-node-count-mismatch', '排轴存档节点数量与节点树不一致。');
  }
  const nodes = value.nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id.trim()
      || !node.basePayload || typeof node.basePayload !== 'object'
      || !node.workingPayload || typeof node.workingPayload !== 'object') {
      throw dataManagementError('invalid-timeline-archive-work-node', `排轴存档第 ${index + 1} 个节点无效。`);
    }
    if (node.status && !WORK_NODE_STATUS_VALUES.has(node.status)) {
      throw dataManagementError('invalid-timeline-archive-work-node-status', `排轴存档节点状态无效：${node.status}`);
    }
    return {
      id: node.id.trim(),
      ...(typeof node.parentNodeId === 'string' && node.parentNodeId.trim() ? { parentNodeId: node.parentNodeId.trim() } : {}),
      branchId: typeof node.branchId === 'string' && node.branchId.trim() ? node.branchId.trim() : node.id.trim(),
      label: typeof node.label === 'string' && node.label.trim() ? node.label.trim() : node.id.trim(),
      description: typeof node.description === 'string' ? node.description : '',
      status: node.status || 'ready',
      approvalPolicy: typeof node.approvalPolicy === 'string' && node.approvalPolicy.trim() ? node.approvalPolicy.trim() : 'manual',
      riskFlags: Array.isArray(node.riskFlags) ? cloneJson(node.riskFlags) : [],
      logs: Array.isArray(node.logs) ? cloneJson(node.logs) : [],
      createdAt: Number.isFinite(Number(node.createdAt)) ? Number(node.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(node.updatedAt)) ? Number(node.updatedAt) : Date.now(),
      contentRevision: Number.isFinite(Number(node.contentRevision)) ? Number(node.contentRevision) : null,
      basePayload: cloneJson(node.basePayload),
      workingPayload: cloneJson(node.workingPayload),
    };
  });
  const nodeById = new Map();
  for (const node of nodes) {
    if (nodeById.has(node.id)) throw dataManagementError('duplicate-timeline-archive-work-node', `排轴存档含重复节点：${node.id}`);
    nodeById.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentNodeId && !nodeById.has(node.parentNodeId)) {
      throw dataManagementError('orphan-timeline-archive-work-node', `排轴存档节点父级不存在：${node.id}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) throw dataManagementError('cyclic-timeline-archive-worktree', '排轴存档节点树存在循环。');
    visiting.add(nodeId);
    const parent = nodeById.get(nodeId)?.parentNodeId;
    if (parent) visit(parent);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  nodes.forEach((node) => visit(node.id));
  const currentNodeId = typeof value.currentNodeId === 'string' && value.currentNodeId.trim() ? value.currentNodeId.trim() : null;
  if (currentNodeId && !nodeById.has(currentNodeId)) {
    throw dataManagementError('timeline-archive-current-node-not-found', '排轴存档记录的当前节点不存在。');
  }
  return {
    nodes,
    currentNodeId,
    rootPayloadHash: typeof value.rootPayloadHash === 'string' ? value.rootPayloadHash : null,
    currentPayloadHash: typeof value.currentPayloadHash === 'string' ? value.currentPayloadHash : null,
    nodeCount: nodes.length,
  };
}

function normalizeTimelineArchive(value, { expectedSource, allowInvalidWorktree = false, requireReference = false } = {}) {
  if (!value || typeof value !== 'object' || value.type !== TIMELINE_ARCHIVE_TYPE || value.archiveVersion !== 1) {
    throw dataManagementError('invalid-timeline-archive', '排轴存档类型或版本无效。');
  }
  if (!['local', 'shared', 'reference'].includes(value.source)) {
    throw dataManagementError('invalid-timeline-archive-source', '排轴存档来源必须是 local 或 shared。');
  }
  if (expectedSource && value.source !== expectedSource) {
    throw dataManagementError('timeline-archive-source-mismatch', '排轴存档来源与所在存档库不一致。');
  }
  if (typeof value.archiveId !== 'string' || sanitizeArchiveId(value.archiveId) !== value.archiveId) {
    throw dataManagementError('invalid-timeline-archive-id', '排轴存档 ID 无效。');
  }
  if (typeof value.label !== 'string' || !value.label.trim() || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw dataManagementError('invalid-timeline-archive-payload', '排轴存档缺少名称或排轴内容。');
  }
  if (requireReference && (!value.reference || typeof value.reference.releaseId !== 'string' || !value.reference.releaseId.trim()
    || typeof value.reference.packageHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.reference.packageHash))) {
    throw dataManagementError('invalid-reference-timeline-archive', '参考存档缺少已校验的发布来源。');
  }
  let worktree = null;
  let worktreeDiagnostic = null;
  if (value.worktree !== undefined) {
    try {
      worktree = normalizeArchiveWorktree(value.worktree);
    } catch (error) {
      if (!allowInvalidWorktree) throw error;
      worktreeDiagnostic = { code: error?.code || 'invalid-timeline-archive-worktree', message: error instanceof Error ? error.message : String(error) };
    }
  }
  const payload = cloneJson(value.payload);
  const payloadHash = hashTimelinePayload(payload);
  return {
    type: TIMELINE_ARCHIVE_TYPE,
    archiveVersion: 1,
    source: value.source,
    archiveId: value.archiveId,
    label: value.label.trim(),
    createdAt: typeof value.createdAt === 'string' && value.createdAt.trim() ? value.createdAt : new Date().toISOString(),
    payload,
    payloadHash,
    ...(worktree ? { worktree } : {}),
    ...(worktreeDiagnostic ? { worktreeDiagnostic } : {}),
    ...(value.reference && typeof value.reference === 'object' ? { reference: cloneJson(value.reference) } : {}),
  };
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
  const referenceArchives = manifest.referenceArchives === undefined ? [] : manifest.referenceArchives;
  if (!Array.isArray(referenceArchives)) {
    throw dataManagementError('invalid-data-release-manifest', '数据发布清单 referenceArchives 必须是数组。');
  }
  const archiveIds = new Set();
  const normalizedReferenceArchives = referenceArchives.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.archiveId !== 'string' || sanitizeArchiveId(entry.archiveId) !== entry.archiveId) {
      throw dataManagementError('invalid-data-release-reference-archive', '数据发布清单含无效参考存档 ID。');
    }
    if (archiveIds.has(entry.archiveId)) {
      throw dataManagementError('duplicate-data-release-reference-archive', `数据发布清单含重复参考存档：${entry.archiveId}`);
    }
    archiveIds.add(entry.archiveId);
    if (typeof entry.label !== 'string' || !entry.label.trim() || !Number.isInteger(entry.archiveVersion) || entry.archiveVersion < 1
      || typeof entry.payloadHash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(entry.payloadHash)
      || !Number.isSafeInteger(entry.nodeCount) || entry.nodeCount < 0) {
      throw dataManagementError('invalid-data-release-reference-archive', `数据发布清单参考存档条目无效：${entry.archiveId}`);
    }
    return {
      archiveId: entry.archiveId,
      label: entry.label.trim(),
      archiveVersion: entry.archiveVersion,
      payloadHash: entry.payloadHash.toLowerCase(),
      nodeCount: entry.nodeCount,
      hasCurrentNode: Boolean(entry.hasCurrentNode),
    };
  });
  if (shellVersion && manifest.minShellVersion && compareVersionNumberish(shellVersion, manifest.minShellVersion) < 0) {
    throw dataManagementError('data-release-shell-version-incompatible', `当前 Shell ${shellVersion} 不满足最低版本 ${manifest.minShellVersion}。`);
  }
  const signatureInfo = requireSignature ? verifyDataReleaseManifestSignature(manifest, publicKey) : null;
  return { ...manifest, dataVersion, referenceArchives: normalizedReferenceArchives, signatureInfo };
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

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

function listZipArchiveEntries(archivePath) {
  if (process.platform !== 'win32') {
    return runChecked('unzip', ['-Z1', archivePath]).split(/\r?\n/).filter(Boolean);
  }
  const escapedArchive = escapePowerShellLiteral(archivePath);
  const output = runChecked('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [System.IO.Compression.ZipFile]::OpenRead('${escapedArchive}'); try { foreach ($entry in $archive.Entries) { [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($entry.FullName)) } } finally { $archive.Dispose() }`,
  ]).trim();
  try {
    return output ? output.split(/\r?\n/).map((entry) => Buffer.from(entry, 'base64').toString('utf8')) : [];
  } catch (error) {
    throw dataManagementError('data-release-archive-list-failed', '无法读取数据发布包文件列表。', {
      archivePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function extractZipArchive(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    const escapedArchive = escapePowerShellLiteral(archivePath);
    const escapedDestination = escapePowerShellLiteral(destination);
    runChecked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
    return;
  }
  runChecked('unzip', ['-q', archivePath, '-d', destination]);
}

function assertSafeDataReleaseArchive(archivePath, referenceArchives = []) {
  const entries = listZipArchiveEntries(archivePath);
  const expected = new Set([
    'catalog.sqlite',
    'manifest.json',
    ...(referenceArchives.length ? ['archives/'] : []),
    ...referenceArchives.map((entry) => `archives/${entry.archiveId}.json`),
  ]);
  if (entries.length !== expected.size || new Set(entries).size !== entries.length || entries.some((entry) => !expected.has(entry))) {
    throw dataManagementError('unsafe-data-release-archive', '数据发布包包含未声明的文件。', { entries });
  }
}

function extractDataReleaseArchive(archivePath, destination, referenceArchives = []) {
  assertSafeDataReleaseArchive(archivePath, referenceArchives);
  extractZipArchive(archivePath, destination);
}

function createDataReleasePackage({ catalogPath, outputDirectory, referenceArchiveDirectory, manifest: manifestInput, privateKey, keyId }) {
  const catalog = validateCatalogDatabase({ databasePath: catalogPath, expectedDataVersion: manifestInput?.dataVersion });
  const dataVersion = sanitizeVersion(manifestInput?.dataVersion);
  const outputDir = path.resolve(outputDirectory, dataVersion);
  if (fs.existsSync(outputDir)) throw dataManagementError('data-release-output-exists', `发布目录已存在：${outputDir}`);
  const referenceArchives = (() => {
    if (!referenceArchiveDirectory) return [];
    if (!fs.existsSync(referenceArchiveDirectory) || !fs.statSync(referenceArchiveDirectory).isDirectory()) {
      throw dataManagementError('reference-archive-source-not-found', '待发布参考存档目录不存在。');
    }
    const seen = new Set();
    return fs.readdirSync(referenceArchiveDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => normalizeTimelineArchive(
        JSON.parse(fs.readFileSync(path.join(referenceArchiveDirectory, entry.name), 'utf8')),
        { expectedSource: 'reference' },
      ))
      .sort((left, right) => left.archiveId.localeCompare(right.archiveId))
      .map((archive) => {
        if (seen.has(archive.archiveId)) {
          throw dataManagementError('duplicate-data-release-reference-archive', `待发布参考存档含重复 ID：${archive.archiveId}`);
        }
        seen.add(archive.archiveId);
        return archive;
      });
  })();
  const archiveEntries = referenceArchives.map((archive) => ({
    archiveId: archive.archiveId,
    label: archive.label,
    archiveVersion: archive.archiveVersion,
    payloadHash: archive.payloadHash,
    nodeCount: archive.worktree?.nodeCount || 0,
    hasCurrentNode: Boolean(archive.worktree?.currentNodeId),
  }));
  const packageFileName = `data-${dataVersion}.zip`;
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-catalog-${dataVersion}-`));
  try {
    fs.copyFileSync(catalogPath, path.join(temporaryDir, 'catalog.sqlite'));
    fs.writeFileSync(path.join(temporaryDir, 'manifest.json'), `${JSON.stringify({
      type: CATALOG_PACKAGE_MANIFEST_TYPE,
      schemaVersion: 1,
      dataVersion,
      catalog: { sha256: catalog.sha256, schemaVersion: catalog.schemaVersion },
      referenceArchives: archiveEntries,
    }, null, 2)}\n`, 'utf8');
    if (referenceArchives.length) {
      const archiveDirectory = path.join(temporaryDir, 'archives');
      fs.mkdirSync(archiveDirectory, { recursive: true });
      for (const archive of referenceArchives) {
        const portableArchive = { ...archive };
        delete portableArchive.reference;
        writeJsonAtomically(path.join(archiveDirectory, `${archive.archiveId}.json`), portableArchive);
      }
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const packagePath = path.join(outputDir, packageFileName);
    runChecked('zip', ['-X', '-q', '-r', packagePath, 'catalog.sqlite', 'manifest.json', ...(referenceArchives.length ? ['archives'] : [])], { cwd: temporaryDir });
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
      referenceArchives: archiveEntries,
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

function normalizeLocalDataPackage(value) {
  if (!value || typeof value !== 'object' || value.type !== 'def.localdata.archive.v1'
    || !value.storage || typeof value.storage !== 'object') {
    throw dataManagementError('invalid-local-data-package', '完整数据包必须是有效的 def.localdata.archive.v1。');
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw dataManagementError('invalid-local-data-package', '完整数据包缺少 id。');
  }
  const local = value.storage.local && typeof value.storage.local === 'object' && !Array.isArray(value.storage.local)
    ? cloneJson(value.storage.local)
    : {};
  const session = value.storage.session && typeof value.storage.session === 'object' && !Array.isArray(value.storage.session)
    ? cloneJson(value.storage.session)
    : {};
  const timelineArchives = value.timelineArchives === undefined
    ? []
    : (Array.isArray(value.timelineArchives) ? value.timelineArchives.map((archive) => cloneJson(archive)) : (() => {
      throw dataManagementError('invalid-local-data-package', '完整数据包 timelineArchives 必须是数组。');
    })());
  return {
    ...cloneJson(value),
    id: value.id.trim(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id.trim(),
    storage: { local, session },
    ...(timelineArchives.length ? { timelineArchives } : {}),
  };
}

function localDataPackageHash(dataPackage) {
  return hashBufferSha256(Buffer.from(stableJson(normalizeLocalDataPackage(dataPackage))));
}

function validateLocalDataReleaseManifest(manifest, { shellVersion = '' } = {}) {
  if (!manifest || typeof manifest !== 'object' || manifest.type !== LOCAL_DATA_RELEASE_MANIFEST_TYPE || manifest.manifestVersion !== 1) {
    throw dataManagementError('invalid-local-data-release-manifest', '数据发布清单类型或版本无效。');
  }
  const dataVersion = sanitizeVersion(manifest.dataVersion);
  if (typeof manifest.releaseTag !== 'string' || !manifest.releaseTag.trim()) {
    throw dataManagementError('invalid-local-data-release-manifest', '数据发布清单缺少 releaseTag。');
  }
  const source = manifest.source;
  if (!source || typeof source !== 'object' || !['local', 'share'].includes(source.scope)
    || typeof source.id !== 'string' || !source.id.trim() || typeof source.fileName !== 'string' || !source.fileName.endsWith('.json')) {
    throw dataManagementError('invalid-local-data-release-manifest', '数据发布清单来源无效。');
  }
  const packageInfo = manifest.package;
  if (!packageInfo || typeof packageInfo !== 'object') throw dataManagementError('invalid-local-data-release-manifest', '数据发布清单缺少 package。');
  assertPackageFileName(packageInfo.fileName);
  assertSha256(packageInfo.sha256, 'package.sha256');
  if (!Number.isSafeInteger(packageInfo.sizeBytes) || packageInfo.sizeBytes <= 0 || packageInfo.sizeBytes > DEFAULT_MAX_PACKAGE_BYTES) {
    throw dataManagementError('invalid-local-data-release-package-size', '数据发布包大小无效或超过限制。');
  }
  const data = manifest.data;
  if (!data || typeof data !== 'object' || !/^sha256:[a-f0-9]{64}$/i.test(data.sha256 || '')
    || !Number.isSafeInteger(data.sizeBytes) || data.sizeBytes <= 0) {
    throw dataManagementError('invalid-local-data-release-manifest', '数据发布清单 data 无效。');
  }
  if (shellVersion && manifest.minShellVersion && compareVersionNumberish(shellVersion, manifest.minShellVersion) < 0) {
    throw dataManagementError('local-data-release-shell-version-incompatible', `当前 Shell ${shellVersion} 不满足最低版本 ${manifest.minShellVersion}。`);
  }
  return {
    ...manifest,
    dataVersion,
    source: { scope: source.scope, id: source.id.trim(), fileName: path.basename(source.fileName) },
    package: { ...packageInfo, sha256: assertSha256(packageInfo.sha256, 'package.sha256') },
    data: { ...data, sha256: data.sha256.toLowerCase() },
  };
}

function assertSafeLocalDataReleaseArchive(archivePath) {
  const entries = listZipArchiveEntries(archivePath);
  const expected = new Set(['manifest.json', 'data.json']);
  if (entries.length !== expected.size || new Set(entries).size !== entries.length || entries.some((entry) => !expected.has(entry))) {
    throw dataManagementError('unsafe-local-data-release-archive', '数据发布包只能包含 manifest.json 与 data.json。', { entries });
  }
}

function extractLocalDataReleaseArchive(archivePath, destination) {
  assertSafeLocalDataReleaseArchive(archivePath);
  extractZipArchive(archivePath, destination);
}

function createLocalDataReleasePackage({ dataPackagePath, sourceScope, outputDirectory, manifest: manifestInput }) {
  if (!dataPackagePath || !fs.existsSync(dataPackagePath) || !fs.statSync(dataPackagePath).isFile()) {
    throw dataManagementError('local-data-release-source-not-found', '选择的数据包不存在。');
  }
  if (!['local', 'share'].includes(sourceScope)) throw dataManagementError('invalid-local-data-release-source', '发布来源必须是 Local Data 或 Share Data。');
  if (!outputDirectory || !fs.existsSync(outputDirectory) || !fs.statSync(outputDirectory).isDirectory()) {
    throw dataManagementError('local-data-release-output-not-found', '数据发布输出目录不存在。');
  }
  const dataVersion = sanitizeVersion(manifestInput?.dataVersion);
  const dataPackage = normalizeLocalDataPackage(JSON.parse(fs.readFileSync(dataPackagePath, 'utf8')));
  const dataJson = `${JSON.stringify(dataPackage, null, 2)}\n`;
  const dataSha256 = hashBufferSha256(Buffer.from(stableJson(dataPackage)));
  const outputDir = path.resolve(outputDirectory, dataVersion);
  if (fs.existsSync(outputDir)) throw dataManagementError('local-data-release-output-exists', `发布目录已存在：${outputDir}`);
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-local-data-${dataVersion}-`));
  try {
    const packageFileName = `data-${dataVersion}.zip`;
    const innerManifest = {
      type: LOCAL_DATA_RELEASE_PACKAGE_MANIFEST_TYPE,
      manifestVersion: 1,
      dataVersion,
      source: { scope: sourceScope, id: dataPackage.id, fileName: path.basename(dataPackagePath) },
      data: { sha256: `sha256:${dataSha256}`, sizeBytes: Buffer.byteLength(dataJson) },
    };
    writeJsonAtomically(path.join(temporaryDir, 'manifest.json'), innerManifest);
    fs.writeFileSync(path.join(temporaryDir, 'data.json'), dataJson, 'utf8');
    fs.mkdirSync(outputDir, { recursive: true });
    const packagePath = path.join(outputDir, packageFileName);
    runChecked('zip', ['-X', '-q', '-r', packagePath, 'manifest.json', 'data.json'], { cwd: temporaryDir });
    const manifest = {
      type: LOCAL_DATA_RELEASE_MANIFEST_TYPE,
      manifestVersion: 1,
      dataVersion,
      releaseTag: typeof manifestInput?.releaseTag === 'string' && manifestInput.releaseTag.trim() ? manifestInput.releaseTag.trim() : dataVersion,
      generatedAt: manifestInput?.generatedAt || new Date().toISOString(),
      minShellVersion: typeof manifestInput?.minShellVersion === 'string' ? manifestInput.minShellVersion.trim() : '',
      source: innerManifest.source,
      package: { fileName: packageFileName, packagePath: packageFileName, sizeBytes: fs.statSync(packagePath).size, sha256: hashFileSha256(packagePath) },
      data: innerManifest.data,
    };
    const checked = validateLocalDataReleaseManifest(manifest);
    const manifestPath = path.join(outputDir, 'data-release-manifest.json');
    writeJsonAtomically(manifestPath, checked);
    return { outputDir, packagePath, manifestPath, manifest: checked };
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function installLocalDataRelease({ manifest, archivePath, targetDirectory, shellVersion = '' }) {
  const checked = validateLocalDataReleaseManifest(manifest, { shellVersion });
  if (!archivePath || !fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    throw dataManagementError('local-data-release-package-not-found', '下载的数据发布包不存在。');
  }
  const stats = fs.statSync(archivePath);
  if (stats.size !== checked.package.sizeBytes || stats.size > DEFAULT_MAX_PACKAGE_BYTES || hashFileSha256(archivePath) !== checked.package.sha256) {
    throw dataManagementError('local-data-release-package-integrity-failed', '下载的数据发布包完整性校验失败。');
  }
  if (!targetDirectory) throw dataManagementError('local-data-release-target-missing', 'Share Data 目录缺失。');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-local-data-install-${checked.dataVersion}-`));
  try {
    extractLocalDataReleaseArchive(archivePath, staging);
    const inner = readJsonIfExists(path.join(staging, 'manifest.json'));
    const dataPackage = normalizeLocalDataPackage(readJsonIfExists(path.join(staging, 'data.json')));
    const expectedInner = {
      type: LOCAL_DATA_RELEASE_PACKAGE_MANIFEST_TYPE,
      manifestVersion: 1,
      dataVersion: checked.dataVersion,
    };
    if (!inner || inner.type !== expectedInner.type || inner.manifestVersion !== expectedInner.manifestVersion
      || inner.dataVersion !== expectedInner.dataVersion || inner.source?.id !== checked.source.id
      || inner.source?.scope !== checked.source.scope || inner.data?.sha256 !== checked.data.sha256
      || inner.data?.sizeBytes !== checked.data.sizeBytes || localDataPackageHash(dataPackage) !== checked.data.sha256.slice('sha256:'.length)) {
      throw dataManagementError('local-data-release-inner-manifest-mismatch', '数据发布包内部内容与清单不一致。');
    }
    fs.mkdirSync(targetDirectory, { recursive: true });
    const fileName = `release-${checked.dataVersion}-${sanitizeArchiveId(checked.source.id, 'data')}.json`;
    const destination = path.join(targetDirectory, fileName);
    const writeState = () => {
      const statePath = path.join(targetDirectory, '.data-release-state.json');
      const state = readJsonIfExists(statePath) || { versions: {} };
      const versions = state.versions && typeof state.versions === 'object' ? state.versions : {};
      writeJsonAtomically(statePath, {
        versions: {
          ...versions,
          [checked.dataVersion]: { fileName, sha256: checked.data.sha256, downloadedAt: new Date().toISOString(), manifestUrl: '' },
        },
        activeVersion: checked.dataVersion,
      });
    };
    if (fs.existsSync(destination)) {
      const existing = normalizeLocalDataPackage(JSON.parse(fs.readFileSync(destination, 'utf8')));
      if (localDataPackageHash(existing) !== checked.data.sha256.slice('sha256:'.length)) {
        throw dataManagementError('local-data-release-version-collision', `Share Data 已有版本 ${checked.dataVersion} 但内容不同的数据包。`);
      }
      writeState();
      return { installed: false, reused: true, fileName, path: destination, manifest: checked };
    }
    writeJsonAtomically(destination, dataPackage);
    writeState();
    return { installed: true, reused: false, fileName, path: destination, manifest: checked };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function validateReferenceArchiveReleaseManifest(manifest, { shellVersion, publicKey, requireSignature = Boolean(publicKey) } = {}) {
  if (!manifest || typeof manifest !== 'object'
    || manifest.type !== REFERENCE_ARCHIVE_RELEASE_MANIFEST_TYPE
    || manifest.manifestVersion !== 1) {
    throw dataManagementError('invalid-reference-archive-release-manifest', '参考存档发布清单类型或版本无效。');
  }
  const releaseId = sanitizeVersion(manifest.releaseId);
  if (!manifest.package || typeof manifest.package !== 'object') {
    throw dataManagementError('invalid-reference-archive-release-manifest', '参考存档发布清单缺少 package。');
  }
  assertPackageFileName(manifest.package.fileName);
  assertSha256(manifest.package.sha256, 'package.sha256');
  if (!Number.isSafeInteger(manifest.package.sizeBytes) || manifest.package.sizeBytes <= 0 || manifest.package.sizeBytes > DEFAULT_MAX_PACKAGE_BYTES) {
    throw dataManagementError('invalid-reference-archive-package-size', '参考存档发布包大小无效。');
  }
  if (!Array.isArray(manifest.archives) || manifest.archives.length === 0) {
    throw dataManagementError('invalid-reference-archive-release-manifest', '参考存档发布清单必须包含至少一份存档。');
  }
  const archiveIds = new Set();
  const archives = manifest.archives.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.archiveId !== 'string' || sanitizeArchiveId(entry.archiveId) !== entry.archiveId) {
      throw dataManagementError('invalid-reference-archive-release-entry', '参考存档发布清单含无效 archiveId。');
    }
    if (archiveIds.has(entry.archiveId)) throw dataManagementError('duplicate-reference-archive-release-entry', `参考存档发布清单含重复 archiveId：${entry.archiveId}`);
    archiveIds.add(entry.archiveId);
    if (typeof entry.label !== 'string' || !entry.label.trim() || !Number.isInteger(entry.archiveVersion) || entry.archiveVersion < 1
      || typeof entry.payloadHash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(entry.payloadHash)
      || !Number.isSafeInteger(entry.nodeCount) || entry.nodeCount < 0) {
      throw dataManagementError('invalid-reference-archive-release-entry', `参考存档发布清单条目无效：${entry.archiveId}`);
    }
    return {
      archiveId: entry.archiveId,
      label: entry.label.trim(),
      archiveVersion: entry.archiveVersion,
      payloadHash: entry.payloadHash.toLowerCase(),
      nodeCount: entry.nodeCount,
      hasCurrentNode: Boolean(entry.hasCurrentNode),
    };
  });
  if (shellVersion && manifest.minShellVersion && compareVersionNumberish(shellVersion, manifest.minShellVersion) < 0) {
    throw dataManagementError('reference-archive-release-shell-version-incompatible', `当前 Shell ${shellVersion} 不满足参考存档最低版本 ${manifest.minShellVersion}。`);
  }
  const signatureInfo = requireSignature ? verifyDataReleaseManifestSignature(manifest, publicKey) : null;
  return { ...manifest, releaseId, archives, signatureInfo };
}

function assertSafeReferenceArchivePackage(archivePath, archiveIds) {
  const entries = listZipArchiveEntries(archivePath);
  const expected = new Set([
    'manifest.json',
    'archives/',
    ...archiveIds.map((archiveId) => `archives/${archiveId}.json`),
  ]);
  if (entries.length !== expected.size || new Set(entries).size !== entries.length || entries.some((entry) => !expected.has(entry))) {
    throw dataManagementError('unsafe-reference-archive-package', '参考存档发布包包含未声明的文件。', { entries });
  }
}

function createReferenceArchiveReleasePackage({ sourceDirectory, outputDirectory, manifest: manifestInput, privateKey, keyId }) {
  if (!sourceDirectory || !fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) {
    throw dataManagementError('reference-archive-source-not-found', '参考存档发布源目录不存在。');
  }
  if (!outputDirectory) throw dataManagementError('reference-archive-output-not-found', '参考存档发布输出目录缺失。');
  const releaseId = sanitizeVersion(manifestInput?.releaseId || manifestInput?.dataVersion);
  const outputDir = path.resolve(outputDirectory, releaseId);
  if (fs.existsSync(outputDir)) throw dataManagementError('reference-archive-release-output-exists', `参考存档发布目录已存在：${outputDir}`);
  const candidates = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({ fileName: entry.name, raw: JSON.parse(fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8')) }));
  if (!candidates.length) throw dataManagementError('reference-archive-source-empty', '参考存档发布源目录没有存档。');
  const archives = candidates.map(({ raw }) => normalizeTimelineArchive(raw, { expectedSource: 'reference' }));
  const archiveIds = new Set();
  for (const archive of archives) {
    if (archiveIds.has(archive.archiveId)) throw dataManagementError('duplicate-reference-archive-release-entry', `参考存档发布源含重复 archiveId：${archive.archiveId}`);
    archiveIds.add(archive.archiveId);
  }
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-reference-archives-${releaseId}-`));
  try {
    const archiveDirectory = path.join(temporaryDir, 'archives');
    fs.mkdirSync(archiveDirectory, { recursive: true });
    for (const archive of archives) writeJsonAtomically(path.join(archiveDirectory, `${archive.archiveId}.json`), archive);
    const archiveEntries = archives.map((archive) => ({
      archiveId: archive.archiveId,
      label: archive.label,
      archiveVersion: archive.archiveVersion,
      payloadHash: archive.payloadHash,
      nodeCount: archive.worktree?.nodeCount || 0,
      hasCurrentNode: Boolean(archive.worktree?.currentNodeId),
    }));
    fs.writeFileSync(path.join(temporaryDir, 'manifest.json'), `${JSON.stringify({
      type: REFERENCE_ARCHIVE_PACKAGE_MANIFEST_TYPE,
      schemaVersion: 1,
      releaseId,
      archives: archiveEntries,
    }, null, 2)}\n`, 'utf8');
    fs.mkdirSync(outputDir, { recursive: true });
    const packageFileName = `reference-archives-${releaseId}.zip`;
    const packagePath = path.join(outputDir, packageFileName);
    runChecked('zip', ['-X', '-q', '-r', packagePath, 'manifest.json', 'archives'], { cwd: temporaryDir });
    const unsignedManifest = {
      type: REFERENCE_ARCHIVE_RELEASE_MANIFEST_TYPE,
      manifestVersion: 1,
      releaseId,
      generatedAt: manifestInput.generatedAt || new Date().toISOString(),
      minShellVersion: manifestInput.minShellVersion || '',
      package: {
        fileName: packageFileName,
        packagePath: packageFileName,
        sizeBytes: fs.statSync(packagePath).size,
        sha256: hashFileSha256(packagePath),
      },
      archives: archiveEntries,
    };
    const manifest = privateKey ? signDataReleaseManifest(unsignedManifest, privateKey, keyId) : unsignedManifest;
    validateReferenceArchiveReleaseManifest(manifest, { publicKey: privateKey ? crypto.createPublicKey(privateKey) : undefined });
    const manifestPath = path.join(outputDir, 'reference-archive-manifest.json');
    writeJsonAtomically(manifestPath, manifest);
    return { outputDir, packagePath, manifestPath, manifest };
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function createDataManagementService({ runtimeDataRoot, builtinCatalogPath, localDataDirectory, shareDataDirectory, shellVersion = '', publicKey, requireSignature = Boolean(publicKey) }) {
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
    localDataDirectory: localDataDirectory ? path.resolve(localDataDirectory) : path.join(root, 'localdata'),
    shareDataDirectory: shareDataDirectory ? path.resolve(shareDataDirectory) : path.join(root, 'sharedata'),
    localArchiveDirectory: path.join(root, 'timeline-archives', 'local'),
    sharedArchiveDirectory: path.join(root, 'timeline-archives', 'shared'),
    legacyLocalArchiveDirectory: path.join(root, 'localdata', 'timeline-archives'),
    referenceArchiveRoot: path.join(root, 'reference-archives'),
    referenceArchiveVersionsDirectory: path.join(root, 'reference-archives', 'versions'),
    referenceArchiveActivePath: path.join(root, 'reference-archives', 'active.json'),
    referenceArchiveOutboxDirectory: path.join(root, 'reference-archive-outbox'),
    stagingDirectory: path.join(root, 'staging'),
  };

  function ensureLayout() {
    [
      paths.catalogRoot,
      path.dirname(paths.builtinCatalogPath),
      paths.versionsDirectory,
      paths.userDirectory,
      paths.backupDirectory,
      paths.localDataDirectory,
      paths.shareDataDirectory,
      paths.localArchiveDirectory,
      paths.sharedArchiveDirectory,
      paths.referenceArchiveRoot,
      paths.referenceArchiveVersionsDirectory,
      paths.referenceArchiveOutboxDirectory,
      paths.stagingDirectory,
    ]
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

  function timelineArchiveFilePath(directory, archiveId) {
    const safeId = sanitizeArchiveId(archiveId);
    if (safeId !== archiveId) throw dataManagementError('invalid-timeline-archive-id', '排轴存档 ID 无效。');
    return path.join(directory, `${safeId}.json`);
  }

  function writeTimelineArchive(directory, archive) {
    const checked = normalizeTimelineArchive(archive, { expectedSource: archive.source });
    const filePath = timelineArchiveFilePath(directory, checked.archiveId);
    if (fs.existsSync(filePath)) {
      throw dataManagementError('timeline-archive-already-exists', `排轴存档已存在：${checked.archiveId}`);
    }
    writeJsonAtomically(filePath, checked);
    return { filePath, archive: checked };
  }

  function readTimelineArchiveFile(filePath, options) {
    if (!fs.existsSync(filePath)) throw dataManagementError('timeline-archive-not-found', '排轴存档不存在。');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      throw dataManagementError('invalid-timeline-archive', '排轴存档无法解析。');
    }
    return normalizeTimelineArchive(raw, options);
  }

  function archiveSummary(archive, extra = {}) {
    return {
      archiveId: archive.archiveId,
      label: archive.label,
      source: archive.source,
      archiveVersion: archive.archiveVersion,
      createdAt: archive.createdAt,
      payloadHash: archive.payloadHash,
      summary: summarizeTimelinePayload(archive.payload),
      nodeCount: archive.worktree?.nodeCount || 0,
      hasCurrentNode: Boolean(archive.worktree?.currentNodeId),
      ...(archive.worktreeDiagnostic ? { worktreeDiagnostic: archive.worktreeDiagnostic } : {}),
      ...(archive.reference ? { reference: archive.reference } : {}),
      ...extra,
    };
  }

  function listTimelineArchivesFromDirectory(directory, { expectedSource, library }) {
    ensureLayout();
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const archiveId = path.basename(entry.name, '.json');
        try {
          return archiveSummary(readTimelineArchiveFile(path.join(directory, entry.name), {
            expectedSource,
            allowInvalidWorktree: true,
          }), { fileName: entry.name, library });
        } catch (error) {
          return {
            archiveId,
            label: archiveId,
            source: expectedSource,
            library,
            archiveVersion: 0,
            createdAt: '',
            summary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
            nodeCount: 0,
            hasCurrentNode: false,
            invalid: { code: error?.code || 'invalid-timeline-archive', message: error instanceof Error ? error.message : String(error) },
            fileName: entry.name,
          };
        }
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.archiveId.localeCompare(right.archiveId));
  }

  function listLocalTimelineArchives() {
    return listTimelineArchivesFromDirectory(paths.localArchiveDirectory, {
      expectedSource: 'local',
      library: 'local',
    });
  }

  function listSharedTimelineArchives() {
    return listTimelineArchivesFromDirectory(paths.sharedArchiveDirectory, {
      expectedSource: 'shared',
      library: 'shared',
    });
  }

  function listPendingReferenceTimelineArchives() {
    // A pending archive has the same portable wire shape as a reference
    // archive, but it has not been published or provenance-verified yet.
    // Keep the library identity separate from archive.source so UI callers
    // cannot accidentally present it as a downloaded reference.
    return listTimelineArchivesFromDirectory(paths.referenceArchiveOutboxDirectory, {
      expectedSource: 'reference',
      library: 'pending-reference',
    });
  }

  function readActiveReferenceArchiveRelease() {
    ensureLayout();
    const active = readJsonIfExists(paths.referenceArchiveActivePath);
    if (!active?.releaseId) return null;
    const releaseId = sanitizeVersion(active.releaseId);
    const directory = path.join(paths.referenceArchiveVersionsDirectory, releaseId);
    const dataManifest = readJsonIfExists(path.join(directory, 'data-release-manifest.json'));
    if (dataManifest) {
      const manifest = validateDataReleaseManifest(dataManifest, { shellVersion, publicKey, requireSignature });
      return { releaseId, directory, manifest, activatedAt: active.activatedAt || null, source: 'data-release' };
    }
    // Keep releases created by the previous, split-package implementation
    // readable while new releases use the unified data package above.
    const legacyManifest = readJsonIfExists(path.join(directory, 'reference-archive-manifest.json'));
    if (!legacyManifest) return null;
    const manifest = validateReferenceArchiveReleaseManifest(legacyManifest, { shellVersion, publicKey, requireSignature });
    return { releaseId, directory, manifest, activatedAt: active.activatedAt || null, source: 'legacy-reference-release' };
  }

  function listReferenceTimelineArchives() {
    const active = readActiveReferenceArchiveRelease();
    if (!active) return [];
    const archives = Array.isArray(active.manifest.referenceArchives)
      ? active.manifest.referenceArchives
      : (Array.isArray(active.manifest.archives) ? active.manifest.archives : []);
    return archives.map((entry) => {
      const archiveId = entry?.archiveId;
      if (typeof archiveId !== 'string') return null;
      try {
        const archive = readTimelineArchiveFile(timelineArchiveFilePath(path.join(active.directory, 'archives'), archiveId), {
          expectedSource: 'reference',
          allowInvalidWorktree: true,
        });
        return archiveSummary({
          ...archive,
          reference: { releaseId: active.releaseId, packageHash: active.manifest.package.sha256, downloadedAt: active.activatedAt || undefined },
        }, { releaseId: active.releaseId, library: 'reference' });
      } catch (error) {
        return {
          archiveId,
          label: typeof entry?.label === 'string' ? entry.label : archiveId,
          source: 'reference',
          library: 'reference',
          archiveVersion: Number(entry?.archiveVersion) || 0,
          createdAt: '',
          summary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
          nodeCount: Number(entry?.nodeCount) || 0,
          hasCurrentNode: Boolean(entry?.hasCurrentNode),
          releaseId: active.releaseId,
          invalid: { code: error?.code || 'invalid-reference-timeline-archive', message: error instanceof Error ? error.message : String(error) },
        };
      }
    }).filter(Boolean);
  }

  function getTimelineArchive({ source, archiveId, allowInvalidWorktree = false } = {}) {
    if (!['local', 'shared', 'pending-reference', 'reference'].includes(source)) throw dataManagementError('invalid-timeline-archive-source', '存档来源无效。');
    if (typeof archiveId !== 'string' || sanitizeArchiveId(archiveId) !== archiveId) {
      throw dataManagementError('invalid-timeline-archive-id', '排轴存档 ID 无效。');
    }
    if (source === 'local') {
      return readTimelineArchiveFile(timelineArchiveFilePath(paths.localArchiveDirectory, archiveId), {
        expectedSource: 'local',
        allowInvalidWorktree,
      });
    }
    if (source === 'shared') {
      return readTimelineArchiveFile(timelineArchiveFilePath(paths.sharedArchiveDirectory, archiveId), {
        expectedSource: 'shared',
        allowInvalidWorktree,
      });
    }
    if (source === 'pending-reference') {
      return readTimelineArchiveFile(timelineArchiveFilePath(paths.referenceArchiveOutboxDirectory, archiveId), {
        expectedSource: 'reference',
        allowInvalidWorktree,
      });
    }
    const active = readActiveReferenceArchiveRelease();
    if (!active) throw dataManagementError('reference-timeline-archive-not-found', '当前没有已登记的参考存档发布包。');
    const archive = readTimelineArchiveFile(timelineArchiveFilePath(path.join(active.directory, 'archives'), archiveId), {
      expectedSource: 'reference',
      allowInvalidWorktree,
    });
    return {
      ...archive,
      reference: { releaseId: active.releaseId, packageHash: active.manifest.package.sha256, downloadedAt: active.activatedAt || undefined },
    };
  }

  function getMutableTimelineArchiveLibrary(library) {
    if (library === 'local') {
      return { directory: paths.localArchiveDirectory, expectedSource: 'local' };
    }
    if (library === 'pending-reference') {
      return { directory: paths.referenceArchiveOutboxDirectory, expectedSource: 'reference' };
    }
    if (library === 'shared') {
      return { directory: paths.sharedArchiveDirectory, expectedSource: 'shared' };
    }
    throw dataManagementError('timeline-archive-library-readonly', '联网下载的参考存档为只读内容，不能在本机删除或转换。');
  }

  function deleteTimelineArchive({ library, archiveId } = {}) {
    if (typeof archiveId !== 'string' || sanitizeArchiveId(archiveId) !== archiveId) {
      throw dataManagementError('invalid-timeline-archive-id', '排轴存档 ID 无效。');
    }
    const target = getMutableTimelineArchiveLibrary(library);
    const filePath = timelineArchiveFilePath(target.directory, archiveId);
    if (!fs.existsSync(filePath)) {
      throw dataManagementError('timeline-archive-not-found', '排轴存档不存在。', { library, archiveId });
    }
    // Do not parse before deletion: this also gives users a recovery path for
    // malformed local/pending files surfaced by the library as invalid.
    fs.rmSync(filePath, { force: false });
    return { library, archiveId, deleted: true };
  }

  function transferTimelineArchive({ from, to, archiveId } = {}) {
    if (!['local', 'shared', 'pending-reference'].includes(from) || !['local', 'shared', 'pending-reference'].includes(to)) {
      throw dataManagementError('invalid-timeline-archive-transfer', '只能在本地存档与共享存档之间转换。');
    }
    if (from === to) throw dataManagementError('invalid-timeline-archive-transfer', '存档转换的来源和目标不能相同。');
    if (typeof archiveId !== 'string' || sanitizeArchiveId(archiveId) !== archiveId) {
      throw dataManagementError('invalid-timeline-archive-id', '排轴存档 ID 无效。');
    }
    const sourceLibrary = getMutableTimelineArchiveLibrary(from);
    const destinationLibrary = getMutableTimelineArchiveLibrary(to);
    const sourcePath = timelineArchiveFilePath(sourceLibrary.directory, archiveId);
    const destinationPath = timelineArchiveFilePath(destinationLibrary.directory, archiveId);
    const sourceArchive = readTimelineArchiveFile(sourcePath, { expectedSource: sourceLibrary.expectedSource });
    const converted = cloneJson(sourceArchive);
    converted.source = destinationLibrary.expectedSource;
    // Locally exported pending archives must not gain fake published
    // provenance, and local archives must never retain reference provenance.
    delete converted.reference;
    const checked = normalizeTimelineArchive(converted, { expectedSource: destinationLibrary.expectedSource });
    if (fs.existsSync(destinationPath)) {
      const existing = readTimelineArchiveFile(destinationPath, { expectedSource: destinationLibrary.expectedSource });
      if (stableJson(existing) !== stableJson(checked)) {
        throw dataManagementError('timeline-archive-transfer-collision', '目标存档库已有相同 ID 但内容不同的存档，拒绝覆盖。', { from, to, archiveId });
      }
    } else {
      writeJsonAtomically(destinationPath, checked);
    }
    // Write/validate the destination first. A failure to remove the origin
    // leaves a recoverable duplicate instead of losing the only copy.
    fs.rmSync(sourcePath, { force: false });
    return { from, to, archive: archiveSummary(checked, { library: to }), moved: true };
  }

  function installReferenceArchiveRelease({ manifest, archivePath, manifestUrl = '' } = {}) {
    const checkedManifest = validateReferenceArchiveReleaseManifest(manifest, {
      shellVersion,
      publicKey,
      requireSignature,
    });
    if (!archivePath || !fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
      throw dataManagementError('reference-archive-package-not-found', '参考存档发布包不存在。');
    }
    const resolvedArchivePath = path.resolve(archivePath);
    const actualSize = fs.statSync(resolvedArchivePath).size;
    if (actualSize !== checkedManifest.package.sizeBytes) {
      throw dataManagementError('reference-archive-package-size-mismatch', '参考存档发布包大小校验失败。', {
        expected: checkedManifest.package.sizeBytes,
        actual: actualSize,
      });
    }
    const actualHash = hashFileSha256(resolvedArchivePath);
    if (actualHash !== checkedManifest.package.sha256) {
      throw dataManagementError('reference-archive-package-sha256-mismatch', '参考存档发布包哈希校验失败。', {
        expected: checkedManifest.package.sha256,
        actual: actualHash,
      });
    }
    assertSafeReferenceArchivePackage(resolvedArchivePath, checkedManifest.archives.map((entry) => entry.archiveId));
    ensureLayout();
    const releaseDirectory = path.join(paths.referenceArchiveVersionsDirectory, checkedManifest.releaseId);
    if (fs.existsSync(releaseDirectory)) {
      const installedManifest = readJsonIfExists(path.join(releaseDirectory, 'reference-archive-manifest.json'));
      if (installedManifest?.package?.sha256 !== checkedManifest.package.sha256) {
        throw dataManagementError('reference-archive-release-collision', '同一参考存档发布版本已存在且内容不同。', { releaseId: checkedManifest.releaseId });
      }
      writeJsonAtomically(paths.referenceArchiveActivePath, {
        releaseId: checkedManifest.releaseId,
        activatedAt: new Date().toISOString(),
        manifestUrl,
      });
      return { installed: false, reused: true, active: readActiveReferenceArchiveRelease() };
    }
    const staging = fs.mkdtempSync(path.join(paths.stagingDirectory, `reference-archives-${checkedManifest.releaseId}-`));
    try {
      extractZipArchive(resolvedArchivePath, staging);
      const embedded = readJsonIfExists(path.join(staging, 'manifest.json'));
      if (!embedded || embedded.type !== REFERENCE_ARCHIVE_PACKAGE_MANIFEST_TYPE || embedded.schemaVersion !== 1
        || embedded.releaseId !== checkedManifest.releaseId || !Array.isArray(embedded.archives)) {
        throw dataManagementError('invalid-reference-archive-package-manifest', '参考存档发布包内部清单无效。');
      }
      const embeddedById = new Map(embedded.archives.map((entry) => [entry?.archiveId, entry]));
      for (const entry of checkedManifest.archives) {
        const inner = embeddedById.get(entry.archiveId);
        if (!inner || inner.label !== entry.label || inner.archiveVersion !== entry.archiveVersion
          || inner.payloadHash !== entry.payloadHash || inner.nodeCount !== entry.nodeCount || Boolean(inner.hasCurrentNode) !== entry.hasCurrentNode) {
          throw dataManagementError('reference-archive-package-manifest-mismatch', `参考存档发布包清单与外部清单不匹配：${entry.archiveId}`);
        }
        const archive = readTimelineArchiveFile(path.join(staging, 'archives', `${entry.archiveId}.json`), { expectedSource: 'reference' });
        if (archive.payloadHash !== entry.payloadHash || (archive.worktree?.nodeCount || 0) !== entry.nodeCount
          || Boolean(archive.worktree?.currentNodeId) !== entry.hasCurrentNode) {
          throw dataManagementError('reference-archive-package-entry-mismatch', `参考存档发布包内容与清单不匹配：${entry.archiveId}`);
        }
        // The publish artifact deliberately contains no machine-local release
        // metadata. Persist the verified provenance only after all package
        // checks succeed, so a reference archive can never masquerade as a
        // locally exported pending archive.
        writeJsonAtomically(path.join(staging, 'archives', `${entry.archiveId}.json`), {
          ...archive,
          reference: {
            releaseId: checkedManifest.releaseId,
            packageHash: checkedManifest.package.sha256,
            downloadedAt: new Date().toISOString(),
          },
        });
      }
      writeJsonAtomically(path.join(staging, 'reference-archive-manifest.json'), checkedManifest);
      fs.renameSync(staging, releaseDirectory);
      writeJsonAtomically(paths.referenceArchiveActivePath, {
        releaseId: checkedManifest.releaseId,
        activatedAt: new Date().toISOString(),
        manifestUrl,
      });
      return { installed: true, reused: false, active: readActiveReferenceArchiveRelease() };
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  function writeTimelinePayloadBlob(db, payload, createdAt) {
    const serialized = JSON.stringify(payload);
    const payloadHash = `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`;
    db.prepare(`
      INSERT OR IGNORE INTO timeline_payload_blobs (content_hash, payload, created_at)
      VALUES (?, ?, ?)
    `).run(payloadHash, serialized, createdAt);
    return payloadHash;
  }

  function loadWorkspacePayload(db, timelineId) {
    const checkout = db.prepare('SELECT * FROM checkout_refs WHERE timeline_id = ?').get(timelineId);
    if (!checkout) throw dataManagementError('timeline-workspace-checkout-missing', 'SQLite 工作区没有当前 checkout。', { timelineId });
    let payloadHash = null;
    if (checkout.target_type === 'work-node') {
      payloadHash = db.prepare(`
        SELECT working_payload_hash AS payload_hash FROM timeline_work_nodes
        WHERE id = ? AND timeline_id = ?
      `).get(checkout.target_id, timelineId)?.payload_hash || null;
    } else if (checkout.target_type === 'snapshot') {
      // Existing databases retain Snapshot rows only as a compatibility
      // checkout target. New archive conversions always point to Work Nodes.
      payloadHash = db.prepare(`
        SELECT payload_hash FROM timeline_snapshots
        WHERE id = ? AND timeline_id = ? AND archived_at IS NULL
      `).get(checkout.target_id, timelineId)?.payload_hash || null;
    }
    if (!payloadHash) throw dataManagementError('timeline-workspace-checkout-target-not-found', 'SQLite 工作区当前 checkout 不存在。', { timelineId, checkout });
    const payload = db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(payloadHash)?.payload;
    if (!payload) throw dataManagementError('timeline-workspace-payload-not-found', 'SQLite 工作区当前 payload 不存在。', { timelineId, payloadHash });
    return {
      checkoutRef: { timelineId, targetType: checkout.target_type, targetId: checkout.target_id, updatedAt: checkout.updated_at },
      payloadHash,
      payload: JSON.parse(payload),
    };
  }

  function listSqliteWorkspaces() {
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      return db.prepare('SELECT * FROM timeline_documents WHERE archived_at IS NULL ORDER BY updated_at DESC').all().map((row) => {
        const timelineId = row.id;
        const nodeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM timeline_work_nodes WHERE timeline_id = ?').get(timelineId).count);
        try {
          const workspace = loadWorkspacePayload(db, timelineId);
          return {
            document: { id: timelineId, label: row.label, isTemporary: row.is_temporary === 1, createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at || null },
            checkoutRef: workspace.checkoutRef,
            summary: summarizeTimelinePayload(workspace.payload),
            nodeCount,
          };
        } catch (error) {
          return {
            document: { id: timelineId, label: row.label, isTemporary: row.is_temporary === 1, createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at || null },
            checkoutRef: null,
            summary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
            nodeCount,
            invalid: { code: error?.code || 'timeline-workspace-invalid', message: error instanceof Error ? error.message : String(error) },
          };
        }
      });
    } finally {
      db.close();
    }
  }

  function materializeLegacyTimelineSnapshotsAsLocalArchives() {
    ensureUserDatabase();
    ensureLayout();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    let snapshots;
    try {
      snapshots = db.prepare(`
        SELECT snapshot.id, snapshot.timeline_id, snapshot.label, snapshot.created_at, payload.payload
        FROM timeline_snapshots AS snapshot
        JOIN timeline_payload_blobs AS payload ON payload.content_hash = snapshot.payload_hash
        WHERE snapshot.archived_at IS NULL
        ORDER BY snapshot.created_at ASC, snapshot.id ASC
      `).all();
    } finally {
      db.close();
    }
    const result = { scanned: snapshots.length, created: 0, reused: 0, failed: [] };
    for (const snapshot of snapshots) {
      const identity = `${snapshot.timeline_id}\u0000${snapshot.id}`;
      const archiveId = `legacy-sqlite-${hashBufferSha256(Buffer.from(identity)).slice(0, 24)}`;
      try {
        const payload = JSON.parse(snapshot.payload);
        const archive = {
          type: TIMELINE_ARCHIVE_TYPE,
          archiveVersion: 1,
          source: 'local',
          archiveId,
          label: typeof snapshot.label === 'string' && snapshot.label.trim() ? snapshot.label.trim() : snapshot.id,
          createdAt: new Date(Number(snapshot.created_at) || Date.now()).toISOString(),
          payload,
        };
        const filePath = timelineArchiveFilePath(paths.localArchiveDirectory, archiveId);
        if (fs.existsSync(filePath)) {
          const existing = readTimelineArchiveFile(filePath, { expectedSource: 'local' });
          if (existing.payloadHash !== hashTimelinePayload(payload)) {
            throw dataManagementError('legacy-sqlite-snapshot-archive-collision', `历史 SQLite 快照迁移目标冲突：${snapshot.id}`);
          }
          result.reused += 1;
        } else {
          writeTimelineArchive(paths.localArchiveDirectory, archive);
          result.created += 1;
        }
      } catch (error) {
        result.failed.push({
          timelineId: snapshot.timeline_id,
          snapshotId: snapshot.id,
          code: error?.code || 'legacy-sqlite-snapshot-archive-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }

  function applySqliteWorkspace({ timelineId, updatedAt = Date.now() } = {}) {
    if (typeof timelineId !== 'string' || !timelineId.trim()) throw dataManagementError('invalid-timeline-workspace-id', 'SQLite 工作区 ID 无效。');
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      return transaction(db, () => {
        const document = db.prepare('SELECT id, label, is_temporary FROM timeline_documents WHERE id = ? AND archived_at IS NULL').get(timelineId);
        if (!document) throw dataManagementError('timeline-document-not-found', 'SQLite 工作区不存在。', { timelineId });
        const workspace = loadWorkspacePayload(db, timelineId);
        const values = workspaceValuesFromTimelinePayload(workspace.payload);
        db.prepare(`
          INSERT INTO user_workspace_state (id, payload, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `).run(WORKSPACE_STATE_ID, JSON.stringify({ schemaVersion: 1, values }), updatedAt);
        projectWorkspaceState(db, values, updatedAt);
        db.prepare(`
          INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_type, subject_id, details, created_at)
          VALUES (?, ?, 'workspace.applied', 'checkout', ?, ?, ?)
        `).run(
          `workspace-apply-${timelineId}-${updatedAt}-${crypto.randomBytes(4).toString('hex')}`,
          timelineId,
          workspace.checkoutRef.targetId,
          JSON.stringify({ targetType: workspace.checkoutRef.targetType, workspaceState: true }),
          updatedAt,
        );
        return { document: { id: document.id, label: document.label, isTemporary: document.is_temporary === 1 }, payload: workspace.payload, checkoutRef: workspace.checkoutRef, workspace: { values, updatedAt } };
      });
    } finally {
      db.close();
    }
  }

  function deleteSqliteWorkspace({ timelineId } = {}) {
    if (typeof timelineId !== 'string' || !timelineId.trim()) {
      throw dataManagementError('invalid-timeline-workspace-id', 'SQLite 工作区 ID 无效。');
    }
    ensureUserDatabase();
    const repository = createTimelineRepository({ databasePath: paths.userDatabasePath });
    try {
      // This deliberately removes only the selected TimelineDocument graph.
      // user_workspace_state and the archive libraries are independent stores,
      // so deleting a SQLite workspace never deletes a local or pending archive.
      const result = repository.deleteDocument(timelineId);
      const db = new DatabaseSync(paths.userDatabasePath);
      try {
        // Catalog references live in the same user database but deliberately
        // have no FK to keep catalog history diagnosable. Once the owning
        // document is explicitly deleted, its projection must go as well.
        db.prepare(`DELETE FROM user_catalog_references WHERE owner_type = 'timeline-document' AND owner_id = ?`).run(timelineId);
      } finally {
        db.close();
      }
      return result;
    } finally {
      repository.close();
    }
  }

  function exportSqliteWorkspaceArchive({ timelineId, kind = 'local', label } = {}) {
    // `reference` remains an internal compatibility path for old release
    // tooling. Product callers only expose local/shared.
    if (!['local', 'shared', 'reference'].includes(kind)) throw dataManagementError('invalid-timeline-archive-source', '导出存档来源无效。');
    if (typeof timelineId !== 'string' || !timelineId.trim()) throw dataManagementError('invalid-timeline-workspace-id', 'SQLite 工作区 ID 无效。');
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath, { readOnly: true });
    try {
      const document = db.prepare('SELECT * FROM timeline_documents WHERE id = ? AND archived_at IS NULL').get(timelineId);
      if (!document) throw dataManagementError('timeline-document-not-found', 'SQLite 工作区不存在。', { timelineId });
      const current = loadWorkspacePayload(db, timelineId);
      const workNodes = db.prepare('SELECT * FROM timeline_work_nodes WHERE timeline_id = ? ORDER BY created_at ASC').all(timelineId).map((node) => ({
        id: node.id,
        ...(node.parent_id ? { parentNodeId: node.parent_id } : {}),
        branchId: node.branch_id,
        label: node.label,
        description: node.description || '',
        status: node.status,
        approvalPolicy: node.approval_policy,
        riskFlags: JSON.parse(node.risk_flags),
        logs: JSON.parse(node.logs),
        createdAt: node.created_at,
        updatedAt: node.updated_at,
        contentRevision: node.content_revision,
        basePayload: JSON.parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(node.base_payload_hash)?.payload || '{}'),
        workingPayload: JSON.parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(node.working_payload_hash)?.payload || '{}'),
      }));
      const root = workNodes.find((node) => !node.parentNodeId);
      const archiveId = `${sanitizeArchiveId(timelineId, 'workspace')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const archive = {
        type: TIMELINE_ARCHIVE_TYPE,
        archiveVersion: 1,
        source: kind,
        archiveId,
        label: typeof label === 'string' && label.trim() ? label.trim() : document.label,
        createdAt: new Date().toISOString(),
        payload: current.payload,
        ...(workNodes.length ? {
          worktree: {
            nodes: workNodes,
            ...(current.checkoutRef.targetType === 'work-node' ? { currentNodeId: current.checkoutRef.targetId } : {}),
            rootPayloadHash: root ? hashTimelinePayload(root.basePayload) : hashTimelinePayload(current.payload),
            currentPayloadHash: current.payloadHash,
            nodeCount: workNodes.length,
          },
        } : {}),
      };
      const outputDirectory = kind === 'local'
        ? paths.localArchiveDirectory
        : (kind === 'shared' ? paths.sharedArchiveDirectory : paths.referenceArchiveOutboxDirectory);
      const written = writeTimelineArchive(outputDirectory, archive);
      return {
        kind,
        outbox: kind === 'shared' || kind === 'reference',
        filePath: written.filePath,
        archive: archiveSummary(written.archive, { library: kind === 'reference' ? 'pending-reference' : kind }),
      };
    } finally {
      db.close();
    }
  }

  function importLegacyTimelineBundleArchive({ bundle, sourceName = 'timeline-bundle.v2.json' } = {}) {
    if (!bundle || typeof bundle !== 'object' || bundle.type !== 'dmg.timeline-bundle.v2' || bundle.schemaVersion !== 2) {
      throw dataManagementError('invalid-legacy-timeline-bundle', '旧 Timeline Bundle 类型或版本无效。');
    }
    if (!Array.isArray(bundle.payloads) || !Array.isArray(bundle.snapshots) || !bundle.manifest || typeof bundle.manifest !== 'object') {
      throw dataManagementError('invalid-legacy-timeline-bundle', '旧 Timeline Bundle 缺少 payload、快照或清单。');
    }
    const payloadAt = (index, label) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= bundle.payloads.length || !bundle.payloads[index] || typeof bundle.payloads[index] !== 'object') {
        throw dataManagementError('invalid-legacy-timeline-bundle-payload', `旧 Timeline Bundle ${label} 引用了无效 payload。`);
      }
      return cloneJson(bundle.payloads[index]);
    };
    const snapshotById = new Map();
    for (const snapshot of bundle.snapshots) {
      if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id.trim()) {
        throw dataManagementError('invalid-legacy-timeline-bundle-snapshot', '旧 Timeline Bundle 含无效快照。');
      }
      snapshotById.set(snapshot.id, snapshot);
    }
    const nodes = Array.isArray(bundle.workNodes) ? bundle.workNodes.map((node, index) => ({
      id: typeof node?.id === 'string' ? node.id : '',
      ...(typeof node?.parentNodeId === 'string' && node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
      branchId: typeof node?.branchId === 'string' ? node.branchId : `legacy-${index + 1}`,
      label: typeof node?.label === 'string' ? node.label : `旧节点 ${index + 1}`,
      description: typeof node?.description === 'string' ? node.description : '',
      status: WORK_NODE_STATUS_VALUES.has(node?.status) ? node.status : 'ready',
      approvalPolicy: typeof node?.approvalPolicy === 'string' ? node.approvalPolicy : 'manual',
      riskFlags: Array.isArray(node?.riskFlags) ? node.riskFlags : [],
      logs: Array.isArray(node?.logs) ? node.logs : [],
      createdAt: Number.isFinite(Number(node?.createdAt)) ? Number(node.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(node?.updatedAt)) ? Number(node.updatedAt) : Date.now(),
      basePayload: payloadAt(node?.basePayloadIndex, `节点 ${index + 1} base`),
      workingPayload: payloadAt(node?.workingPayloadIndex, `节点 ${index + 1} working`),
    })) : [];
    const checkout = bundle.checkoutRef && typeof bundle.checkoutRef === 'object' ? bundle.checkoutRef : null;
    let payload = null;
    if (checkout?.targetType === 'work-node') {
      const current = nodes.find((node) => node.id === checkout.targetId);
      if (!current) throw dataManagementError('legacy-timeline-bundle-checkout-not-found', '旧 Timeline Bundle 当前节点不存在。');
      payload = current.workingPayload;
    } else if (checkout?.targetType === 'snapshot') {
      const snapshot = snapshotById.get(checkout.targetId);
      if (!snapshot) throw dataManagementError('legacy-timeline-bundle-checkout-not-found', '旧 Timeline Bundle 当前快照不存在。');
      payload = payloadAt(snapshot.payloadIndex, '当前快照');
    } else if (bundle.snapshots[0]) {
      payload = payloadAt(bundle.snapshots[0].payloadIndex, '首个快照');
    } else if (nodes[0]) {
      payload = nodes[0].workingPayload;
    }
    if (!payload) throw dataManagementError('invalid-legacy-timeline-bundle', '旧 Timeline Bundle 没有可转换的排轴内容。');
    const contentHash = hashBufferSha256(Buffer.from(JSON.stringify(bundle)));
    const archive = {
      type: TIMELINE_ARCHIVE_TYPE,
      archiveVersion: 1,
      source: 'local',
      archiveId: `legacy-bundle-${contentHash.slice(0, 24)}`,
      label: typeof bundle.manifest.label === 'string' && bundle.manifest.label.trim() ? bundle.manifest.label.trim() : path.basename(sourceName),
      createdAt: new Date(Number(bundle.manifest.exportedAt) || Date.now()).toISOString(),
      payload,
      ...(nodes.length ? {
        worktree: {
          nodes,
          ...(checkout?.targetType === 'work-node' ? { currentNodeId: checkout.targetId } : {}),
          rootPayloadHash: hashTimelinePayload(nodes.find((node) => !node.parentNodeId)?.basePayload || payload),
          currentPayloadHash: hashTimelinePayload(payload),
          nodeCount: nodes.length,
        },
      } : {}),
    };
    const filePath = timelineArchiveFilePath(paths.localArchiveDirectory, archive.archiveId);
    if (fs.existsSync(filePath)) {
      const existing = readTimelineArchiveFile(filePath, { expectedSource: 'local' });
      if (existing.payloadHash !== hashTimelinePayload(payload)) {
        throw dataManagementError('legacy-timeline-bundle-archive-collision', '旧 Timeline Bundle 已有同 ID 且内容不同的本地存档。');
      }
      return { imported: false, reused: true, archive: archiveSummary(existing, { library: 'local' }) };
    }
    return { imported: true, reused: false, archive: archiveSummary(writeTimelineArchive(paths.localArchiveDirectory, archive).archive, { library: 'local' }) };
  }

  function convertTimelineArchiveToWorkspace({ source, archiveId, payloadOnly = false, label, updatedAt = Date.now() } = {}) {
    const archive = getTimelineArchive({ source, archiveId, allowInvalidWorktree: payloadOnly });
    ensureUserDatabase();
    const db = new DatabaseSync(paths.userDatabasePath);
    try {
      return transaction(db, () => {
        const timelineId = `archive-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
        const documentLabel = typeof label === 'string' && label.trim() ? label.trim() : archive.label;
        const rootId = `${timelineId}-import-root`;
        const sourceRoots = archive.worktree?.nodes.filter((node) => !node.parentNodeId) || [];
        const rootBasePayload = sourceRoots[0]?.basePayload || archive.payload;
        const rootBaseHash = writeTimelinePayloadBlob(db, rootBasePayload, updatedAt);
        const rootWorkingHash = writeTimelinePayloadBlob(db, archive.payload, updatedAt);
        db.prepare(`
          INSERT INTO timeline_documents (id, label, created_at, updated_at, archived_at)
          VALUES (?, ?, ?, ?, NULL)
        `).run(timelineId, documentLabel, updatedAt, updatedAt);
        db.prepare(`
          INSERT INTO timeline_work_nodes (
            id, timeline_id, parent_id, base_payload_hash, working_payload_hash, branch_id, label,
            description, status, approval_policy, risk_flags, logs, created_at, updated_at, content_revision
          ) VALUES (?, ?, NULL, ?, ?, 'archive-import', ?, ?, 'ready', 'manual', '[]', '[]', ?, ?, ?)
        `).run(
          rootId,
          timelineId,
          rootBaseHash,
          rootWorkingHash,
          `[archive-import] ${archive.label}`,
          `由${source === 'reference' ? '联网参考存档' : source === 'pending-reference' ? '待发布参考存档' : '本地存档'}“${archive.archiveId}”转换。`,
          updatedAt,
          updatedAt,
          updatedAt,
        );
        const importedNodeIds = new Map();
        let currentTargetId = rootId;
        let compatibility = archive.worktreeDiagnostic ? [archive.worktreeDiagnostic] : [];
        if (archive.worktree && !payloadOnly) {
          archive.worktree.nodes.forEach((node, index) => {
            importedNodeIds.set(node.id, `${timelineId}-archive-node-${index + 1}-${crypto.createHash('sha256').update(node.id).digest('hex').slice(0, 10)}`);
          });
          const pending = [...archive.worktree.nodes];
          while (pending.length) {
            const index = pending.findIndex((node) => !node.parentNodeId || importedNodeIds.has(node.parentNodeId) && !pending.some((candidate) => candidate.id === node.parentNodeId));
            if (index < 0) throw dataManagementError('cyclic-timeline-archive-worktree', '排轴存档节点树无法按父子关系导入。');
            const node = pending.splice(index, 1)[0];
            const parentId = node.parentNodeId ? importedNodeIds.get(node.parentNodeId) : rootId;
            db.prepare(`
              INSERT INTO timeline_work_nodes (
                id, timeline_id, parent_id, base_payload_hash, working_payload_hash, branch_id, label,
                description, status, approval_policy, risk_flags, logs, created_at, updated_at, content_revision
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              importedNodeIds.get(node.id),
              timelineId,
              parentId,
              writeTimelinePayloadBlob(db, node.basePayload, node.createdAt),
              writeTimelinePayloadBlob(db, node.workingPayload, node.updatedAt),
              node.branchId,
              node.label,
              node.description,
              node.status,
              node.approvalPolicy,
              JSON.stringify(node.riskFlags),
              JSON.stringify(node.logs),
              node.createdAt,
              node.updatedAt,
              node.contentRevision || node.updatedAt,
            );
          }
          const currentNode = archive.worktree.currentNodeId
            ? archive.worktree.nodes.find((node) => node.id === archive.worktree.currentNodeId)
            : null;
          if (currentNode && hashTimelinePayload(currentNode.workingPayload) === archive.payloadHash) {
            currentTargetId = importedNodeIds.get(currentNode.id);
          } else if (archive.worktree.currentNodeId) {
            compatibility.push({ code: 'timeline-archive-current-node-payload-mismatch', message: '存档当前节点与当前排轴内容不一致，已回退到导入根。' });
          }
        } else if (payloadOnly && archive.worktree) {
          compatibility.push({ code: 'timeline-archive-payload-only-import', message: '已按用户选择仅转换排轴内容，未导入节点树。' });
        }
        db.prepare(`
          INSERT INTO checkout_refs (timeline_id, target_type, target_id, updated_at)
          VALUES (?, 'work-node', ?, ?)
        `).run(timelineId, currentTargetId, updatedAt);
        const values = workspaceValuesFromTimelinePayload(archive.payload);
        db.prepare(`
          INSERT INTO user_workspace_state (id, payload, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        `).run(WORKSPACE_STATE_ID, JSON.stringify({ schemaVersion: 1, values }), updatedAt);
        projectWorkspaceState(db, values, updatedAt);
        db.prepare(`
          INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_type, subject_id, details, created_at)
          VALUES (?, ?, 'archive.converted', 'work-node', ?, ?, ?)
        `).run(
          `archive-convert-${archive.archiveId}-${updatedAt}-${crypto.randomBytes(4).toString('hex')}`,
          timelineId,
          rootId,
          JSON.stringify({ archiveId: archive.archiveId, source, payloadOnly, importedNodeCount: importedNodeIds.size, compatibility }),
          updatedAt,
        );
        return {
          document: { id: timelineId, label: documentLabel },
          rootNodeId: rootId,
          checkoutRef: { timelineId, targetType: 'work-node', targetId: currentTargetId, updatedAt },
          payload: archive.payload,
          importedNodeCount: importedNodeIds.size,
          totalNodeCount: importedNodeIds.size + 1,
          compatibility,
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

  function activateUnifiedDataRelease(dataVersion, manifestUrl = '') {
    const version = sanitizeVersion(dataVersion);
    const referenceDirectory = path.join(paths.referenceArchiveVersionsDirectory, version);
    let referenceManifest = readJsonIfExists(path.join(referenceDirectory, 'data-release-manifest.json'));
    if (!referenceManifest) {
      // Catalog-only packages created before the unified release format remain
      // valid. When such a version is selected, materialize an empty reference
      // index from its already verified catalog manifest instead of making
      // rollback impossible.
      const catalogManifest = readJsonIfExists(resolveCatalog(version).manifestPath);
      if (!catalogManifest) {
        throw dataManagementError('data-release-reference-archives-missing', '数据发布包的参考存档索引不存在。', { dataVersion: version });
      }
      const checkedCatalogManifest = validateDataReleaseManifest(catalogManifest, { shellVersion, publicKey, requireSignature });
      if (checkedCatalogManifest.referenceArchives.length) {
        throw dataManagementError('data-release-reference-archives-missing', '数据发布包的参考存档索引不完整。', { dataVersion: version });
      }
      fs.mkdirSync(referenceDirectory, { recursive: true });
      writeJsonAtomically(path.join(referenceDirectory, 'data-release-manifest.json'), catalogManifest);
      referenceManifest = catalogManifest;
    }
    const checkedManifest = validateDataReleaseManifest(referenceManifest, { shellVersion, publicKey, requireSignature });
    if (checkedManifest.dataVersion !== version) {
      throw dataManagementError('data-release-reference-archives-version-mismatch', '数据发布包的参考存档索引版本不一致。', { dataVersion: version });
    }
    writeJsonAtomically(paths.referenceArchiveActivePath, {
      releaseId: version,
      activatedAt: new Date().toISOString(),
      manifestUrl,
      source: 'data-release',
    });
    return activateVersion(version, manifestUrl);
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
    const referenceTargetDirectory = path.join(paths.referenceArchiveVersionsDirectory, checkedManifest.dataVersion);
    let catalogAlreadyInstalled = false;
    let referenceAlreadyInstalled = false;
    if (fs.existsSync(target.directory)) {
      const installedManifest = readJsonIfExists(target.manifestPath);
      if (installedManifest?.catalog?.sha256 === checkedManifest.catalog.sha256 && installedManifest?.package?.sha256 === checkedManifest.package.sha256) {
        catalogAlreadyInstalled = true;
      } else {
        throw dataManagementError('data-release-version-collision', `已安装的数据版本 ${checkedManifest.dataVersion} 与发布包内容不一致。`);
      }
    }
    if (fs.existsSync(referenceTargetDirectory)) {
      const installedReferenceManifest = readJsonIfExists(path.join(referenceTargetDirectory, 'data-release-manifest.json'));
      if (installedReferenceManifest?.package?.sha256 === checkedManifest.package.sha256) {
        referenceAlreadyInstalled = true;
      } else {
        throw dataManagementError('data-release-reference-archive-version-collision', `已安装的数据版本 ${checkedManifest.dataVersion} 的参考存档内容不一致。`);
      }
    }
    const staging = fs.mkdtempSync(path.join(paths.stagingDirectory, `${checkedManifest.dataVersion}-`));
    const referenceStaging = fs.mkdtempSync(path.join(paths.stagingDirectory, `reference-${checkedManifest.dataVersion}-`));
    try {
      extractDataReleaseArchive(archivePath, staging, checkedManifest.referenceArchives);
      const packageManifest = readJsonIfExists(path.join(staging, 'manifest.json'));
      if (!packageManifest || packageManifest.type !== CATALOG_PACKAGE_MANIFEST_TYPE || packageManifest.dataVersion !== checkedManifest.dataVersion
        || packageManifest.catalog?.sha256 !== checkedManifest.catalog.sha256 || packageManifest.catalog?.schemaVersion !== checkedManifest.catalogSchemaVersion
        || stableJson(packageManifest.referenceArchives || []) !== stableJson(checkedManifest.referenceArchives)) {
        throw dataManagementError('data-release-inner-manifest-mismatch', '数据发布包内部 manifest 与外部清单不一致。');
      }
      validateCatalogDatabase({ databasePath: path.join(staging, 'catalog.sqlite'), expectedDataVersion: checkedManifest.dataVersion, expectedSha256: checkedManifest.catalog.sha256, expectedSchemaVersion: checkedManifest.catalogSchemaVersion });
      for (const entry of checkedManifest.referenceArchives) {
        const archive = readTimelineArchiveFile(path.join(staging, 'archives', `${entry.archiveId}.json`), { expectedSource: 'reference' });
        if (archive.payloadHash !== entry.payloadHash || archive.label !== entry.label || archive.archiveVersion !== entry.archiveVersion
          || (archive.worktree?.nodeCount || 0) !== entry.nodeCount || Boolean(archive.worktree?.currentNodeId) !== entry.hasCurrentNode) {
          throw dataManagementError('data-release-reference-archive-mismatch', `数据发布包参考存档与清单不匹配：${entry.archiveId}`);
        }
        writeJsonAtomically(path.join(referenceStaging, 'archives', `${entry.archiveId}.json`), {
          ...archive,
          reference: {
            releaseId: checkedManifest.dataVersion,
            packageHash: checkedManifest.package.sha256,
            downloadedAt: new Date().toISOString(),
          },
        });
      }
      // Keep the signed wire manifest byte-for-byte semantically identical in
      // both release roots. `checkedManifest` contains local `signatureInfo`
      // diagnostics and would invalidate the original signature if persisted.
      writeJsonAtomically(path.join(referenceStaging, 'data-release-manifest.json'), manifest);
      // The catalog version keeps only its SQLite artifact and manifest; the
      // read-only reference library owns the extracted archive copies.
      fs.rmSync(path.join(staging, 'archives'), { recursive: true, force: true });
      fs.rmSync(path.join(staging, 'manifest.json'), { force: true });
      writeJsonAtomically(path.join(staging, 'data-release-manifest.json'), manifest);
      if (!catalogAlreadyInstalled) {
        fs.mkdirSync(path.dirname(target.directory), { recursive: true });
        fs.renameSync(staging, target.directory);
      }
      if (!referenceAlreadyInstalled) {
        fs.mkdirSync(path.dirname(referenceTargetDirectory), { recursive: true });
        fs.renameSync(referenceStaging, referenceTargetDirectory);
      }
      return {
        installed: !catalogAlreadyInstalled || !referenceAlreadyInstalled,
        reused: catalogAlreadyInstalled && referenceAlreadyInstalled,
        active: activateUnifiedDataRelease(checkedManifest.dataVersion, manifestUrl),
      };
    } catch (error) {
      throw error;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(referenceStaging, { recursive: true, force: true });
    }
  }

  function rollbackTo(dataVersion) {
    return activateUnifiedDataRelease(dataVersion, 'manual-rollback');
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
      const archivePrefix = `legacy-${sanitizeArchiveId(legacyOrigin, 'archive').slice(0, 40)}-${contentHash.slice(0, 16)}`;
      const migratedArchives = snapshots.map((snapshot, index) => {
        const archiveId = `${archivePrefix}-${index + 1}`;
        const filePath = timelineArchiveFilePath(paths.localArchiveDirectory, archiveId);
        const legacyTimelineArchive = {
          type: TIMELINE_ARCHIVE_TYPE,
          archiveVersion: 1,
          source: 'local',
          archiveId,
          label: snapshot.label,
          createdAt: new Date(snapshot.createdAt).toISOString(),
          payload: snapshot.payload,
        };
        if (fs.existsSync(filePath)) {
          const existing = readTimelineArchiveFile(filePath, { expectedSource: 'local' });
          if (existing.payloadHash !== hashTimelinePayload(snapshot.payload)) {
            throw dataManagementError('legacy-timeline-archive-collision', `旧存档迁移目标冲突：${archiveId}`);
          }
          return archiveSummary(existing, { library: 'local' });
        }
        return archiveSummary(writeTimelineArchive(paths.localArchiveDirectory, legacyTimelineArchive).archive, { library: 'local' });
      });
      const details = {
        contentHash,
        backupPath,
        archiveIds: migratedArchives.map((entry) => entry.archiveId),
        archiveCount: migratedArchives.length,
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

  function writeSharedTimelineArchive(rawArchive) {
    const candidate = cloneJson(rawArchive);
    candidate.source = 'shared';
    delete candidate.reference;
    const archive = normalizeTimelineArchive(candidate, { expectedSource: 'shared' });
    const filePath = timelineArchiveFilePath(paths.sharedArchiveDirectory, archive.archiveId);
    if (fs.existsSync(filePath)) {
      const existing = readTimelineArchiveFile(filePath, { expectedSource: 'shared' });
      if (stableJson(existing) !== stableJson(archive)) {
        throw dataManagementError('shared-timeline-archive-collision', `共享存档已有同 ID 但内容不同的条目：${archive.archiveId}`);
      }
      return { archive: archiveSummary(existing, { library: 'shared' }), reused: true };
    }
    return { archive: archiveSummary(writeTimelineArchive(paths.sharedArchiveDirectory, archive).archive, { library: 'shared' }), reused: false };
  }

  function importDataPackageTimelineArchives({ dataPackage } = {}) {
    const packageValue = normalizeLocalDataPackage(dataPackage);
    const imported = [];
    for (const archive of packageValue.timelineArchives || []) {
      imported.push(writeSharedTimelineArchive(archive));
    }
    // Packages written before timelineArchives existed retain old browser
    // snapshot fields. Apply Data is the only place that converts these
    // historical fields into shared archives.
    const legacyLocal = asRecord(packageValue.storage?.local);
    const legacySession = asRecord(packageValue.storage?.session);
    const hasLegacySnapshots = Array.isArray(parseLegacyStorageValue(legacyLocal[LEGACY_TIMELINE_SNAPSHOT_ARCHIVE_KEY], null)?.snapshots);
    const hasLegacyTimelineWorkspace = [
      WORKSPACE_STORAGE_KEYS.timelineData,
      WORKSPACE_STORAGE_KEYS.skillButtonTable,
    ].some((key) => Object.prototype.hasOwnProperty.call(legacySession, key));
    if (!imported.length && (hasLegacySnapshots || hasLegacyTimelineWorkspace)) {
      const sourceHash = localDataPackageHash(packageValue);
      for (const [index, snapshot] of legacyArchiveSnapshots(packageValue, sourceHash).entries()) {
        imported.push(writeSharedTimelineArchive({
          type: TIMELINE_ARCHIVE_TYPE,
          archiveVersion: 1,
          source: 'shared',
          archiveId: `package-${sourceHash.slice(0, 20)}-${index + 1}`,
          label: snapshot.label,
          createdAt: new Date(snapshot.createdAt).toISOString(),
          payload: snapshot.payload,
        }));
      }
    }
    return { imported: imported.filter((entry) => !entry.reused).map((entry) => entry.archive), reused: imported.filter((entry) => entry.reused).map((entry) => entry.archive) };
  }

  function writeSharedTimelineArchivesToDataPackage({ dataPackagePath } = {}) {
    if (!dataPackagePath || !fs.existsSync(dataPackagePath) || !fs.statSync(dataPackagePath).isFile()) {
      throw dataManagementError('data-package-not-found', '目标数据包不存在。');
    }
    const packageValue = normalizeLocalDataPackage(JSON.parse(fs.readFileSync(dataPackagePath, 'utf8')));
    const timelineArchives = fs.readdirSync(paths.sharedArchiveDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readTimelineArchiveFile(path.join(paths.sharedArchiveDirectory, entry.name), { expectedSource: 'shared' }))
      .sort((left, right) => left.archiveId.localeCompare(right.archiveId));
    const next = { ...packageValue, timelineArchives };
    writeJsonAtomically(dataPackagePath, next);
    return { path: dataPackagePath, archiveCount: timelineArchives.length, dataPackage: normalizeLocalDataPackage(next) };
  }

  function migrateLegacySharedArchiveLibraries() {
    ensureLayout();
    const results = [];
    const migrateDirectory = (directory) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
          const result = writeSharedTimelineArchive(raw);
          results.push({ fileName: entry.name, ...result });
        } catch (error) {
          results.push({ fileName: entry.name, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    const migrateLegacyLocalDirectory = () => {
      if (!fs.existsSync(paths.legacyLocalArchiveDirectory)) return;
      for (const entry of fs.readdirSync(paths.legacyLocalArchiveDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const candidate = JSON.parse(fs.readFileSync(path.join(paths.legacyLocalArchiveDirectory, entry.name), 'utf8'));
          candidate.source = 'local';
          delete candidate.reference;
          const archive = normalizeTimelineArchive(candidate, { expectedSource: 'local' });
          const destination = timelineArchiveFilePath(paths.localArchiveDirectory, archive.archiveId);
          if (fs.existsSync(destination)) {
            const existing = readTimelineArchiveFile(destination, { expectedSource: 'local' });
            if (stableJson(existing) !== stableJson(archive)) {
              throw dataManagementError('legacy-local-timeline-archive-collision', `本地存档已有同 ID 但内容不同的条目：${archive.archiveId}`);
            }
            results.push({ fileName: entry.name, library: 'local', reused: true });
          } else {
            writeTimelineArchive(paths.localArchiveDirectory, archive);
            results.push({ fileName: entry.name, library: 'local', reused: false });
          }
        } catch (error) {
          results.push({ fileName: entry.name, library: 'local', error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    const migrateInstalledReferenceDirectories = () => {
      if (!fs.existsSync(paths.referenceArchiveVersionsDirectory)) return;
      for (const entry of fs.readdirSync(paths.referenceArchiveVersionsDirectory, { withFileTypes: true })) {
        if (entry.isDirectory()) migrateDirectory(path.join(paths.referenceArchiveVersionsDirectory, entry.name, 'archives'));
      }
    };
    migrateLegacyLocalDirectory();
    migrateDirectory(paths.referenceArchiveOutboxDirectory);
    migrateInstalledReferenceDirectories();
    return results;
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
    listTimelineArchives: ({ source } = {}) => {
      if (source === 'local') return listLocalTimelineArchives();
      if (source === 'shared') return listSharedTimelineArchives();
      if (source === 'pending-reference') return listPendingReferenceTimelineArchives();
      if (source === 'reference') return listReferenceTimelineArchives();
      throw dataManagementError('invalid-timeline-archive-source', '存档来源无效。');
    },
    deleteTimelineArchive,
    transferTimelineArchive,
    materializeLegacyTimelineSnapshotsAsLocalArchives,
    listSqliteWorkspaces,
    applySqliteWorkspace,
    deleteSqliteWorkspace,
    exportSqliteWorkspaceArchive,
    importDataPackageTimelineArchives,
    writeSharedTimelineArchivesToDataPackage,
    migrateLegacySharedArchiveLibraries,
    importLegacyTimelineBundleArchive,
    convertTimelineArchiveToWorkspace,
    installReferenceArchiveRelease,
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
  LOCAL_DATA_RELEASE_MANIFEST_TYPE,
  LOCAL_DATA_RELEASE_PACKAGE_MANIFEST_TYPE,
  TIMELINE_ARCHIVE_TYPE,
  REFERENCE_ARCHIVE_RELEASE_MANIFEST_TYPE,
  REFERENCE_ARCHIVE_PACKAGE_MANIFEST_TYPE,
  USER_SCHEMA_VERSION,
  createCatalogDatabase,
  validateCatalogDatabase,
  createDataReleasePackage,
  createLocalDataReleasePackage,
  installLocalDataRelease,
  validateLocalDataReleaseManifest,
  normalizeLocalDataPackage,
  createReferenceArchiveReleasePackage,
  createDataManagementService,
  signDataReleaseManifest,
  validateDataReleaseManifest,
  verifyDataReleaseManifestSignature,
  validateReferenceArchiveReleaseManifest,
};
