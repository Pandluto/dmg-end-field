const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

function serialize(value) {
  return JSON.stringify(value ?? {});
}

function parse(value, fallback) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function createTimelineRepository({ databasePath }) {
  if (!databasePath) throw new Error('Timeline repository requires databasePath.');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_documents (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_payload_blobs (
      content_hash TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_snapshots (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE RESTRICT,
      payload_hash TEXT NOT NULL REFERENCES timeline_payload_blobs(content_hash) ON DELETE RESTRICT,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER,
      UNIQUE(timeline_id, payload_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_work_nodes (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE RESTRICT,
      parent_id TEXT REFERENCES timeline_work_nodes(id) ON DELETE RESTRICT,
      base_payload_hash TEXT NOT NULL REFERENCES timeline_payload_blobs(content_hash) ON DELETE RESTRICT,
      working_payload_hash TEXT NOT NULL REFERENCES timeline_payload_blobs(content_hash) ON DELETE RESTRICT,
      branch_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      risk_flags TEXT NOT NULL,
      logs TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS checkout_refs (
      timeline_id TEXT PRIMARY KEY REFERENCES timeline_documents(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('snapshot', 'work-node')),
      target_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_audit_events (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS timeline_snapshots_timeline_created_idx ON timeline_snapshots(timeline_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS timeline_work_nodes_timeline_updated_idx ON timeline_work_nodes(timeline_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS timeline_audit_events_timeline_created_idx ON timeline_audit_events(timeline_id, created_at DESC);
  `);
  db.prepare(`
    INSERT INTO timeline_schema_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));

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
        // Keep the original error.
      }
      throw error;
    }
  }

  function ensurePayload(payload, createdAt) {
    const serialized = serialize(payload);
    const hash = `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}`;
    db.prepare(`
      INSERT OR IGNORE INTO timeline_payload_blobs (content_hash, payload, created_at)
      VALUES (?, ?, ?)
    `).run(hash, serialized, createdAt);
    return hash;
  }

  function readDocument(row) {
    return row && {
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at || null,
    };
  }

  function readSnapshot(row, includePayload = false) {
    if (!row) return null;
    const snapshot = {
      id: row.id,
      timelineId: row.timeline_id,
      payloadHash: row.payload_hash,
      label: row.label,
      createdAt: row.created_at,
      archivedAt: row.archived_at || null,
    };
    if (!includePayload) return snapshot;
    const payload = db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(row.payload_hash);
    return { ...snapshot, payload: parse(payload?.payload, {}) };
  }

  function ensureDocument(input) {
    if (!input?.id || !input?.label) throw new Error('Timeline document requires id and label.');
    const now = input.createdAt || Date.now();
    return transaction(() => {
      db.prepare(`
        INSERT INTO timeline_documents (id, label, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at
      `).run(input.id, input.label, now, Date.now());
      return readDocument(db.prepare('SELECT * FROM timeline_documents WHERE id = ?').get(input.id));
    });
  }

  function createOrReuseSnapshot(input) {
    if (!input?.id || !input?.timelineId || !input?.label) {
      throw new Error('Timeline snapshot requires id, timelineId, and label.');
    }
    return transaction(() => {
      const document = db.prepare('SELECT id FROM timeline_documents WHERE id = ?').get(input.timelineId);
      if (!document) throw new Error(`Timeline document not found: ${input.timelineId}`);
      const createdAt = input.createdAt || Date.now();
      const payloadHash = ensurePayload(input.payload, createdAt);
      const existing = db.prepare(`
        SELECT * FROM timeline_snapshots
        WHERE timeline_id = ? AND payload_hash = ? AND archived_at IS NULL
      `).get(input.timelineId, payloadHash);
      if (existing) return { snapshot: readSnapshot(existing), reused: true };
      db.prepare(`
        INSERT INTO timeline_snapshots (id, timeline_id, payload_hash, label, created_at, archived_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(input.id, input.timelineId, payloadHash, input.label, createdAt);
      return {
        snapshot: readSnapshot(db.prepare('SELECT * FROM timeline_snapshots WHERE id = ?').get(input.id)),
        reused: false,
      };
    });
  }

  function setCheckoutRef(input) {
    if (!input?.timelineId || !input?.targetId || !['snapshot', 'work-node'].includes(input.targetType)) {
      throw new Error('Checkout ref requires timelineId, targetType, and targetId.');
    }
    return transaction(() => {
      if (input.targetType === 'snapshot') {
        const snapshot = db.prepare('SELECT id FROM timeline_snapshots WHERE id = ? AND timeline_id = ? AND archived_at IS NULL')
          .get(input.targetId, input.timelineId);
        if (!snapshot) throw new Error(`Timeline snapshot not found for checkout: ${input.targetId}`);
      }
      const updatedAt = input.updatedAt || Date.now();
      db.prepare(`
        INSERT INTO checkout_refs (timeline_id, target_type, target_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(timeline_id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          updated_at = excluded.updated_at
      `).run(input.timelineId, input.targetType, input.targetId, updatedAt);
      return { timelineId: input.timelineId, targetType: input.targetType, targetId: input.targetId, updatedAt };
    });
  }

  function appendAuditEvent(input) {
    if (!input?.id || !input?.timelineId || !input?.eventType || !input?.subjectType || !input?.subjectId) {
      throw new Error('Timeline audit event is missing required fields.');
    }
    return transaction(() => {
      db.prepare(`
        INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_type, subject_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.timelineId,
        input.eventType,
        input.subjectType,
        input.subjectId,
        serialize(input.details),
        input.createdAt || Date.now(),
      );
    });
  }

  function archiveSnapshot(snapshotId) {
    return transaction(() => {
      const snapshot = db.prepare('SELECT * FROM timeline_snapshots WHERE id = ? AND archived_at IS NULL').get(snapshotId);
      if (!snapshot) throw new Error(`Timeline snapshot not found: ${snapshotId}`);
      const checkout = db.prepare(`
        SELECT 1 FROM checkout_refs WHERE timeline_id = ? AND target_type = 'snapshot' AND target_id = ?
      `).get(snapshot.timeline_id, snapshotId);
      if (checkout) {
        const error = new Error('Cannot delete the current timeline snapshot. Restore or apply another target first.');
        error.code = 'timeline-snapshot-current-checkout-protected';
        error.status = 409;
        throw error;
      }
      db.prepare('UPDATE timeline_snapshots SET archived_at = ? WHERE id = ?').run(Date.now(), snapshotId);
      return { id: snapshotId, timelineId: snapshot.timeline_id, archived: true };
    });
  }

  function importWorkNode(input) {
    return transaction(() => {
      const document = db.prepare('SELECT id FROM timeline_documents WHERE id = ?').get(input.timelineId);
      if (!document) throw new Error(`Timeline document not found: ${input.timelineId}`);
      const createdAt = input.createdAt || Date.now();
      const basePayloadHash = ensurePayload(input.basePayload, createdAt);
      const workingPayloadHash = ensurePayload(input.workingPayload, input.updatedAt || createdAt);
      db.prepare(`
        INSERT OR IGNORE INTO timeline_work_nodes (
          id, timeline_id, parent_id, base_payload_hash, working_payload_hash, branch_id, label,
          status, approval_policy, risk_flags, logs, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.timelineId, input.parentNodeId || null, basePayloadHash, workingPayloadHash,
        input.branchId || input.id, input.label || input.id, input.status || 'draft', input.approvalPolicy || 'auto-low-risk',
        serialize(input.riskFlags), serialize(input.logs), createdAt, input.updatedAt || createdAt);
      return { id: input.id, imported: db.prepare('SELECT 1 FROM timeline_work_nodes WHERE id = ?').get(input.id) != null };
    });
  }

  return {
    databasePath,
    ensureDocument,
    createOrReuseSnapshot,
    setCheckoutRef,
    appendAuditEvent,
    archiveSnapshot,
    importWorkNode,
    getDocument: (id) => readDocument(db.prepare('SELECT * FROM timeline_documents WHERE id = ?').get(id)),
    listDocuments: () => db.prepare(`
      SELECT * FROM timeline_documents WHERE archived_at IS NULL ORDER BY updated_at DESC
    `).all().map(readDocument),
    getSnapshot: (id) => readSnapshot(db.prepare('SELECT * FROM timeline_snapshots WHERE id = ?').get(id), true),
    listSnapshots: (timelineId) => db.prepare(`
      SELECT * FROM timeline_snapshots WHERE timeline_id = ? AND archived_at IS NULL ORDER BY created_at DESC
    `).all(timelineId).map((row) => readSnapshot(row, true)),
    getCheckoutRef: (timelineId) => {
      const row = db.prepare('SELECT * FROM checkout_refs WHERE timeline_id = ?').get(timelineId);
      return row && { timelineId: row.timeline_id, targetType: row.target_type, targetId: row.target_id, updatedAt: row.updated_at };
    },
    listAuditEvents: (timelineId, limit = 100) => db.prepare(`
      SELECT * FROM timeline_audit_events WHERE timeline_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(timelineId, Math.max(1, Math.min(Number(limit) || 100, 500))).map((row) => ({
      id: row.id,
      timelineId: row.timeline_id,
      eventType: row.event_type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      details: parse(row.details, {}),
      createdAt: row.created_at,
    })),
    listWorkNodes: (timelineId) => db.prepare(`
      SELECT * FROM timeline_work_nodes WHERE timeline_id = ? ORDER BY created_at ASC
    `).all(timelineId).map((row) => ({
      id: row.id,
      parentNodeId: row.parent_id || undefined,
      timelineId: row.timeline_id,
      branchId: row.branch_id,
      label: row.label,
      status: row.status,
      approvalPolicy: row.approval_policy,
      riskFlags: parse(row.risk_flags, []),
      logs: parse(row.logs, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    close: () => db.close(),
  };
}

module.exports = { createTimelineRepository };
