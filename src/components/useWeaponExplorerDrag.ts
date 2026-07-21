import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type * as React from 'react';
import {
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_LIBRARY_STORAGE_KEY,
  moveRecordEntry,
  type WeaponDraft,
  type WeaponEffectBucket,
  type WeaponExplorerDragNode,
  type WeaponExplorerDragState,
  type WeaponSheetContextMenuState,
  type WeaponSkillKey,
} from './weaponDraftPageModel';

interface UseWeaponExplorerDragOptions {
  draft: WeaponDraft;
  filterKeyword: string;
  localLibrary: Record<string, WeaponDraft>;
  setContextMenu: Dispatch<SetStateAction<WeaponSheetContextMenuState | null>>;
  setDraft: Dispatch<SetStateAction<WeaponDraft>>;
  setLocalLibrary: Dispatch<SetStateAction<Record<string, WeaponDraft>>>;
}

export function useWeaponExplorerDrag({
  draft,
  filterKeyword,
  localLibrary,
  setContextMenu,
  setDraft,
  setLocalLibrary,
}: UseWeaponExplorerDragOptions) {
  const [dragState, setDragState] = useState<WeaponExplorerDragState | null>(null);
  const pendingDragSourceRef = useRef<{ source: WeaponExplorerDragNode; x: number; y: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const suppressExplorerClickRef = useRef(false);

  // Explorer drag helpers
  const getExplorerDragNodeKey = useCallback((node: WeaponExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'skill') {
      return `skill:${node.draftId}:${node.skillKey}`;
    }
    return `effect:${node.draftId}:${node.skillKey}:${node.bucket}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: WeaponExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
    if (!targetDraft) {
      return node.draftId;
    }
    if (node.kind === 'draft') {
      return targetDraft.name || node.draftId;
    }
    if (node.kind === 'skill') {
      return targetDraft.skills[node.skillKey]?.name || node.skillKey;
    }
    const skill = targetDraft.skills[node.skillKey];
    if (!skill) {
      return node.effectKey;
    }
    //这里对了
    return skill.effects[node.effectKey].name;

  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const canStartExplorerDrag = useCallback((node: WeaponExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    // 只允许 skill3 的 effect 拖拽
    if (node.kind === 'effect') {
      return node.skillKey === 'skill3';
    }
    // draft 和 skill 不允许拖拽
    return false;
  }, [filterKeyword]);

  const isValidExplorerDropTarget = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'skill') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.skillKey === target.skillKey && source.bucket === target.bucket && source.bucket !== 'value';
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): WeaponExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-weapon-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.weaponDragKind as WeaponExplorerDragNode['kind'] | undefined;
    const draftId = row.dataset.weaponDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind, draftId };
    }
    const skillKey = row.dataset.weaponSkillKey as WeaponSkillKey | undefined;
    if (!skillKey) {
      return null;
    }
    if (kind === 'skill') {
      return { kind, draftId, skillKey };
    }
    const bucket = row.dataset.weaponBucket as WeaponEffectBucket | undefined;
    const effectKey = row.dataset.weaponEffectKey;
    if (!bucket || !effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, skillKey, bucket, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      // Reorder drafts in library
      const nextLibrary = moveRecordEntry(localLibrary, source.draftId, target.draftId);
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    } else if (source.kind === 'skill' && target.kind === 'skill' && source.draftId === target.draftId) {
      // Reorder skills within a draft (SKILL_KEYS is fixed order, so we need to reorder effectTypes instead)
      const targetDraft = localLibrary[source.draftId] || draft;
      const nextDraft = { ...targetDraft };
      // Skills are fixed (skill1, skill2, skill3), so we reorder their effectTypes
      // This is a simplified implementation
      setDraft(nextDraft);
      window.localStorage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    } else if (source.kind === 'effect' && target.kind === 'effect' && source.draftId === target.draftId && source.skillKey === target.skillKey && source.bucket === target.bucket && source.bucket !== 'value') {
      // effects record 的插入顺序即显示顺序，拖拽直接移动 entry
      const targetDraft = localLibrary[source.draftId] || draft;
      const nextEffects = moveRecordEntry(targetDraft.skills[source.skillKey].effects, source.effectKey, target.effectKey);
      const nextDraft: WeaponDraft = {
        ...targetDraft,
        skills: {
          ...targetDraft.skills,
          [source.skillKey]: {
            ...targetDraft.skills[source.skillKey],
            effects: nextEffects,
          },
        },
      };
      if (targetDraft.id === draft.id) {
        setDraft(nextDraft);
      }
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    }
  }, [draft, isValidExplorerDropTarget, localLibrary]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: WeaponExplorerDragNode) => {
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

  const formatWeaponExplorerDragKindLabel = (kind: WeaponExplorerDragNode['kind']): string => {
    if (kind === 'draft') {
      return '武器';
    }
    if (kind === 'skill') {
      return '技能';
    }
    return '效果';
  };

  // Explorer drag global event listeners
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
    suppressExplorerClickRef,
    getExplorerDragNodeKey,
    getExplorerDragNodeLabel,
    canStartExplorerDrag,
    handleExplorerPointerDown,
    formatWeaponExplorerDragKindLabel,
  };
}
