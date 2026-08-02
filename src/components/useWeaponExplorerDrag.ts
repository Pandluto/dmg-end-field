import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SKILL_KEYS } from './weaponDraftCatalog';
import {
  canStartWeaponExplorerDrag,
  getWeaponExplorerDragNodeKey,
  isValidWeaponExplorerDropTarget,
  type WeaponExplorerDragNode,
  type WeaponExplorerDragPolicyState,
} from './weaponExplorerDragPolicy';

type WeaponSkillKey = Extract<WeaponExplorerDragNode, { kind: 'skill' }>['skillKey'];
type WeaponEffectBucket = Extract<WeaponExplorerDragNode, { kind: 'effect' }>['bucket'];

export interface WeaponExplorerDragState {
  source: WeaponExplorerDragNode;
  over: WeaponExplorerDragNode | null;
  x: number;
  y: number;
}

interface UseWeaponExplorerDragOptions {
  policyState: WeaponExplorerDragPolicyState;
  onReorder: (source: WeaponExplorerDragNode, target: WeaponExplorerDragNode) => void;
  onDragStart: () => void;
}

function isWeaponSkillKey(value: string): value is WeaponSkillKey {
  return SKILL_KEYS.includes(value as WeaponSkillKey);
}

function isWeaponEffectBucket(value: string): value is WeaponEffectBucket {
  return value === 'value' || value === 'effect';
}

export function useWeaponExplorerDrag({
  policyState,
  onReorder,
  onDragStart,
}: UseWeaponExplorerDragOptions) {
  const [dragState, setDragState] = useState<WeaponExplorerDragState | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const pendingDragSourceRef = useRef<{ source: WeaponExplorerDragNode; x: number; y: number } | null>(null);
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

  const canStartExplorerDrag = useCallback((node: WeaponExplorerDragNode) => {
    return canStartWeaponExplorerDrag(node, policyState);
  }, [policyState]);

  const isValidExplorerDropTarget = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode | null) => {
    return isValidWeaponExplorerDropTarget(source, target, policyState);
  }, [policyState]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): WeaponExplorerDragNode | null => {
    const row = element?.closest<HTMLElement>('[data-weapon-drag-kind]') ?? null;
    if (!row) {
      return null;
    }

    const kind = row.dataset.weaponDragKind;
    const draftId = row.dataset.weaponDraftId;
    if (!kind || !draftId) {
      return null;
    }

    if (kind === 'draft') {
      return { kind, draftId };
    }
    if (kind !== 'skill' && kind !== 'effect') {
      return null;
    }

    const skillKey = row.dataset.weaponSkillKey;
    if (!skillKey || !isWeaponSkillKey(skillKey)) {
      return null;
    }
    if (kind === 'skill') {
      return { kind, draftId, skillKey };
    }

    const bucket = row.dataset.weaponBucket;
    const effectKey = row.dataset.weaponEffectKey;
    if (!bucket || !isWeaponEffectBucket(bucket) || !effectKey) {
      return null;
    }
    return { kind, draftId, skillKey, bucket, effectKey };
  }, []);

  const handleExplorerPointerDown = useCallback((event: ReactPointerEvent, source: WeaponExplorerDragNode) => {
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
        const previousOverKey = previousState.over ? getWeaponExplorerDragNodeKey(previousState.over) : '';
        const nextOverKey = nextOver ? getWeaponExplorerDragNodeKey(nextOver) : '';
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
