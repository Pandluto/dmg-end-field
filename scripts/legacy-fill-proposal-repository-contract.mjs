import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLegacyFillProposalRepository, LegacyFillRepositoryError } from '../src/legacyFillService/proposal-repository.mjs';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fill-repository-'));
const databasePath = path.join(tempRoot, 'legacy-fill.sqlite3');
const failedMigrationPath = path.join(tempRoot, 'failed-migration.sqlite3');
const repositorySource = fs.readFileSync(path.resolve('src/legacyFillService/proposal-repository.mjs'), 'utf8');
for (const forbidden of ['timeline-repository', 'ai-timeline-worknodes', 'DEF_INTERNAL_GOVERNANCE_TOKEN', 'localStorage', 'now-storage']) {
  assert.equal(repositorySource.includes(forbidden), false, `isolated proposal repository contains ${forbidden}`);
}
const baseSnapshot = { snapshotId: 'snapshot-buff-1', revision: 1, contentHash: 'sha256:snapshot-1' };
const createInput = {
  ownerNamespace: 'install-a:profile-main', idempotencyKey: 'create-1', domain: 'buff', schemaVersion: 1,
  baseSnapshot, baseIdentity: 'buff:fixture', targetId: 'fixture', normalized: { id: 'fixture', name: 'Fixture', items: {} },
  validation: { valid: true, errors: [], warnings: [] }, summary: 'buff fixture', createdAt: '2026-07-19T00:00:00.000Z',
};

try {
  assert.throws(() => createLegacyFillProposalRepository({
    databasePath: failedMigrationPath,
    beforeMigrationCommit: () => { throw new Error('injected migration failure'); },
  }), /injected migration failure/);
  const failedDb = new DatabaseSync(failedMigrationPath);
  assert.equal(failedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'fill_%'").get().count, 0);
  failedDb.close();

  let repository = createLegacyFillProposalRepository({ databasePath, busyTimeoutMs: 2000 });
  assert.deepEqual(repository.diagnostics(), {
    databasePath, schemaVersion: 1, foreignKeys: 1, journalMode: 'wal', busyTimeoutMs: 2000,
  });
  repository.publishSnapshot({ domain: 'buff', schemaVersion: 1, ...baseSnapshot, payload: { current: null, library: {} }, createdAt: '2026-07-19T00:00:00.000Z' });

  const created = repository.createProposal(createInput);
  assert.equal(created.created, true);
  assert.equal(created.duplicate, false);
  assert.equal(created.proposal.revision, 1);
  assert.equal(created.proposal.approvalStatus, 'Wait');
  assert.equal(created.proposal.saveStatus, 'Wait');

  const duplicate = repository.createProposal(createInput);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.proposal.proposalId, created.proposal.proposalId);
  assert.throws(() => repository.createProposal({ ...createInput, normalized: { id: 'different' } }), (error) => error instanceof LegacyFillRepositoryError && error.code === 'idempotency-conflict');
  assert.equal(repository.listProposals('install-b:profile-main').length, 0);
  assert.equal(repository.inspectProposal('install-b:profile-main', created.proposal.proposalId), null);

  const claimed = repository.updateProposal({
    ownerNamespace: createInput.ownerNamespace, proposalId: created.proposal.proposalId, expectedRevision: 1,
    eventType: 'proposal.claimed', patch: { lifecycleStatus: 'claimed' }, event: { reviewSessionId: 'review-fixture' },
    updatedAt: '2026-07-19T00:00:01.000Z',
  });
  assert.equal(claimed.revision, 2);
  assert.throws(() => repository.updateProposal({
    ownerNamespace: createInput.ownerNamespace, proposalId: created.proposal.proposalId, expectedRevision: 1,
    eventType: 'proposal.claimed', patch: { lifecycleStatus: 'claimed' },
  }), (error) => error.code === 'proposal-revision-conflict');

  assert.throws(() => repository.updateProposal({
    ownerNamespace: createInput.ownerNamespace, proposalId: created.proposal.proposalId, expectedRevision: 2,
    eventType: 'proposal.invalid', patch: { lifecycleStatus: 'not-a-state' },
  }), /CHECK constraint failed/);
  assert.equal(repository.inspectProposal(createInput.ownerNamespace, created.proposal.proposalId).revision, 2, 'failed transaction rolled back');

  const stale = repository.markStale({
    ownerNamespace: createInput.ownerNamespace, proposalId: created.proposal.proposalId, expectedRevision: 2,
    reason: 'host snapshot revision advanced', updatedAt: '2026-07-19T00:00:02.000Z',
  });
  assert.equal(stale.staleBase, true);
  assert.equal(stale.lifecycleStatus, 'stale');
  assert.deepEqual(repository.proposalEvents(createInput.ownerNamespace, created.proposal.proposalId).map((event) => event.eventType), [
    'proposal.created', 'proposal.claimed', 'proposal.base-stale',
  ]);
  assert.equal(repository.exportAudit().proposals.length, 1);
  repository.close();

  repository = createLegacyFillProposalRepository({ databasePath });
  assert.equal(repository.inspectProposal(createInput.ownerNamespace, created.proposal.proposalId).revision, 3, 'restart persistence');
  const secondConnection = createLegacyFillProposalRepository({ databasePath });
  const concurrentDuplicate = secondConnection.createProposal(createInput);
  assert.equal(concurrentDuplicate.duplicate, true);
  assert.equal(repository.listProposals(createInput.ownerNamespace).length, 1);
  secondConnection.close();
  repository.close();

  const raw = new DatabaseSync(databasePath);
  assert.throws(() => raw.prepare('UPDATE fill_proposal_events SET event_type = ? WHERE event_id = 1').run('tampered'), /append-only/);
  raw.close();
  process.stdout.write('[legacy-fill-proposal-repository-contract] passed\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
