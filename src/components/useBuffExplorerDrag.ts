import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { BuffExplorerDragNode, BuffExplorerDragState } from './buffDraftModel';
import {
  canStartBuffExplorerDrag,
  getBuffExplorerDragNodeKey,
  isValidBuffExplorerDropTarget,
  type BuffExplorerDragPolicyState,
} from './buffExplorerDragPolicy';

interface UseBuffExplorerDragOptions {
  policyState: BuffExplorerDragPolicyState;
  onReorder: (source: BuffExplorerDragNode, target: BuffExplorerDragNode) => void;
  onDragStart: () => void;
}

export function useBuffExplorerDrag({
  policyState,
  onReorder,
  onDragStart,
}: UseBuffExplorerDragOptions) {
  const [dragState, setDragState] = useState<BuffExplorerDragState | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const pendingDragSourceRef = useRef<{ source: BuffExplorerDragNode; x: number; y: number } | null>(null);
  const suppressExplorerClickRef = useRef(false);

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
    return canStartBuffExplorerDrag(node, policyState);
  }, [policyState]);

  const isValidExplorerDropTarget = useCallback((source: BuffExplorerDragNode, target: BuffExplorerDragNode | null) => {
    return isValidBuffExplorerDropTarget(source, target, policyState);
  }, [policyState]);

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

  const handleExplorerPointerDown = useCallback((event: ReactPointerEvent, source: BuffExplorerDragNode) => {
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
      onDragStart();
      setDragState({ source, over: null, x: event.clientX, y: event.clientY });
      pendingDragSourceRef.current = null;
      dragHoldTimerRef.current = null;
    }, 220);
  }, [canStartExplorerDrag, clearPendingExplorerDrag, onDragStart]);

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
      setDragState((previousState) => {
        if (!previousState) {
          return previousState;
        }
        const nextOver = isValidExplorerDropTarget(previousState.source, hoveredNode) ? hoveredNode : null;
        const previousOverKey = previousState.over ? getBuffExplorerDragNodeKey(previousState.over) : '';
        const nextOverKey = nextOver ? getBuffExplorerDragNodeKey(nextOver) : '';
        if (
          previousOverKey === nextOverKey
          && previousState.x === event.clientX
          && previousState.y === event.clientY
        ) {
          return previousState;
        }
        return {
          ...previousState,
          over: nextOver,
          x: event.clientX,
          y: event.clientY,
        };
      });
    };

    const finalizeDrag = () => {
      clearPendingExplorerDrag();
      setDragState((previousState) => {
        if (previousState?.over) {
          onReorder(previousState.source, previousState.over);
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
  }, [clearPendingExplorerDrag, dragState, isValidExplorerDropTarget, onReorder, resolveExplorerDragNodeFromElement]);

  return {
    dragState,
    consumeSuppressedExplorerClick,
    canStartExplorerDrag,
    handleExplorerPointerDown,
  };
}
