import assert from 'node:assert/strict';
import {
  assertAgentWorkNodeCommandTimelineBoundary,
  enqueueMainWorkbenchCommand,
  enqueueMainWorkbenchCommands,
  executeAgentProductCatalogCommand,
  getPendingMainWorkbenchCommands,
  patchMainWorkbenchCommand,
  projectMainWorkbenchWorkNodeListToTimeline,
  readMainWorkbenchCommandQueue,
  type MainWorkbenchCommand,
  type QueuedMainWorkbenchCommand,
  writeMainWorkbenchCommandQueue,
} from './mainWorkbenchControl';

writeMainWorkbenchCommandQueue([]);

const first = enqueueMainWorkbenchCommand(
  { op: 'refreshSnapshot' },
  'contract-test',
  'command-refresh',
);
assert.equal(first.status, 'pending');
assert.equal(first.source, 'contract-test');
assert.equal(readMainWorkbenchCommandQueue().length, 1);
assert.deepEqual(
  getPendingMainWorkbenchCommands(['refreshSnapshot']).map((entry) => entry.id),
  ['command-refresh'],
);
assert.deepEqual(getPendingMainWorkbenchCommands(['calculateDamage']), []);

const duplicate = enqueueMainWorkbenchCommand(
  { op: 'calculateDamage' },
  'duplicate-must-not-replace',
  'command-refresh',
);
assert.deepEqual(
  {
    id: duplicate.id,
    command: duplicate.command,
    status: duplicate.status,
    source: duplicate.source,
    createdAt: duplicate.createdAt,
    updatedAt: duplicate.updatedAt,
  },
  first,
  'a retried command id must remain idempotent',
);
assert.equal(readMainWorkbenchCommandQueue().length, 1);

const running = patchMainWorkbenchCommand('command-refresh', { status: 'running' });
assert.equal(running?.status, 'running');
assert.equal(getPendingMainWorkbenchCommands(['refreshSnapshot']).length, 0);

const result = { refreshed: true, selectedCharacterCount: 4 };
const done = patchMainWorkbenchCommand('command-refresh', { status: 'done', result });
assert.equal(done?.status, 'done');
assert.deepEqual(done?.result, result);
assert.equal(done?.error, undefined);
assert.deepEqual(readMainWorkbenchCommandQueue()[0].result, result);

assert.equal(
  patchMainWorkbenchCommand('missing-command', { status: 'error', error: 'missing' }),
  null,
  'settling an unknown command must be a no-op',
);

const batch = enqueueMainWorkbenchCommands([
  { op: 'refreshOperatorConfig' },
  { op: 'calculateDamage' },
  { op: 'listTimelineSnapshots' },
], 'batch-contract');
assert.equal(batch.length, 3);
assert.equal(new Set(batch.map((entry) => entry.batchId)).size, 1);
assert.deepEqual(batch.map((entry) => entry.batchIndex), [0, 1, 2]);
assert.deepEqual(batch.map((entry) => entry.batchSize), [3, 3, 3]);
assert.deepEqual(
  getPendingMainWorkbenchCommands(['calculateDamage', 'listTimelineSnapshots'])
    .map((entry) => entry.command.op),
  ['calculateDamage', 'listTimelineSnapshots'],
);

const failed = patchMainWorkbenchCommand(batch[0].id, {
  status: 'error',
  error: '[operator-config-target-required] missing target',
});
assert.equal(failed?.status, 'error');
assert.equal(failed?.error, '[operator-config-target-required] missing target');
assert.equal(
  getPendingMainWorkbenchCommands(['refreshOperatorConfig']).length,
  0,
  'error results must not be claimed again',
);

const storageReads: string[] = [];
const emptyCatalogStorage = {
  getItem(key: string): string | null {
    storageReads.push(key);
    return null;
  },
};
const catalogQueryResult = executeAgentProductCatalogCommand({
  op: 'queryAgentProductCatalog',
  action: 'query',
  domain: 'operators',
  limit: 2,
}, emptyCatalogStorage);
assert.equal(catalogQueryResult.ok, true);
assert.equal(catalogQueryResult.readOnly, true);
assert.equal(catalogQueryResult.source, 'browser-sqlite-mirror');
assert.deepEqual((catalogQueryResult.payload as { results: unknown[] }).results, []);
assert.ok(storageReads.length > 0, 'catalog command must read browser persistent storage');

const buildGuideResult = executeAgentProductCatalogCommand({
  op: 'queryAgentProductCatalog',
  action: 'buildGuide',
  operatorQuery: '洛茜',
}, emptyCatalogStorage);
assert.equal(
  (buildGuideResult.payload as { evidence: { status: string } }).evidence.status,
  'evidenceUnavailable',
);

