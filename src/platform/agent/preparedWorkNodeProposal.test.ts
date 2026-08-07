import assert from 'node:assert/strict';
import {
  isPreparedWorkNodeProposal,
  type DefPreparedWorkNodeProposalV1,
  type PreparedWorkNodeScope,
} from '../../../agent/core/contracts/prepared-work-node.ts';
import {
  buildPreparedWorkNodeProposal,
  checkPreparedScope,
  diffPreparedPayloads,
  preparedWorkNodeCandidateRefFromProposal,
  runAtomicPreparedWorkNodeApply,
  samePreparedWorkNodeCandidate,
  scopeForPreparedPath,
  sha256Json,
  validatePreparedWorkNodeCandidate,
  validatePreparedWorkNodeProposal,
} from './preparedWorkNodeProposal.ts';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;

const basePayload = {
  selectedCharacters: ['operator-a'],
  timelineData: {
    staffLines: [{
      buttons: [{ id: 'button-a', skillKey: 'operator-a-A', nodeIndex: 0, createdAt: 1 }],
      updatedAt: 1,
    }],
  },
  skillButtonTable: {
    'button-a': { id: 'button-a', selectedBuff: [], createdAt: 1 },
  },
  allBuffList: [],
  anomalyStateSnapshots: [],
  characterInputMap: {},
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
};

async function buildProposal(
  workingPayload: unknown,
  scope: readonly PreparedWorkNodeScope[] = ['timeline.structure'],
): Promise<DefPreparedWorkNodeProposalV1> {
  return buildPreparedWorkNodeProposal({
    operation: 'timeline.preview',
    proposalId: 'proposal-contract-test',
    intent: 'timeline',
    destination: 'current-timeline',
    sourceTargetId: 'source-node',
    sourceRevision: 0,
    candidateTimelineId: 'timeline-contract-test',
    nodeId: 'candidate-node',
    nodeRevision: 0,
    scope,
    sourceBinding: {
      workspaceId: 'workspace-contract-test' as never,
      databaseGeneration: 'generation-contract-test' as never,
      timelineId: 'timeline-contract-test' as never,
      checkoutTargetId: 'source-node',
      checkoutUpdatedAt: 0,
      contentRevision: 0,
      snapshotDigest: digestA,
    },
    sourceCheckout: {
      timelineId: 'timeline-contract-test',
      targetType: 'work-node',
      targetId: 'source-node',
      revision: 0,
      payloadDigest: await sha256Json(basePayload),
    },
    structuralParentNodeId: 'parent-node',
    basePayload,
    workingPayload,
  });
}

const workingPayload = structuredClone(basePayload) as typeof basePayload;
workingPayload.timelineData.staffLines[0]!.buttons[0]!.nodeIndex = 1;
workingPayload.timelineData.staffLines[0]!.buttons[0]!.updatedAt = 99;
const proposal = await buildProposal(workingPayload);
assert.equal(isPreparedWorkNodeProposal(proposal), true);
const validation = await validatePreparedWorkNodeProposal(proposal, {
  operation: 'timeline.preview',
  basePayload,
  workingPayload,
});
assert.equal(validation.ok, true);
if (validation.ok) {
  assert.deepEqual(validation.diff.changes.map((change) => change.path), [
    '/timelineData/staffLines/0/buttons/0/nodeIndex',
  ]);
}

// A legal revision of zero is accepted, and metadata-only timestamps are ignored.
assert.equal(proposal.sourceRevision, 0);
assert.equal(proposal.nodeRevision, 0);
assert.equal(proposal.review.changes.some((change) => change.path.includes('updatedAt')), false);

// Every security-relevant candidate field is covered by a tamper check.
for (const [field, replacement] of [
  ['nodeId', 'forged-node'],
  ['nodeRevision', 1],
  ['diffDigest', digestB],
  ['scope', ['buff.attachments']],
  ['basePayloadDigest', digestB],
  ['workingPayloadDigest', digestB],
  ['proposalDigest', digestB],
] as const) {
  const forged = {
    ...proposal,
    [field]: replacement,
  } as unknown;
  const result = await validatePreparedWorkNodeProposal(forged, {
    operation: 'timeline.preview',
    basePayload,
    workingPayload,
  });
  assert.equal(result.ok, false, `${field} tampering must invalidate the proposal`);
}

