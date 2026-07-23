import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bindTransactionContext } = require('./context.cjs');
const { BusinessTransactionStore } = require('./transactions.cjs');

function fixture() {
  const sessionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-business-transaction-'));
  const binding = {
    host: 'workbench',
    sessionID: 'session-a',
    directory: sessionDirectory,
    timelineId: 'timeline-a',
    axisBindingId: 'axis-a',
  };
  const axisContext = {
    document: { id: 'timeline-a' },
    checkout: { targetType: 'work-node', targetId: 'node-a', updatedAt: 10 },
    nodes: [{ id: 'node-a', updatedAt: 20 }],
  };
  const context = bindTransactionContext({ binding, axisContext });
  const store = new BusinessTransactionStore({ sessionDirectory });
  return { sessionDirectory, binding, axisContext, context, store };
}

function createLoadout(store, context, version = 'v1') {
  return store.create({
    context,
    businessId: 'loadout',
    operation: 'preview',
    harnessRevision: { version, contentHash: `hash-${version}` },
    target: '别礼',
    constraints: ['3+1', '潮涌'],
    phase: 'context',
  });
}

test('persists context, evidence, proposal and trace across store recovery', () => {
  const { sessionDirectory, context, store } = fixture();
  const transaction = createLoadout(store, context);
  store.addEvidence(transaction.transactionId, {
    source: 'operator-guide',
    referenceId: 'guide-bieli',
    sectionId: 'build',
    contentHash: 'guide-hash',
    applicability: '别礼 3+1',
  });
  store.lockForConfirmation(transaction.transactionId, {
    proposal: { id: 'proposal-a', token: 'proposal-token-a' },
    artifact: { id: 'artifact-a', sourceRevision: 'catalog-1' },
    capability: { required: true, token: 'capability-a' },
  });
  const recoveredStore = new BusinessTransactionStore({ sessionDirectory });
  const recovered = recoveredStore.get(transaction.transactionId);
  assert.equal(recovered.status, 'awaiting-confirmation');
  assert.equal(recovered.harnessRevision.version, 'v1');
  assert.equal(recovered.evidenceRefs[0].contentHash, 'guide-hash');
  assert.equal(recovered.proposal.token, 'proposal-token-a');
  assert.equal(recoveredStore.trace.read(transaction.transactionId).events[0].type, 'transaction-created');
  assert.throws(() => recoveredStore.addEvidence(transaction.transactionId, {
    source: 'other-guide', referenceId: 'other', contentHash: 'other-hash',
  }), { code: 'HARNESS_EVIDENCE_LOCKED' });
});

test('supersedes corrected proposals without mutating the original chain', () => {
  const { context, store } = fixture();
  const original = createLoadout(store, context);
  store.lockForConfirmation(original.transactionId, { proposal: { id: 'proposal-a', token: 'token-a' } });
  const result = store.supersede(original.transactionId, {
    context,
    businessId: 'loadout',
    operation: 'preview',
    harnessRevision: { version: 'v1', contentHash: 'hash-v1' },
    target: '别礼',
    constraints: ['不用悬河供氧栓'],
    phase: 'context',
  });
  assert.equal(result.superseded.status, 'superseded');
  assert.equal(result.replacement.status, 'active');
  assert.notEqual(result.replacement.transactionId, original.transactionId);
  assert.equal(store.get(original.transactionId).proposal.token, 'token-a');
});

test('marks changed schemes stale and missing capabilities aborted on recovery', async () => {
  const { context, store } = fixture();
  const stale = createLoadout(store, context);
  store.lockForConfirmation(stale.transactionId, { proposal: { id: 'proposal-a', token: 'token-a' } });
  const missing = createLoadout(store, context);
  store.lockForConfirmation(missing.transactionId, {
    proposal: { id: 'proposal-b', token: 'token-b' },
    capability: { required: true, token: 'capability-b' },
  });

  await store.recover({
    context,
    referenceAvailable: async (kind, reference) => !(kind === 'capability' && reference.token === 'capability-b'),
  });
  assert.equal(store.get(missing.transactionId).status, 'aborted');

  const changed = { ...context, schemeVersion: 'new-scheme-version' };
  await store.recover({ context: changed });
  assert.equal(store.get(stale.transactionId).status, 'stale');
});

test('pins the original Revision and revokes only matching unfinished transactions', async () => {
  const { context, store } = fixture();
  const v1 = createLoadout(store, context, 'v1');
  const v2 = createLoadout(store, context, 'v2');
  await store.recover({
    context,
    isRevisionRevoked: (businessId, version) => businessId === 'loadout' && version === 'v1',
  });
  assert.equal(store.get(v1.transactionId).status, 'revoked');
  assert.equal(store.get(v2.transactionId).status, 'active');
  assert.equal(store.get(v2.transactionId).harnessRevision.version, 'v2');
});
