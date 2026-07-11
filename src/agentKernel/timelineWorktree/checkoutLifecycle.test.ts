import assert from 'node:assert/strict';
import { planTimelineWorkNodeCheckoutLifecycle } from './checkoutLifecycle';
import type { AiTimelineWorkNodeCommitListItem } from './types';

const commit = (overrides: Partial<AiTimelineWorkNodeCommitListItem> = {}): AiTimelineWorkNodeCommitListItem => ({
  id: 'commit-1',
  nodeId: 'node-1',
  timelineId: 'timeline-1',
  branchId: 'branch-1',
  createdAt: 1,
  label: 'Commit 1',
  summary: {
    addedButtonCount: 0, removedButtonCount: 0, changedButtonCount: 0,
    addedBuffCount: 0, removedBuffCount: 0,
    beforeButtonCount: 0, afterButtonCount: 0,
    beforeBuffCount: 0, afterBuffCount: 0,
  },
  riskFlags: [],
  approval: { mode: 'manual', approvedAt: 1, approvedBy: 'user', rationale: 'test' },
  checkoutApplied: true,
  ...overrides,
});

assert.deepEqual(planTimelineWorkNodeCheckoutLifecycle({
  nodeStatus: 'applied',
  commits: [commit()],
}), {
  commit: commit(),
  createCommit: false,
  markCheckoutApplied: false,
  reuseAppliedCommit: true,
});

assert.equal(planTimelineWorkNodeCheckoutLifecycle({
  nodeStatus: 'ready',
  commits: [commit()],
}).createCommit, true);

assert.equal(planTimelineWorkNodeCheckoutLifecycle({
  nodeStatus: 'committed',
  commits: [commit({ checkoutApplied: false })],
}).markCheckoutApplied, true);

assert.equal(planTimelineWorkNodeCheckoutLifecycle({
  nodeStatus: 'ready',
  commits: [],
}).createCommit, true);

console.log('timeline work node checkout lifecycle planning passed');
