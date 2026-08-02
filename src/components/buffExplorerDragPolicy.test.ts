import assert from 'node:assert/strict';
import { createDefaultBuffDraft, createDefaultBuffEffect, createDefaultBuffItem } from './buffDraftModel';
import {
  canStartBuffExplorerDrag,
  getBuffExplorerDragNodeKey,
  getBuffExplorerDragNodeLabel,
  isValidBuffExplorerDropTarget,
  reorderBuffExplorerLibrary,
  type BuffExplorerDragPolicyState,
} from './buffExplorerDragPolicy';

const draftA = {
  ...createDefaultBuffDraft(),
  id: 'draft-a',
  name: '分组 A',
  items: {
    'item-1': {
      ...createDefaultBuffItem('item-1', '分组 A'),
      name: '项目 A1',
      effects: {
        'buff-1': { ...createDefaultBuffEffect('buff-1', '分组 A'), displayName: '效果 A1' },
        'buff-2': { ...createDefaultBuffEffect('buff-2', '分组 A'), displayName: '效果 A2' },
      },
    },
    'item-2': { ...createDefaultBuffItem('item-2', '分组 A'), name: '项目 A2' },
  },
};
const draftB = { ...createDefaultBuffDraft(), id: 'draft-b', name: '分组 B' };
const library = { 'draft-a': draftA, 'draft-b': draftB };

const draftNodeA = { kind: 'draft', draftId: 'draft-a' } as const;
const draftNodeB = { kind: 'draft', draftId: 'draft-b' } as const;
const itemNodeA1 = { kind: 'item', draftId: 'draft-a', itemKey: 'item-1' } as const;
const itemNodeA2 = { kind: 'item', draftId: 'draft-a', itemKey: 'item-2' } as const;
const itemNodeB1 = { kind: 'item', draftId: 'draft-b', itemKey: 'item-1' } as const;
const effectNodeA1 = { kind: 'effect', draftId: 'draft-a', itemKey: 'item-1', effectKey: 'buff-1' } as const;
const effectNodeA2 = { kind: 'effect', draftId: 'draft-a', itemKey: 'item-1', effectKey: 'buff-2' } as const;
const effectNodeOtherItem = { kind: 'effect', draftId: 'draft-a', itemKey: 'item-2', effectKey: 'buff-1' } as const;

assert.equal(getBuffExplorerDragNodeKey(draftNodeA), 'draft:draft-a');
assert.equal(getBuffExplorerDragNodeKey(itemNodeA1), 'item:draft-a:item-1');
assert.equal(getBuffExplorerDragNodeKey(effectNodeA1), 'effect:draft-a:item-1:buff-1');
assert.equal(getBuffExplorerDragNodeLabel(library, draftNodeA), '分组 A');
assert.equal(getBuffExplorerDragNodeLabel(library, itemNodeA1), '项目 A1');
assert.equal(getBuffExplorerDragNodeLabel(library, effectNodeA1), '效果 A1');
assert.equal(getBuffExplorerDragNodeLabel(library, { kind: 'draft', draftId: 'missing' }), 'missing');
assert.equal(getBuffExplorerDragNodeLabel(library, { kind: 'item', draftId: 'draft-a', itemKey: 'missing' }), 'missing');
assert.equal(getBuffExplorerDragNodeLabel(library, { kind: 'effect', draftId: 'draft-a', itemKey: 'item-1', effectKey: 'missing' }), 'missing');

const getItemCollapseKey = (draftId: string, itemKey: string) => `${draftId}:${itemKey}`;
const dragState: BuffExplorerDragPolicyState = {
  filterKeyword: '',
  collapsedDraftIds: { 'draft-a': true, 'draft-b': true },
  collapsedItems: { 'draft-a:item-1': true, 'draft-a:item-2': true, 'draft-b:item-1': true },
  getItemCollapseKey,
};

assert.equal(canStartBuffExplorerDrag(draftNodeA, dragState), true);
assert.equal(canStartBuffExplorerDrag(itemNodeA1, dragState), true);
assert.equal(canStartBuffExplorerDrag(effectNodeA1, dragState), true);
assert.equal(canStartBuffExplorerDrag(draftNodeA, { ...dragState, filterKeyword: 'A' }), false);
assert.equal(canStartBuffExplorerDrag(draftNodeA, { ...dragState, collapsedDraftIds: {} }), false);
assert.equal(canStartBuffExplorerDrag(itemNodeA1, { ...dragState, collapsedItems: {} }), false);

assert.equal(isValidBuffExplorerDropTarget(draftNodeA, draftNodeB, dragState), true);
assert.equal(isValidBuffExplorerDropTarget(draftNodeA, draftNodeA, dragState), false);
assert.equal(isValidBuffExplorerDropTarget(draftNodeA, itemNodeA1, dragState), false);
assert.equal(isValidBuffExplorerDropTarget(draftNodeA, null, dragState), false);
assert.equal(isValidBuffExplorerDropTarget(draftNodeA, draftNodeB, { ...dragState, collapsedDraftIds: {} }), false);
assert.equal(isValidBuffExplorerDropTarget(itemNodeA1, itemNodeA2, dragState), true);
assert.equal(isValidBuffExplorerDropTarget(itemNodeA1, itemNodeB1, dragState), false);
assert.equal(isValidBuffExplorerDropTarget(effectNodeA1, effectNodeA2, dragState), true);
assert.equal(isValidBuffExplorerDropTarget(effectNodeA1, effectNodeOtherItem, dragState), false);

const reorderedDrafts = reorderBuffExplorerLibrary(library, draftNodeB, draftNodeA);
assert.ok(reorderedDrafts);
assert.deepEqual(Object.keys(reorderedDrafts.nextLibrary), ['draft-b', 'draft-a']);
assert.equal(reorderedDrafts.focusRowKey, 'group-draft-b');
assert.deepEqual(Object.keys(library), ['draft-a', 'draft-b'], 'draft reorder must not mutate the source');

const reorderedItems = reorderBuffExplorerLibrary(library, itemNodeA2, itemNodeA1);
assert.ok(reorderedItems);
assert.deepEqual(Object.keys(reorderedItems.nextLibrary['draft-a'].items), ['item-2', 'item-1']);
assert.equal(reorderedItems.focusRowKey, 'item-item-2');
assert.deepEqual(Object.keys(library['draft-a'].items), ['item-1', 'item-2'], 'item reorder must not mutate the source');

const reorderedEffects = reorderBuffExplorerLibrary(library, effectNodeA2, effectNodeA1);
assert.ok(reorderedEffects);
assert.deepEqual(Object.keys(reorderedEffects.nextLibrary['draft-a'].items['item-1'].effects), ['buff-2', 'buff-1']);
assert.equal(reorderedEffects.focusRowKey, 'effect-item-1-buff-2');
assert.deepEqual(Object.keys(library['draft-a'].items['item-1'].effects), ['buff-1', 'buff-2'], 'effect reorder must not mutate the source');

assert.equal(reorderBuffExplorerLibrary(library, itemNodeA1, itemNodeB1), null);
assert.equal(reorderBuffExplorerLibrary(library, effectNodeA1, effectNodeOtherItem), null);
assert.equal(reorderBuffExplorerLibrary(library, draftNodeA, draftNodeA), null);

console.log('Buff explorer drag policy contract: PASS');