// Full recursive path diffs are not the legacy summary diff.
const nestedBase = { root: { first: { value: 1 }, removed: true }, unchanged: { createdAt: 1 } };
const nestedWorking = { root: { first: { value: 2 }, added: { value: 3 } }, unchanged: { createdAt: 2 } };
const nestedDiff = diffPreparedPayloads(nestedBase, nestedWorking);
assert.deepEqual(nestedDiff.changes, [
  { path: '/root/added', kind: 'added', after: { value: 3 } },
  { path: '/root/first/value', kind: 'changed', before: 1, after: 2 },
  { path: '/root/removed', kind: 'removed', before: true },
]);

// Scope matrix: every declared scope accepts only its own semantic paths.
const scopeFixtures: Array<{ scope: PreparedWorkNodeScope; payload: unknown; path: string }> = [
  {
    scope: 'timeline.structure',
    payload: {
      ...basePayload,
      timelineData: {
        ...basePayload.timelineData,
        staffLines: [{
          ...basePayload.timelineData.staffLines[0],
          buttons: [{
            ...basePayload.timelineData.staffLines[0]!.buttons[0],
            nodeIndex: 1,
          }],
        }],
      },
    },
    path: '/timelineData/staffLines/0/buttons/0/nodeIndex',
  },
  {
    scope: 'buff.attachments',
    payload: { ...basePayload, allBuffList: [{ id: 'buff-a' }] },
    path: '/allBuffList/0',
  },
  {
    scope: 'buff.resistance',
    payload: {
      ...basePayload,
      skillButtonTable: {
        'button-a': {
          ...basePayload.skillButtonTable['button-a'],
          resistanceConfig: { targetResistance: { physical: 10 } },
        },
      },
    },
    path: '/skillButtonTable/button-a/resistanceConfig/targetResistance/physical',
  },
  {
    scope: 'selection.roster',
    payload: { ...basePayload, selectedCharacters: ['operator-b'] },
    path: '/selectedCharacters/0',
  },
  {
    scope: 'loadout.config',
    payload: { ...basePayload, operatorConfigPageCache: { 'operator-a': { weapon: { id: 'weapon-a' } } } },
    path: '/operatorConfigPageCache/operator-a/weapon/id',
  },
];
for (const fixture of scopeFixtures) {
  assert.equal(scopeForPreparedPath(fixture.path), fixture.scope);
  const diff = diffPreparedPayloads(basePayload, fixture.payload);
  assert.equal(checkPreparedScope(diff, [fixture.scope]).pass, true, `${fixture.scope} should pass its own path`);
  const otherScope = scopeFixtures.find((entry) => entry.scope !== fixture.scope)!.scope;
  assert.equal(checkPreparedScope(diff, [otherScope]).pass, false, `${fixture.scope} must not pass ${otherScope}`);
}
const anomalyDiff = diffPreparedPayloads(basePayload, { ...basePayload, anomalyStateSnapshots: [{ id: 1 }] });
assert.equal(checkPreparedScope(anomalyDiff, ['timeline.structure', 'buff.attachments', 'selection.roster', 'loadout.config']).pass, true);
assert.equal(checkPreparedScope(anomalyDiff, ['timeline.structure']).pass, false);
const mixedDiff = diffPreparedPayloads(basePayload, {
  ...basePayload,
  timelineData: { changed: 'structure' },
  allBuffList: [{ id: 'buff-a' }],
});
assert.equal(checkPreparedScope(mixedDiff, ['timeline.structure']).pass, false);
assert.equal(checkPreparedScope(mixedDiff, ['timeline.structure', 'buff.attachments']).pass, true);

// Buff attachment/state fields are not timeline structure, including the
// persisted panel/segment controls and anomaly state archive.
const buffStatePayload = structuredClone(basePayload) as typeof basePayload;
buffStatePayload.skillButtonTable['button-a'] = {
  ...buffStatePayload.skillButtonTable['button-a'],
  selectedBuff: ['buff-a'],
  buffStackCounts: { 'buff-a': 2 },
  anomalyConfig: { selectedStatuses: [], selectedDamages: [], selectedStateSnapshotIds: [1] },
  panelConfig: {
    selectedBuff: ['buff-a'],
    globallyDisabledBuffIds: ['buff-a'],
    manualDisabledBuffIdsBySegmentKey: { 'normal-hit-1': ['buff-a'] },
    manualBuffStackCountsBySegmentKey: { 'normal-hit-1': { 'buff-a': 2 } },
    manualDisabledHitKeys: ['normal-hit-1'],
  },
  resistanceConfig: { targetResistance: { physical: 10 } },
};
buffStatePayload.timelineData.staffLines[0]!.buttons[0]!.buffIds = ['buff-a'];
const buffStateDiff = diffPreparedPayloads(basePayload, buffStatePayload);
assert.equal(checkPreparedScope(buffStateDiff, ['timeline.structure']).pass, false);
assert.equal(checkPreparedScope(buffStateDiff, ['buff.attachments', 'buff.resistance']).pass, true);
assert.equal(
  checkPreparedScope(
    diffPreparedPayloads(basePayload, { ...basePayload, anomalyStateSnapshots: [{ id: 1, key: 'conductive' }] }),
    ['buff.attachments'],
  ).pass,
  true,
);