const discoveryResult = executeAgentProductCatalogCommand({
  op: 'queryAgentProductCatalog',
  action: 'discoverGearTopologies',
  limit: 4,
  combinationsPerSet: 2,
}, emptyCatalogStorage);
assert.equal(
  (discoveryResult.payload as { ranking: string }).ranking,
  'unranked-facts-only',
);

const skillFactResult = executeAgentProductCatalogCommand({
  op: 'queryAgentProductCatalog',
  action: 'skillFact',
  operatorQuery: '洛茜',
  skillQuery: 'A',
  hitQuery: '主伤害',
}, emptyCatalogStorage);
assert.equal(
  (skillFactResult.payload as { state: string }).state,
  'OPERATOR_UNRESOLVED',
);

const phase2ExpectedBinding = {
  workspaceId: 'workspace-two-timeline',
  databaseGeneration: 'generation-two-timeline',
  timelineId: 'timeline-a',
  checkoutTargetId: 'node-a',
  checkoutUpdatedAt: 200,
  contentRevision: 100,
  snapshotDigest: 'sha256:timeline-a',
} as NonNullable<Parameters<typeof enqueueMainWorkbenchCommand>[3]>;
const persistedAgentCommand = enqueueMainWorkbenchCommand(
  { op: 'listAiTimelineWorkNodes' },
  'agent-host',
  'command-list-current-timeline',
  phase2ExpectedBinding,
);
assert.deepEqual(
  readMainWorkbenchCommandQueue().find((entry) => entry.id === persistedAgentCommand.id)?.phase2ExpectedBinding,
  phase2ExpectedBinding,
  'the accepted Phase 2 expected binding must survive the renderer queue boundary',
);

const twoTimelineNodes = [
  { id: 'node-a', timelineId: 'timeline-a' },
  { id: 'node-b', timelineId: 'timeline-b' },
];
const projectedList = projectMainWorkbenchWorkNodeListToTimeline({
  ok: true as const,
  nodes: twoTimelineNodes,
  commits: [
    { id: 'commit-a', nodeId: 'node-a' },
    { id: 'commit-b', nodeId: 'node-b' },
  ],
  heads: {
    a: { nodeId: 'node-a', revision: 1 },
    b: { nodeId: 'node-b', revision: 2 },
  },
  headNodeId: 'node-b',
}, 'timeline-a');
assert.deepEqual(projectedList.nodes.map((node) => node.id), ['node-a']);
assert.deepEqual(projectedList.commits.map((commit) => commit.id), ['commit-a']);
assert.deepEqual(Object.keys(projectedList.heads), ['a']);
assert.equal(projectedList.headNodeId, 'node-a', 'a foreign global head must be replaced by a current-timeline head');

const crossTimelineCommands: MainWorkbenchCommand[] = [
  { op: 'readAiTimelineWorkNode', nodeId: 'node-b' },
  { op: 'diffAiTimelineWorkNode', nodeId: 'node-b' },
  { op: 'validateAiTimelineWorkNode', nodeId: 'node-b', repairStatus: true },
  { op: 'deleteAiTimelineWorkNode', nodeId: 'node-b' },
  {
    op: 'checkoutAiTimelineWorkNode',
    nodeId: 'node-b',
    approval: { mode: 'manual', approvedBy: 'user' },
  },
  {
    op: 'restoreAiTimelineWorkNodeBase',
    nodeId: 'node-b',
    approval: { mode: 'manual', approvedBy: 'user' },
  },
];
const liveState = {
  'timeline-a': { checkoutTargetId: 'node-a', payload: { buttons: ['a'] } },
  'timeline-b': { checkoutTargetId: 'node-b', payload: { buttons: ['b'] } },
};
const originalLiveState = structuredClone(liveState);
const readTwoTimelineNode = async (nodeId: string) => {
  const node = twoTimelineNodes.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`missing fixture node: ${nodeId}`);
  return node;
};
for (const command of crossTimelineCommands) {
  const entry: Pick<QueuedMainWorkbenchCommand, 'source' | 'command' | 'phase2ExpectedBinding'> = {
    source: 'agent-host',
    command,
    phase2ExpectedBinding,
  };
  await assert.rejects(async () => {
    await assertAgentWorkNodeCommandTimelineBoundary({
      entry,
      activeTimelineId: 'timeline-a',
      readNode: readTwoTimelineNode,
    });
    liveState['timeline-a'] = { checkoutTargetId: 'node-b', payload: { buttons: ['b'] } };
  }, /agent-worknode-timeline-mismatch/);
  assert.deepEqual(
    liveState,
    originalLiveState,
    `${command.op} must reject before either timeline checkout/payload can change`,
  );
}

console.log('Main Workbench command queue lifecycle contract: PASS');
