import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTimelineBundleV2,
  type TimelineSnapshotPayload,
} from '../utils/timelineSnapshotStorage';
import {
  resolveTimelineBundleCheckoutPayload,
  validateDesktopTimelineBundle,
} from './tacticalShareInterop';

function payload(marker: string): TimelineSnapshotPayload {
  return {
    selectedCharacters: [marker],
    timelineData: {
      version: '1.1.0',
      createdAt: 100,
      updatedAt: 100,
      staffLines: [],
    },
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

test('desktop share resolves the displayed work node without discarding the rest of the tree', async () => {
  const snapshotPayload = payload('snapshot-root');
  const workNodePayload = payload('displayed-work-node');
  const bundle = await buildTimelineBundleV2({
    timelineId: 'timeline-share-test',
    label: '完整节点树',
    snapshot: {
      id: 'snapshot-root',
      label: '根快照',
      createdAt: 100,
      summary: { characterCount: 1, buttonCount: 0, buffCount: 0 },
      payload: snapshotPayload,
    },
    workNodes: [{
      id: 'work-node-current',
      branchId: 'branch-main',
      label: '当前工作节点',
      status: 'open',
      approvalPolicy: 'manual',
      riskFlags: [],
      logs: [],
      createdAt: 101,
      updatedAt: 102,
      basePayload: snapshotPayload,
      workingPayload: workNodePayload,
    }],
    checkoutRef: {
      targetType: 'work-node',
      targetId: 'work-node-current',
      updatedAt: 102,
    },
    scope: 'document',
  });

  const parsed = await validateDesktopTimelineBundle(bundle);
  assert.equal(parsed.snapshots.length, 1);
  assert.equal(parsed.workNodes?.length, 1);
  assert.deepEqual(
    resolveTimelineBundleCheckoutPayload(parsed)?.selectedCharacters,
    ['displayed-work-node'],
  );
});

test('desktop share rejects a worktree changed after its manifest hash was created', async () => {
  const source = payload('original');
  const bundle = await buildTimelineBundleV2({
    timelineId: 'timeline-share-tamper-test',
    label: '校验测试',
    snapshot: {
      id: 'snapshot-original',
      label: '原始快照',
      createdAt: 200,
      summary: { characterCount: 1, buttonCount: 0, buffCount: 0 },
      payload: source,
    },
    scope: 'snapshot',
  });
  bundle.payloads[0].selectedCharacters = ['tampered'];

  await assert.rejects(validateDesktopTimelineBundle(bundle), /完整节点树校验失败/);
});