// A whole button/object insertion must not hide Buff fields behind the
// aggregate object path. Timeline-only cannot accept the embedded attachment
// or resistance state, while the two Buff scopes can.
const aggregateBuffButtonDiff = diffPreparedPayloads(
  { ...basePayload, skillButtonTable: {} },
  {
    ...basePayload,
    skillButtonTable: {
      'button-b': {
        id: 'button-b',
        characterName: 'operator-a',
        skillType: 'A',
        staffIndex: 0,
        nodeIndex: 1,
        selectedBuff: ['buff-a'],
        buffStackCounts: { 'buff-a': 2 },
        panelConfig: {
          selectedBuff: ['buff-a'],
          manualDisabledBuffIdsBySegmentKey: { hit: ['buff-a'] },
        },
        resistanceConfig: { targetResistance: { physical: 10 } },
      },
    },
  },
);
assert.equal(checkPreparedScope(aggregateBuffButtonDiff, ['timeline.structure']).pass, false);
assert.equal(checkPreparedScope(aggregateBuffButtonDiff, ['buff.attachments', 'buff.resistance']).pass, false);
assert.equal(checkPreparedScope(aggregateBuffButtonDiff, ['timeline.structure', 'buff.attachments', 'buff.resistance']).pass, true);

const candidate = preparedWorkNodeCandidateRefFromProposal(proposal);
const candidateValidation = await validatePreparedWorkNodeCandidate(candidate, {
  operation: 'timeline.preview',
  basePayload,
  workingPayload,
  sourceTargetId: 'source-node',
  sourceRevision: 0,
  candidateTimelineId: 'timeline-contract-test',
  nodeId: 'candidate-node',
  nodeRevision: 0,
});
assert.equal(candidateValidation.ok, true);
assert.equal(samePreparedWorkNodeCandidate(candidate, { ...candidate }), true);
for (const field of ['nodeRevision', 'sourceTargetId', 'proposalDigest'] as const) {
  const forged = { ...candidate, [field]: field === 'nodeRevision' ? 1 : digestB } as typeof candidate;
  const forgedValidation = await validatePreparedWorkNodeCandidate(forged, {
    operation: 'timeline.preview',
    basePayload,
    workingPayload,
    sourceTargetId: 'source-node',
    sourceRevision: 0,
    candidateTimelineId: 'timeline-contract-test',
    nodeId: 'candidate-node',
    nodeRevision: 0,
  });
  assert.equal(forgedValidation.ok, false, `${field} tampering must invalidate a candidate`);
}

const atomicEvents: string[] = [];
await runAtomicPreparedWorkNodeApply({
  applyTarget: async () => { atomicEvents.push('apply'); },
  verifyVisibleTarget: async () => { atomicEvents.push('visible'); return { pass: true }; },
  persistCheckout: async () => { atomicEvents.push('checkout'); },
  persistAppliedLedger: async () => { atomicEvents.push('ledger'); return { applied: true }; },
  verifyPersistedTarget: async () => { atomicEvents.push('verify'); return { pass: true }; },
  restorePreviousState: async () => { atomicEvents.push('restore'); },
  verifyPreviousState: async () => { atomicEvents.push('verify-previous'); return { pass: true }; },
});
assert.deepEqual(atomicEvents, ['apply', 'visible', 'checkout', 'ledger', 'verify']);

const failedAtomicEvents: string[] = [];
await assert.rejects(
  runAtomicPreparedWorkNodeApply({
    applyTarget: async () => { failedAtomicEvents.push('apply'); },
    verifyVisibleTarget: async () => ({ pass: true }),
    persistCheckout: async () => { failedAtomicEvents.push('checkout'); throw new Error('persist failed'); },
    persistAppliedLedger: async () => ({ applied: true }),
    verifyPersistedTarget: async () => ({ pass: true }),
    restorePreviousState: async () => { failedAtomicEvents.push('restore'); },
    verifyPreviousState: async () => { failedAtomicEvents.push('verify-previous'); return { pass: true }; },
  }),
  /persist failed.*已恢复 live checkout/,
);
assert.deepEqual(failedAtomicEvents, ['apply', 'checkout', 'restore', 'verify-previous']);

console.log('[preparedWorkNodeProposal.test] all assertions passed');
