import assert from 'node:assert/strict';
import { planWorkNodePathOmission, WorkNodeTopologyError } from './workNodeTopology';

const nodes = [
  { id: 'A' },
  { id: 'B', parentNodeId: 'A' },
  { id: 'C', parentNodeId: 'B' },
  { id: 'D', parentNodeId: 'C' },
  { id: 'E', parentNodeId: 'D' },
  { id: 'F', parentNodeId: 'E' },
  { id: 'C-side', parentNodeId: 'C' },
];

assert.deepEqual(planWorkNodePathOmission(nodes, 'B', 'E'), {
  omittedNodeIds: ['B', 'C', 'D', 'E'],
  predecessorNodeId: 'A',
  boundaryChildNodeIds: ['F', 'C-side'],
});

assert.deepEqual(planWorkNodePathOmission(nodes, 'E', 'B'), {
  omittedNodeIds: ['B', 'C', 'D', 'E'],
  predecessorNodeId: 'A',
  boundaryChildNodeIds: ['F', 'C-side'],
});

assert.deepEqual(planWorkNodePathOmission(nodes, 'C'), {
  omittedNodeIds: ['C'],
  predecessorNodeId: 'B',
  boundaryChildNodeIds: ['D', 'C-side'],
});

assert.throws(
  () => planWorkNodePathOmission(nodes, 'A', 'C'),
  (error) => error instanceof WorkNodeTopologyError && error.code === 'work-node-topology-root-protected',
);

assert.throws(
  () => planWorkNodePathOmission(nodes, 'C-side'),
  (error) => error instanceof WorkNodeTopologyError && error.code === 'work-node-topology-no-retained-successor',
);

assert.throws(
  () => planWorkNodePathOmission(nodes, 'C-side', 'F'),
  (error) => error instanceof WorkNodeTopologyError && error.code === 'work-node-topology-unrelated-endpoints',
);

console.log('work node path omission planning passed');
