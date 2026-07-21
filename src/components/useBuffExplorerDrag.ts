import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type * as React from 'react';
import {
  cloneValue,
  reorderRecordEntries,
  type BuffDraft,
  type BuffExplorerDragNode,
  type BuffExplorerDragState,
  type BuffSheetContextMenuState,
} from './buffDraftPageModel';

interface UseBuffExplorerDragOptions {
  collapsedDraftIds: Record<string, boolean>;
  collapsedItems: Record<string, boolean>;
  contextMenu: BuffSheetContextMenuState | null;
  filterKeyword: string;
  getItemCollapseKey: (draftId: string, itemKey: string) => string;
  localLibrary: Record<string, BuffDraft>;
  persistLibraryState: (nextLibrary: Record<string, BuffDraft>, nextSelectedId?: string) => void;
  selectedLocalDraftId: string;
  setContextMenu: Dispatch<SetStateAction<BuffSheetContextMenuState | null>>;
  setPendingFocusRowKey: Dispatch<SetStateAction<string | null>>;
}

export function useBuffExplorerDrag({
  collapsedDraftIds,
  collapsedItems,
  contextMenu,
  filterKeyword,
  getItemCollapseKey,
  localLibrary,
  persistLibraryState,
  selectedLocalDraftId,
  setContextMenu,
  setPendingFocusRowKey,
}: UseBuffExplorerDragOptions) {
  const [dragState, setDragState] = useState<BuffExplorerDragState | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const pendingDragSourceRef = useRef<{ source: BuffExplorerDragNode; x: number; y: number } | null>(null);
  const suppressExplorerClickRef = useRef(false);

  const getExplorerDragNodeKey = useCallback((node: BuffExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'item') {
      return `item:${node.draftId}:${node.itemKey}`;
    }
    return `effect:${node.draftId}:${node.itemKey}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: BuffExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
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
  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const consumeSuppressedExplorerClick = useCallback(() => {
    if (!suppressExplorerClickRef.current) {
      return false;
    }
    suppressExplorerClickRef.current = false;
    return true;
  }, []);

  const canStartExplorerDrag = useCallback((node: BuffExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    if (node.kind === 'draft') {
      return Boolean(collapsedDraftIds[node.draftId]);
    }
    if (node.kind === 'item') {
      return Boolean(collapsedItems[getItemCollapseKey(node.draftId, node.itemKey)]);
    }
    return true;
  }, [collapsedDraftIds, collapsedItems, filterKeyword, getItemCollapseKey]);

  const isValidExplorerDropTarget = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'item') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.itemKey === target.itemKey;
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): BuffExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-buff-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.buffDragKind;
    const draftId = row.dataset.buffDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind: 'draft', draftId };
    }
    const itemKey = row.dataset.buffItemKey;
    if (!itemKey) {
      return null;
    }
    if (kind === 'item') {
      return { kind: 'item', draftId, itemKey };
    }
    const effectKey = row.dataset.buffEffectKey;
    if (!effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, itemKey, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      const nextLibrary = reorderRecordEntries(localLibrary, source.draftId, target.draftId);
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`group-${source.draftId}`);
      return;
    }

    if (source.kind === 'item' && target.kind === 'item') {
      const targetDraft = localLibrary[source.draftId];
      if (!targetDraft) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items = reorderRecordEntries(nextDraft.items, source.itemKey, target.itemKey);
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`item-${source.itemKey}`);
      return;
    }

    if (source.kind === 'effect' && target.kind === 'effect') {
      const targetDraft = localLibrary[source.draftId];
      const targetItem = targetDraft?.items[source.itemKey];
      if (!targetDraft || !targetItem) {
        return;
      }
      const nextDraft = cloneValue(targetDraft);
      nextDraft.items[source.itemKey].effects = reorderRecordEntries(
        nextDraft.items[source.itemKey].effects,
        source.effectKey,
        target.effectKey,
      );
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      persistLibraryState(nextLibrary, selectedLocalDraftId || source.draftId);
      setPendingFocusRowKey(`effect-${source.itemKey}-${source.effectKey}`);
    }
  }, [isValidExplorerDropTarget, localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: BuffExplorerDragNode) => {
    if (event.button !== 0 || !canStartExplorerDrag(source)) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.buff-sheet-explorer-toggle')) {
      return;
    }
    clearPendingExplorerDrag();
    pendingDragSourceRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
    };
    dragHoldTimerRef.current = window.setTimeout(() => {
      suppressExplorerClickRef.current = true;
      setContextMenu(null);
      setDragState({ source, over: null, x: event.clientX, y: event.clientY });
      pendingDragSourceRef.current = null;
      dragHoldTimerRef.current = null;
    }, 220);
  }, [canStartExplorerDrag, clearPendingExplorerDrag]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handlePointerDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingDragSourceRef.current;
      if (pending) {
        const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
        if (distance > 6) {
          clearPendingExplorerDrag();
        }
      }
      if (!dragState) {
        return;
      }
      event.preventDefault();
      const hoveredNode = resolveExplorerDragNodeFromElement(document.elementFromPoint(event.clientX, event.clientY));
      setDragState((prev) => {
        if (!prev) {
          return prev;
        }
        const nextOver = isValidExplorerDropTarget(prev.source, hoveredNode) ? hoveredNode : null;
        const previousOverKey = prev.over ? getExplorerDragNodeKey(prev.over) : '';
        const nextOverKey = nextOver ? getExplorerDragNodeKey(nextOver) : '';
        if (previousOverKey === nextOverKey && prev.x === event.clientX && prev.y === event.clientY) {
          return prev;
        }
        return {
          ...prev,
          over: nextOver,
          x: event.clientX,
          y: event.clientY,
        };
      });
    };

    const finalizeDrag = () => {
      clearPendingExplorerDrag();
      setDragState((prev) => {
        if (prev?.over) {
          applyExplorerReorder(prev.source, prev.over);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finalizeDrag, true);
    window.addEventListener('pointercancel', finalizeDrag, true);
    window.addEventListener('blur', finalizeDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finalizeDrag, true);
      window.removeEventListener('pointercancel', finalizeDrag, true);
      window.removeEventListener('blur', finalizeDrag);
    };
  }, [applyExplorerReorder, clearPendingExplorerDrag, dragState, getExplorerDragNodeKey, isValidExplorerDropTarget, resolveExplorerDragNodeFromElement]);


  return {
    dragState,
    getExplorerDragNodeKey,
    getExplorerDragNodeLabel,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
  };
}
