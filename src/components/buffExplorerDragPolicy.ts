import {
  cloneValue,
  reorderRecordEntries,
  type BuffDraft,
  type BuffExplorerDragNode,
} from './buffDraftModel';

export interface BuffExplorerDragPolicyState {
  filterKeyword: string;
  collapsedDraftIds: Record<string, boolean>;
  collapsedItems: Record<string, boolean>;
  getItemCollapseKey: (draftId: string, itemKey: string) => string;
}

export interface BuffExplorerReorderResult {
  nextLibrary: Record<string, BuffDraft>;
  focusRowKey: string;
}

export function getBuffExplorerDragNodeKey(node: BuffExplorerDragNode): string {
  if (node.kind === 'draft') {
    return `draft:${node.draftId}`;
  }
  if (node.kind === 'item') {
    return `item:${node.draftId}:${node.itemKey}`;
  }
  return `effect:${node.draftId}:${node.itemKey}:${node.effectKey}`;
}

export function getBuffExplorerDragNodeLabel(
  library: Record<string, BuffDraft>,
  node: BuffExplorerDragNode,
): string {
  const targetDraft = library[node.draftId];
  if (!targetDraft) {
    return node.draftId;
  }
  if (node.kind === 'draft') {
    return targetDraft.name || node.draftId;
  }
  const targetItem = targetDraft.items[node.itemKey];
  if (!targetItem) {
    return node.itemKey;
  }
  if (node.kind === 'item') {
    return targetItem.name || node.itemKey;
  }
  const targetEffect = targetItem.effects[node.effectKey];
  return targetEffect?.displayName || node.effectKey;
}

export function canStartBuffExplorerDrag(
  node: BuffExplorerDragNode,
  state: BuffExplorerDragPolicyState,
): boolean {
  if (state.filterKeyword.trim()) {
    return false;
  }
  if (node.kind === 'draft') {
    return Boolean(state.collapsedDraftIds[node.draftId]);
  }
  if (node.kind === 'item') {
    return Boolean(state.collapsedItems[state.getItemCollapseKey(node.draftId, node.itemKey)]);
  }
  return true;
}

export function isValidBuffExplorerDropTarget(
  source: BuffExplorerDragNode,
  target: BuffExplorerDragNode | null,
  state: BuffExplorerDragPolicyState,
): boolean {
  if (!target || source.kind !== target.kind) {
    return false;
  }
  if (getBuffExplorerDragNodeKey(source) === getBuffExplorerDragNodeKey(target)) {
    return false;
  }
  if (target.kind === 'draft') {
    return canStartBuffExplorerDrag(source, state) && canStartBuffExplorerDrag(target, state);
  }
  if (target.kind === 'item') {
    return source.draftId === target.draftId
      && canStartBuffExplorerDrag(source, state)
      && canStartBuffExplorerDrag(target, state);
  }
  if (source.kind !== 'effect') {
    return false;
  }
  return source.draftId === target.draftId && source.itemKey === target.itemKey;
}

export function reorderBuffExplorerLibrary(
  library: Record<string, BuffDraft>,
  source: BuffExplorerDragNode,
  target: BuffExplorerDragNode,
): BuffExplorerReorderResult | null {
  if (source.kind !== target.kind || getBuffExplorerDragNodeKey(source) === getBuffExplorerDragNodeKey(target)) {
    return null;
  }

  if (source.kind === 'draft' && target.kind === 'draft') {
    if (!library[source.draftId] || !library[target.draftId]) {
      return null;
    }
    return {
      nextLibrary: reorderRecordEntries(library, source.draftId, target.draftId),
      focusRowKey: `group-${source.draftId}`,
    };
  }

  if (source.kind === 'item' && target.kind === 'item' && source.draftId === target.draftId) {
    const targetDraft = library[source.draftId];
    if (!targetDraft?.items[source.itemKey] || !targetDraft.items[target.itemKey]) {
      return null;
    }
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items = reorderRecordEntries(nextDraft.items, source.itemKey, target.itemKey);
    return {
      nextLibrary: { ...library, [source.draftId]: nextDraft },
      focusRowKey: `item-${source.itemKey}`,
    };
  }

  if (
    source.kind === 'effect'
    && target.kind === 'effect'
    && source.draftId === target.draftId
    && source.itemKey === target.itemKey
  ) {
    const targetDraft = library[source.draftId];
    const targetItem = targetDraft?.items[source.itemKey];
    if (!targetDraft || !targetItem?.effects[source.effectKey] || !targetItem.effects[target.effectKey]) {
      return null;
    }
    const nextDraft = cloneValue(targetDraft);
    nextDraft.items[source.itemKey].effects = reorderRecordEntries(
      nextDraft.items[source.itemKey].effects,
      source.effectKey,
      target.effectKey,
    );
    return {
      nextLibrary: { ...library, [source.draftId]: nextDraft },
      focusRowKey: `effect-${source.itemKey}-${source.effectKey}`,
    };
  }

  return null;
}
