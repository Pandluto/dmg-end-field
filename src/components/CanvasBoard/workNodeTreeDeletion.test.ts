import assert from 'node:assert/strict';
import { planWorkNodeDeletionCheckout } from './workNodeTreeDeletion';

assert.deepEqual(planWorkNodeDeletionCheckout({
  deletedNodeIds: ['node-2'],
  persistedCheckoutNodeId: 'node-2',
  selectedNodeId: 'node-1',
  parentNodeId: 'node-1',
}), { checkoutTargetId: 'node-1', blocksDeletion: false });

assert.deepEqual(planWorkNodeDeletionCheckout({
  deletedNodeIds: ['node-2', 'node-3'],
  persistedCheckoutNodeId: 'node-3',
  selectedNodeId: 'node-3',
  parentNodeId: 'node-1',
}), { checkoutTargetId: 'node-1', blocksDeletion: false });

assert.deepEqual(planWorkNodeDeletionCheckout({
  deletedNodeIds: ['node-2'],
  persistedCheckoutNodeId: 'node-1',
  selectedNodeId: 'node-2',
  parentNodeId: 'node-1',
}), { checkoutTargetId: '', blocksDeletion: false });

assert.deepEqual(planWorkNodeDeletionCheckout({
  deletedNodeIds: ['node-1', 'node-2'],
  persistedCheckoutNodeId: 'node-2',
  selectedNodeId: 'node-1',
  parentNodeId: '',
}), { checkoutTargetId: '', blocksDeletion: true });

console.log('work node tree deletion checkout planning passed');
