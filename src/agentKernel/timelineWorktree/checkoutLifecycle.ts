import type { AiTimelineWorkNodeCommitListItem, AiTimelineWorkNodeStatus } from './types';

export type TimelineWorkNodeCheckoutLifecyclePlan = {
  commit: AiTimelineWorkNodeCommitListItem | null;
  createCommit: boolean;
  markCheckoutApplied: boolean;
  reuseAppliedCommit: boolean;
};

export function planTimelineWorkNodeCheckoutLifecycle(input: {
  nodeStatus: AiTimelineWorkNodeStatus;
  commits: AiTimelineWorkNodeCommitListItem[];
  requestedCommitId?: string;
}): TimelineWorkNodeCheckoutLifecyclePlan {
  const ordered = [...input.commits].sort((left, right) => right.createdAt - left.createdAt);
  const requested = input.requestedCommitId
    ? ordered.find((commit) => commit.id === input.requestedCommitId) || null
    : null;
  const commit = requested || ordered[0] || null;
  const reuseAppliedCommit = input.nodeStatus === 'applied' && commit?.checkoutApplied === true;

  return {
    commit,
    createCommit: !commit || (commit.checkoutApplied && !reuseAppliedCommit),
    markCheckoutApplied: !reuseAppliedCommit,
    reuseAppliedCommit,
  };
}
