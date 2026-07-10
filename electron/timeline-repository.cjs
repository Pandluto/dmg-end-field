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

function summarizePayload(payload) {
  const staffLines = Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [];
  return {
    characterCount: Array.isArray(payload?.selectedCharacters) ? payload.selectedCharacters.length : 0,
    buttonCount: staffLines.reduce((total, line) => total + (Array.isArray(line?.buttons) ? line.buttons.length : 0), 0),
    buffCount: Array.isArray(payload?.allBuffList) ? payload.allBuffList.length : 0,
  };
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

  function writeAuditEvent(input) {
    db.prepare(`
      INSERT INTO timeline_audit_events (id, timeline_id, event_type, subject_type, subject_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      input.id || `timeline-audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      input.timelineId,
      input.eventType,
      input.subjectType,
      input.subjectId,
      serialize(input.details),
      input.createdAt || Date.now(),
    );
  }

  function garbageCollectPayloadBlobs() {
    db.exec(`
      DELETE FROM timeline_payload_blobs
      WHERE content_hash NOT IN (
        SELECT payload_hash FROM timeline_snapshots
        UNION SELECT base_payload_hash FROM timeline_work_nodes
        UNION SELECT working_payload_hash FROM timeline_work_nodes
      );
    `);
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
      writeAuditEvent({ timelineId: input.timelineId, eventType: 'snapshot.saved', subjectType: 'snapshot', subjectId: input.id, details: { payloadHash }, createdAt });
      return {
        snapshot: readSnapshot(db.prepare('SELECT * FROM timeline_snapshots WHERE id = ?').get(input.id)),
        reused: false,
      };
    });
  }

  function importDocumentBundle(input) {
    if (!input?.document?.id || !input?.document?.label || !Array.isArray(input.snapshots) || !input.snapshots.length) {
      const error = new Error('Timeline bundle import requires a document and at least one snapshot.');
      error.code = 'invalid-timeline-bundle';
      throw error;
    }
    const documentId = input.document.id;
    const snapshotIds = new Set();
    for (const snapshot of input.snapshots) {
      if (!snapshot?.id || !snapshot?.label || !Object.prototype.hasOwnProperty.call(snapshot, 'payload')) {
        const error = new Error('Timeline bundle contains an invalid snapshot.');
        error.code = 'invalid-timeline-bundle-snapshot';
        throw error;
      }
      if (snapshotIds.has(snapshot.id)) {
        const error = new Error(`Timeline bundle has duplicate snapshot id: ${snapshot.id}`);
        error.code = 'duplicate-timeline-bundle-snapshot';
        throw error;
      }
      snapshotIds.add(snapshot.id);
    }
    const workNodes = Array.isArray(input.workNodes) ? input.workNodes : [];
    const workNodeIds = new Set();
    for (const node of workNodes) {
      if (!node?.id || !Object.prototype.hasOwnProperty.call(node, 'basePayload') || !Object.prototype.hasOwnProperty.call(node, 'workingPayload')) {
        const error = new Error('Timeline bundle contains an invalid Work Node.');
        error.code = 'invalid-timeline-bundle-work-node';
        throw error;
      }
      if (workNodeIds.has(node.id)) {
        const error = new Error(`Timeline bundle has duplicate Work Node id: ${node.id}`);
        error.code = 'duplicate-timeline-bundle-work-node';
        throw error;
      }
      workNodeIds.add(node.id);
      if (node.parentNodeId && !workNodeIds.has(node.parentNodeId) && !workNodes.some((candidate) => candidate?.id === node.parentNodeId)) {
        const error = new Error(`Timeline bundle Work Node parent is absent: ${node.parentNodeId}`);
        error.code = 'orphan-timeline-bundle-work-node';
        throw error;
      }
    }
    return transaction(() => {
      const existing = db.prepare('SELECT id FROM timeline_documents WHERE id = ?').get(documentId);
      if (existing) {
        const error = new Error(`Timeline document already exists: ${documentId}`);
        error.code = 'timeline-document-already-exists';
        error.status = 409;
        throw error;
      }
      const now = input.document.createdAt || Date.now();
      db.prepare(`
        INSERT INTO timeline_documents (id, label, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, NULL)
      `).run(documentId, input.document.label, now, now);
      const snapshots = input.snapshots.map((snapshot) => {
        const createdAt = snapshot.createdAt || now;
        const payloadHash = ensurePayload(snapshot.payload, createdAt);
        db.prepare(`
          INSERT INTO timeline_snapshots (id, timeline_id, payload_hash, label, created_at, archived_at)
          VALUES (?, ?, ?, ?, ?, NULL)
        `).run(snapshot.id, documentId, payloadHash, snapshot.label, createdAt);
        writeAuditEvent({
          timelineId: documentId,
          eventType: 'bundle.imported-snapshot',
          subjectType: 'snapshot',
          subjectId: snapshot.id,
          details: { payloadHash },
          createdAt,
        });
        return readSnapshot(db.prepare('SELECT * FROM timeline_snapshots WHERE id = ?').get(snapshot.id));
      });
      const pendingNodes = [...workNodes];
      const insertedNodeIds = new Set();
      while (pendingNodes.length) {
        const index = pendingNodes.findIndex((node) => !node.parentNodeId || insertedNodeIds.has(node.parentNodeId));
        if (index < 0) {
          const error = new Error('Timeline bundle Work Node parents contain a cycle.');
          error.code = 'cyclic-timeline-bundle-work-nodes';
          throw error;
        }
        const node = pendingNodes.splice(index, 1)[0];
        const createdAt = node.createdAt || now;
        const basePayloadHash = ensurePayload(node.basePayload, createdAt);
        const workingPayloadHash = ensurePayload(node.workingPayload, node.updatedAt || createdAt);
        db.prepare(`
          INSERT INTO timeline_work_nodes (
            id, timeline_id, parent_id, base_payload_hash, working_payload_hash, branch_id, label,
            status, approval_policy, risk_flags, logs, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(node.id, documentId, node.parentNodeId || null, basePayloadHash, workingPayloadHash,
          node.branchId || node.id, node.label || node.id, node.status || 'draft', node.approvalPolicy || 'auto-low-risk',
          serialize(node.riskFlags), serialize(node.logs), createdAt, node.updatedAt || createdAt);
        insertedNodeIds.add(node.id);
      }
      writeAuditEvent({
        timelineId: documentId,
        eventType: 'bundle.imported',
        subjectType: 'document',
        subjectId: documentId,
        details: { snapshotCount: snapshots.length, workNodeCount: workNodes.length },
        createdAt: now,
      });
      return { document: readDocument(db.prepare('SELECT * FROM timeline_documents WHERE id = ?').get(documentId)), snapshots, workNodeCount: workNodes.length };
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
      } else {
        const node = db.prepare('SELECT id FROM timeline_work_nodes WHERE id = ? AND timeline_id = ?')
          .get(input.targetId, input.timelineId);
        if (!node) throw new Error(`Timeline work node not found for checkout: ${input.targetId}`);
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
      writeAuditEvent({
        timelineId: input.timelineId,
        eventType: input.targetType === 'snapshot' ? 'snapshot.restored' : 'work-node.checked-out',
        subjectType: input.targetType,
        subjectId: input.targetId,
        details: {},
        createdAt: updatedAt,
      });
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
      writeAuditEvent({
        timelineId: snapshot.timeline_id,
        eventType: 'snapshot.archived',
        subjectType: 'snapshot',
        subjectId: snapshotId,
        details: { payloadHash: snapshot.payload_hash },
      });
      garbageCollectPayloadBlobs();
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
        INSERT INTO timeline_work_nodes (
          id, timeline_id, parent_id, base_payload_hash, working_payload_hash, branch_id, label,
          status, approval_policy, risk_flags, logs, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_id = excluded.parent_id,
          base_payload_hash = excluded.base_payload_hash,
          working_payload_hash = excluded.working_payload_hash,
          branch_id = excluded.branch_id,
          label = excluded.label,
          status = excluded.status,
          approval_policy = excluded.approval_policy,
          risk_flags = excluded.risk_flags,
          logs = excluded.logs,
          updated_at = excluded.updated_at
      `).run(input.id, input.timelineId, input.parentNodeId || null, basePayloadHash, workingPayloadHash,
        input.branchId || input.id, input.label || input.id, input.status || 'draft', input.approvalPolicy || 'auto-low-risk',
        serialize(input.riskFlags), serialize(input.logs), createdAt, input.updatedAt || createdAt);
      return { id: input.id, imported: db.prepare('SELECT 1 FROM timeline_work_nodes WHERE id = ?').get(input.id) != null };
    });
  }

  function deleteWorkNodeSubtree(nodeId) {
    return transaction(() => {
      const target = db.prepare('SELECT id, timeline_id FROM timeline_work_nodes WHERE id = ?').get(nodeId);
      if (!target) throw new Error(`Timeline work node not found: ${nodeId}`);
      const descendants = db.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM timeline_work_nodes WHERE id = ?
          UNION ALL
          SELECT node.id FROM timeline_work_nodes node JOIN subtree ON node.parent_id = subtree.id
        ) SELECT id FROM subtree
      `).all(nodeId).map((row) => row.id);
      const marks = descendants.map(() => '?').join(', ');
      const active = db.prepare(`
        SELECT target_id FROM checkout_refs WHERE timeline_id = ? AND target_type = 'work-node' AND target_id IN (${marks})
      `).get(target.timeline_id, ...descendants);
      if (active) {
        const error = new Error('Cannot delete the current Work Node path. Checkout another target first.');
        error.code = 'timeline-work-node-current-checkout-protected';
        error.status = 409;
        throw error;
      }
      db.prepare('DELETE FROM timeline_work_nodes WHERE id = ?').run(nodeId);
      writeAuditEvent({
        timelineId: target.timeline_id,
        eventType: 'work-node.deleted',
        subjectType: 'work-node',
        subjectId: nodeId,
        details: { deletedNodeIds: descendants },
      });
      garbageCollectPayloadBlobs();
      return { deletedNodeIds: descendants };
    });
  }

  return {
    databasePath,
    ensureDocument,
    createOrReuseSnapshot,
    importDocumentBundle,
    setCheckoutRef,
    appendAuditEvent,
    archiveSnapshot,
    importWorkNode,
    deleteWorkNodeSubtree,
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
    getWorkNode: (id) => {
      const row = db.prepare('SELECT * FROM timeline_work_nodes WHERE id = ?').get(id);
      if (!row) return null;
      const basePayload = parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(row.base_payload_hash)?.payload, {});
      const workingPayload = parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(row.working_payload_hash)?.payload, {});
      return {
        id: row.id, parentNodeId: row.parent_id || undefined, timelineId: row.timeline_id, branchId: row.branch_id,
        label: row.label, status: row.status, approvalPolicy: row.approval_policy,
        riskFlags: parse(row.risk_flags, []), logs: parse(row.logs, []), basePayload, workingPayload,
        baseSummary: summarizePayload(basePayload), workingSummary: summarizePayload(workingPayload),
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },
    listWorkNodes: (timelineId) => db.prepare(`
      SELECT * FROM timeline_work_nodes WHERE timeline_id = ? ORDER BY created_at ASC
    `).all(timelineId).map((row) => {
      const basePayload = parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(row.base_payload_hash)?.payload, {});
      const workingPayload = parse(db.prepare('SELECT payload FROM timeline_payload_blobs WHERE content_hash = ?').get(row.working_payload_hash)?.payload, {});
      return ({
      id: row.id,
      parentNodeId: row.parent_id || undefined,
      timelineId: row.timeline_id,
      branchId: row.branch_id,
      label: row.label,
      status: row.status,
      approvalPolicy: row.approval_policy,
      riskFlags: parse(row.risk_flags, []),
      logs: parse(row.logs, []),
      baseSummary: summarizePayload(basePayload),
      workingSummary: summarizePayload(workingPayload),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }); }),
    close: () => db.close(),
  };
}

module.exports = { createTimelineRepository };
