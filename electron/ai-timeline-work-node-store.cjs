const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;
const EMPTY_ARCHIVE = Object.freeze({
  type: 'def.ai-timeline.worknodes.v1',
  schemaVersion: 1,
  nodes: [],
  commits: [],
});

function json(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function snapshotId(payload) {
  const serialized = json(payload, {});
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  return { id: `sha256:${hash}`, hash, serialized };
}

function isLegacyBranchNode(node) {
  const text = `${node?.branchId || ''} ${node?.label || ''}`;
  return /^\s*branch-/i.test(node?.branchId || '') || /\[branch\]/i.test(text);
}

function normalizeLegacyParents(nodes) {
  const sorted = [...nodes].sort((left, right) => (left?.createdAt || 0) - (right?.createdAt || 0));
  const ids = new Set(sorted.map((node) => node?.id).filter(Boolean));
  const normalized = [];
  let previous;

  for (const raw of sorted) {
    if (!raw?.id) continue;
    let parentNodeId = typeof raw.parentNodeId === 'string' && ids.has(raw.parentNodeId) && raw.parentNodeId !== raw.id
      ? raw.parentNodeId
      : '';
    if (!parentNodeId && previous) {
      parentNodeId = isLegacyBranchNode(raw) ? (previous.parentNodeId || '') : previous.id;
    }
    const node = { ...raw, ...(parentNodeId ? { parentNodeId } : {}) };
    normalized.push(node);
    previous = node;
  }
  const byId = new Map(normalized.map((node) => [node.id, node]));
  for (const node of normalized) {
    const seen = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId) {
      if (seen.has(parentId)) {
        delete node.parentNodeId;
        break;
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentNodeId;
    }
  }
  return normalized;
}

function createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath }) {
  if (!databasePath) throw new Error('Work node SQLite store requires databasePath.');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_node_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_node_snapshots (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_nodes (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      parent_id TEXT REFERENCES work_nodes(id) ON DELETE CASCADE,
      base_snapshot_id TEXT NOT NULL REFERENCES work_node_snapshots(id),
      working_snapshot_id TEXT NOT NULL REFERENCES work_node_snapshots(id),
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      base_summary TEXT NOT NULL,
      working_summary TEXT NOT NULL,
      risk_flags TEXT NOT NULL,
      logs TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_node_commits (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES work_nodes(id) ON DELETE CASCADE,
      save_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      base_snapshot_id TEXT NOT NULL REFERENCES work_node_snapshots(id),
      applied_snapshot_id TEXT NOT NULL REFERENCES work_node_snapshots(id),
      label TEXT NOT NULL,
      summary TEXT NOT NULL,
      risk_flags TEXT NOT NULL,
      approval TEXT NOT NULL,
      checkout_applied INTEGER NOT NULL DEFAULT 0,
      checkout TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS work_node_heads (
      save_id TEXT PRIMARY KEY,
      current_node_id TEXT NOT NULL REFERENCES work_nodes(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS work_nodes_parent_idx ON work_nodes(parent_id);
    CREATE INDEX IF NOT EXISTS work_nodes_save_updated_idx ON work_nodes(save_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS work_node_commits_node_idx ON work_node_commits(node_id, created_at DESC);
  `);

  const getMetaStatement = db.prepare('SELECT value FROM work_node_meta WHERE key = ?');
  const setMetaStatement = db.prepare(`
    INSERT INTO work_node_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const getSnapshotPayloadStatement = db.prepare('SELECT payload FROM work_node_snapshots WHERE id = ?');
  const insertSnapshotStatement = db.prepare(`
    INSERT OR IGNORE INTO work_node_snapshots (id, content_hash, payload, created_at)
    VALUES (?, ?, ?, ?)
  `);

  function transaction(run) {
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

  function getMeta(key) {
    return getMetaStatement.get(key)?.value;
  }

  function setMeta(key, value) {
    setMetaStatement.run(key, String(value));
  }

  function currentRevision() {
    return Number(getMeta('tree_revision') || 0);
  }

  function bumpRevision() {
    const next = currentRevision() + 1;
    setMeta('tree_revision', next);
    return next;
  }

  function ensureSnapshot(payload, createdAt = Date.now()) {
    const snapshot = snapshotId(payload);
    insertSnapshotStatement.run(snapshot.id, snapshot.hash, snapshot.serialized, createdAt);
    return snapshot.id;
  }

  function readSnapshot(id) {
    const row = getSnapshotPayloadStatement.get(id);
    if (!row) throw new Error(`Work node snapshot not found: ${id}`);
    return parseJson(row.payload, {});
  }

  function nodeFromRow(row, includePayload) {
    if (!row) return null;
    return {
      id: row.id,
      ...(row.parent_id ? { parentNodeId: row.parent_id } : {}),
      saveId: row.save_id,
      branchId: row.branch_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      label: row.label,
      status: row.status,
      ...(includePayload ? {
        basePayload: readSnapshot(row.base_snapshot_id),
        workingPayload: readSnapshot(row.working_snapshot_id),
      } : {}),
      baseSummary: parseJson(row.base_summary, {}),
      workingSummary: parseJson(row.working_summary, {}),
      approvalPolicy: row.approval_policy,
      riskFlags: parseJson(row.risk_flags, []),
      logs: parseJson(row.logs, []),
    };
  }

  function commitFromRow(row, includePayload) {
    if (!row) return null;
    return {
      id: row.id,
      nodeId: row.node_id,
      saveId: row.save_id,
      branchId: row.branch_id,
      createdAt: row.created_at,
      label: row.label,
      summary: parseJson(row.summary, {}),
      ...(includePayload ? {
        basePayload: readSnapshot(row.base_snapshot_id),
        appliedPayload: readSnapshot(row.applied_snapshot_id),
      } : {}),
      riskFlags: parseJson(row.risk_flags, []),
      approval: parseJson(row.approval, {}),
      checkoutApplied: Boolean(row.checkout_applied),
      ...(row.checkout ? { checkout: parseJson(row.checkout, {}) } : {}),
    };
  }

  function validateParent(node) {
    if (!node.parentNodeId) return;
    if (node.parentNodeId === node.id) throw new Error('Work node cannot be its own parent.');
    const parent = db.prepare('SELECT id, save_id FROM work_nodes WHERE id = ?').get(node.parentNodeId);
    if (!parent) throw new Error(`Work node parent not found: ${node.parentNodeId}`);
    if (parent.save_id !== node.saveId) throw new Error('Work node parent must belong to the same save.');
    const cycle = db.prepare(`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM work_nodes WHERE id = ?
        UNION ALL
        SELECT node.id, node.parent_id
        FROM work_nodes node
        JOIN ancestors ON node.id = ancestors.parent_id
      )
      SELECT 1 AS found FROM ancestors WHERE id = ? LIMIT 1
    `).get(node.parentNodeId, node.id);
    if (cycle) throw new Error('Work node parent would create a cycle.');
  }

  function writeNode(node) {
    validateParent(node);
    const baseSnapshotId = ensureSnapshot(node.basePayload, node.createdAt);
    const workingSnapshotId = ensureSnapshot(node.workingPayload, node.updatedAt);
    db.prepare(`
      INSERT INTO work_nodes (
        id, save_id, branch_id, parent_id, base_snapshot_id, working_snapshot_id,
        label, status, approval_policy, base_summary, working_summary,
        risk_flags, logs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        save_id = excluded.save_id,
        branch_id = excluded.branch_id,
        parent_id = excluded.parent_id,
        base_snapshot_id = excluded.base_snapshot_id,
        working_snapshot_id = excluded.working_snapshot_id,
        label = excluded.label,
        status = excluded.status,
        approval_policy = excluded.approval_policy,
        base_summary = excluded.base_summary,
        working_summary = excluded.working_summary,
        risk_flags = excluded.risk_flags,
        logs = excluded.logs,
        updated_at = excluded.updated_at
    `).run(
      node.id,
      node.saveId,
      node.branchId,
      node.parentNodeId || null,
      baseSnapshotId,
      workingSnapshotId,
      node.label,
      node.status,
      node.approvalPolicy,
      json(node.baseSummary, {}),
      json(node.workingSummary, {}),
      json(node.riskFlags, []),
      json(node.logs, []),
      node.createdAt,
      node.updatedAt,
    );
  }

  function writeCommit(commit) {
    const baseSnapshotId = ensureSnapshot(commit.basePayload, commit.createdAt);
    const appliedSnapshotId = ensureSnapshot(commit.appliedPayload, commit.createdAt);
    db.prepare(`
      INSERT INTO work_node_commits (
        id, node_id, save_id, branch_id, base_snapshot_id, applied_snapshot_id,
        label, summary, risk_flags, approval, checkout_applied, checkout, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        node_id = excluded.node_id,
        save_id = excluded.save_id,
        branch_id = excluded.branch_id,
        base_snapshot_id = excluded.base_snapshot_id,
        applied_snapshot_id = excluded.applied_snapshot_id,
        label = excluded.label,
        summary = excluded.summary,
        risk_flags = excluded.risk_flags,
        approval = excluded.approval,
        checkout_applied = excluded.checkout_applied,
        checkout = excluded.checkout
    `).run(
      commit.id,
      commit.nodeId,
      commit.saveId,
      commit.branchId,
      baseSnapshotId,
      appliedSnapshotId,
      commit.label,
      json(commit.summary, {}),
      json(commit.riskFlags, []),
      json(commit.approval, {}),
      commit.checkoutApplied ? 1 : 0,
      commit.checkout ? json(commit.checkout, {}) : null,
      commit.createdAt,
    );
  }

  function writeHead(saveId, nodeId, revision) {
    if (!nodeId) {
      db.prepare('DELETE FROM work_node_heads WHERE save_id = ?').run(saveId);
      return;
    }
    const node = db.prepare('SELECT id, save_id FROM work_nodes WHERE id = ?').get(nodeId);
    if (!node) throw new Error(`Work node head not found: ${nodeId}`);
    if (node.save_id !== saveId) throw new Error('Work node head must belong to the same save.');
    db.prepare(`
      INSERT INTO work_node_heads (save_id, current_node_id, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(save_id) DO UPDATE SET
        current_node_id = excluded.current_node_id,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(saveId, nodeId, revision, Date.now());
  }

  function garbageCollectSnapshots() {
    db.exec(`
      DELETE FROM work_node_snapshots
      WHERE id NOT IN (
        SELECT base_snapshot_id FROM work_nodes
        UNION SELECT working_snapshot_id FROM work_nodes
        UNION SELECT base_snapshot_id FROM work_node_commits
        UNION SELECT applied_snapshot_id FROM work_node_commits
      );
    `);
  }

  function saveNode(node, options = {}) {
    return transaction(() => {
      writeNode(node);
      const revision = bumpRevision();
      if (options.setHead || options.headNodeId) {
        writeHead(node.saveId, options.headNodeId || node.id, revision);
      }
      garbageCollectSnapshots();
      return { node: getNode(node.id), revision };
    });
  }

  function saveNodeAndCommit(node, commit, options = {}) {
    return transaction(() => {
      writeNode(node);
      writeCommit(commit);
      const revision = bumpRevision();
      if (options.setHead || options.headNodeId) {
        writeHead(node.saveId, options.headNodeId || node.id, revision);
      }
      garbageCollectSnapshots();
      return { node: getNode(node.id), commit: getCommit(commit.id), revision };
    });
  }

  function getNode(id) {
    return nodeFromRow(db.prepare('SELECT * FROM work_nodes WHERE id = ?').get(id), true);
  }

  function getCommit(id) {
    return commitFromRow(db.prepare('SELECT * FROM work_node_commits WHERE id = ?').get(id), true);
  }

  function getLatestCommitForNode(nodeId) {
    return commitFromRow(db.prepare(`
      SELECT * FROM work_node_commits WHERE node_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(nodeId), true);
  }

  function readArchive() {
    const nodes = db.prepare('SELECT * FROM work_nodes ORDER BY updated_at DESC').all().map((row) => nodeFromRow(row, true));
    const commits = db.prepare('SELECT * FROM work_node_commits ORDER BY created_at DESC').all().map((row) => commitFromRow(row, true));
    return { ...EMPTY_ARCHIVE, nodes, commits };
  }

  function list() {
    const nodes = db.prepare('SELECT * FROM work_nodes ORDER BY updated_at DESC').all().map((row) => nodeFromRow(row, false));
    const commits = db.prepare('SELECT * FROM work_node_commits ORDER BY created_at DESC').all().map((row) => commitFromRow(row, false));
    const heads = Object.fromEntries(
      db.prepare('SELECT save_id, current_node_id, revision FROM work_node_heads ORDER BY updated_at DESC').all()
        .map((row) => [row.save_id, { nodeId: row.current_node_id, revision: row.revision }]),
    );
    const firstHead = Object.values(heads)[0];
    return {
      ...EMPTY_ARCHIVE,
      nodes,
      commits,
      heads,
      headNodeId: firstHead?.nodeId || '',
      revision: currentRevision(),
    };
  }

  function setHead(saveId, nodeId) {
    return transaction(() => {
      const revision = bumpRevision();
      writeHead(saveId, nodeId, revision);
      return { nodeId, revision };
    });
  }

  function getHead(saveId) {
    const row = db.prepare('SELECT current_node_id, revision FROM work_node_heads WHERE save_id = ?').get(saveId);
    return row ? { nodeId: row.current_node_id, revision: row.revision } : null;
  }

  function deleteSubtree(nodeId) {
    return transaction(() => {
      const target = db.prepare('SELECT id FROM work_nodes WHERE id = ?').get(nodeId);
      if (!target) throw new Error(`AI timeline work node not found: ${nodeId}`);
      const descendants = db.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM work_nodes WHERE id = ?
          UNION ALL
          SELECT node.id FROM work_nodes node JOIN subtree ON node.parent_id = subtree.id
        )
        SELECT id FROM subtree
      `).all(nodeId).map((row) => row.id);
      const placeholders = descendants.map(() => '?').join(', ');
      const protectedHead = db.prepare(`
        SELECT current_node_id FROM work_node_heads WHERE current_node_id IN (${placeholders}) LIMIT 1
      `).get(...descendants);
      if (protectedHead) {
        throw new Error('Cannot delete the current Work Node path. Checkout another branch first.');
      }
      db.prepare('DELETE FROM work_nodes WHERE id = ?').run(nodeId);
      const revision = bumpRevision();
      garbageCollectSnapshots();
      return { deletedNodeIds: descendants, revision };
    });
  }

  function replaceArchive(archive) {
    return transaction(() => {
      const existingHeads = db.prepare('SELECT save_id, current_node_id FROM work_node_heads').all();
      db.exec('DELETE FROM work_node_heads; DELETE FROM work_node_commits; DELETE FROM work_nodes;');
      const normalizedNodes = normalizeLegacyParents(Array.isArray(archive?.nodes) ? archive.nodes : []);
      const byCreated = [...normalizedNodes].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
      for (const node of byCreated) writeNode({ ...node, parentNodeId: undefined });
      for (const node of byCreated) {
        if (node.parentNodeId) db.prepare('UPDATE work_nodes SET parent_id = ? WHERE id = ?').run(node.parentNodeId, node.id);
      }
      for (const commit of Array.isArray(archive?.commits) ? archive.commits : []) writeCommit(commit);
      const revision = bumpRevision();
      for (const head of existingHeads) {
        if (db.prepare('SELECT 1 FROM work_nodes WHERE id = ?').get(head.current_node_id)) {
          writeHead(head.save_id, head.current_node_id, revision);
        }
      }
      garbageCollectSnapshots();
      return { revision };
    });
  }

  function migrateLegacyJson() {
    if (getMeta('legacy_json_migration')) return;
    transaction(() => {
      const count = db.prepare('SELECT COUNT(*) AS count FROM work_nodes').get().count;
      if (count === 0 && legacyJsonPath && fs.existsSync(legacyJsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
        if (parsed?.type === EMPTY_ARCHIVE.type) {
          const nodes = normalizeLegacyParents(Array.isArray(parsed.nodes) ? parsed.nodes : []);
          for (const node of nodes) writeNode({ ...node, parentNodeId: undefined });
          for (const node of nodes) {
            if (node.parentNodeId) db.prepare('UPDATE work_nodes SET parent_id = ? WHERE id = ?').run(node.parentNodeId, node.id);
          }
          for (const commit of Array.isArray(parsed.commits) ? parsed.commits : []) writeCommit(commit);

          const saves = [...new Set(nodes.map((node) => node.saveId).filter(Boolean))];
          const revision = nodes.length || parsed.commits?.length ? bumpRevision() : currentRevision();
          for (const saveId of saves) {
            const applied = db.prepare(`
              SELECT work_commit.node_id
              FROM work_node_commits work_commit
              JOIN work_nodes node ON node.id = work_commit.node_id
              WHERE node.save_id = ? AND work_commit.checkout_applied = 1
              ORDER BY work_commit.created_at DESC LIMIT 1
            `).get(saveId);
            const fallback = db.prepare(`
              SELECT id FROM work_nodes WHERE save_id = ? ORDER BY updated_at DESC LIMIT 1
            `).get(saveId);
            const headNodeId = applied?.node_id || fallback?.id;
            if (headNodeId) writeHead(saveId, headNodeId, revision);
          }
        }
      }
      setMeta('schema_version', SCHEMA_VERSION);
      setMeta('legacy_json_migration', JSON.stringify({ completedAt: Date.now(), source: legacyJsonPath || '' }));
    });
  }

  migrateLegacyJson();

  return {
    databasePath,
    list,
    readArchive,
    getNode,
    getCommit,
    getLatestCommitForNode,
    saveNode,
    saveNodeAndCommit,
    setHead,
    getHead,
    deleteSubtree,
    replaceArchive,
    close: () => db.close(),
  };
}

module.exports = {
  createAiTimelineWorkNodeStore,
  normalizeLegacyParents,
};
