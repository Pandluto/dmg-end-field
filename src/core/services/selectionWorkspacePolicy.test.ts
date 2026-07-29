import assert from 'node:assert/strict';
import {
  classifySelectionWorkspaceTransition,
  resolveSelectionHorizontalParentId,
} from './selectionWorkspacePolicy';

assert.equal(classifySelectionWorkspaceTransition([], ['a']), 'new-temporary-workspace');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), 'unchanged');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['a', 'e', 'f', 'g']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['e', 'f', 'g']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']), 'new-temporary-workspace');

assert.equal(resolveSelectionHorizontalParentId('node-current', 'node-parent'), 'node-parent');
assert.equal(resolveSelectionHorizontalParentId('node-root', null), null);
assert.equal(resolveSelectionHorizontalParentId(null, 'node-parent'), null);
