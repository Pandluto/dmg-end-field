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
  scopeForPreparedPath,
  sha256Json,
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
assert.equal(checkPreparedScope(anomalyDiff, ['timeline.structure', 'buff.attachments', 'selection.roster', 'loadout.config']).pass, false);
const mixedDiff = diffPreparedPayloads(basePayload, {
  ...basePayload,
  timelineData: { changed: 'structure' },
  allBuffList: [{ id: 'buff-a' }],
});
assert.equal(checkPreparedScope(mixedDiff, ['timeline.structure']).pass, false);
assert.equal(checkPreparedScope(mixedDiff, ['timeline.structure', 'buff.attachments']).pass, true);

console.log('[preparedWorkNodeProposal.test] all assertions passed');
