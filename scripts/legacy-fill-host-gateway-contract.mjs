import assert from 'node:assert/strict';
import { digestLegacyFillValue } from '../src/legacyFillCore/index.ts';
import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS } from '../src/legacyFillHost/browserGateway.ts';

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.failWrites = false; this.corruptWrites = false; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) { this.failWrites = false; throw new Error('injected writer failure'); }
    this.values.set(key, this.corruptWrites ? '{"corrupt":true}' : String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

const storage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.buff.current]: JSON.stringify({ id: 'current', name: 'Current', items: {} }),
  [LEGACY_FILL_STORAGE_KEYS.buff.library]: JSON.stringify({ existing: { id: 'existing', name: 'Existing', items: {} } }),
});
const events = [];
let id = 0;
const gateway = createLegacyFillBrowserHostGateway({
  storage,
  now: () => new Date('2026-07-19T00:00:00.000Z'),
  makeId: () => `fixture-${++id}`,
  emit: (event) => events.push(event),
});

const first = await gateway.publishSnapshot();
const stable = await gateway.publishSnapshot();
assert.equal(stable.domains.buff.revision, first.domains.buff.revision);
assert.equal(stable.domains.buff.contentHash, first.domains.buff.contentHash);
assert.equal('timelineId' in first, false);
assert.equal(JSON.stringify(first).includes('sessionId'), false);

const normalized = { id: 'new-buff', name: 'New Buff', items: {} };
const review = {
  contract: 'ProposalReviewManifestV1', domain: 'buff', targetId: 'new-buff', summary: 'buff new-buff',
  baseSnapshot: { snapshotId: first.snapshotId, revision: first.domains.buff.revision, contentHash: first.domains.buff.contentHash },
  payloadDigest: await digestLegacyFillValue(normalized), schemaVersion: 1,
};
const proposal = {
  proposalId: 'proposal-1', ownerNamespace: 'install-a:profile-main', domain: 'buff', revision: 1,
  manifestDigest: await digestLegacyFillValue(review), review, normalized,
  baseRevision: first.domains.buff.revision, baseContentHash: first.domains.buff.contentHash,
};

assert.throws(() => gateway.internal.claimProposal({}, proposal), /Host authority required/);
const claimed = gateway.internal.claimProposal(gateway.internal.authority, proposal);
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: proposal.proposalId, reviewSessionId: claimed.reviewSessionId, decision: 'approved' });
const applied = await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal, reviewSessionId: claimed.reviewSessionId, expectedRevision: 1, expectedManifestDigest: proposal.manifestDigest,
});
assert.equal(applied.ok, true);
assert.equal(JSON.parse(storage.getItem(LEGACY_FILL_STORAGE_KEYS.buff.library))['new-buff'].name, 'New Buff');
assert.equal(JSON.parse(storage.getItem(LEGACY_FILL_STORAGE_KEYS.buff.current)).id, 'new-buff');
assert.equal(applied.snapshot.domains.buff.revision, first.domains.buff.revision + 1);
assert.equal(events.filter((event) => event.type === 'legacy-fill.library.changed').length, 1);

const staleClaim = gateway.internal.claimProposal(gateway.internal.authority, { ...proposal, proposalId: 'proposal-stale' });
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: 'proposal-stale', reviewSessionId: staleClaim.reviewSessionId, decision: 'approved' });
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal: { ...proposal, proposalId: 'proposal-stale' }, reviewSessionId: staleClaim.reviewSessionId,
  expectedRevision: 1, expectedManifestDigest: proposal.manifestDigest,
})).code, 'proposal-base-stale');

const badDigest = { ...proposal, proposalId: 'proposal-digest', manifestDigest: 'sha256:bad' };
const badClaim = gateway.internal.claimProposal(gateway.internal.authority, badDigest);
gateway.internal.recordDecision(gateway.internal.authority, { proposalId: badDigest.proposalId, reviewSessionId: badClaim.reviewSessionId, decision: 'approved' });
assert.equal((await gateway.internal.applyReviewedProposal(gateway.internal.authority, {
  proposal: badDigest, reviewSessionId: badClaim.reviewSessionId, expectedRevision: 1, expectedManifestDigest: 'sha256:bad',
})).code, 'proposal-manifest-digest-invalid');

const beforeInvalidation = await gateway.publishSnapshot();
gateway.internal.invalidateForNowStorageForceApply(gateway.internal.authority);
const afterInvalidation = await gateway.publishSnapshot();
assert.equal(afterInvalidation.domains.buff.revision, beforeInvalidation.domains.buff.revision + 1);

const failingStorage = new MemoryStorage({
  [LEGACY_FILL_STORAGE_KEYS.operator.current]: JSON.stringify({ id: 'operator-1' }),
  [LEGACY_FILL_STORAGE_KEYS.operator.library]: JSON.stringify({}),
});
const failingGateway = createLegacyFillBrowserHostGateway({ storage: failingStorage, makeId: () => 'fail' });
const failingSnapshot = await failingGateway.publishSnapshot();
const failingNormalized = { id: 'operator-2', name: 'Operator 2' };
const failingReview = { domain: 'operator', targetId: 'operator-2' };
const failingProposal = {
  proposalId: 'proposal-fail', ownerNamespace: 'owner', domain: 'operator', revision: 1,
  manifestDigest: await digestLegacyFillValue(failingReview), review: failingReview, normalized: failingNormalized,
  baseRevision: failingSnapshot.domains.operator.revision, baseContentHash: failingSnapshot.domains.operator.contentHash,
};
const failingClaim = failingGateway.internal.claimProposal(failingGateway.internal.authority, failingProposal);
failingGateway.internal.recordDecision(failingGateway.internal.authority, { proposalId: failingProposal.proposalId, reviewSessionId: failingClaim.reviewSessionId, decision: 'approved' });
failingStorage.failWrites = true;
const failedWrite = await failingGateway.internal.applyReviewedProposal(failingGateway.internal.authority, {
  proposal: failingProposal, reviewSessionId: failingClaim.reviewSessionId, expectedRevision: 1,
  expectedManifestDigest: failingProposal.manifestDigest,
});
assert.equal(failedWrite.code, 'host-write-postcondition-failed');
assert.equal(failingStorage.getItem(LEGACY_FILL_STORAGE_KEYS.operator.library), '{}');
process.stdout.write('[legacy-fill-host-gateway-contract] passed\n');
