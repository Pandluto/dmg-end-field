import assert from 'node:assert/strict';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  buildReviewedWorkNodeDeletionIdentity,
  buildReviewedWorkNodeIdentity,
  buildWorkNodePayloadPostcondition,
  runAtomicWorkNodeRestore,
  verifyReviewedWorkNodeDeletionIdentity,
  verifyReviewedWorkNodeIdentity,
  verifyWorkNodeDeleteLedger,
  WorkNodeAtomicRestoreError,
} from './workNodeAtomicSettlement';

function payload(buttonId = 'button-1'): TimelineSnapshotPayload {
  const button = {
    id: buttonId,
    characterId: 'operator-1',
    characterName: '干员一',
    skillType: 'B' as const,
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: 16,
    nodeNumber: 17,
    position: { x: 1, y: 2 },
    selectedBuff: ['buff-1'],
    buffStackCounts: { 'buff-1': 2 },
    resistanceConfig: { targetResistance: { physicalResistance: 25, fireResistance: 10 } },
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    selectedCharacters: ['operator-1'],
    timelineData: {
      version: '1',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [{
        staffIndex: 0,
        characterName: '干员一',
        occupiedNodes: [16],
        buttons: [{ ...button, buffIds: ['buff-1'] }],
      }],
    },
    skillButtonTable: { [buttonId]: button },
    allBuffList: [{ id: 'buff-1', name: '测试 Buff', displayName: '测试 Buff', refCount: 1 } as never],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {
      'operator-1': { operator: { name: '干员一' }, weapon: { id: 'weapon-1' }, equipment: { pieces: [] } },
    } as never,
  };
}

