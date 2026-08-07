import assert from 'node:assert/strict';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  AI_TIMELINE_NODE_SOURCE_FILES,
  buildAiTimelineNodeReviewDiffs,
  buildAiTimelineNodeReviewProjection,
  buildAiTimelineNodeSource,
} from './nodeReview';
import type { AiTimelineWorkNode } from './types';

function payload(): TimelineSnapshotPayload {
  const button = {
    id: 'button-a',
    characterId: 'operator-a',
    characterName: '测试员',
    skillType: 'A' as const,
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: 0,
    nodeNumber: 1,
    position: { x: 80, y: 60 },
    selectedBuff: ['buff-a'],
    buffIds: ['buff-a'],
  };
  return {
    selectedCharacters: ['operator-a'],
    timelineData: {
      version: '1.0.0',
      createdAt: 10,
      updatedAt: 10,
      staffLines: [{
        staffIndex: 0,
        characterName: '测试员',
        occupiedNodes: [0],
        buttons: [button],
      }],
    },
    skillButtonTable: { [button.id]: button },
    allBuffList: [{ id: 'buff-a', name: '测试 Buff', displayName: '测试 Buff', refCount: 1 }],
    anomalyStateSnapshots: [],
    characterInputMap: { 'operator-a': { weapon: { name: '测试武器' } } },
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: { 'operator-a': { weapon: { name: '测试武器' } } },
  } as TimelineSnapshotPayload;
}

function node(basePayload: TimelineSnapshotPayload, workingPayload: TimelineSnapshotPayload): AiTimelineWorkNode {
  return {
    id: 'node-a',
    timelineId: 'timeline-a',
    branchId: 'branch-a',
    createdAt: 10,
    updatedAt: 20,
    contentRevision: 3,
    label: '测试节点',
    description: '节点审查测试',
    status: 'ready',
    basePayload,
    workingPayload,
    baseSummary: { characterCount: 1, buttonCount: 1, buffCount: 1 },
    workingSummary: { characterCount: 1, buttonCount: 1, buffCount: 1 },
    approvalPolicy: 'ask-on-risk',
    riskFlags: [{ id: 'risk-a', severity: 'warning', code: 'test-risk', message: '测试风险' }],
    logs: [],
  };
}

const base = payload();
const working = payload();
working.selectedCharacters = ['operator-a', 'operator-b'];
const changedResistance = { physicalResistance: 25 };
working.timelineData = {
  ...working.timelineData,
  staffLines: [{
    ...working.timelineData.staffLines[0],
    buttons: [{ ...working.timelineData.staffLines[0].buttons[0], resistanceConfig: { targetResistance: changedResistance } }],
  }],
};
working.skillButtonTable = {
  ...working.skillButtonTable,
  'button-a': { ...working.skillButtonTable['button-a'], resistanceConfig: { targetResistance: changedResistance } },
};
working.allBuffList = [{ id: 'buff-b', name: '新增 Buff', displayName: '新增 Buff', refCount: 1 }];
working.timelineData.staffLines[0].buttons[0] = {
  ...working.timelineData.staffLines[0].buttons[0],
  selectedBuff: ['buff-b'],
  buffIds: ['buff-b'],
};
working.skillButtonTable['button-a'] = {
  ...working.skillButtonTable['button-a'],
  selectedBuff: ['buff-b'],
  buffIds: ['buff-b'],
};
working.characterInputMap = { 'operator-a': { weapon: { name: '新武器' } } };
working.operatorConfigPageCache = { 'operator-a': { weapon: { name: '新武器' } } };

const files = buildAiTimelineNodeReviewDiffs(base, working);
assert.deepEqual(AI_TIMELINE_NODE_SOURCE_FILES, ['selection.json', 'timeline.json', 'buffs.json', 'inputs.json']);
assert.deepEqual(files.map((file) => file.file), [
  'node/working/selection.json',
  'node/working/timeline.json',
  'node/working/buffs.json',
  'node/working/inputs.json',
]);
for (const file of files) {
  assert(file.before.endsWith('\n'));
  assert(file.after.endsWith('\n'));
  assert(file.additions > 0);
  assert(file.deletions > 0);
}

const source = buildAiTimelineNodeSource(base);
assert.deepEqual(source.selection.selectedCharacters, ['operator-a']);
assert.equal(source.timeline.staffLines.length, 1);
assert.equal(source.buffs.allBuffList.length, 1);
assert.equal(source.inputs.characterInputMap['operator-a'].weapon.name, '测试武器');

const review = buildAiTimelineNodeReviewProjection(node(base, working), {
  timelineId: 'timeline-a',
  targetType: 'work-node',
  targetId: 'node-a',
});
assert.equal(review.bound, true);
assert(review.report);
assert.equal(review.report.manifest.nodeId, 'node-a');
assert.equal(review.report.manifest.revision, 3);
assert.equal(review.report.validation.valid, true);
assert.equal(review.report.validation.ok, true);
assert.equal(review.report.semanticDiff.changes.length, 5);
assert.equal(review.report.risk.riskFlags[0].code, 'test-risk');
assert.equal(review.report.risk.checkoutDecision.requiresManualApproval, true);

const unbound = buildAiTimelineNodeReviewProjection(node(base, base), null);
assert.equal(unbound.bound, false);
assert.equal(unbound.diffs.length, 0);
assert.equal(unbound.report?.semanticDiff.changes.length, 0);

console.log('node review helper tests passed');
