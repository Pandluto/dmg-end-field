import assert from 'node:assert/strict';
import {
  classifySelectionWorkspaceTransition,
  resolveSelectionHorizontalParentId,
} from './selectionWorkspacePolicy';
import { validateMainWorkbenchCommand } from '../../agentKernel/mainWorkbench/commandSchema';

assert.equal(classifySelectionWorkspaceTransition([], ['a']), 'new-temporary-workspace');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), 'unchanged');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['a', 'e', 'f', 'g']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['e', 'f', 'g']), 'horizontal-branch');
assert.equal(classifySelectionWorkspaceTransition(['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']), 'new-temporary-workspace');

assert.equal(resolveSelectionHorizontalParentId('node-current', 'node-parent'), 'node-parent');
assert.equal(resolveSelectionHorizontalParentId('node-root', null), null);
assert.equal(resolveSelectionHorizontalParentId(null, 'node-parent'), null);

assert.equal(validateMainWorkbenchCommand({
  op: 'selectCharacters',
  characterIds: ['a', 'b'],
}).ok, false);
assert.equal(validateMainWorkbenchCommand({
  op: 'selectCharacters',
  characterIds: ['a', 'b'],
  nodeTitle: '[ai] 换人',
  nodeDescription: '替换当前阵容中的两名干员。',
  approval: { mode: 'manual', approvedBy: 'user' },
}).ok, false);
assert.equal(validateMainWorkbenchCommand({
  op: 'selectCharacters',
  characterIds: ['a', 'b'],
  nodeTitle: '调整冰队支援',
  nodeDescription: '保留主力干员，并替换两名支援干员。',
  approval: { mode: 'manual', approvedBy: 'user' },
}).ok, true);
assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'aiCli' }).ok, false);
assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'unknown-page' }).ok, false);
assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'canvas' }).ok, true);