// A delete review covers the complete subtree and invalidates when a child is
// added or any reviewed node receives a newer revision/metadata timestamp.
{
  const nodes = [
    {
      id: 'root', timelineId: 'timeline-a', parentNodeId: null, contentRevision: 0,
      updatedAt: 10, label: 'Root', status: 'ready', riskFlags: [],
    },
    {
      id: 'child', timelineId: 'timeline-a', parentNodeId: 'root', contentRevision: 2,
      updatedAt: 20, label: 'Child', status: 'open', riskFlags: [],
    },
    {
      id: 'unrelated', timelineId: 'timeline-a', parentNodeId: null, contentRevision: 4,
      updatedAt: 30, label: 'Other', status: 'ready', riskFlags: [],
    },
    {
      id: 'cross-timeline', timelineId: 'timeline-b', parentNodeId: 'root', contentRevision: 1,
      updatedAt: 40, label: 'Cross', status: 'ready', riskFlags: [],
    },
  ];
  const reviewed = await buildReviewedWorkNodeDeletionIdentity({ nodeId: 'root', nodes });
  assert.equal(reviewed.nodeRevision, 0);
  assert.deepEqual(reviewed.subtreeNodeIds, ['child', 'root']);
  assert.equal(reviewed.subtreeNodeCount, 2);
  assert.match(reviewed.subtreeDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(verifyReviewedWorkNodeDeletionIdentity({ expected: reviewed, observed: reviewed }).pass, true);

  const changed = await buildReviewedWorkNodeDeletionIdentity({
    nodeId: 'root',
    nodes: [
      ...nodes.map((node) => node.id === 'root'
        ? { ...node, contentRevision: 1, updatedAt: 11 }
        : node),
      {
        id: 'grandchild', timelineId: 'timeline-a', parentNodeId: 'child', contentRevision: 0,
        updatedAt: 50, label: 'Grandchild', status: 'open', riskFlags: [],
      },
    ],
  });
  const verification = verifyReviewedWorkNodeDeletionIdentity({ expected: reviewed, observed: changed });
  assert.equal(verification.pass, false);
  assert.match(verification.reason || '', /nodeRevision/u);
  assert.match(verification.reason || '', /subtreeNodeCount/u);
  assert.match(verification.reason || '', /subtreeDigest/u);
}

function noOpVerification(pass = true) {
  return async () => ({ pass, ...(pass ? {} : { reason: 'injected visible mismatch' }) });
}

// markRollbackApplied failure must restore both the old in-memory page and the
// old checkout before the command is rejected.
{
  let page = 'candidate';
  let checkout = 'candidate';
  await assert.rejects(
    runAtomicWorkNodeRestore({
      applyTarget: async () => { page = 'base'; },
      verifyVisibleTarget: noOpVerification(),
      persistCheckout: async () => { checkout = 'base'; },
      persistRollbackLedger: async () => ({ rollbackApplied: false }),
      verifyPersistedTarget: noOpVerification(),
      restorePreviousState: async () => { page = 'candidate'; checkout = 'candidate'; },
      verifyPreviousState: async () => ({ pass: page === 'candidate' && checkout === 'candidate' }),
    }),
    (error: unknown) => {
      assert(error instanceof WorkNodeAtomicRestoreError);
      assert.match(error.message, /rollback ledger/u);
      return true;
    },
  );
  assert.equal(page, 'candidate');
  assert.equal(checkout, 'candidate');
}

// A visible postcondition failure uses the same recovery path even though the
// formal SQLite checkout has not been written yet.
{
  let page = 'candidate';
  let restored = false;
  await assert.rejects(
    runAtomicWorkNodeRestore({
      applyTarget: async () => { page = 'base'; },
      verifyVisibleTarget: noOpVerification(false),
      persistCheckout: async () => { throw new Error('must not persist'); },
      persistRollbackLedger: async () => ({ rollbackApplied: true }),
      verifyPersistedTarget: noOpVerification(),
      restorePreviousState: async () => { page = 'candidate'; restored = true; },
      verifyPreviousState: async () => ({ pass: page === 'candidate' }),
    }),
    /injected visible mismatch/u,
  );
  assert.equal(restored, true);
  assert.equal(page, 'candidate');
}

// Successful restore requires every phase, including the final persisted
// receipt, and leaves the target state in place.
{
  const events: string[] = [];
  await runAtomicWorkNodeRestore({
    applyTarget: async () => { events.push('apply'); },
    verifyVisibleTarget: async () => { events.push('visible'); return { pass: true }; },
    persistCheckout: async () => { events.push('checkout'); },
    persistRollbackLedger: async () => { events.push('ledger'); return { rollbackApplied: true }; },
    verifyPersistedTarget: async () => { events.push('final'); return { pass: true }; },
    restorePreviousState: async () => { events.push('restore'); },
    verifyPreviousState: async () => { events.push('verify-restore'); return { pass: true }; },
  });
  assert.deepEqual(events, ['apply', 'visible', 'checkout', 'ledger', 'final']);
}

// If the second rollback check fails, the returned error contains both the
// primary operation failure and the recovery failure.
{
  await assert.rejects(
    runAtomicWorkNodeRestore({
      applyTarget: async () => undefined,
      verifyVisibleTarget: async () => ({ pass: false, reason: 'primary visible failure' }),
      persistCheckout: async () => undefined,
      persistRollbackLedger: async () => ({ rollbackApplied: true }),
      verifyPersistedTarget: noOpVerification(),
      restorePreviousState: async () => { throw new Error('rollback write failure'); },
      verifyPreviousState: noOpVerification(),
    }),
    (error: unknown) => {
      assert(error instanceof WorkNodeAtomicRestoreError);
      assert.match(error.message, /primary visible failure/u);
      assert.match(error.message, /rollback write failure/u);
      assert(error.rollbackError);
      return true;
    },
  );
}

// Deleting only the parent is not a successful subtree deletion.
{
  const result = verifyWorkNodeDeleteLedger({
    requestedNodeId: 'parent',
    expectedDeletedNodeIds: ['parent', 'child'],
    remainingNodeIds: ['child', 'unrelated'],
  });
  assert.equal(result.pass, false);
  assert.deepEqual(result.deletedNodeIds, ['parent']);
  assert.equal(verifyWorkNodeDeleteLedger({
    requestedNodeId: 'parent',
    expectedDeletedNodeIds: ['parent'],
    remainingNodeIds: [],
    actualDeletedNodeIds: ['parent', 'unrelated'],
  }).pass, false);
}

// A use/checkout receipt with the wrong checkout target is rejected even when
// every payload byte is otherwise equal.
{
  const expected = payload();
  const result = await buildWorkNodePayloadPostcondition({
    expectedPayload: expected,
    actualPayload: structuredClone(expected),
    expectedCheckout: { targetType: 'work-node', targetId: 'node-a' },
    observedCheckout: { targetType: 'work-node', targetId: 'node-b' },
    expectedNodeRevision: 7,
    observedNodeRevision: 8,
  });
  assert.equal(result.pass, false);
  assert(result.failures.includes('checkout target 不一致'));
  assert(result.failures.includes('checkout node revision 不一致'));
}

// Approval is bound to the exact reviewed revision, working payload and diff.
// Reusing the review after any one of those values changes must fail closed.
{
  const reviewedPayload = payload();
  const identity = await buildReviewedWorkNodeIdentity({
    nodeId: 'node-reviewed',
    timelineId: 'timeline-a',
    nodeRevision: 0,
    workingPayload: reviewedPayload,
    diffChanges: [{ path: 'timelineData.staffLines[0]', kind: 'added' }],
  });
  assert.equal(identity.nodeRevision, 0);
  assert.match(identity.workingPayloadDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(verifyReviewedWorkNodeIdentity({ expected: identity, observed: identity }).pass, true);

  const editedPayload = structuredClone(reviewedPayload);
  editedPayload.skillButtonTable['button-1'].buffStackCounts = { 'buff-1': 9 };
  const editedIdentity = await buildReviewedWorkNodeIdentity({
    nodeId: identity.nodeId,
    timelineId: identity.timelineId,
    nodeRevision: 1,
    workingPayload: editedPayload,
    diffChanges: [{ path: 'skillButtonTable.button-1.buffStackCounts', kind: 'changed' }],
  });
  const verification = verifyReviewedWorkNodeIdentity({ expected: identity, observed: editedIdentity });
  assert.equal(verification.pass, false);
  assert.match(verification.reason || '', /nodeRevision/u);
  assert.match(verification.reason || '', /workingPayloadDigest/u);
  assert.match(verification.reason || '', /diffDigest/u);
}

// The receipt also rejects a payload that only changes one of the sensitive
// paths; timestamps are the only intentionally ignored fields.
{
  const expected = payload();
  const actual = structuredClone(expected);
  actual.timelineData.staffLines[0].occupiedNodes = [17];
  actual.skillButtonTable['button-1'].buffStackCounts = { 'buff-1': 3 };
  actual.skillButtonTable['button-1'].resistanceConfig = {
    targetResistance: { physicalResistance: 40, fireResistance: 10 },
  };
  actual.operatorConfigPageCache['operator-1'].weapon = { id: 'weapon-2' } as never;
  const result = await buildWorkNodePayloadPostcondition({
    expectedPayload: expected,
    actualPayload: actual,
  });
  assert.equal(result.pass, false);
  assert(result.failures.includes('timeline digest 不一致'));
  assert(result.failures.includes('Buff 状态不一致'));
  assert(result.failures.includes('抗性状态不一致'));
  assert(result.failures.includes('operator config 不一致'));
}

console.log('Work Node atomic restore/delete/use settlement contract: PASS');
