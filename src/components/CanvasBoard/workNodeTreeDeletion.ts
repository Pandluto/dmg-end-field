export type WorkNodeDeletionCheckoutPlan = {
  checkoutTargetId: string;
  blocksDeletion: boolean;
};

export function planWorkNodeDeletionCheckout(input: {
  deletedNodeIds: string[];
  persistedCheckoutNodeId: string;
  selectedNodeId: string;
  parentNodeId: string;
}): WorkNodeDeletionCheckoutPlan {
  const deletedIds = new Set(input.deletedNodeIds);
  if (!input.persistedCheckoutNodeId || !deletedIds.has(input.persistedCheckoutNodeId)) {
    return { checkoutTargetId: '', blocksDeletion: false };
  }

  const candidates = [input.selectedNodeId, input.parentNodeId];
  const checkoutTargetId = candidates.find((nodeId) => nodeId && !deletedIds.has(nodeId)) || '';
  return {
    checkoutTargetId,
    blocksDeletion: !checkoutTargetId,
  };
}
