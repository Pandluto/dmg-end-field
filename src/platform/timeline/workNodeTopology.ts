export type WorkNodeTopologyItem = {
  id: string;
  parentNodeId?: string;
};

export type WorkNodePathOmissionPlan = {
  /** Inclusive ancestor -> descendant path selected for omission. */
  omittedNodeIds: string[];
  predecessorNodeId: string;
  /** Retained children that must be lifted to the predecessor. */
  boundaryChildNodeIds: string[];
};

export class WorkNodeTopologyError extends Error {
  constructor(
    readonly code:
      | 'work-node-topology-node-not-found'
      | 'work-node-topology-unrelated-endpoints'
      | 'work-node-topology-root-protected'
      | 'work-node-topology-no-retained-successor',
    message: string,
  ) {
    super(message);
    this.name = 'WorkNodeTopologyError';
  }
}

function pathFromAncestor(
  byId: Map<string, WorkNodeTopologyItem>,
  ancestorId: string,
  descendantId: string,
): string[] | null {
  const reversed: string[] = [];
  let current = byId.get(descendantId);
  while (current) {
    reversed.push(current.id);
    if (current.id === ancestorId) return reversed.reverse();
    current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
  }
  return null;
}

/**
 * Plan an inclusive path contraction. Endpoints may be supplied in either
 * order, but they must be on the same ancestor chain. Side branches are not
 * deleted: every retained child leaving the selected path is lifted to the
 * predecessor.
 */
export function planWorkNodePathOmission(
  nodes: WorkNodeTopologyItem[],
  firstNodeId: string,
  secondNodeId = firstNodeId,
): WorkNodePathOmissionPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const first = byId.get(firstNodeId);
  const second = byId.get(secondNodeId);
  if (!first || !second) {
    throw new WorkNodeTopologyError(
      'work-node-topology-node-not-found',
      '选择的节点已经不存在，请刷新节点树后重试。',
    );
  }

  const forward = pathFromAncestor(byId, first.id, second.id);
  const backward = forward ? null : pathFromAncestor(byId, second.id, first.id);
  const omittedNodeIds = forward || backward;
  if (!omittedNodeIds) {
    throw new WorkNodeTopologyError(
      'work-node-topology-unrelated-endpoints',
      '只能省略同一条父子路径上的连续节点。',
    );
  }

  const firstOmitted = byId.get(omittedNodeIds[0])!;
  if (!firstOmitted.parentNodeId || !byId.has(firstOmitted.parentNodeId)) {
    throw new WorkNodeTopologyError(
      'work-node-topology-root-protected',
      '根节点没有可承接路径的父节点，不能省略。',
    );
  }

  const omitted = new Set(omittedNodeIds);
  const boundaryChildNodeIds = nodes
    .filter((node) => node.parentNodeId && omitted.has(node.parentNodeId) && !omitted.has(node.id))
    .map((node) => node.id);
  if (boundaryChildNodeIds.length === 0) {
    throw new WorkNodeTopologyError(
      'work-node-topology-no-retained-successor',
      '所选路径没有保留的后续节点；请改用“删除以下路径”。',
    );
  }

  return {
    omittedNodeIds,
    predecessorNodeId: firstOmitted.parentNodeId,
    boundaryChildNodeIds,
  };
}
