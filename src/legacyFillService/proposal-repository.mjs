import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Digest } from './canonical-json.mjs';

const SCHEMA_VERSION = 1;
const DOMAINS = new Set(['buff', 'weapon', 'operator', 'equipment']);

export class LegacyFillRepositoryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LegacyFillRepositoryError';
    this.code = code;
    this.details = details;
    this.status = code.includes('conflict') || code === 'pending-proposals-blocking' ? 409 : code.includes('not-found') ? 404 : 400;
  }
}

function assertText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new LegacyFillRepositoryError(`invalid-${field}`, `${field} must be a non-empty string`);
  return value.trim();
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapProposal(row) {
  if (!row) return null;
  return {
    proposalId: row.proposal_id,
    ownerNamespace: row.owner_namespace,
    domain: row.domain,
    schemaVersion: row.schema_version,
    snapshotId: row.snapshot_id,
    baseIdentity: row.base_identity,
    baseRevision: row.base_revision,
    baseContentHash: row.base_content_hash,
    normalized: parseJson(row.payload_json, {}),
    validation: parseJson(row.validation_json, {}),
    review: parseJson(row.review_manifest_json, {}),
    manifestDigest: row.manifest_digest,
    requestDigest: row.request_digest,
    summary: row.summary,
    approvalStatus: row.approval_status,
    saveStatus: row.save_status,
    lifecycleStatus: row.lifecycle_status,
    staleBase: Boolean(row.stale_base),
    staleReason: row.stale_reason || '',
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshot(row) {
  if (!row) return null;
  return {
    snapshotId: row.snapshot_id,
    domain: row.domain,
    schemaVersion: row.schema_version,
    revision: row.revision,
    contentHash: row.content_hash,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

export function createLegacyFillProposalRepository(options) {
  const databasePath = path.resolve(assertText(options?.databasePath, 'database-path'));
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`PRAGMA busy_timeout = ${Math.max(100, Number(options?.busyTimeoutMs || 5000))}`);

  function migrate() {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS fill_schema_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_version INTEGER NOT NULL,
          migrated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS fill_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          domain TEXT NOT NULL CHECK (domain IN ('buff','weapon','operator','equipment')),
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          content_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(domain, revision)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS fill_proposals (
          proposal_id TEXT PRIMARY KEY,
          owner_namespace TEXT NOT NULL,
          domain TEXT NOT NULL CHECK (domain IN ('buff','weapon','operator','equipment')),
          schema_version INTEGER NOT NULL,
          snapshot_id TEXT NOT NULL,
          base_identity TEXT NOT NULL,
          base_revision INTEGER NOT NULL,
          base_content_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          validation_json TEXT NOT NULL,
          review_manifest_json TEXT NOT NULL,
          manifest_digest TEXT NOT NULL,
          request_digest TEXT NOT NULL,
          summary TEXT NOT NULL,
          approval_status TEXT NOT NULL DEFAULT 'Wait' CHECK (approval_status IN ('Wait','Yes','No')),
          save_status TEXT NOT NULL DEFAULT 'Wait' CHECK (save_status IN ('Wait','Yes','No')),
          lifecycle_status TEXT NOT NULL DEFAULT 'pending' CHECK (lifecycle_status IN ('pending','claimed','approved','rejected','applied','cancelled','stale')),
          stale_base INTEGER NOT NULL DEFAULT 0 CHECK (stale_base IN (0,1)),
          stale_reason TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (snapshot_id) REFERENCES fill_snapshots(snapshot_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS fill_proposals_owner_updated_idx ON fill_proposals(owner_namespace, updated_at DESC, proposal_id);
        CREATE TABLE IF NOT EXISTS fill_proposal_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_id TEXT NOT NULL,
          owner_namespace TEXT NOT NULL,
          event_type TEXT NOT NULL,
          proposal_revision INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (proposal_id) REFERENCES fill_proposals(proposal_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS fill_proposal_events_proposal_idx ON fill_proposal_events(proposal_id, event_id);
        CREATE TRIGGER IF NOT EXISTS fill_proposal_events_no_update BEFORE UPDATE ON fill_proposal_events BEGIN SELECT RAISE(ABORT, 'fill proposal events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS fill_proposal_events_no_delete BEFORE DELETE ON fill_proposal_events BEGIN SELECT RAISE(ABORT, 'fill proposal events are append-only'); END;
        CREATE TABLE IF NOT EXISTS fill_idempotency_keys (
          owner_namespace TEXT NOT NULL,
          operation TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          request_digest TEXT NOT NULL,
          proposal_id TEXT NOT NULL,
          response_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (owner_namespace, operation, idempotency_key),
          FOREIGN KEY (proposal_id) REFERENCES fill_proposals(proposal_id)
        ) WITHOUT ROWID, STRICT;
      `);
      options?.beforeMigrationCommit?.(database);
      database.prepare(`INSERT INTO fill_schema_meta(singleton, schema_version, migrated_at) VALUES(1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET schema_version=excluded.schema_version, migrated_at=excluded.migrated_at`)
        .run(SCHEMA_VERSION, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      database.close();
      throw error;
    }
  }

  migrate();

  function transaction(action) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function publishSnapshot(input) {
    const domain = assertText(input?.domain, 'domain');
    if (!DOMAINS.has(domain)) throw new LegacyFillRepositoryError('invalid-domain', `Unsupported fill domain: ${domain}`);
    const snapshotId = assertText(input?.snapshotId, 'snapshot-id');
    const payloadJson = canonicalJson(input?.payload ?? {});
    const contentHash = input?.contentHash || sha256Digest(input?.payload ?? {});
    const createdAt = input?.createdAt || new Date().toISOString();
    database.prepare(`INSERT INTO fill_snapshots(snapshot_id, domain, schema_version, revision, content_hash, payload_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)`)
      .run(snapshotId, domain, Number(input?.schemaVersion || 1), Number(input?.revision), contentHash, payloadJson, createdAt);
    return getSnapshot(snapshotId);
  }

  function getSnapshot(snapshotId) {
    return mapSnapshot(database.prepare('SELECT * FROM fill_snapshots WHERE snapshot_id = ?').get(snapshotId));
  }

  function latestSnapshot(domain) {
    return mapSnapshot(database.prepare('SELECT * FROM fill_snapshots WHERE domain = ? ORDER BY revision DESC LIMIT 1').get(domain));
  }

  function createProposal(input) {
    const ownerNamespace = assertText(input?.ownerNamespace, 'owner-namespace');
    const idempotencyKey = assertText(input?.idempotencyKey, 'idempotency-key');
    const domain = assertText(input?.domain, 'domain');
    if (!DOMAINS.has(domain)) throw new LegacyFillRepositoryError('invalid-domain', `Unsupported fill domain: ${domain}`);
    const operation = 'proposal.create';
    const requestDigest = input?.requestDigest || sha256Digest({
      domain, schemaVersion: input?.schemaVersion, baseSnapshot: input?.baseSnapshot,
      normalized: input?.normalized, intent: input?.intent || '', evidence: input?.evidence || [],
    });

    return transaction(() => {
      const prior = database.prepare(`SELECT * FROM fill_idempotency_keys
        WHERE owner_namespace = ? AND operation = ? AND idempotency_key = ?`)
        .get(ownerNamespace, operation, idempotencyKey);
      if (prior) {
        if (prior.request_digest !== requestDigest) {
          throw new LegacyFillRepositoryError('idempotency-conflict', 'The idempotency key was already used for a different request', {
            ownerNamespace, idempotencyKey,
          });
        }
        return { ...parseJson(prior.response_json, {}), duplicate: true };
      }

      if (input?.rejectIfOwnerPending) {
        const pending = database.prepare(`SELECT proposal_id FROM fill_proposals
          WHERE owner_namespace = ? AND lifecycle_status IN ('pending','claimed') LIMIT 1`).get(ownerNamespace);
        if (pending) throw new LegacyFillRepositoryError('pending-proposals-blocking', 'pending proposals block another fill.apply', { proposalId: pending.proposal_id });
      }

      const snapshot = getSnapshot(assertText(input?.baseSnapshot?.snapshotId, 'snapshot-id'));
      if (!snapshot || snapshot.domain !== domain) throw new LegacyFillRepositoryError('snapshot-not-found', 'Base snapshot does not exist for this domain');
      if (snapshot.revision !== Number(input.baseSnapshot.revision) || snapshot.contentHash !== input.baseSnapshot.contentHash) {
        throw new LegacyFillRepositoryError('snapshot-identity-mismatch', 'Base snapshot revision/content hash mismatch');
      }
      const proposalId = input?.proposalId || `fill-proposal-${crypto.randomUUID()}`;
      const createdAt = input?.createdAt || new Date().toISOString();
      const normalized = input?.normalized ?? {};
      const summary = typeof input?.summary === 'string' ? input.summary : `${domain} proposal`;
      const review = input?.review || {
        contract: 'ProposalReviewManifestV1', domain, targetId: input?.targetId || '', summary,
        baseSnapshot: input.baseSnapshot, payloadDigest: sha256Digest(normalized), schemaVersion: Number(input?.schemaVersion || 1),
      };
      const manifestDigest = input?.manifestDigest || review.manifestDigest || sha256Digest(review);
      if (review.manifestDigest && review.manifestDigest !== manifestDigest) {
        throw new LegacyFillRepositoryError('manifest-digest-mismatch', 'Review manifest digest does not match proposal manifest digest');
      }
      database.prepare(`INSERT INTO fill_proposals(
        proposal_id, owner_namespace, domain, schema_version, snapshot_id, base_identity, base_revision,
        base_content_hash, payload_json, validation_json, review_manifest_json, manifest_digest,
        request_digest, summary, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          proposalId, ownerNamespace, domain, Number(input?.schemaVersion || 1), snapshot.snapshotId,
          input?.baseIdentity || `${domain}:${input?.targetId || ''}`, snapshot.revision, snapshot.contentHash,
          canonicalJson(normalized), canonicalJson(input?.validation || { valid: true, errors: [], warnings: [] }),
          canonicalJson(review), manifestDigest, requestDigest, summary, createdAt, createdAt,
        );
      database.prepare(`INSERT INTO fill_proposal_events(proposal_id, owner_namespace, event_type, proposal_revision, event_json, created_at)
        VALUES(?, ?, 'proposal.created', 1, ?, ?)`)
        .run(proposalId, ownerNamespace, canonicalJson({ requestDigest, manifestDigest }), createdAt);
      const response = { created: true, duplicate: false, proposal: inspectProposal(ownerNamespace, proposalId) };
      database.prepare(`INSERT INTO fill_idempotency_keys(owner_namespace, operation, idempotency_key, request_digest, proposal_id, response_json, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`)
        .run(ownerNamespace, operation, idempotencyKey, requestDigest, proposalId, canonicalJson(response), createdAt);
      return response;
    });
  }

  function listProposals(ownerNamespace, options = {}) {
    assertText(ownerNamespace, 'owner-namespace');
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    const rows = database.prepare(`SELECT * FROM fill_proposals WHERE owner_namespace = ?
      ORDER BY updated_at DESC, proposal_id LIMIT ?`).all(ownerNamespace, limit);
    return rows.map(mapProposal);
  }

  function inspectProposal(ownerNamespace, proposalId) {
    return mapProposal(database.prepare('SELECT * FROM fill_proposals WHERE owner_namespace = ? AND proposal_id = ?').get(ownerNamespace, proposalId));
  }

  function proposalEvents(ownerNamespace, proposalId) {
    return database.prepare(`SELECT event_id AS eventId, proposal_id AS proposalId, owner_namespace AS ownerNamespace,
      event_type AS eventType, proposal_revision AS proposalRevision, event_json AS eventJson, created_at AS createdAt
      FROM fill_proposal_events WHERE owner_namespace = ? AND proposal_id = ? ORDER BY event_id`).all(ownerNamespace, proposalId)
      .map((event) => ({ ...event, event: parseJson(event.eventJson, {}) }));
  }

  function updateProposal(input) {
    const ownerNamespace = assertText(input?.ownerNamespace, 'owner-namespace');
    const proposalId = assertText(input?.proposalId, 'proposal-id');
    const expectedRevision = Number(input?.expectedRevision);
    const eventType = assertText(input?.eventType, 'event-type');
    return transaction(() => {
      const current = inspectProposal(ownerNamespace, proposalId);
      if (!current) throw new LegacyFillRepositoryError('proposal-not-found', 'Proposal not found for owner');
      if (current.revision !== expectedRevision) throw new LegacyFillRepositoryError('proposal-revision-conflict', 'Proposal revision changed', { expectedRevision, actualRevision: current.revision });
      const patch = input?.patch || {};
      const nextRevision = expectedRevision + 1;
      const result = database.prepare(`UPDATE fill_proposals SET lifecycle_status = ?, approval_status = ?, save_status = ?,
        stale_base = ?, stale_reason = ?, revision = ?, updated_at = ?
        WHERE owner_namespace = ? AND proposal_id = ? AND revision = ?`)
        .run(
          patch.lifecycleStatus || current.lifecycleStatus,
          patch.approvalStatus || current.approvalStatus,
          patch.saveStatus || current.saveStatus,
          patch.staleBase === undefined ? Number(current.staleBase) : Number(Boolean(patch.staleBase)),
          patch.staleReason === undefined ? current.staleReason : String(patch.staleReason),
          nextRevision, input?.updatedAt || new Date().toISOString(), ownerNamespace, proposalId, expectedRevision,
        );
      if (result.changes !== 1) throw new LegacyFillRepositoryError('proposal-revision-conflict', 'Proposal revision changed during update');
      database.prepare(`INSERT INTO fill_proposal_events(proposal_id, owner_namespace, event_type, proposal_revision, event_json, created_at)
        VALUES(?, ?, ?, ?, ?, ?)`)
        .run(proposalId, ownerNamespace, eventType, nextRevision, canonicalJson(input?.event || {}), input?.updatedAt || new Date().toISOString());
      return inspectProposal(ownerNamespace, proposalId);
    });
  }

  function markStale(input) {
    return updateProposal({ ...input, eventType: 'proposal.base-stale', patch: { lifecycleStatus: 'stale', staleBase: true, staleReason: input?.reason || 'base revision changed' }, event: { reason: input?.reason || 'base revision changed' } });
  }

  function exportAudit() {
    return {
      contract: 'LegacyFillAuditExportV1', schemaVersion: SCHEMA_VERSION,
      snapshots: database.prepare('SELECT * FROM fill_snapshots ORDER BY created_at, snapshot_id').all().map(mapSnapshot),
      proposals: database.prepare('SELECT * FROM fill_proposals ORDER BY created_at, proposal_id').all().map(mapProposal),
      events: database.prepare('SELECT * FROM fill_proposal_events ORDER BY event_id').all().map((row) => ({ ...row, event: parseJson(row.event_json, {}) })),
      idempotency: database.prepare('SELECT owner_namespace, operation, idempotency_key, request_digest, proposal_id, created_at FROM fill_idempotency_keys ORDER BY created_at').all(),
    };
  }

  function diagnostics() {
    return {
      databasePath,
      schemaVersion: SCHEMA_VERSION,
      foreignKeys: database.prepare('PRAGMA foreign_keys').get().foreign_keys,
      journalMode: database.prepare('PRAGMA journal_mode').get().journal_mode,
      busyTimeoutMs: database.prepare('PRAGMA busy_timeout').get().timeout,
    };
  }

  return Object.freeze({
    databasePath, schemaVersion: SCHEMA_VERSION, publishSnapshot, getSnapshot, latestSnapshot,
    createProposal, listProposals, inspectProposal, proposalEvents, updateProposal, markStale, exportAudit, diagnostics,
    close: () => database.close(),
  });
}
